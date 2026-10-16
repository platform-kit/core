import assert from 'node:assert/strict'
import { createIncrementalUsageSettler } from '../supabase/functions/_shared/usage-incremental.mjs'
import { meteredUsageAmountMinor } from '../supabase/functions/_shared/hyperswitch-billing.mjs'

function createReusablePaymentTestProfile() {
  return {
    profileId: 'pro_usage_test',
    connectorAccounts: [{
      connectorName: 'stripe',
      connectorType: 'payment_processor',
      status: 'active',
      testMode: true,
      recurringEnabled: true,
    }],
    customer: {
      customerId: 'cus_usage_test',
      savedPaymentMethods: [{ paymentMethodId: 'pm_usage_test', type: 'card', status: 'active' }],
    },
  }
}

const reusablePaymentProfile = createReusablePaymentTestProfile()
assert.equal(reusablePaymentProfile.connectorAccounts[0].testMode, true)
assert.equal(reusablePaymentProfile.customer.savedPaymentMethods[0].status, 'active')

function database({ status = 'succeeded' } = {}) {
  const tables = {
    subscriptions: [{
      id: 'sub_1', user_id: 'user_1', key: 'plan_1', usage_incremental_charge_minor: 10_000,
      usage_incremental_charge_currency: 'usd',
    }],
    usage_events: [{
      id: 'event_1', subscription_id: 'sub_1', period_start: '2026-10-01T00:00:00.000Z',
      metered_micros: 2_500_000, overage_price_micros: 100_000_000,
      usage_incremental_charge_minor: 10_000, usage_incremental_charge_currency: 'usd',
    }],
    usage_incremental_settlements: [],
  }
  class Query {
    constructor(table) {
      this.table = table
      this.filters = {}
      this.operation = 'select'
      this.values = null
      this.ignoreDuplicates = false
    }
    select() { return this }
    eq(key, value) { this.filters[key] = value; return this }
    gt(key, value) { this.gtFilter = [key, value]; return this }
    match(values) { Object.assign(this.filters, values); return this }
    upsert(values, options) {
      this.operation = 'upsert'
      this.values = values
      this.ignoreDuplicates = options?.ignoreDuplicates === true
      return this
    }
    update(values) { this.operation = 'update'; this.values = values; return this }
    rows() {
      return tables[this.table].filter((row) =>
        Object.entries(this.filters).every(([key, value]) => row[key] === value) &&
        (!this.gtFilter || row[this.gtFilter[0]] > this.gtFilter[1]))
    }
    execute() {
      if (this.operation === 'upsert') {
        const key = ['provider', 'subscription_id', 'period_start', 'settlement_key']
        const existing = tables[this.table].find((row) => key.every((field) => row[field] === this.values[field]))
        if (!existing) tables[this.table].push({ ...this.values })
        else if (!this.ignoreDuplicates) Object.assign(existing, this.values)
        return { data: null, error: null }
      }
      if (this.operation === 'update') {
        const rows = this.rows()
        for (const row of rows) Object.assign(row, this.values)
        return { data: rows, error: null }
      }
      return { data: this.rows(), error: null }
    }
    maybeSingle() {
      const rows = this.execute().data
      return Promise.resolve({ data: rows[0] ?? null, error: null })
    }
    single() {
      const rows = this.execute().data
      return Promise.resolve(rows[0]
        ? { data: rows[0], error: null }
        : { data: null, error: { message: 'row missing' } })
    }
    then(resolve, reject) {
      return Promise.resolve(this.execute()).then(resolve, reject)
    }
  }
  return {
    tables,
    admin: { from: (table) => new Query(table) },
    createPaymentIntent: async (input) => ({
      paymentIntentId: `pi_${input.idempotencyKey}`,
      status,
    }),
  }
}

const state = database()
const paymentCalls = []
const links = []
const provider = {
  id: 'stripe',
  createPaymentIntent: async (input) => {
    paymentCalls.push(input)
    return state.createPaymentIntent(input)
  },
}
const settle = createIncrementalUsageSettler({
  admin: state.admin,
  offerByKey: () => ({ currency: 'usd', title: 'Usage plan' }),
  toMinorUnits: meteredUsageAmountMinor,
  findProviderExternalIds: async (_provider, type) => type === 'customer'
    ? [reusablePaymentProfile.customer.customerId]
    : [reusablePaymentProfile.customer.savedPaymentMethods[0].paymentMethodId],
  linkProviderEntity: async (...args) => { links.push(args) },
})
const period = { subscriptionId: 'sub_1', periodStart: '2026-10-01T00:00:00.000Z' }

assert.deepEqual(await settle(provider, period), { amountMinor: 25_000, chargedMinor: 20_000 })
assert.deepEqual(paymentCalls.map((call) => call.amountMinor), [10_000, 10_000])
assert.ok(paymentCalls.every((call) =>
  call.customerId === reusablePaymentProfile.customer.customerId &&
  call.paymentMethodId === reusablePaymentProfile.customer.savedPaymentMethods[0].paymentMethodId),
'threshold charges use the reusable method on the isolated test profile')
assert.notEqual(paymentCalls[0].idempotencyKey, paymentCalls[1].idempotencyKey)
assert.deepEqual(await settle(provider, { ...period, finalize: true }), {
  amountMinor: 25_000, chargedMinor: 25_000,
})
assert.deepEqual(paymentCalls.map((call) => call.amountMinor), [10_000, 10_000, 5_000])
assert.deepEqual(await settle(provider, { ...period, finalize: true }), {
  amountMinor: 25_000, chargedMinor: 25_000,
})
assert.equal(paymentCalls.length, 3, 'replaying a completed period never creates duplicate charges')
assert.equal(state.tables.usage_incremental_settlements.length, 3)
assert.ok(state.tables.usage_incremental_settlements.every((row) => row.status === 'succeeded'))
assert.ok(state.tables.usage_incremental_settlements.every((row) => row.attempt_number === 1))
assert.equal(links.length, 3, 'each successful charge is linked to its subscription')

const failed = database({ status: 'requires_action' })
failed.tables.usage_events[0].metered_micros = 1_000_000
const failedSettler = createIncrementalUsageSettler({
  admin: failed.admin,
  offerByKey: () => ({ currency: 'usd', title: 'Usage plan' }),
  toMinorUnits: meteredUsageAmountMinor,
  findProviderExternalIds: async (_provider, type) => type === 'customer'
    ? [reusablePaymentProfile.customer.customerId]
    : [reusablePaymentProfile.customer.savedPaymentMethods[0].paymentMethodId],
  linkProviderEntity: async () => {},
})
const actionRequiredCalls = []
const actionRequiredProvider = {
  ...provider,
  createPaymentIntent: async (input) => {
    actionRequiredCalls.push(input)
    return failed.createPaymentIntent(input)
  },
  retrievePaymentIntent: async (paymentIntentId) => ({ paymentIntentId, status: 'succeeded' }),
}
await assert.rejects(() => failedSettler(actionRequiredProvider, period), /returned status "requires_action"/)
assert.equal(failed.tables.usage_incremental_settlements[0].status, 'requires_action')
assert.equal(failed.tables.usage_incremental_settlements[0].amount_minor, 10_000)
assert.deepEqual(await failedSettler(actionRequiredProvider, period), {
  amountMinor: 10_000, chargedMinor: 10_000,
})
assert.equal(failed.tables.usage_incremental_settlements[0].status, 'succeeded')
assert.equal(actionRequiredCalls.length, 1, 'authentication completion reuses the recorded intent instead of creating another charge')

const declined = database({ status: 'requires_payment_method' })
const declinedSettler = createIncrementalUsageSettler({
  admin: declined.admin,
  offerByKey: () => ({ currency: 'usd', title: 'Usage plan' }),
  toMinorUnits: meteredUsageAmountMinor,
  findProviderExternalIds: async (_provider, type) => type === 'customer'
    ? [reusablePaymentProfile.customer.customerId]
    : [reusablePaymentProfile.customer.savedPaymentMethods[0].paymentMethodId],
  linkProviderEntity: async () => {},
})
const declinedProvider = {
  ...provider,
  createPaymentIntent: async (input) => declined.createPaymentIntent(input),
}
await assert.rejects(
  () => declinedSettler(declinedProvider, period),
  /returned status "requires_payment_method"/,
)
assert.equal(declined.tables.usage_incremental_settlements[0].status, 'failed')
assert.equal(declined.tables.usage_incremental_settlements[0].amount_minor, 10_000)

const retryState = database({ status: 'requires_payment_method' })
retryState.tables.usage_events[0].metered_micros = 1_000_000
const retrySettler = createIncrementalUsageSettler({
  admin: retryState.admin,
  offerByKey: () => ({ currency: 'usd', title: 'Usage plan' }),
  toMinorUnits: meteredUsageAmountMinor,
  findProviderExternalIds: async (_provider, type) => type === 'customer'
    ? [reusablePaymentProfile.customer.customerId]
    : ['pm_original'],
  linkProviderEntity: async () => {},
})
const retryCalls = []
let retryPaymentMethod = 'pm_updated'
const retryProvider = {
  ...provider,
  getDefaultPaymentMethod: async () => ({ paymentMethodId: retryPaymentMethod }),
  createPaymentIntent: async (input) => {
    retryCalls.push(input)
    return {
      paymentIntentId: `pi_attempt_${retryCalls.length}`,
      status: retryCalls.length === 1 ? 'requires_payment_method' : 'succeeded',
    }
  },
}
await assert.rejects(() => retrySettler(retryProvider, period), /returned status "requires_payment_method"/)
assert.equal(retryState.tables.usage_incremental_settlements[0].attempt_number, 1)
await retrySettler(retryProvider, period)
assert.equal(retryCalls.length, 2, 'a declined payment may be retried as a new payment attempt')
assert.equal(retryCalls[0].paymentMethodId, 'pm_updated')
assert.equal(retryCalls[1].paymentMethodId, 'pm_updated', 'retry uses the current default saved payment method')
assert.notEqual(retryCalls[0].idempotencyKey, retryCalls[1].idempotencyKey)
assert.equal(retryCalls[1].metadata.platformkit_usage_attempt, '2')
assert.equal(retryState.tables.usage_incremental_settlements[0].attempt_number, 2)
assert.equal(retryState.tables.usage_incremental_settlements[0].status, 'succeeded')

const uncertainState = database()
uncertainState.tables.usage_events[0].metered_micros = 1_000_000
const uncertainSettler = createIncrementalUsageSettler({
  admin: uncertainState.admin,
  offerByKey: () => ({ currency: 'usd', title: 'Usage plan' }),
  toMinorUnits: meteredUsageAmountMinor,
  findProviderExternalIds: async (_provider, type) => type === 'customer'
    ? [reusablePaymentProfile.customer.customerId]
    : [reusablePaymentProfile.customer.savedPaymentMethods[0].paymentMethodId],
  linkProviderEntity: async () => {},
})
const uncertainKeys = []
let uncertainCall = 0
const uncertainProvider = {
  ...provider,
  createPaymentIntent: async (input) => {
    uncertainKeys.push(input.idempotencyKey)
    uncertainCall++
    if (uncertainCall === 1) throw new Error('provider request timed out')
    return { paymentIntentId: 'pi_uncertain', status: 'succeeded' }
  },
}
await assert.rejects(() => uncertainSettler(uncertainProvider, period), /timed out/)
assert.equal(uncertainState.tables.usage_incremental_settlements[0].status, 'pending')
assert.deepEqual(await uncertainSettler(uncertainProvider, period), { amountMinor: 10_000, chargedMinor: 10_000 })
assert.equal(uncertainKeys[0], uncertainKeys[1], 'an uncertain provider result retries with the same idempotency key')

const processingState = database({ status: 'processing' })
processingState.tables.usage_events[0].metered_micros = 1_000_000
const processingSettler = createIncrementalUsageSettler({
  admin: processingState.admin,
  offerByKey: () => ({ currency: 'usd', title: 'Usage plan' }),
  toMinorUnits: meteredUsageAmountMinor,
  findProviderExternalIds: async (_provider, type) => type === 'customer'
    ? [reusablePaymentProfile.customer.customerId]
    : [reusablePaymentProfile.customer.savedPaymentMethods[0].paymentMethodId],
  linkProviderEntity: async () => {},
})
let processingCreates = 0
const processingProvider = {
  ...provider,
  createPaymentIntent: async (input) => {
    processingCreates++
    return { paymentIntentId: `pi_${input.idempotencyKey}`, status: 'processing' }
  },
  retrievePaymentIntent: async (paymentIntentId) => ({ paymentIntentId, status: 'succeeded' }),
}
await assert.rejects(() => processingSettler(processingProvider, period), /returned status "processing"/)
assert.equal(processingState.tables.usage_incremental_settlements[0].status, 'pending')
assert.deepEqual(await processingSettler(processingProvider, period), { amountMinor: 10_000, chargedMinor: 10_000 })
assert.equal(processingCreates, 1, 'a pending payment is reconciled by retrieval rather than a second create')

const currencyState = database()
currencyState.tables.subscriptions[0].usage_incremental_charge_minor = 100
currencyState.tables.subscriptions[0].usage_incremental_charge_currency = 'jpy'
currencyState.tables.usage_events[0].usage_incremental_charge_minor = 100
currencyState.tables.usage_events[0].usage_incremental_charge_currency = 'jpy'
const currencyCalls = []
const currencySettler = createIncrementalUsageSettler({
  admin: currencyState.admin,
  offerByKey: () => ({ currency: 'usd', title: 'Usage plan' }),
  toMinorUnits: meteredUsageAmountMinor,
  findProviderExternalIds: async (_provider, type) => type === 'customer'
    ? [reusablePaymentProfile.customer.customerId]
    : [reusablePaymentProfile.customer.savedPaymentMethods[0].paymentMethodId],
  linkProviderEntity: async () => {},
})
await currencySettler({
  ...provider,
  createPaymentIntent: async (input) => {
    currencyCalls.push(input)
    return { paymentIntentId: `pi_${currencyCalls.length}`, status: 'succeeded' }
  },
}, { ...period, finalize: true })
assert.deepEqual(currencyCalls.map((call) => [call.amountMinor, call.currency]), [
  [100, 'jpy'], [100, 'jpy'], [50, 'jpy'],
], 'a subscription keeps the offer currency it started with if the live offer changes')

console.log('usage-incremental: threshold, remainder, idempotency, currency snapshot, safe pending retry, decline retry, and action-required cases passed')

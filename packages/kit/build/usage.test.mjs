import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asStore } from './store/index.mjs'
import { compileCatalog, compileUsage } from './catalog.mjs'
import { surfaces } from './deploy-checks.mjs'
import { boundedModelUsage, ensureUsageBilling, includedGrantForInvoice, meterUnitAmountDecimal, meteredCheckoutLine, sendUsageMeterEvent, unitsForCost, usageStripeMetadata } from '../supabase/functions/_shared/usage-stripe.mjs'
import { pcmSecondsMicros, speechCostMicros, speechUsageRecord, speechTelemetryRecord, createSpeechHandler } from '../supabase/functions/_shared/copilot/speech-proxy.js'
import { readBots } from './bots.mjs'
import { inferenceOf, usageOf } from './site.mjs'
import { createUsageTopUp } from '../supabase/functions/_shared/usage-topup.mjs'
import { createUsageGate, resolveUsageOperation } from '../supabase/functions/_shared/usage-gate.mjs'
import { billableInferenceAttempts, boundedInferenceUsage, customerCostMicros, normalizeProviderUsage, providerCostMicros, tariffFor } from '../supabase/functions/_shared/inference-meter.mjs'
import { ask, providersFrom } from '../supabase/functions/_shared/agents/provider.js'

const fail = (message) => { throw new Error(message) }
const inferenceFixture = inferenceOf({
  inference: {
    providers: [
      {
        id: 'primary', protocol: 'openai-chat', secret: 'env:PRIMARY_KEY', baseUrl: 'https://primary.test/v1',
        model: 'same-model', models: { 'same-model': { inputPerMillionUsd: 1, outputPerMillionUsd: 2 } },
      },
      {
        id: 'backup', protocol: 'anthropic', secret: 'env:BACKUP_KEY', baseUrl: 'https://backup.test',
        model: 'backup-model', models: { 'backup-model': { inputPerMillionUsd: 4, outputPerMillionUsd: 8 } },
      },
    ],
    fallback: { enabled: true, maxAttempts: 2, retryStatuses: [503] },
    markup: { default: 1 },
  },
})
const configuredProviders = providersFrom({ AGENTS_LIVE: '1', PRIMARY_KEY: 'primary-secret', BACKUP_KEY: 'backup-secret' }, inferenceFixture)
const originalProviderFetch = globalThis.fetch
const providerCalls = []
try {
  globalThis.fetch = async (url, init) => {
    providerCalls.push({ url: String(url), body: JSON.parse(init.body) })
    if (String(url).includes('primary.test')) return new Response('temporarily unavailable', { status: 503 })
    return Response.json({
      model: 'backup-model', content: [{ type: 'text', text: 'served by backup' }],
      usage: { input_tokens: 20, output_tokens: 10 },
    })
  }
  const response = await ask({
    providers: configuredProviders,
    model: 'same-model',
    messages: [{ role: 'user', content: 'Question' }],
  })
  assert.equal(providerCalls.length, 2, 'only the configured fallback is called after the primary returns a permitted retry status')
  assert.equal(response.provider, 'backup')
  assert.equal(response.model, 'backup-model')
  assert.deepEqual(response.attempts.map(({ provider, model, outcome, status }) =>
    ({ provider, model, outcome, status })), [
    { provider: 'primary', model: 'same-model', outcome: 'failed', status: 503 },
    { provider: 'backup', model: 'backup-model', outcome: 'succeeded', status: 200 },
  ])
  assert.equal(providerCalls[0].body.model, 'same-model')
  assert.equal(providerCalls[1].body.model, 'backup-model', 'fallback uses its own model identifier')
  const actualUsage = normalizeProviderUsage(response.protocol, response.usage.raw)
  assert.equal(providerCostMicros(actualUsage, tariffFor(inferenceFixture, response.provider, response.model)), 160)
  assert.equal(
    providerCostMicros(actualUsage, tariffFor(inferenceFixture, 'primary', 'same-model')),
    40,
    'identical token counts with the same model label use the actual provider-specific tariff',
  )
} finally {
  globalThis.fetch = originalProviderFetch
}
const providerBound = boundedInferenceUsage({
  messages: [{ role: 'user', content: 'Question' }],
  providers: configuredProviders.list,
  model: 'same-model',
  remainingCostMicros: 10_000,
  maxOutputTokens: 4096,
})
assert.equal(providerBound.attempts.length, 2, 'the reservation covers every configured provider attempt')
assert.equal(providerBound.maxCostMicros, providerBound.attempts.reduce((sum, attempt) => sum + attempt.maxCostMicros, 0))
assert.ok(providerBound.maxCostMicros <= 10_000)
const fallbackAccounting = billableInferenceAttempts({
  attempts: [
    { provider: 'primary', model: 'same-model', requestedModel: 'same-model', protocol: 'openai-chat', outcome: 'failed', status: 503 },
    {
      provider: 'backup', model: 'backup-model', requestedModel: 'backup-model',
      protocol: 'anthropic', outcome: 'succeeded', status: 200,
      usage: { input_tokens: 20, output_tokens: 10 },
    },
  ],
  bounds: providerBound.attempts,
  inference: inferenceFixture,
  sponsor: 'reader',
  markupMicros: 1_250_000,
  usageRateMicros: 10_000,
})
assert.deepEqual(fallbackAccounting.attempts.map(({ provider, measurementStatus, providerCostMicros }) =>
  ({ provider, measurementStatus, providerCostMicros })), [
  { provider: 'primary', measurementStatus: 'estimated', providerCostMicros: providerBound.attempts[0].maxCostMicros },
  { provider: 'backup', measurementStatus: 'measured', providerCostMicros: 160 },
])
assert.equal(fallbackAccounting.providerCostMicros, providerBound.attempts[0].maxCostMicros + 160)
assert.equal(
  fallbackAccounting.customerCostMicros,
  customerCostMicros(providerBound.attempts[0].maxCostMicros, 1_250_000) + customerCostMicros(160, 1_250_000),
)
assert.equal(
  fallbackAccounting.customerUnitsMicros,
  unitsForCost(customerCostMicros(providerBound.attempts[0].maxCostMicros, 1_250_000), 10_000) +
    unitsForCost(customerCostMicros(160, 1_250_000), 10_000),
  'fallback attempts are charged as separate units and both fit under the aggregate reservation',
)
const maxFallbackUnits = providerBound.attempts.reduce((sum, attempt) =>
  sum + unitsForCost(customerCostMicros(attempt.maxCostMicros, 1_250_000), 10_000), 0)
assert.ok(fallbackAccounting.customerUnitsMicros <= maxFallbackUnits)
assert.equal(fallbackAccounting.measurementStatus, 'estimated')
const siteFundedAccounting = billableInferenceAttempts({
  attempts: [{
    provider: 'backup', model: 'backup-model', requestedModel: 'backup-model',
    protocol: 'anthropic', outcome: 'succeeded', status: 200,
    usage: { input_tokens: 20, output_tokens: 10 },
  }],
  bounds: providerBound.attempts,
  inference: inferenceFixture,
  sponsor: 'site',
})
assert.equal(siteFundedAccounting.providerCostMicros, 160)
assert.equal(siteFundedAccounting.customerUnitsMicros, 0, 'site-funded inference retains provider spend without reader units')
assert.equal(siteFundedAccounting.attempts[0].markupMicros, null)
const notSentAccounting = billableInferenceAttempts({
  attempts: [{
    provider: 'backup', model: 'backup-model', requestedModel: 'backup-model',
    protocol: 'anthropic', outcome: 'not_sent', status: null,
  }],
  bounds: providerBound.attempts,
  inference: inferenceFixture,
  sponsor: 'site',
})
assert.equal(notSentAccounting.providerCostMicros, 0)
assert.equal(notSentAccounting.attempts[0].measurementStatus, 'not_sent')
assert.throws(() => boundedInferenceUsage({
  messages: [{ role: 'user', content: 'Question' }], providers: configuredProviders.list,
  model: 'same-model', remainingCostMicros: 1,
}), /exceeds the remaining/)
assert.equal(customerCostMicros(160, 1_250_000), 200, 'customer markup is applied after provider cost measurement')
const topupEvents = []
const topupAttempts = new Map()
const topupGrants = new Set()
let topupPaymentCalls = 0
const topupPack = {
  key: 'abcdef12', sku: 'usage-pack', title: 'Usage pack', unit_amount: 500,
  currency: 'usd', units_micros: 25_000_000, unit: 'minute', rate_micros: 10_000,
  speech_cost_per_second_micros: 0,
}
const topupRunner = (paymentIntentCreate) => createUsageTopUp({
  config: { enabled: true, packs: [topupPack] },
  preference: async () => ({
    enabled: true, offer_key: topupPack.key, currency: topupPack.currency,
    off_session_consent_at: '2026-10-01T00:00:00.000Z',
  }),
  paymentMethod: async () => ({ customer: 'cus_1', paymentMethod: 'pm_1' }),
  begin: async (input) => {
    let attempt = topupAttempts.get(input.attemptRef)
    if (!attempt) {
      attempt = {
        attempt_ref: input.attemptRef,
        amount_minor: input.amountMinor,
        units_micros: input.unitsMicros,
        currency: input.currency,
        status: 'pending',
      }
      topupAttempts.set(input.attemptRef, attempt)
    }
    topupEvents.push({ type: 'begin', input })
    return { started: attempt.status === 'pending', attempt }
  },
  finish: async ({ attemptRef, status, paymentIntentId, error }) => {
    const attempt = topupAttempts.get(attemptRef)
    attempt.status = status
    attempt.stripe_payment_intent_id = paymentIntentId || attempt.stripe_payment_intent_id
    attempt.last_error = error
    topupEvents.push({ type: 'finish', attemptRef, status })
    return true
  },
  grant: async ({ sourceId }) => {
    const count = topupGrants.size
    topupGrants.add(sourceId)
    topupEvents.push({ type: 'grant', sourceId })
    return topupGrants.size > count
  },
  stripe: { paymentIntents: { create: async (...args) => { topupPaymentCalls++; return paymentIntentCreate(...args) }, retrieve: async (id) => ({ id, status: 'succeeded' }) } },
})
const disabledTopup = createUsageTopUp({
  config: { enabled: false, packs: [topupPack] },
  preference: async () => { throw new Error('disabled sites must not read a reader preference') },
})
assert.deepEqual(await disabledTopup({ userId: 'user-1', invocationRef: 'work-1' }), { granted: false, reason: 'topup_disabled' })
assert.deepEqual(await topupRunner(async () => { throw Object.assign(new Error('card declined'), { raw: { payment_intent: { id: 'pi_declined', status: 'requires_payment_method' } } }) })({
  userId: 'user-1', invocationRef: 'declined-work',
}), { granted: false, reason: 'topup_payment_failed' })
assert.equal(topupAttempts.get(topupEvents.find((event) => event.type === 'begin').input.attemptRef).status, 'failed')
const actionAttempt = await topupRunner(async () => { throw Object.assign(new Error('authentication required'), { raw: { payment_intent: { id: 'pi_action', status: 'requires_action' } } }) })({
  userId: 'user-1', invocationRef: 'action-work',
})
assert.deepEqual(actionAttempt, { granted: false, reason: 'topup_requires_action' })
assert.equal(topupGrants.size, 0, 'failed and action-required top-ups grant no units')
const successfulTopup = topupRunner(async (_params, options) => {
  assert.match(options.idempotencyKey, /^usage-topup:ut_[a-f0-9]{64}$/)
  return { id: 'pi_confirmed', status: 'succeeded' }
})
assert.equal((await successfulTopup({ userId: 'user-1', invocationRef: 'success-work' })).granted, true)
assert.equal((await successfulTopup({ userId: 'user-1', invocationRef: 'success-work' })).granted, true)
assert.equal(topupPaymentCalls, 3, 'one charge is created for each distinct declined, action-required, or successful attempt')
assert.equal(topupGrants.size, 1, 'replaying a confirmed payment grants the pack once')

let nonBotProviderCalls = 0
const operationPolicies = {
  'agent.staff': { mode: 'site-funded' },
  'agent.game': { mode: 'offer', offerKey: 'abcdef12' },
}
assert.deepEqual(resolveUsageOperation(operationPolicies, 'agent.staff'), {
  operationId: 'agent.staff', mode: 'site-funded', offerKey: null,
})
assert.deepEqual(resolveUsageOperation(operationPolicies, 'agent.game'), {
  operationId: 'agent.game', mode: 'offer', offerKey: 'abcdef12',
})
assert.throws(() => resolveUsageOperation(operationPolicies, 'agent.npc'), /has no site policy/)
const rejectedGate = createUsageGate({
  resolveOffer: async (key) => key === 'abcdef12' ? topupPack : null,
  reserve: async () => ({ admitted: false, reason: 'usage_balance_exhausted', remaining_micros: 0 }),
  autoTopUp: async () => ({ granted: false, reason: 'topup_disabled' }),
  settle: async () => { throw new Error('a refused invocation cannot settle') },
  release: async () => true,
})
const rejectedInvocation = await rejectedGate({
  userId: 'user-1', offerKey: resolveUsageOperation(operationPolicies, 'agent.game').offerKey,
  invocationRef: 'non-bot-denied', operationId: 'agent.game', markupMicros: 1_250_000,
  maxUnitsMicros: 1_000_000,
})
if (rejectedInvocation.admitted) nonBotProviderCalls++
assert.deepEqual(rejectedInvocation, { admitted: false, reason: 'usage_balance_exhausted', remainingMicros: 0 })
assert.equal(nonBotProviderCalls, 0, 'the generic gate refuses a non-bot invocation before its provider runs')
let reservationClosed = ''
const allowedGate = createUsageGate({
  resolveOffer: async () => topupPack,
  reserve: async () => ({ admitted: true, mode: 'prepaid', remaining_micros: 3_000_000 }),
  autoTopUp: async () => ({ granted: false, reason: 'topup_disabled' }),
  settle: async ({ invocationRef, costMicros, unitsMicros, botId, operationId, markupMicros, measurementStatus }) => {
    reservationClosed = invocationRef
    return { admitted: true, costMicros, unitsMicros, botId, operationId, markupMicros, measurementStatus }
  },
  release: async () => true,
})
const allowedInvocation = await allowedGate({
  userId: 'user-1', offerKey: 'abcdef12', invocationRef: 'non-bot-allowed',
  operationId: 'agent.game', markupMicros: 1_250_000,
  maxUnitsMicros: 1_000_000,
})
assert.equal(allowedInvocation.admitted, true, 'a non-bot operation can use the common gate')
nonBotProviderCalls++
assert.deepEqual(await allowedInvocation.settle({
  kind: 'model', costMicros: 12, unitsMicros: 400_000, customerCostMicros: 15,
  retailValueMicros: 20, retailCurrency: 'usd', measurementStatus: 'estimated',
}), {
  admitted: true, costMicros: 12, unitsMicros: 400_000, botId: null,
  operationId: 'agent.game', markupMicros: 1_250_000, measurementStatus: 'estimated',
})
assert.equal(reservationClosed, 'non-bot-allowed', 'settlement uses the verified invocation reference')
assert.equal(nonBotProviderCalls, 1, 'the provider runs only after successful generic authorization')

const boundedModel = boundedModelUsage({
  messages: [{ role: 'user', content: 'hello' }],
  prices: [{ in: 3, out: 15 }, { in: 15, out: 75 }],
  remainingCostMicros: 100_000,
})
assert.ok(boundedModel.maxOutputTokens <= 4096 && boundedModel.maxOutputTokens > 0)
assert.ok(boundedModel.maxCostMicros <= 100_000, 'the authorization maximum stays within the run spend ceiling')
assert.throws(() => boundedModelUsage({
  messages: [{ role: 'user', content: 'hello' }],
  prices: [{}],
  remainingCostMicros: 100_000,
}), /no known input and output price/, 'unknown provider costs fail closed before the provider call')
assert.throws(() => boundedModelUsage({
  messages: [{ role: 'user', content: 'a request too large for the remaining budget' }],
  prices: [{ in: 3, out: 15 }],
  remainingCostMicros: 100,
}), /remaining run spend limit/, 'a request that cannot fit the run budget is refused before work')

let availableStreamUnits = 1_000_000
let streamProviderCalls = 0
const streamGate = createUsageGate({
  resolveOffer: async () => topupPack,
  reserve: async ({ maxUnitsMicros }) => {
    if (availableStreamUnits < maxUnitsMicros) {
      return { admitted: false, reason: 'usage_balance_exhausted', remaining_micros: availableStreamUnits }
    }
    availableStreamUnits -= maxUnitsMicros
    return { admitted: true, mode: 'prepaid', remaining_micros: availableStreamUnits }
  },
  autoTopUp: async () => ({ granted: false, reason: 'topup_disabled' }),
  settle: async ({ invocationRef, unitsMicros }) => ({ admitted: true, invocationRef, unitsMicros }),
  release: async () => true,
})
for (const invocationRef of ['stream:chunk-1', 'stream:chunk-2']) {
  const chunk = await streamGate({
    userId: 'user-1', offerKey: 'abcdef12', invocationRef, maxUnitsMicros: 1_000_000,
  })
  if (!chunk.admitted) {
    assert.equal(invocationRef, 'stream:chunk-2')
    assert.equal(chunk.reason, 'usage_balance_exhausted')
    break
  }
  streamProviderCalls++
  await chunk.settle({ kind: 'model', costMicros: 10, unitsMicros: 1_000_000 })
}
assert.equal(streamProviderCalls, 1, 'a bounded stream stops before provider work after the next reservation is denied')

let gateTopUpCalls = 0
let gateReserveCalls = 0
const refilledGate = createUsageGate({
  resolveOffer: async () => topupPack,
  reserve: async () => ++gateReserveCalls === 1
    ? { admitted: false, reason: 'usage_balance_exhausted', remaining_micros: 0 }
    : { admitted: true, mode: 'prepaid', remaining_micros: 24_000_000 },
  autoTopUp: async () => { gateTopUpCalls++; return { granted: true } },
  settle: async () => true,
  release: async () => true,
})
const refilledInvocation = await refilledGate({
  userId: 'user-1', offerKey: 'abcdef12', invocationRef: 'refilled-work',
  maxUnitsMicros: 1_000_000,
})
assert.equal(refilledInvocation.admitted, true, 'a confirmed top-up is followed by a fresh reservation')
assert.equal(gateTopUpCalls, 1)
assert.equal(gateReserveCalls, 2)

const pack = compileUsage('pack.md', {
  unit: 'minute',
  rate: 0.01,
  grant: 25,
  speechCostPerSecond: 0.0002,
}, 'once', fail)
assert.deepEqual(pack, {
  unit: 'minute',
  rate_micros: 10_000,
  speech_cost_per_second_micros: 200,
  grant_micros: 25_000_000,
})

const metered = compileUsage('metered.md', {
  unit: 'minute',
  rate: 0.02,
  included: 100,
  meter: 'assistant_usage',
  overagePrice: 0.03,
}, 'subscription', fail)
assert.deepEqual(metered, {
  unit: 'minute',
  rate_micros: 20_000,
  meter: 'assistant_usage',
  included_micros: 100_000_000,
  overage_price_micros: 30_000,
})
assert.equal(meterUnitAmountDecimal(30_000, 'usd'), '0.000003')
assert.equal(meterUnitAmountDecimal(30_000, 'jpy'), '0.00000003')
assert.equal(compileUsage('legacy.md', undefined, 'once', fail), null)
assert.equal(unitsForCost(20_000, 20_000), 1_000_000)
assert.equal(unitsForCost(1, 20_000), 50)
assert.equal(unitsForCost(0, 20_000), 0)
assert.throws(() => unitsForCost(-1, 20_000), /cost and rate/)
assert.equal(pcmSecondsMicros(48_000, 24_000), 1_000_000)
assert.equal(pcmSecondsMicros(96_000, 24_000, 2), 1_000_000)
assert.equal(speechCostMicros(1_000_000, 200), 200)
assert.deepEqual(speechUsageRecord({
  bot: 'voice-helper', subject: 'user-1', room: 'cp_1',
  usage: { offer_key: 'abcdef12', rate_micros: 10_000, speech_cost_per_second_micros: 200, metered: true },
}, 'tts:1', 48_000, 24_000, false), {
  source_ref: 'tts:1', user_id: 'user-1', bot_id: 'voice-helper', offer_key: 'abcdef12',
  kind: 'tts', cost_micros: 200, seconds_micros: 1_000_000, units_micros: 20_000,
  metered: false, usage_unit: null, rate_micros: 10_000, meter: null, overage_price_micros: null,
  speech_cost_per_second_micros: 200,
})
const sttGrant = {
  bot: 'voice-helper', subject: 'user-1', room: 'cp_1',
  usage: {
    offer_key: 'abcdef12', unit: 'minute', rate_micros: 10_000,
    speech_cost_per_second_micros: 200, meter: 'assistant_usage',
    overage_price_micros: 30_000,
  },
}
const sttRecord = speechTelemetryRecord(sttGrant, 'segment-1', 2_500_000)
assert.deepEqual(sttRecord, {
  source_ref: 'copilot-stt:cp_1:segment-1', user_id: 'user-1', bot_id: 'voice-helper',
  offer_key: 'abcdef12', kind: 'stt', cost_micros: 0, seconds_micros: 2_500_000,
  units_micros: 0, metered: false, usage_unit: 'minute', rate_micros: 10_000,
  meter: null, overage_price_micros: null, speech_cost_per_second_micros: 200,
})
assert.equal(speechTelemetryRecord(sttGrant, 'segment-1', 2_500_000).source_ref, sttRecord.source_ref,
  'replaying an STT segment preserves its idempotency reference')
assert.equal(speechTelemetryRecord(sttGrant, 'empty', 0), null, 'empty recognition intervals do not create usage rows')
assert.throws(() => speechTelemetryRecord(sttGrant, 'invalid', -1), /non-negative safe integer seconds/)

const speechCalls = []
const storedSpeech = new Map()
let speechRpcCalls = 0
let speechAuthorized = false
const speechGate = createUsageGate({
  resolveOffer: async () => topupPack,
  reserve: async ({ maxUnitsMicros }) => {
    speechAuthorized = true
    assert.ok(maxUnitsMicros > 20_000, 'reserve covers the bounded TTS duration before the provider call')
    return { admitted: true, mode: 'prepaid', remaining_micros: 1_000_000 }
  },
  autoTopUp: async () => ({ granted: false, reason: 'topup_disabled' }),
  settle: async ({ invocationRef, kind, costMicros, secondsMicros, unitsMicros }) => {
    speechRpcCalls++
    if (!storedSpeech.has(invocationRef)) storedSpeech.set(invocationRef, {
      source_ref: invocationRef, kind, cost_micros: costMicros,
      seconds_micros: secondsMicros, units_micros: unitsMicros,
    })
    if (speechRpcCalls === 1) throw new Error('write committed but acknowledgement was lost')
    return { admitted: true, duplicate: true }
  },
  release: async () => true,
})
const speechHandler = createSpeechHandler({
  service: 'test-secret',
  url: 'https://speech.example/v1',
  key: 'endpoint-secret',
  cors: {},
  json: (body, status = 200) => Response.json(body, { status }),
  open: async () => ({
    bot: 'voice-helper', subject: 'user-1', room: 'cp_1', minutes: 10,
    usage: { offer_key: 'abcdef12', rate_micros: 10_000, speech_cost_per_second_micros: 200, metered: true },
  }),
  authorizeUsage: speechGate,
  newId: () => 'segment-1',
  fetchImpl: async (_url, init) => {
    assert.equal(speechAuthorized, true, 'the shared usage gate admits work before speech is sent upstream')
    speechCalls.push(JSON.parse(init.body))
    return new Response(new Uint8Array(48_000), {
      headers: { 'content-type': 'audio/pcm', 'x-audio-rate': '24000' },
    })
  },
  onUsageError: (error) => { throw error },
})
const speechResponse = await speechHandler(new Request('https://site.example/copilot-speak', {
  method: 'POST',
  headers: { authorization: 'Bearer signed-grant', 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'hello', format: 'mp3' }),
}))
assert.equal(speechResponse.status, 200)
assert.equal((await speechResponse.arrayBuffer()).byteLength, 48_000)
assert.equal(speechCalls[0].response_format, 'pcm', 'billable endpoint audio uses a measurable PCM format')
assert.equal(speechRpcCalls, 2, 'an uncertain ledger acknowledgement is retried with the same source reference')
assert.equal(storedSpeech.size, 1, 'retrying usage persistence does not duplicate an endpoint TTS event')
assert.equal([...storedSpeech.values()][0].seconds_micros, 1_000_000)
assert.equal([...storedSpeech.values()][0].cost_micros, 200)
assert.equal([...storedSpeech.values()][0].units_micros, 20_000)

let refusedProviderCalls = 0
const refusedSpeech = createSpeechHandler({
  service: 'test-secret', url: 'https://speech.example/v1', key: 'endpoint-secret',
  cors: {}, json: (body, status = 200) => Response.json(body, { status }),
  open: async () => ({
    bot: 'voice-helper', subject: 'user-1', room: 'cp_1',
    usage: { offer_key: 'abcdef12', rate_micros: 10_000, speech_cost_per_second_micros: 200 },
  }),
  authorizeUsage: async () => ({ admitted: false, reason: 'usage_balance_exhausted' }),
  fetchImpl: async () => { refusedProviderCalls++; return new Response('') },
})
const refusedResponse = await refusedSpeech(new Request('https://site.example/copilot-speak', {
  method: 'POST', headers: { authorization: 'Bearer signed-grant', 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'hello' }),
}))
assert.equal(refusedResponse.status, 402)
assert.equal(refusedProviderCalls, 0, 'usage refusal reaches no paid speech endpoint')
let fallbackAuthorizations = 0
let fallbackProviderCalls = 0
const fallbackSpeech = createSpeechHandler({
  service: 'test-secret', url: '', key: '',
  cors: {}, json: (body, status = 200) => Response.json(body, { status }),
  open: async () => ({
    bot: 'voice-helper', subject: 'user-1', room: 'cp_1',
    usage: { offer_key: 'abcdef12', rate_micros: 10_000, speech_cost_per_second_micros: 200 },
  }),
  authorizeUsage: async () => { fallbackAuthorizations++; return { admitted: true } },
  fetchImpl: async () => { fallbackProviderCalls++; return new Response('') },
})
const fallbackResponse = await fallbackSpeech(new Request('https://site.example/copilot-speak', {
  method: 'POST', headers: { authorization: '******', 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'hello' }),
}))
assert.equal(fallbackResponse.status, 503, 'an unconfigured endpoint signals the browser voice fallback')
assert.equal(fallbackAuthorizations, 0, 'browser speech fallback reserves no endpoint usage')
assert.equal(fallbackProviderCalls, 0, 'browser speech fallback makes no endpoint call')
let interruptedSpeech = null
const interruptedHandler = createSpeechHandler({
  service: 'test-secret', url: 'https://speech.example/v1', key: 'endpoint-secret',
  cors: {}, json: (body, status = 200) => Response.json(body, { status }),
  open: async () => ({
    bot: 'voice-helper', subject: 'user-1', room: 'cp_1',
    usage: { offer_key: 'abcdef12', rate_micros: 10_000, speech_cost_per_second_micros: 200 },
  }),
  authorizeUsage: async () => ({
    admitted: true, mode: 'prepaid',
    settle: async (measurement) => { interruptedSpeech = measurement; return { admitted: true } },
    release: async () => true,
  }),
  newId: () => 'interrupted-segment',
  fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(24_000)) },
  }), { headers: { 'content-type': 'audio/pcm', 'x-audio-rate': '24000' } }),
})
const interruptedResponse = await interruptedHandler(new Request('https://site.example/copilot-speak', {
  method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'hello' }),
}))
const interruptedReader = interruptedResponse.body.getReader()
assert.equal((await interruptedReader.read()).value.byteLength, 24_000)
await interruptedReader.cancel('reader left the conversation')
assert.equal(interruptedSpeech?.kind, 'tts', 'an interrupted endpoint stream still settles its observed work')
assert.equal(interruptedSpeech?.secondsMicros, 500_000, 'interruption records only the PCM bytes delivered')
assert.equal(interruptedSpeech?.costMicros, 100, 'the site retains the cost of interrupted endpoint audio')
assert.equal(interruptedSpeech?.unitsMicros, 0, 'interrupted endpoint audio is not billed to the reader')
const meteredOffer = { sku: 'metered', usage: metered }
assert.deepEqual(meteredCheckoutLine(meteredOffer, 'price_usage'), { price: 'price_usage', quantity: 1 })
assert.equal(meteredCheckoutLine({ sku: 'legacy' }, null), null)
assert.throws(() => meteredCheckoutLine(meteredOffer, null), /no reconciled Stripe usage price/)
assert.deepEqual(usageStripeMetadata(meteredOffer, { key: 'abcdef12', sku: 'metered' }), {
  key: 'abcdef12', sku: 'metered', usage: 'metered', usage_offer_key: 'abcdef12',
  usage_meter: 'assistant_usage', usage_unit: 'minute', usage_rate_micros: '20000',
  usage_included_micros: '100000000', usage_overage_price_micros: '30000',
  usage_speech_cost_per_second_micros: '0',
})
const usageSubscriptionSnapshot = {
  user_id: 'user-1', key: 'abcdef12', usage_meter: 'assistant_usage',
  usage_included_micros: 100_000_000,
}
const usageInvoice = { id: 'in_cycle_1', billing_reason: 'subscription_cycle' }
assert.deepEqual(includedGrantForInvoice(usageSubscriptionSnapshot, usageInvoice, '2026-10-01', '2026-11-01'), {
  user_id: 'user-1', offer_key: 'abcdef12', source: 'subscription', source_id: 'invoice:in_cycle_1',
  units_micros: 100_000_000, period_start: '2026-10-01', expires_at: '2026-11-01',
  usage_unit: null, rate_micros: null, speech_cost_per_second_micros: 0,
  meter: 'assistant_usage', overage_price_micros: null,
})
assert.equal(includedGrantForInvoice(
  { ...usageSubscriptionSnapshot, key: 'renamed-offer', usage_included_micros: 999 },
  usageInvoice, '2026-10-01', '2026-11-01',
  { usage: 'metered', usage_offer_key: 'abcdef12', usage_meter: 'assistant_usage', usage_included_micros: '100000000' },
)?.offer_key, 'abcdef12', 'invoice grants use Stripe price snapshots, not the current offer name or allowance')
assert.equal(
  includedGrantForInvoice(usageSubscriptionSnapshot, usageInvoice, '2026-10-01', '2026-11-01').source_id,
  includedGrantForInvoice(usageSubscriptionSnapshot, usageInvoice, '2026-10-01', '2026-11-01').source_id,
  'replaying the same Stripe invoice preserves its idempotency reference',
)
assert.equal(includedGrantForInvoice(usageSubscriptionSnapshot, { ...usageInvoice, billing_reason: 'subscription_update' }, '2026-10-01', '2026-11-01'), null)

const eventCalls = []
const acceptedEvents = new Map()
const eventStripe = { billing: { meterEvents: { async create(params, options) {
  eventCalls.push({ params, options })
  if (!acceptedEvents.has(params.identifier)) acceptedEvents.set(params.identifier, Number(params.payload.value))
  return { identifier: params.identifier }
} } } }
await sendUsageMeterEvent(eventStripe, {
  identifier: 'us_stable',
  event_name: 'assistant_usage',
  stripe_customer_id: 'cus_123',
  value_micros: 1_250_000,
  created_at: '2026-10-11T12:00:00.000Z',
})
await sendUsageMeterEvent(eventStripe, {
  identifier: 'us_stable',
  event_name: 'assistant_usage',
  stripe_customer_id: 'cus_123',
  value_micros: 1_250_000,
  created_at: '2026-10-11T12:00:00.000Z',
})
assert.equal(eventCalls[0].params.event_name, 'assistant_usage')
assert.equal(eventCalls[1].params.identifier, eventCalls[0].params.identifier)
assert.equal(eventCalls[1].options.idempotencyKey, eventCalls[0].options.idempotencyKey)
assert.equal(eventCalls[0].params.identifier, 'us_stable')
assert.deepEqual(eventCalls[0].params.payload, { stripe_customer_id: 'cus_123', value: '1250000' })
assert.equal(eventCalls[0].params.timestamp, Date.parse('2026-10-11T12:00:00.000Z') / 1000)
assert.deepEqual(eventCalls[0].options, { idempotencyKey: 'usage-meter-event:us_stable' })
assert.equal([...acceptedEvents.values()].reduce((sum, value) => sum + value, 0), 1_250_000)

const errors = []
compileUsage('bad.md', { unit: 'minute', rate: 0.01, grant: 1 }, 'subscription', (message) => errors.push(message))
assert.equal(errors.length, 3)
assert.equal(compileUsage('meter-limit.md', {
  unit: 'minute',
  rate: 0.01,
  meter: 'a'.repeat(100),
  included: 0,
  overagePrice: 0.01,
}, 'subscription', fail).meter.length, 100)
const invalidMeterErrors = []
compileUsage('meter-too-long.md', {
  unit: 'minute',
  rate: 0.01,
  meter: 'a'.repeat(101),
  included: 0,
  overagePrice: 0.01,
}, 'subscription', (message) => invalidMeterErrors.push(message))
assert.equal(invalidMeterErrors.length, 1)

function stripeMock() {
  const state = {
    meters: [],
    prices: [],
    meterCreates: [],
    priceCreates: [],
    priceUpdates: [],
  }
  const stripe = {
    billing: {
      meters: {
        async list() { return { data: state.meters, has_more: false } },
        async create(params, options) {
          state.meterCreates.push({ params, options })
          const meter = { id: `mtr_${state.meterCreates.length}`, status: 'active', ...params }
          state.meters.push(meter)
          return meter
        },
      },
    },
    prices: {
      async list({ lookup_keys }) {
        return { data: state.prices.filter((price) => price.active && lookup_keys.includes(price.lookup_key)) }
      },
      async create(params, options) {
        state.priceCreates.push({ params, options })
        const price = {
          id: `price_${state.priceCreates.length}`,
          active: true,
          type: 'recurring',
          billing_scheme: 'per_unit',
          product: params.product,
          currency: params.currency,
          lookup_key: params.lookup_key,
          unit_amount_decimal: params.unit_amount_decimal,
          recurring: params.recurring,
          ...params,
        }
        state.prices.push(price)
        return price
      },
      async update(id, params) {
        state.priceUpdates.push({ id, params })
        const price = state.prices.find((item) => item.id === id)
        Object.assign(price, params)
        return price
      },
    },
  }
  return { stripe, state }
}

const usageOffer = {
  sku: 'usage-plan',
  key: 'abcdef12',
  title: 'Usage plan',
  billing: 'subscription',
  period: 'monthly',
  currency: 'usd',
  usage: {
    unit: 'minute', meter: 'assistant_usage', rate_micros: 20_000,
    included_micros: 0, overage_price_micros: 30_000,
  },
}
const { stripe, state: stripeState } = stripeMock()
const firstUsageSync = await ensureUsageBilling(stripe, usageOffer, 'prod_usage', { key: usageOffer.key, sku: usageOffer.sku })
assert.deepEqual(firstUsageSync, { price: 'price_1', meter: 'mtr_1', made: true })
assert.equal(stripeState.meterCreates.length, 1)
assert.deepEqual(stripeState.meterCreates[0].params.default_aggregation, { formula: 'sum' })
assert.deepEqual(stripeState.meterCreates[0].params.customer_mapping, { type: 'by_id', event_payload_key: 'stripe_customer_id' })
assert.equal(stripeState.meterCreates[0].options.idempotencyKey, 'usage-meter:assistant_usage')
assert.equal(stripeState.priceCreates[0].params.unit_amount_decimal, '0.000003')
assert.equal(stripeState.priceCreates[0].params.recurring.meter, 'mtr_1')
assert.equal(stripeState.priceCreates[0].params.lookup_key, 'abcdef12_usage')
assert.equal(stripeState.priceCreates[0].params.metadata.key, usageOffer.key)
assert.equal(stripeState.priceCreates[0].params.metadata.usage_offer_key, usageOffer.key)
assert.equal(stripeState.priceCreates[0].params.metadata.usage_meter, usageOffer.usage.meter)
assert.equal(stripeState.priceCreates[0].params.metadata.usage_rate_micros, '20000')
assert.equal(stripeState.priceCreates[0].options.idempotencyKey, 'usage-price:abcdef12:mtr_1:usd:0.000003:monthly:minute:20000:0:0')
assert.deepEqual(await ensureUsageBilling(stripe, usageOffer, 'prod_usage', { key: usageOffer.key, sku: usageOffer.sku }), {
  price: 'price_1',
  meter: 'mtr_1',
  made: false,
})
assert.equal(stripeState.meterCreates.length, 1)
assert.equal(stripeState.priceCreates.length, 1)
const repriced = await ensureUsageBilling(stripe, {
  ...usageOffer,
  usage: { ...usageOffer.usage, overage_price_micros: 60_000 },
}, 'prod_usage', { key: usageOffer.key, sku: usageOffer.sku })
assert.equal(repriced.price, 'price_2')
assert.equal(repriced.made, true)
assert.equal(stripeState.priceCreates[1].params.unit_amount_decimal, '0.000006')
assert.deepEqual(stripeState.priceUpdates, [{ id: 'price_1', params: { active: false } }])
const revisedRate = await ensureUsageBilling(stripe, {
  ...usageOffer,
  usage: { ...usageOffer.usage, rate_micros: 40_000 },
}, 'prod_usage', { key: usageOffer.key, sku: usageOffer.sku })
assert.equal(revisedRate.made, true)
assert.equal(stripeState.priceCreates[2].params.metadata.usage_rate_micros, '40000')
assert.equal(stripeState.priceUpdates.at(-1).params.active, false)
assert.equal(await ensureUsageBilling(stripe, { ...usageOffer, billing: 'once' }, 'prod_usage', {}), null)

const root = await mkdtemp(join(tmpdir(), 'platformkit-usage-'))
try {
  const dir = join(root, 'content/store/products')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'legacy.md'), `---
title: Legacy offer
sku: legacy-offer
key: abcdef01
kind: form
billing: once
price: 4
---
Legacy offer
`)
  await writeFile(join(dir, 'pack.md'), `---
title: Usage pack
sku: usage-pack
key: abcdef02
kind: form
billing: once
price: 5
usage:
  unit: minute
  rate: 0.01
  grant: 25
---
Usage pack
`)
  await writeFile(join(dir, 'metered-plan.md'), `---
title: Metered plan
sku: metered-plan
key: abcdef03
kind: form
billing: subscription
period: monthly
price: 0
usage:
  unit: minute
  rate: 0.02
  included: 100
  meter: assistant_usage
  overagePrice: 0.03
---
Metered plan
`)
  const inferenceSite = {
    inference: {
      providers: [{
        id: 'fixture-provider', protocol: 'openai-chat', secret: 'env:FIXTURE_PROVIDER_KEY', model: 'fixture-model',
        models: { 'fixture-model': { inputPerMillionUsd: 1, outputPerMillionUsd: 2 } },
      }],
      markup: { default: 1.25 },
    },
    usage: { operations: { 'agent.game': { mode: 'offer', offerKey: 'abcdef02' } } },
  }
  const catalog = await compileCatalog({ store: asStore(root), root, site: inferenceSite })
  assert.equal(JSON.stringify(catalog).includes('fixture-provider'), false, 'server-only provider config is absent from the public function catalog')
  assert.equal(JSON.stringify(catalog).includes('FIXTURE_PROVIDER_KEY'), false, 'deployment secret references are absent from the catalog')
  assert.deepEqual(catalog.offers['legacy-offer'], {
    sku: 'legacy-offer',
    key: 'abcdef01',
    title: 'Legacy offer',
    kind: 'form',
    billing: 'once',
    period: null,
    unit_amount: 400,
    currency: 'usd',
    tier: null,
    rank: null,
    book: null,
  })
  assert.deepEqual(catalog.offers['usage-pack'].usage, {
    unit: 'minute',
    rate_micros: 10_000,
    grant_micros: 25_000_000,
  })
  assert.deepEqual(catalog.offers['metered-plan'].usage, {
    unit: 'minute',
    rate_micros: 20_000,
    meter: 'assistant_usage',
    included_micros: 100_000_000,
    overage_price_micros: 30_000,
  })
  assert.equal(catalog.offers['metered-plan'].unit_amount, 0)
  const topupCatalog = await compileCatalog({
    store: asStore(root), root,
    site: { usage: { autoTopUp: { enabled: true, packKeys: ['abcdef02'] } } },
  })
  assert.deepEqual(topupCatalog.usage_auto_topup, {
    enabled: true,
    currency: 'usd',
    packs: [{
      key: 'abcdef02', sku: 'usage-pack', title: 'Usage pack', unit_amount: 500,
      currency: 'usd', units_micros: 25_000_000, unit: 'minute',
      rate_micros: 10_000, speech_cost_per_second_micros: 0,
    }],
  })
  assert.equal(
    (await compileCatalog({ store: asStore(root), root, site: { usage: { autoTopUp: { enabled: false, packKeys: ['abcdef02'] } } } })).usage_auto_topup.enabled,
    false,
    'the catalog preserves an explicit site disable for published Cloud-mode artifacts',
  )
  assert.deepEqual(usageOf({}), { autoTopUp: { enabled: false, packKeys: [] } })
  assert.throws(() => usageOf({ usage: { autoTopUp: { enabled: true, packKeys: ['usage-pack'] } } }), /stable eight-character offer keys/)
  assert.deepEqual(usageOf({ usage: { operations: {
    'agent.staff': { mode: 'site-funded' },
    'agent.game': { mode: 'offer', offerKey: 'abcdef12', markup: 1.5 },
    'speech.preview': { mode: 'offer', offerKey: 'abcdef13' },
  } } }).operations, {
    'agent.staff': { mode: 'site-funded' },
    'agent.game': { mode: 'offer', offerKey: 'abcdef12', markup_micros: 1_500_000 },
    'speech.preview': { mode: 'offer', offerKey: 'abcdef13' },
  })
  assert.throws(() => usageOf({ usage: { operations: { 'agent.bad': { mode: 'free' } } } }), /site-funded or offer/)
  await assert.rejects(
    () => compileCatalog({ store: asStore(root), root, site: { usage: { autoTopUp: { enabled: true, packKeys: ['abcdef03'] } } } }),
    /automatic top-up requires a one-time offer that grants usage units/,
  )
  assert.deepEqual(surfaces(root).offers.find((offer) => offer.sku === 'metered-plan'), {
    sku: 'metered-plan',
    key: 'abcdef03',
    kind: 'form',
    usage: { unit: 'minute', meter: 'assistant_usage', overagePrice: 0.03 },
  })
  await mkdir(join(root, 'content/bots'), { recursive: true })
  await writeFile(join(root, 'content/bots/usage-helper.md'), `---
name: Usage helper
billing: abcdef02
---
Answer plainly.
`)
  const compiledBots = await readBots(asStore(root), { tools: {}, skills: {}, sealed: new Set() })
  assert.equal(compiledBots.bots[0].billing, 'abcdef02')
  assert.deepEqual(compiledBots.faults, [])
  await writeFile(join(dir, 'metered-plan-copy.md'), `---
title: Another metered plan
sku: metered-plan-copy
key: abcdef04
kind: form
billing: subscription
period: monthly
price: 5
usage:
  unit: minute
  rate: 0.02
  included: 100
  meter: assistant_usage
  overagePrice: 0.03
---
Another metered plan
`)
  await assert.rejects(() => compileCatalog({ store: asStore(root), root }), /each metered offer needs its own meter event/)
  await rm(join(dir, 'metered-plan-copy.md'))
  const priceDir = join(root, 'content/store/prices')
  await mkdir(priceDir, { recursive: true })
  await writeFile(join(priceDir, 'alternate.md'), `---
title: Alternate currency
currency: eur
prices:
  - sku: metered-plan
    amount: 2
---
`)
  await assert.rejects(() => compileCatalog({ store: asStore(root), root }), /cannot have an alternate currency/)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('✔ usage offers: schema normalization, Stripe meter reconciliation, and legacy catalog shape')

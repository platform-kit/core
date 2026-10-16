import assert from 'node:assert/strict'
import { loadOwnedIncrementalSettlement } from '../supabase/functions/_shared/usage-incremental-recovery.mjs'

const subscription = { id: 'sub_owner', key: 'offer_member', user_id: 'user_owner' }
const settlement = {
  subscription_id: 'sub_owner',
  period_start: '2026-10-01T00:00:00.000Z',
  settlement_key: 'threshold:1',
  provider: 'hyperswitch',
  status: 'requires_action',
  payment_intent_id: 'pay_action',
}

function adminFor({ subscriptions = [subscription], settlements = [settlement], errorTable } = {}) {
  const queries = []
  return {
    queries,
    admin: {
      from(table) {
        const filters = {}
        const query = {
          select() { return this },
          eq(column, value) { filters[column] = value; return this },
          async maybeSingle() {
            queries.push({ table, filters: { ...filters } })
            if (table === errorTable) return { data: null, error: { message: 'database unavailable' } }
            const rows = table === 'subscriptions' ? subscriptions : settlements
            const matches = rows.filter((row) =>
              Object.entries(filters).every(([column, value]) => row[column] === value))
            return { data: matches[0] ?? null, error: null }
          },
        }
        return query
      },
    },
  }
}

const input = {
  providerId: 'hyperswitch',
  userId: 'user_owner',
  subscriptionId: 'sub_owner',
  periodStart: '2026-10-01T00:00:00.000Z',
  settlementKey: 'threshold:1',
}

const ownerDb = adminFor()
assert.deepEqual(
  await loadOwnedIncrementalSettlement({ ...input, admin: ownerDb.admin }),
  { subscription, settlement },
)
assert.deepEqual(ownerDb.queries.map((query) => query.table), [
  'subscriptions',
  'usage_incremental_settlements',
])
assert.deepEqual(ownerDb.queries[1].filters, {
  provider: 'hyperswitch',
  subscription_id: 'sub_owner',
  period_start: '2026-10-01T00:00:00.000Z',
  settlement_key: 'threshold:1',
})

const otherUserDb = adminFor()
assert.deepEqual(
  await loadOwnedIncrementalSettlement({ ...input, userId: 'user_other', admin: otherUserDb.admin }),
  { subscription: null, settlement: null },
)
assert.deepEqual(otherUserDb.queries.map((query) => query.table), ['subscriptions'],
  'a user who does not own the subscription cannot load its settlement')

const otherProviderDb = adminFor()
const otherProvider = await loadOwnedIncrementalSettlement({
  ...input,
  providerId: 'stripe',
  admin: otherProviderDb.admin,
})
assert.equal(otherProvider.subscription.id, 'sub_owner')
assert.equal(otherProvider.settlement, null,
  'a provider cannot load another provider\'s settlement for the same subscription')

await assert.rejects(
  loadOwnedIncrementalSettlement({ ...input, admin: adminFor({ errorTable: 'subscriptions' }).admin }),
  /incremental usage subscription could not be verified: database unavailable/,
)
await assert.rejects(
  loadOwnedIncrementalSettlement({ ...input, admin: adminFor({ errorTable: 'usage_incremental_settlements' }).admin }),
  /incremental usage payment could not be loaded: database unavailable/,
)

console.log('usage incremental recovery: owner isolation, provider scope, missing rows, and surfaced query failures passed')

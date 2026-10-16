import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { localStack, loadDotEnv, serviceKey, supabaseUrl } from './tts/storage.mjs'

const note = (message) => console.log('payment-provider-db: ' + message)
const schema = readFileSync(new URL('../supabase/schemas/40-commerce.sql', import.meta.url), 'utf8')
const data = readFileSync(new URL('../supabase/data.sql', import.meta.url), 'utf8')
const webhook = readFileSync(new URL('../supabase/functions/stripe-webhook/index.ts', import.meta.url), 'utf8')
const providerWebhook = readFileSync(new URL('../supabase/functions/payment-provider-webhook/index.ts', import.meta.url), 'utf8')
const usageWorker = readFileSync(new URL('../supabase/functions/_shared/usage.ts', import.meta.url), 'utf8')
const functionConfig = readFileSync(new URL('../supabase/config.toml.template', import.meta.url), 'utf8')

assert.match(schema, /CREATE TABLE IF NOT EXISTS "public"\."payment_provider_refs"/)
assert.match(schema, /PRIMARY KEY \("provider", "object_type", "external_id", "entity_type", "entity_id"\)/)
assert.match(schema, /CREATE TABLE IF NOT EXISTS "public"\."payment_events"/)
assert.match(schema, /PRIMARY KEY \("provider", "event_id"\)/)
assert.match(schema, /CREATE TABLE IF NOT EXISTS "public"\."payment_subscription_renewals"/)
assert.match(schema, /ALTER TABLE "public"\."usage_events"[\s\S]*?ADD COLUMN IF NOT EXISTS "subscription_id" "text"/)
assert.match(schema, /FUNCTION "public"\."payment_subscription_renewal_claim"/)
assert.match(schema, /FUNCTION "public"\."payment_subscription_renewal_complete"/)
assert.match(schema, /FUNCTION "public"\."payment_subscription_renewal_failed"/)
assert.match(schema, /"subscription_id" "text"/)
assert.match(schema, /"checkout_identity" "text"/)
assert.match(schema, /purchases_checkout_identity_price_key/)
assert.match(data, /set checkout_identity = stripe_checkout_session_id/)
assert.match(webhook, /from\('payment_events'\)/)
assert.match(webhook, /\.eq\('provider', provider\.id\)\.eq\('event_id', event\.eventId\)/)
assert.doesNotMatch(webhook, /from\('stripe_events'\)/)
assert.doesNotMatch(webhook, /Stripe webhook does not match selected payment provider/)
assert.match(providerWebhook, /import '\.\.\/stripe-webhook\/index\.ts'/)
const renewalWorker = readFileSync(
  new URL('../supabase/functions/hyperswitch-subscription-renewal/index.ts', import.meta.url),
  'utf8',
)
assert.match(renewalWorker, /settleMeteredUsage/)
assert.match(renewalWorker, /subscription-usage:\$\{row\.subscription_id\}:/)
assert.match(usageWorker, /provider\.id === 'hyperswitch'[\s\S]*?deferred: true/)
assert.match(functionConfig, /\[functions\.payment-provider-webhook\][\s\S]*?verify_jwt = false/)
assert.ok(
  webhook.indexOf('provider.verifyWebhook(req)') < webhook.indexOf("admin.from('payment_events')"),
  'signature verification must complete before payment-event writes',
)
note('declared provider reference, event, and commerce identity namespaces')

loadDotEnv()
const url = supabaseUrl()
if (!url || !localStack()) {
  note('skipped database checks — local Supabase credentials are unavailable')
  process.exit(0)
}
try {
  if (!(await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok) {
    throw new Error('health check failed')
  }
} catch {
  note('skipped database checks — local Supabase is not running')
  process.exit(0)
}

const admin = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const { error: refsError } = await admin.from('payment_provider_refs').select('provider').limit(0)
const { error: eventsError } = await admin.from('payment_events').select('provider').limit(0)
const { error: purchasesError } = await admin.from('purchases').select('checkout_identity').limit(0)
if (refsError || eventsError || purchasesError) {
  note('skipped database checks — provider reference schema is not applied; run the local database reset')
  process.exit(0)
}

const suffix = crypto.randomUUID()
const providers = [`site-a-${suffix}`, `site-b-${suffix}`]
const externalId = `checkout-${suffix}`
const eventId = `event-${suffix}`
const priceId = `price-${suffix}`
const checkoutIdentities = providers.map((provider) => `${provider}:${externalId}`)
const refs = providers.map((provider, index) => ({
  provider,
  object_type: 'checkout',
  external_id: externalId,
  entity_type: 'purchases',
  entity_id: `purchase-${index}-${suffix}`,
}))

try {
  const writePurchase = (checkoutIdentity) => admin.rpc('purchase_write', {
    p: {
      checkout_identity: checkoutIdentity,
      price_id: priceId,
      amount_total: 100,
      currency: 'usd',
      status: 'paid',
      quantity: 1,
    },
  })
  const purchaseA = await writePurchase(checkoutIdentities[0])
  const replayA = await writePurchase(checkoutIdentities[0])
  const purchaseB = await writePurchase(checkoutIdentities[1])
  assert.equal(purchaseA.error, null, purchaseA.error?.message)
  assert.equal(replayA.error, null, replayA.error?.message)
  assert.equal(purchaseB.error, null, purchaseB.error?.message)
  assert.equal(replayA.data, purchaseA.data, 'same-provider checkout replay upserts its original purchase')
  assert.notEqual(purchaseB.data, purchaseA.data, 'same external checkout and price ids remain provider-isolated')

  const purchases = await admin.from('purchases').select('id, checkout_identity')
    .in('checkout_identity', checkoutIdentities)
  assert.equal(purchases.error, null, purchases.error?.message)
  assert.equal(purchases.data.length, 2, 'different provider identities retain independent purchases')

  const insertedRefs = await admin.from('payment_provider_refs').insert(refs)
  assert.equal(insertedRefs.error, null, insertedRefs.error?.message)
  const referenceRows = await admin.from('payment_provider_refs')
    .select('provider, external_id, entity_id')
    .in('provider', providers)
    .eq('object_type', 'checkout')
    .eq('external_id', externalId)
  assert.equal(referenceRows.error, null, referenceRows.error?.message)
  assert.deepEqual(new Set(referenceRows.data.map((row) => row.provider)), new Set(providers))
  for (const ref of refs) {
    const scoped = await admin.from('payment_provider_refs')
      .select('entity_id')
      .eq('provider', ref.provider)
      .eq('object_type', ref.object_type)
      .eq('external_id', ref.external_id)
      .eq('entity_type', ref.entity_type)
    assert.equal(scoped.error, null, scoped.error?.message)
    assert.deepEqual(scoped.data.map((row) => row.entity_id), [ref.entity_id])
  }

  const duplicateRef = await admin.from('payment_provider_refs').insert(refs[0])
  assert.equal(duplicateRef.error?.code, '23505', 'replaying the same reference link is rejected')

  const insertedEvents = await admin.from('payment_events').insert(providers.map((provider) => ({
    provider, event_id: eventId, type: 'checkout.completed',
  })))
  assert.equal(insertedEvents.error, null, insertedEvents.error?.message)
  const eventRows = await admin.from('payment_events')
    .select('provider, event_id')
    .in('provider', providers)
    .eq('event_id', eventId)
  assert.equal(eventRows.error, null, eventRows.error?.message)
  assert.equal(eventRows.data.length, 2, 'identical event ids are independent across providers')

  const duplicateEvent = await admin.from('payment_events').insert({
    provider: providers[0], event_id: eventId, type: 'checkout.completed',
  })
  assert.equal(duplicateEvent.error?.code, '23505', 'replaying an event from the same provider is rejected')
  note('provider-colliding references, event ids, and purchases are isolated; same-provider replays are idempotent')
} finally {
  const [refsCleanup, eventsCleanup, purchasesCleanup] = await Promise.all([
    admin.from('payment_provider_refs').delete().in('provider', providers),
    admin.from('payment_events').delete().in('provider', providers),
    admin.from('purchases').delete().in('checkout_identity', checkoutIdentities),
  ])
  assert.equal(refsCleanup.error, null, refsCleanup.error?.message)
  assert.equal(eventsCleanup.error, null, eventsCleanup.error?.message)
  assert.equal(purchasesCleanup.error, null, purchasesCleanup.error?.message)
}

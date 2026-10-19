import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  HYPERSWITCH_DEFAULT_CLIENT_URL,
  createHyperswitchApi,
  hyperswitchClientUrl,
  verifyHyperswitchWebhook,
} from '../supabase/functions/_shared/hyperswitch-api.mjs'
import { normalizePaymentEvent, PaymentProviderError } from '../supabase/functions/_shared/payment-provider.mjs'

const secrets = {
  HYPERSWITCH_BASE_URL: 'https://sandbox.hyperswitch.io',
  HYPERSWITCH_API_KEY: 'server-secret',
  HYPERSWITCH_PROFILE_ID: 'pro_test',
  HYPERSWITCH_PUBLISHABLE_KEY: 'pk_snd_test',
}
assert.equal(hyperswitchClientUrl(), HYPERSWITCH_DEFAULT_CLIENT_URL)
assert.equal(hyperswitchClientUrl('http://localhost:9050/'), 'http://localhost:9050')
for (const invalidClientUrl of [
  'http://sdk.example.test',
  'https://user:password@sdk.example.test',
  'https://sdk.example.test?v=1',
  'https://sdk.example.test/v1',
  'https://sdk.example.test',
]) {
  assert.throws(
    () => hyperswitchClientUrl(invalidClientUrl),
    (error) => error.code === 'hyperswitch_configuration_invalid',
  )
}
const configuration = { profileCapabilities: ['checkout.one-time', 'refunds'] }
const calls = []
const api = createHyperswitchApi(secrets, configuration, {
  fetch: async (url, init) => {
    calls.push({ url: String(url), init })
    return Response.json({ payment_id: 'pay_test', status: 'succeeded' })
  },
})
const payment = await api.request(
  'POST',
  '/v2/payments/create-intent',
  { amount_details: { order_amount: 2500, currency: 'USD' } },
  'payment:test',
)
assert.equal(payment.payment_id, 'pay_test')
assert.equal(calls[0].url, 'https://sandbox.hyperswitch.io/v2/payments/create-intent')
assert.equal(calls[0].init.headers.Authorization, 'api-key=server-secret')
assert.equal(calls[0].init.headers['api-key'], undefined)
assert.equal(calls[0].init.headers['x-profile-id'], 'pro_test')
assert.equal(calls[0].init.headers['Idempotency-Key'], 'payment:test')
assert.deepEqual(JSON.parse(calls[0].init.body), {
  amount_details: { order_amount: 2500, currency: 'USD' },
})

let attempt = 0
const retriedApi = createHyperswitchApi(secrets, configuration, {
  fetch: async (_url, init) => {
    attempt++
    assert.equal(init.headers['Idempotency-Key'], 'refund:stable')
    return attempt === 1
      ? Response.json({ message: 'temporary upstream failure' }, { status: 503 })
      : Response.json({ refund_id: 're_test' })
  },
})
assert.equal((await retriedApi.request(
  'POST',
  '/v2/refunds',
  { payment_id: 'pay_test' },
  'refund:stable',
)).refund_id, 're_test')
assert.equal(attempt, 2)

const malformedApi = createHyperswitchApi(secrets, configuration, {
  fetch: async () => new Response('not-json', { status: 200 }),
})
await assert.rejects(
  malformedApi.request('GET', '/v2/payments/pay_test/get-intent'),
  (error) => error instanceof PaymentProviderError && error.code === 'hyperswitch_invalid_response',
)
const rejectedApi = createHyperswitchApi(secrets, configuration, {
  fetch: async () => Response.json({ error_message: 'profile access denied' }, { status: 401 }),
})
await assert.rejects(
  rejectedApi.request('GET', '/v2/payments/pay_test/get-intent'),
  (error) => error instanceof PaymentProviderError && error.code === 'hyperswitch_request_failed' &&
    error.status === 401 && /profile access denied/.test(error.message),
)
await assert.rejects(
  api.request('GET', '//other.example/payments'),
  (error) => error instanceof PaymentProviderError && error.code === 'hyperswitch_path_invalid',
)
await assert.rejects(
  api.request('GET', '/v1/payments/pay_test'),
  (error) => error instanceof PaymentProviderError && error.code === 'hyperswitch_path_invalid',
)
let missingV2RouteCalls = 0
const missingV2RouteApi = createHyperswitchApi(secrets, configuration, {
  fetch: async (url) => {
    missingV2RouteCalls++
    assert.equal(String(url), 'https://sandbox.hyperswitch.io/v2/customers')
    return Response.json({ message: 'route not found' }, { status: 404 })
  },
})
await assert.rejects(
  missingV2RouteApi.request('POST', '/v2/customers', { email: 'buyer@example.test', name: 'Buyer' }),
  (error) => error instanceof PaymentProviderError &&
    error.code === 'hyperswitch_request_failed' && error.status === 404,
)
assert.equal(missingV2RouteCalls, 1)
let clientAuthorizedCall
const clientAuthorizedApi = createHyperswitchApi(secrets, configuration, {
  fetch: async (url, init) => {
    clientAuthorizedCall = { url: String(url), init }
    return Response.json({ id: 'pay_client' })
  },
})
await clientAuthorizedApi.requestWithClientSecret(
  'POST',
  '/v2/payments/pay_client/confirm-intent',
  { payment_method_data: {}, payment_method_type: 'card' },
  'payment:confirm',
  'pay_client_secret',
)
assert.equal(
  clientAuthorizedCall.init.headers.Authorization,
  'publishable-key=pk_snd_test,client-secret=pay_client_secret',
)
assert.equal(clientAuthorizedCall.init.headers['x-profile-id'], 'pro_test')

const signingKey = 'test-webhook-signing-key'
/* a delivery is dated now: an old one is refused (below) */
const SENT = new Date().toISOString()
const envelope = {
  merchant_id: 'merchant_test',
  event_id: 'evt_payment',
  event_type: 'payment_succeeded',
  timestamp: SENT,
  content: {
    type: 'payment_details',
    object: {
      payment_id: 'pay_test',
      customer_id: 'cus_test',
      amount: 2500,
      currency: 'USD',
      metadata: { platformkit_checkout: '1', user_id: 'user_test' },
    },
  },
}
const rawBody = JSON.stringify(envelope)
const signature = createHmac('sha512', signingKey).update(rawBody).digest('hex')
const validRequest = () => new Request('https://site.test/payment-provider-webhook', {
  method: 'POST',
  headers: { 'X-Webhook-Signature-512': signature },
  body: rawBody,
})
const verifyEnvelope = (value) => {
  const body = JSON.stringify(value)
  const digest = createHmac('sha512', signingKey).update(body).digest('hex')
  return verifyHyperswitchWebhook(new Request('https://site.test/payment-provider-webhook', {
    method: 'POST',
    headers: { 'X-Webhook-Signature-512': digest },
    body,
  }), signingKey)
}
const events = await verifyHyperswitchWebhook(validRequest(), signingKey)
assert.deepEqual(events, [{
  provider: 'hyperswitch',
  eventId: 'evt_payment',
  type: 'checkout.completed',
  occurredAt: Math.floor(Date.parse(envelope.timestamp) / 1000),
  customerId: 'cus_test',
  checkoutId: 'pay_test',
  paymentId: 'pay_test',
  amountMinor: 2500,
  currency: 'USD',
  metadata: { platformkit_checkout: '1', user_id: 'user_test' },
}])
const invoiceEvents = await verifyEnvelope({
  merchant_id: 'merchant_test',
  event_id: 'evt_invoice',
  event_type: 'invoice_paid',
  content: {
    type: 'subscription_details',
    object: { id: 'sub_test', customer_id: 'cus_test', status: 'active' },
  },
})
assert.deepEqual(invoiceEvents, [{
  provider: 'hyperswitch',
  eventId: 'evt_invoice',
  type: 'invoice.paid',
  occurredAt: 0,
  customerId: 'cus_test',
  subscriptionId: 'sub_test',
  status: 'active',
  invoice: {
    provider: 'hyperswitch',
    invoiceId: 'evt_invoice',
    subscriptionId: 'sub_test',
    lines: [],
  },
}])
assert.deepEqual(normalizePaymentEvent('hyperswitch', invoiceEvents[0]), invoiceEvents[0])
const payoutEvents = await verifyEnvelope({
  merchant_id: 'merchant_test',
  event_id: 'evt_payout',
  event_type: 'payout_failed',
  timestamp: SENT,
  content: {
    type: 'payout_details',
    object: { payout_id: 'po_test', status: 'failed', amount: 2500, currency: 'USD' },
  },
})
assert.deepEqual(payoutEvents, [{
  provider: 'hyperswitch',
  eventId: 'evt_payout',
  type: 'payout.updated',
  occurredAt: Math.floor(Date.parse(SENT) / 1000),
  payoutId: 'po_test',
  status: 'failed',
  amountMinor: 2500,
  currency: 'USD',
}])
assert.equal(normalizePaymentEvent('hyperswitch', payoutEvents[0]).currency, 'usd')
for (const [wireType, status] of [
  ['payout_success', 'success'],
  ['payout_failed', 'failed'],
  ['payout_initiated', 'initiated'],
  ['payout_processing', 'processing'],
  ['payout_cancelled', 'cancelled'],
  ['payout_expired', 'expired'],
  ['payout_reversed', 'reversed'],
  ['payout_not_permitted', 'not_permitted'],
]) {
  const [event] = await verifyEnvelope({
    merchant_id: 'merchant_test',
    event_id: `evt_${wireType}`,
    event_type: wireType,
    content: { type: 'payout_details', object: { payout_id: `po_${wireType}` } },
  })
  assert.equal(event.type, 'payout.updated')
  assert.equal(event.payoutId, `po_${wireType}`)
  assert.equal(event.status, status)
  assert.deepEqual(normalizePaymentEvent('hyperswitch', event), event)
}
const expiredCheckoutEvents = await verifyEnvelope({
  merchant_id: 'merchant_test',
  event_id: 'evt_expired',
  event_type: 'payment_expired',
  content: {
    type: 'payment_details',
    object: {
      payment_id: 'pay_expired',
      metadata: { platformkit_checkout: '1', user_id: 'user_test' },
    },
  },
})
assert.equal(expiredCheckoutEvents[0].type, 'checkout.expired')
assert.equal(expiredCheckoutEvents[0].checkoutId, 'pay_expired')
for (const [wireType, normalizedType] of [
  ['payment_succeeded', 'payment.succeeded'],
  ['payment_failed', 'payment.failed'],
  ['payment_captured', 'payment.succeeded'],
  ['payment_cancelled_post_capture', 'payment.refunded'],
  ['refund_succeeded', 'payment.refunded'],
]) {
  const [event] = await verifyEnvelope({
    merchant_id: 'merchant_test',
    event_id: `evt_${wireType}`,
    event_type: wireType,
    content: {
      type: 'payment_details',
      object: {
        payment_id: `pay_${wireType}`,
        amount: 2500,
        currency: 'USD',
      },
    },
  })
  assert.equal(event.type, normalizedType)
  assert.equal(event.paymentId, `pay_${wireType}`)
  assert.equal(event.amountMinor, 2500)
  assert.equal(event.currency, 'USD')
}
for (const unsupportedType of [
  'subscription_created',
  'subscription_updated',
  'subscription_cancelled',
  'usage_reported',
]) {
  assert.deepEqual(await verifyEnvelope({
    merchant_id: 'merchant_test',
    event_id: `evt_${unsupportedType}`,
    event_type: unsupportedType,
    content: { type: 'payment_details', object: { payment_id: 'pay_non_native' } },
  }), [])
}
assert.deepEqual(await verifyEnvelope({
  merchant_id: 'merchant_test',
  event_id: 'evt_processing',
  event_type: 'payment_processing',
  content: { type: 'payment_details', object: { payment_id: 'pay_pending' } },
}), [])
assert.deepEqual(await verifyEnvelope({
  merchant_id: 'merchant_test',
  event_id: 'evt_invoice_incomplete',
  event_type: 'invoice_paid',
  content: { type: 'subscription_details', object: { status: 'active' } },
}), [])
await assert.rejects(
  verifyHyperswitchWebhook(new Request('https://site.test/hook', {
    method: 'POST',
    headers: { 'X-Webhook-Signature-512': '0'.repeat(128) },
    body: rawBody,
  }), signingKey),
  (error) => error instanceof PaymentProviderError && error.code === 'invalid_webhook',
)
await assert.rejects(
  verifyHyperswitchWebhook(new Request('https://site.test/hook', {
    method: 'POST',
    headers: { 'X-Webhook-Signature-512': signature },
    body: rawBody.replace('2500', '2501'),
  }), signingKey),
  (error) => error instanceof PaymentProviderError && error.code === 'invalid_webhook',
)
/* a correctly signed event older than the tolerance is a replay, and refused */
{
  const stale = JSON.stringify({ ...JSON.parse(rawBody), timestamp: new Date(Date.now() - 4 * 86400e3).toISOString() })
  await assert.rejects(
    verifyHyperswitchWebhook(new Request('https://site.test/hook', {
      method: 'POST',
      headers: { 'X-Webhook-Signature-512': createHmac('sha512', signingKey).update(stale).digest('hex') },
      body: stale,
    }), signingKey),
    (error) => error instanceof PaymentProviderError && error.code === 'invalid_webhook' && /older than the tolerance/.test(error.message),
  )
}
const malformedBody = '{"event_id":'
const malformedSignature = createHmac('sha512', signingKey).update(malformedBody).digest('hex')
await assert.rejects(
  verifyHyperswitchWebhook(new Request('https://site.test/hook', {
    method: 'POST',
    headers: { 'X-Webhook-Signature-512': malformedSignature },
    body: malformedBody,
  }), signingKey),
  (error) => error instanceof PaymentProviderError && error.code === 'invalid_webhook' &&
    /not valid JSON/.test(error.message),
)

console.log('hyperswitch payment provider: API and webhook checks passed')

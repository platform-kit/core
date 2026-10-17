import assert from 'node:assert/strict'
import { createPaymentProvider } from '../supabase/functions/_shared/hyperswitch-payment-provider.ts'
import {
  assertPaymentCapabilities,
  normalizePaymentCheckout,
  PaymentProviderError,
} from '../supabase/functions/_shared/payment-provider.mjs'

type RequestBody = Record<string, unknown> & { metadata?: Record<string, unknown> }
const requests: Array<{ url: string; init: RequestInit; body?: RequestBody }> = []
let prorationStatus = 'succeeded'
const paymentRecords = new Map<string, RequestBody>()
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}
function lastIntentRequest() {
  return requests.filter((request) =>
    request.url.endsWith('/v2/payments/create-intent')
  ).at(-1)!
}
const profileCapabilities = [
  'checkout.one-time',
  'checkout.subscription',
  'checkout.trial',
  'checkout.payment-method-selection',
  'checkout.adjustable-quantity',
  'customer.create',
  'catalog.sync',
  'refunds',
  'usage.prepaid-top-up',
]
const provider = createPaymentProvider({
  HYPERSWITCH_BASE_URL: 'https://sandbox.hyperswitch.io',
  HYPERSWITCH_API_KEY: 'server-only-key',
  HYPERSWITCH_PROFILE_ID: 'pro_test',
  HYPERSWITCH_PUBLISHABLE_KEY: 'pk_snd_test',
  HYPERSWITCH_CLIENT_URL: 'https://sdk.sandbox.test/v2',
  HYPERSWITCH_WEBHOOK_SECRET: 'webhook-secret',
}, { profileCapabilities }, {
  fetch: async (url, requestInit) => {
    const init = requestInit ?? {}
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    requests.push({ url: String(url), init, body })
    if (String(url).endsWith('/v1/customers') && init.method === 'POST') {
      return Response.json({ id: 'cus_test' })
    }
    if (String(url).endsWith('/v2/payments/create-intent') && init.method === 'POST') {
      const id = String(body?.merchant_reference_id ?? 'pay_test')
      paymentRecords.set(id, body ?? {})
      return Response.json({
        id,
        client_secret: 'pay_test_secret',
        status: 'requires_payment_method',
        customer_id: body?.customer_id ?? 'cus_test',
        amount_details: body?.amount_details,
        order_details: body?.order_details,
        metadata: body?.metadata,
      })
    }
    const confirmationMatch = String(url).match(/\/v2\/payments\/([^/]+)\/confirm-intent$/)
    if (confirmationMatch) {
      const id = decodeURIComponent(confirmationMatch[1]!)
      const intent = paymentRecords.get(id)
      return Response.json({
        id,
        status: intent?.metadata?.platformkit_subscription_change
          ? prorationStatus
          : 'succeeded',
        client_secret: 'pay_client_secret',
      })
    }
    if (String(url).endsWith('/saved-payment-methods')) {
      return Response.json({
        customer_payment_methods: [
          { id: 'pm_saved', is_default: true, payment_method_type: 'card' },
        ],
      })
    }
    if (String(url).endsWith('/v1/payment-method-sessions')) {
      return Response.json({ id: 'pms_test', sdk_authorization: 'sdk_authorization_test' })
    }
    const retrievalMatch = String(url).match(/\/v2\/payments\/([^/]+)\/get-intent$/)
    if (retrievalMatch) {
      const id = decodeURIComponent(retrievalMatch[1]!)
      const intent = paymentRecords.get(id)
      if (id === 'pay_test') {
        return Response.json({
          id: 'pay_test',
          status: 'succeeded',
          client_secret: 'pay_client_secret',
          amount_details: { order_amount: 2500, currency: 'USD' },
          customer_id: 'cus_test',
          email: 'buyer@example.test',
          order_details: [{
            product_id: 'book',
            product_name: 'Book',
            quantity: 2,
            amount: 2500,
            currency: 'USD',
          }],
          metadata: {
            platformkit_checkout: '1',
            platformkit_checkout_mode: 'payment',
            user_id: 'user_test',
          },
        })
      }
      return Response.json({
        id,
        status: 'succeeded',
        client_secret: 'pay_client_secret',
        amount_details: intent?.amount_details ?? { order_amount: 1250, currency: 'USD' },
        customer_id: intent?.customer_id ?? 'cus_test',
        email: 'buyer@example.test',
        created_at: '2026-01-31T12:00:00.000Z',
        order_details: intent?.order_details ?? [],
        metadata: intent?.metadata ?? {},
      })
    }
    if (String(url).endsWith('/v2/refunds')) {
      return Response.json({ id: 're_test', status: 'succeeded' })
    }
    return Response.json({ customer_id: 'cus_test' })
  },
})

const createdCheckout = await provider.createCheckout!({
  idempotencyKey: 'checkout:test',
  mode: 'payment',
  customerEmail: 'buyer@example.test',
  lines: [{
    offerKey: 'book',
    sku: 'book',
    name: 'Book',
    currency: 'USD',
    billing: 'once',
    unitAmountMinor: 1250,
    quantity: 2,
  }],
  successUrl: 'https://site.test/thanks?session={CHECKOUT_ID}',
  cancelUrl: 'https://site.test/cart',
  metadata: { user_id: 'user_test', skus: 'book' },
  currency: 'USD',
})
assert.equal(createdCheckout.provider, 'hyperswitch')
assert.match(createdCheckout.checkoutId, /^pay_[a-f0-9]{26}$/)
assert.match(createdCheckout.url, /^https:\/\/site\.test\/checkout\/hyperswitch\?session=/)
assert.equal(createdCheckout.client?.clientSecret, 'pay_test_secret')
assert.equal(createdCheckout.client?.publishableKey, 'pk_snd_test')
assert.equal(createdCheckout.client?.clientUrl, 'https://sdk.sandbox.test/v2')
assert.equal(createdCheckout.client?.paymentMethodSessionId, 'pms_test')
assert.equal(createdCheckout.client?.sdkAuthorization, 'sdk_authorization_test')
assert.equal(createdCheckout.client?.profileId, 'pro_test')
assert.equal(createdCheckout.client?.cancelUrl, 'https://site.test/cart')
assert.equal(
  createdCheckout.client?.successUrl,
  `https://site.test/thanks?session=${createdCheckout.checkoutId}`,
)
assert.equal(requests.length, 3)
const cleanupCalls: string[] = []
const cleanupScenarios: Record<string, { methodCreated: string; mode: string }> = {
  pay_new_card: { methodCreated: '2026-02-01T12:00:05.000Z', mode: 'payment' },
  pay_saved_card: { methodCreated: '2026-01-01T00:00:00.000Z', mode: 'payment' },
}
const cleanupProvider = createPaymentProvider({
  HYPERSWITCH_BASE_URL: 'https://sandbox.hyperswitch.io',
  HYPERSWITCH_API_KEY: 'server-only-key',
  HYPERSWITCH_PROFILE_ID: 'pro_test',
  HYPERSWITCH_PUBLISHABLE_KEY: 'pk_snd_test',
  HYPERSWITCH_WEBHOOK_SECRET: 'webhook-secret',
}, { profileCapabilities }, {
  fetch: async (url, requestInit) => {
    const { pathname } = new URL(String(url))
    const method = requestInit?.method ?? 'GET'
    cleanupCalls.push(`${method} ${pathname}`)
    const intent = pathname.match(/^\/v2\/payments\/([^/]+)(\/get-intent)?$/)
    if (intent) {
      const scenario = cleanupScenarios[decodeURIComponent(intent[1]!)]!
      return Response.json({
        id: intent[1],
        status: 'succeeded',
        created: '2026-02-01T12:00:00.000Z',
        payment_method_id: 'pm_' + intent[1],
        customer_id: 'cus_test',
        amount_details: { order_amount: 100, currency: 'USD' },
        order_details: [{ product_id: 'book', product_name: 'Book', quantity: 1, amount: 100, currency: 'USD' }],
        metadata: { platformkit_checkout: '1', platformkit_checkout_mode: scenario.mode },
      })
    }
    const methodRecord = pathname.match(/^\/v1\/payment-methods\/pm_([^/]+)$/)
    if (methodRecord && method === 'GET') {
      return Response.json({ id: 'pm_' + methodRecord[1], created: cleanupScenarios[methodRecord[1]!]!.methodCreated })
    }
    return Response.json({ id: 'deleted' })
  },
})
for (const id of Object.keys(cleanupScenarios)) await cleanupProvider.retrieveCheckout!(id)
assert.ok(cleanupCalls.includes('DELETE /v1/payment-methods/pm_pay_new_card'))
assert.equal(cleanupCalls.includes('DELETE /v1/payment-methods/pm_pay_saved_card'), false)

const sdkPrefixRequests: string[] = []
const sdkPrefixProvider = createPaymentProvider({
  HYPERSWITCH_BASE_URL: 'https://sandbox.hyperswitch.io',
  HYPERSWITCH_API_KEY: 'server-only-key',
  HYPERSWITCH_PROFILE_ID: 'pro_test',
  HYPERSWITCH_PUBLISHABLE_KEY: 'pk_snd_test',
  HYPERSWITCH_PAYMENT_METHODS_PREFIX: 'v2',
  HYPERSWITCH_WEBHOOK_SECRET: 'webhook-secret',
}, { profileCapabilities }, {
  fetch: async (url) => {
    sdkPrefixRequests.push(String(url))
    return Response.json({ id: 'cus_prefix' })
  },
})
await sdkPrefixProvider.createCustomer!({ userId: 'user_prefix', email: 'prefix@example.test' })
assert.equal(sdkPrefixRequests[0], 'https://sandbox.hyperswitch.io/v2/customers')
assert.throws(
  () => createPaymentProvider({
    HYPERSWITCH_BASE_URL: 'https://sandbox.hyperswitch.io',
    HYPERSWITCH_API_KEY: 'server-only-key',
    HYPERSWITCH_PROFILE_ID: 'pro_test',
    HYPERSWITCH_PUBLISHABLE_KEY: 'pk_snd_test',
    HYPERSWITCH_PAYMENT_METHODS_PREFIX: 'v3',
  }, { profileCapabilities }),
  (error) => error instanceof PaymentProviderError &&
    error.code === 'hyperswitch_configuration_invalid',
)
const firstIntentRequest = lastIntentRequest()
assert.equal(firstIntentRequest.url, 'https://sandbox.hyperswitch.io/v2/payments/create-intent')
assert.equal(firstIntentRequest.body?.confirm, undefined)
assert.equal(firstIntentRequest.body?.amount_details &&
  record(firstIntentRequest.body.amount_details, 'amount details').order_amount, 2500)
assert.equal(firstIntentRequest.body?.merchant_reference_id, createdCheckout.checkoutId)
assert.equal(firstIntentRequest.body?.customer_id, 'cus_test')
assert.deepEqual(firstIntentRequest.body?.order_details, [{
  product_id: 'book',
  product_name: 'Book',
  quantity: 2,
  amount: 2500,
  currency: 'USD',
}])
const checkoutMethodSessionRequest = requests.at(-1)!
assert.equal(checkoutMethodSessionRequest.url, 'https://sandbox.hyperswitch.io/v1/payment-method-sessions')
assert.deepEqual(checkoutMethodSessionRequest.body, {
  customer_id: 'cus_test',
  storage_type: 'persistent',
  return_url: `https://site.test/checkout/hyperswitch?session=${encodeURIComponent(createdCheckout.checkoutId)}&payment_action=return`,
  keep_alive: true,
})

const discountedCheckout = await provider.createCheckout!({
  idempotencyKey: 'checkout:coupon-adjusted-price',
  mode: 'payment',
  customerEmail: 'buyer@example.test',
  lines: [{
    offerKey: 'book',
    sku: 'book',
    name: 'Book',
    currency: 'USD',
    billing: 'once',
    unitAmountMinor: 900,
    quantity: 1,
  }],
  successUrl: 'https://site.test/thanks?session={CHECKOUT_ID}',
  cancelUrl: 'https://site.test/cart',
  metadata: { promotions: 'welcome-coupon' },
  currency: 'USD',
})
assert.equal(
  record(lastIntentRequest().body?.amount_details, 'discounted amount details').order_amount,
  900,
)
assert.deepEqual(lastIntentRequest().body?.order_details, [{
  product_id: 'book',
  product_name: 'Book',
  quantity: 1,
  amount: 900,
  currency: 'USD',
}])
assert.equal(lastIntentRequest().body?.metadata?.promotions, 'welcome-coupon')
assert.notEqual(discountedCheckout.checkoutId, createdCheckout.checkoutId)

const snapshot = await provider.retrieveCheckout!('pay_test')
assert.equal(snapshot.status, 'complete')
assert.equal(snapshot.paymentStatus, 'paid')
assert.equal(snapshot.mode, 'payment')
assert.equal(snapshot.customerId, 'cus_test')
assert.equal(snapshot.userId, 'user_test')
assert.equal(snapshot.lines?.[0]?.currency, 'USD')
assert.equal(snapshot.lines[0]?.offerKey, 'book')
assert.equal(snapshot.lines[0]?.quantity, 2)
assert.equal(snapshot.lines[0]?.providerPriceId, 'platformkit:book')
assert.deepEqual(await provider.retrievePaymentIntent!('pay_test'), {
  paymentIntentId: 'pay_test',
  status: 'succeeded',
  clientSecret: 'pay_client_secret',
})

const subscriptionCheckout = await provider.createCheckout!({
  idempotencyKey: 'checkout:subscription-trial',
  customer: { userId: 'user_test', email: 'buyer@example.test', providerCustomerId: 'cus_test' },
  mode: 'subscription',
  lines: [{
    offerKey: 'member',
    sku: 'member',
    name: 'Membership',
    currency: 'USD',
    billing: 'subscription',
    interval: 'month',
    unitAmountMinor: 1200,
    quantity: 1,
    metadata: { key: 'member', sku: 'member', tier: 'gold' },
  }],
  successUrl: 'https://site.test/thanks?session={CHECKOUT_ID}',
  cancelUrl: 'https://site.test/store',
  metadata: { user_id: 'user_test', skus: 'member' },
  trialDays: 14,
  allowedPaymentMethods: ['card'],
})
const subscriptionRequest = lastIntentRequest()
const subscriptionBody = record(subscriptionRequest.body, 'subscription request body')
const subscriptionMetadata = record(subscriptionBody.metadata, 'subscription request metadata')
const subscriptionLines = subscriptionBody.order_details
assert.ok(Array.isArray(subscriptionLines))
const firstSubscriptionLine = record(subscriptionLines[0], 'subscription request line')
assert.equal(record(subscriptionBody.amount_details, 'subscription amount details').order_amount, 0)
assert.equal(subscriptionBody.setup_future_usage, 'off_session')
assert.deepEqual(subscriptionBody.allowed_payment_method_types, ['credit', 'debit'])
assert.equal(subscriptionMetadata.platformkit_checkout_mode, 'subscription')
assert.equal(subscriptionMetadata.platformkit_subscription_amount, '1200')
assert.equal(firstSubscriptionLine.amount, 0)
const subscriptionSnapshot = normalizePaymentCheckout(
  'hyperswitch',
  await provider.retrieveCheckout!(subscriptionCheckout.checkoutId),
)
assert.equal(subscriptionSnapshot.mode, 'subscription')
assert.equal(subscriptionSnapshot.subscription?.status, 'trialing')
assert.equal(subscriptionSnapshot.subscription?.paymentMethodId, 'pm_saved')
assert.equal(subscriptionSnapshot.subscription?.items[0]?.offerKey, 'member')
assert.equal(subscriptionSnapshot.subscription?.items[0]?.unitAmountMinor, 1200)
assert.equal(subscriptionSnapshot.subscription?.items[0]?.metadata.tier, 'gold')
assert.equal(subscriptionSnapshot.subscription?.currentPeriodEnd! - subscriptionSnapshot.subscription?.currentPeriodStart!, 14 * 86400)
const activeSubscription = await provider.createCheckout!({
  idempotencyKey: 'checkout:subscription-active',
  customer: { userId: 'user_test', email: 'buyer@example.test', providerCustomerId: 'cus_test' },
  mode: 'subscription',
  lines: [{
    offerKey: 'member',
    sku: 'member',
    name: 'Membership',
    currency: 'USD',
    billing: 'subscription',
    interval: 'month',
    unitAmountMinor: 1200,
    quantity: 1,
    metadata: { key: 'member', sku: 'member', tier: 'gold' },
  }],
  successUrl: 'https://site.test/thanks?session={CHECKOUT_ID}',
  cancelUrl: 'https://site.test/store',
  metadata: { user_id: 'user_test', skus: 'member' },
})
const activeSubscriptionSnapshot = await provider.retrieveCheckout!(activeSubscription.checkoutId)
assert.equal(activeSubscriptionSnapshot.subscription?.status, 'active')
assert.equal(
  new Date(activeSubscriptionSnapshot.subscription!.currentPeriodEnd! * 1000).toISOString(),
  '2026-02-28T12:00:00.000Z',
)
const periodStart = Math.floor(Date.now() / 1000)
const paymentRequestsBeforeDeferredChange = requests.filter((request) =>
  request.init.method === 'POST' && request.url.endsWith('/v2/payments/create-intent')
).length
const deferredChange = await provider.changeSubscription!({
  subscriptionId: subscriptionCheckout.checkoutId,
  offerKey: 'member-plus',
  offer: {
    offerKey: 'member-plus',
    sku: 'member-plus',
    name: 'Membership Plus',
    kind: 'subscription',
    currency: 'USD',
    unitAmountMinor: 2400,
    interval: 'month',
  },
  currentAmountMinor: 1200,
  currentPeriodStart: periodStart,
  currentPeriodEnd: periodStart + 30 * 86400,
  proration: 'next-cycle',
  idempotencyKey: 'subscription-change:next-cycle',
  userId: 'user_test',
})
assert.equal(deferredChange.nextAt, periodStart + 30 * 86400)
assert.equal(deferredChange.subscription.items[0]?.offerKey, 'member')
assert.equal(
  requests.filter((request) =>
    request.init.method === 'POST' && request.url.endsWith('/v2/payments/create-intent')
  ).length,
  paymentRequestsBeforeDeferredChange,
)
const unchangedSubscription = await provider.changeSubscription!({
  subscriptionId: subscriptionCheckout.checkoutId,
  offerKey: 'member',
  offer: {
    offerKey: 'member',
    sku: 'member',
    name: 'Membership',
    kind: 'subscription',
    currency: 'USD',
    unitAmountMinor: 1200,
    interval: 'month',
  },
  currentAmountMinor: 1200,
  currentPeriodStart: periodStart,
  currentPeriodEnd: periodStart + 30 * 86400,
  proration: 'none',
  idempotencyKey: 'subscription-change:no-op',
  userId: 'user_test',
})
assert.equal(unchangedSubscription.subscription.items[0]?.offerKey, 'member')
assert.equal(
  requests.filter((request) =>
    request.init.method === 'POST' && request.url.endsWith('/v2/payments/create-intent')
  ).length,
  paymentRequestsBeforeDeferredChange,
)
const changedSubscription = await provider.changeSubscription!({
  subscriptionId: subscriptionCheckout.checkoutId,
  offerKey: 'member-plus',
  offer: {
    offerKey: 'member-plus',
    sku: 'member-plus',
    name: 'Membership Plus',
    kind: 'subscription',
    currency: 'USD',
    unitAmountMinor: 2400,
    interval: 'month',
    metadata: { key: 'member-plus', sku: 'member-plus', tier: 'platinum' },
  },
  currentAmountMinor: 1200,
  currentPeriodStart: periodStart,
  currentPeriodEnd: periodStart + 30 * 86400,
  proration: 'immediate',
  idempotencyKey: 'subscription-change:upgrade',
  userId: 'user_test',
})
assert.equal(changedSubscription.subscription.items[0]?.offerKey, 'member-plus')
assert.equal(changedSubscription.subscription.items[0]?.unitAmountMinor, 2400)
assert.equal(changedSubscription.subscription.metadata.user_id, 'user_test')
const prorationIntentRequest = requests.find((request) =>
  request.url.endsWith('/v2/payments/create-intent') &&
  request.body?.metadata?.platformkit_subscription_change === 'subscription-change:upgrade'
)!
assert.equal(
  record(prorationIntentRequest.body?.amount_details, 'proration amount details').order_amount,
  1200,
)
assert.equal(
  new Headers(prorationIntentRequest.init.headers).get('Idempotency-Key'),
  'subscription-change:upgrade',
)
prorationStatus = 'requires_customer_action'
await assert.rejects(
  provider.changeSubscription!({
    subscriptionId: subscriptionCheckout.checkoutId,
    offerKey: 'member-pro',
    offer: {
      offerKey: 'member-pro',
      sku: 'member-pro',
      name: 'Membership Pro',
      kind: 'subscription',
      currency: 'USD',
      unitAmountMinor: 2400,
      interval: 'month',
      metadata: { key: 'member-pro', sku: 'member-pro', tier: 'platinum' },
    },
    currentAmountMinor: 1200,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodStart + 30 * 86400,
    proration: 'immediate',
    idempotencyKey: 'subscription-change:declined',
    userId: 'user_test',
  }),
  (error) => error instanceof PaymentProviderError &&
    error.code === 'hyperswitch_subscription_proration_failed',
)
prorationStatus = 'succeeded'

const customer = await provider.createCustomer!({ userId: 'user_test', email: 'buyer@example.test' })
assert.equal(customer.customerId, 'cus_test')
const customerRequest = requests.at(-1)!
assert.equal(customerRequest.url, 'https://sandbox.hyperswitch.io/v1/customers')
assert.equal(customerRequest.body?.merchant_reference_id, 'user_test')
assert.equal(customerRequest.body?.profile_id, undefined)
assert.equal(new Headers(customerRequest.init.headers).get('authorization'), 'api-key=server-only-key')
assert.equal(new Headers(customerRequest.init.headers).get('api-key'), null)

assert.deepEqual(
  await provider.getDefaultPaymentMethod!('cus_test'),
  { paymentMethodId: 'pm_saved' },
)
assert.equal(requests.at(-1)?.url, 'https://sandbox.hyperswitch.io/v1/customers/cus_test/saved-payment-methods')
assert.equal(new Headers(requests.at(-1)?.init.headers).get('authorization'), 'api-key=server-only-key')
const paymentIntent = await provider.createPaymentIntent!({
  amountMinor: 500,
  currency: 'USD',
  customerId: 'cus_test',
  paymentMethodId: 'pm_default',
  description: 'Usage top-up',
  metadata: { usage_topup_attempt: 'attempt_test' },
  idempotencyKey: 'topup:test',
})
assert.equal(paymentIntent.paymentIntentId.startsWith('pay_'), true)
assert.equal(paymentIntent.clientSecret, 'pay_test_secret')
const topupIntentRequest = requests.find((request) =>
  request.url.endsWith('/v2/payments/create-intent') &&
  request.body?.metadata?.usage_topup_attempt === 'attempt_test'
)!
assert.deepEqual(topupIntentRequest.body?.amount_details, {
  currency: 'USD',
  order_amount: 500,
})
const topupConfirmationRequest = requests.find((request) =>
  request.url.endsWith('/v2/payments/' + paymentIntent.paymentIntentId + '/confirm-intent')
)!
assert.deepEqual(topupConfirmationRequest.body, {
  payment_method_data: {},
  payment_method_type: 'card',
  payment_method_id: 'pm_default',
})
assert.equal(
  new Headers(topupConfirmationRequest.init.headers).get('authorization'),
  'publishable-key=pk_snd_test,client-secret=pay_test_secret',
)
const incrementalProvider = createPaymentProvider({
  HYPERSWITCH_BASE_URL: 'https://sandbox.hyperswitch.io',
  HYPERSWITCH_API_KEY: 'server-only-key',
  HYPERSWITCH_PROFILE_ID: 'pro_test',
  HYPERSWITCH_PUBLISHABLE_KEY: 'pk_snd_test',
  HYPERSWITCH_WEBHOOK_SECRET: 'webhook-secret',
}, { profileCapabilities: ['checkout.subscription'] }, {
  fetch: async (url, init) => {
    if (String(url).endsWith('/saved-payment-methods')) {
      return Response.json({
        customer_payment_methods: [{ id: 'pm_subscription_default', is_default: true }],
      })
    }
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
    if (String(url).endsWith('/v2/payments/create-intent')) {
      return Response.json({
        id: 'pay_incremental',
        status: 'requires_payment_method',
        client_secret: 'pay_client_secret',
        customer_id: body.customer_id,
      })
    }
    if (String(url).endsWith('/confirm-intent')) {
      return Response.json({
        id: new URL(String(url)).pathname.split('/').at(-2),
        status: 'succeeded',
        client_secret: 'pay_client_secret',
      })
    }
    return Response.json({
      id: 'pay_incremental',
      status: 'succeeded',
      client_secret: 'pay_client_secret',
    })
  },
})
assert.deepEqual(await incrementalProvider.getDefaultPaymentMethod!('cus_test'), {
  paymentMethodId: 'pm_subscription_default',
})
assert.deepEqual(await incrementalProvider.createPaymentIntent!({
  amountMinor: 10000,
  currency: 'USD',
  customerId: 'cus_test',
  paymentMethodId: 'pm_subscription_default',
  description: 'Metered usage',
  metadata: { platformkit_usage_incremental: '1' },
  idempotencyKey: 'usage-increment:sub_test:period_test:threshold:1',
}), {
  paymentIntentId: 'pay_incremental',
  status: 'succeeded',
  clientSecret: 'pay_client_secret',
})
assert.ok(!provider.capabilities.includes('usage.metered'),
  'Hyperswitch profile capabilities exclude metered usage settled by PlatformKit')
assert.equal(provider.reportUsage, undefined)

assert.deepEqual(
  await provider.refund!({ paymentId: 'pay_test', amountMinor: 250, idempotencyKey: 'refund:test' }),
  { refundId: 're_test', status: 'succeeded' },
)
const refundRequest = requests.at(-1)!
assert.equal(refundRequest.url, 'https://sandbox.hyperswitch.io/v2/refunds')
assert.equal(refundRequest.body?.payment_id, 'pay_test')
assert.equal(refundRequest.body?.refund_type, 'instant')
assert.equal(String(refundRequest.body?.merchant_reference_id).length, 30)

const catalog = await provider.syncCatalog!([{
  offerKey: 'book',
  sku: 'book',
  name: 'Book',
  kind: 'one-time',
  currency: 'USD',
  unitAmountMinor: 1250,
}])
assert.deepEqual(catalog.offers.book, {
  productId: 'platformkit:book',
  priceId: 'platformkit:book',
  made: false,
})

const callsBeforeUnsupportedCheckout = requests.length
await assert.rejects(
  provider.createCheckout!({
    idempotencyKey: 'checkout:tax',
    mode: 'payment',
    lines: [{
      offerKey: 'book',
      sku: 'book',
      name: 'Book',
      currency: 'USD',
      billing: 'once',
      unitAmountMinor: 1250,
      quantity: 1,
    }],
    successUrl: 'https://site.test/thanks',
    cancelUrl: 'https://site.test/cart',
    metadata: {},
    automaticTax: true,
  }),
  (error) => error instanceof PaymentProviderError &&
    error.code === 'hyperswitch_checkout_term_unavailable' &&
    /no payment was created/.test(error.message),
)
await assert.rejects(
  provider.createCheckout!({
    idempotencyKey: 'checkout:adjustable-quantity',
    mode: 'payment',
    lines: [{
      offerKey: 'book',
      sku: 'book',
      name: 'Book',
      currency: 'USD',
      billing: 'once',
      unitAmountMinor: 1250,
      quantity: 1,
      adjustableQuantity: { minimum: 1, maximum: 4 },
    }],
    successUrl: 'https://site.test/thanks',
    cancelUrl: 'https://site.test/cart',
    metadata: {},
  }),
  (error) => error instanceof PaymentProviderError &&
    error.code === 'hyperswitch_checkout_term_unavailable' &&
    /no payment was created/.test(error.message),
)
await assert.rejects(
  provider.createCheckout!({
    idempotencyKey: 'checkout:shipping',
    mode: 'payment',
    lines: [{
      offerKey: 'book',
      sku: 'book',
      name: 'Book',
      currency: 'USD',
      billing: 'once',
      unitAmountMinor: 1250,
      quantity: 1,
    }],
    successUrl: 'https://site.test/thanks',
    cancelUrl: 'https://site.test/cart',
    metadata: {},
    shippingAddress: 'required',
  }),
  (error) => error instanceof PaymentProviderError &&
    error.code === 'hyperswitch_profile_capability_unavailable',
)
assert.equal(requests.length, callsBeforeUnsupportedCheckout)
const cancelCheckout = await provider.createCheckout!({
    idempotencyKey: 'checkout:cancel-url',
    mode: 'payment',
    customerEmail: 'buyer@example.test',
    lines: [{
      offerKey: 'book',
      sku: 'book',
      name: 'Book',
      currency: 'USD',
      billing: 'once',
      unitAmountMinor: 1250,
      quantity: 1,
    }],
    successUrl: 'https://site.test/thanks',
    cancelUrl: 'https://site.test/cart',
    metadata: {},
    currency: 'USD',
  })
assert.equal(cancelCheckout.client?.cancelUrl, 'https://site.test/cart')
assert.equal(requests.length, callsBeforeUnsupportedCheckout + 3)

assert.deepEqual(
  await provider.createPortalSession!({ customerId: 'cus_test', returnUrl: 'https://site.test/billing' }),
  { url: 'https://site.test/billing' },
)
assert.deepEqual(
  await provider.createPaymentMethodSession!({
    customerId: 'cus_test',
    returnUrl: 'https://site.test/billing?payment_method=updated',
  }),
  { id: 'pms_test', sdkAuthorization: 'sdk_authorization_test', profileId: 'pro_test' },
)
const methodSessionRequest = requests.at(-1)!
assert.equal(methodSessionRequest.url, 'https://sandbox.hyperswitch.io/v1/payment-method-sessions')
assert.equal(methodSessionRequest.init.method, 'POST')
assert.deepEqual(methodSessionRequest.body, {
  customer_id: 'cus_test',
  storage_type: 'persistent',
  return_url: 'https://site.test/billing?payment_method=updated',
  keep_alive: true,
})
assert.equal(new Headers(methodSessionRequest.init.headers).get('authorization'), 'api-key=server-only-key')
assert.equal(new Headers(methodSessionRequest.init.headers).get('api-key'), null)

assert.ok(!provider.capabilities.includes('payouts.connected-accounts'))
assert.equal(provider.createPayoutAccount, undefined)
assert.equal(provider.retrievePayoutAccount, undefined)
assert.equal(provider.createPayout, undefined)
const requestCountBeforeUnsupportedPayout = requests.length
assert.throws(
  () => assertPaymentCapabilities(provider, ['payouts.connected-accounts']),
  (error) => error instanceof PaymentProviderError && error.code === 'unsupported_capability',
)
assert.equal(requests.length, requestCountBeforeUnsupportedPayout)

const failedV2Requests: Array<{ url: string; init: RequestInit }> = []
const failedV2Provider = createPaymentProvider({
  HYPERSWITCH_BASE_URL: 'https://unavailable-v2.hyperswitch.test',
  HYPERSWITCH_API_KEY: 'server-only-key',
  HYPERSWITCH_PROFILE_ID: 'pro_test',
  HYPERSWITCH_PUBLISHABLE_KEY: 'pk_snd_test',
  HYPERSWITCH_WEBHOOK_SECRET: 'webhook-secret',
}, { profileCapabilities }, {
  fetch: async (url, init) => {
    failedV2Requests.push({ url: String(url), init: init ?? {} })
    return Response.json({ message: 'route not found' }, { status: 404 })
  },
})
await assert.rejects(
  failedV2Provider.createCustomer!({ userId: 'missing-v2', email: 'buyer@example.test' }),
  (error) => error instanceof PaymentProviderError &&
    error.code === 'hyperswitch_request_failed' && error.status === 404,
)
assert.equal(failedV2Requests.length, 1)
assert.equal(failedV2Requests[0]?.url, 'https://unavailable-v2.hyperswitch.test/v1/customers')
assert.equal(
  new Headers(failedV2Requests[0]?.init.headers).get('authorization'),
  'api-key=server-only-key',
)
assert.equal(new Headers(failedV2Requests[0]?.init.headers).get('api-key'), null)
await assert.rejects(
  failedV2Provider.createPaymentMethodSession!({
    customerId: 'cus_test',
    returnUrl: 'https://site.test/billing',
  }),
  (error) => error instanceof PaymentProviderError &&
    error.code === 'hyperswitch_request_failed' && error.status === 404,
)
assert.equal(failedV2Requests.length, 2)
assert.ok(failedV2Requests.every((request) =>
  /^\/v[12]\/(customers|payment-method-sessions)$/.test(new URL(request.url).pathname)))

const noEmailRequestCount = requests.length
await assert.rejects(
  provider.createCheckout!({
    idempotencyKey: 'checkout:missing-email',
    mode: 'payment',
    lines: [{
      offerKey: 'book',
      sku: 'book',
      name: 'Book',
      currency: 'USD',
      billing: 'once',
      unitAmountMinor: 1250,
      quantity: 1,
    }],
    successUrl: 'https://site.test/thanks',
    cancelUrl: 'https://site.test/cart',
    metadata: {},
  }),
  (error) => error instanceof PaymentProviderError &&
    error.code === 'hyperswitch_customer_email_required',
)
assert.equal(requests.length, noEmailRequestCount)

console.log('hyperswitch adapter: checkout preflight, customer, refund, catalog, saved payment method, and top-up checks passed')

import assert from 'node:assert/strict'
import { createPaymentProvider } from '../supabase/functions/_shared/hyperswitch-payment-provider.ts'
import { normalizePaymentCheckout, PaymentProviderError } from '../supabase/functions/_shared/payment-provider.mjs'

type RequestBody = Record<string, unknown> & { metadata?: Record<string, unknown> }
const requests: Array<{ url: string; init: RequestInit; body?: RequestBody }> = []
let prorationStatus = 'succeeded'
let payoutStatus = 'initiated'
const payoutRecords = new Map<string, string>()
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}
function createPayoutCapableTestProfile() {
  return {
    profileId: 'pro_test',
    capabilities: [
      'checkout.one-time',
      'checkout.subscription',
      'checkout.trial',
      'checkout.payment-method-selection',
      'checkout.adjustable-quantity',
      'customer.create',
      'catalog.sync',
      'refunds',
      'usage.prepaid-top-up',
      'payouts.connected-accounts',
    ],
    connectorAccounts: [{
      connectorName: 'stripe',
      connectorType: 'payout_processor',
      status: 'active',
      testMode: true,
      payoutMethods: ['card'],
    }],
    defaultPayoutMethod: {
      id: 'pm_default',
      payment_method: 'card',
      payment_token: 'payout_token_default',
    },
  }
}
const payoutTestProfile = createPayoutCapableTestProfile()
assert.ok(payoutTestProfile.connectorAccounts.some((connector) =>
  connector.connectorType === 'payout_processor' &&
  connector.status === 'active' &&
  connector.testMode &&
  connector.payoutMethods.includes('card')
))
const profileCapabilities = payoutTestProfile.capabilities
let payoutMethodsAvailable = true
const provider = createPaymentProvider({
  HYPERSWITCH_BASE_URL: 'https://sandbox.hyperswitch.io',
  HYPERSWITCH_API_KEY: 'server-only-key',
  HYPERSWITCH_PROFILE_ID: payoutTestProfile.profileId,
  HYPERSWITCH_PUBLISHABLE_KEY: 'pk_snd_test',
  HYPERSWITCH_CLIENT_URL: 'https://sdk.sandbox.test/v1',
  HYPERSWITCH_WEBHOOK_SECRET: 'webhook-secret',
}, { profileCapabilities }, {
  fetch: async (url, requestInit) => {
    const init = requestInit ?? {}
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    requests.push({ url: String(url), init, body })
    if (String(url).endsWith('/v2/customers') && init.method === 'POST') {
      return Response.json({ id: 'cus_test' })
    }
    if (String(url).endsWith('/payments') && init.method === 'POST') {
      if (body?.confirm !== false) {
        return Response.json({
          payment_id: 'pay_topup',
          status: body?.metadata?.platformkit_subscription_change ? prorationStatus : 'succeeded',
          client_secret: 'pay_client_secret',
        })
      }
      return Response.json({
        payment_id: body?.payment_id,
        client_secret: 'pay_test_secret',
        status: 'requires_payment_method',
      })
    }
    if (String(url).endsWith('/payment_methods')) {
      return Response.json({
        customer_payment_methods: [
          { id: 'pm_other', is_default: false },
          ...(payoutMethodsAvailable
            ? [{ ...payoutTestProfile.defaultPayoutMethod, is_default: true }]
            : []),
        ],
      })
    }
    if (String(url).endsWith('/saved-payment-methods')) {
      return Response.json({
        customer_payment_methods: [
          { id: 'pm_other', is_default: false },
          ...(payoutMethodsAvailable
            ? [{ ...payoutTestProfile.defaultPayoutMethod, is_default: true }]
            : []),
        ],
      })
    }
    if (String(url).includes('/payouts/') && init.method === 'GET') {
      const payoutId = new URL(String(url)).pathname.split('/').at(-1)!
      const status = payoutRecords.get(payoutId)
      return status
        ? Response.json({ payout_id: payoutId, status })
        : Response.json({ error: 'payout not found' }, { status: 404 })
    }
    if (String(url).endsWith('/payouts/create')) {
      const payoutId = String(body?.payout_id ?? '')
      payoutRecords.set(payoutId, payoutStatus)
      return Response.json({ payout_id: payoutId, status: payoutStatus })
    }
    if (String(url).endsWith('/v2/payment-method-sessions')) {
      return Response.json({ sdk_authorization: 'sdk_authorization_test' })
    }
    if (String(url).endsWith('/payments/pay_test?force_sync=true')) {
      return Response.json({
        payment_id: 'pay_test',
        status: 'succeeded',
        client_secret: 'pay_client_secret',
        amount: 2500,
        currency: 'USD',
        customer_id: 'cus_test',
        email: 'buyer@example.test',
        order_details: [{
          product_id: 'book',
          product_name: 'Book',
          quantity: 2,
          amount: 2500,
        }],
        metadata: {
          platformkit_checkout: '1',
          platformkit_checkout_mode: 'payment',
          user_id: 'user_test',
        },
      })
      assert.throws(
        () => createPaymentProvider({
          HYPERSWITCH_BASE_URL: 'https://sandbox.hyperswitch.io',
          HYPERSWITCH_API_KEY: 'server-only-key',
          HYPERSWITCH_PROFILE_ID: 'pro_test',
          HYPERSWITCH_PUBLISHABLE_KEY: 'pk_test_legacy',
          HYPERSWITCH_WEBHOOK_SECRET: 'webhook-secret',
        }, { profileCapabilities }),
        (error) => error instanceof PaymentProviderError &&
          error.code === 'hyperswitch_configuration_invalid' && error.status === 503,
      )
    }
    if (String(url).includes('/payments/') && String(url).endsWith('?force_sync=true')) {
      const id = String(url).split('/payments/')[1]?.split('?')[0]
      const request = requests.find((item) => item.body?.payment_id === id)
      return Response.json({
        payment_id: id,
        status: 'succeeded',
        created: '2026-01-31T12:00:00.000Z',
        amount: request?.body?.amount ?? 1250,
        currency: 'USD',
        customer_id: 'cus_test',
        payment_method_id: 'pm_saved',
        email: 'buyer@example.test',
        order_details: request?.body?.order_details ?? [],
        metadata: request?.body?.metadata ?? {},
      })
    }
    if (String(url).endsWith('/refunds')) {
      return Response.json({ refund_id: 're_test', status: 'succeeded' })
    }
    return Response.json({ customer_id: 'cus_test' })
  },
})

const createdCheckout = await provider.createCheckout!({
  idempotencyKey: 'checkout:test',
  mode: 'payment',
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
assert.match(createdCheckout.checkoutId, /^pay_[a-f0-9]{32}$/)
assert.match(createdCheckout.url, /^https:\/\/site\.test\/checkout\/hyperswitch\?session=/)
assert.equal(createdCheckout.client?.clientSecret, 'pay_test_secret')
assert.equal(createdCheckout.client?.publishableKey, 'pk_snd_test')
assert.equal(createdCheckout.client?.clientUrl, 'https://sdk.sandbox.test/v1')
assert.equal(createdCheckout.client?.cancelUrl, 'https://site.test/cart')
assert.equal(requests.length, 1)
assert.equal(requests[0]?.body?.payment_link, undefined)
assert.equal(requests[0]?.body?.confirm, false)
assert.equal(requests[0]?.body?.return_url, `https://site.test/thanks?session=${createdCheckout.checkoutId}`)
assert.deepEqual(requests[0]?.body?.order_details, [{
  product_id: 'book',
  product_name: 'Book',
  quantity: 2,
  amount: 2500,
  currency: 'USD',
}])
assert.equal(requests[0]?.body?.customer_id, undefined)

const discountedCheckout = await provider.createCheckout!({
  idempotencyKey: 'checkout:coupon-adjusted-price',
  mode: 'payment',
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
assert.equal(requests.at(-1)?.body?.amount, 900)
assert.deepEqual(requests.at(-1)?.body?.order_details, [{
  product_id: 'book',
  product_name: 'Book',
  quantity: 1,
  amount: 900,
  currency: 'USD',
}])
assert.equal(requests.at(-1)?.body?.metadata?.promotions, 'welcome-coupon')
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
const subscriptionRequest = requests.at(-1)!
const subscriptionBody = record(subscriptionRequest.body, 'subscription request body')
const subscriptionMetadata = record(subscriptionBody.metadata, 'subscription request metadata')
const subscriptionLines = subscriptionBody.order_details
assert.ok(Array.isArray(subscriptionLines))
const firstSubscriptionLine = record(subscriptionLines[0], 'subscription request line')
assert.equal(subscriptionBody.amount, 0)
assert.equal(subscriptionBody.setup_future_usage, 'off_session')
assert.deepEqual(subscriptionBody.allowed_payment_method_types, ['card'])
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
  request.init.method === 'POST' && request.url.endsWith('/payments')
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
  requests.filter((request) => request.init.method === 'POST' && request.url.endsWith('/payments')).length,
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
  requests.filter((request) => request.init.method === 'POST' && request.url.endsWith('/payments')).length,
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
assert.equal(requests.at(-1)?.body?.amount, 1200)
assert.equal(requests.at(-1)?.init.headers && new Headers(requests.at(-1)!.init.headers).get('Idempotency-Key'), 'subscription-change:upgrade')
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
assert.equal(customerRequest.url, 'https://sandbox.hyperswitch.io/v2/customers')
assert.equal(customerRequest.body?.merchant_reference_id, 'user_test')
assert.equal(customerRequest.body?.profile_id, undefined)
assert.equal(new Headers(customerRequest.init.headers).get('authorization'), 'api-key=server-only-key')
assert.equal(new Headers(customerRequest.init.headers).get('api-key'), null)

assert.deepEqual(
  await provider.getDefaultPaymentMethod!('cus_test'),
  { paymentMethodId: 'pm_default' },
)
assert.equal(requests.at(-1)?.url, 'https://sandbox.hyperswitch.io/v2/customers/cus_test/saved-payment-methods')
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
assert.equal(paymentIntent.clientSecret, 'pay_client_secret')
assert.equal(requests.at(-1)?.body?.off_session, true)
const incrementalProvider = createPaymentProvider({
  HYPERSWITCH_BASE_URL: 'https://sandbox.hyperswitch.io',
  HYPERSWITCH_API_KEY: 'server-only-key',
  HYPERSWITCH_PROFILE_ID: 'pro_test',
  HYPERSWITCH_PUBLISHABLE_KEY: 'pk_snd_test',
  HYPERSWITCH_WEBHOOK_SECRET: 'webhook-secret',
}, { profileCapabilities: ['checkout.subscription'] }, {
  fetch: async (url, init) => {
    if (String(url).endsWith('/saved-payment-methods') || String(url).endsWith('/payment_methods')) {
      return Response.json({
        customer_payment_methods: [{ id: 'pm_subscription_default', is_default: true }],
      })
    }
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
    return Response.json({
      payment_id: 'pay_incremental',
      status: 'succeeded',
      client_secret: 'pay_client_secret',
      metadata: body.metadata,
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
assert.equal(requests.length, callsBeforeUnsupportedCheckout + 1)

let unconfiguredPayoutRequests = 0
const payoutDisabledProvider = createPaymentProvider({
  HYPERSWITCH_BASE_URL: 'https://sandbox.hyperswitch.io',
  HYPERSWITCH_API_KEY: 'server-only-key',
  HYPERSWITCH_PROFILE_ID: 'pro_test',
  HYPERSWITCH_PUBLISHABLE_KEY: 'pk_snd_test',
  HYPERSWITCH_WEBHOOK_SECRET: 'webhook-secret',
}, {
  profileCapabilities: profileCapabilities.filter((capability) => capability !== 'payouts.connected-accounts'),
}, {
  fetch: async () => {
    unconfiguredPayoutRequests += 1
    return Response.json({ error: 'unexpected payout request' }, { status: 500 })
  },
})
await assert.rejects(
  payoutDisabledProvider.createPayout!({
    accountId: 'cus_test',
    amountMinor: 1000,
    currency: 'USD',
    idempotencyKey: 'payout:undeclared-capability',
    metadata: {},
  }),
  (error) => error instanceof PaymentProviderError &&
    error.code === 'hyperswitch_profile_capability_unavailable',
)
assert.equal(unconfiguredPayoutRequests, 0)

assert.deepEqual(
  await provider.createPortalSession!({ customerId: 'cus_test', returnUrl: 'https://site.test/billing' }),
  { url: 'https://site.test/billing' },
)
assert.deepEqual(
  await provider.createPaymentMethodSession!({
    customerId: 'cus_test',
    returnUrl: 'https://site.test/billing?payment_method=updated',
  }),
  { sdkAuthorization: 'sdk_authorization_test', profileId: 'pro_test' },
)
const methodSessionRequest = requests.at(-1)!
assert.equal(methodSessionRequest.url, 'https://sandbox.hyperswitch.io/v2/payment-method-sessions')
assert.equal(methodSessionRequest.init.method, 'POST')
assert.deepEqual(methodSessionRequest.body, {
  customer_id: 'cus_test',
  storage_type: 'persistent',
  return_url: 'https://site.test/billing?payment_method=updated',
  keep_alive: true,
})
assert.equal(new Headers(methodSessionRequest.init.headers).get('authorization'), 'api-key=server-only-key')
assert.equal(new Headers(methodSessionRequest.init.headers).get('api-key'), null)

const legacyRequests: Array<{ url: string; init: RequestInit }> = []
const legacyProvider = createPaymentProvider({
  HYPERSWITCH_BASE_URL: 'https://legacy.hyperswitch.test',
  HYPERSWITCH_API_KEY: 'legacy-server-key',
  HYPERSWITCH_PROFILE_ID: 'pro_legacy',
  HYPERSWITCH_PUBLISHABLE_KEY: 'pk_snd_legacy',
  HYPERSWITCH_WEBHOOK_SECRET: 'legacy-webhook-secret',
}, { profileCapabilities }, {
  fetch: async (url, init) => {
    const requestUrl = String(url)
    const requestInit = init ?? {}
    legacyRequests.push({ url: requestUrl, init: requestInit })
    if (requestUrl.includes('/v2/')) {
      return Response.json({ error: 'route not found' }, { status: 404 })
    }
    if (requestUrl.endsWith('/customers')) return Response.json({ customer_id: 'cus_legacy' })
    if (requestUrl.endsWith('/payment_methods')) {
      return Response.json({
        customer_payment_methods: [{ id: 'pm_legacy', is_default: true }],
      })
    }
    if (requestUrl.endsWith('/v1/payment-method-sessions')) {
      return Response.json({ sdk_authorization: 'sdk_authorization_legacy' })
    }
    return Response.json({})
  },
})
assert.deepEqual(
  await legacyProvider.createCustomer!({ userId: 'legacy-user', email: 'legacy@example.test' }),
  { customerId: 'cus_legacy' },
)
assert.deepEqual(await legacyProvider.getDefaultPaymentMethod!('cus_legacy'), {
  paymentMethodId: 'pm_legacy',
})
assert.deepEqual(
  await legacyProvider.createPaymentMethodSession!({
    customerId: 'cus_legacy',
    returnUrl: 'https://site.test/billing',
  }),
  { sdkAuthorization: 'sdk_authorization_legacy', profileId: 'pro_legacy' },
)
assert.ok(legacyRequests.some(({ url, init }) =>
  url.endsWith('/customers') &&
  new Headers(init.headers).get('api-key') === 'legacy-server-key'))
assert.ok(legacyRequests.some(({ url, init }) =>
  url.endsWith('/v1/payment-method-sessions') &&
  new Headers(init.headers).get('api-key') === 'legacy-server-key'))

const payoutAccount = await provider.createPayoutAccount!({
  userId: 'user_test',
  email: 'provider@example.test',
  kind: 'managed',
  returnUrl: 'https://site.test/payouts/return',
  refreshUrl: 'https://site.test/payouts/refresh',
})
assert.equal(payoutAccount.accountId, 'cus_test')
assert.equal(payoutAccount.ready, true)
assert.match(payoutAccount.onboardingUrl, /^https:\/\/site\.test\/app\/usage\?/)
assert.equal(new URL(payoutAccount.onboardingUrl).searchParams.get('payout_setup'), '1')
assert.equal(
  new URL(payoutAccount.onboardingUrl).searchParams.get('payout_return'),
  '/payouts/return',
)
assert.deepEqual(await provider.retrievePayoutAccount!('cus_test'), {
  accountId: 'cus_test',
  ready: true,
  detailsSubmitted: true,
})
const payout = await provider.createPayout!({
  accountId: 'cus_test',
  amountMinor: 1000,
  currency: 'USD',
  idempotencyKey: 'payout:test',
  metadata: { payout_ref: 'payout:test' },
})
assert.match(payout.payoutId, /^po_[a-f0-9]{27}$/)
assert.equal(payout.status, 'initiated')
const payoutRequest = requests.find((request) =>
  request.init.method === 'POST' && request.body?.payout_id === payout.payoutId
)!
assert.equal(payoutRequest.url, 'https://sandbox.hyperswitch.io/payouts/create')
assert.equal(payoutRequest.body?.payout_token, 'payout_token_default')
assert.deepEqual(payoutRequest.body?.customer, { id: 'cus_test' })
assert.equal(payoutRequest.body?.payout_type, 'card')
assert.equal(payoutRequest.body?.confirm, true)
assert.equal(payoutRequest.body?.auto_fulfill, true)
assert.equal(payoutRequest.body?.amount, 1000)
assert.equal(payoutRequest.body?.merchant_order_reference_id, 'payout:test')
assert.equal(
  new Headers(payoutRequest.init.headers).get('Idempotency-Key'),
  'payout:test',
)
const retryPayout = await provider.createPayout!({
  accountId: 'cus_test',
  amountMinor: 1000,
  currency: 'USD',
  idempotencyKey: 'payout:test',
  metadata: { payout_ref: 'payout:test' },
})
assert.equal(retryPayout.payoutId, payout.payoutId)
assert.equal(
  requests.filter((request) =>
    request.init.method === 'POST' && request.body?.payout_id === payout.payoutId
  ).length,
  1,
)

payoutMethodsAvailable = false
const payoutRequestsBeforeMissingMethod = requests.filter((request) =>
  request.url.endsWith('/payouts/create')
).length
assert.deepEqual(await provider.retrievePayoutAccount!('cus_test'), {
  accountId: 'cus_test',
  ready: false,
  detailsSubmitted: false,
})
await assert.rejects(
  provider.createPayout!({
    accountId: 'cus_test',
    amountMinor: 1000,
    currency: 'USD',
    idempotencyKey: 'payout:no-method',
    metadata: {},
  }),
  (error) => error instanceof PaymentProviderError &&
    error.code === 'hyperswitch_payout_method_unavailable' &&
    /No payout was sent/.test(error.message),
)
assert.equal(
  requests.filter((request) => request.url.endsWith('/payouts/create')).length,
  payoutRequestsBeforeMissingMethod,
)
payoutMethodsAvailable = true
payoutStatus = 'failed'
await assert.rejects(
  provider.createPayout!({
    accountId: 'cus_test',
    amountMinor: 1000,
    currency: 'USD',
    idempotencyKey: 'payout:failed',
    metadata: {},
  }),
  (error) => error instanceof PaymentProviderError &&
    error.code === 'hyperswitch_payout_failed',
)

console.log('hyperswitch adapter: checkout preflight, customer, refund, catalog, saved payment method, and top-up checks passed')

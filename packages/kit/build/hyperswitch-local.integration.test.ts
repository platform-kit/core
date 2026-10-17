import { createPaymentProvider } from '../supabase/functions/_shared/hyperswitch-payment-provider.ts'

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`${name} is required for the local Hyperswitch API smoke test.`)
  return value
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const baseUrl = new URL(requiredEnv('HYPERSWITCH_BASE_URL'))
if (baseUrl.protocol !== 'http:' || baseUrl.hostname !== '127.0.0.1' ||
  baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) {
  throw new Error('The local Hyperswitch API smoke test accepts only a loopback HTTP origin at 127.0.0.1.')
}

const provider = createPaymentProvider({
  HYPERSWITCH_BASE_URL: baseUrl.origin,
  HYPERSWITCH_API_KEY: requiredEnv('HYPERSWITCH_API_KEY'),
  HYPERSWITCH_PROFILE_ID: requiredEnv('HYPERSWITCH_PROFILE_ID'),
  HYPERSWITCH_PUBLISHABLE_KEY: requiredEnv('HYPERSWITCH_PUBLISHABLE_KEY'),
  HYPERSWITCH_CLIENT_URL: Deno.env.get('HYPERSWITCH_CLIENT_URL'),
  HYPERSWITCH_WEBHOOK_SECRET: requiredEnv('HYPERSWITCH_WEBHOOK_SECRET'),
}, {
  profileCapabilities: [
    'checkout.one-time',
    'checkout.subscription',
    'checkout.confirm',
    'customer.create',
    'refunds',
  ],
})

const customerUserId = `platformkit-local-smoke-${crypto.randomUUID()}`
const customerEmail = `${customerUserId}@example.test`
const customer = await provider.createCustomer!({ userId: customerUserId, email: customerEmail })
assert(customer.customerId.length > 0, 'Hyperswitch did not return a customer id.')

let paymentMethodSessionAvailable = true
try {
  const session = await provider.createPaymentMethodSession!({
    customerId: customer.customerId,
    returnUrl: 'http://127.0.0.1:3000/billing?payment_method=updated#usage',
  })
  assert(session.sdkAuthorization.length > 0,
    'Hyperswitch did not return payment-method management authorization.')
} catch (error) {
  if (!(error && typeof error === 'object' && 'status' in error && error.status === 404)) throw error
  paymentMethodSessionAvailable = false
  console.warn('Hyperswitch local API smoke test skipped payment-method sessions: the V2 Router returned 404.')
}

const checkout = await provider.createCheckout!({
  idempotencyKey: `platformkit-local-smoke:${crypto.randomUUID()}`,
  customer: {
    userId: customerUserId,
    email: customerEmail,
    providerCustomerId: customer.customerId,
  },
  customerEmail,
  mode: 'payment',
  lines: [{
    offerKey: 'local-smoke',
    sku: 'local-smoke',
    name: 'PlatformKit local API smoke test',
    currency: 'USD',
    billing: 'once',
    unitAmountMinor: 100,
    quantity: 1,
  }],
  successUrl: 'http://127.0.0.1:3000/checkout/return?session={CHECKOUT_ID}',
  cancelUrl: 'http://127.0.0.1:3000/store?checkout=cancel',
  metadata: { platformkit_local_api_smoke_test: '1' },
  currency: 'USD',
})
assert(checkout.client, 'Hyperswitch did not return client confirmation data.')

const snapshot = await provider.retrieveCheckout!(checkout.checkoutId)
assert(snapshot.paymentStatus !== 'paid',
  'The API smoke test created no payment, but the checkout is already marked paid.')

console.log(
  `Hyperswitch V2 API smoke passed: customer creation, ${
    paymentMethodSessionAvailable ? 'payment-method session' : 'no payment-method session'
  }, intent creation, and unpaid retrieval. No card was submitted; browser payment, paid-status, and refund remain unverified.`,
)

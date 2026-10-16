import { createPaymentProvider } from '../supabase/functions/_shared/hyperswitch-payment-provider.ts'

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`${name} is required for the local Hyperswitch integration test.`)
  return value
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function responseJson(
  response: Response,
  action: string,
  sensitiveValues: readonly string[] = [],
): Promise<Record<string, unknown>> {
  const text = await response.text()
  let result: unknown
  try {
    result = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Hyperswitch ${action} returned a non-JSON response (${response.status}).`)
  }
  if (!response.ok) {
    const payload = result as Record<string, unknown>
    const nestedError = payload.error && typeof payload.error === 'object' && !Array.isArray(payload.error)
      ? payload.error as Record<string, unknown>
      : {}
    const code = payload.error_code ?? payload.code ?? nestedError.code
    const message = [payload.error_message, payload.message, nestedError.message, payload.error]
      .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    let safeMessage = message ?? ''
    for (const value of sensitiveValues) safeMessage = safeMessage.replaceAll(value, '[redacted]')
    safeMessage = safeMessage
      .replace(/\b\d{12,19}\b/g, '[redacted-number]')
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted-token]')
      .slice(0, 240)
    const safeCode = typeof code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(code)
      ? `, code: ${code}`
      : ''
    const safeDetail = safeMessage ? ` ${safeMessage}` : ''
    throw new Error(`Hyperswitch ${action} failed (${response.status}${safeCode}).${safeDetail}`)
  }
  assert(result && typeof result === 'object' && !Array.isArray(result),
    `Hyperswitch ${action} returned an invalid response.`)
  return result as Record<string, unknown>
}

const baseUrl = requiredEnv('HYPERSWITCH_BASE_URL')
const apiKey = requiredEnv('HYPERSWITCH_API_KEY')
const profileId = requiredEnv('HYPERSWITCH_PROFILE_ID')
const configuration = {
  profileCapabilities: [
    'checkout.one-time',
    'checkout.subscription',
    'checkout.confirm',
    'customer.create',
    'refunds',
  ],
}
const provider = createPaymentProvider({
  HYPERSWITCH_BASE_URL: baseUrl,
  HYPERSWITCH_API_KEY: apiKey,
  HYPERSWITCH_PROFILE_ID: profileId,
  HYPERSWITCH_PUBLISHABLE_KEY: requiredEnv('HYPERSWITCH_PUBLISHABLE_KEY'),
  HYPERSWITCH_CLIENT_URL: Deno.env.get('HYPERSWITCH_CLIENT_URL'),
  HYPERSWITCH_WEBHOOK_SECRET: requiredEnv('HYPERSWITCH_WEBHOOK_SECRET'),
}, configuration)

const customerUserId = `platformkit-local-integration-${crypto.randomUUID()}`
const customerEmail = `${customerUserId}@example.test`
const customer = await provider.createCustomer!({ userId: customerUserId, email: customerEmail })
assert(customer.customerId.length > 0, 'Hyperswitch did not return a customer id.')
try {
  const paymentMethodSession = await provider.createPaymentMethodSession!({
    customerId: customer.customerId,
    returnUrl: 'http://127.0.0.1:3000/billing?payment_method=updated#usage',
  })
  assert(paymentMethodSession.sdkAuthorization.length > 0,
    'Hyperswitch did not return payment-method management authorization.')
} catch (error) {
  if (!(error && typeof error === 'object' && 'status' in error && error.status === 404)) throw error
  console.warn(
    'Hyperswitch local integration skipped saved-method management: the configured local API does not expose payment-method sessions.',
  )
}

const checkout = await provider.createCheckout!({
  idempotencyKey: `platformkit-local-integration:${crypto.randomUUID()}`,
  customer: {
    userId: customerUserId,
    email: customerEmail,
    providerCustomerId: customer.customerId,
  },
  customerEmail,
  mode: 'payment',
  lines: [{
    offerKey: 'local-it',
    sku: 'local-it',
    name: 'PlatformKit local integration test',
    currency: 'USD',
    billing: 'once',
    unitAmountMinor: 500,
    quantity: 1,
  }],
  successUrl: 'http://127.0.0.1:3000/checkout/return?session={CHECKOUT_ID}',
  cancelUrl: 'http://127.0.0.1:3000/store?checkout=cancel',
  metadata: { platformkit_local_integration_test: '1' },
  currency: 'USD',
})
assert(checkout.client, 'Hyperswitch did not return client confirmation data.')

const confirmation = await fetch(
  new URL(`/payments/${encodeURIComponent(checkout.checkoutId)}/confirm`, baseUrl),
  {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'x-profile-id': profileId,
      'content-type': 'application/json',
      'idempotency-key': `platformkit-local-confirm:${crypto.randomUUID()}`,
    },
    body: JSON.stringify({
      payment_method: 'card',
      payment_method_type: 'credit',
      payment_method_data: {
        card: {
          card_number: '4242424242424242',
          card_exp_month: '12',
          card_exp_year: '30',
          card_cvc: '123',
          card_holder_name: 'PlatformKit Local Test',
        },
      },
      return_url: checkout.client.successUrl,
    }),
  },
)
const confirmed = await responseJson(confirmation, 'payment confirmation', [
  apiKey,
  requiredEnv('HYPERSWITCH_WEBHOOK_SECRET'),
  '4242424242424242',
])
assert(typeof confirmed.status === 'string', 'Hyperswitch confirmation omitted payment status.')

const snapshot = await provider.retrieveCheckout!(checkout.checkoutId)
const confirmationError = String(confirmed.error_message ?? '')
  .replace(/\b\d{12,19}\b/g, '[redacted-number]')
  .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted-token]')
  .slice(0, 200)
assert(snapshot.status === 'complete' && snapshot.paymentStatus === 'paid',
  `Hyperswitch payment was not verified as complete (status: ${snapshot.status}, payment: ${snapshot.paymentStatus}, provider status: ${String(confirmed.status)}, connector: ${String(confirmed.connector)}, error code: ${String(confirmed.error_code)}, message: ${confirmationError}).`)

const refund = await provider.refund!({
  paymentId: checkout.checkoutId,
  idempotencyKey: `platformkit-local-refund:${crypto.randomUUID()}`,
})
assert(typeof refund.refundId === 'string' && refund.refundId.length > 0,
  'Hyperswitch did not return a refund id.')
assert(['succeeded', 'success'].includes(refund.status.toLowerCase()),
  `Hyperswitch did not confirm the refund (status: ${refund.status}).`)

const subscriptionCheckout = await provider.createCheckout!({
  idempotencyKey: `platformkit-local-subscription:${crypto.randomUUID()}`,
  customer: {
    userId: customerUserId,
    email: customerEmail,
    providerCustomerId: customer.customerId,
  },
  customerEmail,
  mode: 'subscription',
  lines: [{
    offerKey: 'local-it-subscription',
    sku: 'local-it-subscription',
    name: 'PlatformKit local saved-payment integration test',
    currency: 'USD',
    billing: 'subscription',
    interval: 'month',
    unitAmountMinor: 500,
    quantity: 1,
  }],
  successUrl: 'http://127.0.0.1:3000/checkout/return?session={CHECKOUT_ID}',
  cancelUrl: 'http://127.0.0.1:3000/store?checkout=cancel',
  metadata: { platformkit_local_integration_test: '1' },
  currency: 'USD',
})
try {
  const subscriptionConfirmation = await fetch(
    new URL(`/payments/${encodeURIComponent(subscriptionCheckout.checkoutId)}/confirm`, baseUrl),
    {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'x-profile-id': profileId,
        'content-type': 'application/json',
        'idempotency-key': `platformkit-local-subscription-confirm:${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        payment_method: 'card',
        payment_method_type: 'credit',
        payment_method_data: {
          card: {
            card_number: '4242424242424242',
            card_exp_month: '12',
            card_exp_year: '30',
            card_cvc: '123',
            card_holder_name: 'PlatformKit Local Test',
          },
        },
        return_url: subscriptionCheckout.client!.successUrl,
      }),
    },
  )
  const confirmedSubscription = await responseJson(subscriptionConfirmation, 'subscription checkout confirmation', [
    apiKey,
    requiredEnv('HYPERSWITCH_WEBHOOK_SECRET'),
    '4242424242424242',
  ])
  assert(typeof confirmedSubscription.status === 'string',
    'Hyperswitch subscription checkout confirmation omitted payment status.')
  const subscriptionPaymentResponse = await fetch(
    new URL(`/payments/${encodeURIComponent(subscriptionCheckout.checkoutId)}?force_sync=true`, baseUrl),
    { headers: { 'api-key': apiKey, 'x-profile-id': profileId } },
  )
  const persistedSubscriptionPayment = await responseJson(
    subscriptionPaymentResponse,
    'subscription payment retrieval',
    [apiKey, requiredEnv('HYPERSWITCH_WEBHOOK_SECRET')],
  )
  if (persistedSubscriptionPayment.connector === 'fauxpay') {
    console.warn(
      'Hyperswitch local integration skipped off-session incremental settlement: the configured Fauxpay connector does not return reusable payment methods.',
    )
  } else {
    const savedPaymentMethod = await provider.getDefaultPaymentMethod!(customer.customerId)
    assert(savedPaymentMethod.paymentMethodId,
      `Hyperswitch did not expose the payment method saved for off-session subscription use (connector: ${String(persistedSubscriptionPayment.connector)}).`)
    const subscriptionSnapshot = await provider.retrieveCheckout!(subscriptionCheckout.checkoutId)
    assert(subscriptionSnapshot.status === 'complete' && subscriptionSnapshot.paymentStatus === 'paid',
      'Hyperswitch did not verify the subscription checkout as complete and paid.')

    const incrementalPayment = await provider.createPaymentIntent!({
      amountMinor: 100,
      currency: 'USD',
      customerId: customer.customerId,
      paymentMethodId: savedPaymentMethod.paymentMethodId,
      description: 'PlatformKit local incremental usage settlement',
      metadata: {
        platformkit_usage_incremental: '1',
        platformkit_local_integration_test: '1',
      },
      idempotencyKey: `platformkit-local-incremental:${crypto.randomUUID()}`,
    })
    assert(['succeeded', 'success'].includes(incrementalPayment.status.toLowerCase()),
      `Hyperswitch did not settle incremental usage off-session (status: ${incrementalPayment.status}).`)
    try {
      const verifiedIncrementalPayment = await provider.retrievePaymentIntent!(incrementalPayment.paymentIntentId)
      assert(['succeeded', 'success'].includes(verifiedIncrementalPayment.status.toLowerCase()),
        `Hyperswitch did not verify the incremental payment (status: ${verifiedIncrementalPayment.status}).`)
    } finally {
      const incrementalRefund = await provider.refund!({
        paymentId: incrementalPayment.paymentIntentId,
        idempotencyKey: `platformkit-local-incremental-refund:${crypto.randomUUID()}`,
      })
      assert(['succeeded', 'success'].includes(incrementalRefund.status.toLowerCase()),
        `Hyperswitch did not refund the incremental payment (status: ${incrementalRefund.status}).`)
    }
  }
} finally {
  const subscriptionRefund = await provider.refund!({
    paymentId: subscriptionCheckout.checkoutId,
    idempotencyKey: `platformkit-local-subscription-refund:${crypto.randomUUID()}`,
  })
  assert(['succeeded', 'success'].includes(subscriptionRefund.status.toLowerCase()),
    `Hyperswitch did not refund the saved-payment test checkout (status: ${subscriptionRefund.status}).`)
}

console.log('Hyperswitch local integration passed: customer creation, checkout, card confirmation, normalized retrieval, and refunds.')

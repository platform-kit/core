/*
 * Server-side steps for hyperswitch-browser.integration.mjs. Run with Deno:
 *   seed   create a customer and a one-time checkout through the adapter; prints the checkout JSON
 *   finish <checkoutId> <customerId>   retrieve the checkout, count the customer's saved methods, refund
 * Settings arrive as HYPERSWITCH_* environment variables.
 */
import { createPaymentProvider } from '../supabase/functions/_shared/hyperswitch-payment-provider.ts'

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`${name} is required.`)
  return value
}

const baseUrl = requiredEnv('HYPERSWITCH_BASE_URL')
const apiKey = requiredEnv('HYPERSWITCH_API_KEY')
const profileId = requiredEnv('HYPERSWITCH_PROFILE_ID')
const provider = createPaymentProvider({
  HYPERSWITCH_BASE_URL: baseUrl,
  HYPERSWITCH_API_KEY: apiKey,
  HYPERSWITCH_PROFILE_ID: profileId,
  HYPERSWITCH_PUBLISHABLE_KEY: requiredEnv('HYPERSWITCH_PUBLISHABLE_KEY'),
  HYPERSWITCH_CLIENT_URL: Deno.env.get('HYPERSWITCH_CLIENT_URL'),
  HYPERSWITCH_PAYMENT_METHODS_PREFIX: Deno.env.get('HYPERSWITCH_PAYMENT_METHODS_PREFIX'),
  HYPERSWITCH_WEBHOOK_SECRET: requiredEnv('HYPERSWITCH_WEBHOOK_SECRET'),
}, { profileCapabilities: ['checkout.one-time', 'checkout.confirm', 'customer.create', 'refunds'] })

const [command, ...args] = Deno.args
if (command === 'seed') {
  const siteUrl = requiredEnv('SITE_URL')
  const userId = `browser-e2e-${crypto.randomUUID()}`
  const email = `${userId}@example.test`
  const customer = await provider.createCustomer!({ userId, email })
  const checkout = await provider.createCheckout!({
    idempotencyKey: `browser-e2e:${crypto.randomUUID()}`,
    customer: { userId, email, providerCustomerId: customer.customerId },
    customerEmail: email,
    mode: 'payment',
    lines: [{
      offerKey: 'browser-e2e', sku: 'browser-e2e', name: 'Browser end-to-end test',
      currency: 'USD', billing: 'once', unitAmountMinor: 100, quantity: 1,
    }],
    successUrl: `${siteUrl}/thanks?checkout=success`,
    cancelUrl: `${siteUrl}/store`,
    metadata: { browser_e2e: '1' },
    currency: 'USD',
  })
  console.log(JSON.stringify({
    checkoutId: checkout.checkoutId,
    customerId: customer.customerId,
    client: checkout.client,
  }))
} else if (command === 'finish') {
  const [checkoutId, customerId] = args
  const snapshot = await provider.retrieveCheckout!(checkoutId!) as unknown as Record<string, unknown>
  const prefix = Deno.env.get('HYPERSWITCH_PAYMENT_METHODS_PREFIX') || 'v1'
  const saved = await fetch(
    `${baseUrl}/${prefix}/customers/${encodeURIComponent(customerId!)}/saved-payment-methods`,
    { headers: { Authorization: `api-key=${apiKey}`, 'X-Profile-Id': profileId } },
  )
  const savedBody = await saved.json() as { customer_payment_methods?: unknown[] }
  const refund = await provider.refund!({
    paymentId: checkoutId!,
    idempotencyKey: `browser-e2e-refund:${crypto.randomUUID()}`,
  })
  console.log(JSON.stringify({
    paymentState: snapshot.paymentState ?? snapshot.paymentStatus,
    savedMethods: Array.isArray(savedBody.customer_payment_methods) ? savedBody.customer_payment_methods.length : null,
    refundStatus: refund.status,
  }))
} else {
  throw new Error('Usage: seed | finish <checkoutId> <customerId>')
}

import assert from 'node:assert/strict'
import StripeSdk from 'npm:stripe@17'
import { createPaymentProvider } from '../supabase/functions/_shared/stripe-payment-provider.ts'

/*
 * What an incremental usage charge relies on Stripe for, against Stripe test mode: the off-session
 * charge the settlement makes on a saved card, and the outcomes it must recover from.
 *
 * - A card that needs 3-D Secure comes back as action required with a client secret, and asking again
 *   with the same idempotency key (the settlement's retry after an uncertain outcome) returns the same
 *   PaymentIntent rather than a second charge.
 * - The customer completes the verification — on the usage page Stripe.js does this with the client
 *   secret; here the PaymentIntent is confirmed on-session and Stripe's test 3-D Secure page is
 *   completed in a headless browser — and retrieval then reports the payment succeeded.
 * - A declined card is a declined attempt: the same key returns that attempt, and the retry under a new
 *   key with another saved card succeeds once.
 *
 * Every charge it makes is refunded and the customer is deleted.
 */
Deno.test('Stripe test mode: an incremental usage charge needing action, a decline, and their recovery', async () => {
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!secretKey?.startsWith('sk_test_')) throw new Error('This integration suite requires a Stripe test-mode secret key.')
  const stripe = new StripeSdk(secretKey, { maxNetworkRetries: 1 })
  const provider = createPaymentProvider({}, { stripe })
  const run = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  const returnUrl = `https://platformkit.test/usage/return/${run}`
  const helper = new URL('./stripe-3ds-complete.mjs', import.meta.url).pathname
  const paid: string[] = []
  const customer = await stripe.customers.create({ description: `PlatformKit usage recovery ${run}` })

  const attach = async (testMethod: string) => {
    const method = await stripe.paymentMethods.attach(testMethod, { customer: customer.id })
    await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: method.id } })
    return method.id
  }
  const charge = (paymentMethodId: string, idempotencyKey: string) => provider.createPaymentIntent({
    amountMinor: 700,
    currency: 'usd',
    customerId: customer.id,
    paymentMethodId,
    description: 'PlatformKit incremental usage (integration test)',
    metadata: { platformkit_test: run, kind: 'incremental-usage' },
    idempotencyKey,
  })

  try {
    /* 1. a card that needs 3-D Secure */
    const authCard = await attach('pm_card_authenticationRequired')
    const first = await charge(authCard, `pkit-usage-${run}-threshold-1`)
    assert.equal(first.status, 'requires_action', 'an authentication-required card is action required, not a decline')
    assert.ok(first.clientSecret, 'the action-required charge carries the client secret the usage page needs')

    const again = await charge(authCard, `pkit-usage-${run}-threshold-1`)
    assert.equal(again.paymentIntentId, first.paymentIntentId, 'an uncertain retry under the same key is the same charge')

    /* 2. the customer completes the verification */
    const confirmed = await stripe.paymentIntents.confirm(first.paymentIntentId, {
      payment_method: authCard,
      return_url: returnUrl,
    })
    assert.equal(confirmed.status, 'requires_action')
    const redirect = confirmed.next_action?.redirect_to_url?.url
    assert.ok(redirect, 'Stripe offers the 3-D Secure redirect')
    const completed = await new Deno.Command('node', { args: [helper, redirect, returnUrl], stdout: 'piped', stderr: 'piped' }).output()
    assert.equal(completed.code, 0, new TextDecoder().decode(completed.stderr))
    let settled = await provider.retrievePaymentIntent(first.paymentIntentId)
    for (let attempt = 0; attempt < 10 && settled.status !== 'succeeded'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      settled = await provider.retrievePaymentIntent(first.paymentIntentId)
    }
    assert.equal(settled.status, 'succeeded', 'after the verification, retrieval reports the charge paid')
    paid.push(first.paymentIntentId)
    assert.equal((await charge(authCard, `pkit-usage-${run}-threshold-1`)).paymentIntentId, first.paymentIntentId,
      'the settled key still names the one charge')

    /* 3. a decline, and the retry as a new attempt */
    const declinedCard = await attach('pm_card_chargeCustomerFail')   /* saves fine, declines when charged */
    const declined = await charge(declinedCard, `pkit-usage-${run}-threshold-2-a`)
    assert.equal(declined.status, 'requires_payment_method', 'a declined card is a failed attempt the customer can retry')
    assert.equal((await charge(declinedCard, `pkit-usage-${run}-threshold-2-a`)).paymentIntentId, declined.paymentIntentId,
      'the declined attempt is not charged again under its own key')

    const goodCard = await attach('pm_card_visa')
    const retried = await charge(goodCard, `pkit-usage-${run}-threshold-2-b`)
    assert.equal(retried.status, 'succeeded', 'the retry with an updated card succeeds')
    assert.notEqual(retried.paymentIntentId, declined.paymentIntentId, 'the retry is a new attempt')
    paid.push(retried.paymentIntentId)
  } finally {
    for (const id of paid) await provider.refund({ paymentId: id, idempotencyKey: `pkit-usage-${run}-refund-${id}` })
    await stripe.customers.del(customer.id)
  }
})

import assert from 'node:assert/strict'
import StripeSdk from 'npm:stripe@17'
import { createPaymentProvider } from '../supabase/functions/_shared/stripe-payment-provider.ts'
import type { PaymentCatalogOffer } from '../src/payment-provider.d.ts'

Deno.test('Stripe test-mode adapter journey exercises billing and payment operations', async () => {
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!secretKey?.startsWith('sk_test_')) {
    throw new Error('This integration suite requires a Stripe test-mode secret key.')
  }

  const stripe = new StripeSdk(secretKey, { maxNetworkRetries: 1 })
  const provider = createPaymentProvider({}, { stripe })
  const suffix = crypto.randomUUID().replaceAll('-', '')
  const prefix = `pkit_${suffix.slice(0, 12)}`
  const meterName = `${prefix}_usage`
  const offers: PaymentCatalogOffer[] = [
    {
      offerKey: `${prefix}-once`,
      sku: `${prefix}-once`,
      name: 'PlatformKit Integration Test Item',
      kind: 'one-time',
      currency: 'usd',
      unitAmountMinor: 500,
    },
    {
      offerKey: `${prefix}-basic`,
      sku: `${prefix}-basic`,
      name: 'PlatformKit Integration Test Basic',
      kind: 'subscription',
      currency: 'usd',
      unitAmountMinor: 1200,
      interval: 'month',
    },
    {
      offerKey: `${prefix}-premium`,
      sku: `${prefix}-premium`,
      name: 'PlatformKit Integration Test Premium',
      kind: 'subscription',
      currency: 'usd',
      unitAmountMinor: 1800,
      interval: 'month',
    },
    {
      offerKey: `${prefix}-metered`,
      sku: `${prefix}-metered`,
      name: 'PlatformKit Integration Test Metered',
      kind: 'subscription',
      currency: 'usd',
      unitAmountMinor: 500,
      interval: 'month',
      usage: {
        meter: meterName,
        unit: 'event',
        rateMicros: 1_000_000,
        overagePriceMicros: 1_000_000,
      },
    },
  ]

  let customerId: string | undefined
  let paymentIntentId: string | undefined
  let actionRequiredPaymentIntentId: string | undefined
  let subscriptionId: string | undefined
  let scheduleId: string | undefined
  let payoutAccountId: string | undefined
  let oneTimeCheckoutId: string | undefined
  let subscriptionCheckoutId: string | undefined
  let couponId: string | undefined
  let promotionCodeId: string | undefined
  let testFailure: unknown
  let phase = 'recovering stale test catalog products'
  const retireTestProduct = async (productId: string) => {
    const product = await stripe.products.retrieve(productId)
    if (!product.active) return
    const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 })
    const defaultPriceId = typeof product.default_price === 'string'
      ? product.default_price
      : product.default_price?.id
    for (const price of prices.data) {
      if (price.id !== defaultPriceId) await stripe.prices.update(price.id, { active: false })
    }
    await stripe.products.update(productId, { active: false })
  }

  try {
    for (const name of [
      'PlatformKit Integration Test Item',
      'PlatformKit Integration Test Basic',
      'PlatformKit Integration Test Premium',
      'PlatformKit Integration Test Metered',
    ]) {
      const staleProducts = await stripe.products.search({ query: `name:'${name}'`, limit: 100 })
      for (const product of staleProducts.data) {
        if (/^pkit_[a-f0-9]{12}-(once|basic|premium|metered)$/.test(product.metadata.key ?? '')) {
          await retireTestProduct(product.id)
        }
      }
    }
    phase = 'creating the test customer and payment method'
    const customer = await provider.createCustomer!({
      userId: `${prefix}-user`,
      email: `${prefix}@example.test`,
    })
    customerId = customer.customerId

    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: { token: 'tok_visa' },
    })
    await stripe.paymentMethods.attach(paymentMethod.id, { customer: customerId })
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethod.id },
    })
    assert.deepEqual(await provider.getDefaultPaymentMethod!(customerId), {
      paymentMethodId: paymentMethod.id,
    })

    phase = 'creating and retrieving an action-required incremental usage payment'
    const actionRequiredPayment = await provider.createPaymentIntent!({
      amountMinor: 500,
      currency: 'usd',
      customerId,
      paymentMethodId: 'pm_card_authenticationRequired',
      description: 'PlatformKit test-mode incremental usage authentication',
      metadata: { platformkit_usage_incremental: '1', user_id: `${prefix}-user` },
      idempotencyKey: `${prefix}:incremental:authentication`,
    })
    actionRequiredPaymentIntentId = actionRequiredPayment.paymentIntentId
    assert.equal(actionRequiredPayment.status, 'requires_action')
    assert.ok(actionRequiredPayment.clientSecret)
    const retrievedActionRequiredPayment = await provider.retrievePaymentIntent!(
      actionRequiredPayment.paymentIntentId,
    )
    assert.equal(retrievedActionRequiredPayment.status, 'requires_action')
    assert.equal(retrievedActionRequiredPayment.clientSecret, actionRequiredPayment.clientSecret)

    const catalogOffers: Record<string, { productId: string; priceId: string; usagePriceId?: string; made?: boolean }> = {}
    for (const offer of offers) {
      phase = `synchronizing catalog offer ${offer.offerKey}`
      const result = await provider.syncCatalog!([offer])
      Object.assign(catalogOffers, result.offers)
    }
    const catalog = { provider: 'stripe', offers: catalogOffers }
    const repeatedOffers: Record<string, { productId: string; priceId: string; usagePriceId?: string; made?: boolean }> = {}
    for (const offer of offers) {
      phase = `verifying catalog idempotency for ${offer.offerKey}`
      const result = await provider.syncCatalog!([offer])
      Object.assign(repeatedOffers, result.offers)
    }
    const repeatedCatalog = { provider: 'stripe', offers: repeatedOffers }
    for (const offer of offers) {
      const first = catalog.offers[offer.offerKey]
      const repeated = repeatedCatalog.offers[offer.offerKey]
      assert.ok(first?.productId && first.priceId, `Stripe did not create catalog records for ${offer.offerKey}.`)
      assert.equal(repeated?.productId, first.productId, 'Catalog sync changed an existing product identity.')
      assert.equal(repeated?.priceId, first.priceId, 'Catalog sync changed an unchanged price identity.')
      assert.equal(repeated?.made, false, 'Idempotent catalog sync reported new records.')
    }
    const oneTimePrice = catalog.offers[offers[0].offerKey].priceId
    const basicPrice = catalog.offers[offers[1].offerKey].priceId
    const premiumPrice = catalog.offers[offers[2].offerKey].priceId

    phase = 'creating and retrieving one-time checkout'
    const checkout = await provider.createCheckout!({
      idempotencyKey: `${prefix}:checkout:once`,
      customer: { userId: `${prefix}-user`, providerCustomerId: customerId },
      mode: 'payment',
      lines: [{
        offerKey: offers[0].offerKey,
        sku: offers[0].sku,
        name: offers[0].name,
        currency: 'usd',
        billing: 'once',
        unitAmountMinor: offers[0].unitAmountMinor,
        quantity: 1,
        providerPriceId: oneTimePrice,
      }],
      successUrl: 'https://platformkit.test/checkout/return?session={CHECKOUT_ID}',
      cancelUrl: 'https://platformkit.test/store?checkout=cancel',
      metadata: { user_id: `${prefix}-user` },
      allowPromotionCodes: true,
    })
    oneTimeCheckoutId = checkout.checkoutId
    assert.ok(checkout.url.startsWith('https://checkout.stripe.com/'))
    const openCheckout = await provider.retrieveCheckout!(checkout.checkoutId)
    assert.equal(openCheckout.status, 'open')
    assert.equal(openCheckout.paymentStatus, 'unpaid')
    assert.equal(openCheckout.lines[0]?.offerKey, offers[0].offerKey)
    assert.equal(openCheckout.lines[0]?.unitAmountMinor, 500)
    await stripe.checkout.sessions.expire(checkout.checkoutId)
    oneTimeCheckoutId = undefined
    assert.equal((await provider.retrieveCheckout!(checkout.checkoutId)).status, 'expired')

    phase = 'creating and retrieving subscription checkout'
    const trialCheckout = await provider.createCheckout!({
      idempotencyKey: `${prefix}:checkout:trial`,
      customer: { userId: `${prefix}-user`, providerCustomerId: customerId },
      mode: 'subscription',
      trialDays: 14,
      lines: [{
        offerKey: offers[1].offerKey,
        sku: offers[1].sku,
        name: offers[1].name,
        currency: 'usd',
        billing: 'subscription',
        interval: 'month',
        unitAmountMinor: offers[1].unitAmountMinor,
        quantity: 1,
        providerPriceId: basicPrice,
      }],
      successUrl: 'https://platformkit.test/checkout/return?session={CHECKOUT_ID}',
      cancelUrl: 'https://platformkit.test/store?checkout=cancel',
      metadata: { user_id: `${prefix}-user` },
      allowPromotionCodes: true,
    })
    subscriptionCheckoutId = trialCheckout.checkoutId
    const openTrialCheckout = await provider.retrieveCheckout!(trialCheckout.checkoutId)
    assert.equal(openTrialCheckout.mode, 'subscription')
    assert.equal(openTrialCheckout.status, 'open')
    assert.equal(openTrialCheckout.lines[0]?.interval, 'month')
    await stripe.checkout.sessions.expire(trialCheckout.checkoutId)
    subscriptionCheckoutId = undefined

    phase = 'reporting metered usage'
    const usageResult = await provider.reportUsage!({
      idempotencyKey: `${prefix}:usage:1`,
      customerId,
      meterId: meterName,
      value: 1,
      occurredAt: Math.floor(Date.now() / 1000),
    })
    assert.equal(usageResult.reportId, `${prefix}:usage:1`)

    phase = 'creating, retrieving, and refunding a payment intent'
    const intent = await provider.createPaymentIntent!({
      amountMinor: 500,
      currency: 'usd',
      customerId,
      paymentMethodId: paymentMethod.id,
      description: 'PlatformKit test-mode prepaid usage top-up',
      metadata: { kind: 'usage_topup', user_id: `${prefix}-user` },
      idempotencyKey: `${prefix}:topup`,
    })
    paymentIntentId = intent.paymentIntentId
    assert.equal(intent.status, 'succeeded')
    const retrievedIntent = await provider.retrievePaymentIntent!(intent.paymentIntentId)
    assert.equal(retrievedIntent.paymentIntentId, intent.paymentIntentId)
    assert.equal(retrievedIntent.status, 'succeeded')
    assert.equal(retrievedIntent.clientSecret, intent.clientSecret)

    const partialRefund = await provider.refund!({
      paymentId: intent.paymentIntentId,
      amountMinor: 200,
      idempotencyKey: `${prefix}:refund:partial`,
    })
    const repeatedRefund = await provider.refund!({
      paymentId: intent.paymentIntentId,
      amountMinor: 200,
      idempotencyKey: `${prefix}:refund:partial`,
    })
    assert.equal(partialRefund.refundId, repeatedRefund.refundId)
    assert.equal(partialRefund.status, 'succeeded')
    const finalRefund = await provider.refund!({
      paymentId: intent.paymentIntentId,
      idempotencyKey: `${prefix}:refund:remainder`,
    })
    assert.equal(finalRefund.status, 'succeeded')

    phase = 'creating a coupon-backed test subscription'
    const coupon = await stripe.coupons.create({
      id: `${prefix}_coupon`,
      percent_off: 10,
      duration: 'once',
    })
    couponId = coupon.id
    const promotionCode = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code: `PK${suffix.slice(0, 20).toUpperCase()}`,
    })
    promotionCodeId = promotionCode.id
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: basicPrice }],
      default_payment_method: paymentMethod.id,
      trial_period_days: 14,
      discounts: [{ promotion_code: promotionCode.id }],
      metadata: { user_id: `${prefix}-user` },
    }, { idempotencyKey: `${prefix}:subscription:create` })
    subscriptionId = subscription.id
    assert.equal(subscription.status, 'trialing')
    assert.equal(subscription.trial_end, subscription.current_period_end)
    assert.equal(subscription.discounts.length, 1, 'Stripe did not apply the test promotion code.')

    phase = 'opening the customer billing portal'
    const portal = await provider.createPortalSession!({
      customerId,
      returnUrl: 'https://platformkit.test/account/billing',
    })
    assert.ok(portal.url.startsWith('https://billing.stripe.com/'))

    phase = 'changing and canceling the test subscription'
    const immediateChange = await provider.changeSubscription!({
      subscriptionId,
      offerKey: offers[2].offerKey,
      proration: 'immediate',
      idempotencyKey: `${prefix}:subscription:immediate`,
      userId: `${prefix}-user`,
    })
    assert.equal(immediateChange.subscriptionId, subscriptionId)
    assert.equal(immediateChange.subscription.items[0]?.priceId, premiumPrice)

    const scheduledChange = await provider.changeSubscription!({
      subscriptionId,
      offerKey: offers[1].offerKey,
      proration: 'next-cycle',
      idempotencyKey: `${prefix}:subscription:next-cycle`,
      userId: `${prefix}-user`,
    })
    assert.equal(scheduledChange.nextAt, scheduledChange.currentPeriodEnd)
    const scheduledSubscription = await stripe.subscriptions.retrieve(subscriptionId)
    scheduleId = typeof scheduledSubscription.schedule === 'string'
      ? scheduledSubscription.schedule
      : scheduledSubscription.schedule?.id
    assert.ok(scheduleId, 'The next-cycle plan change did not attach a subscription schedule.')

    const restoredPlan = await provider.changeSubscription!({
      subscriptionId,
      offerKey: offers[2].offerKey,
      proration: 'immediate',
      idempotencyKey: `${prefix}:subscription:replace-schedule`,
      userId: `${prefix}-user`,
    })
    assert.equal(restoredPlan.subscription.items[0]?.priceId, premiumPrice)
    scheduleId = undefined

    const cancellation = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    })
    assert.equal(cancellation.cancel_at_period_end, true)

    phase = 'creating and checking connected-account onboarding'
    try {
      const payout = await provider.createPayoutAccount!({
        userId: `${prefix}-payee`,
        email: `${prefix}-payee@example.test`,
        kind: 'managed',
        returnUrl: `https://platformkit.test/connect/return?test=${prefix}`,
        refreshUrl: `https://platformkit.test/connect/refresh?test=${prefix}`,
      })
      payoutAccountId = payout.accountId
      assert.ok(payout.onboardingUrl.startsWith('https://connect.stripe.com/'))
      const payoutReadiness = await provider.retrievePayoutAccount!(payout.accountId)
      assert.equal(payoutReadiness.accountId, payout.accountId)
      assert.equal(payout.ready, payoutReadiness.ready)
      if (!payoutReadiness.ready) {
        console.info('Stripe connected-account transfer not attempted: the test account still requires onboarding.')
      }
    } catch (error) {
      if (!(error instanceof Error) ||
          !error.message.startsWith("You can only create new accounts if you've signed up for Connect")) {
        throw error
      }
      console.info('Stripe connected-account payout integration not verified: Connect is not enabled on this test account.')
    }
  } catch (error) {
    testFailure = error
    console.error(`Stripe test-mode integration failed during ${phase}.`)
  }

  const cleanupFailures: Array<{ label: string; error: unknown }> = []
  const cleanup = async (label: string, operation: () => Promise<unknown>) => {
    try {
      await operation()
    } catch (error) {
      cleanupFailures.push({ label, error })
    }
  }
  if (subscriptionId) {
    if (scheduleId) {
      await cleanup('release subscription schedule', async () => { await stripe.subscriptionSchedules.release(scheduleId!) })
    }
    await cleanup('cancel test subscription', async () => { await stripe.subscriptions.cancel(subscriptionId!, { invoice_now: false, prorate: false }) })
  }
  if (oneTimeCheckoutId) {
    await cleanup('expire one-time checkout', async () => { await stripe.checkout.sessions.expire(oneTimeCheckoutId!) })
  }
  if (subscriptionCheckoutId) {
    await cleanup('expire subscription checkout', async () => { await stripe.checkout.sessions.expire(subscriptionCheckoutId!) })
  }
  if (promotionCodeId) {
    await cleanup('disable test promotion code', async () => { await stripe.promotionCodes.update(promotionCodeId!, { active: false }) })
  }
  if (couponId) {
    await cleanup('delete test coupon', async () => { await stripe.coupons.del(couponId!) })
  }
  if (payoutAccountId) {
    await cleanup('delete unonboarded test payout account', async () => { await stripe.accounts.del(payoutAccountId!) })
  }
  if (actionRequiredPaymentIntentId) {
    await cleanup('cancel the action-required incremental payment', async () => {
      const intent = await stripe.paymentIntents.retrieve(actionRequiredPaymentIntentId!)
      if (intent.status === 'succeeded') {
        await stripe.refunds.create({ payment_intent: intent.id }, {
          idempotencyKey: `${prefix}:incremental:cleanup-refund`,
        })
      } else if (intent.status !== 'canceled') {
        await stripe.paymentIntents.cancel(intent.id)
      }
    })
  }
  if (customerId) {
    await cleanup('delete test customer', async () => { await stripe.customers.del(customerId!) })
  }
  if (paymentIntentId) {
    await cleanup('refund and verify the top-up payment', async () => {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId!)
      const refunds = await stripe.refunds.list({ payment_intent: paymentIntentId!, limit: 100 })
      const refundedMinor = refunds.data.reduce((total, refund) => total + refund.amount, 0)
      const remainingMinor = intent.amount - refundedMinor
      if (remainingMinor > 0) {
        await stripe.refunds.create({
          payment_intent: paymentIntentId!,
          amount: remainingMinor,
        }, { idempotencyKey: `${prefix}:cleanup:refund` })
      }
      const finalRefunds = await stripe.refunds.list({ payment_intent: paymentIntentId!, limit: 100 })
      const totalRefundedMinor = finalRefunds.data.reduce((total, refund) => total + refund.amount, 0)
      assert.equal(totalRefundedMinor, intent.amount, 'The test PaymentIntent was not fully refunded.')
    })
  }
  for (const offer of offers) {
    await cleanup(`archive catalog offer ${offer.offerKey}`, async () => {
      const products = await stripe.products.search({
        query: `metadata['key']:'${offer.offerKey}'`,
        limit: 10,
      })
      for (const product of products.data) await retireTestProduct(product.id)
    })
  }
  await cleanup('deactivate the test usage meter', async () => {
    const meters = await stripe.billing.meters.list({ status: 'active', limit: 100 })
    for (const meter of meters.data.filter((item) => item.event_name === meterName)) {
      await stripe.billing.meters.deactivate(meter.id)
    }
  })

  if (testFailure && cleanupFailures.length) {
    throw new AggregateError(
      [testFailure, ...cleanupFailures.map(({ error }) => error)],
      `Stripe test-mode integration and cleanup failed: ${cleanupFailures.map(({ label }) => label).join(', ')}.`,
    )
  }
  if (testFailure) throw testFailure
  if (cleanupFailures.length) {
    throw new AggregateError(
      cleanupFailures.map(({ error }) => error),
      `Stripe test-mode integration cleanup failed: ${cleanupFailures.map(({ label }) => label).join(', ')}.`,
    )
  }
})

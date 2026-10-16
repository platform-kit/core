import assert from 'node:assert/strict'
import StripeSdk from 'npm:stripe@17'
import type Stripe from 'npm:stripe@17'
import { createPaymentProvider } from '../supabase/functions/_shared/stripe-payment-provider.ts'
import { PaymentProviderError } from '../supabase/functions/_shared/payment-provider.mjs'
import type { CreatePaymentCheckout, PaymentCatalogOffer } from '../src/payment-provider.d.ts'

const testProvider = (stripe: Record<string, unknown>, secrets: Record<string, string> = {}) =>
  createPaymentProvider(secrets, { stripe: stripe as unknown as Stripe })

Deno.test('Stripe customer and checkout operations use the normalized adapter contract', async () => {
  let customerInput: unknown
  let checkoutInput: unknown
  let checkoutOptions: unknown
  const provider = testProvider({
    customers: {
      create: async (input: unknown) => { customerInput = input; return { id: 'cus_1' } },
    },
    checkout: {
      sessions: {
        create: async (input: unknown, options: unknown) => {
          checkoutInput = input
          checkoutOptions = options
          return { id: 'cs_1', url: 'https://checkout.test/session', customer: 'cus_1', expires_at: 1_760_000_000 }
        },
      },
    },
  })
  const customer = await provider.createCustomer({ userId: 'user_1', email: 'person@example.test' })
  assert.deepEqual(customer, { customerId: 'cus_1' })
  assert.deepEqual(customerInput, {
    email: 'person@example.test',
    metadata: { user_id: 'user_1' },
  })

  const request: CreatePaymentCheckout = {
    idempotencyKey: 'checkout:test',
    customer: { userId: 'user_1', providerCustomerId: 'cus_1' },
    mode: 'payment',
    lines: [
      {
        offerKey: 'book-hardcover',
        sku: 'book',
        name: 'Book',
        currency: 'usd',
        billing: 'once',
        unitAmountMinor: 2500,
        quantity: 2,
        providerPriceId: 'price_1',
        adjustableQuantity: { minimum: 1, maximum: 4 },
        metadata: { key: 'book-hardcover', sku: 'book' },
      },
      {
        offerKey: 'session-offer-1',
        sku: 'offering:session-offer-1',
        name: 'Session',
        currency: 'usd',
        billing: 'once',
        unitAmountMinor: 5000,
        quantity: 1,
        metadata: { kind: 'session' },
      },
    ],
    successUrl: 'https://site.test/success?session={CHECKOUT_ID}',
    cancelUrl: 'https://site.test/cancel',
    metadata: { user_id: 'user_1', skus: 'book,offering:session-offer-1' },
    allowPromotionCodes: true,
  }
  const checkout = await provider.createCheckout(request)
  assert.deepEqual(checkout, {
    provider: 'stripe',
    checkoutId: 'cs_1',
    url: 'https://checkout.test/session',
    customerId: 'cus_1',
    expiresAt: 1_760_000_000,
  })
  assert.deepEqual(checkoutOptions, { idempotencyKey: 'checkout:test' })
  const created = checkoutInput as {
    line_items: Array<Record<string, any>>
    metadata: Record<string, string>
    success_url: string
    allow_promotion_codes: boolean
  }
  assert.equal(created.line_items.length, 2)
  assert.deepEqual(created.line_items[0], {
    price: 'price_1',
    quantity: 2,
    adjustable_quantity: { enabled: true, minimum: 1, maximum: 4 },
  })
  assert.deepEqual(created.line_items[1].price_data.product_data.metadata, {
    kind: 'session',
    key: 'session-offer-1',
    sku: 'offering:session-offer-1',
  })
  assert.deepEqual(created.metadata, request.metadata)
  assert.equal(created.success_url, 'https://site.test/success?session={CHECKOUT_SESSION_ID}')
  assert.equal(created.allow_promotion_codes, true)
})

Deno.test('Stripe checkout preserves trial, tax, payment-method, and coupon terms', async () => {
  let checkoutInput: Record<string, any> | undefined
  const provider = testProvider({
    checkout: {
      sessions: {
        create: async (input: Record<string, any>) => {
          checkoutInput = input
          return { id: 'cs_subscription', url: 'https://checkout.test/subscription' }
        },
      },
    },
  })
  await provider.createCheckout({
    idempotencyKey: 'checkout:subscription-terms',
    customer: { userId: 'user_1', providerCustomerId: 'cus_1' },
    mode: 'subscription',
    lines: [{
      offerKey: 'member',
      sku: 'member',
      name: 'Membership',
      currency: 'usd',
      billing: 'subscription',
      interval: 'month',
      unitAmountMinor: 1200,
      quantity: 1,
      providerUsagePriceId: 'price_metered_usage',
    }],
    successUrl: 'https://site.test/success?session={CHECKOUT_ID}',
    cancelUrl: 'https://site.test/cancel',
    metadata: { user_id: 'user_1' },
    allowPromotionCodes: true,
    trialDays: 14,
    automaticTax: true,
    collectTaxId: true,
    allowedPaymentMethods: ['card', 'link'],
  })
  assert.equal(checkoutInput?.mode, 'subscription')
  assert.equal(checkoutInput?.allow_promotion_codes, true)
  assert.deepEqual(checkoutInput?.subscription_data, {
    metadata: { user_id: 'user_1' },
    trial_period_days: 14,
  })
  assert.deepEqual(checkoutInput?.automatic_tax, { enabled: true })
  assert.deepEqual(checkoutInput?.customer_update, { address: 'auto' })
  assert.deepEqual(checkoutInput?.tax_id_collection, { enabled: true })
  assert.deepEqual(checkoutInput?.payment_method_types, ['card', 'link'])
  assert.equal(checkoutInput?.line_items[0].price_data.recurring.interval, 'month')
  assert.deepEqual(checkoutInput?.line_items[1], { price: 'price_metered_usage', quantity: 1 })
})

Deno.test('Stripe checkout preserves adjustable quantities and shipping terms', async () => {
  let checkoutInput: Record<string, any> | undefined
  const provider = testProvider({
    checkout: {
      sessions: {
        create: async (input: Record<string, any>) => {
          checkoutInput = input
          return { id: 'cs_shipping', url: 'https://checkout.test/shipping' }
        },
      },
    },
  })
  await provider.createCheckout({
    idempotencyKey: 'checkout:shipping-terms',
    mode: 'payment',
    lines: [{
      offerKey: 'book',
      sku: 'book',
      name: 'Book',
      currency: 'usd',
      billing: 'once',
      unitAmountMinor: 2500,
      quantity: 1,
      providerPriceId: 'price_book',
      adjustableQuantity: { minimum: 1, maximum: 4 },
    }],
    successUrl: 'https://site.test/success',
    cancelUrl: 'https://site.test/cancel',
    metadata: {},
    shippingAddress: 'required',
    shippingCountry: 'US',
    collectPhone: true,
    shippingOptions: [{
      id: 'standard',
      label: 'Standard',
      amountMinor: 500,
      currency: 'usd',
      metadata: { carrier: 'postal' },
      deliveryEstimate: { minimumDays: 3, maximumDays: 5 },
    }],
    shippingSubmitMessage: 'Your order will ship soon.',
  })
  assert.deepEqual(checkoutInput?.line_items, [{
    price: 'price_book',
    quantity: 1,
    adjustable_quantity: { enabled: true, minimum: 1, maximum: 4 },
  }])
  assert.deepEqual(checkoutInput?.shipping_address_collection, { allowed_countries: ['US'] })
  assert.deepEqual(checkoutInput?.phone_number_collection, { enabled: true })
  assert.deepEqual(checkoutInput?.shipping_options, [{
    shipping_rate_data: {
      type: 'fixed_amount',
      display_name: 'Standard',
      fixed_amount: { amount: 500, currency: 'usd' },
      metadata: { carrier: 'postal' },
      delivery_estimate: {
        minimum: { unit: 'business_day', value: 3 },
        maximum: { unit: 'business_day', value: 5 },
      },
    },
  }])
  assert.deepEqual(checkoutInput?.custom_text, { submit: { message: 'Your order will ship soon.' } })
})

Deno.test('Stripe checkout retrieval returns normalized outcomes and lines', async () => {
  const product = { id: 'prod_1', name: 'Book', metadata: { key: 'book-hardcover', sku: 'book' } }
  let sessionRetrieveOptions: unknown
  const price = {
    id: 'price_1',
    lookup_key: 'book-hardcover',
    unit_amount: 2500,
    currency: 'usd',
    type: 'one_time',
    metadata: { key: 'book-hardcover', sku: 'book' },
    product,
  }
  const provider = testProvider({
    checkout: {
      sessions: {
        retrieve: async (_checkoutId: string, options: unknown) => {
          sessionRetrieveOptions = options
          return {
          id: 'cs_1',
          status: 'complete',
          payment_status: 'paid',
          mode: 'payment',
          customer: 'cus_1',
          payment_intent: 'pi_1',
          client_reference_id: 'user_1',
          amount_total: 2500,
          currency: 'usd',
          metadata: { user_id: 'user_1' },
          line_items: { data: [{ price, quantity: 1 }] },
          customer_details: { email: 'person@example.test', name: 'Person', phone: null, address: null },
          shipping_details: null,
          shipping_cost: null,
          subscription: null,
          }
        },
      },
    },
  })
  assert.deepEqual(await provider.retrieveCheckout('cs_1'), {
    provider: 'stripe',
    checkoutId: 'cs_1',
    status: 'complete',
    paymentStatus: 'paid',
    mode: 'payment',
    customerId: 'cus_1',
    paymentId: 'pi_1',
    userId: 'user_1',
    customerEmail: 'person@example.test',
    customerName: 'Person',
    amountTotalMinor: 2500,
    currency: 'usd',
    metadata: { user_id: 'user_1' },
    lines: [{
      offerKey: 'book-hardcover',
      sku: 'book',
      name: 'Book',
      currency: 'usd',
      billing: 'once',
      unitAmountMinor: 2500,
      quantity: 1,
      providerPriceId: 'price_1',
      productId: 'prod_1',
      metadata: { key: 'book-hardcover', sku: 'book' },
    }],
  })
  assert.deepEqual(sessionRetrieveOptions, {
    expand: ['line_items.data.price.product', 'shipping_cost.shipping_rate'],
  })
})

Deno.test('Stripe partial and full refunds are idempotent provider operations', async () => {
  const refundCalls: Array<{ input: unknown; options: unknown }> = []
  const provider = testProvider({
    refunds: {
      create: async (input: unknown, options: unknown) => {
        refundCalls.push({ input, options })
        return { id: `re_${refundCalls.length}`, status: 'succeeded' }
      },
    },
  })
  assert.ok(provider.capabilities.includes('refunds'))
  assert.deepEqual(await provider.refund({
    paymentId: 'pi_1',
    amountMinor: 250,
    idempotencyKey: 'refund:partial',
  }), { refundId: 're_1', status: 'succeeded' })
  assert.deepEqual(await provider.refund({
    paymentId: 'pi_1',
    idempotencyKey: 'refund:remainder',
  }), { refundId: 're_2', status: 'succeeded' })
  assert.deepEqual(refundCalls, [
    {
      input: { payment_intent: 'pi_1', amount: 250 },
      options: { idempotencyKey: 'refund:partial' },
    },
    {
      input: { payment_intent: 'pi_1' },
      options: { idempotencyKey: 'refund:remainder' },
    },
  ])
  await assert.rejects(
    provider.refund({ paymentId: 'pi_1', amountMinor: 0, idempotencyKey: 'refund:invalid' }),
    (error) => error instanceof PaymentProviderError && error.code === 'invalid_refund',
  )
  assert.equal(refundCalls.length, 2)
})

Deno.test('Stripe usage, prepaid top-ups, and connected-account payouts stay behind the adapter', async () => {
  let meterInput: unknown
  let meterOptions: unknown
  let paymentInput: unknown
  let paymentOptions: unknown
  let accountInput: unknown
  let accountLinkInput: unknown
  let transferInput: unknown
  let transferOptions: unknown
  const provider = testProvider({
    billing: {
      meterEvents: {
        create: async (input: unknown, options: unknown) => {
          meterInput = input
          meterOptions = options
          return { identifier: 'meter-event-1' }
        },
      },
    },
    customers: {
      retrieve: async () => ({
        id: 'cus_1',
        invoice_settings: { default_payment_method: { id: 'pm_1' } },
      }),
    },
    paymentIntents: {
      create: async (input: unknown, options: unknown) => {
        paymentInput = input
        paymentOptions = options
        return { id: 'pi_1', status: 'succeeded', client_secret: 'pi_client_secret' }
      },
      retrieve: async (paymentIntentId: string) => ({
        id: paymentIntentId,
        status: 'succeeded',
        client_secret: 'pi_client_secret',
      }),
    },
    accounts: {
      create: async (input: unknown) => { accountInput = input; return { id: 'acct_1', payouts_enabled: false } },
      retrieve: async () => ({ id: 'acct_1', payouts_enabled: true, details_submitted: true }),
    },
    accountLinks: {
      create: async (input: unknown) => { accountLinkInput = input; return { url: 'https://connect.test/onboarding' } },
    },
    transfers: {
      create: async (input: unknown, options: unknown) => {
        transferInput = input
        transferOptions = options
        return { id: 'tr_1' }
      },
    },
  })

  assert.deepEqual(await provider.getDefaultPaymentMethod('cus_1'), { paymentMethodId: 'pm_1' })
  assert.deepEqual(await provider.createPaymentIntent({
    amountMinor: 500,
    currency: 'usd',
    customerId: 'cus_1',
    paymentMethodId: 'pm_1',
    description: 'Usage pack',
    metadata: { kind: 'usage_topup' },
    idempotencyKey: 'topup:one',
  }), { paymentIntentId: 'pi_1', status: 'succeeded', clientSecret: 'pi_client_secret' })
  assert.deepEqual(paymentInput, {
    amount: 500,
    currency: 'usd',
    customer: 'cus_1',
    payment_method: 'pm_1',
    off_session: true,
    confirm: true,
    description: 'Usage pack',
    metadata: { kind: 'usage_topup' },
  })
  assert.deepEqual(paymentOptions, { idempotencyKey: 'topup:one' })
  const actionProvider = testProvider({
    paymentIntents: {
      create: async () => {
        throw {
          code: 'authentication_required',
          raw: {
            payment_intent: {
              id: 'pi_requires_action',
              status: 'requires_payment_method',
              last_payment_error: { code: 'authentication_required' },
              client_secret: 'pi_action_client_secret',
            },
          },
        }
      },
    },
  })
  assert.deepEqual(await actionProvider.createPaymentIntent({
    amountMinor: 500,
    currency: 'usd',
    customerId: 'cus_1',
    paymentMethodId: 'pm_1',
    description: 'Metered usage',
    metadata: { platformkit_usage_incremental: '1' },
    idempotencyKey: 'usage-increment:subscription:period:threshold:1',
  }), {
    paymentIntentId: 'pi_requires_action',
    status: 'requires_action',
    clientSecret: 'pi_action_client_secret',
  })
  const actionRetrieveProvider = testProvider({
    paymentIntents: {
      retrieve: async () => ({
        id: 'pi_requires_action',
        status: 'requires_payment_method',
        last_payment_error: { code: 'authentication_required' },
        client_secret: 'pi_action_client_secret',
      }),
    },
  })
  assert.deepEqual(await actionRetrieveProvider.retrievePaymentIntent('pi_requires_action'), {
    paymentIntentId: 'pi_requires_action',
    status: 'requires_action',
    clientSecret: 'pi_action_client_secret',
  })
  const recoveredProvider = testProvider({
    paymentIntents: {
      retrieve: async () => ({
        id: 'pi_recovered',
        status: 'succeeded',
        last_payment_error: { code: 'authentication_required' },
        client_secret: 'pi_recovered_client_secret',
      }),
    },
  })
  assert.deepEqual(await recoveredProvider.retrievePaymentIntent('pi_recovered'), {
    paymentIntentId: 'pi_recovered',
    status: 'succeeded',
    clientSecret: 'pi_recovered_client_secret',
  })
  assert.deepEqual(await provider.retrievePaymentIntent('pi_1'), {
    paymentIntentId: 'pi_1',
    status: 'succeeded',
    clientSecret: 'pi_client_secret',
  })
  assert.deepEqual(await provider.reportUsage({
    idempotencyKey: 'usage-report-1',
    customerId: 'cus_1',
    meterId: 'audio_seconds',
    value: 250,
    occurredAt: 1_760_000_000,
  }), { reportId: 'usage-report-1' })
  assert.deepEqual(meterInput, {
    event_name: 'audio_seconds',
    identifier: 'usage-report-1',
    payload: { stripe_customer_id: 'cus_1', value: '250' },
    timestamp: 1_760_000_000,
  })
  assert.deepEqual(meterOptions, { idempotencyKey: 'usage-meter-event:usage-report-1' })
  assert.deepEqual(await provider.createPayoutAccount({
    userId: 'user_1',
    email: 'provider@example.test',
    kind: 'managed',
    returnUrl: 'https://site.test/connect/done',
    refreshUrl: 'https://site.test/connect/again',
  }), {
    accountId: 'acct_1',
    onboardingUrl: 'https://connect.test/onboarding',
    ready: false,
  })
  assert.deepEqual(accountInput, {
    type: 'express',
    email: 'provider@example.test',
    capabilities: { transfers: { requested: true } },
    metadata: { user_id: 'user_1' },
  })
  assert.deepEqual(accountLinkInput, {
    account: 'acct_1',
    refresh_url: 'https://site.test/connect/again',
    return_url: 'https://site.test/connect/done',
    type: 'account_onboarding',
  })
  assert.deepEqual(await provider.retrievePayoutAccount('acct_1'), {
    accountId: 'acct_1',
    ready: true,
    detailsSubmitted: true,
  })
  assert.deepEqual(await provider.createPayout({
    accountId: 'acct_1',
    amountMinor: 3000,
    currency: 'usd',
    idempotencyKey: 'po_1',
    metadata: { user_id: 'user_1', lines: '2', ref: 'po_1' },
  }), { payoutId: 'tr_1', status: 'created' })
  assert.deepEqual(transferInput, {
    amount: 3000,
    currency: 'usd',
    destination: 'acct_1',
    metadata: { user_id: 'user_1', lines: '2', ref: 'po_1' },
  })
  assert.deepEqual(transferOptions, { idempotencyKey: 'po_1' })
})

Deno.test('Stripe subscription changes and portal sessions stay behind the adapter', async () => {
  const oldPrice = {
    id: 'price_old',
    lookup_key: 'plan-old',
    unit_amount: 1000,
    currency: 'usd',
    metadata: { key: 'plan-old', sku: 'old' },
  }
  const newPrice = {
    id: 'price_new',
    lookup_key: 'plan-new',
    unit_amount: 2000,
    currency: 'usd',
    metadata: { key: 'plan-new', sku: 'new' },
  }
  let subscriptionUpdate: unknown
  let subscriptionOptions: unknown
  let portalInput: unknown
  const provider = testProvider({
    prices: { list: async ({ lookup_keys }: { lookup_keys: string[] }) => {
      assert.deepEqual(lookup_keys, ['plan-new'])
      return { data: [newPrice] }
    } },
    subscriptions: {
      retrieve: async () => ({
        id: 'sub_1',
        status: 'active',
        customer: 'cus_1',
        metadata: { user_id: 'user_1' },
        current_period_start: 1_760_000_000,
        current_period_end: 1_762_592_000,
        cancel_at_period_end: false,
        trial_end: null,
        schedule: null,
        items: { data: [{ id: 'si_1', quantity: 1, price: oldPrice }] },
      }),
      update: async (_id: string, input: unknown, options: unknown) => {
        subscriptionUpdate = input
        subscriptionOptions = options
        return {
          id: 'sub_1',
          status: 'active',
          customer: 'cus_1',
          metadata: { user_id: 'user_1' },
          current_period_start: 1_760_000_000,
          current_period_end: 1_762_592_000,
          cancel_at_period_end: false,
          trial_end: null,
          schedule: null,
          items: { data: [{ id: 'si_1', quantity: 1, price: newPrice }] },
        }
      },
    },
    billingPortal: {
      sessions: {
        create: async (input: unknown) => {
          portalInput = input
          return { url: 'https://billing.test/portal' }
        },
      },
    },
  })
  const changed = await provider.changeSubscription({
    subscriptionId: 'sub_1',
    offerKey: 'plan-new',
    proration: 'immediate',
    idempotencyKey: 'change:one',
    userId: 'user_1',
  })
  assert.equal(changed.subscriptionId, 'sub_1')
  assert.equal(changed.subscription.provider, 'stripe')
  assert.deepEqual(subscriptionUpdate, {
    items: [{ id: 'si_1', price: 'price_new' }],
    proration_behavior: 'always_invoice',
    payment_behavior: 'error_if_incomplete',
    metadata: { user_id: 'user_1' },
  })
  assert.deepEqual(subscriptionOptions, { idempotencyKey: 'change:one' })
  assert.deepEqual(await provider.createPortalSession({
    customerId: 'cus_1',
    returnUrl: 'https://site.test/account',
  }), { url: 'https://billing.test/portal' })
  assert.deepEqual(portalInput, { customer: 'cus_1', return_url: 'https://site.test/account' })
})

Deno.test('Stripe catalog synchronization creates once and reuses stable offer identities', async () => {
  let product: Record<string, any> | undefined
  let price: Record<string, any> | undefined
  let productsCreated = 0
  let pricesCreated = 0
  let productSearchCalls = 0
  const provider = testProvider({
    products: {
      search: async ({ query }: { query: string }) => {
        productSearchCalls++
        return { data: product && query.includes("metadata['key']") ? [product] : [] }
      },
      retrieve: async (id: string) => {
        if (product?.id !== id) throw new Error(`unexpected product id ${id}`)
        return product
      },
      create: async (input: Record<string, unknown>) => {
        productsCreated++
        product = { id: 'prod_1', ...input }
        return product
      },
      update: async (_id: string, input: Record<string, unknown>) => {
        product = { ...product, ...input }
        return product
      },
    },
    prices: {
      list: async ({ lookup_keys }: { lookup_keys: string[] }) => ({
        data: price && lookup_keys.includes('book-hardcover') ? [price] : [],
      }),
      create: async (input: Record<string, any>) => {
        pricesCreated++
        price = {
          id: 'price_1',
          product: 'prod_1',
          active: true,
          type: 'one_time',
          unit_amount: input.unit_amount,
          currency: input.currency,
          metadata: input.metadata,
          ...input,
        }
        return price
      },
      update: async (_id: string, input: Record<string, unknown>) => {
        price = { ...price, ...input }
        return price
      },
    },
  })
  const offer: PaymentCatalogOffer = {
    offerKey: 'book-hardcover',
    sku: 'book',
    name: 'Book',
    kind: 'one-time',
    currency: 'usd',
    unitAmountMinor: 2500,
    currencyOptions: { cad: 3400 },
    metadata: { key: 'book-hardcover', sku: 'book', kind: 'book' },
  }
  const first = await provider.syncCatalog([offer])
  assert.deepEqual(first, {
    provider: 'stripe',
    offers: {
      'book-hardcover': { productId: 'prod_1', priceId: 'price_1', made: true },
    },
  })
  assert.deepEqual((price as Record<string, any>).currency_options, { cad: { unit_amount: 3400 } })
  const second = await provider.syncCatalog([offer])
  assert.equal(second.offers['book-hardcover'].made, false)
  assert.equal(productsCreated, 1)
  assert.equal(pricesCreated, 1)
  assert.equal(productSearchCalls, 2, 'an existing active price bypasses eventually consistent product search')
})

Deno.test('Stripe webhook verification checks the raw request in the adapter', async () => {
  let received: unknown[] = []
  const provider = testProvider({
    webhooks: {
      constructEventAsync: async (rawBody: string, signature: string, secret: string) => {
        received = [rawBody, signature, secret]
        if (signature !== 'valid-signature') throw new Error('signature mismatch')
        return {
          id: 'evt_checkout',
          type: 'checkout.session.completed',
          created: 1_760_000_000,
          data: { object: {
            id: 'cs_1',
            customer: 'cus_1',
            payment_intent: 'pi_1',
            amount_total: 1200,
            currency: 'USD',
            metadata: { user_id: 'user_1' },
          } },
        }
      },
    },
  }, { STRIPE_WEBHOOK_SECRET: 'whsec_test' })
  const rawBody = '{"event":"checkout"}'
  const verified = await provider.verifyWebhook(new Request('https://site.test/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'valid-signature' },
    body: rawBody,
  }))
  assert.deepEqual(received, [rawBody, 'valid-signature', 'whsec_test'])
  assert.deepEqual(verified, [{
    provider: 'stripe',
    eventId: 'evt_checkout',
    type: 'checkout.completed',
    occurredAt: 1_760_000_000,
    customerId: 'cus_1',
    checkoutId: 'cs_1',
    paymentId: 'pi_1',
    amountMinor: 1200,
    currency: 'usd',
    metadata: { user_id: 'user_1' },
  }])

  await assert.rejects(
    () => provider.verifyWebhook(new Request('https://site.test/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'invalid-signature' },
      body: rawBody,
    })),
    (error) => error instanceof PaymentProviderError && error.code === 'invalid_webhook' && error.status === 400,
  )
  const unconfigured = testProvider({ webhooks: { constructEventAsync: async () => { throw new Error('must not verify') } } })
  await assert.rejects(
    () => unconfigured.verifyWebhook(new Request('https://site.test/webhook', { method: 'POST', body: rawBody })),
    (error) => error instanceof PaymentProviderError && error.code === 'webhook_unconfigured' && error.status === 503,
  )
})

Deno.test('Stripe webhook signatures validate the exact raw body', async () => {
  const secret = 'whsec_test'
  const stripe = new StripeSdk('sk_test_provider_adapter', {
    apiVersion: '2025-02-24.acacia',
    httpClient: StripeSdk.createFetchHttpClient(),
  })
  const provider = createPaymentProvider({ STRIPE_WEBHOOK_SECRET: secret }, { stripe })
  const rawBody = JSON.stringify({
    id: 'evt_expired',
    type: 'checkout.session.expired',
    created: 1_760_000_000,
    data: { object: { id: 'cs_expired', metadata: { hold: 'hold_1' } } },
  })
  const timestamp = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`))
  const signature = `t=${timestamp},v1=${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
  const events = await provider.verifyWebhook(new Request('https://site.test/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    body: rawBody,
  }))
  assert.equal(events[0].eventId, 'evt_expired')
  assert.equal(events[0].type, 'checkout.expired')
  assert.equal(events[0].metadata.hold, 'hold_1')
  await assert.rejects(
    () => provider.verifyWebhook(new Request('https://site.test/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: rawBody + ' ',
    })),
    (error) => error instanceof PaymentProviderError && error.code === 'invalid_webhook' && error.status === 400,
  )
})

Deno.test('Stripe invoice webhooks normalize subscription, price metadata, and billing periods', async () => {
  const price = {
    id: 'price_usage',
    lookup_key: 'usage-plan_usage',
    unit_amount: 100,
    currency: 'usd',
    metadata: { usage: 'metered', usage_offer_key: 'usage-plan', usage_meter: 'audio' },
  }
  const subscription = {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    current_period_start: 1_760_000_000,
    current_period_end: 1_762_592_000,
    cancel_at_period_end: false,
    metadata: { user_id: 'user_1' },
    items: { data: [{ quantity: 1, price }] },
  }
  const provider = testProvider({
    webhooks: {
      constructEventAsync: async () => ({
        id: 'evt_invoice',
        type: 'invoice.paid',
        created: 1_760_000_000,
        data: { object: {
          id: 'in_1',
          billing_reason: 'subscription_cycle',
          subscription: 'sub_1',
          currency: 'usd',
          amount_paid: 100,
          lines: { data: [{ price: 'price_usage', period: { start: 1_760_000_000, end: 1_762_592_000 } }] },
        } },
      }),
    },
    subscriptions: { retrieve: async () => subscription },
    prices: { retrieve: async () => price },
  }, { STRIPE_WEBHOOK_SECRET: 'whsec_test' })
  const [event] = await provider.verifyWebhook(new Request('https://site.test/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'valid-signature' },
    body: '{}',
  }))
  assert.equal(event.type, 'invoice.paid')
  assert.ok(event.subscription)
  assert.ok(event.invoice)
  assert.equal(event.subscription.subscriptionId, 'sub_1')
  assert.equal(event.invoice.invoiceId, 'in_1')
  assert.equal(event.invoice.billingReason, 'subscription_cycle')
  assert.deepEqual(event.invoice.lines[0], {
    priceId: 'price_usage',
    offerKey: 'usage-plan_usage',
    metadata: { usage: 'metered', usage_offer_key: 'usage-plan', usage_meter: 'audio' },
    periodStart: 1_760_000_000,
    periodEnd: 1_762_592_000,
  })
})

Deno.test('Stripe webhooks normalize checkout, subscription, payment, refund, and payout events', async () => {
  const eventCases = [
    ['checkout.session.completed', 'checkout.completed', { id: 'cs_1', metadata: { user_id: 'user_1' } }, 'cs_1', undefined],
    ['checkout.session.expired', 'checkout.expired', { id: 'cs_2', metadata: { hold: 'hold_1' } }, 'cs_2', undefined],
    ['payment_intent.succeeded', 'payment.succeeded', { id: 'pi_success' }, undefined, 'pi_success'],
    ['payment_intent.payment_failed', 'payment.failed', { id: 'pi_failed' }, undefined, 'pi_failed'],
    ['charge.refunded', 'payment.refunded', { id: 'ch_1', payment_intent: 'pi_refunded' }, undefined, 'pi_refunded'],
    [
      'customer.subscription.created',
      'subscription.created',
      { id: 'sub_1', status: 'active', items: { data: [{ price: { id: 'price_sub_1' } }] }, metadata: {} },
      undefined,
      undefined,
      'sub_1',
    ],
    [
      'customer.subscription.updated',
      'subscription.updated',
      { id: 'sub_2', status: 'active', items: { data: [{ price: { id: 'price_sub_2' } }] }, metadata: {} },
      undefined,
      undefined,
      'sub_2',
    ],
    ['customer.subscription.deleted', 'subscription.deleted', { id: 'sub_3' }, undefined, undefined, 'sub_3'],
    ['invoice.payment_failed', 'invoice.payment-failed', { id: 'in_1', subscription: 'sub_4' }, undefined, undefined, 'sub_4'],
    ['payout.paid', 'payout.updated', { id: 'po_1', status: 'paid' }],
  ] as const
  const provider = testProvider({
    webhooks: { constructEventAsync: async (payload: string) => JSON.parse(payload) },
  }, { STRIPE_WEBHOOK_SECRET: 'whsec_test' })

  for (const [index, [stripeType, normalizedType, object, checkoutId, paymentId, subscriptionId]] of
    eventCases.entries()) {
    const [event] = await provider.verifyWebhook(new Request('https://site.test/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'verified-by-test-double' },
      body: JSON.stringify({
        id: `evt_${index}`,
        type: stripeType,
        created: 1_760_000_000,
        data: { object },
      }),
    }))
    assert.equal(event.type, normalizedType)
    assert.equal(event.checkoutId, checkoutId)
    assert.equal(event.paymentId, paymentId)
    assert.equal(event.subscriptionId, subscriptionId)
  }
})

Deno.test('Stripe partial refunds and payout lifecycle events retain transaction identity', async () => {
  const cases = [
    {
      stripeType: 'charge.refunded',
      object: {
        id: 'ch_refund',
        payment_intent: 'pi_refunded',
        amount: 1000,
        amount_refunded: 250,
        currency: 'usd',
      },
      type: 'payment.refunded',
      paymentId: 'pi_refunded',
      amountMinor: 250,
    },
    ...[
      ['payout.created', 'pending'],
      ['payout.updated', 'in_transit'],
      ['payout.paid', 'paid'],
      ['payout.failed', 'failed'],
      ['payout.canceled', 'canceled'],
    ].map(([stripeType, status]) => ({
      stripeType,
      object: { id: `po_${status}`, status, amount: 1700, currency: 'usd' },
      type: 'payout.updated',
      payoutId: `po_${status}`,
      status,
      amountMinor: 1700,
    })),
  ] as const
  const provider = testProvider({
    webhooks: { constructEventAsync: async (payload: string) => JSON.parse(payload) },
  }, { STRIPE_WEBHOOK_SECRET: 'whsec_test' })

  for (const [index, item] of cases.entries()) {
    const [event] = await provider.verifyWebhook(new Request('https://site.test/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'verified-by-test-double' },
      body: JSON.stringify({
        id: `evt_transaction_${index}`,
        type: item.stripeType,
        created: 1_760_000_000,
        data: { object: item.object },
      }),
    }))
    assert.equal(event.type, item.type)
    assert.equal(event.paymentId, 'paymentId' in item ? item.paymentId : undefined)
    assert.equal(event.payoutId, 'payoutId' in item ? item.payoutId : undefined)
    assert.equal(event.status, 'status' in item ? item.status : undefined)
    assert.equal(event.amountMinor, item.amountMinor)
  }

  const [ignoredAccountEvent] = await provider.verifyWebhook(new Request('https://site.test/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'verified-by-test-double' },
    body: JSON.stringify({
      id: 'evt_account_readiness',
      type: 'account.updated',
      created: 1_760_000_000,
      data: { object: { id: 'acct_1', payouts_enabled: true } },
    }),
  }))
  assert.equal(ignoredAccountEvent, undefined)
})

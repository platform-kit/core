import type Stripe from 'npm:stripe@17'
import type {
  CreatePaymentCheckout,
  PaymentCatalogOffer,
  PaymentCheckoutSnapshot,
  PaymentInvoiceSnapshot,
  PaymentSubscriptionSnapshot,
} from './payment-provider.d.ts'
import {
  normalizePaymentEvent,
  PaymentProviderError,
  STRIPE_PAYMENT_CAPABILITIES,
} from './payment-provider.mjs'
import { ensureUsageBilling, sendUsageMeterEvent } from './usage-stripe.mjs'

const identifier = (value: unknown): string | null => {
  if (typeof value === 'string') return value
  return value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
    ? value.id
    : null
}
const stringMetadata = (value: unknown): Record<string, string> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'string')) as Record<string, string>
    : {}
const paymentIntentStatus = (status: string, lastPaymentError: unknown, errorCode?: unknown) => {
  const lastErrorCode = lastPaymentError && typeof lastPaymentError === 'object' &&
      'code' in lastPaymentError
    ? lastPaymentError.code
    : undefined
  return status === 'requires_payment_method' &&
      (errorCode === 'authentication_required' || lastErrorCode === 'authentication_required')
    ? 'requires_action'
    : status
}
const paymentIntentFromError = (error: unknown): { id: string; status: string; clientSecret?: string } | null => {
  if (!error || typeof error !== 'object') return null
  const outer = error as Record<string, unknown>
  const raw = outer.raw && typeof outer.raw === 'object'
    ? outer.raw as Record<string, unknown>
    : outer
  const intent = raw.payment_intent
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return null
  const paymentIntent = intent as Record<string, unknown>
  return typeof paymentIntent.id === 'string' && typeof paymentIntent.status === 'string'
    ? {
      id: paymentIntent.id,
      status: paymentIntentStatus(
        paymentIntent.status,
        paymentIntent.last_payment_error,
        outer.code ?? raw.code,
      ),
      ...(typeof paymentIntent.client_secret === 'string' ? { clientSecret: paymentIntent.client_secret } : {}),
    }
    : null
}

function subscriptionSnapshot(subscription: Stripe.Subscription): PaymentSubscriptionSnapshot {
  const customerId = identifier(subscription.customer)
  const scheduleId = identifier(subscription.schedule)
  return {
    provider: 'stripe',
    subscriptionId: subscription.id,
    ...(customerId ? { customerId } : {}),
    status: subscription.status,
    ...(subscription.current_period_start ? { currentPeriodStart: subscription.current_period_start } : {}),
    ...(subscription.current_period_end ? { currentPeriodEnd: subscription.current_period_end } : {}),
    ...(subscription.cancel_at_period_end != null ? { cancelAtPeriodEnd: subscription.cancel_at_period_end } : {}),
    ...(subscription.trial_end ? { trialEnd: subscription.trial_end } : {}),
    ...(scheduleId ? { scheduleId } : {}),
    metadata: stringMetadata(subscription.metadata),
    items: subscription.items.data.map((item) => ({
      priceId: item.price.id,
      ...(item.price.lookup_key ? { offerKey: item.price.lookup_key } : {}),
      ...(item.price.metadata?.sku ? { sku: item.price.metadata.sku } : {}),
      ...(item.price.unit_amount != null ? { unitAmountMinor: item.price.unit_amount } : {}),
      ...(item.price.currency ? { currency: item.price.currency } : {}),
      quantity: item.quantity ?? 1,
      metadata: stringMetadata(item.price.metadata),
    })),
  }
}

async function invoiceSnapshot(stripe: Stripe, invoice: Stripe.Invoice): Promise<PaymentInvoiceSnapshot> {
  const lines = await Promise.all(invoice.lines.data.map(async (line) => {
    const rawPrice = line.price
    const priceId = identifier(rawPrice)
    const price = rawPrice && typeof rawPrice === 'object'
      ? rawPrice
      : priceId ? await stripe.prices.retrieve(priceId) : null
    return {
      ...(priceId ? { priceId } : {}),
      ...(price?.lookup_key ? { offerKey: price.lookup_key } : {}),
      ...(price ? { metadata: stringMetadata(price.metadata) } : {}),
      ...(line.period?.start != null ? { periodStart: line.period.start } : {}),
      ...(line.period?.end != null ? { periodEnd: line.period.end } : {}),
    }
  }))
  const subscriptionId = identifier(invoice.subscription)
  return {
    provider: 'stripe',
    invoiceId: invoice.id,
    ...(invoice.billing_reason ? { billingReason: invoice.billing_reason } : {}),
    ...(subscriptionId ? { subscriptionId } : {}),
    lines,
  }
}

function intervalFor(offer: PaymentCatalogOffer): Stripe.PriceCreateParams.Recurring.Interval | undefined {
  return offer.interval
}

function catalogPriceMatches(price: Stripe.Price, offer: PaymentCatalogOffer): boolean {
  const subscription = offer.kind === 'subscription'
  return price.active &&
    price.unit_amount === offer.unitAmountMinor &&
    price.currency === offer.currency.toLowerCase() &&
    (subscription
      ? price.type === 'recurring' &&
        price.recurring?.interval === intervalFor(offer) &&
        (price.recurring?.interval_count ?? 1) === (offer.intervalCount ?? 1)
      : price.type === 'one_time') &&
    (!offer.usage || Object.entries(offer.metadata ?? {}).every(([key, value]) => price.metadata?.[key] === value))
}

const eventTypes: Record<string, string> = {
  'checkout.session.completed': 'checkout.completed',
  'checkout.session.expired': 'checkout.expired',
  'payment_intent.succeeded': 'payment.succeeded',
  'payment_intent.payment_failed': 'payment.failed',
  'charge.refunded': 'payment.refunded',
  'payout.created': 'payout.updated',
  'payout.updated': 'payout.updated',
  'payout.paid': 'payout.updated',
  'payout.failed': 'payout.updated',
  'payout.canceled': 'payout.updated',
  'customer.subscription.created': 'subscription.created',
  'customer.subscription.updated': 'subscription.updated',
  'customer.subscription.deleted': 'subscription.deleted',
  'invoice.paid': 'invoice.paid',
  'invoice.payment_failed': 'invoice.payment-failed',
}

export function createPaymentProvider(
  secrets: Readonly<Record<string, string | undefined>>,
  runtime?: { stripe: Stripe },
) {
  const stripe = runtime?.stripe
  if (!stripe) throw new PaymentProviderError('stripe_client_missing', 'The built-in Stripe client was not initialized.', 500)
  const webhookSecret = secrets.STRIPE_WEBHOOK_SECRET || ''

  return {
    id: 'stripe',
    capabilities: STRIPE_PAYMENT_CAPABILITIES,
    async createCustomer(input: { userId: string; email?: string }) {
      const customer = await stripe.customers.create({
        ...(input.email ? { email: input.email } : {}),
        metadata: { user_id: input.userId },
      })
      return { customerId: customer.id }
    },
    async reportUsage(input: {
      idempotencyKey: string
      customerId: string
      subscriptionId?: string
      meterId: string
      value: number
      occurredAt: number
    }) {
      await sendUsageMeterEvent(stripe, {
        identifier: input.idempotencyKey,
        event_name: input.meterId,
        stripe_customer_id: input.customerId,
        value_micros: input.value,
        created_at: new Date(input.occurredAt * 1000).toISOString(),
      })
      return { reportId: input.idempotencyKey }
    },
    async getDefaultPaymentMethod(customerId: string) {
      const customer = await stripe.customers.retrieve(customerId, {
        expand: ['invoice_settings.default_payment_method'],
      })
      if (customer.deleted) return { paymentMethodId: null }
      const method = customer.invoice_settings?.default_payment_method
      return {
        paymentMethodId: method
          ? typeof method === 'string' ? method : method.id
          : null,
      }
    },
    async createPaymentIntent(input: {
      amountMinor: number
      currency: string
      customerId: string
      paymentMethodId: string
      description: string
      metadata: Readonly<Record<string, string>>
      idempotencyKey: string
    }) {
      try {
        const intent = await stripe.paymentIntents.create({
          amount: input.amountMinor,
          currency: input.currency,
          customer: input.customerId,
          payment_method: input.paymentMethodId,
          off_session: true,
          confirm: true,
          description: input.description,
          metadata: input.metadata,
        }, { idempotencyKey: input.idempotencyKey })
        return {
          paymentIntentId: intent.id,
          status: intent.status,
          ...(typeof intent.client_secret === 'string' ? { clientSecret: intent.client_secret } : {}),
        }
      } catch (cause) {
        const intent = paymentIntentFromError(cause)
        if (!intent) throw cause
        return {
          paymentIntentId: intent.id,
          status: intent.status,
          ...(intent.clientSecret ? { clientSecret: intent.clientSecret } : {}),
        }
      }
    },
    async refund(input: { paymentId: string; amountMinor?: number; idempotencyKey: string }) {
      if (!input.paymentId || !input.idempotencyKey ||
          (input.amountMinor != null && (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0))) {
        throw new PaymentProviderError(
          'invalid_refund',
          'Stripe refund requires a payment id, idempotency key, and a positive amount when partially refunding.',
          422,
        )
      }
      const refund = await stripe.refunds.create({
        payment_intent: input.paymentId,
        ...(input.amountMinor == null ? {} : { amount: input.amountMinor }),
      }, { idempotencyKey: input.idempotencyKey })
      return { refundId: refund.id, status: refund.status }
    },
    async retrievePaymentIntent(paymentIntentId: string) {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId)
      return {
        paymentIntentId: intent.id,
        status: paymentIntentStatus(intent.status, intent.last_payment_error),
        ...(typeof intent.client_secret === 'string' ? { clientSecret: intent.client_secret } : {}),
      }
    },
    async createPayoutAccount(input: {
      accountId?: string
      userId: string
      email?: string
      kind: 'own' | 'managed'
      returnUrl: string
      refreshUrl: string
    }) {
      const account = input.accountId
        ? await stripe.accounts.retrieve(input.accountId)
        : await stripe.accounts.create({
          type: input.kind === 'own' ? 'standard' : 'express',
          ...(input.email ? { email: input.email } : {}),
          ...(input.kind === 'managed' ? { capabilities: { transfers: { requested: true } } } : {}),
          metadata: { user_id: input.userId },
        })
      const link = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: input.refreshUrl,
        return_url: input.returnUrl,
        type: 'account_onboarding',
      })
      return { accountId: account.id, onboardingUrl: link.url, ready: !!account.payouts_enabled }
    },
    async retrievePayoutAccount(accountId: string) {
      const account = await stripe.accounts.retrieve(accountId)
      return {
        accountId: account.id,
        ready: !!account.payouts_enabled,
        detailsSubmitted: !!account.details_submitted,
      }
    },
    async createPayout(input: {
      accountId: string
      amountMinor: number
      currency: string
      idempotencyKey: string
      metadata: Readonly<Record<string, string>>
    }) {
      const transfer = await stripe.transfers.create({
        amount: input.amountMinor,
        currency: input.currency,
        destination: input.accountId,
        metadata: input.metadata,
      }, { idempotencyKey: input.idempotencyKey })
      return { payoutId: transfer.id, status: 'created' }
    },
    async createCheckout(input: CreatePaymentCheckout) {
      if (input.shippingCountry != null && !/^[A-Z]{2}$/.test(input.shippingCountry)) {
        throw new PaymentProviderError('invalid_shipping_country', 'Stripe checkout shipping country must be a two-letter uppercase country code.', 422)
      }
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = []
      for (const line of input.lines) {
        const metadata = { ...(line.metadata ?? {}), key: line.offerKey, sku: line.sku }
        if (line.providerPriceId) {
          lineItems.push({
            price: line.providerPriceId,
            quantity: line.quantity,
            ...(line.adjustableQuantity ? {
              adjustable_quantity: {
                enabled: true,
                minimum: line.adjustableQuantity.minimum,
                maximum: line.adjustableQuantity.maximum,
              },
            } : {}),
          })
        } else {
          lineItems.push({
            price_data: {
              currency: line.currency,
              unit_amount: line.unitAmountMinor,
              ...(line.billing === 'subscription' ? {
                recurring: { interval: line.interval ?? 'month' },
              } : {}),
              product_data: {
                name: line.name,
                metadata,
              },
            },
            quantity: line.quantity,
          })
        }
        if (line.providerUsagePriceId) {
          lineItems.push({ price: line.providerUsagePriceId, quantity: 1 })
        }
      }
      const session = await stripe.checkout.sessions.create({
        mode: input.mode,
        ...(input.customer?.providerCustomerId ? { customer: input.customer.providerCustomerId } : {}),
        ...(input.customerEmail && !input.customer ? { customer_email: input.customerEmail } : {}),
        line_items: lineItems,
        ...(input.customer?.userId ? { client_reference_id: input.customer.userId } : {}),
        metadata: input.metadata,
        success_url: input.successUrl.replaceAll('{CHECKOUT_ID}', '{CHECKOUT_SESSION_ID}'),
        cancel_url: input.cancelUrl,
        allow_promotion_codes: input.allowPromotionCodes ?? false,
        ...(input.mode === 'subscription' && (input.customer?.userId || input.trialDays) ? {
          subscription_data: {
            ...(input.customer?.userId ? { metadata: { user_id: input.customer.userId } } : {}),
            ...(input.trialDays ? { trial_period_days: input.trialDays } : {}),
          },
        } : {}),
        ...(input.automaticTax ? {
          automatic_tax: { enabled: true },
          ...(input.customer?.providerCustomerId ? { customer_update: { address: 'auto' } } : {}),
        } : {}),
        ...(input.collectTaxId ? { tax_id_collection: { enabled: true } } : {}),
        ...(input.allowedPaymentMethods?.length ? {
          payment_method_types: [...input.allowedPaymentMethods] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
        } : {}),
        ...(input.shippingAddress ? {
          shipping_address_collection: {
            allowed_countries: input.shippingCountry
              ? [input.shippingCountry as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry]
              : [],
          },
          ...(input.collectPhone ? { phone_number_collection: { enabled: true } } : {}),
          ...(input.shippingOptions?.length ? {
            shipping_options: input.shippingOptions.map((option) => ({
              shipping_rate_data: {
                type: 'fixed_amount',
                display_name: option.label,
                fixed_amount: { amount: option.amountMinor, currency: option.currency },
                metadata: option.metadata ?? {},
                ...(option.deliveryEstimate ? {
                  delivery_estimate: {
                    minimum: { unit: 'business_day', value: option.deliveryEstimate.minimumDays },
                    maximum: { unit: 'business_day', value: option.deliveryEstimate.maximumDays },
                  },
                } : {}),
              },
            })),
          } : {}),
        } : {}),
        ...(input.shippingSubmitMessage ? {
          custom_text: { submit: { message: input.shippingSubmitMessage } },
        } : {}),
      }, { idempotencyKey: input.idempotencyKey })
      if (!session.url) {
        throw new PaymentProviderError('checkout_url_missing', 'Stripe created a checkout session without a redirect URL.', 502)
      }
      return {
        provider: 'stripe',
        checkoutId: session.id,
        url: session.url,
        ...(identifier(session.customer) ? { customerId: identifier(session.customer) } : {}),
        ...(session.expires_at ? { expiresAt: session.expires_at } : {}),
      }
    },
    async retrieveCheckout(checkoutId: string): Promise<PaymentCheckoutSnapshot> {
      const session = await stripe.checkout.sessions.retrieve(checkoutId, {
        expand: [
          'line_items.data.price.product',
          'shipping_cost.shipping_rate',
        ],
      })
      const status = session.status
      const mode = session.mode
      if ((status !== 'open' && status !== 'complete' && status !== 'expired') ||
          (mode !== 'payment' && mode !== 'subscription')) {
        throw new PaymentProviderError('invalid_checkout_snapshot', 'Stripe returned a checkout with an unsupported status or mode.', 502)
      }
      const paymentStatus = session.payment_status
      if (!['paid', 'unpaid', 'no_payment_required'].includes(paymentStatus)) {
        throw new PaymentProviderError('invalid_checkout_snapshot', 'Stripe returned an unsupported checkout payment status.', 502)
      }
      const rawLines = session.line_items?.data ??
        (await stripe.checkout.sessions.listLineItems(checkoutId, { limit: 100 })).data
      const lines: PaymentCheckoutSnapshot['lines'][number][] = []
      for (const line of rawLines) {
        const rawPrice = line.price
        const price = typeof rawPrice === 'string'
          ? await stripe.prices.retrieve(rawPrice, { expand: ['product'] })
          : rawPrice
        if (!price) throw new PaymentProviderError('checkout_price_missing', 'A Stripe checkout line has no price.', 502)
        const rawProduct = price.product
        const product = typeof rawProduct === 'string'
          ? await stripe.products.retrieve(rawProduct)
          : rawProduct
        const productMetadata = product && !('deleted' in product) ? product.metadata : {}
        const metadata = { ...stringMetadata(productMetadata), ...stringMetadata(price.metadata) }
        const productId = identifier(price.product)
        const sku = metadata.sku
        const offerKey = price.lookup_key ?? metadata.key
        if (!sku || !offerKey) {
          throw new PaymentProviderError('checkout_offer_identity_missing', 'A Stripe checkout line has no site offer identity.', 502)
        }
        const unitAmountMinor = price.unit_amount ??
          (price.unit_amount_decimal == null ? null : Math.round(Number(price.unit_amount_decimal)))
        if (unitAmountMinor == null || !Number.isSafeInteger(unitAmountMinor) || unitAmountMinor < 0) {
          throw new PaymentProviderError('checkout_amount_missing', `Stripe price "${price.id}" has no valid unit amount.`, 502)
        }
        lines.push({
          offerKey,
          sku,
          name: product && !('deleted' in product) ? product.name : price.nickname ?? sku,
          currency: price.currency,
          billing: price.type === 'recurring' ? 'subscription' : 'once',
          ...(price.recurring?.interval ? { interval: price.recurring.interval } : {}),
          unitAmountMinor,
          quantity: line.quantity ?? 1,
          providerPriceId: price.id,
          ...(productId ? { productId } : {}),
          metadata,
        })
      }
      const expandedSubscription = session.subscription
      const subscription = expandedSubscription && typeof expandedSubscription === 'object'
        ? expandedSubscription as Stripe.Subscription
        : typeof expandedSubscription === 'string'
          ? await stripe.subscriptions.retrieve(expandedSubscription, {
            expand: ['items.data.price.product'],
          })
          : null
      const rawShipping = session.shipping_details ?? session.collected_information?.shipping_details ?? null
      const rawShippingRate = session.shipping_cost?.shipping_rate
      const shippingRateId = identifier(rawShippingRate)
      const shippingRate = rawShippingRate && typeof rawShippingRate === 'object'
        ? rawShippingRate
        : shippingRateId ? await stripe.shippingRates.retrieve(shippingRateId) : null
      const metadata = stringMetadata(session.metadata)
      const customerId = identifier(session.customer)
      const paymentId = identifier(session.payment_intent)
      const subscriptionId = identifier(expandedSubscription)
      const userId = metadata.user_id ?? session.client_reference_id ?? undefined
      const customerEmail = session.customer_details?.email ?? session.customer_email ?? undefined
      return {
        provider: 'stripe',
        checkoutId: session.id,
        status,
        paymentStatus,
        mode,
        ...(customerId ? { customerId } : {}),
        ...(paymentId ? { paymentId } : {}),
        ...(subscriptionId ? { subscriptionId } : {}),
        ...(subscription ? { subscription: subscriptionSnapshot(subscription) } : {}),
        ...(userId ? { userId } : {}),
        ...(customerEmail ? { customerEmail } : {}),
        ...(session.customer_details?.name ? { customerName: session.customer_details.name } : {}),
        ...(session.customer_details?.phone ? { customerPhone: session.customer_details.phone } : {}),
        ...(session.amount_total != null ? { amountTotalMinor: session.amount_total } : {}),
        ...(session.currency ? { currency: session.currency } : {}),
        metadata,
        lines,
        ...(rawShipping ? {
          shippingAddress: {
            ...(rawShipping.name ? { name: rawShipping.name } : {}),
            ...(rawShipping.address?.line1 ? { line1: rawShipping.address.line1 } : {}),
            ...(rawShipping.address?.line2 ? { line2: rawShipping.address.line2 } : {}),
            ...(rawShipping.address?.city ? { city: rawShipping.address.city } : {}),
            ...(rawShipping.address?.state ? { state: rawShipping.address.state } : {}),
            ...(rawShipping.address?.postal_code ? { postalCode: rawShipping.address.postal_code } : {}),
            ...(rawShipping.address?.country ? { country: rawShipping.address.country } : {}),
          },
        } : {}),
        ...(session.customer_details?.address ? {
          billingAddress: {
            ...(session.customer_details.address.line1 ? { line1: session.customer_details.address.line1 } : {}),
            ...(session.customer_details.address.line2 ? { line2: session.customer_details.address.line2 } : {}),
            ...(session.customer_details.address.city ? { city: session.customer_details.address.city } : {}),
            ...(session.customer_details.address.state ? { state: session.customer_details.address.state } : {}),
            ...(session.customer_details.address.postal_code ? { postalCode: session.customer_details.address.postal_code } : {}),
            ...(session.customer_details.address.country ? { country: session.customer_details.address.country } : {}),
          },
        } : {}),
        ...(shippingRateId ? { shippingOptionId: shippingRateId } : {}),
        ...(session.shipping_cost?.amount_total != null ? { shippingAmountMinor: session.shipping_cost.amount_total } : {}),
        ...(shippingRate?.metadata?.level ? { shippingLevel: shippingRate.metadata.level } : {}),
      }
    },
    async syncCatalog(offers: readonly PaymentCatalogOffer[]) {
      const synced: Record<string, {
        productId: string
        priceId: string
        usagePriceId?: string
        made: boolean
      }> = {}
      for (const offer of offers) {
        if (!offer.offerKey || !offer.sku || !offer.name || !Number.isSafeInteger(offer.unitAmountMinor) ||
            offer.unitAmountMinor < 0 || !/^[a-z]{3}$/.test(offer.currency.toLowerCase()) ||
            (offer.kind === 'subscription' && !offer.interval) ||
            Object.entries(offer.currencyOptions ?? {}).some(([currency, amount]) =>
              !/^[a-z]{3}$/.test(currency.toLowerCase()) || !Number.isSafeInteger(amount) || amount < 0) ||
            (offer.usage && (!offer.usage.meter || !offer.usage.unit ||
              !Number.isSafeInteger(offer.usage.rateMicros) || offer.usage.rateMicros <= 0 ||
              !Number.isSafeInteger(offer.usage.overagePriceMicros) || offer.usage.overagePriceMicros <= 0))) {
          throw new PaymentProviderError('invalid_catalog_offer', 'Stripe catalog synchronization received an invalid site offer.', 422)
        }
        const metadata = { ...(offer.metadata ?? {}), key: offer.offerKey, sku: offer.sku }
        const live = await stripe.prices.list({ lookup_keys: [offer.offerKey], active: true, limit: 1 })
        const current = live.data[0]
        let product: Stripe.Product
        if (current) {
          const currentProductId = identifier(current.product)
          if (!currentProductId) {
            throw new PaymentProviderError('catalog_product_missing', 'Stripe returned an active catalog price without a product id.', 502)
          }
          const currentProduct = await stripe.products.retrieve(currentProductId)
          if ('deleted' in currentProduct) {
            throw new PaymentProviderError('catalog_product_missing', 'Stripe returned an active catalog price for a deleted product.', 502)
          }
          product = currentProduct
        } else {
          const found = await stripe.products.search({
            query: `active:'true' AND metadata['key']:'${offer.offerKey}'`,
            limit: 1,
          })
          if (found.data[0]) {
            product = found.data[0]
          } else {
            const old = await stripe.products.search({
              query: `active:'true' AND metadata['sku']:'${offer.sku}'`,
              limit: 1,
            })
            if (old.data[0]) {
              product = old.data[0]
            } else {
              product = await stripe.products.create({
                name: offer.name,
                ...(offer.description ? { description: offer.description } : {}),
                metadata,
              })
            }
          }
        }
        if (
          product.name !== offer.name ||
          (offer.description != null && product.description !== offer.description) ||
          Object.entries(metadata).some(([key, value]) => product.metadata?.[key] !== value)
        ) {
          product = await stripe.products.update(product.id, {
            name: offer.name,
            ...(offer.description != null ? { description: offer.description } : {}),
            metadata,
          })
        }
        if (!product) {
          throw new PaymentProviderError('catalog_product_missing', 'Stripe did not return the synchronized catalog product.', 502)
        }

        const retireBySku = async (keep: string) => {
          const oldPrices = await stripe.prices.list({ lookup_keys: [offer.sku], active: true, limit: 1 })
          for (const price of oldPrices.data) {
            if (identifier(price.product) === product.id && price.id !== keep) {
              await stripe.products.update(product.id, { default_price: keep })
              await stripe.prices.update(price.id, { active: false })
            }
          }
        }
        let priceId: string
        let baseMade = false
        if (current && identifier(current.product) === product.id && catalogPriceMatches(current, offer)) {
          priceId = current.id
          await retireBySku(priceId)
        } else {
          const recurring = offer.kind === 'subscription'
          const price = await stripe.prices.create({
            product: product.id,
            unit_amount: offer.unitAmountMinor,
            currency: offer.currency.toLowerCase(),
            lookup_key: offer.offerKey,
            transfer_lookup_key: true,
            metadata,
            ...(Object.keys(offer.currencyOptions ?? {}).length ? {
              currency_options: Object.fromEntries(
                Object.entries(offer.currencyOptions ?? {}).map(([currency, amount]) => [currency, { unit_amount: amount }]),
              ),
            } : {}),
            ...(recurring ? {
              recurring: {
                interval: intervalFor(offer) ?? 'month',
                interval_count: offer.intervalCount ?? 1,
              },
            } : {}),
          })
          priceId = price.id
          baseMade = true
          await stripe.products.update(product.id, { default_price: price.id })
          if (current) await stripe.prices.update(current.id, { active: false })
          await retireBySku(price.id)
        }

        let usagePriceId: string | undefined
        let usageMade = false
        if (offer.usage) {
          if (offer.kind !== 'subscription' || !offer.interval) {
            throw new PaymentProviderError('invalid_metered_offer', `Metered offer "${offer.offerKey}" must be a recurring subscription.`, 422)
          }
          const usage = await ensureUsageBilling(stripe, {
            key: offer.offerKey,
            sku: offer.sku,
            title: offer.name,
            billing: 'subscription',
            period: offer.interval === 'week' ? 'weekly' : 'monthly',
            currency: offer.currency,
            usage: {
              meter: offer.usage.meter,
              unit: offer.usage.unit,
              rate_micros: offer.usage.rateMicros,
              included_micros: offer.usage.includedMicros,
              overage_price_micros: offer.usage.overagePriceMicros,
              incremental_charge_minor: offer.usage.incrementalChargeMinor,
              speech_cost_per_second_micros: offer.usage.speechCostPerSecondMicros,
            },
          }, product.id, metadata)
          if (usage) {
            usagePriceId = usage.price
            usageMade = usage.made
          }
        }
        synced[offer.offerKey] = {
          productId: product.id,
          priceId,
          ...(usagePriceId ? { usagePriceId } : {}),
          made: baseMade || usageMade,
        }
      }
      return { provider: 'stripe', offers: synced }
    },
    async createPortalSession(input: { customerId: string; returnUrl: string }) {
      const session = await stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      })
      return { url: session.url }
    },
    async changeSubscription(input: {
      subscriptionId: string
      offerKey: string
      proration: 'none' | 'immediate' | 'next-cycle'
      idempotencyKey: string
      userId?: string
    }) {
      const subscription = await stripe.subscriptions.retrieve(input.subscriptionId)
      const item = subscription.items.data[0]
      if (!item) throw new PaymentProviderError('subscription_item_missing', 'The subscription has no billable item.', 409)
      const prices = await stripe.prices.list({ lookup_keys: [input.offerKey], active: true, limit: 1 })
      const price = prices.data[0]
      if (!price) throw new PaymentProviderError('catalog_price_missing', `No active Stripe price exists for offer "${input.offerKey}".`, 409)

      const scheduleId = identifier(subscription.schedule)
      if (scheduleId) {
        await stripe.subscriptionSchedules.release(scheduleId, {}, {
          idempotencyKey: `${input.idempotencyKey}:release`,
        })
      }

      if (input.proration === 'next-cycle') {
        const schedule = await stripe.subscriptionSchedules.create(
          { from_subscription: subscription.id },
          { idempotencyKey: `${input.idempotencyKey}:schedule` },
        )
        await stripe.subscriptionSchedules.update(schedule.id, {
          end_behavior: 'release',
          phases: [
            {
              items: [{ price: item.price.id, quantity: item.quantity ?? 1 }],
              start_date: schedule.phases[0].start_date,
              end_date: subscription.current_period_end,
              proration_behavior: 'none',
            },
            {
              items: [{ price: price.id, quantity: 1 }],
              iterations: 1,
              proration_behavior: 'none',
              ...(input.userId ? { metadata: { user_id: input.userId } } : {}),
            },
          ],
        }, { idempotencyKey: `${input.idempotencyKey}:schedule-update` })
        return {
          subscriptionId: subscription.id,
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end,
          nextAt: subscription.current_period_end,
          subscription: subscriptionSnapshot(subscription),
        }
      }

      if (
        input.proration === 'none' &&
        (item.price.lookup_key ?? item.price.metadata?.key) === input.offerKey
      ) {
        return {
          subscriptionId: subscription.id,
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end,
          subscription: subscriptionSnapshot(subscription),
        }
      }

      const updated = await stripe.subscriptions.update(subscription.id, {
        items: [{ id: item.id, price: price.id }],
        proration_behavior: input.proration === 'immediate' ? 'always_invoice' : 'none',
        payment_behavior: 'error_if_incomplete',
        ...(input.userId ? { metadata: { user_id: input.userId } } : {}),
      }, { idempotencyKey: input.idempotencyKey })
      return {
        subscriptionId: updated.id,
        status: updated.status,
        currentPeriodEnd: updated.current_period_end,
        subscription: subscriptionSnapshot(updated),
      }
    },
    async verifyWebhook(request: Request) {
      if (!webhookSecret) {
        throw new PaymentProviderError('webhook_unconfigured', 'Stripe webhook verification is not configured.', 503)
      }
      const rawBody = await request.text()
      let event: Stripe.Event
      try {
        event = await stripe.webhooks.constructEventAsync(
          rawBody,
          request.headers.get('stripe-signature') ?? '',
          webhookSecret,
        )
      } catch (error) {
        throw new PaymentProviderError(
          'invalid_webhook',
          `Stripe webhook verification failed: ${String((error as Error)?.message ?? error)}`,
          400,
        )
      }
      const normalizedType = eventTypes[event.type]
      if (!normalizedType) return []
      const object = event.data.object
      const objectId = identifier(object)
      const objectMetadata = Reflect.get(object, 'metadata')
      const metadata = stringMetadata(objectMetadata)
      const customerId = identifier(Reflect.get(object, 'customer'))
      const paymentId = event.type.startsWith('payment_intent.')
        ? objectId
        : identifier(Reflect.get(object, 'payment_intent'))
      const subscriptionId = event.type.startsWith('customer.subscription.')
        ? objectId
        : identifier(Reflect.get(object, 'subscription'))
      const subscription = event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated'
        ? subscriptionSnapshot(object as Stripe.Subscription)
        : event.type === 'invoice.paid' && subscriptionId
          ? subscriptionSnapshot(await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price.product'] }))
          : undefined
      const invoice = event.type === 'invoice.paid'
        ? await invoiceSnapshot(stripe, object as Stripe.Invoice)
        : undefined
      const amountTotal = Reflect.get(object, 'amount_total')
      const amount = Reflect.get(object, 'amount')
      const amountRefunded = event.type === 'charge.refunded'
        ? Reflect.get(object, 'amount_refunded')
        : undefined
      const amountMinor = typeof amountRefunded === 'number' ? amountRefunded
        : typeof amountTotal === 'number' ? amountTotal
          : typeof amount === 'number' ? amount
          : undefined
      const currency = Reflect.get(object, 'currency')
      const payoutId = event.type.startsWith('payout.') ? objectId : null
      const status = Reflect.get(object, 'status')
      return [normalizePaymentEvent('stripe', {
        provider: 'stripe',
        eventId: event.id,
        type: normalizedType,
        occurredAt: event.created,
        ...(customerId ? { customerId } : {}),
        ...(event.type.startsWith('checkout.session.') && objectId ? { checkoutId: objectId } : {}),
        ...(event.type.startsWith('customer.subscription.') && objectId ? { subscriptionId: objectId } : {}),
        ...(paymentId ? { paymentId } : {}),
        ...(payoutId ? { payoutId } : {}),
        ...(subscriptionId ? { subscriptionId } : {}),
        ...(amountMinor != null ? { amountMinor } : {}),
        ...(typeof currency === 'string' ? { currency } : {}),
        ...(typeof status === 'string' ? { status } : {}),
        ...(Object.keys(metadata).length ? { metadata } : {}),
        ...(subscription ? { subscription } : {}),
        ...(invoice ? { invoice } : {}),
      })]
    },
  }
}

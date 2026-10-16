import type {
  CreatePaymentCheckout,
  PaymentCatalogOffer,
  PaymentCheckoutSnapshot,
  PaymentCapability,
  PaymentProviderAdapter,
} from './payment-provider.d.ts'
import { PaymentProviderError } from './payment-provider.mjs'
import {
  createHyperswitchApi,
  hyperswitchClientUrl,
  verifyHyperswitchWebhook,
} from './hyperswitch-api.mjs'
import { paymentPeriodEnd } from './hyperswitch-billing.mjs'

type HyperswitchPayload = Record<string, unknown>
const HYPERSWITCH_CAPABILITIES: readonly PaymentCapability[] = [
  'checkout.one-time',
  'checkout.subscription',
  'checkout.confirm',
  'checkout.trial',
  'checkout.tax',
  'checkout.payment-method-selection',
  'checkout.adjustable-quantity',
  'checkout.shipping-address',
  'checkout.shipping-options',
  'subscription.change',
  'subscription.proration',
  'customer.create',
  'customer.portal',
  'catalog.sync',
  'refunds',
  'usage.prepaid-top-up',
  'payouts.connected-accounts',
]

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PaymentProviderError(
      'hyperswitch_invalid_response',
      `Hyperswitch did not return ${field}.`,
      502,
    )
  }
  return value
}

function paymentStatus(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : ''
}

function epochSeconds(value: unknown): number {
  if (Number.isSafeInteger(value) && Number(value) >= 0) return Number(value)
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed / 1000)
  }
  return Math.floor(Date.now() / 1000)
}

function normalizedPaymentStatus(value: unknown): PaymentCheckoutSnapshot['status'] {
  const status = paymentStatus(value)
  if (status === 'succeeded') return 'complete'
  if (status === 'cancelled' || status === 'canceled') return 'expired'
  if ([
    'failed',
    'processing',
    'requires_capture',
    'requires_confirmation',
    'requires_customer_action',
    'requires_payment_method',
  ].includes(status)) return 'open'
  throw new PaymentProviderError(
    'hyperswitch_invalid_response',
    `Hyperswitch returned unsupported payment status "${status || 'missing'}".`,
    502,
  )
}

function assertProfileCapability(
  profileCapabilities: readonly string[],
  capability: string,
  term = capability,
) {
  if (!profileCapabilities.includes(capability)) {
    throw new PaymentProviderError(
      'hyperswitch_profile_capability_unavailable',
      `The configured Hyperswitch profile has not declared "${capability}", required for ${term}.`,
      422,
    )
  }
}

async function stablePaymentId(idempotencyKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(idempotencyKey)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const suffix = [...digest.slice(0, 16)].map((part) => part.toString(16).padStart(2, '0')).join('')
  return `pay_${suffix}`
}

async function stablePayoutId(idempotencyKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(idempotencyKey)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const suffix = [...digest].map((part) => part.toString(16).padStart(2, '0')).join('')
  return `po_${suffix.slice(0, 27)}`
}

function payoutType(method: HyperswitchPayload): 'card' | 'bank' | 'wallet' | null {
  const type = typeof method.payment_method === 'string'
    ? method.payment_method.toLowerCase()
    : ''
  if (type === 'card') return 'card'
  if (type === 'bank_transfer' || type === 'bank_debit') return 'bank'
  if (type === 'wallet') return 'wallet'
  return null
}

function parseOrderDetails(
  value: unknown,
  metadata: Record<string, string>,
  fallbackCurrency?: string,
) {
  if (!Array.isArray(value)) return []
  const skus = (metadata.skus ?? '').split(',').map((sku) => sku.trim()).filter(Boolean)
  const subscriptionMetadata = (() => {
    if (metadata.platformkit_subscription_metadata == null) return {}
    try {
      const parsed = JSON.parse(metadata.platformkit_subscription_metadata)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? Object.fromEntries(Object.entries(parsed).filter(([, item]) => typeof item === 'string')) as Record<string, string>
        : {}
    } catch {
      return {}
    }
  })()
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const line = entry as HyperswitchPayload
    const offerKey = typeof line.product_id === 'string' ? line.product_id : undefined
    const quantity = Number(line.quantity ?? 1)
    const amount = Number(line.amount)
    const subscriptionAmount = Number(metadata.platformkit_subscription_amount)
    const currency = typeof line.currency === 'string' ? line.currency : fallbackCurrency
    if (!offerKey || !Number.isSafeInteger(quantity) || quantity < 1 ||
        !Number.isSafeInteger(amount) || amount < 0 || !currency) return []
    const subscription = metadata.platformkit_checkout_mode === 'subscription'
    const unitAmountMinor = subscription && Number.isSafeInteger(subscriptionAmount) && subscriptionAmount >= 0
      ? subscriptionAmount
      : Math.floor(amount / quantity)
    return [{
      offerKey,
      sku: metadata.platformkit_subscription_sku ?? skus[0] ?? offerKey,
      name: typeof line.product_name === 'string' ? line.product_name : offerKey,
      quantity,
      unitAmountMinor,
      currency,
      billing: subscription ? 'subscription' as const : 'once' as const,
      ...(subscription && metadata.platformkit_subscription_interval
        ? { interval: metadata.platformkit_subscription_interval as 'day' | 'week' | 'month' | 'year' }
        : {}),
      providerPriceId: `platformkit:${encodeURIComponent(offerKey)}`,
      productId: `platformkit:${encodeURIComponent(offerKey)}`,
      metadata: subscription ? subscriptionMetadata : { key: offerKey, sku: skus.shift() ?? offerKey },
    }]
  })
}

export function createPaymentProvider(
  secrets: Readonly<Record<string, string | undefined>>,
  configuration: { profileCapabilities: readonly string[] },
  runtime: { fetch?: typeof fetch } = {},
): PaymentProviderAdapter {
  const api = createHyperswitchApi(secrets, configuration, runtime)
  const webhookSecret = secrets.HYPERSWITCH_WEBHOOK_SECRET || ''
  const profileCapabilities = api.profileCapabilities
  const publishableKey = requiredString(secrets.HYPERSWITCH_PUBLISHABLE_KEY, 'HYPERSWITCH_PUBLISHABLE_KEY')
  if (!/^pk_(?:dev|snd|prd)_[^\s]+$/.test(publishableKey)) {
    throw new PaymentProviderError(
      'hyperswitch_configuration_invalid',
      'HYPERSWITCH_PUBLISHABLE_KEY must use a Web SDK key issued with the pk_dev_, pk_snd_, or pk_prd_ prefix.',
      503,
    )
  }
  const baseUrl = requiredString(secrets.HYPERSWITCH_BASE_URL, 'HYPERSWITCH_BASE_URL').replace(/\/+$/, '')
  const clientUrl = hyperswitchClientUrl(secrets.HYPERSWITCH_CLIENT_URL)

  const retrievePayment = async (paymentId: string) => {
    if (!paymentId || paymentId.length > 255) {
      throw new PaymentProviderError('invalid_payment_reference', 'Hyperswitch payment id is invalid.', 422)
    }
    return api.request(
      'GET',
      `/payments/${encodeURIComponent(paymentId)}?force_sync=true`,
    )
  }

  const listPayoutMethods = async (customerId: string): Promise<HyperswitchPayload[]> => {
    const response = await api.request(
      'GET',
      `/customers/${encodeURIComponent(customerId)}/payment_methods`,
    )
    if (!Array.isArray(response.customer_payment_methods)) {
      throw new PaymentProviderError(
        'hyperswitch_invalid_response',
        'Hyperswitch returned an invalid payout-method list.',
        502,
      )
    }
    return (response.customer_payment_methods as HyperswitchPayload[]).filter((method) =>
      typeof method.payment_token === 'string' &&
      method.payment_token.trim().length > 0 &&
      payoutType(method) !== null
    )
  }

  const selectedPayoutMethod = (methods: HyperswitchPayload[]): HyperswitchPayload | null => {
    const defaultMethod = methods.find((method) => method.is_default === true)
    if (defaultMethod) return defaultMethod
    return methods.length === 1 ? methods[0] : null
  }

  return {
    id: 'hyperswitch',
    capabilities: HYPERSWITCH_CAPABILITIES,

    async createCustomer(input) {
      assertProfileCapability(profileCapabilities, 'customer.create')
      if (!input.email) {
        throw new PaymentProviderError(
          'hyperswitch_customer_email_required',
          'Hyperswitch customer creation requires an email address.',
          422,
        )
      }
      let customer: HyperswitchPayload
      try {
        customer = await api.requestV2('POST', '/v2/customers', {
          email: input.email,
          name: input.email,
          merchant_reference_id: input.userId,
        }, `customer:${input.userId}`)
      } catch (error) {
        if (!(error instanceof PaymentProviderError) || error.status !== 404) throw error
        customer = await api.request('POST', '/customers', {
          email: input.email,
          name: input.email,
          merchant_reference_id: input.userId,
        }, `customer:${input.userId}`)
      }
      return {
        customerId: requiredString(customer.id ?? customer.customer_id, 'customer_id'),
      }
    },

    async createCheckout(input: CreatePaymentCheckout) {
      assertProfileCapability(
        profileCapabilities,
        input.mode === 'subscription' ? 'checkout.subscription' : 'checkout.one-time',
      )
      if (!input.successUrl.trim() || !input.cancelUrl.trim()) {
        throw new PaymentProviderError(
          'invalid_checkout',
          'Hyperswitch checkout requires both a success URL and a cancel URL.',
          422,
        )
      }
      if (input.mode === 'subscription' && (
        input.lines.length !== 1 || input.lines[0]?.billing !== 'subscription' ||
        input.lines[0]?.quantity !== 1
      )) {
        throw new PaymentProviderError(
          'invalid_subscription_checkout',
          'Hyperswitch subscription checkout requires one subscription offer at quantity one.',
          422,
        )
      }
      if (input.trialDays != null && (
        !Number.isSafeInteger(input.trialDays) || input.trialDays < 0 || input.trialDays > 365
      )) {
        throw new PaymentProviderError('invalid_checkout', 'Hyperswitch trial days must be a whole number from 0 to 365.', 422)
      }
      if (input.trialDays && input.mode !== 'subscription') {
        throw new PaymentProviderError('invalid_checkout', 'Hyperswitch trials require subscription checkout.', 422)
      }
      if (input.trialDays) {
        assertProfileCapability(profileCapabilities, 'checkout.trial', 'the requested subscription trial')
      }
      if (input.automaticTax || input.collectTaxId) {
        throw new PaymentProviderError(
          'hyperswitch_checkout_term_unavailable',
          'Hyperswitch does not document tax calculation or tax-ID collection for this checkout flow; no payment was created.',
          422,
        )
      }
      if (input.allowedPaymentMethods?.length) {
        assertProfileCapability(
          profileCapabilities,
          'checkout.payment-method-selection',
          'the requested payment-method selection',
        )
      }
      if (input.lines.some((line) => line.adjustableQuantity)) {
        assertProfileCapability(
          profileCapabilities,
          'checkout.adjustable-quantity',
          'adjustable quantities',
        )
        throw new PaymentProviderError(
          'hyperswitch_checkout_term_unavailable',
          'Hyperswitch does not document buyer-adjustable order quantities for this checkout flow; no payment was created.',
          422,
        )
      }
      if (input.shippingAddress || input.shippingOptions?.length || input.shippingCountry ||
          input.collectPhone || input.shippingSubmitMessage) {
        assertProfileCapability(
          profileCapabilities,
          input.shippingOptions?.length ? 'checkout.shipping-options' : 'checkout.shipping-address',
          'shipping collection',
        )
        throw new PaymentProviderError(
          'hyperswitch_checkout_term_unavailable',
          'Hyperswitch does not document this PlatformKit shipping or phone-collection term for the checkout flow; no payment was created.',
          422,
        )
      }
      if (!input.lines.length || input.lines.some((line) =>
        !Number.isSafeInteger(line.unitAmountMinor) || line.unitAmountMinor < 0 ||
        !Number.isSafeInteger(line.quantity) || line.quantity < 1)) {
        throw new PaymentProviderError('invalid_checkout', 'Hyperswitch checkout lines are invalid.', 422)
      }
      const currencies = new Set(input.lines.map((line) => line.currency.toUpperCase()))
      if (input.lines.some((line) => !/^[A-Z]{3}$/.test(line.currency.toUpperCase())) ||
          currencies.size !== 1 || (input.currency && !currencies.has(input.currency.toUpperCase()))) {
        throw new PaymentProviderError(
          'hyperswitch_mixed_currency_checkout',
          'Hyperswitch payment links require a single checkout currency.',
          422,
        )
      }
      const amount = input.lines.reduce(
        (sum, line) => sum + line.unitAmountMinor * line.quantity,
        0,
      )
      const chargeAmount = input.mode === 'subscription' && input.trialDays ? 0 : amount
      if (!Number.isSafeInteger(amount) || amount < 0 ||
          !Number.isSafeInteger(chargeAmount) || (chargeAmount <= 0 && input.mode !== 'subscription')) {
        throw new PaymentProviderError('invalid_checkout_amount', 'Hyperswitch checkout amount must be a positive safe integer except for a zero-amount subscription trial.', 422)
      }
      const paymentId = await stablePaymentId(input.idempotencyKey)
      const successUrl = input.successUrl.replaceAll('{CHECKOUT_ID}', paymentId)
      let cancelUrl: URL
      let parsedSuccessUrl: URL
      try {
        cancelUrl = new URL(input.cancelUrl)
        parsedSuccessUrl = new URL(successUrl)
      } catch {
        throw new PaymentProviderError('invalid_checkout', 'Hyperswitch checkout requires absolute site success and cancel URLs.', 422)
      }
      if (!['https:', 'http:'].includes(cancelUrl.protocol) ||
          !['https:', 'http:'].includes(parsedSuccessUrl.protocol) ||
          cancelUrl.origin !== parsedSuccessUrl.origin ||
          cancelUrl.username || cancelUrl.password ||
          parsedSuccessUrl.username || parsedSuccessUrl.password) {
        throw new PaymentProviderError(
          'invalid_checkout',
          'Hyperswitch checkout success and cancel URLs must use the same HTTP(S) site origin.',
          422,
        )
      }
      const metadata = {
        ...input.metadata,
        platformkit_checkout: '1',
        platformkit_checkout_mode: input.mode,
        ...(input.mode === 'subscription' ? {
          platformkit_subscription_amount: String(input.lines[0]!.unitAmountMinor),
          platformkit_subscription_currency: input.lines[0]!.currency.toUpperCase(),
          platformkit_subscription_interval: input.lines[0]!.interval ?? 'month',
          platformkit_subscription_sku: input.lines[0]!.sku,
          platformkit_subscription_metadata: JSON.stringify(input.lines[0]!.metadata ?? {}),
          ...(input.trialDays ? { platformkit_trial_days: String(input.trialDays) } : {}),
        } : {}),
      }
      const customerId = input.customer?.providerCustomerId
      const response = await api.request('POST', '/payments', {
        profile_id: api.profileId,
        payment_id: paymentId,
        amount: chargeAmount,
        currency: [...currencies][0],
        confirm: false,
        capture_method: 'automatic',
        return_url: successUrl,
        ...(customerId ? { customer_id: customerId } : {}),
        ...((input.customer?.email ?? input.customerEmail)
          ? { email: input.customer?.email ?? input.customerEmail }
          : {}),
        ...(input.allowedPaymentMethods?.length
          ? { allowed_payment_method_types: [...input.allowedPaymentMethods] }
          : {}),
        ...(input.mode === 'subscription' ? { setup_future_usage: 'off_session' } : {}),
        order_details: input.lines.map((line) => ({
          product_id: line.offerKey,
          product_name: line.name,
          quantity: line.quantity,
          amount: chargeAmount === 0 ? 0 : line.unitAmountMinor * line.quantity,
          currency: line.currency.toUpperCase(),
        })),
        metadata,
      }, input.idempotencyKey)
      const returnedId = requiredString(response.payment_id, 'payment_id')
      const clientSecret = requiredString(response.client_secret, 'client_secret')
      if (returnedId !== paymentId) {
        throw new PaymentProviderError(
          'hyperswitch_payment_id_mismatch',
          'Hyperswitch returned a different payment id than the idempotent checkout request.',
          502,
        )
      }
      const customer = typeof response.customer_id === 'string' ? response.customer_id : customerId
      return {
        provider: 'hyperswitch',
        checkoutId: returnedId,
        url: `${cancelUrl.origin}/checkout/hyperswitch?session=${encodeURIComponent(returnedId)}`,
        client: {
          provider: 'hyperswitch',
          apiBaseUrl: baseUrl,
          clientUrl,
          publishableKey,
          clientSecret,
          successUrl,
          cancelUrl: input.cancelUrl,
        },
        ...(customer ? { customerId: customer } : {}),
      }
    },

    async retrieveCheckout(checkoutId: string): Promise<PaymentCheckoutSnapshot> {
      const payment = await retrievePayment(checkoutId)
      const metadata = payment.metadata && typeof payment.metadata === 'object' &&
          !Array.isArray(payment.metadata)
        ? Object.fromEntries(Object.entries(payment.metadata).filter(([, value]) => typeof value === 'string')) as Record<string, string>
        : {}
      if (metadata.platformkit_checkout !== '1') {
        throw new PaymentProviderError(
          'hyperswitch_checkout_not_found',
          'The Hyperswitch payment is not a PlatformKit checkout.',
          404,
        )
      }
      const status = normalizedPaymentStatus(payment.status)
      const paymentState = status === 'complete'
        ? 'paid'
        : status === 'expired' ? 'unpaid' : 'unpaid'
      const customer = typeof payment.customer_id === 'string' ? payment.customer_id : undefined
      const email = typeof payment.email === 'string' ? payment.email : undefined
      const currency = typeof payment.currency === 'string' ? payment.currency : undefined
      const amount = Number(payment.amount)
      const lines = parseOrderDetails(payment.order_details, metadata, currency)
      const mode = metadata.platformkit_checkout_mode === 'subscription' ? 'subscription' : 'payment'
      let subscription: PaymentCheckoutSnapshot['subscription']
      if (mode === 'subscription') {
        const line = lines[0]
        if (!line) {
          throw new PaymentProviderError('hyperswitch_invalid_response', 'Hyperswitch subscription checkout has no valid order line.', 502)
        }
        const currentPeriodStart = epochSeconds(payment.created)
        const trialDays = Number(metadata.platformkit_trial_days)
        const trialEnd = Number.isSafeInteger(trialDays) && trialDays > 0
          ? currentPeriodStart + trialDays * 86400
          : undefined
        const paymentMethodId = typeof payment.payment_method_id === 'string'
          ? payment.payment_method_id
          : ''
        if (status === 'complete' && (!customer || !paymentMethodId)) {
          throw new PaymentProviderError(
            'hyperswitch_recurring_setup_incomplete',
            'Hyperswitch completed the subscription checkout without a customer and saved payment method; no subscription was recorded.',
            502,
          )
        }
        if (customer && paymentMethodId) {
          const periodEnd = trialEnd ?? paymentPeriodEnd(currentPeriodStart, line.interval ?? 'month')
          subscription = {
            provider: 'hyperswitch',
            subscriptionId: requiredString(payment.payment_id, 'payment_id'),
            customerId: customer,
            paymentMethodId,
            status: trialEnd ? 'trialing' : status === 'complete' ? 'active' : paymentStatus(payment.status),
            currentPeriodStart,
            currentPeriodEnd: periodEnd,
            ...(trialEnd ? { trialEnd } : {}),
            metadata,
            items: [{
              priceId: line.providerPriceId!,
              offerKey: line.offerKey,
              sku: line.sku,
              unitAmountMinor: line.unitAmountMinor,
              currency: line.currency,
              quantity: line.quantity,
              metadata: line.metadata ?? {},
            }],
          }
        }
      }
      return {
        provider: 'hyperswitch',
        checkoutId: requiredString(payment.payment_id, 'payment_id'),
        status,
        paymentStatus: paymentState,
        mode,
        ...(customer ? { customerId: customer } : {}),
        paymentId: requiredString(payment.payment_id, 'payment_id'),
        ...(subscription ? { subscriptionId: subscription.subscriptionId, subscription } : {}),
        ...(metadata.user_id ? { userId: metadata.user_id } : {}),
        ...(email ? { customerEmail: email } : {}),
        ...(Number.isSafeInteger(amount) && amount >= 0 ? { amountTotalMinor: amount } : {}),
        ...(currency ? { currency } : {}),
        metadata,
        lines,
      }
    },

    async refund(input) {
      assertProfileCapability(profileCapabilities, 'refunds')
      if (!input.paymentId || !input.idempotencyKey ||
          (input.amountMinor != null && (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0))) {
        throw new PaymentProviderError(
          'invalid_refund',
          'Hyperswitch refund requires a payment id, idempotency key, and a positive amount when partially refunding.',
          422,
        )
      }
      const refund = await api.request('POST', '/refunds', {
        payment_id: input.paymentId,
        ...(input.amountMinor == null ? {} : { amount: input.amountMinor }),
        metadata: { platformkit_idempotency_key: input.idempotencyKey },
      }, input.idempotencyKey)
      return {
        refundId: requiredString(refund.refund_id, 'refund_id'),
        status: requiredString(refund.status, 'refund status'),
      }
    },

    async getDefaultPaymentMethod(customerId: string) {
      if (!profileCapabilities.includes('usage.prepaid-top-up') &&
          !profileCapabilities.includes('checkout.subscription')) {
        throw new PaymentProviderError(
          'hyperswitch_profile_capability_unavailable',
          'The configured Hyperswitch profile has not declared "usage.prepaid-top-up" or "checkout.subscription", required for saved payment method access.',
          422,
        )
      }
      let response: HyperswitchPayload
      try {
        response = await api.requestV2(
          'GET',
          `/v2/customers/${encodeURIComponent(customerId)}/saved-payment-methods`,
        )
      } catch (error) {
        if (!(error instanceof PaymentProviderError) || error.status !== 404) throw error
        response = await api.request(
          'GET',
          `/customers/${encodeURIComponent(customerId)}/payment_methods`,
        )
      }
      if (!Array.isArray(response.customer_payment_methods)) {
        throw new PaymentProviderError(
          'hyperswitch_invalid_response',
          'Hyperswitch returned an invalid saved-payment-method list.',
          502,
        )
      }
      const methods = response.customer_payment_methods as HyperswitchPayload[]
      const selected = methods.find((method) => method.is_default === true)
      return {
        paymentMethodId: selected && typeof selected.id === 'string' ? selected.id : null,
      }
    },

    async createPaymentIntent(input) {
      assertProfileCapability(
        profileCapabilities,
        input.metadata.platformkit_usage_incremental === '1' ||
          input.metadata.platformkit_subscription_renewal === '1' ||
          input.metadata.platformkit_subscription_change != null
          ? 'checkout.subscription'
          : 'usage.prepaid-top-up',
      )
      if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 ||
          !/^[A-Za-z]{3}$/.test(input.currency) || !input.customerId || !input.paymentMethodId) {
        throw new PaymentProviderError(
          'invalid_payment_intent',
          'Hyperswitch payment intent requires a positive amount, three-letter currency, customer, and saved payment method.',
          422,
        )
      }
      const payment = await api.request('POST', '/payments', {
        profile_id: api.profileId,
        amount: input.amountMinor,
        currency: input.currency.toUpperCase(),
        customer_id: input.customerId,
        confirm: true,
        off_session: true,
        authentication_type: 'no_three_ds',
        payment_method: 'card',
        recurring_details: {
          type: 'payment_method_id',
          data: input.paymentMethodId,
        },
        description: input.description,
        metadata: input.metadata,
      }, input.idempotencyKey)
      return {
        paymentIntentId: requiredString(payment.payment_id, 'payment_id'),
        status: requiredString(payment.status, 'payment status'),
        ...(typeof payment.client_secret === 'string' ? { clientSecret: payment.client_secret } : {}),
      }
    },

    async retrievePaymentIntent(paymentIntentId: string) {
      const payment = await retrievePayment(paymentIntentId)
      return {
        paymentIntentId: requiredString(payment.payment_id, 'payment_id'),
        status: requiredString(payment.status, 'payment status'),
        ...(typeof payment.client_secret === 'string' ? { clientSecret: payment.client_secret } : {}),
      }
    },

    async syncCatalog(offers: readonly PaymentCatalogOffer[]) {
      const result: Record<string, { productId: string; priceId: string; made: false }> = {}
      for (const offer of offers) {
        const reference = encodeURIComponent(offer.offerKey)
        result[offer.offerKey] = {
          productId: `platformkit:${reference}`,
          priceId: `platformkit:${reference}`,
          made: false,
        }
      }
      return { provider: 'hyperswitch', offers: result }
    },

    async changeSubscription(input) {
      if (!input.offer || input.offer.kind !== 'subscription' ||
          input.offer.offerKey !== input.offerKey ||
          !Number.isSafeInteger(input.offer.unitAmountMinor) || input.offer.unitAmountMinor < 0 ||
          !/^[A-Za-z]{3}$/.test(input.offer.currency)) {
        throw new PaymentProviderError('invalid_subscription_change', 'Hyperswitch subscription change requires the PlatformKit target offer and a valid price.', 422)
      }
      const current = await retrievePayment(input.subscriptionId)
      const metadata = current.metadata && typeof current.metadata === 'object' &&
          !Array.isArray(current.metadata)
        ? Object.fromEntries(Object.entries(current.metadata).filter(([, value]) => typeof value === 'string')) as Record<string, string>
        : {}
      if (metadata.platformkit_checkout !== '1' ||
          metadata.platformkit_checkout_mode !== 'subscription') {
        throw new PaymentProviderError('hyperswitch_subscription_not_found', 'The Hyperswitch payment is not a PlatformKit-managed subscription.', 404)
      }
      const customerId = typeof current.customer_id === 'string' ? current.customer_id : ''
      const paymentMethodId = typeof current.payment_method_id === 'string' ? current.payment_method_id : ''
      const paymentCreated = epochSeconds(current.created)
      const periodStart = input.currentPeriodStart ?? paymentCreated
      const periodEnd = input.currentPeriodEnd ??
        paymentPeriodEnd(periodStart, metadata.platformkit_subscription_interval ?? 'month')
      const currentAmount = input.currentAmountMinor ??
        Number(metadata.platformkit_subscription_amount)
      const currentSnapshot = customerId && paymentMethodId
        ? (await (async () => {
          const currentCurrency = typeof current.currency === 'string' ? current.currency : undefined
          const line = parseOrderDetails(current.order_details, metadata, currentCurrency)[0]
          if (!line) return undefined
          return {
            provider: 'hyperswitch' as const,
            subscriptionId: input.subscriptionId,
            customerId,
            paymentMethodId,
            status: paymentStatus(current.status) === 'succeeded'
              ? 'active'
              : paymentStatus(current.status),
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            metadata: { ...metadata, ...(input.userId ? { user_id: input.userId } : {}) },
            items: [{
              priceId: line.providerPriceId!,
              offerKey: line.offerKey,
              sku: line.sku,
              unitAmountMinor: currentAmount,
              currency: line.currency,
              quantity: line.quantity,
              metadata: line.metadata ?? {},
            }],
          }
        })())
        : undefined
      if (!customerId || !paymentMethodId || !currentSnapshot) {
        throw new PaymentProviderError('hyperswitch_subscription_setup_incomplete', 'The Hyperswitch subscription has no reusable customer payment method.', 409)
      }
      if (input.proration === 'next-cycle') {
        return {
          subscriptionId: input.subscriptionId,
          status: currentSnapshot.status,
          currentPeriodEnd: periodEnd,
          nextAt: periodEnd,
          subscription: currentSnapshot,
        }
      }
      if (input.proration === 'none' &&
          currentSnapshot.items[0]?.offerKey === input.offerKey) {
        return {
          subscriptionId: input.subscriptionId,
          status: currentSnapshot.status,
          currentPeriodEnd: periodEnd,
          subscription: currentSnapshot,
        }
      }
      if (input.proration === 'immediate') {
        const now = Math.floor(Date.now() / 1000)
        if (!Number.isSafeInteger(currentAmount) || currentAmount < 0 ||
            !Number.isSafeInteger(periodStart) || !Number.isSafeInteger(periodEnd) ||
            periodEnd <= periodStart || periodEnd <= now) {
          throw new PaymentProviderError('invalid_subscription_period', 'Hyperswitch subscription period or current plan amount is invalid.', 409)
        }
        const remaining = Math.max(0, Math.min(1, (periodEnd - now) / (periodEnd - periodStart)))
        const amount = Math.ceil(Math.max(0, input.offer.unitAmountMinor - currentAmount) * remaining)
        if (amount > 0) {
          const payment = await api.request('POST', '/payments', {
            profile_id: api.profileId,
            amount,
            currency: input.offer.currency.toUpperCase(),
            customer_id: customerId,
            confirm: true,
            off_session: true,
            authentication_type: 'no_three_ds',
            payment_method: 'card',
            recurring_details: { type: 'payment_method_id', data: paymentMethodId },
            description: `Subscription plan change to ${input.offer.name}`,
            metadata: {
              platformkit_subscription_id: input.subscriptionId,
              platformkit_subscription_change: input.idempotencyKey,
              platformkit_offer_key: input.offerKey,
            },
          }, input.idempotencyKey)
          if (paymentStatus(payment.status) !== 'succeeded') {
            throw new PaymentProviderError('hyperswitch_subscription_proration_failed', `Hyperswitch could not collect the prorated plan change (status: ${paymentStatus(payment.status) || 'unknown'}).`, 409)
          }
        }
      }
      const updatedSubscription = {
        ...currentSnapshot,
        status: 'active',
        items: [{
          priceId: `platformkit:${encodeURIComponent(input.offer.offerKey)}`,
          offerKey: input.offer.offerKey,
          sku: input.offer.sku,
          unitAmountMinor: input.offer.unitAmountMinor,
          currency: input.offer.currency.toLowerCase(),
          quantity: 1,
          metadata: input.offer.metadata ?? {},
        }],
        metadata: {
          ...currentSnapshot.metadata,
          platformkit_subscription_amount: String(input.offer.unitAmountMinor),
          platformkit_subscription_currency: input.offer.currency.toUpperCase(),
          platformkit_subscription_interval: input.offer.interval ?? 'month',
          platformkit_subscription_sku: input.offer.sku,
          ...(input.userId ? { user_id: input.userId } : {}),
        },
      }
      return {
        subscriptionId: input.subscriptionId,
        status: updatedSubscription.status,
        currentPeriodEnd: periodEnd,
        subscription: updatedSubscription,
      }
    },

    async createPortalSession(input) {
      if (!input.customerId || !input.returnUrl) {
        throw new PaymentProviderError('invalid_portal_session', 'Hyperswitch billing requires a customer and PlatformKit billing return URL.', 422)
      }
      return { url: input.returnUrl }
    },

    async createPaymentMethodSession(input) {
      if (!input.customerId || !input.returnUrl) {
        throw new PaymentProviderError(
          'invalid_payment_method_session',
          'Hyperswitch payment method management requires a customer and PlatformKit return URL.',
          422,
        )
      }
      let session: HyperswitchPayload
      try {
        session = await api.requestV2('POST', '/v2/payment-method-sessions', {
          customer_id: input.customerId,
          storage_type: 'persistent',
          return_url: input.returnUrl,
          keep_alive: true,
        })
      } catch (error) {
        if (!(error instanceof PaymentProviderError) || error.status !== 404) throw error
        session = await api.request('POST', '/v1/payment-method-sessions', {
          customer_id: input.customerId,
          storage_type: 'persistent',
          return_url: input.returnUrl,
          keep_alive: true,
        })
      }
      return {
        sdkAuthorization: requiredString(session.sdk_authorization, 'sdk_authorization'),
        profileId: api.profileId,
      }
    },

    async createPayoutAccount(input) {
      assertProfileCapability(profileCapabilities, 'payouts.connected-accounts')
      assertProfileCapability(profileCapabilities, 'customer.create')
      const returnUrl = new URL(input.returnUrl)
      const refreshUrl = new URL(input.refreshUrl)
      if (returnUrl.origin !== refreshUrl.origin) {
        throw new PaymentProviderError(
          'invalid_payout_return_url',
          'Hyperswitch payout setup return URLs must share the site origin.',
          422,
        )
      }
      let customerId = input.accountId
      if (!customerId) {
        if (!input.email) {
          throw new PaymentProviderError(
            'hyperswitch_payout_email_required',
            'A recipient email is required to create a Hyperswitch payout profile.',
            422,
          )
        }
        const customer = await api.request('POST', '/customers', {
          email: input.email,
          name: input.email,
          merchant_reference_id: `platformkit:payout:${input.userId}`,
          metadata: { platformkit_payout_recipient: input.userId },
        }, `payout-customer:${input.userId}`)
        customerId = requiredString(customer.customer_id, 'payout customer_id')
      }
      const onboardingUrl = new URL('/billing#usage', returnUrl.origin)
      onboardingUrl.searchParams.set('payout_setup', '1')
      onboardingUrl.searchParams.set('payout_return', `${returnUrl.pathname}${returnUrl.search}`)
      onboardingUrl.searchParams.set('payout_cancel', `${refreshUrl.pathname}${refreshUrl.search}`)
      const method = selectedPayoutMethod(await listPayoutMethods(customerId))
      return {
        accountId: customerId,
        onboardingUrl: onboardingUrl.toString(),
        ready: !!method,
      }
    },

    async retrievePayoutAccount(accountId) {
      assertProfileCapability(profileCapabilities, 'payouts.connected-accounts')
      if (!accountId.trim()) {
        throw new PaymentProviderError('invalid_payout_account', 'Hyperswitch payout customer id is required.', 422)
      }
      const method = selectedPayoutMethod(await listPayoutMethods(accountId))
      return {
        accountId,
        ready: !!method,
        detailsSubmitted: !!method,
      }
    },

    async createPayout(input) {
      assertProfileCapability(profileCapabilities, 'payouts.connected-accounts')
      if (!input.accountId.trim() ||
          !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 ||
          !/^[A-Za-z]{3}$/.test(input.currency) ||
          !input.idempotencyKey.trim()) {
        throw new PaymentProviderError(
          'invalid_payout',
          'Hyperswitch payout requires a recipient, positive amount, currency, and idempotency key.',
          422,
        )
      }
      const methods = await listPayoutMethods(input.accountId)
      const method = selectedPayoutMethod(methods)
      if (!method) {
        throw new PaymentProviderError(
          'hyperswitch_payout_method_unavailable',
          methods.length
            ? 'Choose a default Hyperswitch payout method before sending funds. No payout was sent.'
            : 'This recipient has no eligible Hyperswitch payout method. No payout was sent.',
          409,
        )
      }
      const type = payoutType(method)
      if (!type || typeof method.payment_token !== 'string') {
        throw new PaymentProviderError(
          'hyperswitch_payout_method_unavailable',
          'The saved Hyperswitch method is not eligible for payouts. No payout was sent.',
          409,
        )
      }
      const payoutId = await stablePayoutId(input.idempotencyKey)
      let payout: HyperswitchPayload | null = null
      try {
        payout = await api.request(
          'GET',
          `/payouts/${encodeURIComponent(payoutId)}?force_sync=true`,
        )
      } catch (error) {
        if (!(error instanceof PaymentProviderError) || error.status !== 404) throw error
      }
      if (!payout) {
        payout = await api.request('POST', '/payouts/create', {
          payout_id: payoutId,
          amount: input.amountMinor,
          currency: input.currency.toUpperCase(),
          customer: { id: input.accountId },
          payout_token: method.payment_token,
          payout_type: type,
          confirm: true,
          auto_fulfill: true,
          recurring: false,
          profile_id: api.profileId,
          merchant_order_reference_id: input.idempotencyKey,
          metadata: input.metadata,
        }, input.idempotencyKey)
      }
      const status = requiredString(payout.status, 'payout status').toLowerCase()
      if (!['success', 'succeeded', 'initiated', 'pending', 'processing'].includes(status)) {
        throw new PaymentProviderError(
          'hyperswitch_payout_failed',
          `Hyperswitch did not accept the payout (status: ${status}).`,
          409,
        )
      }
      return {
        payoutId: requiredString(payout.payout_id, 'payout_id'),
        status,
      }
    },

    async verifyWebhook(request) {
      return verifyHyperswitchWebhook(request, webhookSecret)
    },
  }
}

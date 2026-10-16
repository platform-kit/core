export const PAYMENT_CAPABILITIES = Object.freeze([
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
  'customer.portal',
  'customer.create',
  'catalog.sync',
  'refunds',
  'usage.metered',
  'usage.prepaid-top-up',
  'payouts.connected-accounts',
])
export const STRIPE_PAYMENT_CAPABILITIES = Object.freeze([
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
  'usage.metered',
  'usage.prepaid-top-up',
  'payouts.connected-accounts',
])
export const PAYMENT_PROVIDER_WEBHOOK_PATH = '/functions/v1/payment-provider-webhook'

const EVENT_TYPES = new Set([
  'checkout.completed',
  'checkout.expired',
  'payment.succeeded',
  'payment.failed',
  'payment.refunded',
  'subscription.created',
  'subscription.updated',
  'subscription.deleted',
  'invoice.paid',
  'invoice.payment-failed',
  'usage.reported',
  'payout.updated',
])

const ID = /^[a-z][a-z0-9-]*$/
const NONEMPTY = (value) => typeof value === 'string' && value.trim().length > 0
const isHttpUrl = (value) => {
  if (!NONEMPTY(value)) return false
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}
const METHODS_FOR_CAPABILITY = Object.freeze({
  'checkout.one-time': ['createCheckout'],
  'checkout.subscription': ['createCheckout'],
  'checkout.confirm': ['retrieveCheckout'],
  'checkout.trial': ['createCheckout'],
  'checkout.tax': ['createCheckout'],
  'checkout.payment-method-selection': ['createCheckout'],
  'checkout.adjustable-quantity': ['createCheckout'],
  'checkout.shipping-address': ['createCheckout'],
  'checkout.shipping-options': ['createCheckout'],
  'subscription.change': ['changeSubscription'],
  'subscription.proration': ['changeSubscription'],
  'customer.portal': ['createPortalSession'],
  'customer.create': ['createCustomer'],
  'catalog.sync': ['syncCatalog'],
  refunds: ['refund'],
  'usage.metered': ['reportUsage'],
  'usage.prepaid-top-up': ['getDefaultPaymentMethod', 'createPaymentIntent', 'retrievePaymentIntent'],
  'payouts.connected-accounts': ['createPayoutAccount', 'retrievePayoutAccount', 'createPayout'],
})

export class PaymentProviderError extends Error {
  constructor(code, message, status = 502) {
    super(message)
    this.name = 'PaymentProviderError'
    this.code = code
    this.status = status
  }
}

export function payoutStatusIsSettled(status) {
  return ['success', 'succeeded'].includes(String(status ?? '').trim().toLowerCase())
}

export function providerScopedId(providerId, externalId) {
  if (!ID.test(providerId || '')) {
    throw new PaymentProviderError('invalid_provider', 'Payment provider id is invalid.', 500)
  }
  if (!NONEMPTY(externalId)) {
    throw new PaymentProviderError('invalid_provider_reference', 'Payment provider reference id is required.', 500)
  }
  return providerId === 'stripe' ? externalId : `${providerId}:${externalId}`
}

export function assertPaymentProvider(adapter) {
  if (!adapter || typeof adapter !== 'object' || !ID.test(adapter.id || '')) {
    throw new PaymentProviderError('invalid_provider', 'Payment provider must declare a stable lowercase id.', 500)
  }
  if (!Array.isArray(adapter.capabilities)) {
    throw new PaymentProviderError('invalid_provider', `Payment provider "${adapter.id}" must declare its capabilities.`, 500)
  }
  if (typeof adapter.verifyWebhook !== 'function') {
    throw new PaymentProviderError('invalid_provider', `Payment provider "${adapter.id}" must implement webhook verification and event normalization.`, 500)
  }
  const declared = new Set()
  for (const capability of adapter.capabilities) {
    if (!PAYMENT_CAPABILITIES.includes(capability)) {
      throw new PaymentProviderError('invalid_provider', `Payment provider "${adapter.id}" declares unknown capability "${capability}".`, 500)
    }
    if (declared.has(capability)) {
      throw new PaymentProviderError('invalid_provider', `Payment provider "${adapter.id}" declares capability "${capability}" more than once.`, 500)
    }
    const missingMethods = METHODS_FOR_CAPABILITY[capability].filter((method) => typeof adapter[method] !== 'function')
    if (missingMethods.length) {
      throw new PaymentProviderError(
        'invalid_provider',
        `Payment provider "${adapter.id}" declares "${capability}" without implementing ${missingMethods.join(', ')}.`,
        500,
      )
    }
    declared.add(capability)
  }
  return adapter
}

export function assertPaymentCapabilities(adapter, required) {
  assertPaymentProvider(adapter)
  if (!Array.isArray(required) || required.some((capability) => !PAYMENT_CAPABILITIES.includes(capability))) {
    throw new PaymentProviderError('invalid_capability_requirement', 'Payment operation requested an unknown capability.', 500)
  }
  const declared = new Set(adapter.capabilities)
  const missing = [...new Set(required)].filter((capability) => !declared.has(capability))
  if (missing.length) {
    throw new PaymentProviderError(
      'unsupported_capability',
      `Payment provider "${adapter.id}" does not support: ${missing.join(', ')}.`,
      422,
    )
  }
}

export function paymentCapabilitiesForCheckout(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      !['payment', 'subscription'].includes(request.mode) ||
      !Array.isArray(request.lines) || !request.lines.length ||
      request.lines.some((line) => !line || typeof line !== 'object' || Array.isArray(line)) ||
      (request.allowedPaymentMethods != null &&
        (!Array.isArray(request.allowedPaymentMethods) || request.allowedPaymentMethods.some((method) => !NONEMPTY(method)))) ||
      (request.shippingOptions != null &&
        (!Array.isArray(request.shippingOptions) || request.shippingOptions.some((option) => !option || typeof option !== 'object' || Array.isArray(option)))) ||
      (request.automaticTax != null && typeof request.automaticTax !== 'boolean') ||
      (request.collectTaxId != null && typeof request.collectTaxId !== 'boolean') ||
      (request.shippingAddress != null && !['required', 'optional'].includes(request.shippingAddress))) {
    throw new PaymentProviderError('invalid_checkout', 'Payment checkout requirements are invalid.', 500)
  }
  const capabilities = new Set([
    request.mode === 'subscription' ? 'checkout.subscription' : 'checkout.one-time',
  ])
  if (request.trialDays != null && (!Number.isSafeInteger(request.trialDays) || request.trialDays < 0)) {
    throw new PaymentProviderError('invalid_checkout', 'Payment checkout trial days must be a non-negative integer.', 500)
  }
  if (request.trialDays > 0 && request.mode !== 'subscription') {
    throw new PaymentProviderError('invalid_checkout', 'Payment checkout trials require subscription mode.', 500)
  }
  if (request.trialDays > 0) capabilities.add('checkout.trial')
  if (request.automaticTax === true || request.collectTaxId === true) capabilities.add('checkout.tax')
  if (request.allowedPaymentMethods?.length) capabilities.add('checkout.payment-method-selection')
  if (request.lines.some((line) => line.adjustable === true)) capabilities.add('checkout.adjustable-quantity')
  if (request.shippingAddress != null || request.shippingOptions?.length) capabilities.add('checkout.shipping-address')
  if (request.shippingOptions?.length) capabilities.add('checkout.shipping-options')
  return Object.freeze([...capabilities])
}

export function paymentCapabilitiesForSubscriptionChange(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      !['none', 'immediate', 'next-cycle'].includes(request.proration)) {
    throw new PaymentProviderError('invalid_subscription_change', 'Payment subscription change requirements are invalid.', 500)
  }
  return Object.freeze([
    'subscription.change',
    ...(request.proration === 'immediate' ? ['subscription.proration'] : []),
  ])
}

export function normalizePaymentEvent(providerId, event) {
  if (!ID.test(providerId || '')) {
    throw new PaymentProviderError('invalid_provider', 'Payment event provider id is invalid.', 500)
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new PaymentProviderError('invalid_provider_event', 'Payment provider returned an invalid event.', 502)
  }
  if (event.provider !== providerId || !NONEMPTY(event.eventId) || !EVENT_TYPES.has(event.type) ||
      !Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0) {
    throw new PaymentProviderError('invalid_provider_event', `Payment provider "${providerId}" returned an incomplete or mismatched event.`, 502)
  }
  for (const key of ['customerId', 'checkoutId', 'paymentId', 'subscriptionId', 'payoutId', 'status', 'offerKey', 'currency']) {
    if (event[key] != null && !NONEMPTY(event[key])) {
      throw new PaymentProviderError('invalid_provider_event', `Payment provider event field "${key}" must be a non-empty string when present.`, 502)
    }
  }
  if (event.amountMinor != null && (!Number.isSafeInteger(event.amountMinor) || event.amountMinor < 0)) {
    throw new PaymentProviderError('invalid_provider_event', 'Payment provider event amountMinor must be a non-negative safe integer.', 502)
  }
  if (event.metadata != null && (
    !event.metadata || typeof event.metadata !== 'object' || Array.isArray(event.metadata) ||
    Object.entries(event.metadata).some(([key, value]) => !NONEMPTY(key) || typeof value !== 'string')
  )) {
    throw new PaymentProviderError('invalid_provider_event', 'Payment provider event metadata must contain only string values.', 502)
  }
  const subscription = event.subscription == null ? undefined : normalizePaymentSubscriptionChange(providerId, {
    subscriptionId: event.subscription.subscriptionId,
    status: event.subscription.status,
    subscription: event.subscription,
  }).subscription
  const invoice = event.invoice == null ? undefined : normalizePaymentInvoice(providerId, event.invoice)
  if (subscription && !['subscription.created', 'subscription.updated', 'invoice.paid'].includes(event.type)) {
    throw new PaymentProviderError('invalid_provider_event', 'Payment provider subscription details do not match the event type.', 502)
  }
  if (invoice && (event.type !== 'invoice.paid' || (event.subscriptionId && invoice.subscriptionId !== event.subscriptionId))) {
    throw new PaymentProviderError('invalid_provider_event', 'Payment provider invoice details do not match the event.', 502)
  }

  return Object.freeze({
    provider: providerId,
    eventId: event.eventId,
    type: event.type,
    occurredAt: event.occurredAt,
    ...(event.customerId != null ? { customerId: event.customerId } : {}),
    ...(event.checkoutId != null ? { checkoutId: event.checkoutId } : {}),
    ...(event.paymentId != null ? { paymentId: event.paymentId } : {}),
    ...(event.subscriptionId != null ? { subscriptionId: event.subscriptionId } : {}),
    ...(event.payoutId != null ? { payoutId: event.payoutId } : {}),
    ...(event.status != null ? { status: event.status } : {}),
    ...(event.offerKey != null ? { offerKey: event.offerKey } : {}),
    ...(event.amountMinor != null ? { amountMinor: event.amountMinor } : {}),
    ...(event.currency != null ? { currency: event.currency.toLowerCase() } : {}),
    ...(event.metadata != null ? { metadata: Object.freeze({ ...event.metadata }) } : {}),
    ...(subscription ? { subscription } : {}),
    ...(invoice ? { invoice } : {}),
  })
}

function normalizedMetadata(metadata, label) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
      Object.entries(metadata).some(([key, value]) => !NONEMPTY(key) || typeof value !== 'string')) {
    throw new PaymentProviderError('invalid_provider_outcome', `Payment provider ${label} metadata must contain only string values.`, 502)
  }
  return Object.freeze({ ...metadata })
}

function optionalText(value, field, providerId) {
  if (value != null && !NONEMPTY(value)) {
    throw new PaymentProviderError('invalid_provider_outcome', `Payment provider "${providerId}" returned an invalid ${field}.`, 502)
  }
  return value == null ? undefined : value
}

function normalizePaymentSubscription(providerId, snapshot) {
  if (!ID.test(providerId || '') || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
      snapshot.provider !== providerId || !NONEMPTY(snapshot.subscriptionId) || !NONEMPTY(snapshot.status) ||
      !Array.isArray(snapshot.items) || !snapshot.items.length) {
    throw new PaymentProviderError('invalid_provider_subscription', `Payment provider "${providerId}" returned an invalid subscription snapshot.`, 502)
  }
  const items = snapshot.items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        !NONEMPTY(item.priceId) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new PaymentProviderError('invalid_provider_subscription', `Payment provider "${providerId}" returned an invalid subscription item.`, 502)
    }
    if (item.unitAmountMinor != null && (!Number.isSafeInteger(item.unitAmountMinor) || item.unitAmountMinor < 0)) {
      throw new PaymentProviderError('invalid_provider_subscription', `Payment provider "${providerId}" returned an invalid subscription amount.`, 502)
    }
    if (item.currency != null && !/^[a-z]{3}$/i.test(item.currency)) {
      throw new PaymentProviderError('invalid_provider_subscription', `Payment provider "${providerId}" returned an invalid subscription currency.`, 502)
    }
    return Object.freeze({
      priceId: item.priceId,
      ...(optionalText(item.offerKey, 'subscription item offer key', providerId) ? { offerKey: item.offerKey } : {}),
      ...(optionalText(item.sku, 'subscription item sku', providerId) ? { sku: item.sku } : {}),
      ...(item.unitAmountMinor != null ? { unitAmountMinor: item.unitAmountMinor } : {}),
      ...(optionalText(item.currency, 'subscription item currency', providerId)
        ? { currency: item.currency.toLowerCase() }
        : {}),
      quantity: item.quantity,
      metadata: normalizedMetadata(item.metadata, 'subscription'),
    })
  })
  for (const field of ['currentPeriodStart', 'currentPeriodEnd', 'trialEnd']) {
    if (snapshot[field] != null && (!Number.isSafeInteger(snapshot[field]) || snapshot[field] < 0)) {
      throw new PaymentProviderError('invalid_provider_subscription', `Payment provider "${providerId}" returned an invalid ${field}.`, 502)
    }
  }
  if (snapshot.cancelAtPeriodEnd != null && typeof snapshot.cancelAtPeriodEnd !== 'boolean') {
    throw new PaymentProviderError('invalid_provider_subscription', `Payment provider "${providerId}" returned an invalid cancellation state.`, 502)
  }
  return Object.freeze({
    provider: providerId,
    subscriptionId: snapshot.subscriptionId,
    ...(optionalText(snapshot.customerId, 'subscription customer id', providerId)
      ? { customerId: snapshot.customerId }
      : {}),
    ...(optionalText(snapshot.paymentMethodId, 'subscription payment method id', providerId)
      ? { paymentMethodId: snapshot.paymentMethodId }
      : {}),
    status: snapshot.status,
    ...(snapshot.currentPeriodStart != null ? { currentPeriodStart: snapshot.currentPeriodStart } : {}),
    ...(snapshot.currentPeriodEnd != null ? { currentPeriodEnd: snapshot.currentPeriodEnd } : {}),
    ...(snapshot.cancelAtPeriodEnd != null ? { cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd } : {}),
    ...(snapshot.trialEnd != null ? { trialEnd: snapshot.trialEnd } : {}),
    ...(optionalText(snapshot.scheduleId, 'subscription schedule id', providerId)
      ? { scheduleId: snapshot.scheduleId }
      : {}),
    metadata: normalizedMetadata(snapshot.metadata, 'subscription'),
    items: Object.freeze(items),
  })
}

function normalizePaymentInvoice(providerId, invoice) {
  if (!invoice || typeof invoice !== 'object' || Array.isArray(invoice) ||
      invoice.provider !== providerId || !NONEMPTY(invoice.invoiceId) || !Array.isArray(invoice.lines)) {
    throw new PaymentProviderError('invalid_provider_event', `Payment provider "${providerId}" returned an invalid invoice snapshot.`, 502)
  }
  const lines = invoice.lines.map((line) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      throw new PaymentProviderError('invalid_provider_event', `Payment provider "${providerId}" returned an invalid invoice line.`, 502)
    }
    for (const field of ['periodStart', 'periodEnd']) {
      if (line[field] != null && (!Number.isSafeInteger(line[field]) || line[field] < 0)) {
        throw new PaymentProviderError('invalid_provider_event', `Payment provider "${providerId}" returned an invalid invoice line ${field}.`, 502)
      }
    }
    if (line.periodStart != null && line.periodEnd != null && line.periodStart > line.periodEnd) {
      throw new PaymentProviderError('invalid_provider_event', `Payment provider "${providerId}" returned an inverted invoice period.`, 502)
    }
    return Object.freeze({
      ...(optionalText(line.priceId, 'invoice line price id', providerId) ? { priceId: line.priceId } : {}),
      ...(optionalText(line.offerKey, 'invoice line offer key', providerId) ? { offerKey: line.offerKey } : {}),
      ...(line.metadata == null ? {} : { metadata: normalizedMetadata(line.metadata, 'invoice line') }),
      ...(line.periodStart != null ? { periodStart: line.periodStart } : {}),
      ...(line.periodEnd != null ? { periodEnd: line.periodEnd } : {}),
    })
  })
  return Object.freeze({
    provider: providerId,
    invoiceId: invoice.invoiceId,
    ...(optionalText(invoice.billingReason, 'invoice billing reason', providerId) ? { billingReason: invoice.billingReason } : {}),
    ...(optionalText(invoice.subscriptionId, 'invoice subscription id', providerId) ? { subscriptionId: invoice.subscriptionId } : {}),
    lines: Object.freeze(lines),
  })
}

export function normalizePaymentSubscriptionChange(providerId, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      !NONEMPTY(result.subscriptionId) || !NONEMPTY(result.status) ||
      (result.nextAt != null && (!Number.isSafeInteger(result.nextAt) || result.nextAt < 0)) ||
      (result.currentPeriodEnd != null && (!Number.isSafeInteger(result.currentPeriodEnd) || result.currentPeriodEnd < 0))) {
    throw new PaymentProviderError('invalid_provider_subscription', `Payment provider "${providerId}" returned an invalid subscription-change result.`, 502)
  }
  const subscription = normalizePaymentSubscription(providerId, result.subscription)
  if (subscription.subscriptionId !== result.subscriptionId || subscription.status !== result.status) {
    throw new PaymentProviderError('invalid_provider_subscription', `Payment provider "${providerId}" returned mismatched subscription-change details.`, 502)
  }
  return Object.freeze({
    subscriptionId: result.subscriptionId,
    status: result.status,
    ...(result.currentPeriodEnd != null ? { currentPeriodEnd: result.currentPeriodEnd } : {}),
    ...(result.nextAt != null ? { nextAt: result.nextAt } : {}),
    subscription,
  })
}

export function normalizePaymentCheckoutResult(providerId, result) {
  if (!ID.test(providerId || '') || !result || typeof result !== 'object' || Array.isArray(result) ||
      result.provider !== providerId || !NONEMPTY(result.checkoutId) || !NONEMPTY(result.url) ||
      (result.client != null && (providerId !== 'hyperswitch' ||
        result.client.provider !== 'hyperswitch' ||
        !isHttpUrl(result.client.apiBaseUrl) ||
        !isHttpUrl(result.client.clientUrl) ||
        !NONEMPTY(result.client.publishableKey) ||
        !NONEMPTY(result.client.clientSecret) ||
        !isHttpUrl(result.client.successUrl) ||
        !isHttpUrl(result.client.cancelUrl))) ||
      (result.customerId != null && !NONEMPTY(result.customerId)) ||
      (result.expiresAt != null && (!Number.isSafeInteger(result.expiresAt) || result.expiresAt < 0))) {
    throw new PaymentProviderError('invalid_provider_checkout', `Payment provider "${providerId}" returned an invalid checkout result.`, 502)
  }
  return Object.freeze({
    provider: providerId,
    checkoutId: result.checkoutId,
    url: result.url,
    ...(result.client != null ? {
      client: Object.freeze({
        provider: 'hyperswitch',
        apiBaseUrl: result.client.apiBaseUrl,
        clientUrl: result.client.clientUrl,
        publishableKey: result.client.publishableKey,
        clientSecret: result.client.clientSecret,
        successUrl: result.client.successUrl,
        cancelUrl: result.client.cancelUrl,
      }),
    } : {}),
    ...(result.customerId != null ? { customerId: result.customerId } : {}),
    ...(result.expiresAt != null ? { expiresAt: result.expiresAt } : {}),
  })
}

export function normalizePaymentCheckout(providerId, snapshot) {
  if (!ID.test(providerId || '') || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
      snapshot.provider !== providerId || !NONEMPTY(snapshot.checkoutId) ||
      !['open', 'complete', 'expired'].includes(snapshot.status) ||
      !['payment', 'subscription'].includes(snapshot.mode) || !Array.isArray(snapshot.lines)) {
    throw new PaymentProviderError('invalid_provider_checkout', `Payment provider "${providerId}" returned an invalid checkout snapshot.`, 502)
  }
  if (snapshot.paymentStatus != null && !['paid', 'unpaid', 'no_payment_required'].includes(snapshot.paymentStatus)) {
    throw new PaymentProviderError('invalid_provider_checkout', `Payment provider "${providerId}" returned an invalid payment status.`, 502)
  }
  if (snapshot.amountTotalMinor != null &&
      (!Number.isSafeInteger(snapshot.amountTotalMinor) || snapshot.amountTotalMinor < 0)) {
    throw new PaymentProviderError('invalid_provider_checkout', `Payment provider "${providerId}" returned an invalid checkout total.`, 502)
  }
  if (snapshot.currency != null && !/^[a-z]{3}$/i.test(snapshot.currency)) {
    throw new PaymentProviderError('invalid_provider_checkout', `Payment provider "${providerId}" returned an invalid checkout currency.`, 502)
  }
  if (!snapshot.lines.length) {
    throw new PaymentProviderError('invalid_provider_checkout', `Payment provider "${providerId}" returned a checkout with no lines.`, 502)
  }
  if (snapshot.shippingAmountMinor != null &&
      (!Number.isSafeInteger(snapshot.shippingAmountMinor) || snapshot.shippingAmountMinor < 0)) {
    throw new PaymentProviderError('invalid_provider_checkout', `Payment provider "${providerId}" returned an invalid shipping amount.`, 502)
  }
  const lines = snapshot.lines.map((line) => {
    if (!line || typeof line !== 'object' || Array.isArray(line) ||
        !NONEMPTY(line.offerKey) || !NONEMPTY(line.sku) || !NONEMPTY(line.name) ||
        !/^[a-z]{3}$/i.test(line.currency || '') || !['once', 'subscription'].includes(line.billing) ||
        !Number.isSafeInteger(line.unitAmountMinor) || line.unitAmountMinor < 0 ||
        !Number.isSafeInteger(line.quantity) || line.quantity <= 0 ||
        !NONEMPTY(line.providerPriceId)) {
      throw new PaymentProviderError('invalid_provider_checkout', `Payment provider "${providerId}" returned an invalid checkout line.`, 502)
    }
    if (line.interval != null && !['day', 'week', 'month', 'year'].includes(line.interval)) {
      throw new PaymentProviderError('invalid_provider_checkout', `Payment provider "${providerId}" returned an invalid checkout line interval.`, 502)
    }
    if (line.adjustableQuantity != null && (
      !Number.isSafeInteger(line.adjustableQuantity.minimum) ||
      !Number.isSafeInteger(line.adjustableQuantity.maximum) ||
      line.adjustableQuantity.minimum < 1 ||
      line.adjustableQuantity.maximum < line.adjustableQuantity.minimum
    )) {
      throw new PaymentProviderError('invalid_provider_checkout', `Payment provider "${providerId}" returned invalid adjustable quantity bounds.`, 502)
    }
    return Object.freeze({
      offerKey: line.offerKey,
      sku: line.sku,
      name: line.name,
      currency: line.currency.toLowerCase(),
      billing: line.billing,
      unitAmountMinor: line.unitAmountMinor,
      quantity: line.quantity,
      ...(optionalText(line.interval, 'checkout line interval', providerId) ? { interval: line.interval } : {}),
      providerPriceId: line.providerPriceId,
      ...(optionalText(line.providerUsagePriceId, 'checkout line usage price id', providerId)
        ? { providerUsagePriceId: line.providerUsagePriceId }
        : {}),
      ...(optionalText(line.productId, 'checkout line product id', providerId) ? { productId: line.productId } : {}),
      ...(line.adjustableQuantity ? { adjustableQuantity: Object.freeze({ ...line.adjustableQuantity }) } : {}),
      metadata: line.metadata == null ? Object.freeze({}) : normalizedMetadata(line.metadata, 'checkout line'),
    })
  })
  const address = (value, field) => {
    if (value == null) return undefined
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new PaymentProviderError('invalid_provider_checkout', `Payment provider "${providerId}" returned an invalid ${field}.`, 502)
    }
    const normalized = {}
    for (const key of ['name', 'line1', 'line2', 'city', 'state', 'postalCode', 'country']) {
      const text = optionalText(value[key], `${field}.${key}`, providerId)
      if (text != null) normalized[key] = text
    }
    return Object.freeze(normalized)
  }
  let subscription
  if (snapshot.subscription != null) {
    subscription = normalizePaymentSubscription(providerId, snapshot.subscription)
    if (snapshot.subscriptionId && snapshot.subscriptionId !== subscription.subscriptionId) {
      throw new PaymentProviderError('invalid_provider_checkout', `Payment provider "${providerId}" returned mismatched subscription ids.`, 502)
    }
  }
  const subscriptionId = optionalText(snapshot.subscriptionId, 'checkout subscription id', providerId)
  const shippingAddress = address(snapshot.shippingAddress, 'shipping address')
  const billingAddress = address(snapshot.billingAddress, 'billing address')
  return Object.freeze({
    provider: providerId,
    checkoutId: snapshot.checkoutId,
    status: snapshot.status,
    ...(snapshot.paymentStatus != null ? { paymentStatus: snapshot.paymentStatus } : {}),
    mode: snapshot.mode,
    ...(optionalText(snapshot.customerId, 'checkout customer id', providerId) ? { customerId: snapshot.customerId } : {}),
    ...(optionalText(snapshot.paymentId, 'checkout payment id', providerId) ? { paymentId: snapshot.paymentId } : {}),
    ...(subscriptionId ? { subscriptionId } : {}),
    ...(subscription ? { subscription } : {}),
    ...(optionalText(snapshot.userId, 'checkout user id', providerId) ? { userId: snapshot.userId } : {}),
    ...(optionalText(snapshot.customerEmail, 'checkout customer email', providerId) ? { customerEmail: snapshot.customerEmail } : {}),
    ...(optionalText(snapshot.customerName, 'checkout customer name', providerId) ? { customerName: snapshot.customerName } : {}),
    ...(optionalText(snapshot.customerPhone, 'checkout customer phone', providerId) ? { customerPhone: snapshot.customerPhone } : {}),
    ...(snapshot.amountTotalMinor != null ? { amountTotalMinor: snapshot.amountTotalMinor } : {}),
    ...(optionalText(snapshot.currency, 'checkout currency', providerId) ? { currency: snapshot.currency.toLowerCase() } : {}),
    metadata: normalizedMetadata(snapshot.metadata, 'checkout'),
    lines: Object.freeze(lines),
    ...(shippingAddress ? { shippingAddress } : {}),
    ...(billingAddress ? { billingAddress } : {}),
    ...(optionalText(snapshot.shippingOptionId, 'shipping option id', providerId) ? { shippingOptionId: snapshot.shippingOptionId } : {}),
    ...(snapshot.shippingAmountMinor != null ? { shippingAmountMinor: snapshot.shippingAmountMinor } : {}),
    ...(optionalText(snapshot.shippingLevel, 'shipping level', providerId) ? { shippingLevel: snapshot.shippingLevel } : {}),
  })
}

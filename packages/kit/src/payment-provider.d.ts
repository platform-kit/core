export type PaymentCapability =
  | 'checkout.one-time'
  | 'checkout.subscription'
  | 'checkout.confirm'
  | 'checkout.trial'
  | 'checkout.tax'
  | 'checkout.payment-method-selection'
  | 'checkout.adjustable-quantity'
  | 'checkout.shipping-address'
  | 'checkout.shipping-options'
  | 'subscription.change'
  | 'subscription.proration'
  | 'customer.portal'
  | 'customer.create'
  | 'catalog.sync'
  | 'refunds'
  | 'usage.metered'
  | 'usage.prepaid-top-up'
  | 'payouts.connected-accounts'

export type PaymentEventType =
  | 'checkout.completed'
  | 'checkout.expired'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.deleted'
  | 'invoice.paid'
  | 'invoice.payment-failed'
  | 'usage.reported'
  | 'payout.updated'

export interface PaymentProviderEvent {
  provider: string
  eventId: string
  type: PaymentEventType
  occurredAt: number
  customerId?: string
  checkoutId?: string
  paymentId?: string
  subscriptionId?: string
  payoutId?: string
  status?: string
  offerKey?: string
  amountMinor?: number
  currency?: string
  metadata?: Readonly<Record<string, string>>
  subscription?: PaymentSubscriptionSnapshot
  invoice?: PaymentInvoiceSnapshot
}

export interface PaymentInvoiceLine {
  priceId?: string
  offerKey?: string
  metadata?: Readonly<Record<string, string>>
  periodStart?: number
  periodEnd?: number
}

export interface PaymentInvoiceSnapshot {
  provider: string
  invoiceId: string
  billingReason?: string
  subscriptionId?: string
  lines: readonly PaymentInvoiceLine[]
}

export interface PaymentCustomer {
  userId: string
  email?: string
  providerCustomerId?: string
}

export interface PaymentOfferLine {
  offerKey: string
  quantity: number
}

export interface PaymentCheckoutLine extends PaymentOfferLine {
  sku: string
  name: string
  currency: string
  billing: 'once' | 'subscription'
  unitAmountMinor: number
  interval?: 'day' | 'week' | 'month' | 'year'
  providerPriceId?: string
  providerUsagePriceId?: string
  metadata?: Readonly<Record<string, string>>
  adjustableQuantity?: { minimum: number; maximum: number }
}

export interface PaymentShippingOption {
  id: string
  label: string
  amountMinor: number
  currency: string
  metadata?: Readonly<Record<string, string>>
  deliveryEstimate?: { minimumDays: number; maximumDays: number }
}

export interface CreatePaymentCheckout {
  idempotencyKey: string
  customer?: PaymentCustomer
  customerEmail?: string
  mode: 'payment' | 'subscription'
  lines: readonly PaymentCheckoutLine[]
  /** The provider replaces `{CHECKOUT_ID}` in this URL with its checkout identifier. */
  successUrl: string
  cancelUrl: string
  metadata: Readonly<Record<string, string>>
  currency?: string
  allowPromotionCodes?: boolean
  trialDays?: number
  collectTaxId?: boolean
  automaticTax?: boolean
  allowedPaymentMethods?: readonly string[]
  shippingAddress?: 'required' | 'optional'
  shippingCountry?: string
  collectPhone?: boolean
  shippingOptions?: readonly PaymentShippingOption[]
  shippingSubmitMessage?: string
}

export interface PaymentCheckoutRequirements {
  mode: 'payment' | 'subscription'
  trialDays?: number
  automaticTax?: boolean
  collectTaxId?: boolean
  allowedPaymentMethods?: readonly string[]
  lines: readonly { adjustable?: boolean }[]
  shippingAddress?: 'required' | 'optional'
  shippingOptions?: readonly unknown[]
}

export interface PaymentCheckoutResult {
  provider: string
  checkoutId: string
  url: string
  client?: {
    provider: 'hyperswitch'
    apiBaseUrl: string
    clientUrl: string
    publishableKey: string
    clientSecret: string
    successUrl: string
    cancelUrl: string
  }
  customerId?: string
  expiresAt?: number
}

export interface PaymentSubscriptionItem {
  priceId: string
  offerKey?: string
  sku?: string
  unitAmountMinor?: number
  currency?: string
  quantity: number
  metadata: Readonly<Record<string, string>>
}

export interface PaymentSubscriptionSnapshot {
  provider: string
  subscriptionId: string
  customerId?: string
  paymentMethodId?: string
  status: string
  currentPeriodStart?: number
  currentPeriodEnd?: number
  cancelAtPeriodEnd?: boolean
  trialEnd?: number
  scheduleId?: string
  metadata: Readonly<Record<string, string>>
  items: readonly PaymentSubscriptionItem[]
}

export interface PaymentCheckoutSnapshot {
  provider: string
  checkoutId: string
  status: 'open' | 'complete' | 'expired'
  paymentStatus?: 'paid' | 'unpaid' | 'no_payment_required'
  mode: 'payment' | 'subscription'
  customerId?: string
  paymentId?: string
  subscriptionId?: string
  subscription?: PaymentSubscriptionSnapshot
  userId?: string
  customerEmail?: string
  customerName?: string
  customerPhone?: string
  amountTotalMinor?: number
  currency?: string
  metadata: Readonly<Record<string, string>>
  lines: readonly (PaymentCheckoutLine & { productId?: string })[]
  shippingAddress?: {
    name?: string
    line1?: string
    line2?: string
    city?: string
    state?: string
    postalCode?: string
    country?: string
  }
  billingAddress?: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    postalCode?: string
    country?: string
  }
  shippingOptionId?: string
  shippingAmountMinor?: number
  shippingLevel?: string
}

export interface PaymentCatalogUsage {
  meter: string
  unit: string
  rateMicros: number
  includedMicros?: number
  overagePriceMicros: number
  incrementalChargeMinor?: number
  speechCostPerSecondMicros?: number
}

export interface PaymentCatalogOffer {
  offerKey: string
  sku: string
  name: string
  description?: string
  kind: 'one-time' | 'subscription' | 'usage'
  currency: string
  unitAmountMinor: number
  interval?: 'day' | 'week' | 'month' | 'year'
  intervalCount?: number
  currencyOptions?: Readonly<Record<string, number>>
  usage?: PaymentCatalogUsage
  metadata?: Readonly<Record<string, string>>
}

export interface PaymentCatalogResult {
  provider: string
  offers: Readonly<Record<string, {
    productId: string
    priceId: string
    usagePriceId?: string
    made?: boolean
  }>>
}

export interface PaymentUsageReport {
  idempotencyKey: string
  customerId: string
  subscriptionId?: string
  meterId: string
  value: number
  occurredAt: number
}

export interface PaymentProviderAdapter {
  readonly id: string
  readonly capabilities: readonly PaymentCapability[]
  createCustomer?(input: PaymentCustomer): Promise<{ customerId: string }>
  createCheckout?(input: CreatePaymentCheckout): Promise<PaymentCheckoutResult>
  retrieveCheckout?(checkoutId: string): Promise<PaymentCheckoutSnapshot>
  changeSubscription?(input: {
    subscriptionId: string
    offerKey: string
    offer: PaymentCatalogOffer
    currentAmountMinor?: number
    currentPeriodStart?: number
    currentPeriodEnd?: number
    proration: 'none' | 'immediate' | 'next-cycle'
    idempotencyKey: string
    userId?: string
  }): Promise<{
    subscriptionId: string
    status: string
    currentPeriodEnd?: number
    nextAt?: number
    subscription: PaymentSubscriptionSnapshot
  }>
  createPortalSession?(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>
  createPaymentMethodSession?(input: {
    customerId: string
    returnUrl: string
  }): Promise<{ sdkAuthorization: string; profileId: string }>
  syncCatalog?(offers: readonly PaymentCatalogOffer[]): Promise<PaymentCatalogResult>
  refund?(input: { paymentId: string; amountMinor?: number; idempotencyKey: string }): Promise<{ refundId: string; status: string }>
  reportUsage?(input: PaymentUsageReport): Promise<{ reportId: string }>
  getDefaultPaymentMethod?(customerId: string): Promise<{ paymentMethodId: string | null }>
  createPaymentIntent?(input: {
    amountMinor: number
    currency: string
    customerId: string
    paymentMethodId: string
    description: string
    metadata: Readonly<Record<string, string>>
    idempotencyKey: string
  }): Promise<{ paymentIntentId: string; status: string; clientSecret?: string }>
  retrievePaymentIntent?(paymentIntentId: string): Promise<{ paymentIntentId: string; status: string; clientSecret?: string }>
  verifyWebhook(request: Request): Promise<readonly PaymentProviderEvent[]>
  createPayoutAccount?(input: {
    accountId?: string
    userId: string
    email?: string
    kind: 'own' | 'managed'
    returnUrl: string
    refreshUrl: string
  }): Promise<{ accountId: string; onboardingUrl: string; ready: boolean }>
  retrievePayoutAccount?(accountId: string): Promise<{ accountId: string; ready: boolean; detailsSubmitted: boolean }>
  createPayout?(input: {
    accountId: string
    amountMinor: number
    currency: string
    idempotencyKey: string
    metadata: Readonly<Record<string, string>>
  }): Promise<{ payoutId: string; status: string }>
}

export interface PaymentProviderRegistration {
  id: string
  adapter: string
  capabilities: readonly PaymentCapability[]
  secrets: readonly string[]
  webhookPath: '/functions/v1/payment-provider-webhook'
}

export type PaymentProviderFactory = (
  secrets: Readonly<Record<string, string | undefined>>,
) => PaymentProviderAdapter | Promise<PaymentProviderAdapter>

export declare const PAYMENT_CAPABILITIES: readonly PaymentCapability[]
export declare const STRIPE_PAYMENT_CAPABILITIES: readonly PaymentCapability[]
export declare const PAYMENT_PROVIDER_WEBHOOK_PATH: '/functions/v1/payment-provider-webhook'
export declare class PaymentProviderError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status?: number)
}
export declare function providerScopedId(providerId: string, externalId: string): string
export declare function assertPaymentProvider<T extends PaymentProviderAdapter>(adapter: T): T
export declare function assertPaymentCapabilities(adapter: PaymentProviderAdapter, required: readonly PaymentCapability[]): void
export declare function paymentCapabilitiesForCheckout(request: PaymentCheckoutRequirements): readonly PaymentCapability[]
export declare function paymentCapabilitiesForSubscriptionChange(request: {
  proration: 'none' | 'immediate' | 'next-cycle'
}): readonly PaymentCapability[]
export declare function normalizePaymentEvent(providerId: string, event: PaymentProviderEvent): Readonly<PaymentProviderEvent>
export declare function normalizePaymentCheckoutResult(providerId: string, result: PaymentCheckoutResult): Readonly<PaymentCheckoutResult>
export declare function normalizePaymentCheckout(providerId: string, snapshot: PaymentCheckoutSnapshot): Readonly<PaymentCheckoutSnapshot>
export declare function normalizePaymentSubscriptionChange(providerId: string, result: {
  subscriptionId: string
  status: string
  currentPeriodEnd?: number
  nextAt?: number
  subscription: PaymentSubscriptionSnapshot
}): Readonly<{
  subscriptionId: string
  status: string
  currentPeriodEnd?: number
  nextAt?: number
  subscription: PaymentSubscriptionSnapshot
}>

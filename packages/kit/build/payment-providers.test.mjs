import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  assertPaymentCapabilities,
  assertPaymentProvider,
  normalizePaymentCheckout,
  normalizePaymentCheckoutResult,
  normalizePaymentEvent,
  normalizePaymentSubscriptionChange,
  PaymentProviderError,
  paymentCapabilitiesForCheckout,
  paymentCapabilitiesForSubscriptionChange,
  providerScopedId,
  PAYMENT_PROVIDER_WEBHOOK_PATH,
  STRIPE_PAYMENT_CAPABILITIES,
} from '../src/payment-provider.mjs'
import { readManifest, readManifests } from './modules/manifest.mjs'
import {
  HYPERSWITCH_PAYMENT_PROVIDER_REGISTRATION,
  paymentProviderConfigurationOf,
  paymentProviderIdOf,
  paymentProviderRegistrySource,
  paymentProviderPublicSettingsOf,
  STRIPE_PAYMENT_PROVIDER_REGISTRATION,
} from './payment-provider-registry.mjs'

const BUILD_ROOT = path.dirname(fileURLToPath(import.meta.url))
const SITE_FIXTURE_ROOT = path.join(BUILD_ROOT, 'fixtures', 'site-payment-provider')
const stripe = {
  id: 'stripe',
  capabilities: ['checkout.one-time', 'checkout.subscription', 'usage.metered'],
  createCheckout: async () => ({ provider: 'stripe', checkoutId: 'cs_test', url: 'https://example.test/checkout' }),
  reportUsage: async () => ({ reportId: 'usage_test' }),
  verifyWebhook: async () => [],
}

assert.equal(assertPaymentProvider(stripe), stripe)
assert.ok(STRIPE_PAYMENT_CAPABILITIES.includes('checkout.confirm'))
assert.ok(STRIPE_PAYMENT_CAPABILITIES.includes('catalog.sync'))
assert.ok(STRIPE_PAYMENT_CAPABILITIES.includes('refunds'))
assert.ok(STRIPE_PAYMENT_CAPABILITIES.includes('usage.metered'))
assert.ok(STRIPE_PAYMENT_CAPABILITIES.includes('usage.prepaid-top-up'))
assert.ok(STRIPE_PAYMENT_CAPABILITIES.includes('payouts.connected-accounts'))
assertPaymentCapabilities(stripe, ['checkout.one-time', 'usage.metered'])
assert.throws(
  () => assertPaymentCapabilities(stripe, ['payouts.connected-accounts']),
  (error) => error instanceof PaymentProviderError &&
    error.code === 'unsupported_capability' && error.status === 422 &&
    /payouts\.connected-accounts/.test(error.message),
)
assert.throws(
  () => assertPaymentProvider({ ...stripe, capabilities: ['checkout.one-time', 'checkout.one-time'] }),
  (error) => error.code === 'invalid_provider',
)
assert.throws(
  () => assertPaymentProvider({ ...stripe, capabilities: ['stripe.internal-operation'] }),
  (error) => error.code === 'invalid_provider',
)
assert.throws(
  () => assertPaymentProvider({ id: 'incomplete', capabilities: ['refunds'], verifyWebhook: async () => [] }),
  (error) => error.code === 'invalid_provider' && /refund/.test(error.message),
)
assert.throws(
  () => assertPaymentProvider({
    id: 'incomplete-payouts',
    capabilities: ['payouts.connected-accounts'],
    verifyWebhook: async () => [],
    createPayoutAccount: async () => ({ accountId: 'acct_1', onboardingUrl: 'https://example.test', ready: false }),
    createPayout: async () => ({ payoutId: 'po_1', status: 'created' }),
  }),
  (error) => error.code === 'invalid_provider' && /retrievePayoutAccount/.test(error.message),
)
assert.equal(providerScopedId('stripe', 'cs_same'), 'cs_same')
assert.equal(providerScopedId('site-mock', 'cs_same'), 'site-mock:cs_same')
assert.throws(() => providerScopedId('Site Mock', 'cs_same'), (error) => error.code === 'invalid_provider')
assert.throws(() => providerScopedId('site-mock', ''), (error) => error.code === 'invalid_provider_reference')
const checkoutRequirements = paymentCapabilitiesForCheckout({
  mode: 'subscription',
  trialDays: 14,
  automaticTax: true,
  collectTaxId: true,
  allowedPaymentMethods: ['card'],
  lines: [{ adjustable: true }],
  shippingAddress: 'required',
  shippingOptions: [{ id: 'standard' }],
})
assert.deepEqual(checkoutRequirements, [
  'checkout.subscription',
  'checkout.trial',
  'checkout.tax',
  'checkout.payment-method-selection',
  'checkout.adjustable-quantity',
  'checkout.shipping-address',
  'checkout.shipping-options',
])
assert.deepEqual(paymentCapabilitiesForSubscriptionChange({ proration: 'immediate' }), [
  'subscription.change',
  'subscription.proration',
])
assert.deepEqual(paymentCapabilitiesForSubscriptionChange({ proration: 'next-cycle' }), [
  'subscription.change',
])
assert.throws(
  () => paymentCapabilitiesForSubscriptionChange({ proration: 'unsupported' }),
  (error) => error instanceof PaymentProviderError && error.code === 'invalid_subscription_change',
)
let providerSideEffects = 0
assert.throws(
  () => {
    const unsupported = {
      id: 'limited',
      capabilities: ['checkout.subscription'],
      createCheckout: async () => { providerSideEffects++; return {} },
      verifyWebhook: async () => [],
    }
    assertPaymentCapabilities(unsupported, checkoutRequirements)
    return unsupported.createCheckout({})
  },
  (error) => error.code === 'unsupported_capability',
)
assert.equal(providerSideEffects, 0)
assert.throws(
  () => {
    const unsupported = {
      id: 'limited',
      capabilities: ['subscription.change'],
      changeSubscription: async () => { providerSideEffects++; return { subscriptionId: 'sub_test', status: 'active' } },
      verifyWebhook: async () => [],
    }
    assertPaymentCapabilities(
      unsupported,
      paymentCapabilitiesForSubscriptionChange({ proration: 'immediate' }),
    )
    return unsupported.changeSubscription({})
  },
  (error) => error.code === 'unsupported_capability',
)
assert.equal(providerSideEffects, 0)

const event = normalizePaymentEvent('stripe', {
  provider: 'stripe',
  eventId: 'evt_1',
  type: 'payment.succeeded',
  occurredAt: 1_760_000_000,
  customerId: 'cus_1',
  amountMinor: 1250,
  currency: 'USD',
  metadata: { offerKey: 'abcd1234' },
})
assert.equal(event.currency, 'usd')
assert.equal(event.provider, 'stripe')
assert.equal(event.amountMinor, 1250)
assert.ok(Object.isFrozen(event))
assert.ok(Object.isFrozen(event.metadata))
assert.throws(
  () => normalizePaymentEvent('chargebee', { ...event, provider: 'stripe' }),
  (error) => error.code === 'invalid_provider_event',
)
assert.throws(
  () => normalizePaymentEvent('stripe', { ...event, amountMinor: -1 }),
  (error) => error.code === 'invalid_provider_event',
)

const subscriptionSnapshot = {
  provider: 'site-mock',
  subscriptionId: 'subscription_1',
  customerId: 'customer_1',
  status: 'active',
  currentPeriodStart: 1_760_000_000,
  currentPeriodEnd: 1_762_592_000,
  cancelAtPeriodEnd: false,
  metadata: { user_id: 'user_1' },
  items: [{
    priceId: 'price_1',
    offerKey: 'membership-monthly',
    sku: 'membership',
    unitAmountMinor: 1200,
    currency: 'USD',
    quantity: 1,
    metadata: { key: 'membership-monthly', sku: 'membership' },
  }],
}
const normalizedInvoiceEvent = normalizePaymentEvent('site-mock', {
  provider: 'site-mock',
  eventId: 'event_invoice',
  type: 'invoice.paid',
  occurredAt: 1_760_000_000,
  subscriptionId: 'subscription_1',
  subscription: subscriptionSnapshot,
  invoice: {
    provider: 'site-mock',
    invoiceId: 'invoice_1',
    billingReason: 'subscription_cycle',
    subscriptionId: 'subscription_1',
    lines: [{
      priceId: 'price_usage',
      offerKey: 'usage-plan_usage',
      metadata: { usage: 'metered', usage_offer_key: 'usage-plan' },
      periodStart: 1_760_000_000,
      periodEnd: 1_762_592_000,
    }],
  },
})
assert.equal(normalizedInvoiceEvent.subscription.subscriptionId, 'subscription_1')
assert.equal(normalizedInvoiceEvent.invoice.lines[0].priceId, 'price_usage')
assert.equal(normalizedInvoiceEvent.invoice.lines[0].metadata.usage_offer_key, 'usage-plan')
assert.ok(Object.isFrozen(normalizedInvoiceEvent.invoice.lines[0]))
assert.throws(
  () => normalizePaymentEvent('site-mock', {
    ...normalizedInvoiceEvent,
    invoice: { ...normalizedInvoiceEvent.invoice, lines: [{ periodStart: 10, periodEnd: 1 }] },
  }),
  (error) => error.code === 'invalid_provider_event',
)
const checkoutSnapshot = normalizePaymentCheckout('site-mock', {
  provider: 'site-mock',
  checkoutId: 'checkout_1',
  status: 'complete',
  paymentStatus: 'paid',
  mode: 'payment',
  customerId: 'customer_1',
  paymentId: 'payment_1',
  userId: 'user_1',
  amountTotalMinor: 2500,
  currency: 'USD',
  metadata: { user_id: 'user_1' },
  lines: [{
    offerKey: 'book-hardcover',
    sku: 'book',
    name: 'Book',
    currency: 'USD',
    billing: 'once',
    unitAmountMinor: 2500,
    quantity: 1,
    providerPriceId: 'price_book',
    productId: 'product_book',
    metadata: { key: 'book-hardcover', sku: 'book' },
  }],
  subscription: subscriptionSnapshot,
})
assert.equal(checkoutSnapshot.currency, 'usd')
assert.equal(checkoutSnapshot.lines[0].currency, 'usd')
assert.equal(checkoutSnapshot.subscription.provider, 'site-mock')
assert.ok(Object.isFrozen(checkoutSnapshot))
assert.ok(Object.isFrozen(checkoutSnapshot.lines))
assert.ok(Object.isFrozen(checkoutSnapshot.lines[0].metadata))
assert.throws(
  () => normalizePaymentCheckout('stripe', { ...checkoutSnapshot, provider: 'site-mock' }),
  (error) => error.code === 'invalid_provider_checkout',
)
assert.throws(
  () => normalizePaymentCheckout('site-mock', {
    ...checkoutSnapshot,
    amountTotalMinor: -1,
  }),
  (error) => error.code === 'invalid_provider_checkout',
)
assert.throws(
  () => normalizePaymentCheckout('site-mock', {
    ...checkoutSnapshot,
    lines: [{ ...checkoutSnapshot.lines[0], providerPriceId: '' }],
  }),
  (error) => error.code === 'invalid_provider_checkout',
)
assert.throws(
  () => normalizePaymentCheckoutResult('site-mock', {
    provider: 'stripe', checkoutId: 'checkout_1', url: 'https://example.test/checkout',
  }),
  (error) => error.code === 'invalid_provider_checkout',
)
const hyperswitchClientCheckout = normalizePaymentCheckoutResult('hyperswitch', {
  provider: 'hyperswitch',
  checkoutId: 'pay_123',
  url: 'https://example.test/checkout/hyperswitch?session=pay_123',
  client: {
    provider: 'hyperswitch',
    apiBaseUrl: 'https://sandbox.hyperswitch.io',
    clientUrl: 'https://beta.hyperswitch.io/v1',
    publishableKey: 'pk_test',
    clientSecret: 'pay_123_secret_test',
    successUrl: 'https://example.test/app?checkout=success&session=pay_123',
    cancelUrl: 'https://example.test/cart',
  },
})
assert.equal(hyperswitchClientCheckout.client.clientSecret, 'pay_123_secret_test')
assert.throws(
  () => normalizePaymentCheckoutResult('stripe', {
    provider: 'stripe',
    checkoutId: 'cs_test',
    url: 'https://example.test/checkout',
    client: hyperswitchClientCheckout.client,
  }),
  (error) => error.code === 'invalid_provider_checkout',
)
assert.throws(
  () => normalizePaymentCheckoutResult('hyperswitch', {
    provider: 'hyperswitch',
    checkoutId: 'pay_123',
    url: 'https://example.test/checkout/hyperswitch?session=pay_123',
    client: { ...hyperswitchClientCheckout.client, successUrl: 'javascript:alert(1)' },
  }),
  (error) => error.code === 'invalid_provider_checkout',
)
const changedSubscription = normalizePaymentSubscriptionChange('site-mock', {
  subscriptionId: 'subscription_1',
  status: 'active',
  nextAt: 1_762_592_000,
  subscription: subscriptionSnapshot,
})
assert.equal(changedSubscription.subscription.subscriptionId, 'subscription_1')
assert.equal(changedSubscription.nextAt, 1_762_592_000)
assert.throws(
  () => normalizePaymentSubscriptionChange('site-mock', {
    subscriptionId: 'subscription_2',
    status: 'active',
    subscription: subscriptionSnapshot,
  }),
  (error) => error.code === 'invalid_provider_subscription',
)

const siteModule = (await import('./fixtures/site-payment-provider/module.mjs')).default
const parsed = readManifest(siteModule, 'the site fixture')
assert.deepEqual(parsed.faults, [])
assert.deepEqual(parsed.manifest.paymentProviders, siteModule.paymentProviders)
assert.equal(siteModule.paymentProviders[0].webhookPath, PAYMENT_PROVIDER_WEBHOOK_PATH)
assert.equal(paymentProviderIdOf({}), 'stripe')
const hyperswitchSite = {
  payments: { provider: 'hyperswitch', profileCapabilities: [...STRIPE_PAYMENT_CAPABILITIES] },
}
assert.equal(paymentProviderIdOf(hyperswitchSite), 'hyperswitch')
assert.deepEqual(paymentProviderConfigurationOf(hyperswitchSite), {
  profileCapabilities: STRIPE_PAYMENT_CAPABILITIES,
})
const hyperswitchAdminSite = {
  payments: {
    provider: 'hyperswitch',
    profileCapabilities: ['checkout.one-time'],
    controlCenterUrl: 'https://control.example.test/hyperswitch',
  },
}
assert.deepEqual(paymentProviderPublicSettingsOf(hyperswitchAdminSite), {
  provider: 'hyperswitch',
  profileCapabilities: ['checkout.one-time'],
  controlCenterUrl: 'https://control.example.test/hyperswitch',
})
assert.deepEqual(paymentProviderConfigurationOf(hyperswitchAdminSite), {
  profileCapabilities: ['checkout.one-time'],
})
assert.throws(() => paymentProviderPublicSettingsOf({
  payments: {
    ...hyperswitchAdminSite.payments,
    controlCenterUrl: 'javascript:alert(1)',
  },
}), /controlCenterUrl/)
assert.throws(() => paymentProviderPublicSettingsOf({
  payments: {
    ...hyperswitchAdminSite.payments,
    controlCenterUrl: 'http://payments.example.test',
  },
}), /controlCenterUrl/)
assert.throws(() => paymentProviderPublicSettingsOf({
  payments: {
    ...hyperswitchAdminSite.payments,
    controlCenterUrl: 'https://user:password@control.example.test',
  },
}), /controlCenterUrl/)
assert.throws(() => paymentProviderIdOf({ payments: { provider: 'hyperswitch' } }), /profileCapabilities/)
assert.throws(() => paymentProviderIdOf({
  payments: { provider: 'hyperswitch', profileCapabilities: ['unknown.capability'] },
}), /profileCapabilities/)
assert.throws(() => paymentProviderIdOf({
  payments: { provider: 'hyperswitch', profileCapabilities: ['checkout.one-time', 'checkout.one-time'] },
}), /profileCapabilities/)
assert.throws(() => paymentProviderIdOf({
  payments: { provider: 'hyperswitch', profileCapabilities: [...STRIPE_PAYMENT_CAPABILITIES], other: true },
}), /not a supported setting/)
assert.equal(paymentProviderIdOf({ payments: { provider: 'site-mock' } }), 'site-mock')
assert.throws(() => paymentProviderIdOf({ payments: { provider: 'bad id' } }), /registered lower-case provider id/)
assert.throws(() => paymentProviderIdOf({ payments: { processor: 'site-mock' } }), /not a supported setting/)
const hyperswitchCapabilities = [...STRIPE_PAYMENT_CAPABILITIES]
if (!hyperswitchCapabilities.includes('refunds')) hyperswitchCapabilities.push('refunds')
assert.deepEqual(HYPERSWITCH_PAYMENT_PROVIDER_REGISTRATION.capabilities, hyperswitchCapabilities)
assert.ok(HYPERSWITCH_PAYMENT_PROVIDER_REGISTRATION.capabilities.includes('refunds'),
  'Hyperswitch exposes the implemented refund capability')
assert.ok(HYPERSWITCH_PAYMENT_PROVIDER_REGISTRATION.capabilities.includes('payouts.connected-accounts'),
  'Hyperswitch exposes the implemented saved-recipient payout capability')
assert.throws(
  () => assertPaymentCapabilities({
    id: 'hyperswitch',
    capabilities: [],
    verifyWebhook: async () => [],
  }, ['payouts.connected-accounts']),
  (error) => error instanceof PaymentProviderError && error.code === 'unsupported_capability',
)
assert.equal(HYPERSWITCH_PAYMENT_PROVIDER_REGISTRATION.webhookPath, PAYMENT_PROVIDER_WEBHOOK_PATH)
const hyperswitchRegistry = paymentProviderRegistrySource(
  [STRIPE_PAYMENT_PROVIDER_REGISTRATION, HYPERSWITCH_PAYMENT_PROVIDER_REGISTRATION],
  'hyperswitch',
  { profileCapabilities: [...hyperswitchCapabilities] },
)
assert.match(hyperswitchRegistry, /from '\.\/hyperswitch-payment-provider\.ts'/)
assert.match(hyperswitchRegistry, /id: "hyperswitch"/)
assert.match(hyperswitchRegistry, /HYPERSWITCH_API_KEY/)
assert.match(hyperswitchRegistry, /"profileCapabilities"/)
assert.match(hyperswitchRegistry, /optionalSecrets: \["HYPERSWITCH_CLIENT_URL"\]/)
assert.match(hyperswitchRegistry, /createPaymentProvider1\(providerSecrets, registration\.configuration, runtime\)/)
const typedHyperswitchRegistry = paymentProviderRegistrySource(
  [STRIPE_PAYMENT_PROVIDER_REGISTRATION, HYPERSWITCH_PAYMENT_PROVIDER_REGISTRATION],
  'hyperswitch',
  { profileCapabilities: [...hyperswitchCapabilities] },
  { typescript: true },
)
assert.match(typedHyperswitchRegistry, /import type Stripe from 'npm:stripe@17'/)
assert.match(typedHyperswitchRegistry, /secrets: Readonly<Record<string, string \| undefined>>/)
assert.throws(() => paymentProviderRegistrySource(
  [STRIPE_PAYMENT_PROVIDER_REGISTRATION, HYPERSWITCH_PAYMENT_PROVIDER_REGISTRATION],
  'hyperswitch',
), /profile capabilities/)
assert.throws(() => paymentProviderRegistrySource(
  [STRIPE_PAYMENT_PROVIDER_REGISTRATION, HYPERSWITCH_PAYMENT_PROVIDER_REGISTRATION],
  'hyperswitch',
  { profileCapabilities: ['checkout.one-time'], unexpected: true },
), /does not support/)
assert.throws(() => paymentProviderRegistrySource(
  [STRIPE_PAYMENT_PROVIDER_REGISTRATION, ...parsed.manifest.paymentProviders],
  'unknown',
), /not registered/)
assert.ok(readManifest({
  ...siteModule,
  owns: { ...siteModule.owns, env: [] },
}, 'the site fixture').faults.some((fault) => /must also be declared in owns\.env/.test(fault)))
assert.ok(readManifest({
  ...siteModule,
  paymentProviders: [{ ...siteModule.paymentProviders[0], adapter: '../outside.ts' }],
}, 'the site fixture').faults.some((fault) => /relative JavaScript or TypeScript/.test(fault)))
assert.ok(readManifest({
  ...siteModule,
  paymentProviders: [{ ...siteModule.paymentProviders[0], id: 'stripe' }],
}, 'the site fixture').faults.some((fault) => /reserved for the built-in provider/.test(fault)))
assert.ok(readManifests([
  { manifest: siteModule, where: 'the site' },
  {
    manifest: {
      ...siteModule,
      key: 'other-payments',
      what: 'another payment module',
      owns: { env: ['SITE_MOCK_PAYMENT_SECRET'] },
    },
    where: 'another site module',
  },
]).faults.some((fault) => /payment provider `site-mock` is declared by two modules/.test(fault)))

const registry = paymentProviderRegistrySource(
  [STRIPE_PAYMENT_PROVIDER_REGISTRATION, ...parsed.manifest.paymentProviders],
  paymentProviderIdOf({ payments: { provider: 'site-mock' } }),
)
assert.match(registry, /from '\.\/payment-providers\/mock\.mjs'/)
assert.match(registry, /id: "site-mock"/)
assert.match(registry, /create: createPaymentProvider1/)
assert.match(registry, /SITE_MOCK_PAYMENT_SECRET/)
assert.match(registry, /Object\.fromEntries\(\[\.\.\.registration\.secrets, \.\.\.\(registration\.optionalSecrets \?\? \[\]\)\]\.map/)
assert.match(registry, /assertPaymentProvider\(await createPaymentProvider1\(providerSecrets\)\)/)
assert.equal(
  existsSync(path.join(SITE_FIXTURE_ROOT, 'db/functions/_shared', siteModule.paymentProviders[0].adapter)),
  true,
)
const fixtureAdapter = await import(pathToFileURL(path.join(
  SITE_FIXTURE_ROOT,
  'db/functions/_shared',
  siteModule.paymentProviders[0].adapter,
)).href)
const siteAdapter = await fixtureAdapter.createPaymentProvider({ SITE_MOCK_PAYMENT_SECRET: 'fixture-only' })
assert.equal(assertPaymentProvider(siteAdapter).id, 'site-mock')
assertPaymentCapabilities(siteAdapter, ['checkout.one-time'])
const generatedRoot = await mkdtemp(path.join(tmpdir(), 'payment-provider-registry-'))
try {
  const adapterDirectory = path.join(generatedRoot, 'payment-providers')
  await mkdir(adapterDirectory)
  await copyFile(
    path.join(BUILD_ROOT, '../supabase/functions/_shared/payment-provider.mjs'),
    path.join(generatedRoot, 'payment-provider.mjs'),
  )
  await copyFile(
    path.join(SITE_FIXTURE_ROOT, 'db/functions/_shared', siteModule.paymentProviders[0].adapter),
    path.join(adapterDirectory, 'mock.mjs'),
  )
  const registryPath = path.join(generatedRoot, 'registry.mjs')
  await writeFile(registryPath, registry)
  const generatedRegistry = await import(pathToFileURL(registryPath).href)
  assert.equal(generatedRegistry.SITE_PAYMENT_PROVIDER_ID, 'site-mock')
  const provider = await generatedRegistry.createSitePaymentProvider({
    SITE_MOCK_PAYMENT_SECRET: 'fixture-only',
    UNRELATED_SECRET: 'must-not-be-shared',
  })
  assert.equal(provider.id, 'site-mock')
  assert.deepEqual(provider.capabilities, ['checkout.one-time'])

  const mismatchedPath = path.join(generatedRoot, 'mismatched-registry.mjs')
  await writeFile(mismatchedPath, paymentProviderRegistrySource([
    STRIPE_PAYMENT_PROVIDER_REGISTRATION,
    { ...siteModule.paymentProviders[0], id: 'different-id' },
  ], 'different-id'))
  const mismatchedRegistry = await import(pathToFileURL(mismatchedPath).href)
  await assert.rejects(
    mismatchedRegistry.createSitePaymentProvider({ SITE_MOCK_PAYMENT_SECRET: 'fixture-only' }),
    (error) => error.code === 'provider_registration_mismatch',
  )
} finally {
  await rm(generatedRoot, { recursive: true, force: true })
}
assert.throws(
  () => paymentProviderRegistrySource([
    STRIPE_PAYMENT_PROVIDER_REGISTRATION,
    { ...siteModule.paymentProviders[0], adapter: '../../outside.ts' },
  ]),
  /invalid registration/,
)

console.log('payment provider contract: passed')

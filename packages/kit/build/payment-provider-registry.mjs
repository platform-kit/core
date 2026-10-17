import {
  PAYMENT_CAPABILITIES,
  PAYMENT_PROVIDER_WEBHOOK_PATH,
  STRIPE_PAYMENT_CAPABILITIES,
} from '../src/payment-provider.mjs'

const identifier = (index) => `createPaymentProvider${index}`
const validAdapter = (value) => typeof value === 'string' &&
  !value.includes('\\') &&
  /^[A-Za-z0-9._/-]+\.(?:mjs|js|ts)$/.test(value) &&
  value.split('/').every((part) => part !== '.' && part !== '..')
const HYPERSWITCH_PAYMENT_CAPABILITIES = Object.freeze(
  [...new Set([
    ...STRIPE_PAYMENT_CAPABILITIES,
    'refunds',
  ])],
)

export const STRIPE_PAYMENT_PROVIDER_REGISTRATION = Object.freeze({
  id: 'stripe',
  adapter: 'stripe-payment-provider.ts',
  capabilities: STRIPE_PAYMENT_CAPABILITIES,
  secrets: Object.freeze(['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']),
  webhookPath: PAYMENT_PROVIDER_WEBHOOK_PATH,
})

export const HYPERSWITCH_PAYMENT_PROVIDER_REGISTRATION = Object.freeze({
  id: 'hyperswitch',
  adapter: 'hyperswitch-payment-provider.ts',
  capabilities: HYPERSWITCH_PAYMENT_CAPABILITIES,
  secrets: Object.freeze([
    'HYPERSWITCH_BASE_URL',
    'HYPERSWITCH_API_KEY',
    'HYPERSWITCH_PROFILE_ID',
    'HYPERSWITCH_PUBLISHABLE_KEY',
    'HYPERSWITCH_WEBHOOK_SECRET',
  ]),
  optionalSecrets: Object.freeze(['HYPERSWITCH_CLIENT_URL', 'HYPERSWITCH_PAYMENT_METHODS_PREFIX']),
  webhookPath: PAYMENT_PROVIDER_WEBHOOK_PATH,
})

function paymentSettingsOf(site) {
  const settings = site?.payments
  if (settings == null) return { provider: 'stripe' }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new TypeError('payments must be a group of fields')
  }
  const provider = settings.provider ?? 'stripe'
  if (typeof provider !== 'string' || !/^[a-z][a-z0-9-]*$/.test(provider)) {
    throw new TypeError('payments.provider must be a registered lower-case provider id')
  }
  const allowed = provider === 'hyperswitch'
    ? ['provider', 'profileCapabilities', 'controlCenterUrl']
    : ['provider']
  const unknown = Object.keys(settings).filter((field) => !allowed.includes(field))
  if (unknown.length) throw new TypeError(`payments.${unknown[0]} is not a supported setting`)
  if (provider !== 'hyperswitch') return { provider }

  const profileCapabilities = settings.profileCapabilities
  if (!Array.isArray(profileCapabilities) ||
      profileCapabilities.some((capability) => !PAYMENT_CAPABILITIES.includes(capability)) ||
      new Set(profileCapabilities).size !== profileCapabilities.length) {
    throw new TypeError('payments.profileCapabilities must be a list of unique known payment capabilities for Hyperswitch')
  }
  const controlCenterUrl = settings.controlCenterUrl == null
    ? undefined
    : publicControlCenterUrl(settings.controlCenterUrl)
  return {
    provider,
    profileCapabilities: Object.freeze([...profileCapabilities]),
    ...(controlCenterUrl ? { controlCenterUrl } : {}),
  }
}

function publicControlCenterUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError('payments.controlCenterUrl must be an absolute HTTPS URL (or HTTP loopback URL)')
  }
  let url
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('payments.controlCenterUrl must be an absolute HTTPS URL (or HTTP loopback URL)')
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((!loopback && url.protocol !== 'https:') ||
      (loopback && !['http:', 'https:'].includes(url.protocol)) ||
      url.username || url.password || url.search || url.hash) {
    throw new TypeError('payments.controlCenterUrl must be an absolute HTTPS URL (or HTTP loopback URL) without credentials, query, or fragment')
  }
  return url.toString().replace(/\/+$/, '')
}

export function paymentProviderIdOf(site) {
  return paymentSettingsOf(site).provider
}

export function paymentProviderConfigurationOf(site) {
  const settings = paymentSettingsOf(site)
  return settings.provider === 'hyperswitch'
    ? Object.freeze({ profileCapabilities: settings.profileCapabilities })
    : Object.freeze({})
}

export function paymentProviderPublicSettingsOf(site) {
  const settings = paymentSettingsOf(site)
  return Object.freeze({
    provider: settings.provider,
    ...(settings.profileCapabilities
      ? { profileCapabilities: settings.profileCapabilities }
      : {}),
    ...(settings.controlCenterUrl
      ? { controlCenterUrl: settings.controlCenterUrl }
      : {}),
  })
}

export function paymentProviderRegistrySource(providers, selectedProvider = 'stripe', configuration = {}, options = {}) {
  if (!Array.isArray(providers)) throw new TypeError('payment provider registry must be a list')
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      (options.typescript !== undefined && typeof options.typescript !== 'boolean')) {
    throw new TypeError('payment provider registry output options are invalid')
  }
  const typescript = options.typescript === true
  if (typeof selectedProvider !== 'string' || !/^[a-z][a-z0-9-]*$/.test(selectedProvider)) {
    throw new TypeError('selected payment provider must be a registered lower-case provider id')
  }
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
    throw new TypeError('payment provider configuration must be a group of fields')
  }
  if (selectedProvider === 'hyperswitch') {
    const unknown = Object.keys(configuration).filter((field) => field !== 'profileCapabilities')
    if (unknown.length) throw new TypeError(`Hyperswitch provider configuration does not support "${unknown[0]}"`)
    if (!Array.isArray(configuration.profileCapabilities) ||
        configuration.profileCapabilities.some((capability) => !PAYMENT_CAPABILITIES.includes(capability)) ||
        new Set(configuration.profileCapabilities).size !== configuration.profileCapabilities.length) {
      throw new TypeError('Hyperswitch requires a list of unique known profile capabilities')
    }
  } else if (Object.keys(configuration).length) {
    throw new TypeError(`payment provider "${selectedProvider}" does not accept built-in provider configuration`)
  }
  const ids = new Set()
  for (const provider of providers) {
    const optionalSecrets = provider?.optionalSecrets ?? []
    if (!provider || typeof provider.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(provider.id) ||
        !validAdapter(provider.adapter) || !Array.isArray(provider.capabilities) ||
        provider.capabilities.some((capability) => !PAYMENT_CAPABILITIES.includes(capability)) ||
        new Set(provider.capabilities).size !== provider.capabilities.length ||
        !Array.isArray(provider.secrets) || provider.secrets.some((secret) => typeof secret !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(secret)) ||
        new Set(provider.secrets).size !== provider.secrets.length ||
        !Array.isArray(optionalSecrets) ||
        optionalSecrets.some((secret) => typeof secret !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(secret)) ||
        new Set(optionalSecrets).size !== optionalSecrets.length ||
        optionalSecrets.some((secret) => provider.secrets.includes(secret)) ||
        provider.webhookPath !== PAYMENT_PROVIDER_WEBHOOK_PATH) {
      throw new TypeError('payment provider registry contains an invalid registration')
    }
    if (ids.has(provider.id)) throw new TypeError(`payment provider "${provider.id}" is registered more than once`)
    ids.add(provider.id)
  }
  if (!ids.has('stripe')) throw new TypeError('payment provider registry must include the built-in Stripe adapter')
  if (!ids.has(selectedProvider)) {
    throw new TypeError(`selected payment provider "${selectedProvider}" is not registered`)
  }

  const selectedIndex = providers.findIndex((provider) => provider.id === selectedProvider)
  const selected = providers[selectedIndex]
  const selectedConfiguration = selectedProvider === 'hyperswitch'
    ? { profileCapabilities: [...configuration.profileCapabilities] }
    : {}
  const factoryCall = selected.id === 'stripe'
    ? `${identifier(selectedIndex)}(providerSecrets, runtime?.stripe ? { stripe: runtime.stripe } : undefined)`
    : selected.id === 'hyperswitch'
      ? `${identifier(selectedIndex)}(providerSecrets, registration.configuration, runtime)`
      : `${identifier(selectedIndex)}(providerSecrets)`
  const imports = [
    [
      'import { createPaymentProvider as ',
      identifier(selectedIndex),
      ' } from ',
      `'./${selected.adapter}'`,
    ].join(''),
  ]
  if (typescript) imports.unshift("import type Stripe from 'npm:stripe@17'")
  const entries = [[
    '  {',
    `    id: ${JSON.stringify(selected.id)},`,
    `    capabilities: ${JSON.stringify(selected.capabilities)},`,
    `    secrets: ${JSON.stringify(selected.secrets)},`,
    `    optionalSecrets: ${JSON.stringify(selected.optionalSecrets ?? [])},`,
    `    configuration: ${JSON.stringify(selectedConfiguration)},`,
    `    webhookPath: ${JSON.stringify(selected.webhookPath)},`,
    `    create: ${identifier(selectedIndex)},`,
    '  },',
  ].join('\n')]
  return [
    ...imports,
    [
      'import { assertPaymentProvider, PaymentProviderError }',
      ' from ',
      "'./payment-provider.mjs'",
    ].join(''),
    `export const SITE_PAYMENT_PROVIDER_ID = ${JSON.stringify(selectedProvider)}`,
    'export const SITE_PAYMENT_PROVIDER_FACTORIES = Object.freeze([',
    ...entries,
    '])',
    typescript
      ? 'export async function createSitePaymentProvider(secrets: Readonly<Record<string, string | undefined>>, runtime: { stripe?: Stripe; fetch?: typeof fetch } = {}) {'
      : 'export async function createSitePaymentProvider(secrets, runtime = {}) {',
    '  const registration = SITE_PAYMENT_PROVIDER_FACTORIES.find((item) => item.id === SITE_PAYMENT_PROVIDER_ID)',
    '  if (!registration) {',
    '    throw new PaymentProviderError(',
    "      'provider_not_registered',",
    '      `Payment provider "${SITE_PAYMENT_PROVIDER_ID}" has no assembled factory.`,',
    '      500,',
    '    )',
    '  }',
    '  const providerSecrets = Object.fromEntries([...registration.secrets, ...(registration.optionalSecrets ?? [])].map((name) => [name, secrets[name]]))',
    `  const adapter = assertPaymentProvider(await ${factoryCall})`,
    '  if (adapter.id !== registration.id ||',
    '      registration.capabilities.length !== adapter.capabilities.length ||',
    '      registration.capabilities.some((capability) => !adapter.capabilities.includes(capability))) {',
    '    throw new PaymentProviderError(',
    "      'provider_registration_mismatch',",
    '      `Payment provider "${registration.id}" does not match its registered identity or capabilities.`,',
    '      500,',
    '    )',
    '  }',
    '  return adapter',
    '}',
    '',
  ].join('\n')
}

/* The payment-provider registry (build/payment-provider-registry.mjs): which provider a site selects, what the
   assembly writes into the functions for it, and what the browser is given. Hyperswitch selected is Hyperswitch
   with no fallback; its server credentials are in the server registry and never in the site's public settings;
   a registry that is malformed, repeats a provider, lacks Stripe or names an unregistered provider is refused. */
import assert from 'node:assert/strict'
import {
  STRIPE_PAYMENT_PROVIDER_REGISTRATION as STRIPE,
  HYPERSWITCH_PAYMENT_PROVIDER_REGISTRATION as HYPERSWITCH,
  paymentProviderIdOf, paymentProviderConfigurationOf, paymentProviderPublicSettingsOf, paymentProviderRegistrySource,
} from './payment-provider-registry.mjs'
import { publicSite } from './site.mjs'

let pass = 0, fail = 0
const ok = (msg, fn) => { try { fn(); pass++ } catch (e) { fail++; console.log('  FAIL  ' + msg + ' — ' + (e && e.message ? e.message : e)) } }

const CAPS = ['checkout.one-time', 'customer.create']
const hsSite = { name: 'Probe', payments: { provider: 'hyperswitch', profileCapabilities: CAPS, controlCenterUrl: 'https://control.example.test' } }

ok('a site with no payments setting is Stripe', () => assert.equal(paymentProviderIdOf({}), 'stripe'))
ok('a site that selects Hyperswitch is Hyperswitch', () => assert.equal(paymentProviderIdOf(hsSite), 'hyperswitch'))
ok('…with the profile\'s capabilities as its configuration', () => assert.deepEqual([...paymentProviderConfigurationOf(hsSite).profileCapabilities], CAPS))

ok('the assembled registry serves the selected adapter, and only it — no fallback to Stripe', () => {
  const src = paymentProviderRegistrySource([STRIPE, HYPERSWITCH], 'hyperswitch', { profileCapabilities: CAPS })
  assert.match(src, /from '\.\/hyperswitch-payment-provider\.ts'/)
  assert.doesNotMatch(src, /stripe-payment-provider\.ts/)
  assert.match(src, /"id":?\s*"?hyperswitch|id: "hyperswitch"/)
})
ok('…and names the server credentials it needs, for the deploy to ask for', () => {
  const src = paymentProviderRegistrySource([STRIPE, HYPERSWITCH], 'hyperswitch', { profileCapabilities: CAPS })
  for (const k of HYPERSWITCH.secrets) assert.ok(src.includes(k), k)
})

/* the browser's view of the site: what publicSite hands the bundle */
ok('the site\'s public settings carry the provider and its public capabilities, and no credential', () => {
  const pub = paymentProviderPublicSettingsOf(hsSite)
  assert.equal(pub.provider, 'hyperswitch')
  const text = JSON.stringify(pub)
  for (const k of [...HYPERSWITCH.secrets, ...(HYPERSWITCH.optionalSecrets || [])]) assert.ok(!text.includes(k), k)
})
ok('…and so does everything the bundle is given about the site', () => {
  const pub = JSON.stringify(publicSite({ ...hsSite, looks: {}, modules: {} }))
  for (const k of [...HYPERSWITCH.secrets, ...STRIPE.secrets]) assert.ok(!pub.includes(k), k)
})

const refuses = (msg, providers, selected = 'stripe', configuration = {}, pattern) => ok(msg, () => assert.throws(() => paymentProviderRegistrySource(providers, selected, configuration), pattern))
refuses('a registry that names a provider not registered is refused, naming it', [STRIPE], 'hyperswitch', { profileCapabilities: CAPS }, /hyperswitch/)
refuses('a provider registered twice is refused', [STRIPE, { ...STRIPE }], 'stripe', {}, /more than once/)
refuses('a registry without the built-in Stripe adapter is refused', [HYPERSWITCH], 'hyperswitch', { profileCapabilities: CAPS }, /Stripe/)
refuses('a registration declaring an unknown capability is refused', [STRIPE, { ...HYPERSWITCH, id: 'odd', capabilities: ['money.printing'] }], 'stripe', {}, /invalid registration/)
refuses('a registration on another webhook route is refused', [STRIPE, { ...HYPERSWITCH, id: 'odd', webhookPath: '/elsewhere' }], 'stripe', {}, /invalid registration/)
refuses('Hyperswitch without its profile capabilities is refused', [STRIPE, HYPERSWITCH], 'hyperswitch', {}, /profile capabilities/)
ok('a setting no provider accepts is refused', () => assert.throws(() => paymentProviderIdOf({ payments: { provider: 'stripe', secret: 'x' } }), /not a supported setting/))

console.log(fail ? `payment-provider-registry: ${fail} failed, ${pass} passed` : `payment-provider-registry: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)

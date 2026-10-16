/*
 * What a production deploy must have set, decided by what the content switches on — and checked
 * before a single command runs (build/deploy.mjs calls `checkDeploy` first; a failing report ends
 * the deploy there, so nothing is linked, pushed, built or deployed).
 *
 * The rule: every feature that is ON in the content has everything it needs in the environment,
 * or the deploy is refused with all of it named at once. A feature that is off asks for nothing.
 *
 *   always                       Supabase (the project, its keys), the site's https origin, the mail
 *                                relay (sign-up confirmations, resets, the chats' away emails, the
 *                                orders), the staff's web push (the admin's Notifications page)
 *   anything for sale            a published offer with a price, a printed book, a pricing-page row
 *                                with a sku → Stripe's LIVE secret key and the webhook's signing secret
 *   books in print               → Stripe, and a printer for every printed format: the one the block
 *                                names (its keys), `auto` (at least one printer with keys), premium
 *                                (Bookvault unless named)
 *   coaching sessions            a published session → cal.com's webhook secret and API key (and a note on the recordings bucket's size)
 *   a mock switched on           → refused: the mock sells or prints nothing
 *
 * Optional, noted, never refused: SUPPORT_EMAIL (unset, every staff address is written to), the
 * functions on the site's own domain (PUBLIC_FUNCTIONS_URL, needs the host rewrite first).
 *
 *   node build/deploy-checks.mjs --env .env.production   the report for an env file, exit 1 if refused
 *   node build/deploy-checks.mjs --test                   the rules, pinned (npm test runs this)
 */
import { MESH_MAX } from '../supabase/functions/_shared/video/mesh.js'
import { FEATURES } from './modes.mjs'
import { MODULES } from './modules/kit.mjs'
import { readManifests } from './modules/manifest.mjs'

/* the kit's own, resolved once. A site's own modules are passed in (see the change's task 4.1);
   the default is the kit's rather than an empty set, because an empty set would silently mean
   "nothing asks for anything" and every variable would stop being asked for. */
const KIT_MANIFESTS = readManifests(MODULES.map((m) => ({ manifest: m, where: 'the kit' }))).modules
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import matter from 'gray-matter'
import { spanMinutes as delayMinutes } from '../src/lib/payouts.js'
import { printSpec, PRINTED } from '../src/lib/print-offers.js'
import { inferenceOf } from './inference-config.mjs'
import { usageOf } from './site.mjs'
import {
  HYPERSWITCH_PAYMENT_PROVIDER_REGISTRATION,
  paymentProviderConfigurationOf,
  paymentProviderIdOf,
  STRIPE_PAYMENT_PROVIDER_REGISTRATION,
} from './payment-provider-registry.mjs'

const has = (env, k) => !!String(env[k] ?? '').trim()
const toolOnPath = (t) => { try { execSync('command -v ' + t, { stdio: 'ignore', shell: true }); return true } catch { return false } }
const packageHere = (p, root) => { const from = path.resolve(root || process.cwd(), 'package.json'); try { createRequire(from).resolve(p + '/package.json'); return true } catch { try { createRequire(from).resolve(p); return true } catch { return false } } }
const on = (v) => /^(1|true|yes|on)$/i.test(String(v || ''))
const off = (v) => /^(0|false|no|off)$/i.test(String(v || '').trim())

export const PRINTER_KEYS = { lulu: ['LULU_CLIENT_KEY', 'LULU_CLIENT_SECRET'], mixam: ['MIXAM_USER', 'MIXAM_PASS'], bookvault: ['BOOKVAULT_API_KEY'] }
const configured = (env, p) => (PRINTER_KEYS[p] || []).every((k) => has(env, k))
export function conditionalPaymentSecrets(providerId, siteSurface) {
  return providerId === 'stripe' &&
    siteSurface.offers.some((offer) => Number(offer.usage?.incrementalCharge) > 0)
    ? ['STRIPE_PUBLISHABLE_KEY']
    : []
}

/* what the content switches on, read from the files (never the compiled output, which a deploy has not made yet) */
export function surfaces(root = '.') {
  const md = (dir) => existsSync(`${root}/${dir}`) ? readdirSync(`${root}/${dir}`).filter((n) => n.endsWith('.md')).map((n) => ({ file: n.slice(0, -3), ...matter(readFileSync(`${root}/${dir}/${n}`, 'utf8')).data })) : []
  const live = (d) => d.published !== false
  const offers = md('content/store/products').filter((d) => live(d) && d.sku &&
    (Number(d.price) > 0 || (d.billing === 'subscription' && d.usage?.meter)))
  const printed = []
  for (const b of md('content/books')) {
    if (!live(b) || !b.print || !String(b.print.rights || '').trim()) continue
    const spec = printSpec(b.print)
    if (!spec) continue
    const printers = {}
    for (const f of PRINTED) if (spec.formats[f]) printers[f] = spec.printers[f] || (f === 'premium' ? 'bookvault' : 'auto')
    if (Object.keys(printers).length) printed.push({ slug: b.file, printers })
  }
  /* every published booking type, and which of them cal.com schedules (the file says, else a cal.com url says) */
  const sessions = md('content/sessions').filter(live).map((d) => ({ file: d.file, cal: d.scheduler === 'cal' || (!d.scheduler && !!d.url), room: !(d.scheduler === 'cal' || (!d.scheduler && !!d.url)) && d.where === 'video', record: !!d.record, seats: Number(d.seats || 0) }))
  const pricingSkus = []
  for (const p of md('content/pages')) if (live(p)) for (const s of p.sections || []) for (const r of (s.props && s.props.rows) || s.rows || []) if (r && r.sku) pricingSkus.push(r.sku)
  const funnels = md('content/funnels').filter(live).map((d) => d.file)
  /* the analytics sources the config registers (a PostHog SDK's keys), read from what the build wrote for the door */
  let sources = []
  try { sources = (JSON.parse(readFileSync(path.join(root, 'supabase/functions/_shared/analytics.json'), 'utf8')).sources || []).map((x) => x.name) } catch { /* not built yet */ }
  /* THE PROVIDER POLICY. A site that lets other people sell their time has legal and financial
     questions to answer before it deploys, and every one of them is in one file. */
  let providers = null
  try {
    const d = matter(readFileSync(`${root}/content/providers.md`, 'utf8')).data || {}
    providers = { offerings: d.offerings, connect: d.connect, terms: String(d.terms || '').trim(), delay: d['payout-delay'] }
  } catch { /* no policy file: providers are off */ }
  return { root, offers: offers.map((o) => ({
    sku: o.sku,
    key: o.key,
    kind: o.kind,
    billing: o.billing || 'once',
    trial: Number(o.trial) > 0,
    paymentMethods: Array.isArray(o.payments) ? o.payments : [],
    ...(o.usage ? {
      usage: {
        unit: o.usage.unit,
        meter: o.usage.meter,
        overagePrice: o.usage.overagePrice,
        ...(o.usage.incrementalCharge == null ? {} : { incrementalCharge: o.usage.incrementalCharge }),
      },
    } : {}),
    ...(o.tax && (o.tax.automatic || o.tax.registration) ? { tax: true } : {}),
  })), printed, sessions, pricingSkus, funnels, sources, providers }
}

/*
 * WHICH MODULES CAN ASK FOR WHAT — read from the manifests, not listed here.
 *
 * This was seven lists of module names kept in this file: the modules that send mail, the ones that
 * sell, the one that pushes. Each was a module named outside its own manifest, which is the fault
 * the manifests exist to end.
 *
 * WHAT DOES NOT MOVE is the CONDITION. A manifest is a fact about a module, and almost none of
 * these are wanted merely because a module is on:
 *
 *   Stripe's keys       only where the content actually has something for sale — a published priced
 *                       offer, a book in print, a pricing row. The store on with nothing for sale
 *                       asks for nothing.
 *   LiveKit's           only where a session type RECORDS or seats more than five. Otherwise the
 *                       call is made browser to browser and demanding an account would be wrong.
 *   a printer's         only the printers the books' own print blocks name.
 *
 * "A published priced offer exists" is a fact about the site's CONTENT. Putting it in a manifest
 * would mean growing the manifest a condition language over content, and the whole worth of this
 * check is that it asks for nothing a site does not actually use. So the manifests say what a
 * module CAN ask for, and the judgement of when each is really owed stays here.
 */
const asksFor = (manifests, key) => {
  const out = new Set()
  for (const m of (manifests || KIT_MANIFESTS).values()) for (const v of m.owns.env || []) if (v === key) out.add(m.key)
  return [...out]
}
/* a live module that can ask for this variable, or none */
const anyAsking = (manifests, modules, key) => asksFor(manifests, key).some((k) => modules[k] !== false)
/* every variable any module can ask for, live or not — what the coverage check below is asked about */
export const declaredEnv = (manifests = KIT_MANIFESTS) => [...new Set([...manifests.values()].flatMap((m) => m.owns.env || []))]

/*
 * THE DEPLOYMENT'S OWN, which belong to no module: there is no module called "having a database".
 * Held here on purpose and named as such, so the check below can tell a variable nobody declared
 * from one that is deliberately not a module's.
 */
export const DEPLOYMENT_ENV = [
  'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL', 'PLATFORMKIT_SHADOW_DB_URL', 'VITE_APP_URL',
  'HYPERSWITCH_BASE_URL',
]

/* the report: what is missing, what is set but wrong, and what is worth a note */
/*
 * WHAT A LIVE MODULE NEEDS THAT IS OFF, from the manifests. Handed in rather than imported, so
 * checkDeploy stays synchronous and testable with a made-up set — and so a caller with its own
 * modules (a site registering one) passes its own.
 */
export async function unmetFor(site, modules) {
  const { moduleSet } = await import('./steps.mjs')
  const { unmetRequirements } = await import('./modules/manifest.mjs')
  return unmetRequirements(await moduleSet(site), modules)
}

export function checkDeploy(env, s, modules = {}, stepNeeds = [], shape = null, unmet = [], manifests = KIT_MANIFESTS, site = null) {
  const missing = [], wrong = [], notes = []
  /* every build step that is on for this deploy asks for its needs (build/steps.mjs needsOf): a variable, a tool on the path, a package the site installed */
  for (const n of stepNeeds) {
    for (const k of n.env) if (!has(env, k)) missing.push({ key: k, why: `${n.step.title} (a build step) reads it` })
    for (const t of n.tools || []) if (!toolOnPath(t)) wrong.push(`${t} is not on the path — ${n.step.title} (a build step) runs it`)
    for (const p of n.packages || []) if (!packageHere(p, s.root)) wrong.push(`${p} is not installed — ${n.step.title} (a build step) imports it; npm install ${p} in the site`)
  }
  const mod = (m) => modules[m] !== false   /* a module off in platformkit.config.js asks for nothing of its own */
  const need = (k, why) => { if (!has(env, k)) missing.push({ key: k, why }) }

  /* A site's provider declarations are its server-side billing authority. Validate them again at
     deploy time and require secrets only for providers the bounded fallback policy can reach. */
  let inference = null
  let usage = null
  try {
    inference = inferenceOf(site || {})
    usage = usageOf(site || {})
  } catch (error) {
    wrong.push(`inference or usage configuration is invalid: ${String(error?.message || error)}`)
  }
  if (inference) {
    const attempts = inference.fallback.enabled ? inference.fallback.maxAttempts : 1
    for (const provider of inference.providers.slice(0, attempts)) {
      need(provider.secretEnv, `inference provider "${provider.id}" is reachable in the configured fallback chain`)
    }
    for (const [operationId, policy] of Object.entries(usage?.operations || {})) {
      if (policy.mode === 'offer' && !s.offers.some((offer) => offer.key === policy.offerKey && offer.usage)) {
        wrong.push(`usage operation "${operationId}" names no published usage offer with key ${policy.offerKey}`)
      }
    }
  } else if (Object.values(usage?.operations || {}).some((policy) => policy.mode === 'offer')) {
    wrong.push('reader-billed inference operations require a site inference provider and tariff declaration')
  }

  /*
   * IS THERE A BACKEND, AND DOES ANYTHING NEED ONE?
   *
   * "A feature that is off asks for nothing" was true of every rule below and not of the block that
   * came first, which asked for a Supabase project, a shadow database, a mail relay and a VAPID pair
   * whatever the site was. A site with every module off — a documentation site, a brochure — was
   * asked for thirteen variables for features it does not have, and so could not be deployed at all.
   *
   * The shape is the site's own declaration (site.deployment, build/site.mjs deploymentShape), never
   * an inference from an absent key: a missing variable means "somebody forgot", and that must stay
   * distinguishable from "this site has no backend". A caller that passes no shape gets a backend,
   * which is what every site was before this.
   */
  const backend = !shape || shape.backend !== false
  if (site?.admin?.models && backend && shape && shape.content !== 'rows') {
    wrong.push('the site registers admin models, but the deployment uses file-backed content; set deployment.content to rows or CONTENT_STORE=cloud so the production CMS is included')
  }
  /* what is switched on that cannot work without one, in the words the refusal uses */
  const needsBackend = Object.entries(FEATURES)
    .filter(([name, f]) => f.static === false && mod(name))
    .map(([name, f]) => ({ name, needs: f.needs || 'it needs a backend' }))

  if (!backend) {
    /*
     * A STATIC SITE IS REFUSED BY WHAT IT HAS ON, NOT BY WHAT IS UNSET. "SUPABASE_URL is missing" is
     * an answer to a question nobody asked; "the store is on and there is nowhere to keep an order"
     * is the actual problem, and it names the thing to change.
     */
    for (const f of needsBackend) missing.push({ key: f.name, why: `${f.name} is on and ${f.needs} — this site declares no backend (deployment.backend: false), so either switch it off or give the site one` })
    /* a key set beside a declaration of no backend is a mistake, not an override: the declaration is
       the truth, and quietly deploying the other shape is how a site becomes something nobody chose */
    for (const k of ['VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL']) {
      if (has(env, k)) wrong.push(`${k} is set while the site declares no backend (deployment.backend: false) — the declaration is what is deployed, so remove the key or the declaration`)
    }
  } else {
    need('VITE_SUPABASE_ANON_KEY', "the client's key to the production project (Project settings → API)")
    need('SUPABASE_SERVICE_ROLE_KEY', 'the service-role key — provider catalog synchronization and server functions use it')
    need('SUPABASE_DB_URL', "the production database's connection (Project settings → Database → the session pooler url) — the plan that brings it to the declaration runs over it")
    need('PLATFORMKIT_SHADOW_DB_URL', "the shadow database's connection — a Postgres kept for nothing else, reset to the declaration on every deploy and diffed against production: a Supabase project (its session-pooler url; its user is postgres, which the diff needs) or a plain Postgres whose user is postgres; the deploy box has no Docker for a shadow of its own")
    /* the relay is asked for by whatever sends: the account confirmations and resets are the floor,
       so any site with accounts needs it, and a site with none needs nothing of it */
    if (anyAsking(manifests, modules, 'SMTP_HOST')) for (const [k, why] of [['SMTP_HOST', 'the mail relay (smtp.mailgun.org) — sign-up confirmations, resets, the chats\' away emails, the orders'], ['SMTP_PORT', "the relay's port (587)"], ['SMTP_USER', "the relay's login"], ['SMTP_PASS', "the relay's password"], ['SMTP_FROM', 'the sender, "Name <address>" on a domain the relay is verified for']]) need(k, why)
    /* THE NETWORK: every member's handle is a name under one domain the site answers for, so that
       domain is the one thing it cannot run without; a site that FEDERATES also signs a portable
       identity for each member who joins, and the key that controls those identities is a secret
       only the deploy holds. A closed network writes nothing outside the site and asks for no key. */
    if (mod('network')) {
      need('NETWORK_HANDLE_DOMAIN', "the domain every member's handle sits under (<username>.<this domain>) — a wildcard DNS record and certificate pointing at the site, which answers each name's identity")
      if (s.network && s.network.federate) need('NETWORK_PLC_ROTATION_KEY', "the key that controls the portable identity made for each member who joins the wider network (network.federate is on) — node ../../packages/kit/build/network-keys.mjs prints one; keep it secret and never rotate it away")
    }
    if (anyAsking(manifests, modules, 'VAPID_PRIVATE_KEY')) for (const [k, why] of [['VAPID_PRIVATE_KEY', "web push to the staff — the admin's Notifications page and the desk's alerts (node build/vapid.mjs prints a pair)"], ['VITE_VAPID_PUBLIC_KEY', "the pair's public half, for the browser"], ['VAPID_SUBJECT', 'a mailto: for the push services']]) need(k, why)
  }
  /* the site's own address is not a backend setting: the sitemap and every absolute link need it
     whether or not there is a database behind the page */
  need('VITE_APP_URL', "the site's https origin — the sitemap, absolute links, and (with a backend) auth links, checkout returns and emails")
  /* anything for sale */
  let selectedPaymentProvider = 'stripe'
  let selectedPaymentRegistration = STRIPE_PAYMENT_PROVIDER_REGISTRATION
  let selectedPaymentConfiguration = {}
  const configuredProvider = site?.payments?.provider
  if (typeof configuredProvider === 'string' && /^[a-z][a-z0-9-]*$/.test(configuredProvider)) {
    selectedPaymentProvider = configuredProvider
  }
  try {
    selectedPaymentProvider = paymentProviderIdOf(site)
    selectedPaymentConfiguration = paymentProviderConfigurationOf(site)
  } catch (error) {
    wrong.push(String(error?.message || error))
  }
  const providerModules = manifests || KIT_MANIFESTS
  const registeredProviders = [...providerModules.values()]
    .filter((module) => modules[module.key] !== false)
    .flatMap((module) => module.paymentProviders || [])
  if (selectedPaymentProvider !== 'stripe') {
    selectedPaymentRegistration = selectedPaymentProvider === 'hyperswitch'
      ? HYPERSWITCH_PAYMENT_PROVIDER_REGISTRATION
      : registeredProviders.find((provider) => provider.id === selectedPaymentProvider) || null
    if (!selectedPaymentRegistration) {
      wrong.push(`payments.provider "${selectedPaymentProvider}" is not registered by an enabled site module`)
    }
  }
  const selling = [
    ...s.offers.map((o) => `${o.sku} (${o.kind})`),
    ...s.printed.map((b) => `${b.slug} in print`),
    ...s.pricingSkus.filter((k) => !s.offers.some((o) => o.sku === k)).map((k) => `pricing row ${k}`),
  ]
  if (selectedPaymentProvider === 'hyperswitch' && selectedPaymentRegistration) {
    const requiredCapabilities = new Set()
    if (selling.length) {
      if (s.offers.some((offer) => offer.billing !== 'subscription') || s.printed.length || s.pricingSkus.length) {
        requiredCapabilities.add('checkout.one-time')
      }
      if (s.offers.some((offer) => offer.billing === 'subscription')) {
        requiredCapabilities.add('checkout.subscription')
      }
    }
    if (s.offers.some((offer) => offer.trial)) requiredCapabilities.add('checkout.trial')
    if (s.offers.some((offer) => offer.paymentMethods?.length)) {
      requiredCapabilities.add('checkout.payment-method-selection')
    }
    if (s.offers.some((offer) => offer.tax)) requiredCapabilities.add('checkout.tax')
    if (usage?.autoTopUp?.enabled) requiredCapabilities.add('usage.prepaid-top-up')
    if (s.providers?.offerings === 'on') {
      requiredCapabilities.add('payouts.connected-accounts')
      if (selectedPaymentProvider === 'hyperswitch') requiredCapabilities.add('customer.create')
    }
    for (const capability of requiredCapabilities) {
      if (!selectedPaymentConfiguration.profileCapabilities?.includes(capability)) {
        wrong.push(`payments.profileCapabilities does not declare "${capability}" required by enabled commerce features`)
      }
    }
  }
  if (selling.length && selectedPaymentProvider === 'stripe' && anyAsking(manifests, modules, 'STRIPE_SECRET_KEY')) {
    const why = `for sale: ${selling.slice(0, 4).join(', ')}${selling.length > 4 ? ` and ${selling.length - 4} more` : ''}`
    need('STRIPE_SECRET_KEY', `the LIVE secret key (sk_live_…) — checkout, the portal, the offers pushed to Stripe; ${why}`)
    need('STRIPE_WEBHOOK_SECRET', `the signing secret of the Stripe webhook endpoint (whsec_…) — every payment lands through it; ${why}`)
    if (has(env, 'STRIPE_SECRET_KEY') && !/^sk_live_/.test(env.STRIPE_SECRET_KEY)) wrong.push('STRIPE_SECRET_KEY is not a live key (sk_live_…) — a test key would sell nothing')
    if (has(env, 'STRIPE_WEBHOOK_SECRET') && !/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET)) wrong.push('STRIPE_WEBHOOK_SECRET is not a webhook signing secret (whsec_…)')
    if (s.offers.some((offer) => Number(offer.usage?.incrementalCharge) > 0)) {
      need('STRIPE_PUBLISHABLE_KEY', 'the LIVE publishable key (pk_live_…) — customers may need to authenticate incremental usage charges')
      if (has(env, 'STRIPE_PUBLISHABLE_KEY') && !/^pk_live_/.test(env.STRIPE_PUBLISHABLE_KEY)) {
        wrong.push('STRIPE_PUBLISHABLE_KEY is not a live publishable key (pk_live_…)')
      }
    }
  } else if (selling.length && selectedPaymentProvider !== 'stripe' && selectedPaymentRegistration) {
    const why = `for sale: ${selling.slice(0, 4).join(', ')}${selling.length > 4 ? ` and ${selling.length - 4} more` : ''}`
    for (const secret of selectedPaymentRegistration.secrets) {
      need(secret, `payment provider "${selectedPaymentProvider}" requires this server-side secret; ${why}`)
    }
  }
  const meteredOffers = s.offers.filter((offer) => offer.usage?.meter != null)
  if (meteredOffers.length) {
    if (selectedPaymentRegistration && !selectedPaymentRegistration.capabilities.includes('usage.metered')) {
      wrong.push(`payment provider "${selectedPaymentProvider}" does not declare metered usage support`)
    }
    const names = new Map()
    for (const offer of meteredOffers) {
      const meter = String(offer.usage.meter || '')
      if (selectedPaymentProvider === 'stripe' && !/^[a-z][a-z0-9_]{0,99}$/.test(meter)) {
        wrong.push(`${offer.sku} declares metering without a valid Stripe meter event name`)
      } else if (!meter.trim()) {
        wrong.push(`${offer.sku} declares metering without a meter identifier`)
      } else if (names.has(meter)) {
        const kind = selectedPaymentProvider === 'stripe' ? 'Stripe meter event name' : 'meter identifier'
        wrong.push(`${offer.sku} and ${names.get(meter)} share ${kind} ${meter}`)
      } else {
        names.set(meter, offer.sku)
      }
      if (!(Number(offer.usage.overagePrice) > 0)) {
        wrong.push(`${offer.sku} declares metering without a positive overage price`)
      }
      if (usage?.autoTopUp?.enabled && selectedPaymentRegistration &&
          !selectedPaymentRegistration.capabilities.includes('usage.prepaid-top-up')) {
        wrong.push(`payment provider "${selectedPaymentProvider}" does not declare automatic usage top-up support`)
      }
    }
  }
  /* TAX IS A NOTE, NOT A REFUSAL, and the distinction is the point. An offer asking for automatic
     tax needs Stripe Tax switched on and a registration added in the Dashboard — there is no key
     for it, so nothing here can verify it and refusing on a guess would block a deploy over a
     setting we cannot see. Unconfigured, Stripe does not error: it returns zero tax. So the deploy
     SAYS SO, with the offers named, rather than letting a shop find out from an accountant. */
  {
    const taxed = s.offers.filter((o) => o.tax).map((o) => o.sku)
    if (taxed.length && selectedPaymentProvider === 'stripe') {
      notes.push(`${taxed.length} offer${taxed.length === 1 ? '' : 's'} ask${taxed.length === 1 ? 's' : ''} Stripe to work out tax (${taxed.slice(0, 4).join(', ')}${taxed.length > 4 ? ' and more' : ''}) — Stripe Tax must be active with a registration for every place you sell, which only the Dashboard can tell you; unconfigured it returns no tax rather than an error`)
    }
    if (taxed.length && selectedPaymentRegistration &&
        !selectedPaymentRegistration.capabilities.includes('checkout.tax')) {
      wrong.push(`payment provider "${selectedPaymentProvider}" does not declare tax support required by ${taxed.slice(0, 4).join(', ')}`)
    }
  }

  /* books in print: a printer for every printed format */
  if (s.printed.length && mod('print')) {
    const named = new Map()   /* printer → the books that name it */
    let auto = []
    for (const b of s.printed) for (const [f, p] of Object.entries(b.printers)) {
      if (p === 'auto') auto.push(`${b.slug} ${f}`)
      else named.set(p, [...(named.get(p) || []), `${b.slug} ${f}`])
    }
    for (const [p, what] of named) if (!configured(env, p)) for (const k of PRINTER_KEYS[p]) need(k, `${p} prints ${what.join(', ')}`)
    if (auto.length && !Object.keys(PRINTER_KEYS).some((p) => configured(env, p))) {
      missing.push({ key: Object.values(PRINTER_KEYS).map((ks) => ks.join(' + ')).join('  or  '), why: `at least one printer with keys — ${auto.length} printed format${auto.length === 1 ? '' : 's'} are set to the cheapest available (${auto.slice(0, 3).join(', ')}${auto.length > 3 ? ', …' : ''}) and none is` })
    }
  }

  /* coaching sessions */
  const calTypes = s.sessions.filter((x) => x.cal).map((x) => x.file)
  if (calTypes.length && mod('sessions')) {
    need('CAL_WEBHOOK_SECRET', `the secret set on the cal.com webhook — every cal.com booking lands through it; scheduled by cal.com: ${calTypes.join(', ')}`)
    need('CAL_API_KEY', 'a cal.com API key — the open times are read and a booking a membership does not allow is cancelled with it')
  }
  /* A video room needs no account: with no LiveKit the call is made browser to browser. What that
     cannot do is record, and it carries five people. So a room type is refused for want of an account
     only where the site's own content says otherwise — a type that records, or one seating more than
     five — and every other is allowed without a word, because it genuinely works. */
  const roomTypes = s.sessions.filter((x) => x.room)
  const needsAccount = roomTypes.filter((x) => x.record || x.seats > MESH_MAX)
  if (roomTypes.length && mod('sessions')) {
    if (needsAccount.length) {
      need('LIVEKIT_URL', `the LiveKit server (wss://…, LiveKit Cloud or self-hosted) the site's video rooms run on — a room made browser to browser is not recorded and carries ${MESH_MAX}: ${needsAccount.map((x) => x.file).join(', ')}`)
      need('LIVEKIT_API_KEY', 'the LiveKit API key the site mints room tokens with')
      need('LIVEKIT_API_SECRET', 'the LiveKit API secret — the tokens and the webhook\'s signature')
    } else if (env.LIVEKIT_URL || env.LIVEKIT_API_KEY || env.LIVEKIT_API_SECRET) {
      need('LIVEKIT_URL', 'the LiveKit server the site\'s video rooms run on')
      need('LIVEKIT_API_KEY', 'the LiveKit API key the site mints room tokens with')
      need('LIVEKIT_API_SECRET', 'the LiveKit API secret — the tokens and the webhook\'s signature')
    }
    if (roomTypes.some((x) => x.record)) { need('STORAGE_S3_ACCESS_KEY', 'a Supabase Storage S3 access key (Dashboard → Storage → S3 access keys): LiveKit\'s egress lands a recorded room straight in the recordings bucket with it'); need('STORAGE_S3_SECRET_KEY', 'the S3 access key\'s secret') }
    if (!needsAccount.length && !env.LIVEKIT_URL) notes.push(`a video room with no LiveKit account is made browser to browser: not recorded, ${MESH_MAX} people, and two who cannot reach each other directly need a relay (WEBRTC_TURN_URL with WEBRTC_TURN_SECRET — a coturn the site runs, or anything that speaks the standard) or the call says it cannot be made`)
  }
  if (s.sessions.length && mod('sessions')) {
    notes.push('a call\'s recording is pulled into the recordings bucket (2 GB per file): the project\'s own upload limit (Dashboard → Storage → Settings) must allow that, or a long call\'s pull is refused and the row says so')
  }

  /*
   * A LIVE MODULE WHOSE REQUIREMENT IS OFF. One rule for every coupling, read from the manifests
   * — the dependent declares what it needs and why, so this does not have to know that the
   * instrument runs on the forms runner, and a coupling added later is a manifest line rather
   * than another `if` here.
   */
  if (Object.keys(modules).length) {
    for (const u of unmet) wrong.push(`modules.${u.module} is on while modules.${u.needs} is off — ${u.why} (platformkit.config.js: switch ${u.needs} on, or ${u.module} off)`)
  }

  /* the content store: git (the checkout, the default) or cloud (the rows, exported before the build with the service key — already asked for above — and pushed to the repository by the admin function) */
  if (has(env, 'CONTENT_STORE') && !['git', 'cloud'].includes(env.CONTENT_STORE)) wrong.push(`CONTENT_STORE "${env.CONTENT_STORE}" is neither git nor cloud`)
  if (env.CONTENT_STORE === 'cloud') {
    /* which shape this deployment is: a repository in the cycle, deliberately none, or not yet
       decided. Telling the second to attach one is advice for a different deployment. */
    let cloud = {}
    try { cloud = JSON.parse(readFileSync(path.join(s.root || process.cwd(), 'supabase/functions/_shared/cloud.json'), 'utf8')) } catch { /* not assembled */ }
    if (cloud.off) notes.push('CONTENT_STORE is cloud with no repository (cloud.repo is false): the rows are written out as files before the build and are the only copy — set a deploy hook on Content → Publishing so a publish rebuilds the site, and take a copy of the content from there now and then')
    else notes.push('CONTENT_STORE is cloud: the rows of public.content are written out as files before the build, and the admin runs on the admin function — set the repository on Content → Publishing so every edit reaches the repository')
  }

  /* ------------------------------------------------------------------------------------------- */
  /* PROVIDERS: what a site owes before it sells other people's time                              */
  /* ------------------------------------------------------------------------------------------- */
  const P = s.providers
  /* an offering is a bookable thing, so the sessions module is the one switch that turns it off;
     a second flag meaning the same 'off' is one too many */
  if (P && mod('sessions')) {
    const offering = on(P.offerings)
    /* THE ARRANGEMENT THAT IS NOT OFFERED, refused by name. There are two ways to pay somebody:
       the processor onboards them (managed) or they bring an account they already hold (own). The
       third — the site itself collecting, holding the identity checks and filing the reporting —
       makes the operator a payment facilitator, which is a compliance programme rather than a
       setting, and is refused here rather than half-built. */
    const connect = String(P.connect == null ? 'managed' : P.connect).trim()
    if (!['managed', 'own'].includes(connect)) {
      wrong.push(`content/providers.md says connect: ${connect} — the only two arrangements are `
        + 'managed (the payment processor onboards each provider and holds the identity checks) and '
        + 'own (a provider brings an account they already hold). An arrangement where this site '
        + 'collects on their behalf would make you a payment facilitator — identity checks, tax '
        + 'reporting and a compliance programme — and is deliberately not built')
    }
    /* NOTHING IS SOLD UNTIL SOMETHING IS AGREED. A site whose providers may sell with no terms
       version has nothing to point at when one of them asks what the arrangement was. */
    if (offering && !P.terms) wrong.push('content/providers.md lets providers offer their own services with no terms: version — nothing is agreed before anything is sold; write the terms in the body and name the version')
    if (offering) {
      if (!selectedPaymentRegistration?.capabilities.includes('payouts.connected-accounts')) {
        wrong.push(`payment provider "${selectedPaymentProvider}" does not declare connected-account payouts required by provider offerings`)
      }
      if (selectedPaymentProvider === 'stripe') {
        if (!has(env, 'STRIPE_SECRET_KEY')) missing.push({ key: 'STRIPE_SECRET_KEY', why: 'providers may sell their own services, and they are paid through it' })
        notes.push(`providers may offer their own services, paid through ${connect === 'own' ? 'accounts they already hold' : 'accounts the processor onboards'} — Connect must be enabled on the Stripe account, and no card or bank detail is ever kept here`)
      } else if (selectedPaymentRegistration) {
        for (const secret of selectedPaymentRegistration.secrets) {
          need(secret, `payment provider "${selectedPaymentProvider}" requires this server-side secret for provider offerings`)
        }
        notes.push(`providers may offer their own services using the "${selectedPaymentProvider}" connected-account operations; no card or bank detail is ever kept here`)
      }
    }
    const delay = delayMinutes(P.delay)
    if (P.delay != null && delay == null) wrong.push(`content/providers.md says payout-delay: ${P.delay}, which is not a span (30d, 2w, 12h)`)
    else if (offering && delay === 0) notes.push('payout-delay is nothing: a line is payable the moment it is earned, so a refund arrives after the money has gone and becomes an email asking a provider to send some back')
  }
  if (on(env.PAYOUTS_MOCK)) wrong.push('PAYOUTS_MOCK is on — the mock sends nothing and marks lines as paid; for local development only')

  /* a mock on is never a production setting */
  if (selectedPaymentProvider === 'stripe' && on(env.STRIPE_MOCK)) wrong.push('STRIPE_MOCK is on — the mock completes Stripe purchases without contacting Stripe and is for local development only')
  for (const k of ['PRINT_MOCK', 'LULU_MOCK', 'MIXAM_MOCK', 'BOOKVAULT_MOCK']) if (on(env[k])) wrong.push(`${k} is on — the mock prints nothing and is for local development only`)
  if (on(env.NETWORK_FEDERATE)) wrong.push('NETWORK_FEDERATE is on — it makes a site federate whatever its config says, for a local stack\'s tests only; a site federates by `network.federate` in platformkit.config.js')
  if (on(env.LIVEKIT_MOCK)) wrong.push('LIVEKIT_MOCK is on — the mock\'s rooms run on a dev server and its films are fixtures; for local development only')
  if (has(env, 'MIXAM_USER') !== has(env, 'MIXAM_PASS')) wrong.push('MIXAM_USER and MIXAM_PASS go together')

  /* the shape of what is set, where a wrong value would pass as a right one */
  if (has(env, 'VITE_APP_URL') && !/^https:\/\/[^/\s]+$/.test(env.VITE_APP_URL)) wrong.push(`VITE_APP_URL "${env.VITE_APP_URL}" must be the https origin alone, nothing after the host`)
  if (has(env, 'HYPERSWITCH_BASE_URL')) {
    try {
      const base = new URL(env.HYPERSWITCH_BASE_URL)
      if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
        wrong.push('HYPERSWITCH_BASE_URL must be an https URL without credentials, query, or fragment')
      }
    } catch {
      wrong.push('HYPERSWITCH_BASE_URL is not a valid https URL')
    }
  }
  if (has(env, 'HYPERSWITCH_PUBLISHABLE_KEY') &&
      !/^pk_(?:dev|snd|prd)_[^\s]+$/.test(env.HYPERSWITCH_PUBLISHABLE_KEY)) {
    wrong.push('HYPERSWITCH_PUBLISHABLE_KEY must use a Web SDK key issued with the pk_dev_, pk_snd_, or pk_prd_ prefix')
  }
  if (selectedPaymentProvider === 'hyperswitch' && has(env, 'HYPERSWITCH_CLIENT_URL')) {
    try {
      const clientUrl = new URL(env.HYPERSWITCH_CLIENT_URL)
      if (clientUrl.protocol !== 'https:' || clientUrl.username || clientUrl.password ||
          clientUrl.search || clientUrl.hash) {
        wrong.push('HYPERSWITCH_CLIENT_URL must be an https SDK base URL without credentials, query, or fragment')
      }
    } catch {
      wrong.push('HYPERSWITCH_CLIENT_URL is not a valid https SDK base URL')
    }
  }
  if (has(env, 'SMTP_FROM') && !/^[^@\s]+@[^@\s]+$/.test(env.SMTP_FROM.replace(/^.*<([^>]+)>\s*$/, '$1'))) wrong.push(`SMTP_FROM "${env.SMTP_FROM}" is not an address or "Name <address>"`)
  if (has(env, 'SMTP_PORT') && !/^\d+$/.test(env.SMTP_PORT)) wrong.push(`SMTP_PORT "${env.SMTP_PORT}" is not a port`)
  /* a database's identity is its user, host and database — two projects share a pooler host and differ by user (postgres.<ref>) */
  const host = (u) => { try { const x = new URL(u); return x.username + '@' + x.host + x.pathname } catch { return null } }
  for (const k of ['SUPABASE_DB_URL', 'PLATFORMKIT_SHADOW_DB_URL']) {
    if (has(env, k) && !/^postgres(ql)?:\/\/[^\s]+@[^\s/]+\/\w+/.test(env[k])) wrong.push(`${k} is not a Postgres connection url (postgresql://user:password@host:port/database) — the password percent-encoded`)
    /* the direct connection (db.<ref>.supabase.co) is served over IPv6 alone, which a deploy box has no route to; the session pooler is IPv4 */
    else if (has(env, k) && /@db\.[a-z0-9]+\.supabase\.co[:/]/.test(env[k])) wrong.push(`${k} is the direct connection (db.<ref>.supabase.co), which is IPv6-only and unreachable from the deploy box — use the SESSION pooler (Project settings → Database → Connection string → Session): postgresql://postgres.<ref>:…@aws-0-<region>.pooler.supabase.com:5432/postgres`)
  }
  if (has(env, 'SUPABASE_DB_URL') && has(env, 'PLATFORMKIT_SHADOW_DB_URL') && host(env.SUPABASE_DB_URL) && host(env.SUPABASE_DB_URL) === host(env.PLATFORMKIT_SHADOW_DB_URL)) wrong.push('PLATFORMKIT_SHADOW_DB_URL is the production database itself — the shadow is reset to the declaration on every deploy, and that would empty production')
  if (has(env, 'VAPID_SUBJECT') && !/^mailto:[^@\s]+@[^@\s]+$|^https:\/\//.test(env.VAPID_SUBJECT)) wrong.push(`VAPID_SUBJECT "${env.VAPID_SUBJECT}" must be a mailto: address or an https url`)
  if (!mod('store') && s.printed.length) notes.push(`the store module is off while ${s.printed.length} book${s.printed.length === 1 ? ' is' : 's are'} in print — they are set and priced, and nobody can buy them`)
  if (!mod('print') && s.printed.length) notes.push(`the print module is off while ${s.printed.length} book${s.printed.length === 1 ? ' carries' : 's carry'} a print block — no edition is set, none is sold`)

  /* optional, with a working fallback */
  if (!has(env, 'SUPPORT_EMAIL')) notes.push("SUPPORT_EMAIL is unset: the support desk's escalation digest goes to every admin and support address")
  if (!has(env, 'PUBLIC_FUNCTIONS_URL')) notes.push("PUBLIC_FUNCTIONS_URL is unset: the emails' open pixels use the project's own address (set it with the /v1 rewrite on the host)")
  if (mod('api') && ['articles', 'books', 'wiki', 'docs', 'models'].some(mod)) notes.push('the content API (Contentful\'s Delivery, Preview, GraphQL, Sync and Images) answers at <domain>/spaces/*, <domain>/content/v1/* and <domain>/images/* once the host rewrites them to the content and images functions (beside the /v1/* rewrite); without them the site\'s shell forwards the addresses')
  if (mod('api') && mod('sessions')) notes.push('the Scheduling API (cal.com\'s v2) answers at <domain>/v2/* once the host rewrites it to the scheduling-api function (beside the /v1/* rewrite); without it the site\'s shell forwards the address; the Forms API needs nothing new (<domain>/v1/forms-api through the /v1 rewrite)')
  if ((s.sources || []).length) notes.push(`${s.sources.length} analytics source${s.sources.length === 1 ? '' : 's'} registered: a PostHog SDK reaches the door at <domain>/v1/ingest through the /v1 rewrite; api_host set to the bare domain needs the eight PostHog paths rewritten too (/e, /i, /capture, /batch, /flags, /decide, /array, /s → functions/v1/ingest/…)`)
  if (on(env.LULU_SANDBOX)) notes.push('LULU_SANDBOX is on: the printer is the sandbox — quotes are real, nothing is printed or charged')
  if (s.funnels.length && !has(env, 'SMTP_HOST')) notes.push(`${s.funnels.length} funnel${s.funnels.length === 1 ? '' : 's'} published — the mail relay above is what sends them`)

  return { missing, wrong, notes, ok: !missing.length && !wrong.length }
}

/* the report as the deploy prints it */
export function format(r, s) {
  const lines = []
  const onList = [
    s.offers.length ? `${s.offers.length} offer${s.offers.length === 1 ? '' : 's'} for sale` : null,
    s.printed.length ? `${s.printed.length} book${s.printed.length === 1 ? '' : 's'} in print` : null,
    s.sessions.length ? `${s.sessions.length} booking type${s.sessions.length === 1 ? '' : 's'}${s.sessions.some((x) => x.cal) ? ' (' + s.sessions.filter((x) => x.cal).length + ' on cal.com)' : ', none on cal.com'}` : null,
    s.funnels.length ? `${s.funnels.length} funnel${s.funnels.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  lines.push(`› the content switches on: ${onList.length ? onList.join(', ') : 'nothing that sells or books'}`)
  if (r.missing.length) lines.push('✖ production needs these, and the deploy environment does not set them:\n' + r.missing.map((m) => `   ${m.key.padEnd(26)} ${m.why}`).join('\n'))
  if (r.wrong.length) lines.push('✖ production settings that are set but wrong:\n' + r.wrong.map((w) => '   ' + w).join('\n'))
  if (r.notes.length) lines.push('› notes:\n' + r.notes.map((n) => '   ' + n).join('\n'))
  if (r.ok) lines.push('✔ every setting the content needs is present')
  return lines.join('\n')
}

/* ---- run as a script ---- */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  if (args.includes('--test')) {
    const base = { VITE_SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's', VITE_APP_URL: 'https://example.com', SUPABASE_DB_URL: 'postgresql://postgres.example:x@aws-0-us-east-1.pooler.supabase.com:5432/postgres', PLATFORMKIT_SHADOW_DB_URL: 'postgresql://postgres.shadow:x@aws-0-us-east-1.pooler.supabase.com:5432/postgres', SMTP_HOST: 'h', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'The Site <hi@example.com>', VAPID_PRIVATE_KEY: 'k', VITE_VAPID_PUBLIC_KEY: 'K', VAPID_SUBJECT: 'mailto:support@example.com', NETWORK_HANDLE_DOMAIN: 'people.example.com' }
    const stripe = { STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }
    const hyperswitch = {
      HYPERSWITCH_BASE_URL: 'https://sandbox.hyperswitch.io',
      HYPERSWITCH_API_KEY: 'hyperswitch-test-key',
      HYPERSWITCH_PROFILE_ID: 'profile_test',
      HYPERSWITCH_PUBLISHABLE_KEY: 'pk_snd_test',
      HYPERSWITCH_WEBHOOK_SECRET: 'hyperswitch-webhook-key',
    }
    const none = { offers: [], printed: [], sessions: [], pricingSkus: [], funnels: [] }
    const customProvider = {
      id: 'site-mock',
      capabilities: ['checkout.one-time', 'checkout.subscription', 'usage.metered'],
      secrets: ['SITE_MOCK_PAYMENT_SECRET'],
    }
    const customProviderManifests = new Map(KIT_MANIFESTS)
    customProviderManifests.set('site-mock-payments', {
      key: 'site-mock-payments',
      owns: { env: ['SITE_MOCK_PAYMENT_SECRET'] },
      paymentProviders: [customProvider],
    })
    const pricedInferenceSite = {
      inference: {
        providers: [
          { id: 'primary', protocol: 'openai-chat', secret: 'env:PRIMARY_KEY', model: 'm', models: { m: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 } } },
          { id: 'backup', protocol: 'openai-chat', secret: 'env:BACKUP_KEY', model: 'm', models: { m: { inputPerMillionUsd: 3, outputPerMillionUsd: 4 } } },
        ],
        fallback: { maxAttempts: 2 },
        markup: { default: 1.25 },
      },
      usage: { operations: { 'agent.game': { mode: 'offer', offerKey: 'abcdef12' } } },
    }
    const inferenceSale = {
      ...none,
      offers: [{ key: 'abcdef12', sku: 'usage-pack', kind: 'good', usage: { unit: 'credit' } }],
    }
    const meteredSale = {
      ...none,
      offers: [{ sku: 'usage-plan', kind: 'form', usage: { unit: 'minute', meter: 'assistant_usage', overagePrice: 0.03 } }],
    }
    const incrementalSale = {
      ...none,
      offers: [{
        sku: 'incremental-plan',
        kind: 'membership',
        billing: 'subscription',
        usage: { unit: 'request', meter: 'requests', overagePrice: 0.02, incrementalCharge: 100 },
      }],
    }
    const keys = (r) => r.missing.map((m) => m.key)
    const wrongs = (r) => r.wrong
    let n = 0, bad = 0
    const t = (name, cond) => { n++; if (!cond) { bad++; console.log('  FAIL', name) } }
    t('nothing on: the always-set alone', checkDeploy(base, none).ok)
    t('nothing on: stripe not asked for', !keys(checkDeploy(base, none)).includes('STRIPE_SECRET_KEY'))
    t('the inference fallback chain asks for every reachable provider secret',
      keys(checkDeploy(base, inferenceSale, {}, [], null, [], undefined, pricedInferenceSite))
        .filter((key) => key === 'PRIMARY_KEY' || key === 'BACKUP_KEY').length === 2)
    t('the inference site passes with every configured provider secret',
      checkDeploy({ ...base, ...stripe, PRIMARY_KEY: 'p', BACKUP_KEY: 'b' }, inferenceSale, {}, [], null, [], undefined, pricedInferenceSite).ok)
    t('a reader-billed operation without site tariffs is refused',
      wrongs(checkDeploy(base, inferenceSale, {}, [], null, [], undefined, { usage: pricedInferenceSite.usage }))
        .some((message) => /require a site inference provider and tariff/.test(message)))
    t('an operation cannot refer to an unpublished or non-usage offer',
      wrongs(checkDeploy({ ...base, PRIMARY_KEY: 'p', BACKUP_KEY: 'b' }, none, {}, [], null, [], undefined, pricedInferenceSite))
        .some((message) => /no published usage offer/.test(message)))
    t('deploy rejects invalid provider references and fallback limits',
      wrongs(checkDeploy(base, inferenceSale, {}, [], null, [], undefined, {
        ...pricedInferenceSite,
        inference: { ...pricedInferenceSite.inference, fallback: { maxAttempts: 3 } },
      })).some((message) => /inference\.fallback\.maxAttempts/.test(message)))
    t('an offer for sale asks for stripe', keys(checkDeploy(base, { ...none, offers: [{ sku: 'x', kind: 'membership' }] })).includes('STRIPE_SECRET_KEY'))
    const hyperswitchSite = {
      payments: {
        provider: 'hyperswitch',
        profileCapabilities: [
          'catalog.sync',
          'checkout.one-time',
          'checkout.subscription',
          'checkout.trial',
          'checkout.payment-method-selection',
          'checkout.tax',
          'usage.metered',
          'usage.prepaid-top-up',
          'payouts.connected-accounts',
        ],
      },
    }
    const hyperswitchSale = { ...none, offers: [{ sku: 'x', kind: 'membership', billing: 'once' }] }
    const hyperswitchCheck = checkDeploy({ ...base, ...hyperswitch }, hyperswitchSale, {}, [], null, [], undefined, hyperswitchSite)
    t('a selected Hyperswitch provider passes without Stripe settings', hyperswitchCheck.ok &&
      !keys(hyperswitchCheck).includes('STRIPE_SECRET_KEY') &&
      !keys(hyperswitchCheck).includes('STRIPE_WEBHOOK_SECRET'))
    t('PlatformKit-owned catalog synchronization does not require a Hyperswitch profile capability',
      checkDeploy({ ...base, ...hyperswitch }, hyperswitchSale, {}, [], null, [], undefined, {
        payments: { provider: 'hyperswitch', profileCapabilities: ['checkout.one-time'] },
      }).ok)
    t('PlatformKit-managed metered usage does not require a Hyperswitch profile capability',
      checkDeploy({ ...base, ...hyperswitch }, {
        ...none,
        offers: [{
          sku: 'metered',
          kind: 'membership',
          billing: 'subscription',
          usage: { meter: 'audio_seconds', unit: 'second', overagePrice: 1 },
        }],
      }, {}, [], null, [], undefined, {
        payments: { provider: 'hyperswitch', profileCapabilities: ['checkout.subscription'] },
      }).ok)
    t('a selected Hyperswitch provider asks for every server credential and no Stripe credential', (() => {
      const r = checkDeploy(base, hyperswitchSale, {}, [], null, [], undefined, hyperswitchSite)
      const missing = new Set(keys(r))
      return ['HYPERSWITCH_BASE_URL', 'HYPERSWITCH_API_KEY', 'HYPERSWITCH_PROFILE_ID', 'HYPERSWITCH_PUBLISHABLE_KEY', 'HYPERSWITCH_WEBHOOK_SECRET']
        .every((key) => missing.has(key)) && !missing.has('STRIPE_SECRET_KEY') && !missing.has('STRIPE_WEBHOOK_SECRET')
    })())
    t('Hyperswitch deployment refuses an unavailable required capability', checkDeploy(
      { ...base, ...hyperswitch },
      hyperswitchSale,
      {},
      [],
      null,
      [],
      undefined,
      { payments: { provider: 'hyperswitch', profileCapabilities: ['catalog.sync'] } },
    ).wrong.some((message) => /checkout\.one-time/.test(message)))
    t('Hyperswitch deployment rejects a non-https instance URL', checkDeploy(
      { ...base, ...hyperswitch, HYPERSWITCH_BASE_URL: 'http://localhost:8080' },
      hyperswitchSale,
      {},
      [],
      null,
      [],
      undefined,
      hyperswitchSite,
    ).wrong.some((message) => /HYPERSWITCH_BASE_URL/.test(message)))
    t('Hyperswitch deployment rejects an unsupported Web SDK publishable-key prefix', checkDeploy(
      { ...base, ...hyperswitch, HYPERSWITCH_PUBLISHABLE_KEY: 'pk_test_legacy' },
      hyperswitchSale,
      {},
      [],
      null,
      [],
      undefined,
      hyperswitchSite,
    ).wrong.some((message) => /HYPERSWITCH_PUBLISHABLE_KEY.*pk_dev_.*pk_snd_.*pk_prd_/.test(message)))
    t('Hyperswitch deployment accepts a configured HTTPS Web SDK URL', !checkDeploy(
      { ...base, ...hyperswitch, HYPERSWITCH_CLIENT_URL: 'https://sdk.example.test/v1' },
      hyperswitchSale,
      {},
      [],
      null,
      [],
      undefined,
      hyperswitchSite,
    ).wrong.some((message) => /HYPERSWITCH_CLIENT_URL/.test(message)))
    t('Hyperswitch deployment rejects a configured HTTP Web SDK URL', checkDeploy(
      { ...base, ...hyperswitch, HYPERSWITCH_CLIENT_URL: 'http://sdk.example.test/v1' },
      hyperswitchSale,
      {},
      [],
      null,
      [],
      undefined,
      hyperswitchSite,
    ).wrong.some((message) => /HYPERSWITCH_CLIENT_URL/.test(message)))
    t('Hyperswitch remains selected when its profile declaration is malformed', (() => {
      const r = checkDeploy({ ...base, ...hyperswitch }, hyperswitchSale, {}, [], null, [], undefined, {
        payments: { provider: 'hyperswitch' },
      })
      return r.wrong.some((message) => /profileCapabilities/.test(message)) &&
        !keys(r).includes('STRIPE_SECRET_KEY')
    })())
    const customPaymentSite = { payments: { provider: 'site-mock' } }
    const customPaymentCheck = checkDeploy(
      base,
      { ...none, offers: [{ sku: 'x', kind: 'membership' }] },
      {},
      [],
      null,
      [],
      customProviderManifests,
      customPaymentSite,
    )
    t('a site-owned provider asks for only its declared secrets',
      keys(customPaymentCheck).includes('SITE_MOCK_PAYMENT_SECRET') &&
      !keys(customPaymentCheck).includes('STRIPE_SECRET_KEY') &&
      !customPaymentCheck.wrong.length)
    t('a supplied site-owned provider secret passes deploy validation',
      checkDeploy(
        { ...base, SITE_MOCK_PAYMENT_SECRET: 'site-secret' },
        { ...none, offers: [{ sku: 'x', kind: 'membership' }] },
        {},
        [],
        null,
        [],
        customProviderManifests,
        customPaymentSite,
      ).ok)
    t('Stripe local-mock settings do not reject a different selected provider',
      checkDeploy(
        { ...base, SITE_MOCK_PAYMENT_SECRET: 'site-secret', STRIPE_MOCK: '1' },
        { ...none, offers: [{ sku: 'x', kind: 'membership' }] },
        {},
        [],
        null,
        [],
        customProviderManifests,
        customPaymentSite,
      ).ok)
    t('an unregistered payment provider is refused',
      checkDeploy(base, none, {}, [], null, [], customProviderManifests, {
        payments: { provider: 'missing-provider' },
      }).wrong.some((message) => /not registered by an enabled site module/.test(message)))
    t('a provider from a disabled module is refused',
      checkDeploy(base, none, { 'site-mock-payments': false }, [], null, [], customProviderManifests, customPaymentSite)
        .wrong.some((message) => /not registered by an enabled site module/.test(message)))
    t('a zero-base metered offer asks for live Stripe credentials', (() => {
      const r = checkDeploy(base, meteredSale)
      return keys(r).includes('STRIPE_SECRET_KEY') && keys(r).includes('STRIPE_WEBHOOK_SECRET')
    })())
    t('a metered offer passes with live Stripe credentials', checkDeploy({ ...base, ...stripe }, meteredSale).ok)
    t('a metered offer may omit its unit', checkDeploy({ ...base, ...stripe }, {
      ...meteredSale,
      offers: [{
        ...meteredSale.offers[0],
        usage: { meter: 'assistant_usage', overagePrice: 0.03 },
      }],
    }).ok)
    t('incremental Stripe usage requires its publishable key',
      keys(checkDeploy({ ...base, ...stripe }, incrementalSale)).includes('STRIPE_PUBLISHABLE_KEY'))
    t('incremental Stripe usage passes with a live publishable key',
      checkDeploy({ ...base, ...stripe, STRIPE_PUBLISHABLE_KEY: 'pk_live_x' }, incrementalSale).ok)
    t('incremental Stripe usage refuses a non-live publishable key',
      checkDeploy({ ...base, ...stripe, STRIPE_PUBLISHABLE_KEY: 'pk_test_x' }, incrementalSale).wrong
        .some((message) => /STRIPE_PUBLISHABLE_KEY is not a live publishable key/.test(message)))
    t('only opted-in Stripe usage adds the browser-authentication function secret',
      conditionalPaymentSecrets('stripe', incrementalSale).includes('STRIPE_PUBLISHABLE_KEY') &&
      conditionalPaymentSecrets('stripe', meteredSale).length === 0 &&
      conditionalPaymentSecrets('hyperswitch', incrementalSale).length === 0)
    t('a metered offer with an invalid event name is refused', checkDeploy({ ...base, ...stripe }, {
      ...meteredSale, offers: [{ ...meteredSale.offers[0], usage: { ...meteredSale.offers[0].usage, meter: 'Not valid' } }],
    }).wrong.some((w) => /valid Stripe meter event name/.test(w)))
    t('metered offers cannot share an event name', checkDeploy({ ...base, ...stripe }, {
      ...meteredSale, offers: [meteredSale.offers[0], { ...meteredSale.offers[0], sku: 'other-plan' }],
    }).wrong.some((w) => /share Stripe meter event name/.test(w)))
    t('a custom provider can use its own meter identifiers without Stripe credentials', (() => {
      const r = checkDeploy(
        { ...base, SITE_MOCK_PAYMENT_SECRET: 'site-secret' },
        { ...none, offers: [{ sku: 'usage-plan', kind: 'form', usage: { unit: 'minute', meter: 'vendor.metric-1', overagePrice: 0.03 } }] },
        {},
        [],
        null,
        [],
        customProviderManifests,
        customPaymentSite,
      )
      return r.ok && !keys(r).includes('STRIPE_SECRET_KEY')
    })())
    /* TAX IS A NOTE, NOT A REFUSAL: there is no key for Stripe Tax, so nothing here can verify it,
       and unconfigured Stripe returns no tax rather than an error — which is the silent failure the
       note exists to prevent. These two cases pin that it is said, and only when asked for. */
    t('an offer asking for tax is noted, with Stripe Tax named',
      checkDeploy({ ...base, ...stripe }, { ...none, offers: [{ sku: 'x', kind: 'good', tax: true }] }).notes.some((m) => /Stripe Tax must be active/.test(m)))
    t('…and it does not refuse the deploy over a setting it cannot see',
      checkDeploy({ ...base, ...stripe }, { ...none, offers: [{ sku: 'x', kind: 'good', tax: true }] }).ok)
    t('an offer not asking for tax is not noted',
      !checkDeploy({ ...base, ...stripe }, { ...none, offers: [{ sku: 'x', kind: 'good' }] }).notes.some((m) => /Stripe Tax/.test(m)))
    t('a pricing row with a sku asks for stripe', keys(checkDeploy(base, { ...none, pricingSkus: ['x'] })).includes('STRIPE_WEBHOOK_SECRET'))
    t('a test key is wrong', checkDeploy({ ...base, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }, { ...none, offers: [{ sku: 'x' }] }).wrong.some((w) => /not a live key/.test(w)))
    const auto = { ...none, printed: [{ slug: 'the-kybalion', printers: { softcover: 'auto', hardcover: 'auto' } }] }
    t('a book in print on auto with no printer is refused', !checkDeploy({ ...base, ...stripe }, auto).ok)
    t('…and with one printer it passes', checkDeploy({ ...base, ...stripe, BOOKVAULT_API_KEY: 'b' }, auto).ok)
    t('…but not without stripe', keys(checkDeploy({ ...base, BOOKVAULT_API_KEY: 'b' }, auto)).includes('STRIPE_SECRET_KEY'))
    const lulu = { ...none, printed: [{ slug: 'x', printers: { softcover: 'lulu' } }] }
    t('a book that names lulu asks for lulu, another printer does not do', keys(checkDeploy({ ...base, ...stripe, BOOKVAULT_API_KEY: 'b' }, lulu)).includes('LULU_CLIENT_KEY'))
    t('PRINT_BUILD off does not bypass a published book printer check', keys(checkDeploy({ ...base, ...stripe, PRINT_BUILD: '0' }, lulu)).includes('LULU_CLIENT_KEY'))
    t('…and passes with lulu', checkDeploy({ ...base, ...stripe, LULU_CLIENT_KEY: 'k', LULU_CLIENT_SECRET: 's' }, lulu).ok)
    t('premium goes to bookvault', keys(checkDeploy({ ...base, ...stripe, LULU_CLIENT_KEY: 'k', LULU_CLIENT_SECRET: 's' }, { ...none, printed: [{ slug: 'x', printers: { premium: 'bookvault' } }] })).includes('BOOKVAULT_API_KEY'))
    t('a type cal.com schedules asks for cal.com', keys(checkDeploy(base, { ...none, sessions: [{ file: 'group-call', cal: true }] })).includes('CAL_WEBHOOK_SECRET'))
    t('a site whose every type is its own asks for nothing of cal.com', !keys(checkDeploy(base, { ...none, sessions: [{ file: 'one-on-one', cal: false }, { file: 'patron-hour', cal: false }] })).some((k) => /^CAL_/.test(k)))
    t('one cal.com type beside native ones asks for both', keys(checkDeploy(base, { ...none, sessions: [{ file: 'one-on-one', cal: false }, { file: 'group-call', cal: true }] })).filter((k) => /^CAL_/.test(k)).length === 2)
    t('no session, no cal.com', !keys(checkDeploy(base, none)).includes('CAL_API_KEY'))
    const lk = { LIVEKIT_URL: 'wss://x.livekit.cloud', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' }
    t('no room type, no LiveKit', !keys(checkDeploy(base, { ...none, sessions: [{ file: 'patron-hour', cal: false, room: false }] })).some((k) => /^LIVEKIT_/.test(k)))
    /* a room needs no account: only what the mesh cannot do is refused for want of one */
    t('a plain room type needs no account at all', !keys(checkDeploy(base, { ...none, sessions: [{ file: 'members-call', cal: false, room: true }] })).some((k) => /^LIVEKIT_/.test(k)))
    t('…and is told what it gives up', checkDeploy(base, { ...none, sessions: [{ file: 'members-call', cal: false, room: true }] }).notes.some((n) => /browser to browser/.test(n)))
    t('a room type that records asks for the three', keys(checkDeploy(base, { ...none, sessions: [{ file: 'members-call', cal: false, room: true, record: true }] })).filter((k) => /^LIVEKIT_/.test(k)).length === 3)
    t('a room seating more than the mesh carries asks for them too', keys(checkDeploy(base, { ...none, sessions: [{ file: 'big-call', cal: false, room: true, seats: MESH_MAX + 1 }] })).filter((k) => /^LIVEKIT_/.test(k)).length === 3)
    t('a room seating what it carries does not', !keys(checkDeploy(base, { ...none, sessions: [{ file: 'small-call', cal: false, room: true, seats: MESH_MAX }] })).some((k) => /^LIVEKIT_/.test(k)))
    t('half an account is refused, whatever the type', keys(checkDeploy({ ...base, LIVEKIT_URL: 'wss://x' }, { ...none, sessions: [{ file: 'members-call', cal: false, room: true }] })).filter((k) => /^LIVEKIT_/.test(k)).length === 2)
    t('…and passes with them, asking for no storage key while it does not record', !keys(checkDeploy({ ...base, ...lk }, { ...none, sessions: [{ file: 'members-call', cal: false, room: true }] })).some((k) => /^(LIVEKIT|STORAGE)_/.test(k)))
    t('a room type that records asks for the storage keys too', keys(checkDeploy({ ...base, ...lk }, { ...none, sessions: [{ file: 'members-call', cal: false, room: true, record: true }] })).filter((k) => /^STORAGE_S3_/.test(k)).length === 2)
    t('the LiveKit mock on is wrong', checkDeploy({ ...base, LIVEKIT_MOCK: '1' }, none).wrong.some((w) => /LIVEKIT_MOCK/.test(w)))
    t('a mock on is wrong', checkDeploy({ ...base, PRINT_MOCK: '1' }, none).wrong.length === 1)
    /* the provider policy: the two arrangements, the third refused by name, and the terms */
    const prov = (p) => ({ ...none, providers: p })
    t('providers off asks for nothing', checkDeploy(base, prov({ offerings: 'off', connect: 'managed', terms: 'v1' })).ok)
    t('providers on asks for stripe, saying why', (() => { const r = checkDeploy(base, prov({ offerings: 'on', connect: 'managed', terms: 'v1' })); return r.missing.some((m) => m.key === 'STRIPE_SECRET_KEY' && /paid through it/.test(m.why)) })())
    t('…and passes with it, noting the arrangement', (() => { const r = checkDeploy({ ...base, ...stripe }, prov({ offerings: 'on', connect: 'managed', terms: 'v1' })); return r.ok && r.notes.some((x) => /Connect must be enabled/.test(x)) })())
    t('an account they already hold is the other arrangement', checkDeploy({ ...base, ...stripe }, prov({ offerings: 'on', connect: 'own', terms: 'v1' })).ok)
    t('the facilitator arrangement is refused BY NAME', wrongs(checkDeploy({ ...base, ...stripe }, prov({ offerings: 'on', connect: 'platform', terms: 'v1' }))).some((w) => /payment facilitator/.test(w)))
    t('…and refused whether providers are offering yet or not', wrongs(checkDeploy({ ...base, ...stripe }, prov({ offerings: 'off', connect: 'facilitator', terms: 'v1' }))).some((w) => /payment facilitator/.test(w)))
    t('selling with no terms agreed is refused', wrongs(checkDeploy({ ...base, ...stripe }, prov({ offerings: 'on', connect: 'managed', terms: '' }))).some((w) => /nothing is agreed/.test(w)))
    t('no terms is fine while nobody may offer anything', checkDeploy(base, prov({ offerings: 'off', connect: 'managed', terms: '' })).ok)
    t('a delay that is not a span is refused', wrongs(checkDeploy({ ...base, ...stripe }, prov({ offerings: 'on', connect: 'managed', terms: 'v1', delay: 'soon' }))).some((w) => /not a span/.test(w)))
    t('no delay at all is a note about refunds, not a refusal', (() => { const r = checkDeploy({ ...base, ...stripe }, prov({ offerings: 'on', connect: 'managed', terms: 'v1', delay: '0d' })); return r.ok && r.notes.some((x) => /asking a provider to send some back/.test(x)) })())
    t('sessions off asks nothing of the policy, since an offering is a bookable thing', checkDeploy(base, prov({ offerings: 'on', connect: 'platform', terms: '' }), { sessions: false }).ok)
    t('the payouts mock on is wrong', wrongs(checkDeploy({ ...base, PAYOUTS_MOCK: '1' }, none)).some((w) => /PAYOUTS_MOCK/.test(w)))
    t('a site that mails is asked for the relay', keys(checkDeploy({ ...base, SMTP_HOST: '' }, none)).includes('SMTP_HOST'))
    t('a backed site is asked for the database', keys(checkDeploy({ ...base, SUPABASE_DB_URL: '' }, none)).includes('SUPABASE_DB_URL'))
    t('a backed site is asked for the shadow', keys(checkDeploy({ ...base, PLATFORMKIT_SHADOW_DB_URL: '' }, none)).includes('PLATFORMKIT_SHADOW_DB_URL'))
    t('a shadow that is production itself is wrong', wrongs(checkDeploy({ ...base, PLATFORMKIT_SHADOW_DB_URL: base.SUPABASE_DB_URL }, none)).some((w) => /shadow/i.test(w)))
    t('a database url that is not one is wrong', wrongs(checkDeploy({ ...base, SUPABASE_DB_URL: 'db.example.supabase.co' }, none)).some((w) => /SUPABASE_DB_URL/.test(w)))
    t('the direct (IPv6-only) connection is wrong', wrongs(checkDeploy({ ...base, SUPABASE_DB_URL: 'postgresql://postgres:x@db.abcdefghijkl.supabase.co:5432/postgres' }, none)).some((w) => /session pooler/i.test(w)))
    t('the session pooler is right', !wrongs(checkDeploy({ ...base, SUPABASE_DB_URL: 'postgresql://postgres.abcdefghijkl:x@aws-0-us-east-1.pooler.supabase.com:5432/postgres' }, none)).some((w) => /SUPABASE_DB_URL/.test(w)))
    t('a site with push on is asked for the pair', keys(checkDeploy({ ...base, VAPID_PRIVATE_KEY: '' }, none)).includes('VAPID_PRIVATE_KEY'))
    t('a path on the app url is wrong', checkDeploy({ ...base, VITE_APP_URL: 'https://example.com/' }, none).wrong.length === 1)
    t('support email is a note, never a refusal', checkDeploy(base, none).notes.some((x) => /SUPPORT_EMAIL/.test(x)))
    /* a module off asks for nothing of its own */
    t('push off: no vapid asked', !keys(checkDeploy({ ...base, VAPID_PRIVATE_KEY: '' }, none, { push: false })).includes('VAPID_PRIVATE_KEY'))
    t('sessions off: no cal.com asked', !keys(checkDeploy(base, { ...none, sessions: ['group-call'] }, { sessions: false })).includes('CAL_WEBHOOK_SECRET'))
    t('print off: no printer asked, and a note', (() => { const r = checkDeploy({ ...base, ...stripe }, auto, { print: false }); return r.ok && r.notes.some((x) => /print module is off/.test(x)) })())
    t('store, memberships and sessions off: no stripe asked', !keys(checkDeploy(base, { ...none, offers: [{ sku: 'x', kind: 'book' }] }, { store: false, memberships: false, sessions: false })).includes('STRIPE_SECRET_KEY'))
    t('a content store that is neither git nor cloud is refused', wrongs(checkDeploy({ ...base, CONTENT_STORE: 'disk' }, none)).some((w) => /CONTENT_STORE/.test(w)))
    t('cloud mode passes with the service key and is noted', (() => { const r = checkDeploy({ ...base, CONTENT_STORE: 'cloud' }, none); return r.ok && r.notes.some((x) => /cloud/.test(x)) })())
    /* the coupling comes from the manifests now, so the case hands in what they say */
    const COUPLE = [{ module: 'instrument', needs: 'forms', why: 'the instrument runs on the forms runner' }]
    t('a live module whose requirement is off is refused, naming both', wrongs(checkDeploy(base, none, { instrument: true, forms: false }, [], null, COUPLE)).some((w) => /modules\.instrument.*modules\.forms/.test(w)))
    t('and the refusal says why, from the manifest', wrongs(checkDeploy(base, none, { instrument: true, forms: false }, [], null, COUPLE)).some((w) => /runs on the forms runner/.test(w)))
    /* and the coupling is REALLY declared — a placeholder here would leave the rule read from
       manifests while nothing checked that any manifest carries one */
    {
      const { MODULES } = await import('./modules/kit.mjs')
      const { readManifests, unmetRequirements } = await import('./modules/manifest.mjs')
      const { modules } = readManifests(MODULES.map((m) => ({ manifest: m, where: 'the kit' })))
      const real = unmetRequirements(modules, { forms: false })
      t('the kit\u2019s own manifests declare the instrument\u2019s need for forms', real.some((u) => u.module === 'instrument' && u.needs === 'forms' && u.why))
    }
    t('forms off with the instrument off is fine', checkDeploy(base, none, { instrument: false, forms: false }, [], null, []).ok)
    /* the build steps' needs: a step on asks for its variables, its tools and its packages, naming itself; a step off asks for nothing */
    const spoken = { step: { key: 'tts', title: 'The spoken books' }, env: ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'], tools: ['git-lfs'], packages: ['onnxruntime-node', 'ffmpeg-static'] }
    t('a step on asks for its variable, naming itself', (() => { const r = checkDeploy({ ...base, SUPABASE_SERVICE_ROLE_KEY: '' }, none, {}, [spoken]); return keys(r).includes('SUPABASE_SERVICE_ROLE_KEY') && r.missing.some((m) => m.key === 'SUPABASE_URL' && /spoken books/.test(m.why)) })())
    t('a step off asks for nothing', !keys(checkDeploy({ ...base, SUPABASE_URL: '' }, none, {}, [])).includes('SUPABASE_URL'))
    t('a tool off the path is wrong, naming the step', wrongs(checkDeploy({ ...base, SUPABASE_URL: 'x' }, none, {}, [{ ...spoken, tools: ['no-such-tool-zz'], packages: [] }])).some((w) => /no-such-tool-zz.*spoken books/.test(w)))
    t('a package not installed is wrong, naming the step and the install', wrongs(checkDeploy({ ...base, SUPABASE_URL: 'x' }, { ...none, root: '.' }, {}, [{ ...spoken, tools: [], packages: ['no-such-package-zz'] }])).some((w) => /no-such-package-zz.*spoken books.*npm install/.test(w)))
    t('a package installed passes', !wrongs(checkDeploy({ ...base, SUPABASE_URL: 'x' }, { ...none, root: '.' }, {}, [{ ...spoken, tools: [], packages: ['gray-matter'] }])).some((w) => /gray-matter/.test(w)))
    /* the site's own steps, as they are: their tools and packages resolve here */
    const { loadSteps, needsOf, missingNeeds } = await import('./steps.mjs')
    const { loadSite } = await import('./site.mjs')
    const siteCfg = await loadSite()
    const stepMissing = missingNeeds(needsOf(await loadSteps(siteCfg), siteCfg, process.env), process.env, siteCfg.root, ['tool', 'package'])
    t('every on step\'s tools and packages are here (' + (stepMissing.length ? stepMissing.map((m) => m.name).join(', ') : 'none missing') + ')', stepMissing.length === 0)
    /* ---- the three shapes: a feature that is off asks for nothing, and that includes the backend ---- */
    const OFF = Object.fromEntries(Object.keys(FEATURES).map((k) => [k, false]))
    const STATIC = { backend: false, content: 'files', repo: false, mode: 'static' }
    const siteUrl = { VITE_APP_URL: 'https://example.com' }
    t('a static site with every module off needs nothing but its own address', checkDeploy(siteUrl, none, OFF, [], STATIC).ok)
    t('a static site is not asked for a database', !keys(checkDeploy(siteUrl, none, OFF, [], STATIC)).includes('SUPABASE_DB_URL'))
    t('a static site is not asked for a shadow', !keys(checkDeploy(siteUrl, none, OFF, [], STATIC)).includes('PLATFORMKIT_SHADOW_DB_URL'))
    t('a static site is not asked for the mail relay', !keys(checkDeploy(siteUrl, none, OFF, [], STATIC)).includes('SMTP_HOST'))
    t('a static site is not asked for the push pair', !keys(checkDeploy(siteUrl, none, OFF, [], STATIC)).includes('VAPID_PRIVATE_KEY'))
    t('a static site still needs its own address (the sitemap and absolute links)', keys(checkDeploy({}, none, OFF, [], STATIC)).includes('VITE_APP_URL'))
    /* REFUSED BY THE FEATURE, NOT THE VARIABLE */
    for (const [m, word] of [['store', /nowhere to keep an order/], ['sessions', /nowhere to keep a booking/], ['spaces', /nowhere to keep a room/]]) {
      const r = checkDeploy(siteUrl, none, { ...OFF, [m]: true }, [], STATIC)
      t(`a static site with ${m} on is refused by the feature`, !r.ok && r.missing.some((x) => x.key === m && word.test(x.why)))
      t(`…and not by a variable name`, !keys(checkDeploy(siteUrl, none, { ...OFF, [m]: true }, [], STATIC)).includes('SUPABASE_DB_URL'))
    }
    /* a declaration beside a stray key is a mistake, not an override */
    t('a backend key set beside backend:false is wrong', wrongs(checkDeploy({ ...siteUrl, SUPABASE_DB_URL: 'x' }, none, OFF, [], STATIC)).some((w) => /declares no backend/.test(w)))
    /* a backed site is exactly what it was */
    t('a backed site is asked for the database as before', keys(checkDeploy({ ...base, SUPABASE_DB_URL: '' }, none)).includes('SUPABASE_DB_URL'))
    const cmsSite = { admin: { models: './build/admin-models.mjs' } }
    const fileShape = { backend: true, content: 'files', repo: true, mode: 'git' }
    const rowsShape = { backend: true, content: 'rows', repo: true, mode: 'git' }
    t('a CMS site cannot pass deploy checks with file-backed content', wrongs(checkDeploy(base, none, OFF, [], fileShape, [], undefined, cmsSite)).some((w) => /admin models/.test(w)))
    t('a CMS site passes the content-shape check with Supabase rows', !wrongs(checkDeploy(base, none, OFF, [], rowsShape, [], undefined, cmsSite)).some((w) => /admin models/.test(w)))
    /* the network: a handle domain whenever it is on, the rotation key only when it federates */
    t('the network on asks for the handle domain', keys(checkDeploy({ ...base, NETWORK_HANDLE_DOMAIN: '' }, none, { network: true })).includes('NETWORK_HANDLE_DOMAIN'))
    t('…and a closed network asks for no rotation key', !keys(checkDeploy(base, none, { network: true })).includes('NETWORK_PLC_ROTATION_KEY'))
    t('a federating network asks for the rotation key', keys(checkDeploy(base, { ...none, network: { federate: true } }, { network: true })).includes('NETWORK_PLC_ROTATION_KEY'))
    t('the federation test switch is wrong in production', checkDeploy({ ...base, NETWORK_FEDERATE: '1' }, none).wrong.some((w) => /NETWORK_FEDERATE/.test(w)))
    t('the network off asks for neither', !keys(checkDeploy({ ...base, NETWORK_HANDLE_DOMAIN: '' }, { ...none, network: { federate: true } }, { network: false })).some((k) => /^NETWORK_/.test(k)))
    t('a backed site with nothing that mails is not asked for the relay', !keys(checkDeploy({ ...base, SMTP_HOST: '' }, none, OFF)).includes('SMTP_HOST'))

    /* the site as it is: its content reads without a fault, and what it switches on is reported */
    const s = surfaces('.')
    t('the site\'s content reads', Array.isArray(s.offers) && Array.isArray(s.printed) && Array.isArray(s.sessions))
    console.log(`  the site sells ${s.offers.length} offer(s), prints ${s.printed.length} book(s), books ${s.sessions.length} session type(s)`)
    console.log(`deploy checks: ${n - bad}/${n} pass`)
    process.exit(bad ? 1 : 0)
  }
  const i = args.indexOf('--env')
  const file = i >= 0 ? args[i + 1] : '.env.production'
  const env = { ...(existsSync(file) ? Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l)).filter((m) => m && !m[0].trimStart().startsWith('#')).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')])) : {}), ...process.env }
  const s = surfaces('.')
  const site = await (await import('./site.mjs')).loadSite()
  s.network = site.network || {}
  const { deploymentShape } = await import('./site.mjs')
  const shape = deploymentShape(site, env)
  const { loadSteps, needsOf } = await import('./steps.mjs')
  const r = checkDeploy(env, s, site.modules, needsOf(await loadSteps(site), site, env, shape), shape, [], undefined, site)
  console.log(format(r, s))
  process.exit(r.ok ? 0 : 1)
}

/*
 * WHAT A MODULE SAYS ABOUT ITSELF.
 *
 * A module used to be a name in four lists — the deployment matrix in modes.mjs, the run of
 * `if (mod('x')) need(...)` in deploy-checks.mjs, the `*_ON` flags in router.js, and the `module:`
 * field on a build step. Four places repeating one convention, `modules[m] !== false`, which is
 * why `modules-off.test.mjs` had to be written to check they agree — and which holds until
 * somebody writes the twenty-fifth module.
 *
 * So a module declares itself once, here, and those four read it. Two things follow that are worth
 * saying plainly, because they are the whole point:
 *
 *   THE SET IS OPEN. A site may register a module of its own and have it treated as the kit's
 *   own are — a switch, a row in the matrix, its steps run, its environment asked for. Adding one
 *   needs no edit to any file of the kit.
 *
 *   THE MANIFEST DECLARES; THE DERIVATION STILL CHECKS. A manifest saying `cloud: true` does not
 *   make it so. `modes.test.mjs` goes on asking the code — the projections, the artefacts, the
 *   models — and fails a claim the code cannot back, in both directions: a module claiming cloud
 *   with no projection hook, and an exception whose gap has since been closed. A declaration
 *   nobody checks is how a debt list becomes something somebody has to remember.
 *
 * THE SHAPE
 *
 *   key        the switch's name in platformkit.config.js `modules`
 *   what       one line a person reads: what this module IS
 *   needs      why it cannot work without a backend, where that is so (the matrix prints it)
 *   requires   other modules this one cannot work without — declared by the DEPENDENT, because a
 *              module should not have to know who uses it
 *   static · git · cloud
 *              true, false, or { kind, except, change, why } — the one operation it lacks in that
 *              shape, why, and the change that closes it. All three are required: a module
 *              answers for every shape in the commit that adds it.
 *   owns       what switching it off takes away:
 *                routes    paths the site answers only while this module is on
 *                admin     the admin's section keys
 *                schema    the schema files under supabase/schemas that are its
 *                functions the edge functions that are its
 *                cron      the scheduled jobs that are its
 *                steps     the build-step keys that are its (each step also carries `module:`,
 *                          and the two are cross-checked — neither is trusted alone)
 *                env       the environment variables the deploy asks for while it is on
 */

/* every field a manifest may carry, so a typo is refused rather than ignored */
export const FIELDS = ['key', 'what', 'needs', 'requires', 'static', 'git', 'cloud', 'owns', 'paymentProviders']
export const OWNS = ['routes', 'admin', 'schema', 'functions', 'cron', 'steps', 'env']
/* what exactly one module may claim. Everything a switch takes away with it — and not `env`, which
   is the deployment's and is shared: see the collision check in readManifests for why. */
export const EXCLUSIVE = OWNS.filter((k) => k !== 'env')
export const SHAPES = ['static', 'git', 'cloud']
/* what sort of gap an exception is — the same vocabulary the matrix has always used */
export const KINDS = ['projection', 'artefact', 'editing', 'machine', 'browser']

const isCell = (v) => v === true || v === false || (v && typeof v === 'object' && KINDS.includes(v.kind) && typeof v.except === 'string' && typeof v.why === 'string')

const CRON_NAME = /^[a-z][a-z0-9-]*$/
const CRON_FIELDS = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]

function validCronSchedule(value) {
  if (typeof value !== 'string') return false
  const fields = value.trim().split(/\s+/)
  if (fields.length !== 5) return false
  return fields.every((field, index) => {
    const [min, max] = CRON_FIELDS[index]
    const terms = field.split(',')
    if (terms.some((term) => !/^(?:\*|\d+(?:-\d+)?)(?:\/\d+)?$/.test(term))) return false
    return terms.every((term) => {
      const [range, step] = term.split('/')
      if (step !== undefined && (!/^\d+$/.test(step) || Number(step) < 1)) return false
      if (range === '*') return true
      const bounds = range.split('-').map(Number)
      return bounds.length <= 2 && bounds.every((n) => Number.isInteger(n) && n >= min && n <= max) &&
        (bounds.length === 1 || bounds[0] <= bounds[1])
    })
  })
}

export function sqlStructure(value) {
  let out = ''
  for (let i = 0; i < value.length;) {
    if (value.startsWith('--', i)) {
      const end = value.indexOf('\n', i + 2)
      i = end < 0 ? value.length : end
      out += ' '
      continue
    }
    if (value.startsWith('/*', i)) {
      let depth = 1
      i += 2
      while (i < value.length && depth) {
        if (value.startsWith('/*', i)) { depth++; i += 2 }
        else if (value.startsWith('*/', i)) { depth--; i += 2 }
        else i++
      }
      if (depth) return null
      out += ' '
      continue
    }
    if (value[i] === "'" || value[i] === '"') {
      const quote = value[i++]
      let closed = false
      while (i < value.length) {
        if (value[i] === quote) {
          if (value[i + 1] === quote) { i += 2; continue }
          i++
          closed = true
          break
        }
        if (value[i] === '\\' && i + 1 < value.length) i += 2
        else i++
      }
      if (!closed) return null
      out += ' '
      continue
    }
    if (value[i] === '$') {
      const delimiter = /^\$[a-z_][a-z0-9_]*\$|^\$\$/i.exec(value.slice(i))?.[0]
      if (delimiter) {
        const end = value.indexOf(delimiter, i + delimiter.length)
        if (end < 0) return null
        i = end + delimiter.length
        out += ' '
        continue
      }
    }
    out += value[i++]
  }
  return out
}

function validCronCommand(value) {
  if (typeof value !== 'string' || value.includes('\0')) return false
  const command = value.trim()
  if (!/^(?:select|call)\b/i.test(command)) return false
  const structure = sqlStructure(command)
  if (structure === null) return false
  const structural = structure.trim()
    .replace(/;\s*$/, '')
  return !structural.includes(';')
}

function paymentProvidersOf(value, owns, where, faults) {
  if (value == null) return []
  if (!Array.isArray(value)) {
    faults.push(`${where}: \`paymentProviders\` must be a list`)
    return []
  }
  const seen = new Set()
  return value.flatMap((provider, index) => {
    const label = `${where}: \`paymentProviders[${index}]\``
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
      faults.push(`${label} must be a provider registration`)
      return []
    }
    for (const field of Object.keys(provider)) {
      if (!['id', 'adapter', 'capabilities', 'secrets', 'webhookPath'].includes(field)) {
        faults.push(`${label}: \`${field}\` is not a provider registration field`)
      }
    }
    const { id, adapter, capabilities, secrets, webhookPath } = provider
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) faults.push(`${label}.id must be a lower-case provider name`)
    else if (id === 'stripe' || id === 'hyperswitch') faults.push(`${label}.id "${id}" is reserved for the built-in provider`)
    else if (seen.has(id)) faults.push(`${where}: payment provider \`${id}\` is declared more than once by this module`)
    else seen.add(id)
    if (typeof adapter !== 'string' || path.posix.isAbsolute(adapter) ||
        path.posix.normalize(adapter) !== adapter || adapter.split('/').some((part) => part === '.' || part === '..') ||
        !/\.(?:mjs|js|ts)$/.test(adapter)) {
      faults.push(`${label}.adapter must be a relative JavaScript or TypeScript module path under the site's Edge Function _shared directory`)
    }
    if (!Array.isArray(capabilities) || !capabilities.length) faults.push(`${label}.capabilities must be a non-empty list`)
    else {
      const capabilitySet = new Set()
      for (const capability of capabilities) {
        if (!PAYMENT_CAPABILITIES.includes(capability)) faults.push(`${label} declares unknown capability ${JSON.stringify(capability)}`)
        if (capabilitySet.has(capability)) faults.push(`${label} repeats capability ${JSON.stringify(capability)}`)
        capabilitySet.add(capability)
      }
    }
    if (!Array.isArray(secrets)) faults.push(`${label}.secrets must be a list`)
    else {
      const secretSet = new Set()
      for (const secret of secrets) {
        if (typeof secret !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(secret)) faults.push(`${label}.secrets must contain environment variable names`)
        else if (secretSet.has(secret)) faults.push(`${label}.secrets repeats ${secret}`)
        else if (!Array.isArray(owns?.env) || !owns.env.includes(secret)) faults.push(`${label} secret ${secret} must also be declared in owns.env`)
        secretSet.add(secret)
      }
    }
    if (webhookPath !== PAYMENT_PROVIDER_WEBHOOK_PATH) {
      faults.push(`${label}.webhookPath must be ${PAYMENT_PROVIDER_WEBHOOK_PATH}`)
    }
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id) ||
        typeof adapter !== 'string' || path.posix.isAbsolute(adapter) ||
        path.posix.normalize(adapter) !== adapter || adapter.split('/').some((part) => part === '.' || part === '..') ||
        !/\.(?:mjs|js|ts)$/.test(adapter) ||
        !Array.isArray(capabilities) || !capabilities.length ||
        !Array.isArray(secrets) || webhookPath !== PAYMENT_PROVIDER_WEBHOOK_PATH) return []
    return [{
      id,
      adapter,
      capabilities: [...capabilities],
      secrets: [...secrets],
      webhookPath,
    }]
  })
}

/*
 * READ ONE. Every fault is collected rather than thrown on the first, because somebody writing a
 * manifest wants to be told everything that is wrong with it, not one thing at a time.
 */
export function readManifest(m, where = 'a manifest') {
  const faults = []
  if (!m || typeof m !== 'object') return { manifest: null, faults: [`${where}: not an object`] }

  const key = m.key
  if (!key || typeof key !== 'string' || !/^[a-z][a-z0-9-]*$/.test(key)) faults.push(`${where}: \`key\` must be a lower-case name, not ${JSON.stringify(key)}`)
  if (!m.what || typeof m.what !== 'string') faults.push(`${where}: \`what\` must say in one line what this module is`)

  for (const k of Object.keys(m)) if (!FIELDS.includes(k)) faults.push(`${where}: \`${k}\` is not a manifest field (${FIELDS.join(' · ')})`)

  /* all three shapes, always — a module answers for every shape in the commit that adds it */
  for (const s of SHAPES) {
    if (!(s in m)) faults.push(`${where}: no answer for \`${s}\` — a module answers for all three shapes`)
    else if (!isCell(m[s])) faults.push(`${where}: \`${s}\` must be true, false, or { kind, except, why } with kind one of ${KINDS.join(' · ')}`)
  }

  /* a name, or a name with its own reason — the reason belongs to the COUPLING, not to the
     module: "an answer is written to an account" says why the instrument needs a backend, and
     nothing at all about why it needs forms. */
  const reqs = []
  if (m.requires != null) {
    if (!Array.isArray(m.requires)) faults.push(`${where}: \`requires\` must be a list`)
    else for (const r of m.requires) {
      if (typeof r === 'string') reqs.push({ module: r, why: null })
      else if (r && typeof r.module === 'string') reqs.push({ module: r.module, why: typeof r.why === 'string' ? r.why : null })
      else faults.push(`${where}: \`requires\` takes a module name, or { module, why }`)
    }
  }

  const owns = m.owns || {}
  if (typeof owns !== 'object') faults.push(`${where}: \`owns\` must be an object`)
  else {
    for (const k of Object.keys(owns)) if (!OWNS.includes(k)) faults.push(`${where}: \`owns.${k}\` is not a thing a module owns (${OWNS.join(' · ')})`)
    for (const k of OWNS) {
      if (owns[k] == null) continue
      if (!Array.isArray(owns[k])) {
        faults.push(`${where}: \`owns.${k}\` must be a list${k === 'cron' ? ' of { name, schedule, command } records' : ' of strings'}`)
        continue
      }
      if (k !== 'cron') {
        if (!owns[k].every((x) => typeof x === 'string')) faults.push(`${where}: \`owns.${k}\` must be a list of strings`)
        continue
      }
      const names = new Set()
      for (const [index, job] of owns.cron.entries()) {
        const label = `${where}: \`owns.cron[${index}]\``
        if (!job || typeof job !== 'object' || Array.isArray(job)) {
          faults.push(`${label} must be a { name, schedule, command } record`)
          continue
        }
        for (const field of Object.keys(job)) if (!['name', 'schedule', 'command'].includes(field)) faults.push(`${label}: \`${field}\` is not a cron field`)
        if (typeof job.name !== 'string' || !CRON_NAME.test(job.name)) faults.push(`${label}.name must be a lower-case job name`)
        else if (names.has(job.name)) faults.push(`${where}: cron job \`${job.name}\` is declared more than once`)
        else names.add(job.name)
        if (!validCronSchedule(job.schedule)) faults.push(`${label}.schedule must be a valid five-field cron schedule`)
        if (!validCronCommand(job.command)) faults.push(`${label}.command must be one SQL SELECT or CALL statement`)
      }
    }
  }
  const paymentProviders = paymentProvidersOf(m.paymentProviders, owns, where, faults)

  return {
    manifest: faults.length ? null : {
      key, what: m.what, needs: m.needs || null,
      static: m.static, git: m.git, cloud: m.cloud, requires: reqs,
      owns: Object.fromEntries(OWNS.map((k) => [k, owns[k] || []])),
      paymentProviders,
    },
    faults,
  }
}

/*
 * READ A SET. Two modules under one key is the fault that would otherwise be resolved silently by
 * whichever was loaded last — and where a site overrides one of the kit's, that has to be a
 * deliberate thing somebody asked for rather than an accident of order.
 */
export function readManifests(entries) {
  const faults = [], by = new Map()
  for (const { manifest: raw, where } of entries) {
    const { manifest, faults: f } = readManifest(raw, where)
    faults.push(...f)
    if (!manifest) continue
    if (by.has(manifest.key)) faults.push(`two manifests declare \`${manifest.key}\`: ${by.get(manifest.key).where} and ${where}`)
    else by.set(manifest.key, { ...manifest, where })
  }
  /* a module that needs one nobody declares can never be satisfied */
  for (const m of by.values()) for (const r of m.requires) if (!by.has(r.module)) faults.push(`\`${m.key}\` requires \`${r.module}\`, which no manifest declares`)
  const providers = new Map()
  for (const m of by.values()) for (const provider of m.paymentProviders) {
    if (providers.has(provider.id)) faults.push(`payment provider \`${provider.id}\` is declared by two modules: \`${providers.get(provider.id)}\` and \`${m.key}\``)
    else providers.set(provider.id, m.key)
  }

  /*
   * TWO MODULES CLAIMING ONE THING. A route, an admin section or a build step belongs to exactly
   * one module, because that ownership is what switching a module off ACTS on: if two claim the
   * same step, switching either off takes it away and the other module silently loses a piece of
   * itself — which is the very thing modules-off.test.mjs exists to prove cannot happen.
   *
   * It is refused rather than resolved, and both claimants are named, because there is no
   * defensible way to pick: last-one-loaded would make it depend on the order a site's config
   * happens to register things in. Same rule as a landing section registered under a name the
   * theme already has.
   *
   * `env` IS THE EXCEPTION, and it is not a special case so much as a different kind of thing. A
   * route or a step is a piece of the module: switch the module off and it goes. A secret is a
   * piece of the DEPLOYMENT, and several modules can each need the same one — the mail relay is
   * asked for by any of seven, Stripe's keys by any of three — so switching one off takes nothing
   * away while another still needs it. Sharing one is correct there, and refusing it would force
   * a fiction: some single module nominated as the owner of SMTP_HOST while six others quietly
   * depend on it.
   */
  for (const what of EXCLUSIVE) {
    const claimed = new Map()
    for (const m of by.values()) {
      for (const x of m.owns[what] || []) {
        const claim = what === 'cron' && x && typeof x === 'object' ? x.name : x
        if (claimed.has(claim)) faults.push(`the ${what.replace(/s$/, '')} \`${claim}\` is claimed by two modules: \`${claimed.get(claim)}\` and \`${m.key}\` — it belongs to one, or switching either off takes it from the other`)
        else claimed.set(claim, m.key)
      }
    }
  }
  return { modules: by, faults }
}

/* the matrix cell, in the shape modes.mjs has always printed */
export const cellOf = (m, shape) => (m ? m[shape] : undefined)

/* on unless the config says false — the one reading, in one place at last */
export const isOn = (key, modules = {}) => modules[key] !== false

/*
 * WHAT IS LIVE, AND WHAT A LIVE MODULE NEEDS THAT IS NOT. The deploy refuses a configuration where
 * something switched on cannot work because something it needs is switched off, and names both —
 * which is the instrument on the forms module's runner, said once instead of as an `if`.
 */
export function unmetRequirements(modules, config = {}) {
  const out = []
  for (const m of modules.values()) {
    if (!isOn(m.key, config)) continue
    for (const r of m.requires) if (!isOn(r.module, config)) out.push({ module: m.key, needs: r.module, why: r.why || `${m.key} cannot work without ${r.module}` })
  }
  return out
}
import path from 'node:path'
import { PAYMENT_CAPABILITIES, PAYMENT_PROVIDER_WEBHOOK_PATH } from '../../src/payment-provider.mjs'

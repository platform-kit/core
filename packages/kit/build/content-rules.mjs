/*
 * A DECLARATION THAT CONTRADICTS ITSELF IS REFUSED, AND THE BUILD STOPS.
 *
 * velite checks that each field of a record is the right SHAPE. What it cannot check is whether
 * the fields make sense TOGETHER, and that is where the expensive mistakes live. A booking type
 * carrying a cal.com url AND the settings only the site's own scheduler reads is valid by every
 * field and incoherent as a whole: one of the two is a lie, and which one wins is a line of code
 * nobody reading the file would think to look up. That exact file shipped — `scheduler: native`
 * on a session cal.com actually runs — and the consequence was that the weekly limit was counted
 * against a name no booking ever carried, so it was never enforced.
 *
 * WHY IT HAS TO THROW. velite prints a refused record and exits 0; the record is simply dropped
 * and the site is built without it. The deploy runs `npm run build` and no tests at all, so a
 * record that fails its schema ships as an absence and one that contradicts itself ships as a
 * guess. These rules run in velite's `prepare` and THROW, which exits 1, which fails the build,
 * which fails the deploy. That is the whole point: an invalid declaration must not be deployable.
 *
 * A RULE IS A PURE FUNCTION over one compiled record. It returns null when it has nothing to say
 * and a sentence when it does — a sentence written for whoever has to fix the file, naming what
 * is wrong and what to do, never the field's type.
 *
 * A SITE EXTENDS THIS WITHOUT EDITING IT. Its collections module (platformkit.config.js
 * `collections`) may export `rules` of the same shape, which are added,
 * and `rulesOff`, a list of kit rule keys it does not want. A site's own collections are checked
 * by its own rules; a kit rule it switches off says so in one place that shows in a diff.
 */
import validator from 'validator'

/* ---- the small vocabulary the rules are written in ------------------------------------------ */

/* WAS IT DECLARED, or is it the schema's default? By the time velite has compiled a record the
   two are the same value, and a rule that cannot tell them apart cries wolf: `seats: 0` is what
   the schema gives every booking type, and reading it as "this file declares seats" blamed three
   cal.com sessions that declare nothing of the kind. So emptiness is absence here — 0, false, '',
   [] and {} all mean the field was left alone. Every field these rules look at is one where that
   reading is the true one; a rule about a field where 0 means something must say so itself. */
export const has = (v) => v !== undefined && v !== null && v !== '' && v !== 0 && v !== false &&
  !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)
/* the fields of `r` that were actually declared, from a list of names */
export const given = (r, names) => names.filter((n) => has(r[n]))
const list = (xs) => xs.join(', ')

export const is = {
  url: (v) => typeof v === 'string' && validator.isURL(v, { require_protocol: true, protocols: ['http', 'https'] }),
  email: (v) => typeof v === 'string' && validator.isEmail(v),
  hexColour: (v) => typeof v === 'string' && validator.isHexColor(v),
  slug: (v) => typeof v === 'string' && validator.isSlug(v),
  host: (v, h) => { try { return new URL(v).hostname.replace(/^www\./, '') === h } catch { return false } },
}

/* ---- the kit's rules ------------------------------------------------------------------------ */

/* Only the site's own booking system reads these; cal.com owns availability, capacity and the
   recurrence for an event it runs, so a cal.com type carrying one of them is declaring something
   that is never read.
   EVERY FIELD HERE MUST HAVE AN EMPTY DEFAULT, because a compiled record cannot tell a default
   from a declaration. `notice` is not here for exactly that reason: it defaults to 24, so a rule
   reading it blamed several booking records for declaring something none of them mentions.
   content-rules.test.mjs holds the list to that condition, so giving one of these a
   default later fails the suite instead of quietly turning the rule into a liar. */
export const NATIVE_ONLY = ['seats', 'hosts', 'repeats', 'team', 'buffer', 'page']

export const RULES = {
  sessions: [
    {
      key: 'session-one-scheduler',
      why: 'a booking type is run by this site or by cal.com, and the file must say which without contradicting itself',
      test: (r) => {
        const native = r.scheduler === 'native'
        const stray = given(r, NATIVE_ONLY)
        if (r.url && native) return `it carries a cal.com url and \`scheduler: native\`. \`scheduler\` wins, so the url is never used — remove whichever is wrong.`
        if (r.url && stray.length) return `it is run by cal.com (it carries a url) but also declares ${list(stray)}, which only this site's own scheduler reads. cal.com owns those for an event it runs — remove them, or drop the url and set \`scheduler: native\`.`
        if (!r.url && r.scheduler === 'cal') return `it says \`scheduler: cal\` and carries no cal.com url, so there is nothing to book against.`
        return null
      },
    },
    {
      key: 'session-url-is-cal',
      why: 'a booking url is cal.com\'s, and the event slug is read off the end of it',
      test: (r) => {
        if (!r.url) return null
        if (!is.url(r.url)) return `its url is not a url: ${JSON.stringify(r.url)}`
        if (!is.host(r.url, 'cal.com')) return `its url is not a cal.com one (${new URL(r.url).hostname}). The event slug is read off the end of a cal.com address.`
        const slug = r.url.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop()
        if (!slug || !is.slug(slug)) return `no event slug can be read off its url — a cal.com address ends in the event's own name.`
        return null
      },
    },
    {
      key: 'session-hosts-are-accounts',
      why: 'a host is matched to the account they sign in with',
      test: (r) => {
        const bad = (r.hosts || []).filter((h) => !is.email(h))
        return bad.length ? `its hosts must be the addresses they sign in with; ${list(bad.map((b) => JSON.stringify(b)))} is not an address.` : null
      },
    },
  ],

  spaces: [
    {
      key: 'flair-colour-is-a-colour',
      why: 'a badge\'s colour is painted straight into the page',
      test: (r) => {
        const bad = (r.flair || []).filter((f) => has(f.colour) && !is.hexColour(f.colour))
        return bad.length ? `the flair ${list(bad.map((f) => JSON.stringify(f.slug)))} declares a colour that is not one (a hex colour such as #86613c).` : null
      },
    },
  ],

  experiments: [
    {
      key: 'experiment-winner-is-a-variant',
      why: 'a declared winner decides what every visitor sees',
      test: (r) => {
        if (!has(r.winner)) return null
        const keys = (r.variants || []).map((v) => v.key)
        return keys.includes(r.winner) ? null : `its winner is ${JSON.stringify(r.winner)}, which is not one of its variants (${list(keys.map((k) => JSON.stringify(k))) || 'it has none'}).`
      },
    },
  ],

  products: [
    {
      key: 'subscription-has-a-period',
      why: 'a subscription with no period cannot be priced in Stripe',
      test: (r) => (r.billing === 'subscription' && !has(r.period)
        ? `it is sold as a subscription and says no period, so there is no interval to charge on — add \`period: monthly\` or \`weekly\`.` : null),
    },
    {
      key: 'membership-declares-its-tier',
      why: 'every membership price carries its tier, and a rung is marked by rank',
      test: (r) => {
        if (r.kind !== 'membership') return null
        const missing = ['tier', 'rank'].filter((k) => !has(r[k]))
        return missing.length ? `it is a membership and declares no ${list(missing)}, so nothing can tell which plan it is or where it sits.` : null
      },
    },
    {
      key: 'period-belongs-to-a-subscription',
      why: 'a period on a one-off payment is read by nothing',
      test: (r) => (has(r.period) && r.billing !== 'subscription'
        ? `it declares \`period: ${r.period}\` and is not a subscription, so the period is never read — remove it, or set \`billing: subscription\`.` : null),
    },
  ],
}

/* ---- running them --------------------------------------------------------------------------- */

/* every rule of a collection, the kit's and the site's, less the ones the site switched off */
export function rulesFor(collection, { rules = {}, rulesOff = [] } = {}) {
  const off = new Set(rulesOff)
  return [...(RULES[collection] || []), ...(rules[collection] || [])].filter((r) => !off.has(r.key))
}

/* THE WHOLE CHECK. `collections` is velite's compiled set; the answer is every fault, so one run
   names them all rather than making somebody fix them one deploy at a time. */
export function checkContent(collections, site = {}) {
  const faults = []
  const names = new Set([...Object.keys(RULES), ...Object.keys(site.rules || {})])
  for (const name of names) {
    const records = collections[name]
    if (!Array.isArray(records)) continue
    for (const rule of rulesFor(name, site)) {
      for (const r of records) {
        let said = null
        try { said = rule.test(r, { collection: name, records, collections }) } catch (e) { said = `the rule could not be applied: ${e.message}` }
        if (said) faults.push({ collection: name, file: fileOf(r, name), key: rule.key, said })
      }
    }
  }
  return faults
}

/* what to call the file in the complaint: velite keeps the path on most records */
const fileOf = (r, name) => r.path || r.slug || r.key || r.sku || r.title || `(a ${name} record)`

/* the sentence the build stops with */
export function report(faults) {
  const lines = faults.map((f) => `  ${f.file}\n    ${f.said}\n    (${f.key})`)
  return `${faults.length} content declaration${faults.length === 1 ? '' : 's'} contradict${faults.length === 1 ? 's' : ''} itself:\n\n${lines.join('\n\n')}\n\nA record that contradicts itself is not deployable: fix the file, or switch the rule off in the site's collections module (rulesOff).`
}

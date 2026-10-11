/*
 * THE HEADER'S LINKS — the one place that says which they are and who sees each one.
 *
 * Pure: no imports, no environment, the same answer in the browser, in a build script and in a test.
 *
 * THREE LAYERS, MOST SPECIFIC WINS WHOLE.
 *
 *   1. the theme's own, offered by rule — the library, pricing where a page claims that route, the
 *      store while the module is on;
 *   2. a `nav` in the site's config, for a site that ships its header as code;
 *   3. a `nav` in content/site.md, which an administrator edits and a publish carries.
 *
 * Whole, never merged. A merged list has no answer to "remove the third item", which is the thing
 * that prompted this: a page sat in a header for a week because the only place to say otherwise was
 * a file of code. A site writing a nav is saying "this is my header", and the layer below it is what
 * it started from — which is what the editor offers, rather than an empty box.
 *
 * WHO SEES IT is declared here and nowhere else. Three items used to carry their own rule in the
 * template — the bag with the store, the chat for a coach or a member, the community for somebody
 * already in a room — and the third hid a site's whole community from everybody who had not already
 * joined it. A rule about who sees a link belongs where the link is written.
 */

/* the rungs a `see` may name, over the class ladder in supabase/functions/_shared/access.js */
export const SEE = ['guest', 'authenticated', 'paid', 'subscribed', 'staff']
const LADDER = ['guest', 'authenticated', 'paid', 'subscribed']

/* a `see` a site could have written: a rung, a tier, the staff — anything else is nothing */
export const seeOf = (v) => {
  const s = String(v || '').trim()
  if (!s) return null
  if (s.startsWith('tier:')) return s.slice(5) ? s : null
  return SEE.includes(s) ? s : null
}

/*
 * Whether one item is shown, given who is here.
 *
 *   cls      the rung this person stands on (classOf: guest | authenticated | paid | subscribed)
 *   tiers    the membership tiers they hold, highest rank first or in any order
 *   rank     (slug) → the rank of a tier, so a higher tier clears a lower one's bar
 *   staff    an administrator or a support agent
 *
 * A rung is a MINIMUM and monotonic, as `allowedBy` is everywhere else: an item asking for `paid` is
 * also shown to a subscriber. `guest` is the one EXACT state — it is what a "Sign in" item wants, and
 * a minimum would keep it on the page for everybody.
 */
export function seen(item, { cls = 'guest', tiers = [], rank = () => 0, staff = false } = {}) {
  const see = seeOf(item && item.see)
  if (!see) return true
  if (see === 'guest') return cls === 'guest'
  if (see === 'staff') return !!staff
  if (see.startsWith('tier:')) {
    const want = see.slice(5)
    return (tiers || []).some((t) => t === want || rank(t) >= rank(want))
  }
  return LADDER.indexOf(cls) >= LADDER.indexOf(see)
}

/* one item, in the shape the header draws, from whatever a layer wrote */
const item = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  const href = String(raw.href || '').trim()
  const label = raw.label === undefined || raw.label === null ? undefined : String(raw.label)
  const key = raw.key === undefined || raw.key === null ? undefined : String(raw.key)
  if (!href || (!label && !key)) return null   /* an item with nowhere to go, or nothing to say, is not one */
  return {
    key, label, href,
    icon: raw.icon ? String(raw.icon) : undefined,
    prefix: !!raw.prefix,
    see: seeOf(raw.see) || undefined,
    cta: !!raw.cta,
  }
}

/*
 * The list, resolved.
 *
 *   content  what content/site.md says (the administrator's), or nothing
 *   config   what platformkit.config.js says, or nothing
 *   theme    the theme's own, offered by rule
 *   answers  (href) → whether anything answers that path today; an item pointing at a route a
 *            module has switched off is dropped HERE rather than in the template, so that no layer
 *            can leave a dead link and no template has to remember to ask
 *
 * At most one call to action: the first that says so, and the rest become plain links.
 */
export function navLinks({ content, config, theme = [], answers = () => true } = {}) {
  const chosen = (Array.isArray(content) && content.length ? content
    : Array.isArray(config) && config.length ? config
    : theme) || []
  let cta = false
  return chosen.map(item).filter(Boolean).filter((l) => answers(l.href)).map((l) => {
    if (!l.cta) return l
    if (cta) return { ...l, cta: false }
    cta = true
    return l
  })
}

/* which layer the list came from, for the editor to say so rather than face somebody with a blank */
export function navSource({ content, config } = {}) {
  if (Array.isArray(content) && content.length) return 'content'
  if (Array.isArray(config) && config.length) return 'config'
  return 'theme'
}

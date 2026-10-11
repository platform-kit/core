/*
 * WHO TAKES PART IN THE NETWORK — the config's `network.access`, checked and put in the database's
 * words. Two grants, `read` and `write`, each written exactly as a space's `fill` is (a mapping, or a
 * list of alternatives, any of which admits: `tier`, `bought`, `entitlement`, `role`, `booking`, with
 * a window where a space's would take one), and compiled by the same function a space's fill is
 * (buildFill in spaces.mjs), so a tier no membership declares or an offer the site does not sell is
 * refused here rather than admitting nobody in silence. `join` names the offer the join card sells.
 *
 * The rules reach the database as one row of app_settings, `network_access`, written by the data
 * script on every migrate and deploy (accessSql, appended by assemble.mjs); network_admitted() in
 * 93-network.sql reads it. A config that says nothing writes nothing and removes any row a previous
 * config wrote, so taking the grants away opens the network again.
 */
import { buildFill, catalogOf } from './spaces.mjs'
import { catalogFrom } from './spaces-disk.mjs'

export const GRANTS = ['read', 'write']

/* the config's access, compiled; faults are said, never swallowed */
export function accessOf(config, root, { catalog = null } = {}) {
  const raw = (config && config.network && config.network.access) || null
  if (!raw) return { rules: null, join: null, faults: [] }
  const faults = []
  if (typeof raw !== 'object' || Array.isArray(raw)) return { rules: null, join: null, faults: ['network.access must be { read, write, join }'] }
  for (const k of Object.keys(raw)) if (![...GRANTS, 'join', 'plans'].includes(k)) faults.push(`network.access: "${k}" is not one of read, write, join, plans`)
  if (raw.plans != null && !/^\/[^\s]*$/.test(String(raw.plans))) faults.push(`network.access.plans: "${raw.plans}" is an address on this site, like /pricing`)
  let cat
  try { cat = catalogOf(root, catalog || catalogFrom(root)) } catch { cat = catalogOf(root, null) }
  const rules = {}
  for (const g of GRANTS) {
    if (raw[g] == null) continue
    const bad = (m) => faults.push(`network.access.${m}`)
    const built = buildFill(raw[g], {
      bad, where: (i) => (Array.isArray(raw[g]) && raw[g].length > 1 ? `${g}[${i + 1}]` : g),
      keyOf: cat.keyOf, tierOk: (t) => !cat.sells || cat.tiers.has(t), sessionOk: () => true, sells: cat.sells, books: false,
    })
    rules[g] = Array.isArray(built) ? built : [built]
  }
  const join = raw.join ? String(raw.join) : null
  if (join && cat.sells && !cat.keyOf(join)) faults.push(`network.access.join: "${join}" is not an offer this site sells`)
  return { rules: Object.keys(rules).length ? rules : null, join, faults }
}

const literal = (s) => "'" + String(s).replace(/'/g, "''") + "'"

/*
 * WHO ENTERS EACH PLACE OF THE COMMUNITY (openspec: community-access-by-entitlement) — the config's
 * `community.access` (the kit's places that keep rows of their own: events, messages, notifications)
 * and each registered place's `access`, every rule written as a fill is and compiled by the same
 * function. One row of app_settings, `community_access` ({ place: [rule…] }), read by
 * community_admitted(place) in 93-network.sql. Home is not here: it is network.access, above.
 */
export const GATED = ['events', 'messages', 'notifications']
export function communityAccessOf(config, root, { catalog = null } = {}) {
  const m = (config && config.community) || {}
  const wanted = {}
  const faults = []
  if (m.access != null) {
    if (typeof m.access !== 'object' || Array.isArray(m.access)) faults.push('community.access must be { events, messages, notifications }')
    else for (const [k, v] of Object.entries(m.access)) {
      if (!GATED.includes(k)) faults.push(`community.access: "${k}" is not a place a rule can be set on — the choices are ${GATED.join(', ')} (Home is network.access; a registered place carries its own access)`)
      else if (v != null) wanted[k] = v
    }
  }
  for (const p of Array.isArray(m.places) ? m.places : []) if (p && p.access != null) wanted[p.key] = p.access
  if (!Object.keys(wanted).length) return { rules: null, faults }
  let cat
  try { cat = catalogOf(root, catalog || catalogFrom(root)) } catch { cat = catalogOf(root, null) }
  const rules = {}
  for (const [k, raw] of Object.entries(wanted)) {
    const bad = (msg) => faults.push(`community.access.${msg}`)
    const built = buildFill(raw, {
      bad, where: (i) => (Array.isArray(raw) && raw.length > 1 ? `${k}[${i + 1}]` : k),
      keyOf: cat.keyOf, tierOk: (t) => !cat.sells || cat.tiers.has(t), sessionOk: () => true, sells: cat.sells, books: false,
    })
    rules[k] = Array.isArray(built) ? built : [built]
  }
  return { rules, faults }
}

/* the data script's lines: the rows written, or any earlier ones taken away */
export function accessSql(rules, community = null) {
  const lines = ['', '-- WHO TAKES PART IN THE NETWORK (network.access in the config; build/network-access.mjs)',
    "delete from public.app_settings where key = 'network_access';"]
  if (rules) lines.push(`insert into public.app_settings (key, value) values ('network_access', ${literal(JSON.stringify(rules))});`)
  lines.push('-- WHO ENTERS EACH PLACE OF THE COMMUNITY (community.access, places[].access)',
    "delete from public.app_settings where key = 'community_access';")
  if (community) lines.push(`insert into public.app_settings (key, value) values ('community_access', ${literal(JSON.stringify(community))});`)
  return lines.join('\n') + '\n'
}

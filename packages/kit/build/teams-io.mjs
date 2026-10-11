/*
 * A TEAM, as a file — the grammar, shared by the compile, the admin's model and the tests.
 *
 * A team is a group of people the site can point work at: the practice, the front desk, the coaches
 * who take discovery calls. It exists so a booking type can be *the team's* rather than one
 * person's, and so who is in it can change without anything that points at it being edited.
 *
 * The file declares the team. It does NOT name a member: a declaration names classes of people and
 * never a person, so who is in a team is rows (`team_members`) — swept in by the file's `fill`, or
 * invited. The fill grammar is the one a space's membership already uses, read from spaces-io.mjs
 * rather than restated here, because two grammars for "who is this for" is one too many.
 */
import { asStore } from './store/index.mjs'
import matter from 'gray-matter'
import { slugOk } from './spaces-io.mjs'

export const TEAMS_DIR = 'content/teams'

/* a team's file, parsed. Its body is the line a surface shows beside the name. */
export function parseTeam(slug, raw) {
  const f = matter(String(raw || ''))
  const d = f.data || {}
  return {
    slug,
    name: String(d.name || d.title || '').trim(),
    published: d.published !== false,
    /* what a surface says about it where there is room */
    about: String(f.content || '').trim() || null,
    /* who it is for, in the grammar a space's membership uses; absent means invitation only */
    fill: d.fill && typeof d.fill === 'object' ? d.fill : {},
    /* a picture beside its name, an address like every other file the site holds */
    thumb: d.thumb ? String(d.thumb) : null,
    position: Number.isFinite(Number(d.position)) ? Number(d.position) : 99,
  }
}

/* written back in the shape it was read, so a save through the admin cannot bend the file */
export function serialiseTeam(t) {
  const fm = { name: t.name }
  if (t.published === false) fm.published = false
  if (t.thumb) fm.thumb = t.thumb
  if (t.position != null && Number(t.position) !== 99) fm.position = Number(t.position)
  if (t.fill && Object.keys(t.fill).length) fm.fill = t.fill
  return matter.stringify(String(t.about || '').trim() + '\n', fm)
}

export async function readTeams(store) {
  const st = asStore(store)
  /* the store's own listing, as the spaces read theirs: a name, not a path */
  const names = (await st.list(TEAMS_DIR, { ext: 'md' })).filter((n) => !n.includes('/'))
  const out = []
  for (const n of names.sort()) {
    const slug = n.replace(/\.md$/, '')
    out.push(parseTeam(slug, await st.read(`${TEAMS_DIR}/${slug}.md`)))
  }
  return out
}

/*
 * WHO IS SWEPT IN, AS A LIST OF WAYS RATHER THAN A RULE TYPED OUT. The file keeps the fill in the
 * grammar spaces use — a set of conditions, or a list of sets meaning any of them. Nobody types
 * that: the admin offers the ways in as a list to tick, and these two functions carry a team's
 * choice both ways. A rule the admin has no word for (one written by hand, several conditions at
 * once) is left exactly as it was read and shown as its own way, so an editor can never flatten it.
 */
const WAY = {
  'role:provider': { role: ['provider'] },
  'role:coach': { role: ['coach'] },
  'role:support': { role: ['support'] },
  'role:editor': { role: ['editor'] },
  'role:analyst': { role: ['analyst'] },
  'role:admin': { role: ['admin'] },
  'role:staff': { role: ['admin', 'provider', 'coach', 'editor', 'support', 'analyst'] },
  'entitlement:subscribed': { entitlement: 'subscribed' },
}
export const TEAM_WAYS = WAY
/* a role may be written as one word or a list, and both mean the same set — so they are compared
   as the same thing rather than as the text somebody happened to type */
const flat = (s) => { const o = {}; for (const [k, v] of Object.entries(s || {})) o[k] = k === 'role' ? (Array.isArray(v) ? [...v] : [v]).map(String).sort() : v; return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]])) }
const same = (a, b) => flat(a) === flat(b)
/* the file's fill → the keys to tick */
export function fillWays(fill) {
  const sets = Array.isArray(fill) ? fill : fill && Object.keys(fill).length ? [fill] : []
  return sets.map((s) => {
    for (const [k, rule] of Object.entries(WAY)) if (same(rule, s)) return k
    if (s.tier) return 'tier:' + s.tier
    if (s.bought) return 'bought:' + s.bought
    return JSON.stringify(s)   /* a rule with no word keeps itself */
  })
}
/* the keys ticked → the file's fill, in the shape it is read in */
export function waysFill(keys) {
  const sets = (keys || []).map((k) => {
    if (WAY[k]) return WAY[k]
    if (k.startsWith('tier:')) return { tier: k.slice(5) }
    if (k.startsWith('bought:')) return { bought: k.slice(7) }
    try { return JSON.parse(k) } catch { return null }
  }).filter((s) => s && Object.keys(s).length)
  return sets.length > 1 ? sets : sets[0] || {}
}

export { slugOk }

/*
 * THE PROJECTION, as pure database writes — the teams the store holds, made real in the `teams`
 * table, then the sweep.
 *
 * It lives here rather than in teams-push.mjs because BOTH callers need it and only one of them has
 * a machine. On a checkout the script runs it after the compile. In cloud mode there is no machine
 * and `ctx.script()` answers "the deploy runs it" — which is right for anything that renders a book
 * or speaks a chapter, and wrong for this: upserting a few rows needs a database connection, not a
 * disk, and the Edge Function has one. A deployment with git out of the cycle and no deploy hook
 * never rebuilds at all, so deferring this would mean a team saved there was never a team.
 *
 * One way, as a projection is: the files say what exists, this makes the database agree, and the
 * membership rows are never touched beyond the sweep — an invitation is an act and stays.
 */
export async function projectTeams({ teams, db }) {
  const declared = teams || []
  const now = new Date().toISOString()
  for (const t of declared) {
    const { error } = await db.from('teams').upsert({
      slug: t.slug, name: t.name, about: t.about ?? null, thumb: t.thumb ?? null,
      position: t.position ?? 99, published: t.published !== false, fill: t.fill || {}, updated_at: now,
    }, { onConflict: 'slug' })
    if (error) throw new Error(`teams: ${t.slug}: ${error.message}`)
  }
  const keep = declared.map((t) => t.slug)
  const gone = await db.from('teams').delete().not('slug', 'in', `(${keep.map((s) => `"${s}"`).join(',') || '""'})`).select('slug')
  if (gone.error) throw new Error(`teams: the declaration sweep: ${gone.error.message}`)
  if (!Array.isArray(gone.data)) throw new Error('teams: the declaration sweep returned no row list')
  const { data: swept, error: sweepErr } = await db.rpc('team_sync_members')
  if (sweepErr) throw new Error(`teams: the sweep: ${sweepErr.message}`)
  return { teams: declared.length, removed: (gone.data || []).length, swept: Number(swept) || 0 }
}

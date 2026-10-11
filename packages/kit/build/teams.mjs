#!/usr/bin/env node
/*
 * The teams, compiled: content/teams/<slug>.md (build/teams-io.mjs is the grammar) checked and
 * flattened into one record the projection and the browser both read —
 *
 *   .velite/teams.json                          for the site
 *   supabase/functions/_shared/teams.json       for the functions and build/teams-push.mjs
 *
 * The `fill` is compiled by the SAME function a space's is (build/spaces.mjs `buildFill`), so a
 * tier that fills a room and a tier that fills a team are checked against the catalog by one piece
 * of code and refused in one voice. A team's file never names a person; who is in it is rows.
 *
 * Refused: a team with no name, a slug the database would not take, two teams with one slug, a fill
 * whose key is not one of the five, a fill naming a tier no membership declares or a sku the site
 * does not sell, and a team a booking type points at that is not published — a type whose hosts are
 * a team nobody may be in offers nothing, and an empty calendar is the worst way to find out.
 *
 *   node build/teams.mjs            compile
 *   node build/teams.mjs --check    compile, and say what each team is
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeIfChanged } from './write-if-changed.mjs'
import { storeFor } from './store/index.mjs'
import { readTeams, slugOk } from './teams-io.mjs'
import { buildFill, catalogOf } from './spaces.mjs'
import { fillSets } from './spaces-io.mjs'

const ROOT = process.cwd()
export const OUT = 'supabase/functions/_shared/teams.json'
export const SITE_OUT = '.velite/teams.json'

/* the booking types that point at a team, so a type naming one that is gone or unpublished is a
   fault here rather than an empty calendar later */
function typesByTeam(root) {
  let sessions = []
  try { sessions = JSON.parse(readFileSync(join(root, 'supabase/functions/_shared/catalog.json'), 'utf8')).sessions || [] } catch { /* no catalog yet */ }
  const by = new Map()
  for (const s of sessions) if (s.team) (by.get(s.team) || by.set(s.team, []).get(s.team)).push(s.slug)
  return by
}

export async function compileTeams({ check = false, store, write = true } = {}) {
  const st = store || await storeFor(ROOT)
  const root = (st && st.root) || ROOT
  /* the catalog is DATA now (see build/spaces.mjs catalogOf): the machine reads it off the disk,
     and a publish over rows has no file to read and nothing to contradict */
  let catalog = null
  if (st.kind !== 'rows') catalog = (await import('./spaces-disk.mjs')).catalogFrom(root)
  const cat = catalogOf(root, catalog)
  const keyOf = cat.keyOf
  const tierOk = (tier) => !cat.sells || cat.tiers.has(tier)
  const sessionOk = (slug) => !cat.books || cat.sessions.has(slug)
  const errors = []
  const declared = await readTeams(st)
  const out = []
  const seen = new Set()

  for (const t of declared) {
    const at = `content/teams/${t.slug}.md`
    const bad = (m) => errors.push(`${at}: ${m}`)
    if (!slugOk(t.slug)) bad('the name is lower-case words joined by hyphens')
    if (!t.name) bad('a team needs a name')
    if (seen.has(t.slug)) bad('two teams are called this'); else seen.add(t.slug)

    const sets = fillSets(t.fill)
    const fill = buildFill(t.fill, {
      bad, keyOf, tierOk, sessionOk, sells: cat.sells, books: cat.books,
      where: (i) => (sets.length > 1 ? `fill[${i + 1}]` : 'fill'),
    })
    out.push({ slug: t.slug, name: t.name, about: t.about, thumb: t.thumb, position: t.position, published: t.published, fill })
  }

  /* a booking type whose team is not here, or is here and unpublished, offers nobody */
  const byTeam = typesByTeam(root)
  const live = new Set(out.filter((t) => t.published).map((t) => t.slug))
  for (const [team, types] of byTeam) {
    if (live.has(team)) continue
    const known = out.some((t) => t.slug === team)
    errors.push(`content/sessions: ${types.join(', ')} name${types.length === 1 ? 's' : ''} the team "${team}", which is ${known ? 'not published' : 'not a team this site has'}`)
  }

  if (errors.length) {
    for (const e of errors) console.error('  ' + e)
    throw new Error(`teams: ${errors.length} fault(s)`)
  }
  out.sort((a, b) => (a.position - b.position) || a.slug.localeCompare(b.slug))
  const text = JSON.stringify(Object.fromEntries(out.map((t) => [t.slug, t])), null, 2) + '\n'
  if (write) { writeIfChanged(join(root, OUT), text); writeIfChanged(join(root, SITE_OUT), text) }
  if (check) for (const t of out) console.log(`team ${t.slug}: ${t.name}${t.published ? '' : ' (unpublished)'}, ${Object.keys(t.fill || {}).length || Array.isArray(t.fill) ? 'filled by a rule' : 'invitation only'}`)
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await compileTeams({ check: process.argv.includes('--check') })
  console.log(`${OUT} ← ${out.length} team(s); ${SITE_OUT}`)
}

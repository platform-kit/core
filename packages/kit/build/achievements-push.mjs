/*
 * WHAT CAN BE EARNED, AND WHAT AN EVENT MEANS — projected.
 *
 * Two declarations into four tables' worth of rules: `content/achievements/*.md` into
 * `public.achievements`, and `content/traits.md` into `public.trait_rules` and the one setting that
 * says who may look at what the site believes about people.
 *
 * It is a projection and the files own it: a rule no file declares any more is removed. What
 * nobody's file owns — who has earned what, what the site believes about whom — is never touched,
 * because those are acts and a projection has no business rewriting somebody's past.
 *
 * Run by the deploy, by `npm run db:reset`, and by hand while writing a rule.
 */
import { createClient } from '@supabase/supabase-js'
import { asStore } from './store/index.mjs'
import matter from 'gray-matter'

export const DIR = 'content/achievements'
export const TRAITS = 'content/traits.md'

/* the rule as the file writes it, as the table takes it */
const ruleOf = (slug, d) => {
  const w = d.when || {}
  return {
    slug,
    title: String(d.title || ''),
    sub: d.sub ? String(d.sub) : null,
    icon: d.icon ? String(d.icon) : null,
    colour: d.colour ? String(d.colour) : null,
    cover: d.cover ? String(typeof d.cover === 'object' ? d.cover.src || '' : d.cover) : null,
    access: Array.isArray(d.canAccess) ? d.canAccess.map(String) : [],
    event: String(w.event || ''),
    match: w.where && typeof w.where === 'object' ? w.where : {},
    count: Number.isFinite(Number(w.count)) ? Math.max(1, Number(w.count)) : 1,
    distinct_key: w.distinct ? String(w.distinct) : null,
    shown: d.shown !== false,
    position: Number.isFinite(Number(d.order)) ? Number(d.order) : 99,
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/*
 * Given a store and a database this needs nothing else — no environment, no disk — so the admin's
 * Edge Function can run it when somebody publishes. Given neither it falls back to the machine's
 * .env and the checkout, which is what the script and the deploy do.
 */
export async function pushAchievements({ check = false, root = process.cwd(), store = null, quiet = false, db: client = null } = {}) {
  const st = asStore(store || root)
  const said = []
  const say = (m) => { said.push(m); if (!quiet) console.log('  ' + m) }

  /* the files */
  const want = []
  /* the store lists a collection by NAME, without the extension */
  let names = []
  try { names = await st.list(DIR) } catch { /* a site with none */ }
  for (const slug of names) {
    const raw = await st.read(DIR + '/' + slug + '.md')
    if (raw == null) continue
    const d = matter(raw).data || {}
    if (d.published === false) continue
    const r = ruleOf(slug, d)
    if (!r.title || !r.event) { say(`! ${slug}: an achievement needs a title and a when.event`); continue }
    want.push(r)
  }

  /* the traits file */
  let traits = [], visible = ['admin']
  const traw = await st.read(TRAITS)
  if (traw != null) {
    const d = matter(traw).data || {}
    if (Array.isArray(d.visible) && d.visible.length) visible = d.visible.map(String)
    for (const t of d.rules || []) {
      if (!t || !t.id || !t.event || !t.key || !t.value) { say('! a trait rule needs an id, an event, a key and a value'); continue }
      traits.push({ id: String(t.id), event: String(t.event), match: t.where && typeof t.where === 'object' ? t.where : {},
        key: String(t.key), value: String(t.value), position: traits.length })
    }
  }

  /* THE ENVIRONMENT IS ONLY ASKED WHERE NOBODY HANDED A DATABASE IN. In an Edge Function there is
     no .env to read and the caller has the client already; supabaseUrl() opens a file. */
  let db = client
  if (!db) {
    const { supabaseUrl, serviceKey } = await import('./tts/storage.mjs')
    if (!supabaseUrl() || !serviceKey()) {
      if (!quiet) console.log('achievements: no service key — the declaration is not projected')
      return { achievements: want.length, traits: traits.length }
    }
    db = createClient(supabaseUrl(), serviceKey(), { auth: { persistSession: false } })
  }

  /* the achievements */
  const { data: had, error: hadError } = await db.from('achievements').select('*')
  if (hadError) throw new Error(`achievements: could not read existing rows: ${hadError.message}`)
  if (!Array.isArray(had)) throw new Error('achievements: could not read existing rows: expected a row list')
  const byslug = new Map(had.map((x) => [x.slug, x]))
  for (const r of want) {
    const was = byslug.get(r.slug)
    if (!was) { say(`+ achievement ${r.slug}`); if (!check) { const { error } = await db.from('achievements').insert(r); if (error) throw new Error(`achievements: ${r.slug}: ${error.message}`) } }
    else if (!same(r, Object.fromEntries(Object.keys(r).map((k) => [k, was[k]])))) {
      say(`~ achievement ${r.slug}`); if (!check) { const { error } = await db.from('achievements').update(r).eq('slug', r.slug); if (error) throw new Error(`achievements: ${r.slug}: ${error.message}`) }
    }
  }
  const keep = new Set(want.map((r) => r.slug))
  for (const x of had) if (!keep.has(x.slug)) { say(`- achievement ${x.slug} (its file is gone, and it is off everybody who had it)`); if (!check) { const { error } = await db.from('achievements').delete().eq('slug', x.slug); if (error) throw new Error(`achievements: could not remove ${x.slug}: ${error.message}`) } }

  /* the trait rules */
  const { data: hadT, error: hadTError } = await db.from('trait_rules').select('*')
  if (hadTError) throw new Error(`traits: could not read existing rows: ${hadTError.message}`)
  if (!Array.isArray(hadT)) throw new Error('traits: could not read existing rows: expected a row list')
  const byid = new Map(hadT.map((x) => [x.id, x]))
  for (const t of traits) {
    const was = byid.get(t.id)
    if (!was) { say(`+ trait rule ${t.id}`); if (!check) { const { error } = await db.from('trait_rules').insert(t); if (error) throw new Error(`traits: ${t.id}: ${error.message}`) } }
    else if (!same(t, Object.fromEntries(Object.keys(t).map((k) => [k, was[k]])))) { say(`~ trait rule ${t.id}`); if (!check) { const { error } = await db.from('trait_rules').update(t).eq('id', t.id); if (error) throw new Error(`traits: ${t.id}: ${error.message}`) } }
  }
  const keepT = new Set(traits.map((t) => t.id))
  for (const x of hadT) if (!keepT.has(x.id)) { say(`- trait rule ${x.id} (its line is gone)`); if (!check) { const { error } = await db.from('trait_rules').delete().eq('id', x.id); if (error) throw new Error(`traits: could not remove ${x.id}: ${error.message}`) } }

  /* and who may look: a setting, so the policy asks the declaration rather than a role name in SQL */
  if (!check) {
    const { error } = await db.from('app_settings').upsert({ key: 'traits_visible_to', value: JSON.stringify(visible) })
    if (error) throw new Error(`traits: could not update visibility: ${error.message}`)
  }

  if (!quiet) console.log(`achievements: ${want.length} achievement(s), ${traits.length} trait rule(s)${check ? `, ${said.length} change(s) to make` : ''}`)
  return { achievements: want.length, traits: traits.length, said }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check')
  pushAchievements({ check }).catch((e) => { console.error('✖ ' + e.message); process.exit(1) })
}

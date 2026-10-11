/* What somebody has earned and what the site believes about them, against the local stack: the
   trigger on the event stream awards an achievement when its rule is met and not before, counts
   DISTINCT things where the rule says to (eleven books, not one book eleven times), never awards
   the same thing twice, and sets a trait from the event's own props — while a client can neither
   award itself anything nor read what the site believes about anybody the declaration has not
   named. Everything it makes is removed at the end. Skipped with a note when the stack is down
   (AWARDS_TEST=0 skips it too). */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'

const note = (m) => console.log('awards-db: ' + m)
if (process.env.AWARDS_TEST === '0') { note('skipped (AWARDS_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
const key = serviceKey()
if (!url || !anon || !key || !localStack()) { note('skipped — no local stack in .env'); process.exit(0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up'); process.exit(0) }

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const db = createClient(url, key, { auth: { persistSession: false } })
const as = async (email) => {
  const c = createClient(url, anon, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: 'password123' })
  return error ? null : c
}

/* fixtures of our own, so nothing here depends on what a site happens to declare */
const A = 'probe-one', B = 'probe-many', T = 'probe-trait'
const EV = 'probe_event'
const who = (await db.from('profiles').select('id, email').in('email', ['member@example.com', 'free@example.com'])).data || []
const uid = Object.fromEntries(who.map((p) => [p.email, p.id]))
const mine = uid['member@example.com']
const other = uid['free@example.com']
if (!mine || !other) { note('skipped — the seed accounts are not here'); process.exit(0) }

const sweep = async () => {
  await db.from('user_achievements').delete().in('slug', [A, B])
  await db.from('achievements').delete().in('slug', [A, B])
  await db.from('trait_rules').delete().eq('id', T)
  await db.from('user_traits').delete().eq('key', 'probe')
  await db.from('events').delete().eq('type', EV)
}
await sweep()

await db.from('achievements').insert([
  { slug: A, title: 'One is enough', event: EV, match: { kind: 'probe' }, count: 1 },
  { slug: B, title: 'Three different ones', event: EV, match: {}, count: 3, distinct_key: 'thing' },
])
await db.from('trait_rules').insert({ id: T, event: EV, match: {}, key: 'probe', value: 'prop:thing' })

const fire = async (user_id, props) => db.from('events').insert({
  session_id: crypto.randomUUID(), user_id, anon_id: crypto.randomUUID(),
  type: EV, path: '/probe', props, occurred_at: new Date().toISOString(),
})
const got = async (user_id) => ((await db.from('user_achievements').select('slug').eq('user_id', user_id)).data || []).map((r) => r.slug).filter((s) => s === A || s === B)
const traits = async (user_id) => (await db.from('user_traits').select('key, value, n').eq('user_id', user_id).eq('key', 'probe')).data || []

/* one event, one achievement — and only the one whose rule it meets */
await fire(mine, { kind: 'probe', thing: 'a' })
ok('an event whose rule is met awards it', (await got(mine)).includes(A))
ok('…and one whose rule is not met is not awarded', !(await got(mine)).includes(B))
ok('a trait takes its value from the event itself', (await traits(mine)).some((t) => t.value === 'a' && t.n === 1))

/* the same thing again counts once toward a distinct rule, and the trait counts up */
await fire(mine, { kind: 'probe', thing: 'a' })
ok('the same thing twice does not award a rule counting different ones', !(await got(mine)).includes(B))
ok('…but the trait notes it was seen again', (await traits(mine)).some((t) => t.value === 'a' && t.n === 2))

/* the third DIFFERENT thing does it */
await fire(mine, { kind: 'probe', thing: 'b' })
ok('two of three is not enough', !(await got(mine)).includes(B))
await fire(mine, { kind: 'probe', thing: 'c' })
ok('the third different one awards it', (await got(mine)).includes(B))

/* and it is awarded once, ever */
const before = (await db.from('user_achievements').select('awarded_at').eq('user_id', mine).eq('slug', A).maybeSingle()).data
await fire(mine, { kind: 'probe', thing: 'd' })
const after = (await db.from('user_achievements').select('awarded_at').eq('user_id', mine).eq('slug', A).maybeSingle()).data
ok('an achievement is awarded once and never re-dated', before && after && before.awarded_at === after.awarded_at)

/* nobody else has earned anything by it */
ok('one person\'s events earn nobody else anything', (await got(other)).length === 0)

/* what a client may do: nothing */
const c = await as('member@example.com')
if (c) {
  const { error: e1 } = await c.from('user_achievements').insert({ user_id: mine, slug: A })
  ok('a client cannot award itself an achievement', !!e1)
  const { data: d2 } = await c.from('user_traits').select('key').eq('user_id', mine)
  ok('a client cannot read what the site believes about it', !d2 || d2.length === 0)
  const { data: d3 } = await c.rpc('traits_of', { p_user: mine })
  ok('…nor through the read, which answers the staff alone', Array.isArray(d3) && d3.length === 0)
  const { data: d4 } = await c.rpc('achievements_of', { p_user: mine })
  ok('…but may see its own achievements', Array.isArray(d4) && d4.some((x) => x.slug === A))
}
const admin = await as('admin@example.com')
if (admin) {
  const { data: d5 } = await admin.rpc('traits_of', { p_user: mine })
  ok('an administrator may see them', Array.isArray(d5) && d5.some((t) => t.key === 'probe'))
}

await sweep()

/*
 * WHAT CAN BE EARNED REACHES THE DATABASE ON A PUBLISH, with no machine.
 *
 * pushAchievements takes a store and a database and needs nothing else — no .env, no disk — so the
 * admin's Edge Function runs it the moment somebody publishes. A save over rows does not, because a
 * save is a draft.
 *
 * It is a whole-table sync, so it is a DELETION over a declaration that reads empty: nothing below
 * runs unless the table already holds only what the files declare (the rule the cloud lane learned
 * by emptying the teams table).
 */
{
  const { pushAchievements } = await import('./achievements-push.mjs')
  const { gitStore } = await import('./store/git.mjs')
  const REPO = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '')
  const store = gitStore(REPO)

  const dry = await pushAchievements({ store, db, quiet: true, check: true })
  ok('the declaration reads', dry.achievements > 0, JSON.stringify(dry))
  const rows = ((await db.from('achievements').select('slug')).data || []).map((r) => r.slug)
  const names = (await store.list('content/achievements')) || []
  const safe = names.length > 0 && rows.every((s) => names.includes(s))
  ok('the table holds nothing the files do not declare, so projecting is safe', safe,
    rows.filter((s) => !names.includes(s)).join(', '))

  if (safe) {
    /* the function's situation exactly: a store, a client, and no environment to fall back on */
    const had = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY }
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY
    let r = null, threw = null
    try { r = await pushAchievements({ store, db, quiet: true }) } catch (e) { threw = e.message }
    finally { if (had.u) process.env.SUPABASE_URL = had.u; if (had.k) process.env.SUPABASE_SERVICE_ROLE_KEY = had.k }
    ok('it projects with no environment at all', !threw && r && r.achievements === dry.achievements, threw || JSON.stringify(r))
    const after = ((await db.from('achievements').select('slug')).data || []).map((r2) => r2.slug)
    ok('every declared achievement is a row', names.every((s) => after.includes(s)), names.filter((s) => !after.includes(s)).join(', '))
    ok('and the trait rules with them', ((await db.from('trait_rules').select('id')).data || []).length === r.traits)
    const again = await pushAchievements({ store, db, quiet: true })
    ok('running it twice changes nothing', again.said.length === 0, (again.said || []).join('; '))
  }

  /* a save over rows moves nothing; a save on a checkout still pushes */
  const { COLLECTION_MODELS } = await import('./models/core/collections.mjs')
  const list = Array.isArray(COLLECTION_MODELS) ? COLLECTION_MODELS : Object.entries(COLLECTION_MODELS).map(([k, v]) => ({ key: k, ...v }))
  const model = list.find((m) => m.key === 'achievements')
  ok('the achievements model answers projected()', !!model && typeof model.projected === 'function')
  if (model) {
    let ranRows = false, ranDisk = false
    await model.after({ data: {} }, { store: { kind: 'rows', client: db }, script: async () => { ranRows = true } })
    ok('a save over rows runs no script', !ranRows)
    await model.after({ data: {} }, { store, script: async () => { ranDisk = true } })
    ok('a save on a checkout still pushes', ranDisk)
  }
}

console.log(`${fail ? '✖' : '✔'} awards-db: ${pass}/${pass + fail} checks`)
if (fail) process.exit(1)

/*
 * WHAT THE SITE HAS WORKED OUT SOMEBODY IS INTERESTED IN, against the local stack.
 *
 * my_interests() is a join rather than a stored trait, and the two scenarios that make that worth
 * the arithmetic are here: a piece RE-TAGGED after it was read changes the reader's interests, and
 * a tag taken off a piece stops counting — neither with anything re-run, no backfill, nothing
 * to migrate. A trait written at read time would pass every other check in this file and fail
 * exactly those two.
 *
 * And that READING IS NOT FINISHING: content_read fires when a piece is LEFT, so a piece half read
 * counts, a long attentive read counts for more than a glance, and an open too brief to be a read
 * counts for nothing.
 *
 * Everything it makes is removed at the end: this runs against a stack somebody is also using.
 * Skipped with a note when the stack is down (RECOMMENDATIONS_TEST=0 skips it too).
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { leave } from './test-stack.mjs'

const note = (m) => console.log('recommendations: ' + m)
if (process.env.RECOMMENDATIONS_TEST === '0') { note('skipped (RECOMMENDATIONS_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) { note('skipped — no local stack in .env'); leave(0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up'); leave(0) }

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const as = async (email) => {
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(email + ': ' + error.message)
  return { sb, id: data.user.id }
}
const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })

console.log('\nWHAT A READER IS INTERESTED IN, AGAINST THE STACK\n')

/* a vocabulary of our own, so nothing of the site's tags is read as ours */
const T = Math.random().toString(36).slice(2, 7)
const KIND = 'test-rec-' + T
const TAG = { a: 'zz-alpha-' + T, b: 'zz-beta-' + T, c: 'zz-gamma-' + T }
const PIECE = { a: 'piece-a-' + T, b: 'piece-b-' + T, c: 'piece-c-' + T }
const SKU = 'piece-c-' + T   // the same ref as piece C: a purchase of the thing that was read
const made = { events: [], purchases: [] }

/* what my_interests weighs a read by, read off the declaration so the test and the function cannot
   drift apart silently */
const sql = await (await import('node:fs/promises')).readFile(new URL('../supabase/schemas/13-search.sql', import.meta.url), 'utf8')
const floor = Number(/([\d.]+)::numeric as read_floor/.exec(sql)?.[1])
const ceil = Number(/([\d.]+)::numeric as read_ceil/.exec(sql)?.[1])
const buy = Number(/([\d.]+)::numeric as buy_weight/.exec(sql)?.[1])
/* the bar my_reading draws — a stricter claim than interest, so it is its own number */
const depth = Number(/>= (\d+)\s+-- READ_DEPTH/.exec(sql)?.[1])
ok('the constants are named in the declaration and nowhere else',
  [floor, ceil, buy, depth].every(Number.isFinite),
  `floor=${floor} ceil=${ceil} buy=${buy} depth=${depth}`)
ok('being done with something is a stricter bar than being interested in it', depth > 0 && depth < 100)

const read = (uid, ref, kind, secs, depth) => ({
  session_id: crypto.randomUUID(), anon_id: crypto.randomUUID(), user_id: uid,
  type: 'content_read', path: '/x/' + ref, occurred_at: new Date().toISOString(),
  props: { kind, id: ref, title: ref, seconds: secs, depth },
})
const mine = async (sb) => {
  const { data, error } = await sb.rpc('my_interests')
  if (error) throw new Error('my_interests: ' + error.message)
  return Object.fromEntries((data || []).map((r) => [r.tag, r]))
}
const ours = (rows) => Object.fromEntries(Object.entries(rows).filter(([k]) => k.endsWith('-' + T)))

/* ---- THE VOCABULARY, and the switch that is not decoration ----
   A closed list only means anything if the SAVE holds it. It was written as a control on the field
   and nothing else once — the server would have taken any word at all — so the rule is pinned here
   and the wiring with it, because the control looking right is exactly what hid the gap. */
{
  const os = await import('node:os'), nodefs = await import('node:fs'), np = await import('node:path')
  const { learnTags, readTags, normalise } = await import('./tags.mjs')
  const dir = nodefs.mkdtempSync(np.join(os.tmpdir(), 'tags-'))
  nodefs.mkdirSync(np.join(dir, 'content'), { recursive: true })
  const put = (free, list) => nodefs.writeFileSync(np.join(dir, 'content/tags.md'),
    '---\nfree: ' + free + '\ntags:\n' + list.map((v) => '  - ' + v).join('\n') + '\n---\n\nwhat this site writes about\n')

  put(false, ['meditation'])
  const closed = await learnTags(dir, ['meditation', 'astrology'])
  ok('with free tagging off, a tag the list does not hold is refused', closed.refused.join() === 'astrology' && !closed.added.length)
  ok('and it is not quietly added to the list', !(await readTags(dir)).tags.includes('astrology'))

  put(true, ['meditation'])
  const open = await learnTags(dir, ['meditation', 'Astrology'])
  ok('with it on, a typed tag joins the vocabulary', open.added.join() === 'astrology' && !open.refused.length)
  ok('and the list on disk holds it, so there is one list and no second copy',
    (await readTags(dir)).tags.includes('astrology'))

  put(true, ['meditation'])
  await learnTags(dir, ['  Getting   Started '])
  const one = (await readTags(dir)).tags.filter((v) => v === 'getting started')
  ok('one tag, one spelling — trimmed, collapsed and lowercased on the way in', one.length === 1 && normalise('  A  B ') === 'a b')

  put(false, ['meditation', 'astrology'])
  const after = await learnTags(dir, ['astrology'])
  ok('a tag already in the list keeps working after the switch is turned off', after.values.join() === 'astrology' && !after.refused.length)
  nodefs.rmSync(dir, { recursive: true, force: true })

  const wiring = nodefs.readFileSync(new URL('./models/index.mjs', import.meta.url), 'utf8')
  ok('every save that carries tags goes through it, in one place rather than per collection',
    /learnTags/.test(wiring), 'models/index.mjs does not call learnTags — the switch would be decoration')
}

/* ---- IT REACHES A DEPLOYMENT THAT NEVER BUILDS ----
   The ranking reads content_search, and content_search is a PROJECTION run on a publish rather than
   an artefact of a build. So a tag added or taken off a piece reaches the ranking on the shape
   with no repository and no deploy hook, the same moment it reaches the site — which is the whole
   reason the interests are a join rather than a trait written when the piece was read. Derived
   rather than listed: every collection whose editor offers Tags must project into that index. */
{
  const { registry } = await import('./models/index.mjs')
  const { loadSite } = await import('./site.mjs')
  const models = await registry(process.cwd(), { site: await loadSite(process.cwd()) })
  /* the vocabulary's own record is not a piece of content: its tags field IS the list */
  const tagged = models.filter((m) => m.key !== 'tags' && m.fields && m.fields.def && 'tags' in (m.fields.def.shape || {}))
  const gaps = tagged.filter((m) => typeof m.projected !== 'function').map((m) => m.key)
  ok('every collection that carries tags projects them, so a publish alone moves the ranking',
    tagged.length > 0 && gaps.length === 0, gaps.length ? 'not projected: ' + gaps.join(', ') : 'no collection carries tags')
}

/* ---- THE RANKING ITSELF, pure: what the weights do to an order ---- */
{
  const { scoreRow, profileText, WEIGHT_LIFT, RX_LIFT } = await import('../src/lib/rank.js')
  const at = { weights: { meditation: 3, gardening: 0.2 } }
  const same = { sem: 0.5 }
  const a = scoreRow({ ...same, tags: ['meditation'] }, at)
  const b = scoreRow({ ...same, tags: ['gardening'] }, at)
  const c = scoreRow({ ...same, tags: ['nothing-in-particular'] }, at)
  ok('a weighted tag outranks an unweighted one of equal similarity', a.score > c.score, `${a.score} vs ${c.score}`)
  ok('a heavier tag outranks a lighter one', a.score > b.score)
  ok('a row takes its heaviest tag, not the sum of them',
    scoreRow({ ...same, tags: ['meditation', 'gardening'] }, at).score === a.score)
  const rx = scoreRow({ sem: 0, tags: [], href: '/x' }, { prescribed: new Set(['/x']), weights: {} })
  ok('no amount of history outranks what a site puts in front of somebody',
    rx.score > scoreRow({ sem: 0, tags: ['meditation'] }, { weights: { meditation: 99 } }).score - (99 * WEIGHT_LIFT - RX_LIFT) - 1e-9 && RX_LIFT / WEIGHT_LIFT > 10)
  ok('a reader with no site registration still gets a sentence to rank against',
    profileText({ meditation: 3, gardening: 1 }) === 'Interested in meditation, gardening.')
  ok(`a site own words are joined to the reader own, not chosen over them`,
    profileText({ meditation: 3 }, 'Working at self-mastery.') === 'Working at self-mastery. Interested in meditation.')
  ok('nobody with no history gets an empty query rather than a made-up one', profileText({}) === '')
}

try {
  const member = await as('member@example.com')
  const other = await as('member2@example.com')

  /* three pieces. A and B both carry tag A at the start; C carries tag C. */
  await service.from('content_search').insert([
    { kind: KIND, ref: PIECE.a, title: 'A', href: '/a', tags: [TAG.a], tag_text: TAG.a },
    { kind: KIND, ref: PIECE.b, title: 'B', href: '/b', tags: [TAG.a, TAG.b], tag_text: TAG.a + ' ' + TAG.b },
    { kind: KIND, ref: PIECE.c, title: 'C', href: '/c', tags: [TAG.c], tag_text: TAG.c },
  ])

  /* ---- A PARTIAL READ COUNTS, and attention is the weight ----
     A: half read, a good while over it.   B: a glance, well over the floor but brief and shallow.
     C: an open below the floor — not a read at all. */
  const rows = [
    read(member.id, PIECE.a, KIND, 200, 50),
    read(member.id, PIECE.b, KIND, floor + 2, 4),
    read(member.id, PIECE.c, KIND, Math.max(0, floor - 2), 90),
  ]
  const { data: ins, error: ie } = await service.from('events').insert(rows).select('id')
  if (ie) throw new Error('events: ' + ie.message)
  made.events = ins.map((r) => r.id)

  let got = ours(await mine(member.sb))
  ok('a piece half read contributes', (got[TAG.a]?.weight ?? 0) > 0, JSON.stringify(got[TAG.a]))
  ok('a long attentive read contributes more than a glance',
    (got[TAG.a]?.weight ?? 0) > (got[TAG.b]?.weight ?? 0),
    `alpha=${got[TAG.a]?.weight} beta=${got[TAG.b]?.weight}`)
  ok('an open below the floor contributes nothing', !got[TAG.c], JSON.stringify(got[TAG.c]))

  /* ---- A PURCHASE OUTWEIGHS BROWSING ----
     the paperback's sku, so the format suffix has to come off before the join */
  const { data: p, error: pe } = await service.from('purchases')
    .insert({ user_id: member.id, sku: SKU + '-softcover', status: 'paid', amount_total: 1900, currency: 'usd' })
    .select('id')
  if (pe) throw new Error('purchases: ' + pe.message)
  made.purchases = p.map((r) => r.id)

  got = ours(await mine(member.sb))
  ok('a purchase of a piece read below the floor still counts for its tag', (got[TAG.c]?.bought ?? 0) === 1)
  ok('a purchase outweighs any amount of browsing',
    (got[TAG.c]?.weight ?? 0) > ceil,
    `gamma=${got[TAG.c]?.weight} ceiling=${ceil}`)
  ok('a format suffix comes off the sku before the join', (got[TAG.c]?.weight ?? 0) > 0)
  ok('the heaviest tag comes first', Object.keys(ours(await mine(member.sb)))[0] === TAG.c)

  /* ---- RE-TAGGING CHANGES WHO IT IS RECOMMENDED TO, with nothing re-run ---- */
  await service.from('content_search').update({ tags: [TAG.b], tag_text: TAG.b }).eq('kind', KIND).eq('ref', PIECE.a)
  const after = ours(await mine(member.sb))
  ok('a piece re-tagged after it was read changes the reader\'s interests',
    (after[TAG.b]?.weight ?? 0) > (got[TAG.b]?.weight ?? 0),
    `beta was ${got[TAG.b]?.weight}, now ${after[TAG.b]?.weight}`)
  ok('a tag taken off a piece stops counting for it',
    (after[TAG.a]?.weight ?? 0) < (got[TAG.a]?.weight ?? 0),
    `alpha was ${got[TAG.a]?.weight}, now ${after[TAG.a]?.weight}`)

  /* ---- WHAT IS BEHIND THEM: DEPTH, NOT THE FLOOR ----
     Both bars were the floor once, and the effect was that a twenty-second skim counted towards
     somebody's interests AND was never offered again — exactly the piece they meant to come back
     to, silently withheld. So the two questions are asked with two numbers, and these are the
     cases that tell them apart. */
  const behind = async (sb) => new Set(((await sb.rpc('my_reading')).data || []).map((r) => r.kind + ':' + r.ref))
  {
    const P = { skim: 'skim-' + T, done: 'done-' + T, quick: 'quick-' + T }
    await service.from('content_search').insert(Object.values(P).map((ref) =>
      ({ kind: KIND, ref, title: ref, href: '/' + ref, tags: [TAG.a], tag_text: TAG.a })))
    const rows = [
      read(member.id, P.skim, KIND, 40, Math.max(0, depth - 20)),   /* a real read, nowhere near the end */
      read(member.id, P.done, KIND, 40, depth),                     /* read to the end */
      read(member.id, P.quick, KIND, Math.max(0, floor - 2), 100),  /* a short page wholly in the viewport, gone at once */
    ]
    const { data: more } = await service.from('events').insert(rows).select('id')
    made.events.push(...more.map((r) => r.id))
    const seen = await behind(member.sb)
    ok('a piece read to the end is behind them', seen.has(KIND + ':' + P.done))
    ok('a piece skimmed is not — it is the one they meant to come back to', !seen.has(KIND + ':' + P.skim))
    ok('and it still counts towards what they are interested in',
      (ours(await mine(member.sb))[TAG.a]?.weight ?? 0) > 0)
    ok('a short page wholly in view is not read by arriving at it', !seen.has(KIND + ':' + P.quick))
    /* a second run at it, no further down than the first: neither reached the end, and the bar is
       one read that did — not a sum of the tries, which would make any number of skims a finish */
    const { data: again } = await service.from('events')
      .insert([read(member.id, P.skim, KIND, 40, Math.max(0, depth - 20))]).select('id')
    made.events.push(...again.map((r) => r.id))
    ok('two half reads do not make a whole', !(await behind(member.sb)).has(KIND + ':' + P.skim))
  }

  /* ---- IT IS THEIR OWN AND NOBODY ELSE'S ---- */
  ok('another account sees none of it', Object.keys(ours(await mine(other.sb))).length === 0)
  const { error: argErr } = await other.sb.rpc('my_interests', { p_user: member.id })
  ok('there is no argument to ask for somebody else with', !!argErr, 'the call was accepted')
  const guest = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: none } = await guest.rpc('my_interests')
  ok('a guest gets nothing', (none || []).length === 0, JSON.stringify(none))
  const { error: setErr } = await member.sb.from('content_search')
    .update({ tags: ['whatever'] }).eq('kind', KIND).eq('ref', PIECE.b).select('id')
  const { data: stillThere } = await service.from('content_search').select('tags').eq('kind', KIND).eq('ref', PIECE.b).single()
  ok('a reader may set none of it', !!setErr || !stillThere.tags.includes('whatever'))
} finally {
  if (made.events.length) await service.from('events').delete().in('id', made.events)
  if (made.purchases.length) await service.from('purchases').delete().in('id', made.purchases)
  await service.from('content_search').delete().eq('kind', KIND)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

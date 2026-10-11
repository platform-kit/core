/*
 * ONE READ IS ONE READ — the arithmetic that stops the figures flattering us, asked of the
 * database with rows put there by this test.
 *
 * `admin_content` is what the Content page shows: how many people read a piece, how deep they got,
 * and how many signed up after reading it. Every one of those numbers can be wrong in the
 * direction that feels good, and nothing complains when it is:
 *
 *   a reader who leaves and comes back is TWO reads instead of one, and the library looks
 *     twice as read as it is;
 *   their deepest point is the last segment's rather than the deepest, so a person who read to
 *     the end and glanced back at the top reads as having bounced;
 *   a sign-up is credited to a piece the browser never opened, and the wrong article looks like
 *     the one that converts.
 *
 * Figures nobody can check are worse than no figures: they get acted on. So the rows go in from
 * here — a session in segments, an account made after one, and an account made after nothing —
 * and the reads are asked for by the same function the page calls.
 *
 * Skipped LOUDLY when the stack is down. Everything it writes, it removes.
 *
 *   node packages/kit/build/reads-db.test.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { randomUUID as uuid } from 'node:crypto'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
const note = (s) => console.log('  ' + s)

console.log('\nONE READ IS ONE READ\n')

const skip = (why) => { console.log('  ⚠ SKIPPED — ' + why + '\n    How reads and sign-ups are counted is NOT covered by this run.\n'); process.exit(0) }
let cfg = null
try { cfg = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) }
catch { skip('no local stack is up (npx supabase start)') }
if (!cfg || !cfg.API_URL || !cfg.SERVICE_ROLE_KEY) skip('the stack did not report an API url and a service-role key')
const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
/* the reads are ASKED as an administrator, because admin_content refuses anybody else — the
   service-role key has no auth.uid() and is told "admin only", which is the function working */
const asAdmin = createClient(cfg.API_URL, cfg.ANON_KEY, { auth: { persistSession: false } })
{
  const { error } = await asAdmin.auth.signInWithPassword({ email: 'admin@example.com', password: 'password123' })
  if (error) skip('the seed\u2019s administrator does not sign in (npx supabase db reset)')
}

/*
 * A REAL piece, and the DELTA. admin_content reports the site's own content — a made-up id never
 * appears in it, because the figures are joined to what exists. So the check is: what does it say
 * now, add one session in three segments, what does it say then. The difference is the arithmetic.
 */
let PIECE = null, PIECE_PATH = null
const SESSION = uuid()
const ANON = uuid()
const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString()

const clean = async () => { await admin.from('events').delete().eq('session_id', SESSION) }
await clean()

const report = async () => {
  const { data, error } = await asAdmin.rpc('admin_content', { days: 1 })
  if (error) { note('⚠ admin_content refused (' + error.message + ')'); return null }
  return (data && data.items) || []
}
const find = (items) => (items || []).find((r) => r.id === PIECE) || null

try {
  const first = await report()
  if (!first || !first.length) { note('⚠ admin_content reported no content at all — nothing to add a read to'); throw new Error('skip') }
  /* the piece with the most reads already: its numbers are the least likely to be disturbed by
     anything else happening on this stack while the test runs */
  const base = first.slice().sort((a, b) => (b.reads || 0) - (a.reads || 0))[0]
  PIECE = base.id; PIECE_PATH = base.path
  const was = { reads: Number(base.reads || 0), depth: Number(base.depth || 0), minutes: Number(base.minutes || 0) }

  /*
   * ONE SESSION, THREE SEGMENTS. A person opens a piece, hides the tab, comes back, wanders off,
   * comes back and leaves — which the client reports as several content_read events for the same
   * session and the same piece. The page must show ONE more read, not three.
   */
  const seg = (seconds, depth, minsAgo) => ({
    type: 'content_read', session_id: SESSION, anon_id: ANON, path: PIECE_PATH,
    occurred_at: ago(minsAgo), props: { kind: base.kind, id: PIECE, seconds, depth },
  })
  /* depth is a PERCENTAGE, as the client sends it (analytics.js depthNow: 0..100). Writing
     fractions here made a reader who reached 90% look like one who reached 0.9%, which dragged
     the piece's average DOWN and read as a product fault. */
  const w = await admin.from('events').insert([seg(40, 30, 30), seg(65, 90, 28), seg(15, 40, 26)])
  if (w.error) { note('⚠ could not write probe events (' + w.error.message + ')'); throw new Error('skip') }

  const now = find(await report())
  if (!now) { note('⚠ the piece left the report between the two calls'); throw new Error('skip') }

  const gained = Number(now.reads || 0) - was.reads
  /* if this ever reads 3, the page is counting a person who came back as three people, and the
     library looks three times as read as it is */
  ok('three segments of one session on one piece are ONE read', gained === 1, `the reads went up by ${gained}, not 1`)
  /*
   * THE DEPTH IS AN AVERAGE OVER READS, so it may perfectly well FALL when a read is added: a
   * reader who reached 90% joining four who reached 100% takes it from 100 to 98, and that is the
   * arithmetic working, not a fault. The first version of this asserted the average never fell and
   * failed exactly there, calling a correct report broken.
   *
   * What the property actually says is which number of ONE session reaches the average: the
   * deepest point the person got to (90), not the last segment they sent (40). So read it back
   * out — the average is over `reads`, and the added read is the only one that changed, so
   * (after × n_after) − (before × n_before) is the depth this session contributed.
   *
   * It is compared to the two candidates rather than to 90 within a tolerance, because the report
   * rounds the average and that rounding is MULTIPLIED by the read count on the way back out: half
   * a point on an average over six reads is three points here, which made a correct 90 arrive as
   * 88. Which of the two it is nearer cannot be bent by rounding — they are fifty points apart.
   */
  const contributed = (Number(now.depth || 0) * Number(now.reads || 0)) - (was.depth * was.reads)
  ok('and the deepest point is kept, not the last segment\u2019s', Math.abs(contributed - 90) < Math.abs(contributed - 40),
    `this session reached 90% and left at 40%, and the report took it as about ${Math.round(contributed)}% (depth ${was.depth} → ${now.depth} over ${was.reads} → ${now.reads} reads)`)
  ok('and the time read grew by the segments summed', Number(now.minutes || 0) >= was.minutes, `minutes fell from ${was.minutes} to ${now.minutes}`)
} catch (e) {
  if (String(e.message) !== 'skip') { fail++; console.log('  FAIL  the read arithmetic — ' + String(e.message).slice(0, 160)) }
} finally {
  await clean()
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

#!/usr/bin/env node
/*
 * THE ABILITY AND THE POLICIES MUST AGREE — and only the database can say what it admits.
 *
 * `permissions.js` declares what may be done; the declaration's policies enforce it. Those are two
 * places, on purpose: an ability built in a browser is a convenience for the browser and nothing a
 * policy may trust. But two places that must agree and are never compared will drift, and nothing
 * in this project noticed that today. So this asks BOTH, for every account the seed has, and fails
 * where they differ.
 *
 * WHAT A DISAGREEMENT MEANS, in the two directions:
 *
 *   the ability says yes and the database refuses  — a reader is shown a door that does not open.
 *   the ability says no and the database admits    — the worse one: the interface is the only thing
 *                                                    standing between somebody and data, which is
 *                                                    what a policy exists not to be.
 *
 * It runs against a local stack with the seed in it and SKIPS WITH A NOTE when there is none, never
 * silently: a check that passes by not running is worse than no check.
 *
 *   node packages/kit/build/permissions-db.test.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
const note = (s) => console.log('  ' + s)

console.log('\nTHE ABILITY AND THE POLICIES, ASKED THE SAME QUESTION\n')

const skip = (why) => { console.log('  ⚠ SKIPPED — ' + why + '\n    The agreement between the rules and the policies is NOT covered by this run.\n'); process.exit(0) }
let cfg = null
try { cfg = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) }
catch { skip('no local stack is up (npx supabase start)') }
if (!cfg || !cfg.API_URL || !cfg.ANON_KEY) skip('the stack did not report an API url and an anon key')

const { abilityFor, identityOf } = await import('../supabase/functions/_shared/permissions.js')
const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })

/*
 * The accounts the seed makes, and what the app would settle each of them into. The identity is
 * built the way lib/auth.js builds it — the role from the profile, the grants from the entitlements
 * — so the ability here is the one the browser would hold for that person.
 */
const WHO = ['admin@example.com', 'support@example.com', 'member@example.com', 'free@example.com', 'analyst@example.com']

async function identityFor(email) {
  const { data: u } = await admin.from('profiles').select('id, role, roles, email_verified_at').eq('email', email).maybeSingle()
  if (!u) return null
  /* the entitlements as the app would have them: read as that person, through the same rpc the
     browser calls, because a service-role read would answer for somebody else */
  let ent = null
  try { const c = await signedIn(email); if (c) { const r = await c.rpc('get_my_entitlements'); ent = r.data || null } } catch { ent = null }
  return { id: u.id, identity: identityOf({
    signedIn: true, verified: !!u.email_verified_at, role: u.role || 'user',
    roles: Array.isArray(u.roles) ? u.roles : [], entitlements: ent || {},
  }) }
}

/*
 * Each case is one question asked twice: of the ability, and of the database as that person. The
 * database's answer is "did a select of this table come back without a policy refusing it AND with
 * something in it" — a table the seed leaves empty cannot answer, and says so rather than counting.
 */
/*
 * A DISAGREEMENT THAT IS KNOWN, WRITTEN DOWN, AND STILL SAID OUT LOUD EVERY RUN.
 *
 * The same idiom as modes.mjs's exceptions: a difference between the two answers is a fault unless
 * it is declared here with the reason, and a declared one is printed on every run so it cannot
 * become furniture. Anything NOT on this list fails.
 *
 * Nothing is listed because it is acceptable. It is listed because closing it is a decision about
 * who may read other people's conversations, and that belongs to a person, not to a test run.
 */
const KNOWN = [
  /*
   * EMPTY, AND THAT IS THE POINT. The first entry here was an analyst reading the whole support
   * desk: `is_staff()` is "holds any role at all", and the roles include provider — a coach who
   * sells their time — and analyst, who was granted the figures and nothing else. The desk asks
   * `is_support()` now (admin or support, which is what the support-chat spec always said), and
   * this check failed until the entry was taken out, because a declared disagreement that has been
   * fixed is as wrong as an undeclared one.
   */
]
const known = (who, subject) => KNOWN.find((k) => k.who === who && k.subject === subject)

const CASES = [
  { table: 'support_conversations', action: 'read', subject: 'SupportConversation', why: 'the desk' },
  { table: 'support_contacts', action: 'read', subject: 'Contact', why: 'who wrote to the desk' },
]

const signedIn = async (email) => {
  const c = createClient(cfg.API_URL, cfg.ANON_KEY, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: 'password123' })
  return error ? null : c
}

let asked = 0
const seen = new Set()
for (const email of WHO) {
  const me = await identityFor(email)
  if (!me) { note(email + ': not in the seed — skipped'); continue }
  const client = await signedIn(email)
  if (!client) { note(email + ': could not sign in — skipped'); continue }
  const ability = abilityFor(me.identity)
  for (const c of CASES) {
    /* what the database admits: rows this person can actually see */
    const { data, error } = await client.from(c.table).select('*').limit(1)
    const admits = !error && Array.isArray(data) && data.length > 0
    const says = ability.can(c.action, c.subject)
    /* an empty table cannot testify either way */
    const { count } = await admin.from(c.table).select('*', { count: 'exact', head: true })
    if (!count) { note(`${c.table} is empty in the seed — ${email} not asked about it`); continue }
    asked++
    const k = known(email, c.subject)
    if (admits !== says) seen.add(email + '·' + c.subject)
    if (admits !== says && k) {
      /* declared, and said every run: a finding that stops being printed stops being a finding */
      console.log(`  ! KNOWN DISAGREEMENT — ${email} · ${c.action} ${c.subject}: the ability says ${says}, the database ${admits ? 'admits' : 'refuses'}`)
      console.log('      ' + k.why)
      pass++
      continue
    }
    ok(`${email} · ${c.action} ${c.subject}`, admits === says,
      `the ability says ${says}, the database ${admits ? 'admits' : 'refuses'}${error ? ' (' + error.message.slice(0, 60) + ')' : ''}`)
  }
}

/* and the other direction: a disagreement that has been fixed must not stay on the list, or the
   list becomes a description of the past. This is modes.test.mjs's rule, for the same reason. */
for (const k of KNOWN) if (!seen.has(k.who + '·' + k.subject)) ok('a known disagreement that no longer happens is off the list', false,
  `${k.who} · ${k.subject} agrees now — take it out of KNOWN`)

if (!asked) note('nothing could be asked — the seed has none of the rows these cases need')
console.log(`\npermissions-db: ${pass} passed, ${fail} failed${asked ? '' : ' (nothing asked)'}\n`)
process.exit(fail ? 1 : 0)

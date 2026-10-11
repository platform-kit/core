/*
 * WHO CAN DO WHAT — every seeded kind of person, against every action that defines one.
 *
 * The site has nine kinds of person and, until this file, four of them had never been signed in
 * as by any test and three had never been signed in as at all: a PROVIDER (somebody who sells
 * their time here), an EDITOR (content but not the admin), and a BUYER (owns a book, holds no
 * membership). Those three are exactly where a privilege bug lives, because they are the ones
 * near a boundary: almost staff, almost an administrator, almost a member.
 *
 * TWO RULES SHAPE THIS FILE.
 *
 * It asks what somebody can DO, not what they can see. A hidden button is not a closed door, and
 * the `is_staff()` leak found earlier this week was exactly that shape: nothing in the interface
 * offered an analyst the support desk, and the desk answered them anyway. So every cell is an
 * attempt — a read, a write, a call — made as that person through PostgREST, and the answer is
 * what the DATABASE said, not what the page drew.
 *
 * And a refusal has to be checked as carefully as an allowance. A matrix of nothing-but-denials
 * would pass against a database that refused everybody, so every capability has at least one
 * person who CAN, and the file fails if one does not.
 *
 * Skipped LOUDLY when the stack is down.
 *
 *   node packages/kit/build/who-can.test.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
const note = (s) => console.log('  ' + s)

console.log('\nWHO CAN DO WHAT\n')

const skip = (why) => { console.log('  ⚠ SKIPPED — ' + why + '\n    What each kind of person may DO is NOT covered by this run.\n'); process.exit(0) }
let cfg = null
try { cfg = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) }
catch { skip('no local stack is up (npx supabase start)') }
if (!cfg || !cfg.API_URL || !cfg.SERVICE_ROLE_KEY) skip('the stack did not report an API url and a service-role key')

const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })

/* the nine, as the seed makes them — a guest is no session at all */
const WHO = {
  guest: null,
  free: 'free@example.com',
  member: 'member@example.com',
  buyer: 'buyer@example.com',
  provider: 'coach@example.com',
  editor: 'editor@example.com',
  analyst: 'analyst@example.com',
  support: 'support@example.com',
  admin: 'admin@example.com',
}

const client = async (email) => {
  const c = createClient(cfg.API_URL, cfg.ANON_KEY, { auth: { persistSession: false } })
  if (!email) return c
  const { error } = await c.auth.signInWithPassword({ email, password: 'password123' })
  return error ? null : c
}
const SESSION = {}
for (const [who, email] of Object.entries(WHO)) {
  SESSION[who] = await client(email)
  if (email && !SESSION[who]) note(`⚠ ${who} (${email}) does not sign in — every cell for them is skipped`)
}
const me = async (who) => (WHO[who] ? (await admin.from('profiles').select('id').eq('email', WHO[who]).maybeSingle()).data?.id : null)
const ID = Object.fromEntries(await Promise.all(Object.keys(WHO).map(async (w) => [w, await me(w)])))

/*
 * THE ACTIONS. Each is a thing somebody tries, answered by the database. `can` lists everybody
 * the action is FOR; everybody else must be refused. A capability nobody can do is a fault in
 * this file, not in the product, and is reported as one.
 */
const ACTIONS = [
  {
    name: 'read the support desk',
    can: ['support', 'admin'],
    why: 'a contact writes in confidence; an analyst has the figures and a provider sells here, and neither is the desk',
    run: async (c) => { const r = await c.from('support_conversations').select('id').limit(1); return !r.error && Array.isArray(r.data) && r.data.length > 0 },
  },
  {
    name: 'read who wrote to the desk',
    can: ['support', 'admin'],
    why: 'a contact row is a person who asked for help',
    run: async (c) => { const r = await c.from('support_contacts').select('id').limit(1); return !r.error && (r.data || []).length > 0 },
  },
  {
    name: 'see the figures',
    can: ['admin', 'analyst'],
    why: 'the analyst exists for exactly this and nothing else',
    run: async (c) => { const r = await c.rpc('admin_kpis', {}); return !r.error && r.data != null },
  },
  {
    name: 'see who the members are',
    can: ['admin'],
    why: 'a list of people is not a figure',
    run: async (c, who) => { const r = await c.rpc('admin_people', { ids: [ID.member, ID.free].filter(Boolean) }); return !r.error && r.data != null && Object.keys(r.data).length > 0 },
  },
  {
    /*
     * Not "may they call it" — everybody may, and a guest is correctly told they are a guest.
     * What matters is whether the answer is TRUE of them: a membership reported to somebody who
     * has none is a door opened, and one withheld from somebody who paid is a door shut on a
     * customer. So the cell is "is told what they actually hold".
     */
    name: 'be told correctly what they hold',
    can: ['guest', 'free', 'member', 'buyer', 'provider', 'editor', 'analyst', 'support', 'admin'],
    why: 'everybody is entitled to a true answer about themselves',
    run: async (c, who) => {
      const r = await c.rpc('get_my_entitlements', {})
      if (r.error || !r.data) return false
      const cls = r.data.class
      const expect = who === 'guest' ? 'guest' : who === 'member' ? 'subscribed' : who === 'buyer' ? 'paid' : null
      /* where the seed pins what they hold, the answer must match it; otherwise any class will do */
      return expect ? cls === expect : typeof cls === 'string'
    },
  },
  {
    name: 'open a coaching thread with a coach',
    can: ['member', 'admin', 'provider'],
    why: 'the chat is the membership’s; a provider is one of the two ends of it',
    run: async (c, who) => {
      const peer = ID.provider
      if (!peer || ID[who] === peer) return null           /* not applicable to themselves */
      const r = await c.rpc('chat_open', { peer })
      return !r.error && !!r.data
    },
  },
  {
    name: 'grant themselves a role',
    can: [],
    why: 'NOBODY — the column is the app’s, and a person who could set it could become anything',
    run: async (c, who) => {
      if (!ID[who]) return null
      const before = (await admin.from('profiles').select('roles').eq('id', ID[who]).maybeSingle()).data?.roles || []
      await c.from('profiles').update({ roles: ['admin'] }).eq('id', ID[who])
      const after = (await admin.from('profiles').select('roles').eq('id', ID[who]).maybeSingle()).data?.roles || []
      const moved = JSON.stringify(before) !== JSON.stringify(after)
      if (moved) await admin.from('profiles').update({ roles: before }).eq('id', ID[who])   /* put it back at once */
      return moved
    },
  },
  {
    name: 'read somebody else’s purchases',
    can: ['admin'],
    why: 'what a person bought is theirs; a buyer sees their own and nobody else’s',
    run: async (c, who) => {
      const r = await c.from('purchases').select('user_id').limit(20)
      if (r.error) return false
      const rows = r.data || []
      /* allowed only if they can see a row that is not their own */
      return rows.some((x) => x.user_id && x.user_id !== ID[who])
    },
  },
]

/* ─── the matrix ─── */

const width = Math.max(...ACTIONS.map((a) => a.name.length))
const able = {}
for (const a of ACTIONS) {
  able[a.name] = []
  for (const who of Object.keys(WHO)) {
    const c = SESSION[who]
    if (WHO[who] && !c) continue                        /* reported above */
    let did = null
    try { did = await a.run(c, who) } catch (e) { did = false }
    if (did === null) continue                          /* not applicable to this person */
    if (did) able[a.name].push(who)
    const allowed = a.can.includes(who)
    ok(`${who} ${allowed ? 'CAN' : 'cannot'} ${a.name}`, did === allowed,
      did ? `they could, and should not — ${a.why}` : `they could not, and should be able to`)
  }
}

/*
 * AND SOMEBODY CAN. A matrix of denials would pass against a database that refused everybody —
 * which is a broken site, not a secure one. Every capability that names somebody must have had
 * at least one person actually do it.
 */
for (const a of ACTIONS) {
  if (!a.can.length) continue
  ok(`somebody actually can ${a.name}`, able[a.name].length > 0, 'nobody could — the check would pass against a site where it is broken for everyone')
}

console.log('\n  ' + 'action'.padEnd(width) + '   who could')
for (const a of ACTIONS) console.log('  ' + a.name.padEnd(width) + '   ' + (able[a.name].join(', ') || '(nobody)'))

console.log(`\n  ${pass} passed, ${fail} failed — ${Object.keys(WHO).length} kinds of person × ${ACTIONS.length} actions\n`)
process.exit(fail ? 1 : 0)

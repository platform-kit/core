#!/usr/bin/env node
/*
 * ONE PLACE PERMISSIONS ARE DECIDED — and it must answer exactly as the four places did.
 *
 * The class ladder, the role booleans, the ranked tiers and a space's capabilities each answered
 * "may this person do this" separately, and this brings them under one ability. The danger in that
 * is obvious: a rewrite of every access decision in a product that sells access. So the first thing
 * pinned here is PARITY — for every shape of account the seed has, the ability's answer equals what
 * access.js answers today, question for question. A difference is a bug, not a decision.
 *
 * Then the seam: a site's rules run after the kit's, so a site may add, narrow or revoke.
 *
 *   node packages/kit/build/permissions.test.mjs
 */
import assert from 'node:assert/strict'

let pass = 0, fail = 0
const ok = async (name, fn) => { try { await fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + String(e && e.message || e).split('\n').slice(0, 3).join('\n    ')) } }

console.log('\nWHAT MAY BE DONE, IN ONE PLACE\n')

const P = await import('../supabase/functions/_shared/permissions.js')
const A = await import('../supabase/functions/_shared/access.js')
const { abilityFor, identityOf, entrySubject } = P

/* every shape of account this product has, as the seed has them */
const PEOPLE = {
  guest: { signedIn: false },
  reader: { signedIn: true, verified: true, entitlements: {} },
  unverified: { signedIn: true, verified: false, entitlements: {} },
  paid: { signedIn: true, verified: true, entitlements: { class: 'paid', products: ['the-kybalion'] } },
  member: { signedIn: true, verified: true, entitlements: { class: 'subscribed', tiers: ['tier-2'] } },
  member3: { signedIn: true, verified: true, entitlements: { class: 'subscribed', tiers: ['tier-2', 'tier-3'] } },
  admin: { signedIn: true, verified: true, role: 'admin', entitlements: { class: 'subscribed' } },
  support: { signedIn: true, verified: true, role: 'support', entitlements: {} },
  editor: { signedIn: true, verified: true, roles: ['editor'], entitlements: {} },
  analyst: { signedIn: true, verified: true, roles: ['analyst'], entitlements: {} },
}

/* the entries a reader meets: open, members-only, and a book someone bought outright */
const ENTRIES = [
  { kind: 'articles', slug: 'open', canAccess: [] },
  { kind: 'articles', slug: 'signed-in', canAccess: ['authenticated'] },
  { kind: 'articles', slug: 'paid-only', canAccess: ['paid'] },
  { kind: 'articles', slug: 'members', canAccess: ['subscribed'] },
  { kind: 'books', slug: 'the-kybalion', canAccess: ['paid'] },
]

await ok('the ability reads an entry exactly as the ladder does, for every account', () => {
  for (const [who, raw] of Object.entries(PEOPLE)) {
    const me = identityOf(raw)
    const ability = abilityFor(me)
    for (const entry of ENTRIES) {
      /* what the product does today */
      const before = A.mayReadEntry(entry, raw.entitlements || {}, !!raw.signedIn)
      /* what it would do through the ability */
      const after = ability.can('read', entrySubject(entry, me))
      assert.equal(after, before, `${who} reading ${entry.slug}: the ladder says ${before}, the ability says ${after}`)
    }
  }
})

await ok('an administrator may do anything, and nobody else may', () => {
  assert.ok(abilityFor(identityOf(PEOPLE.admin)).can('manage', 'all'))
  for (const who of ['guest', 'reader', 'paid', 'member', 'support', 'editor', 'analyst']) {
    assert.ok(!abilityFor(identityOf(PEOPLE[who])).can('manage', 'all'), who + ' may not manage everything')
  }
})

await ok('the desk is the desk, and not the admin', () => {
  const desk = abilityFor(identityOf(PEOPLE.support))
  assert.ok(desk.can('answer', 'SupportConversation'))
  assert.ok(!desk.can('read', 'Figures'), 'a support agent is not an analyst')
  assert.ok(!desk.can('edit', 'Content'), 'nor an editor')
  const reader = abilityFor(identityOf(PEOPLE.reader))
  assert.ok(!reader.can('answer', 'SupportConversation'))
})

await ok("each granular grant is its own, as each was its own ref", () => {
  assert.ok(abilityFor(identityOf(PEOPLE.editor)).can('edit', 'Content'))
  assert.ok(!abilityFor(identityOf(PEOPLE.editor)).can('read', 'Figures'))
  assert.ok(abilityFor(identityOf(PEOPLE.analyst)).can('read', 'Figures'))
  assert.ok(!abilityFor(identityOf(PEOPLE.analyst)).can('edit', 'Content'))
})

await ok('the results wait for a confirmed address', () => {
  assert.ok(!abilityFor(identityOf(PEOPLE.unverified)).can('read', 'Results'), 'unconfirmed: no')
  assert.ok(abilityFor(identityOf(PEOPLE.reader)).can('read', 'Results'), 'confirmed: yes')
  assert.ok(!abilityFor(identityOf(PEOPLE.guest)).can('read', 'Results'), 'signed out: no')
})

await ok("a session's gate is admits()'s own answer, every shape of it", async () => {
  /*
   * The rule already existed and says more than a tier check. This does not re-implement it: the
   * subject carries its verdict. So what is pinned is that the two never disagree — across every
   * shape of \`requires\`, the \`below\` cap, and every identity — because a gate whose two sides
   * disagree is not a gate. The first draft of the ability DID re-implement it, and got \`guest\`,
   * \`authenticated\` and the list form wrong.
   */
  const { admits } = await import('../supabase/functions/_shared/sessions/admits.js')
  const { sessionSubject } = P
  const RANKS = { 'tier-1': 1, 'tier-2': 2, 'tier-3': 3 }
  const TYPES = [
    { slug: 'free-call', requires: 'anyone' },
    { slug: 'newcomer', requires: 'guest' },
    { slug: 'reader-only', requires: 'authenticated' },
    { slug: 'members', requires: 'tier-2' },
    { slug: 'top', requires: 'tier-3' },
    { slug: 'exactly', requires: ['tier-1', 'tier-3'] },
    { slug: 'capped', requires: 'anyone', below: 'tier-2' },
  ]
  const WHO = {
    guest: { signedIn: false },
    reader: { signedIn: true, entitlements: {} },
    one: { signedIn: true, entitlements: { class: 'subscribed', tiers: ['tier-1'] } },
    two: { signedIn: true, entitlements: { class: 'subscribed', tiers: ['tier-2'] } },
    three: { signedIn: true, entitlements: { class: 'subscribed', tiers: ['tier-3'] } },
  }
  let checked = 0
  for (const [who, raw] of Object.entries(WHO)) {
    const me = identityOf(raw)
    const ability = abilityFor(me)
    for (const type of TYPES) {
      const theirs = admits(type, { tiers: me.tiers, signed: me.signedIn, ranks: RANKS })
      const mine = ability.can('book', sessionSubject(type, me, RANKS))
      assert.equal(mine, theirs, `${who} booking ${type.slug}: admits says ${theirs}, the ability says ${mine}`)
      checked++
    }
  }
  assert.ok(checked === 35, 'every identity against every shape: ' + checked)
})
await ok('a space capability is the database\'s answer, never a second opinion', () => {
  const { channelSubject, mayInChannel } = P
  const me = abilityFor(identityOf(PEOPLE.reader))
  assert.ok(me.can('do', channelSubject({ id: 'c1' }, { moderate: true })))
  assert.ok(mayInChannel({ moderate: true }, 'moderate'))
  assert.ok(!mayInChannel({ moderate: true }, 'invite'), 'what was not granted is not held')
  assert.ok(!mayInChannel(null, 'moderate'), 'told nothing, nothing is permitted')
})

await ok('a site adds a rule, narrows one, and revokes one', () => {
  const me = identityOf(PEOPLE.reader)
  /* adds */
  const added = abilityFor(me, (identity, { can }) => can('enter', 'Lounge'))
  assert.ok(added.can('enter', 'Lounge'))
  assert.ok(!abilityFor(me).can('enter', 'Lounge'), 'and only where the site said so')
  /* revokes — the common case: everything the kit allows, except this */
  const revoked = abilityFor(me, (identity, { cannot }) => cannot('read', 'Results'))
  assert.ok(!revoked.can('read', 'Results'), "a site's cannot beats the kit's can")
  assert.ok(abilityFor(me).can('read', 'Results'), 'and the kit alone still allows it')
  /* narrows — an entry the kit would have admitted */
  const narrowed = abilityFor(me, (identity, { cannot }) => cannot('read', 'Entry', { kind: 'articles' }))
  assert.ok(!narrowed.can('read', entrySubject(ENTRIES[0], me)), 'narrowed by a condition')
  assert.ok(narrowed.can('read', { __caslSubjectType__: 'Entry', kind: 'wiki', bar: 'guest' }), 'and only there')
})

await ok('the rules are pure: no environment, no session, no request', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../supabase/functions/_shared/permissions.js', import.meta.url), 'utf8')
  assert.ok(!/process\.env|import\.meta\.env/.test(src), 'no environment')
  assert.ok(!/from '(node:|@supabase)/.test(src), 'no node and no client: it runs in a browser and in Deno too')
  assert.match(src, /from '@casl\/ability'/)
})

await ok("a caller's own verdict wins over the subject's default", () => {
  /*
   * The functions' judge knows one thing `admits()` does not: a tier whose listing names a type
   * admits it whatever the type's rules say. So the subject takes a verdict, and computing one
   * here instead would drop that difference silently — which is how two sides of a gate stop
   * agreeing.
   */
  const { sessionSubject } = P
  const me = identityOf({ signedIn: true, entitlements: { tiers: [] } })
  const type = { slug: 'members', requires: 'tier-2' }
  const RANKS = { 'tier-2': 2 }
  assert.equal(sessionSubject(type, me, RANKS).admitted, false, 'admits() alone would refuse them')
  assert.equal(sessionSubject(type, me, RANKS, true).admitted, true, 'the caller says otherwise and is believed')
  assert.equal(sessionSubject(type, me, RANKS, false).admitted, false, 'and a refusal passed in is kept')
  assert.ok(abilityFor(me).can('book', sessionSubject(type, me, RANKS, true)), 'the ability follows the verdict it was given')
  assert.ok(!abilityFor(me).can('book', sessionSubject(type, me, RANKS, false)))
})

console.log(`\npermissions: ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

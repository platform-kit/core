/*
 * EVERY COHERENCE RULE, AND THE CASE IT EXISTS TO CATCH.
 *
 * A rule that never fires is worse than no rule: it reads as cover and gives none. So each one
 * here is given a record it must refuse AND a record it must accept, and a rule with no failing
 * fixture fails this file by name — adding a rule without proving it bites is not possible.
 *
 * It also holds the real content to the rules, so the suite says what the build would say, and
 * holds NATIVE_ONLY to the condition the rule depends on: every field in it must read as absent
 * on a record that declares none, because a compiled record cannot tell a default from a
 * declaration and a field that gains one would turn the rule into a liar (`notice` did).
 */
import fs from 'node:fs'
import path from 'node:path'
import { RULES, NATIVE_ONLY, given, checkContent, rulesFor, report } from './content-rules.mjs'

console.log('\nA DECLARATION THAT CONTRADICTS ITSELF\n')
let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n          ' + detail : '')) } }

/* ---- a refused record and an accepted one, per rule ----------------------------------------- */

/* { rule key: [ a record it must refuse, a record it must accept ] } */
const FIXTURES = {
  'session-one-scheduler': [
    [{ slug: 'x', scheduler: 'native', url: 'https://cal.com/me/a-call' },
     { slug: 'x', url: 'https://cal.com/me/a-call', seats: 12 },
     { slug: 'x', scheduler: 'cal' }],
    [{ slug: 'x', url: 'https://cal.com/me/a-call' },
     { slug: 'x', scheduler: 'native', seats: 12, hosts: ['a@b.com'] },
     { slug: 'x', seats: 0, hosts: [], buffer: 0 }],
  ],
  'session-url-is-cal': [
    [{ slug: 'x', url: 'not a url' },
     { slug: 'x', url: 'https://calendly.com/me/a-call' },
     { slug: 'x', url: 'https://cal.com/' }],
    [{ slug: 'x', url: 'https://cal.com/me/a-call' },
     { slug: 'x', url: 'https://cal.com/me/a-call?overlayCalendar=true' },
     { slug: 'x' }],
  ],
  'session-hosts-are-accounts': [
    [{ slug: 'x', hosts: ['not-an-address'] }],
    [{ slug: 'x', hosts: ['coach@example.com'] }, { slug: 'x' }],
  ],
  'flair-colour-is-a-colour': [
    [{ slug: 'x', flair: [{ slug: 'f', colour: 'brown' }] }],
    [{ slug: 'x', flair: [{ slug: 'f', colour: '#86613c' }] }, { slug: 'x', flair: [{ slug: 'f' }] }, { slug: 'x' }],
  ],
  'experiment-winner-is-a-variant': [
    [{ slug: 'x', winner: 'c', variants: [{ key: 'a' }, { key: 'b' }] }, { slug: 'x', winner: 'a', variants: [] }],
    [{ slug: 'x', winner: 'a', variants: [{ key: 'a' }, { key: 'b' }] }, { slug: 'x', variants: [{ key: 'a' }] }],
  ],
  'subscription-has-a-period': [
    [{ sku: 'x', billing: 'subscription' }],
    [{ sku: 'x', billing: 'subscription', period: 'monthly' }, { sku: 'x', billing: 'once' }],
  ],
  'membership-declares-its-tier': [
    [{ sku: 'x', kind: 'membership' }, { sku: 'x', kind: 'membership', tier: 't' }],
    [{ sku: 'x', kind: 'membership', tier: 't', rank: 2 }, { sku: 'x', kind: 'book' }],
  ],
  'period-belongs-to-a-subscription': [
    [{ sku: 'x', period: 'monthly', billing: 'once' }],
    [{ sku: 'x', period: 'monthly', billing: 'subscription' }, { sku: 'x', billing: 'once' }],
  ],
}

const all = Object.entries(RULES).flatMap(([c, rs]) => rs.map((r) => ({ ...r, collection: c })))
ok('there are rules to check', all.length > 0, all.length + ' rule(s)')

for (const rule of all) {
  const f = FIXTURES[rule.key]
  if (!f) { ok(`${rule.key} has fixtures`, false, 'a rule with no fixture is a rule nobody has shown to bite — add one to FIXTURES'); continue }
  const [refuse, accept] = f
  for (const r of refuse) {
    const said = rule.test(r, {})
    ok(`${rule.key} refuses ${JSON.stringify(r).slice(0, 72)}`, !!said, said ? '' : 'it said nothing')
  }
  for (const r of accept) {
    const said = rule.test(r, {})
    ok(`${rule.key} accepts ${JSON.stringify(r).slice(0, 72)}`, !said, said || '')
  }
}

/* every rule's complaint is a sentence somebody can act on, not a field name */
for (const rule of all) {
  const said = (FIXTURES[rule.key] || [[]])[0].map((r) => rule.test(r, {})).find(Boolean)
  if (!said) continue
  ok(`${rule.key} speaks in sentences`, /\s/.test(said.trim()) && said.length > 20 && !/^[a-z_]+$/.test(said.trim()), JSON.stringify(said))
  ok(`${rule.key} says why it exists`, typeof rule.why === 'string' && rule.why.length > 20, rule.why)
}

/* ---- the site's seam ------------------------------------------------------------------------ */
{
  const site = { rules: { sessions: [{ key: 'site-own', why: 'the site cares about this', test: (r) => (r.slug === 'nope' ? 'the site refuses this one' : null) }] } }
  const got = checkContent({ sessions: [{ slug: 'nope' }] }, site)
  ok('a site adds a rule of its own', got.length === 1 && got[0].key === 'site-own', JSON.stringify(got))

  const off = checkContent({ sessions: [{ slug: 'x', scheduler: 'native', url: 'https://cal.com/me/a' }] }, { rulesOff: ['session-one-scheduler'] })
  ok('a site switches a kit rule off by key', off.length === 0, JSON.stringify(off))
  const on = checkContent({ sessions: [{ slug: 'x', scheduler: 'native', url: 'https://cal.com/me/a' }] }, {})
  ok('and with it on, the same record is refused', on.length === 1)

  ok('a rule that throws is reported, not swallowed',
    checkContent({ sessions: [{ slug: 'x' }] }, { rules: { sessions: [{ key: 'boom', why: 'x', test: () => { throw new Error('bang') } }] } })[0].said.includes('bang'))

  ok('a collection the content does not have is skipped', checkContent({}, {}).length === 0)
  ok('the report names the file and the rule', report([{ file: 'f.md', key: 'k', said: 's' }]).includes('f.md') && report([{ file: 'f.md', key: 'k', said: 's' }]).includes('(k)'))
}

/* ---- the condition the session rule rests on ------------------------------------------------- */
{
  const p = path.join(process.cwd(), '.velite', 'sessions.json')
  if (!fs.existsSync(p)) { console.log('  (no .velite/sessions.json — the defaults check needs a content build)') }
  else {
    const rows = JSON.parse(fs.readFileSync(p, 'utf8'))
    /* a cal.com session declares none of the native-only fields, so every one of them must read
       as absent on it. If a field gains a non-empty default this fails, which is the point. */
    const cal = rows.filter((r) => r.url && r.scheduler !== 'native')
    if (cal.length) {
      for (const r of cal) {
        const stray = given(r, NATIVE_ONLY)
        ok(`every native-only field reads as absent on ${r.slug}`, stray.length === 0,
          stray.length ? `${stray.join(', ')} has a non-empty default, so the rule cannot tell it from a declaration — drop it from NATIVE_ONLY (as \`notice\` was) or teach the rule its default` : '')
      }
    } else {
      console.log('  (no cal.com session in this site — the compiled-record check is not applicable)')
    }
  }
}

/* ---- and the real content -------------------------------------------------------------------- */
{
  const dir = path.join(process.cwd(), '.velite')
  if (!fs.existsSync(dir)) console.log('  (no .velite — the content check needs a build)')
  else {
    const collections = {}
    for (const name of Object.keys(RULES)) {
      const f = path.join(dir, name + '.json')
      if (fs.existsSync(f)) collections[name] = JSON.parse(fs.readFileSync(f, 'utf8'))
    }
    const faults = checkContent(collections, {})
    ok(`this site's content keeps every rule (${Object.values(collections).reduce((n, x) => n + (Array.isArray(x) ? x.length : 0), 0)} records)`,
      faults.length === 0, faults.length ? '\n' + report(faults) : '')
  }
}

console.log(`\ncontent-rules: ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

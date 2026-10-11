/*
 * WHAT A PROPOSAL PROMISES MUST REACH A REQUIREMENT.
 *
 * This exists because of a measured failure. The proposal for `the-store-sells-anything` carried
 * one bullet — "What Stripe already does, offered: a trial, a coupon, a tax registration, a payment
 * method beyond cards, an adjustable quantity" — which James had asked for by name. It named five
 * things. The change's spec deltas required ONE of them, its tasks named none, and four Stripe
 * features were therefore never built. Nothing noticed: `openspec validate --all --strict` passed,
 * `npm test` passed, the change archived cleanly. The proposal is the only artifact nothing ever
 * compares with anything, so a promise that never became a requirement is held by nothing at all.
 *
 * THE CHECK DOES NOT READ PROSE, ON PURPOSE. The first design was to match what "What changes"
 * promises against the requirements — which cannot be done without guessing, and a check that
 * cries wolf is one somebody switches off. So the proposal DECLARES the trace in a table, one row
 * per promise naming the requirement it lands in, and this asks three questions that interpret
 * nothing:
 *
 *   1. every requirement the table names exists in that change's deltas, spelled exactly;
 *   2. every requirement in the deltas is claimed by a row (one nobody promised is either
 *      unasked-for work or a missing row);
 *   3. every capability the table names has a delta file, and every delta file has a row.
 *
 * Deferring stays cheap: a promise deliberately out of scope goes in Non-goals, which the table
 * does not cover and this does not read.
 */
import fs from 'node:fs'
import path from 'node:path'

let pass = 0, fail = 0
const ok = (m, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m + (d ? ' — ' + d : '')) } }
console.log('\nA PROPOSAL PROMISES NOTHING IT DOES NOT REQUIRE\n')

/* ---------- the pure reader, so the fixture and the real changes go through one path ---------- */

export const TRACE_HEAD = 'Where it is required'

/* the table: rows of `| promise | capability — Requirement name |`. Returns [{ promise, capability,
   requirement }]. A row whose second cell has no em-dash separator is reported rather than guessed
   at, because a row nobody can read is the same hole this check exists to close. */
export function traceRows(proposal) {
  const lines = String(proposal || '').split('\n')
  const start = lines.findIndex((l) => l.includes(TRACE_HEAD) && l.trim().startsWith('|'))
  if (start < 0) return null
  const out = []
  for (const line of lines.slice(start + 1)) {
    const t = line.trim()
    if (!t.startsWith('|')) break
    if (/^\|[\s|:-]+\|$/.test(t)) continue           /* the --- separator */
    const cells = t.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 2 || !cells[0] || !cells[1]) continue
    const m = cells[1].match(/^([a-z0-9-]+)\s+[—–-]\s+(.+)$/)
    out.push(m
      ? { promise: cells[0], capability: m[1], requirement: m[2].trim() }
      : { promise: cells[0], capability: null, requirement: null, raw: cells[1] })
  }
  return out
}

/* TYPOGRAPHY IS NOT A MISMATCH. A curly apostrophe against a straight one is invisible in a diff
   and would fail "spelled exactly" for no reason anybody could see — and a check that fails on
   something invisible is one somebody switches off. Normalising quotes and whitespace is
   deterministic, so it is not the prose-guessing this check refuses to do. */
const norm = (s) => String(s || '')
  .replace(/[\u2018\u2019\u02bc]/g, "'")
  .replace(/[\u201c\u201d]/g, '"')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\s+/g, ' ')
  .trim()

/* every `### Requirement: X` in a delta, by capability */
export function deltaRequirements(files) {
  const by = {}
  for (const [capability, text] of Object.entries(files)) {
    by[capability] = String(text || '').split('\n')
      .filter((l) => l.startsWith('### Requirement:'))
      .map((l) => l.replace('### Requirement:', '').trim())
  }
  return by
}

/* the three questions. Returns { missing, unclaimed, capabilities, malformed } — all empty is clean. */
export function trace({ proposal, deltas }) {
  const rows = traceRows(proposal)
  if (rows === null) return { noTable: true, missing: [], unclaimed: [], capabilities: [], malformed: [] }
  const have = deltaRequirements(deltas)
  const malformed = rows.filter((r) => !r.requirement).map((r) => r.raw || r.promise)

  /* 1. a promise naming a requirement no delta carries */
  const missing = rows.filter((r) => r.requirement)
    .filter((r) => !(have[r.capability] || []).some((h) => norm(h) === norm(r.requirement)))
    .map((r) => `${r.capability} — ${r.requirement}  (promised: ${r.promise})`)

  /* 2. a requirement nobody promised */
  const claimed = new Set(rows.filter((r) => r.requirement).map((r) => r.capability + '\u0000' + norm(r.requirement)))
  const unclaimed = []
  for (const [capability, reqs] of Object.entries(have)) {
    for (const r of reqs) if (!claimed.has(capability + '\u0000' + norm(r))) unclaimed.push(`${capability} — ${r}`)
  }

  /* 3. a capability on one side only */
  const named = new Set(rows.filter((r) => r.capability).map((r) => r.capability))
  const capabilities = [
    ...[...named].filter((c) => !(c in deltas)).map((c) => `${c}: named in the table, no delta file`),
    ...Object.keys(deltas).filter((c) => !named.has(c)).map((c) => `${c}: a delta file, no row in the table`),
  ]
  return { noTable: false, missing, unclaimed, capabilities, malformed }
}

/* ---------- THE FIXTURE: the real failure's shape, so the guard is proved to catch it ---------- */
/*
 * An archived proposal has no trace table, so this cannot be run backwards over
 * the-store-sells-anything to re-derive its bullet. This is that bullet's SHAPE: five things
 * promised, one required. The guard must name the other four.
 */
{
  const proposal = `# Proposal

## What changes

- **What Stripe already does, offered**: a trial, a coupon, a tax registration, a payment method
  beyond cards, an adjustable quantity — mostly a parameter the store does not pass today.

## The trace

| What this change promises | ${TRACE_HEAD} |
| --- | --- |
| A free trial before a subscription is charged | store-pricing — An offer may carry a trial |
| A coupon the buyer enters at checkout | store-pricing — A promotion is a record with a budget |
| A tax registration collected from the buyer | store-pricing — An offer may collect a tax registration |
| A payment method beyond cards | store-pricing — A site declares the payment methods it accepts |
| A quantity the buyer may change | store-pricing — A line may let the buyer change the quantity |
`
  const deltas = { 'store-pricing': `# store-pricing

## ADDED Requirements

### Requirement: A promotion is a record with a budget

Text.

#### Scenario: one

- **WHEN** a thing
- **THEN** another
` }
  const r = trace({ proposal, deltas })
  ok('the real failure is caught: four of five promises have no requirement', r.missing.length === 4,
    JSON.stringify(r.missing))
  ok('…and it names the trial', r.missing.some((m) => /An offer may carry a trial/.test(m)))
  ok('…the tax registration', r.missing.some((m) => /collect a tax registration/.test(m)))
  ok('…the payment method', r.missing.some((m) => /payment methods it accepts/.test(m)))
  ok('…and the adjustable quantity', r.missing.some((m) => /change the quantity/.test(m)))
  ok('while the one that WAS required passes', !r.missing.some((m) => /promotion is a record/.test(m)))
  ok('and nothing is reported unclaimed, since the delta has only that one', r.unclaimed.length === 0,
    JSON.stringify(r.unclaimed))
}

/* a requirement nobody promised */
{
  const proposal = `| What this change promises | ${TRACE_HEAD} |\n| --- | --- |\n| A thing | cap — A requirement for the thing |\n`
  const deltas = { cap: '### Requirement: A requirement for the thing\n### Requirement: Something nobody asked for\n' }
  const r = trace({ proposal, deltas })
  ok('a requirement no row claims is reported', r.unclaimed.length === 1 && /nobody asked for/.test(r.unclaimed[0]),
    JSON.stringify(r.unclaimed))
}

/* a capability on one side only */
{
  const proposal = `| What this change promises | ${TRACE_HEAD} |\n| --- | --- |\n| A thing | ghost — A requirement |\n`
  const r = trace({ proposal, deltas: { real: '### Requirement: A requirement\n' } })
  ok('a capability named with no delta file is reported', r.capabilities.some((c) => /^ghost:/.test(c)), JSON.stringify(r.capabilities))
  ok('and a delta file with no row is reported', r.capabilities.some((c) => /^real:/.test(c)), JSON.stringify(r.capabilities))
}

/* a clean change */
{
  const proposal = `| What this change promises | ${TRACE_HEAD} |\n| --- | --- |\n| A thing | cap — A requirement for the thing |\n`
  const r = trace({ proposal, deltas: { cap: '### Requirement: A requirement for the thing\n' } })
  ok('a change whose promises all land is clean', !r.noTable && !r.missing.length && !r.unclaimed.length && !r.capabilities.length && !r.malformed.length,
    JSON.stringify(r))
}

/* a row nobody can read is reported, never guessed at */
{
  const proposal = `| What this change promises | ${TRACE_HEAD} |\n| --- | --- |\n| A thing | somewhere vague |\n`
  const r = trace({ proposal, deltas: { cap: '### Requirement: A requirement\n' } })
  ok('a malformed row is reported rather than interpreted', r.malformed.length === 1, JSON.stringify(r.malformed))
}

/* no table at all */
{
  const r = trace({ proposal: '# Proposal\n\n## Why\n\nBecause.\n', deltas: {} })
  ok('a proposal with no trace table says so', r.noTable === true)
}

/* ---------- EVERY LIVE CHANGE ---------- */
const CHANGES = 'openspec/changes'
const live = fs.existsSync(CHANGES)
  ? fs.readdirSync(CHANGES).filter((d) => d !== 'archive' && fs.existsSync(path.join(CHANGES, d, 'proposal.md')))
  : []

for (const name of live) {
  const dir = path.join(CHANGES, name)
  const proposal = fs.readFileSync(path.join(dir, 'proposal.md'), 'utf8')
  const specs = path.join(dir, 'specs')
  const deltas = {}
  if (fs.existsSync(specs)) {
    for (const cap of fs.readdirSync(specs)) {
      const f = path.join(specs, cap, 'spec.md')
      if (fs.existsSync(f)) deltas[cap] = fs.readFileSync(f, 'utf8')
    }
  }
  const r = trace({ proposal, deltas })
  if (r.noTable) {
    /* A change proposed before this guard existed is not retroactively broken — it is reported as
       owing a table, by name, so the debt is visible and nobody has to remember it. */
    console.log(`  owes a trace table: ${name}`)
    continue
  }
  ok(`${name}: every promise names a requirement that exists`, r.missing.length === 0, r.missing.join(' · '))
  ok(`${name}: every requirement is promised`, r.unclaimed.length === 0, r.unclaimed.join(' · '))
  ok(`${name}: the capabilities agree`, r.capabilities.length === 0, r.capabilities.join(' · '))
  ok(`${name}: every row is readable`, r.malformed.length === 0, r.malformed.join(' · '))
}

console.log(`\nproposal trace: ${pass} passed${fail ? ', ' + fail + ' FAILED' : ''}\n`)
process.exit(fail ? 1 : 0)

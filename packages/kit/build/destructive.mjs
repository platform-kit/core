import { createHash } from 'node:crypto'
/*
 * The destructive guard: what in a plan would lose data. A statement-level match over SQL with its
 * comments and string literals stripped — deliberately dumb, nothing inferred: `drop table`, a column
 * dropped from a table, `drop schema`, `truncate`, a column's type changed. `drop function|policy|
 * trigger|index|view|constraint` loses no rows and passes.
 *
 * A GENERATED COLUMN IS NOT DATA. Its value is a function of its own row, so dropping one loses no
 * more than dropping an index does — and a generated column's expression cannot be altered in
 * place, so changing it is a drop and a re-add and nothing else. The guard cannot read that off the
 * SQL (the text of a drop says nothing about what the column was), so it is TOLD: the caller passes
 * the generated columns of the database being changed, and a drop of one of those passes. A caller
 * that passes nothing keeps the old, blunter answer. A dollar-quoted body (`do $$ … $$`, a
 * function) is scanned as text like anything else, which is as far as a scan goes. The plan (plan.mjs)
 * and the deploy refuse a plan with a hit unless it is allowed for that plan.
 *
 * A STATEMENT THAT WOULD LOSE NOTHING IS NOT DESTRUCTIVE, and whether it would is a question about
 * the database and not about the SQL — so, exactly as with a generated column, the guard is TOLD.
 * The caller counts what each hit would cost against the target it is about to change (plan.mjs
 * does it in the connection it already has open) and hands the costs in; an empty table, or a
 * column no row holds a value in that differs from its own default, passes with what was counted
 * said out loud. A count that could not be taken is `unknown` and refuses as though everything
 * were at stake: a guard that reads an error as "nothing to lose" is a trap and not a net.
 *
 * AND CONSENT NAMES THE STATEMENTS. PLATFORMKIT_ALLOW_DESTRUCTIVE takes the `digest` of the
 * destructive statements this plan holds — printed by the refusal that asks for it — so an
 * allowance cannot outlive the thing it was given for; a commit sha, for a deployment that would
 * rather tie consent to a release; or `1`, which still allows anything and says that it is a
 * standing permission rather than consent for this plan. The digest is over the statements and not
 * the commit because a removal has two sources and only one is a commit of the site's: a kit
 * upgrade may drop a column with no site commit at all.
 * Pure: no environment, no files. Pinned by destructive.test.mjs.
 */

/* the SQL as statements — split on `;` outside quotes, comments and dollar-quoted bodies — each with the
   line it starts on, its raw text (the `;` kept, so the statements join back into SQL) and its text with
   comments and string literals blanked (a body's text kept) for the shapes to match */
export function statements(sql) {
  const out = []
  let i = 0, line = 1, start = 0, startLine = 1, text = ''
  const push = (end) => { const raw = sql.slice(start, end).trim(); if (raw.replace(/;$/, '').trim()) out.push({ line: startLine, raw, text: text.trim() }); text = '' }
  while (i < sql.length) {
    const ch = sql[i], nx = sql[i + 1]
    if (ch === '\n') line++
    if (ch === '-' && nx === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue }
    if (ch === '/' && nx === '*') { const e = sql.indexOf('*/', i + 2); const skipped = sql.slice(i, e < 0 ? sql.length : e + 2); line += (skipped.match(/\n/g) || []).length; i = e < 0 ? sql.length : e + 2; continue }
    if (ch === "'") { let j = i + 1; while (j < sql.length) { if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue } if (sql[j] === "'") break; j++ } line += (sql.slice(i, j).match(/\n/g) || []).length; i = j + 1; text += "''"; continue }
    if (ch === '"') { let j = i + 1; while (j < sql.length && sql[j] !== '"') j++; text += sql.slice(i, j + 1); i = j + 1; continue }
    if (ch === '$') { const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64)); if (m) { const tag = m[0]; const e = sql.indexOf(tag, i + tag.length); const body = sql.slice(i, e < 0 ? sql.length : e + tag.length); line += (body.match(/\n/g) || []).length; text += body; i += body.length; continue } }
    if (ch === ';') { i++; push(i); start = i; startLine = line; continue }
    if (!text && /\s/.test(ch)) { i++; start = i; startLine = line; continue }
    text += ch; i++
  }
  push(i)
  return out
}

const ident = (s) => (s || '').replace(/"/g, '')
const SHAPES = [
  { kind: 'drop table', re: /\bdrop\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)/i },
  { kind: 'drop schema', re: /\bdrop\s+schema\s+(?:if\s+exists\s+)?([\w."]+)/i },
  { kind: 'truncate', re: /\btruncate\s+(?:table\s+)?(?:only\s+)?([\w."]+)/i },
  { kind: 'drop column', re: /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)[\s\S]*?\bdrop\s+(?:column\s+)?(?:if\s+exists\s+)?(?!constraint\b|not\b|default\b|identity\b|expression\b)([\w"]+)/i, column: true },   /* DROP NOT NULL, DROP DEFAULT, DROP IDENTITY, DROP EXPRESSION loosen a column and lose nothing */
  { kind: 'type change', re: /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)[\s\S]*?\balter\s+(?:column\s+)?([\w"]+)\s+(?:set\s+data\s+)?type\b/i, column: true },
]

/* every destructive statement in the SQL: { kind, object, line, statement } */
export function destructive(sql, { generated } = {}) {
  /* `schema.table.column`, lower-cased, of every column the target database computes for itself */
  const derived = generated instanceof Set ? generated
    : new Set((generated || []).map((x) => String(x).toLowerCase()))
  const hits = []
  for (const s of statements(sql)) {
    /* a privilege loses no data: `GRANT … TRUNCATE ON t` names the word and truncates nothing */
    if (/^(?:grant|revoke)\b/i.test(s.text)) continue
    /* a dollar-quoted body inside a statement is scanned as its own text too, so `do $$ … $$` is not hidden */
    for (const shape of SHAPES) {
      const m = shape.re.exec(s.text)
      if (!m) continue
      /* a column the database computes for itself is derived, not kept: dropping it loses nothing */
      if (shape.column && derived.has(`${ident(m[1])}.${ident(m[2])}`.toLowerCase())) continue
      hits.push({ kind: shape.kind, object: shape.column ? `${ident(m[1])}.${ident(m[2])}` : ident(m[1]), line: s.line, statement: s.raw })
      break
    }
  }
  return hits
}

/*
 * WHAT A HIT WOULD COST, as the caller counted it: `{ rows, kept, unknown }` — the rows the object
 * holds, how many of them hold something that would actually be lost (a value differing from the
 * column's own default; for a table, every row), and whether the count could be taken at all.
 * Absent, a hit costs the old, blunter answer: unknown, and refused.
 */
export const costOf = (hit, costs) => (costs && costs[hit.object.toLowerCase()]) || null
const loses = (hit, costs) => { const c = costOf(hit, costs); return !c || c.unknown ? 'unknown' : (Number(c.kept) > 0 ? 'values' : 'nothing') }

/*
 * THE DIGEST IS THE NAME OF THIS SET OF STATEMENTS. Ordered by object so the same set in another
 * order is the same name, whitespace collapsed so a reformat is not a new one, and eight hex —
 * enough not to collide across a project's deploys, short enough to retype.
 */
export function digestOf(hits) {
  if (!hits.length) return ''
  const body = hits.map((h) => `${h.kind} ${h.object.toLowerCase()} ${h.statement.replace(/\s+/g, ' ').trim()}`).sort().join('\n')
  return createHash('sha256').update(body).digest('hex').slice(0, 8)
}

/*
 * WHAT AN ALLOWANCE SAYS. `<digest>`, `<digest>:<object>,<object>` (those objects and no others),
 * a commit sha (matched against the commit being deployed), or `1` — a standing permission, kept
 * because a first declared deploy against years of drift is a real thing, and reported as what it is.
 */
export function readAllowance(value, { digest, commit } = {}) {
  const raw = String(value == null ? '' : value).trim()
  if (!raw) return { kind: 'none' }
  if (/^(1|true|yes|on)$/i.test(raw)) return { kind: 'blanket', objects: null }
  const [name, list] = raw.split(':')
  const objects = list ? list.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) : null
  const named = name.trim().toLowerCase()
  if (digest && named === String(digest).toLowerCase()) return { kind: 'digest', objects }
  /* a sha, full or short: it must name the commit this deploy is of */
  if (commit && /^[0-9a-f]{7,40}$/.test(named) && String(commit).toLowerCase().startsWith(named)) return { kind: 'commit', objects, commit }
  return { kind: 'stale', named, objects }
}

/*
 * The verdict for a plan: every hit, what it would cost, and whether this run may apply it.
 *
 * `costs` is keyed by the hit's object, lower-cased, and `commit` is the commit being deployed.
 * Given neither, the answer is the one this guard always gave: a hit refuses unless the variable
 * says otherwise.
 */
export function guard(sql, env = process.env, opts = {}) {
  const hits = destructive(sql, opts).map((h) => ({ ...h, cost: costOf(h, opts.costs), loses: loses(h, opts.costs) }))
  const digest = digestOf(hits)
  const allowance = readAllowance(env.PLATFORMKIT_ALLOW_DESTRUCTIVE, { digest, commit: opts.commit })
  /* a statement that would lose nothing needs no consent at all — the same answer a generated
     column already gets, for the same reason */
  const at_risk = hits.filter((h) => h.loses !== 'nothing')
  const permits = (h) => {
    if (allowance.kind === 'none' || allowance.kind === 'stale') return false
    if (!allowance.objects) return true
    return allowance.objects.includes(h.object.toLowerCase())
  }
  const refused = at_risk.filter((h) => !permits(h))
  return {
    hits, digest, allowance,
    /* what the callers before this change read: the hits it would not apply, and whether it may */
    allowed: allowance.kind !== 'none' && allowance.kind !== 'stale',
    ok: refused.length === 0,
    refused,
    free: hits.filter((h) => h.loses === 'nothing'),
  }
}

/* the hits as lines for a log, each with what it would cost where the caller counted it */
export const describe = (hits) => hits.map((h) => {
  const c = h.cost
  const cost = h.loses === 'unknown' ? ' — what it holds could not be counted'
    : h.loses === 'nothing' ? ` — ${c.rows} row(s), nothing that would be lost`
    : ` — ${c.rows} row(s), ${c.kept} that would be lost`
  return `  ${h.kind}: ${h.object} (line ${h.line})${h.cost || h.loses === 'unknown' ? cost : ''}\n    ${h.statement.split('\n').join('\n    ')}`
}).join('\n')

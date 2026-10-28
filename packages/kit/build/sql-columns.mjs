/*
 * EVERY COLUMN A SQL FUNCTION NAMES, CHECKED AGAINST THE DECLARATION.
 *
 * Postgres cannot do this for us. A trigger function's NEW is a record whose shape is not known
 * until the trigger fires, so `new.printer` on a table whose column is now `supplier` compiles
 * happily and raises at runtime — and `check_function_bodies` is off during apply anyway (the
 * plan turns it off, correctly: a function may reference an object created later in the same
 * transaction). So the check is ours to make, statically, from the declaration.
 *
 * It bit once: `space_on_print_order` kept reading `new.printer` after the rename, and every
 * insert into `fulfilments` raised wherever spaces was on — which is every print purchase.
 *
 * WHAT IT CHECKS, and nothing is implied beyond it:
 *   - `new.<col>` / `old.<col>` in a trigger function, against every table a CREATE TRIGGER
 *     attaches it to (a body that dispatches on `tg_table_name` needs the column on one of them).
 *   - `<alias>.<col>` where the alias is bound by `FROM/JOIN/UPDATE/INTO public.<table> [AS] <a>`.
 *   - the column list of `INSERT INTO public.<table> (...)`.
 *   - the targets of `UPDATE public.<table> ... SET <col> = `.
 * Anything it cannot bind with certainty is COUNTED, not guessed, and the count is reported — a
 * guard that quietly skips what it cannot read is worth less than one that says how much it skipped.
 */

/* ---- reading the declaration ---------------------------------------------------------------- */

/* `--` comments and single-quoted literals go before anything is matched: a column name inside a
   comment or an error message is not a reference, and 'it''s' must not swallow the rest of a file. */
export function stripNoise(sql) {
  let out = '', i = 0
  while (i < sql.length) {
    if (sql[i] === '-' && sql[i + 1] === '-') { const n = sql.indexOf('\n', i); i = n < 0 ? sql.length : n; continue }
    if (sql[i] === "'") {
      let j = i + 1
      while (j < sql.length) { if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue } break } j++ }
      out += "''"; i = j + 1; continue
    }
    out += sql[i]; i++
  }
  return out
}

const ident = '"?([a-z0-9_]+)"?'

/* table -> Set(column). CREATE TABLE's own list, plus every ALTER ... ADD COLUMN. */
export function declaredColumns(files) {
  const cols = new Map()
  const add = (t, c) => { if (!cols.has(t)) cols.set(t, new Set()); cols.get(t).add(c) }
  for (const { sql } of files) {
    const clean = stripNoise(sql)
    for (const m of clean.matchAll(new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?public"?\\.${ident}\\s*\\(`, 'gi'))) {
      const table = m[1]
      /* the column list ends at the paren that closes the one this opened */
      let depth = 1, i = m.index + m[0].length
      for (; i < clean.length && depth > 0; i++) { if (clean[i] === '(') depth++; else if (clean[i] === ')') depth-- }
      const block = clean.slice(m.index + m[0].length, i - 1)
      /* one definition per top-level comma; a column's name is its first quoted word */
      let d = 0, part = ''
      const parts = []
      for (const ch of block) {
        if (ch === '(') d++
        if (ch === ')') d--
        if (ch === ',' && d === 0) { parts.push(part); part = ''; continue }
        part += ch
      }
      parts.push(part)
      for (const p of parts) {
        const t = p.trim()
        if (!t) continue
        /* a table constraint is not a column */
        if (/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE|LIKE)\b/i.test(t)) continue
        const n = /^"?([a-z0-9_]+)"?/i.exec(t)
        if (n) add(table, n[1].toLowerCase())
      }
    }
    for (const m of clean.matchAll(new RegExp(`ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:IF\\s+EXISTS\\s+)?"?public"?\\.${ident}([\\s\\S]{0,4000}?);`, 'gi'))) {
      for (const a of m[2].matchAll(new RegExp(`ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${ident}`, 'gi'))) add(m[1], a[1].toLowerCase())
    }
  }
  return cols
}

/* relations whose columns this parser does not know: a reference into one is skipped, not blamed */
export function otherRelations(files) {
  const rel = new Set()
  for (const { sql } of files) {
    const clean = stripNoise(sql)
    for (const re of [
      new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+"?public"?\\.${ident}`, 'gi'),
      new RegExp(`CREATE\\s+MATERIALIZED\\s+VIEW\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?public"?\\.${ident}`, 'gi'),
    ]) for (const m of clean.matchAll(re)) rel.add(m[1])
  }
  return rel
}

/* ---- reading the functions ------------------------------------------------------------------ */

export function functionsOf(files) {
  const out = []
  for (const { file, sql } of files) {
    const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+"?public"?\\.${ident}\\s*\\(`, 'gi')
    for (const m of sql.matchAll(re)) {
      const head = sql.slice(m.index, m.index + 4000)
      const tag = /\bAS\s+(\$[a-z0-9_]*\$)/i.exec(head)
      if (!tag) continue
      const start = m.index + tag.index + tag[0].length
      const end = sql.indexOf(tag[1], start)
      if (end < 0) continue
      out.push({
        name: m[1].toLowerCase(), file,
        line: sql.slice(0, m.index).split('\n').length,
        body: sql.slice(start, end),
      })
    }
  }
  return out
}

/* function name -> Set(table it is attached to) */
export function triggersOf(files) {
  const t = new Map()
  for (const { sql } of files) {
    const clean = stripNoise(sql)
    const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:CONSTRAINT\\s+)?TRIGGER\\s+${ident}[\\s\\S]{0,600}?\\sON\\s+"?public"?\\.${ident}[\\s\\S]{0,600}?EXECUTE\\s+(?:FUNCTION|PROCEDURE)\\s+"?public"?\\.${ident}`, 'gi')
    for (const m of clean.matchAll(re)) {
      const fn = m[3].toLowerCase()
      if (!t.has(fn)) t.set(fn, new Set())
      t.get(fn).add(m[2].toLowerCase())
    }
  }
  return t
}

/* ---- the references inside one body --------------------------------------------------------- */

/* NAMES THAT SHADOW A TABLE SOMEWHERE IN THIS BODY, and so can never be trusted as an alias.
   A CTE name, a derived table's alias, a set-returning function's alias. SQL scopes an alias to its
   own query; this parser reads a whole function body at once, so an alias that names a real table in
   one query and a subquery in another would be checked against the wrong thing — which is exactly
   what `from public.events v` in one query and `left join (select ...) v` in another did.
   The rule is therefore blunt on purpose: a name used either way, anywhere in the body, is not
   checked at all. That loses coverage, which is counted and reported; the alternative loses
   correctness, which is not acceptable in a guard people are meant to believe. */
export function shadowedNames(body) {
  const clean = stripNoise(body)
  const out = new Set()
  /* a CTE: WITH a AS ( ... ), b AS ( ... ) */
  for (const m of clean.matchAll(/(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)([a-z][a-z0-9_]*)\s+AS\s*(?:(?:NOT\s+)?MATERIALIZED\s+)?\(/gi)) out.add(m[1].toLowerCase())
  /* a derived table or a function call wearing an alias: ) x / ) AS x / AS g(dd) */
  for (const m of clean.matchAll(/\)\s*(?:AS\s+)?([a-z][a-z0-9_]*)/gi)) out.add(m[1].toLowerCase())
  for (const m of clean.matchAll(/\bAS\s+([a-z][a-z0-9_]*)\s*\(/gi)) out.add(m[1].toLowerCase())
  return out
}

/* alias -> table, for the bindings that are unambiguous in the text */
export function aliasBindings(body) {
  const b = new Map()
  const clean = stripNoise(body)
  const re = new RegExp(`\\b(?:FROM|JOIN|UPDATE|INTO)\\s+"?public"?\\.${ident}(?:\\s+AS)?\\s+${ident}`, 'gi')
  const KEYWORD = new Set(['set', 'where', 'on', 'using', 'values', 'select', 'group', 'order', 'limit',
    'returning', 'left', 'right', 'inner', 'outer', 'join', 'and', 'or', 'as', 'for', 'do', 'nothing',
    'union', 'having', 'offset', 'with', 'window', 'cross', 'full', 'natural', 'lateral', 'default'])
  const shadow = shadowedNames(body)
  for (const m of clean.matchAll(re)) {
    const alias = m[2].toLowerCase()
    if (KEYWORD.has(alias) || shadow.has(alias)) continue
    /* an alias bound twice to different tables is not safe to check */
    if (b.has(alias) && b.get(alias) !== m[1].toLowerCase()) b.set(alias, null)
    else if (!b.has(alias)) b.set(alias, m[1].toLowerCase())
  }
  /* nor is one also bound to a CTE or anything else outside public: `from public.profiles p` inside a CTE and
     `from pending p` after it are two different things called p (60-emails.sql, admin_funnel) */
  for (const m of clean.matchAll(new RegExp(`\\b(?:FROM|JOIN)\\s+(?!"?public"?\\.)${ident}(?:\\s+AS)?\\s+${ident}\\b(?!\\s*\\.)`, 'gi'))) {
    const alias = m[2].toLowerCase()
    if (KEYWORD.has(alias) || KEYWORD.has(m[1].toLowerCase()) || shadow.has(alias)) continue
    if (b.has(alias)) b.set(alias, null)
  }
  /* a table used without an alias answers to its own name */
  for (const m of clean.matchAll(new RegExp(`\\b(?:FROM|JOIN|UPDATE|INTO)\\s+"?public"?\\.${ident}`, 'gi'))) {
    const t = m[1].toLowerCase()
    if (!shadow.has(t) && !b.has(t)) b.set(t, t)
  }
  return b
}

/* every reference this parser is willing to stand behind, plus a count of the ones it is not */
export function referencesOf(fn, attachedTo) {
  const refs = []
  let unchecked = 0
  const clean = stripNoise(fn.body)
  const at = (idx) => fn.line + clean.slice(0, idx).split('\n').length - 1

  /* NEW / OLD, against the tables a trigger attaches this function to */
  const dispatches = /\btg_(?:table_name|relname)\b/i.test(clean)
  for (const m of clean.matchAll(/\b(new|old)\s*\.\s*([a-z0-9_]+)/gi)) {
    if (!attachedTo || attachedTo.size === 0) { unchecked++; continue }
    refs.push({ kind: m[1].toLowerCase(), col: m[2].toLowerCase(), tables: [...attachedTo], any: dispatches, line: at(m.index) })
  }

  /* <alias>.<col> */
  const binds = aliasBindings(fn.body)
  for (const m of clean.matchAll(/\b([a-z][a-z0-9_]*)\s*\.\s*([a-z0-9_]+)/gi)) {
    const a = m[1].toLowerCase()
    if (a === 'new' || a === 'old' || a === 'public' || a === 'pg_catalog' || a === 'auth' || a === 'storage' || a === 'extensions') continue
    const table = binds.get(a)
    if (!table) { unchecked++; continue }
    refs.push({ kind: 'alias', col: m[2].toLowerCase(), tables: [table], any: false, line: at(m.index) })
  }

  /* INSERT INTO public.t (a, b, c) */
  for (const m of clean.matchAll(new RegExp(`INSERT\\s+INTO\\s+"?public"?\\.${ident}\\s*\\(([^)]*)\\)`, 'gi'))) {
    for (const c of m[2].split(',')) {
      const n = /^\s*"?([a-z0-9_]+)"?\s*$/i.exec(c)
      if (n) refs.push({ kind: 'insert', col: n[1].toLowerCase(), tables: [m[1].toLowerCase()], any: false, line: at(m.index) })
      else unchecked++
    }
  }

  /* UPDATE public.t ... SET a = , b = */
  for (const m of clean.matchAll(new RegExp(`UPDATE\\s+"?public"?\\.${ident}([\\s\\S]*?)(?:;|$)`, 'gi'))) {
    const set = /\bSET\b([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|\bFROM\b|$)/i.exec(m[2])
    if (!set) continue
    let d = 0, part = '', parts = []
    for (const ch of set[1]) {
      if (ch === '(') d++
      if (ch === ')') d--
      if (ch === ',' && d === 0) { parts.push(part); part = ''; continue }
      part += ch
    }
    parts.push(part)
    for (const p of parts) {
      const n = /^\s*"?([a-z0-9_]+)"?\s*=/i.exec(p)
      if (n) refs.push({ kind: 'update', col: n[1].toLowerCase(), tables: [m[1].toLowerCase()], any: false, line: at(m.index) })
    }
  }

  return { refs, unchecked }
}

/* ---- the check ------------------------------------------------------------------------------ */

export function checkColumns(files) {
  const cols = declaredColumns(files)
  const skip = otherRelations(files)
  const trig = triggersOf(files)
  const problems = []
  let checked = 0, unchecked = 0

  for (const fn of functionsOf(files)) {
    const { refs, unchecked: u } = referencesOf(fn, trig.get(fn.name))
    unchecked += u
    for (const r of refs) {
      const known = r.tables.filter((t) => cols.has(t) && !skip.has(t))
      if (known.length === 0) { unchecked++; continue }
      checked++
      const has = known.filter((t) => cols.get(t).has(r.col))
      const ok = r.any ? has.length > 0 : has.length === known.length
      if (!ok) {
        problems.push({
          fn: fn.name, file: fn.file, line: r.line, col: r.col, kind: r.kind,
          tables: known.filter((t) => !cols.get(t).has(r.col)),
        })
      }
    }
  }
  return { problems, checked, unchecked, tables: cols.size }
}

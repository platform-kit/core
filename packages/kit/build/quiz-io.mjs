/*
 * The three test files, read into plain shapes and written back — the same
 * line grammar velite.config.js parses at build, so what the admin saves is
 * what the app runs. Frontmatter goes through gray-matter; a diagnostic's
 * `spec` block (authoring guidance, with YAML comments) is kept verbatim.
 */
import matter from 'gray-matter'
import { dump as yamlDump } from 'js-yaml'

const DUMP = { lineWidth: -1 }

/* ---- personality: `## <n> <Name>` sections of `- statement` lines ---- */
export function parsePersonality(raw) {
  const fm = matter(raw)
  const types = []
  let cur = null
  for (const line of fm.content.split(/\r?\n/)) {
    const h = /^##\s+(\d+)\s+(.+?)\s*$/.exec(line)
    if (h) { cur = { n: Number(h[1]), name: h[2].trim(), statements: [] }; types.push(cur); continue }
    const b = /^-\s+(.+?)\s*$/.exec(line)
    if (b && cur) cur.statements.push(b[1])
  }
  return { data: fm.data, types }
}
export function serialisePersonality({ data, types }) {
  const body = (types || []).map((t) => `## ${t.n} ${t.name}\n\n${(t.statements || []).filter((s) => s.trim()).map((s) => '- ' + s.trim()).join('\n')}`).join('\n\n')
  return matter.stringify('\n' + body + '\n', data, DUMP)
}

/* ---- blockages (word association): `## words`, then `- word | orig: X | why: Y` ---- */
export function parseWords(raw) {
  const fm = matter(raw)
  const words = []
  let inWords = false
  for (const line of fm.content.split(/\r?\n/)) {
    if (/^##\s+words\b/i.test(line)) { inWords = true; continue }
    if (!inWords) continue
    const b = /^-\s+(.+?)\s*$/.exec(line)
    if (!b) continue
    const parts = b[1].split(' | ')
    let orig = '', why = ''
    for (const p of parts.slice(1)) {
      const mo = /^orig:\s*(.+)$/.exec(p); if (mo) orig = mo[1].trim()
      const mw = /^why:\s*(.+)$/.exec(p); if (mw) why = mw[1].trim()
    }
    words.push({ w: parts[0].trim(), orig, why })
  }
  return { data: fm.data, words }
}
export function serialiseWords({ data, words }) {
  const lines = (words || []).filter((x) => x.w && x.w.trim()).map((x) => '- ' + x.w.trim() + (x.orig ? ' | orig: ' + x.orig.trim() : '') + (x.why ? ' | why: ' + x.why.trim() : ''))
  return matter.stringify('\n## words\n\n' + lines.join('\n') + '\n', data, DUMP)
}

/* ---- diagnostics: `## <movement>` / `### tier n` / `- (R) statement` ----
   markers before a line, in any order: (R) reverse-coded, (B) a blank to fill in
   (its slot written as ____), (!) required in every round, (D) a draft — kept in
   the file, never built. The line ends in its key, `{#k7f3a2c1}`: the stable
   part of the statement's id (see velite.config.js), which the writer gives every
   line that has none (keyStatements) — the build refuses a line without one —
   so a line can be reworded, moved or retiered and its answers still match */
export function parseDiagnostic(raw) {
  const fm = matter(raw)
  /* the spec block is authoring guidance with comments: keep its text as written */
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  const fmText = m ? m[1] + '\n' : ''
  const idx = fmText.search(/^(published|topic|area|title|order|levels|movements|round|timing|display|blank):/m)
  const specRaw = idx > 0 ? fmText.slice(0, idx) : ''
  const { spec, ...data } = fm.data
  const sections = []
  let cur = null, tier = 1
  for (const line of fm.content.split(/\r?\n/)) {
    const th = /^###\s+tier\s+([123])\b/i.exec(line)
    if (th) { tier = Number(th[1]); continue }
    const h = /^##\s+(?!#)(.+?)\s*$/.exec(line)
    if (h) { cur = { code: h[1].trim(), tiers: { 1: [], 2: [], 3: [] } }; sections.push(cur); tier = 1; continue }
    const b = /^-\s*((?:\((?:r|b|!|d)\)\s*)*)(.+?)\s*(?:\{#([A-Za-z0-9._-]+)\}\s*)?$/i.exec(line)
    if (b && cur) { const k = b[1].toLowerCase(); cur.tiers[tier].push({ text: b[2], reverse: k.includes('(r)'), blank: k.includes('(b)'), required: k.includes('(!)'), draft: k.includes('(d)'), key: b[3] || '' }) }
  }
  return { data, specRaw, spec: specRaw ? undefined : spec, sections }
}
/* every statement gets a key it lacks: eight hex characters of a UUID, unique
   within the topic (the writer calls this, so a file saved from the admin is
   always fully keyed; a hand-written line without one keeps working by place) */
export function keyStatements(sections) {
  const used = new Set()
  for (const s of sections || []) for (const t of [1, 2, 3]) for (const x of (s.tiers || {})[t] || []) if (x.key) used.add(x.key)
  for (const s of sections || []) for (const t of [1, 2, 3]) for (const x of (s.tiers || {})[t] || []) {
    if (x.key || !(x.text && x.text.trim())) continue
    let k; do { k = randomUUID().replace(/-/g, '').slice(0, 8) } while (used.has(k))
    used.add(k); x.key = k
  }
  return sections
}
/* The lack comes first: a movement climbs from lack to fullness, so its
   reverse-coded lines (`(R)`, the ones that state the lack) are the first lines
   of tier 1, in their own order, and nowhere else. The writer puts them there
   on every save (so the admin can never write a file that breaks it), the
   editor moves them there as they are marked or dragged, and velite refuses a
   hand-written file that has one anywhere else. */
export function lackFirst(section) {
  const tiers = section.tiers || {}
  const lack = []
  for (const t of [1, 2, 3]) { const keep = []; for (const x of tiers[t] || []) (x.reverse && !x.blank ? lack : keep).push(x); tiers[t] = keep }
  tiers[1] = lack.concat(tiers[1] || [])
  return section
}
export function serialiseDiagnostic({ data, specRaw, spec, sections }) {
  for (const s of sections || []) lackFirst(s)
  const head = specRaw || (spec ? yamlDump({ spec }, { lineWidth: -1 }) : '')
  const fmy = yamlDump(data, { lineWidth: -1 })   /* block style: a comma in a def must never split a key */
  const body = (sections || []).map((s) => {
    const tiers = [1, 2, 3].map((t) => {
      const rows = ((s.tiers || {})[t] || []).filter((x) => x.text && x.text.trim())
      return rows.length ? `### tier ${t}\n` + rows.map((x) => '- ' + (x.reverse && !x.blank ? '(R) ' : '') + (x.blank ? '(B) ' : '') + (x.required ? '(!) ' : '') + (x.draft ? '(D) ' : '') + x.text.trim() + (x.key ? ' {#' + x.key + '}' : '')).join('\n') : ''
    }).filter(Boolean)
    return `## ${s.code}\n\n` + tiers.join('\n\n')
  }).join('\n\n')
  return '---\n' + head + fmy + '---\n\n' + body + '\n'
}

/* ---- the area keys, and renaming or removing one ----
   An area's key (`area:` in its diagnostic file) is what answers and books
   file under, and four other places say it: the recommendation slots in
   content/app/ui/topics.md (`### <area>:<level>` records with
   `slug: <kebab-area>-<level>`), the books' `topics:` lists (those slugs), the
   companions' `statementArea`, and the glossary's `## areas` name override.
   Change the key in one place and the rest silently stop lining up, so a
   rename or a removal goes through here and touches all of them at once.
   `root` is the repository root; both return the files they changed. */
import { readdirSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export const AREA_KEY = /^[a-z][a-zA-Z0-9]*$/   /* camelCase, as the files need */
/* a slot's slug is the key in kebab-case: selfConcept → self-concept-realization */
export const areaSlug = (key) => String(key).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const LEVEL_SLUGS = '(circumstance|relationship|realization)'

/* the area keys as the diagnostic files declare them — the one list; the
   companion schemas take their choices from it, so a new or renamed area
   needs no code edit. Synchronous: schemas are built at import time. */
export function areaKeys(root = process.cwd()) { return areaList(root).map((a) => a.key) }
/* the same, with each area's title (the first file's) for a list a person picks from */
export function areaList(root = process.cwd()) {
  const dir = join(root, 'content/app/tests/diagnostics')
  let names = []
  try { names = readdirSync(dir).filter((n) => n.endsWith('.md')) } catch (e) { return [] }
  const out = []
  for (const n of names) {
    const raw = readFileSync(join(dir, n), 'utf8')
    const m = /^area:\s*(\S+)\s*$/m.exec(raw)
    if (!m || out.some((a) => a.key === m[1])) continue
    const t = /^title:\s*(.+?)\s*$/m.exec(raw)
    out.push({ key: m[1], title: t ? t[1].replace(/^['"]|['"]$/g, '') : m[1] })
  }
  return out
}

/* the same list through the store (or a root): what the admin's option list and the function read */
export async function areaListOf(store) {
  const { asStore } = await import('./store/index.mjs'); const st = asStore(store)
  const dir = 'content/app/tests/diagnostics'
  const out = []
  for (const n of await st.list(dir)) {
    const raw = (await st.read(dir + '/' + n + '.md')) || ''
    const m = /^area:\s*(\S+)\s*$/m.exec(raw)
    if (!m || out.some((a) => a.key === m[1])) continue
    const t = /^title:\s*(.+?)\s*$/m.exec(raw)
    out.push({ key: m[1], title: t ? t[1].replace(/^['"]|['"]$/g, '') : m[1] })
  }
  return out
}

/* a file rewritten through the store, its path noted when it changed */
async function rewriteFile(store, file, fn, changed) {
  const raw = await store.read(file)
  if (raw == null) return
  const out = fn(raw)
  if (out !== raw) { await store.write(file, out); changed.push(file) }
}
const mdFiles = async (store, dir) => (await store.list(dir)).map((n) => dir + '/' + n + '.md')

export async function renameAreaRefs(root, from, to) {
  const { asStore } = await import('./store/index.mjs'); const store = asStore(root)
  if (from === to) return []
  if (!AREA_KEY.test(to)) throw new Error('an area key is camelCase: letters and digits, starting with a letter')
  const changed = []
  const F = esc(from), FS = esc(areaSlug(from)), TS = areaSlug(to)
  /* the slot records (by key) and their slugs (by the key's kebab-case) */
  await rewriteFile(store, 'content/app/ui/topics.md', (raw) => raw
    .replace(new RegExp('^(###\\s+)' + F + ':', 'gm'), (m, a) => a + to + ':')
    .replace(new RegExp('^(slug:\\s*)' + FS + '-', 'gm'), (m, a) => a + TS + '-'), changed)
  /* the glossary's name override */
  await rewriteFile(store, 'content/app/ui/glossary.md', (raw) => {
    const a = raw.indexOf('\n## areas'); if (a < 0) return raw
    const b = raw.indexOf('\n## ', a + 1); const end = b < 0 ? raw.length : b
    return raw.slice(0, a) + raw.slice(a, end).replace(new RegExp('^(###\\s+)' + F + '(\\s|$)', 'gm'), (m, h, t) => h + to + t) + raw.slice(end)
  }, changed)
  /* the slugs in the books' topics, the area in the companions' premises */
  for (const dir of ['content/books', 'content/companions']) {
    for (const file of await mdFiles(store, dir)) await rewriteFile(store, file, (raw) => raw
      .replace(new RegExp('^(\\s*-\\s*)' + FS + '-' + LEVEL_SLUGS + '\\s*$', 'gm'), (m, a, lvl) => a + TS + '-' + lvl)
      .replace(new RegExp('^(statementArea:\\s*)' + F + '\\s*$', 'gm'), (m, a) => a + to), changed)
  }
  return changed
}

/* an area deleted: the books' tags for its slots go with it. A companion whose
   premise filed under it keeps its statementArea (there is nothing to set it
   to); the engine leaves a premise with no published area out of the test,
   and the admin shows the field so it can be re-filed. */
export async function removeAreaRefs(root, area) {
  const { asStore } = await import('./store/index.mjs'); const store = asStore(root)
  const changed = []
  const A = esc(areaSlug(area))
  for (const file of await mdFiles(store, 'content/books')) await rewriteFile(store, file, (raw) => raw
    .replace(new RegExp('^\\s*-\\s*' + A + '-' + LEVEL_SLUGS + '\\s*\\n', 'gm'), '')
    /* a list left with nothing becomes an empty list, not a null */
    .replace(/^topics:\s*\n(?=\S|$)/m, 'topics: []\n'), changed)
  return changed
}

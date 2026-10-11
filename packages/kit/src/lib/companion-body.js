/*
 * A companion's body, read into a plain shape and written back — pure, no
 * imports, shared by the build (build/companion-io.mjs: velite, the admin
 * server, the generator) and the admin's companion editor in the browser, so
 * the two never disagree about the grammar. One `# <chapter title>` per book
 * chapter, each with `## Summary` (prose), `## Essence` (a `- ` list) and
 * `## Quiz` (numbered questions, four `- [ ]` options with one `- [x]`, an
 * optional `> why`). The parser is tolerant — TipTap escapes `[x]` as `\[x\]`,
 * an editor may write `why:` instead of `>` — and the serialiser writes the one
 * canonical form.
 */

/* the reader's own chapter split, so a companion matches what the reader shows */
export function bookChapterTitles(bookRaw) {
  return String(bookRaw || '').split(/^(?=# )/m).filter((s) => s.trim()).map((part) => {
    const m = /^# (.*)$/m.exec(part)
    return m ? m[1].trim() : 'Untitled'
  })
}

const OPT_RE = /^\s*[-*]\s+\\?\[(x|X| )\\?\]\s*(.*)$/
const Q_RE = /^\s*(\d+)[.)]\s+(.*)$/
const WHY_RE = /^\s*(?:>\s*|why:\s*)(.*)$/i

export function parseCompanionBody(md) {
  const chapters = [], issues = []
  const lines = String(md || '').split(/\r?\n/)
  let fence = false, cur = null, section = null, q = null
  const closeQ = () => { if (q && cur) { cur.quiz.push(q); q = null } }
  const finishChapter = () => {
    closeQ()
    if (!cur) return
    cur.summaryMd = cur.summaryLines.join('\n').trim()
    delete cur.summaryLines
    chapters.push(cur); cur = null; section = null
  }
  for (const line of lines) {
    if (/^(```|~~~)/.test(line)) { fence = !fence; if (cur && section === 'summary') cur.summaryLines.push(line); continue }
    if (fence) { if (cur && section === 'summary') cur.summaryLines.push(line); continue }
    const h1 = /^#\s+(.+?)\s*#*\s*$/.exec(line)
    if (h1) { finishChapter(); cur = { title: h1[1].trim(), summaryLines: [], essence: [], quiz: [] }; continue }
    if (!cur) continue
    const h2 = /^##\s+(summary|essence|quiz)\s*$/i.exec(line)
    if (h2) { closeQ(); section = h2[1].toLowerCase(); continue }
    if (section === 'summary') { cur.summaryLines.push(line); continue }
    if (section === 'essence') { const b = /^\s*[-*]\s+(.+?)\s*$/.exec(line); if (b) cur.essence.push(b[1]); continue }
    if (section === 'quiz') {
      const qm = Q_RE.exec(line)
      if (qm) { closeQ(); q = { q: qm[2].trim(), options: [], answer: -1, why: '' }; continue }
      if (!q) continue
      const om = OPT_RE.exec(line)
      if (om) { if (om[1].toLowerCase() === 'x') { if (q.answer >= 0) issues.push({ chapter: cur.title, message: `question ${cur.quiz.length + 1}: more than one correct option` }); q.answer = q.options.length } q.options.push(om[2].trim()); continue }
      const wm = WHY_RE.exec(line)
      if (wm && q.options.length) { q.why = (q.why ? q.why + ' ' : '') + wm[1].trim(); continue }
      if (line.trim() && q.options.length === 0) q.q += ' ' + line.trim()   /* a wrapped question */
    }
  }
  finishChapter()
  for (const c of chapters) {
    c.quiz.forEach((x, i) => {
      if (x.options.length !== 4) issues.push({ chapter: c.title, message: `question ${i + 1}: ${x.options.length} options (needs 4)` })
      if (x.answer < 0) issues.push({ chapter: c.title, message: `question ${i + 1}: no correct option marked [x]` })
    })
  }
  return { chapters, issues }
}

/* one canonical body (no frontmatter) */
export function serialiseCompanionBody(chapters) {
  return (chapters || []).map((c) => {
    const parts = [`# ${c.title}`]
    if (c.summaryMd && c.summaryMd.trim()) parts.push('## Summary\n\n' + c.summaryMd.trim())
    if (c.essence && c.essence.length) parts.push('## Essence\n\n' + c.essence.map((e) => '- ' + e.trim()).join('\n'))
    if (c.quiz && c.quiz.length) {
      parts.push('## Quiz\n\n' + c.quiz.map((x, i) => {
        const opts = x.options.map((o, j) => `   - [${j === x.answer ? 'x' : ' '}] ${o.trim()}`).join('\n')
        return `${i + 1}. ${x.q.trim()}\n${opts}` + (x.why ? `\n   > ${x.why.trim()}` : '')
      }).join('\n\n'))
    }
    return parts.join('\n\n')
  }).join('\n\n')
}

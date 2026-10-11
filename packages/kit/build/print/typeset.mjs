/*
 * A book's markdown, compiled to Typst — the source of the printed edition.
 * Our books use a small, known grammar: `# ` chapters (and `## ` subheads),
 * paragraphs, *emphasis* and **strength**, verse set with two trailing spaces,
 * `> ` quotations, numbered lists, and the editorial marks `==text=={colour}`.
 * Each construct becomes the template's own (build/print/book.typ); the plain
 * text is escaped for Typst's markup mode, so its smart quotes and hyphenation
 * still apply. Images and links print as their text; nothing else is dropped.
 * Pure: strings in, a Typst document out, so the hash of an edition is a hash
 * of exactly this.
 */
import { bookChapters } from '../../src/lib/speech.js'

/* markdown's own backslash escapes come off first (a book writes `1\.` to keep a line out of a
   list); then Typst markup: what must be escaped in running text, and what only at a line's start */
const unmd = (s) => String(s).replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, '$1')
const esc = (s) => unmd(s)
  .replace(/[\\*_`#$<>@~[\]]/g, (c) => '\\' + c)
  .replace(/\/\//g, '\\/\\/')
  .replace(/^([=+\-/])/gm, '\\$1')
  .replace(/^(\d+\.)/gm, '#("$1")')
export const str = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"'

/* inline: marks, strong, emphasis, links, images, hard breaks → Typst markup */
export function inline(md, marks) {
  let out = '', i = 0
  const src = String(md || '')
  const push = (text) => { out += esc(text) }
  while (i < src.length) {
    const rest = src.slice(i)
    let m
    /* a markdown escape (\[, \_, \.) is one thing: the character, as itself */
    if ((m = /^\\([\\`*_{}\[\]()#+\-.!>~|])/.exec(rest))) { push(m[1]); i += 2; continue }
    if ((m = /^==([^=]+?)==(?:\{([a-z]+)\})?/.exec(rest))) { const n = marks.push({ text: m[1], colour: m[2] || 'sun' }); out += `#mark(${str(m[2] || 'sun')}, ${n})[${inline(m[1], [])}]`; i += m[0].length; continue }
    if ((m = /^\*\*(.+?)\*\*/.exec(rest))) { out += `#strong[${inline(m[1], marks)}]`; i += m[0].length; continue }
    if ((m = /^__(.+?)__/.exec(rest))) { out += `#strong[${inline(m[1], marks)}]`; i += m[0].length; continue }
    if ((m = /^\*(?!\s)(.+?)\*/.exec(rest))) { out += `#emph[${inline(m[1], marks)}]`; i += m[0].length; continue }
    if ((m = /^_(?!\s)(.+?)_(?![a-zA-Z0-9])/.exec(rest))) { out += `#emph[${inline(m[1], marks)}]`; i += m[0].length; continue }
    if ((m = /^!\[([^\]]*)\]\([^)]*\)/.exec(rest))) { i += m[0].length; continue }
    if ((m = /^\[([^\]]+)\]\([^)]*\)/.exec(rest))) { out += inline(m[1], marks); i += m[0].length; continue }
    if ((m = /^ {2,}\n/.exec(rest))) { out += ' \\\n'; i += m[0].length; continue }
    if ((m = /^\n/.exec(rest))) { out += ' '; i += 1; continue }
    const plain = /^[^*_=!\[\\ \n]+|^[ \n]|^[*_=!\[\\]/.exec(rest)[0]
    push(plain); i += plain.length
  }
  return out
}

/* hard line breaks come two ways in the books — two trailing spaces, or a trailing backslash —
   and mean two things: verse, an address, a list of affirmations (a line each, kept), or a
   source typed with a break at the end of every line of prose (It Works), which a page flows.
   Typed prose shows itself: long lines, most of them broken mid-sentence. */
/* a chapter typed with a break at the end of every line of prose shows itself as a whole: many
   broken lines, long ones. In such a chapter every break flows except a stack of short lines
   (an inscription, an address, a line of verse); elsewhere a paragraph is judged on its own */
export function typedChapter(md) {
  const broken = String(md || '').split('\n').filter((l) => /(\\| {2,})$/.test(l))
  if (broken.length < 6) return false
  return broken.reduce((n, l) => n + l.trim().length, 0) / broken.length > 50
}
function hardBreaks(p, typed = false) {
  const lines = p.split('\n')
  const broken = lines.filter((l) => /(\\| {2,})$/.test(l))
  if (!broken.length) return p
  const avg = broken.reduce((n, l) => n + l.trim().length, 0) / broken.length
  const midSentence = broken.filter((l) => !/[.!?;:,"”'’)\]]\s*(\\| {2,})$/.test(l)).length
  /* verse is short-lined whatever its punctuation: a stanza of seven lines of thirty characters
     stays a stanza however many run on mid-sentence */
  const flow = typed ? avg >= 40 : (avg > 50 && midSentence >= broken.length / 3) || (avg > 45 && midSentence > broken.length / 2 && broken.length >= 4)
  if (flow) return p.replace(/(\\| {2,})\n/g, ' ')
  return p.replace(/\\\n/g, '  \n')
}

/* the same reading of a chapter's hard breaks, as markdown again — for a setting that is not
   Typst (the EPUB): a typed line-end flows, verse keeps its lines */
export function flow(md) {
  const typed = typedChapter(md)
  return String(md || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map((p) => hardBreaks(p.replace(/^\n+|\n+$/g, ''), typed)).join('\n\n')
}
/* a chapter's body: blocks → Typst */
export function blocks(md, marks, { typed = null } = {}) {
  const out = []
  const isTyped = typed == null ? typedChapter(md) : typed
  const paras = String(md || '').replace(/\r\n/g, '\n').split(/\n{2,}/)
  for (const raw of paras) {
    const p = hardBreaks(raw.replace(/^\n+|\n+$/g, ''), isTyped)
    if (!p.trim()) continue
    /* a line in capitals with no full stop is a subhead the source typed by hand ("THREE POSITIVE
       RULES OF ACCOMPLISHMENT"); "THE END" is the end */
    const caps = /^[A-Z0-9 ,'’:&()-]+$/.test(p.trim()) && /[A-Z]/.test(p) && p.trim().split(/\s+/).length <= 8 && !/[.!?]$/.test(p.trim())
    if (caps && /^THE END$/.test(p.trim())) { out.push('#the-end[' + inline(titleCase(p.trim()), []) + ']'); continue }
    if (caps) { out.push(`#subhead[${inline(titleCase(p.trim()), marks)}]`); continue }
    /* a row of asterisks is a section break: a centred dinkus */
    if (/^\s*(?:\\?\*\s*){3,}$/.test(p)) { out.push('#dinkus'); continue }
    if (/^#{2,}\s/.test(p)) { out.push(`#subhead[${inline(titleCase(p.replace(/^#+\s*/, '').replace(/\s*#+$/, '')), marks)}]`); continue }
    if (/^>\s?/m.test(p) && p.split('\n').every((l) => /^>\s?/.test(l) || !l.trim())) { out.push(`#quote[${inline(p.split('\n').map((l) => l.replace(/^>\s?/, '')).join('\n'), marks)}]`); continue }
    if (p.split('\n').every((l) => /^\d+\.\s/.test(l))) { out.push('#enum(' + p.split('\n').map((l) => `[${inline(l.replace(/^\d+\.\s*/, ''), marks)}]`).join(', ') + ')'); continue }
    if (p.split('\n').every((l) => /^[-*]\s/.test(l))) { out.push('#list(' + p.split('\n').map((l) => `[${inline(l.replace(/^[-*]\s*/, ''), marks)}]`).join(', ') + ')'); continue }
    if (/ {2,}\n/.test(p)) { out.push(`#verse[${inline(p, marks)}]`); continue }
    /* a paragraph with a numbered list inside it: the prose, then the list, then the prose */
    if (/^\d+\.\s/m.test(p)) {
      const lines = p.split('\n'), runs = []
      for (const l of lines) { const li = /^\d+\.\s/.test(l); const last = runs[runs.length - 1]; if (last && last.li === li) last.lines.push(l); else runs.push({ li, lines: [l] }) }
      out.push(runs.map((r) => r.li ? '#enum(' + r.lines.map((l) => `[${inline(l.replace(/^\d+\.\s*/, ''), marks)}]`).join(', ') + (r.lines.length === 1 ? ',' : '') + ')' : inline(r.lines.join('\n'), marks)).join('\n'))
      continue
    }
    out.push(inline(p, marks))
  }
  /* a stack of short paragraphs — an epigraph typed a line at a time ("If you KNOW" / "what you
     WANT" / "you can HAVE IT"), a couplet with its attribution — is one piece of verse, set
     together and flush, rather than a row of indented one-line paragraphs */
  const short = (p) => !p.startsWith('#') && p.split(/\s+/).length <= 8
  /* lines of verse seldom end in a full stop; a run of short sentences that do (a glossary's
     entries, two one-line remarks) is prose */
  const unstopped = (run) => run.filter(short).filter((p) => !/[.!?…]\s*$/.test(p) || /^[—–]/.test(p)).length * 2 >= run.filter(short).length
  const versy = (p) => short(p) || p.startsWith('#verse[')
  for (let i = 0; i < out.length; i++) {
    if (!versy(out[i])) continue
    let j = i
    while (j + 1 < out.length && versy(out[j + 1])) j++
    const run = out.slice(i, j + 1)
    if (run.length < 2 || !run.some(short) || !unstopped(run)) continue
    out.splice(i, run.length, `#verse[${run.map((p) => p.startsWith('#verse[') ? p.slice(7, -1) : p).join(' \\\n')}]`)
  }
  /* a sign-off — a paragraph of a few words after a paragraph of prose ("THE AUTHOR.") — stays
     with the paragraph before it, which is kept whole and moves with it rather than leaving the
     sign-off alone at the head of a page */
  for (let i = 1; i < out.length; i++) {
    const words = out[i].startsWith('#the-end') ? 2 : out[i].startsWith('#') ? 99 : out[i].split(/\s+/).length
    /* …and a chapter's last paragraph, when it is a few lines, is not left alone on a page
       either: the paragraph before it comes along (breaking if it must) */
    const short = words <= 4 || (i === out.length - 1 && words <= 45)
    if (short && !out[i - 1].startsWith('#')) { out[i - 1] = keep(out[i - 1], i > 1, words > 4); if (!out[i].startsWith('#')) out[i] = '#h(1.4em);' + out[i] }
  }
  return out.join('\n\n')
}
/* a paragraph kept with what follows it (a block is its own container, so the indent a
   following paragraph would have is put back by hand) */
const keep = (p, indented, breakable = true) => `#block(sticky: true, breakable: ${breakable})[${indented ? '#h(1.4em);' : ''}${p}]`
/* a short last paragraph moves with its companion rather than leaving the key insights alone at
   the head of a page; a long one flows, since carrying it whole would empty most of a page */
const keepLast = (body) => {
  const ps = body.split('\n\n'), i = ps.length - 1
  if (i < 0 || ps[i].startsWith('#') || ps[i].split(/\s+/).length > 45) return body
  ps[i] = keep(ps[i], i > 0)
  return ps.join('\n\n')
}

/* the whole document: front matter data, the introduction, the chapters — each the text
   with its companion (`contents: both`), the text alone (`full`), the companion alone
   (`summary`: the chapter's summary as its text, its key insights after), or the two as
   parts (`parts`: Part One the modern edition, Part Two the original full text) — and the marked lines at
   the back */
/* a chapter titled "3. Polarity" carries its own number, and the opener says it — so the
   number comes off the title. In a book whose titles are numbered, one that is not (an
   introduction) has no number; in a book whose titles are not, the count is the number. */
/* a chapter's own number, written into its title: "3. Desire", "Chapter 3. Desire" */
const OWN = /^(?:chapter\s+)?(\d+)[.:)]\s+/i
const numbering = (titles) => titles.some((t) => OWN.test(t))
/* a title typed in capitals (THE LAW OF PROSPERITY) is set in title case: the page's heading and
   the contents are not the place for a shout, and the running head makes its own capitals */
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'the', 'to', 'up'])
const titleCase = (t) => {
  if (/^[IVXLCDM]+$/.test(t.trim())) return t
  const big = t.split(/\s+/).filter((w) => !SMALL.has(w.toLowerCase()))
  if (!big.length || !big.every((w) => /[A-Z]/.test(w) && w === w.toUpperCase())) return t
  return t.toLowerCase().split(/(\s+|-)/).map((w, i, all) => {
    if (/^\s+$|^-$/.test(w)) return w
    const first = all.slice(0, i).every((x) => /^\s*$/.test(x))
    return !first && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
  }).join('')
}
const untitle = (t) => titleCase(String(t).replace(OWN, ''))
const numberOf = (t, i, numbered) => { const m = OWN.exec(t); return m ? Number(m[1]) : numbered ? null : i + 1 }
/* the book's shape for another setting (the EPUB): the chapters with their numbers and titles as
   the print has them, each with its text, its summary and its key insights as markdown, and
   whether the edition is in two parts */
export function plan({ book, companion, contents = 'both' }) {
  const chapters = bookChapters(book.raw || book.body || '')
  const comp = Object.fromEntries(((companion && companion.chapters) || []).map((c) => [c.title, c]))
  const numbered = numbering(chapters.map((c) => c.title))
  const bare = chapters.every((ch) => /^(?:[IVXLCDM]+|\d+)$/i.test(untitle(ch.title).trim()))
  const structured = chapters.filter((ch) => /^(?:part|lesson|book|section|letter)\s+(?:\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.test(ch.title.trim())).length >= chapters.length / 2
  return {
    twoParts: contents === 'parts', bare,
    chapters: chapters.map((ch, i) => { const c = comp[ch.title]; return { i, n: bare || structured ? null : numberOf(ch.title, i, numbered), title: untitle(ch.title), md: ch.md, summaryMd: (c && c.summaryMd) || '', essence: (c && c.essence) || [] } }),
  }
}
export function typeset({ book, companion, trim = '6x9', contents = 'both', note = '', words = {} }) {
  const chapters = bookChapters(book.raw || book.body || '')
  const comp = Object.fromEntries(((companion && companion.chapters) || []).map((c) => [c.title, c]))
  const marks = []
  const numbered = numbering(chapters.map((c) => c.title))
  /* chapters that are bare numerals (the Tao's eighty-one, I to LXXXI) are their own number: no
     "Chapter 1" over a "I" */
  const bare = chapters.every((ch) => /^(?:[IVXLCDM]+|\d+)$/i.test(untitle(ch.title).trim()))
  /* a book whose titles carry their own structure ("Lesson One: …", "Part 3: …") is not numbered
     over the top of it */
  const structured = chapters.filter((ch) => /^(?:part|lesson|book|section|letter)\s+(?:\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.test(ch.title.trim())).length >= chapters.length / 2
  const twoParts = contents === 'parts'
  const parts = []
  parts.push(`#import "book.typ": *`)
  const intro = book.introduction ? blocks(book.introduction, marks) : null
  /* in two parts the brief comes first, so its marks are numbered first */
  const briefFirst = twoParts ? chapters.map((ch) => {
    const before = marks.length
    const c = comp[ch.title]
    const body = blocks((c && c.summaryMd) || '', marks)
    const own = marks.slice(before).map((m, k) => ({ ...m, n: before + k + 1 }))
    const essence = c && c.essence ? c.essence.map((e) => inline(e, [])) : []
    return { body, own, essence }
  }) : null
  const chapterSrc = chapters.map((ch, i) => {
    const before = marks.length
    const c = comp[ch.title]
    /* the summary alone: the chapter's text is its summary, and the summary's marks are the chapter's */
    const body = contents === 'summary' ? blocks((c && c.summaryMd) || '', marks) : blocks(ch.md, marks)
    const own = marks.slice(before).map((m, k) => ({ ...m, n: before + k + 1 }))
    const summary = contents === 'both' && c && c.summaryMd ? blocks(c.summaryMd, []) : null
    const long = ((contents === 'both' && c && c.summaryMd ? c.summaryMd : '') + ' ' + ((c && c.essence) || []).join(' ')).split(/\s+/).length > 170 || ((c && c.essence) || []).length > 3
    const essence = (contents === 'both' || contents === 'summary') && c && c.essence ? c.essence.map((e) => inline(e, [])) : []
    return { i, n: bare || structured ? null : numberOf(ch.title, i, numbered), title: untitle(ch.title), body, own, summary, essence, long }
  })
  /* the second part: the same chapters in brief — the summary as the text, the key insights after */
  const briefSrc = twoParts ? chapterSrc.map((ch, i) => ({ ...ch, ...briefFirst[i], summary: null, long: briefFirst[i].essence.length > 3 })).filter((c) => c.body.trim() || c.essence.length) : []
  const w = (k, d) => str(words[k] || d)
  const entry = (c) => `(title: ${str(c.n == null ? c.title : c.n + '. ' + c.title)})`
  /* a book whose chapters are bare numerals lists its parts alone: a page of "1. I … 7" tells a
     reader nothing */
  const tuple = (list) => bare ? '()' : `(${list.map(entry).join(', ')}${list.length === 1 ? ',' : ''})`
  /* the book in brief first — the modern, accessible reading — and the original text after it, for whoever goes on */
  const partsTypst = twoParts
    ? `((eyebrow: ${w('part-one', 'Part one')}, title: ${w('part-one-title', 'The Modern Edition')}, chapters: ${tuple(briefSrc)}), (eyebrow: ${w('part-two', 'Part two')}, title: ${w('part-two-title', 'The Original Full Text')}, chapters: ${tuple(chapterSrc)}))`
    : 'none'
  const wordsTypst = '(' + Object.entries(words).map(([k, v]) => `${str(k)}: ${str(v)}`).join(', ') + (Object.keys(words).length === 1 ? ',' : '') + ')'
  parts.push(`#show: book.with(title: ${str(book.title || '')}, author: ${str(book.author || '')}, year: ${book.year ? Number(book.year) : 'none'}, description: ${str(book.description || '')}, insight: ${str((companion && companion.insight) || '')}, trim: ${str(trim)}, introduction: ${intro ? 'true' : 'none'}, note: ${note.trim() ? 'true' : 'false'}, chapters: ${tuple(chapterSrc)}, parts: ${partsTypst}, marks: ${marks.length}, words: ${Object.keys(words).length ? wordsTypst : '(:)'})`)
  /* the publisher's note comes first, before the introduction */
  /* the first thing in the body sits on the recto the front matter ends on: no break before it */
  let first = true
  const firstArg = () => { const f = first ? ', first: true' : ''; first = false; return f }
  if (note.trim()) parts.push(`#note-page(${w('note-title', 'A Note on This Edition')}${firstArg()})[\n${blocks(note, [])}\n]`)
  if (intro) parts.push(`#intro-opener([${inline(words['intro-title'] || words.intro || 'Before you begin', [])}], ${w('intro', 'Before you begin')}, eye: ${w('intro-eyebrow', 'Before you begin')}${firstArg()})\n\n${intro}`)
  /* every chapter opens on a page of its own: a right-hand page in a book of long chapters, the
     next page either side in a book of short ones (verses, a page or less each) */
  const avgWords = chapters.reduce((n, ch) => n + String(ch.md || '').split(/\s+/).length, 0) / Math.max(chapters.length, 1)
  const rectoChapters = avgWords > 500
  const chapterOut = (c, lab, odd = true) => {
    parts.push(`#opener(${c.n == null ? 'none' : c.n}, [${inline(c.title, [])}], ${str(c.title)}, label(${str(lab)}), word: ${w('chapter', 'Chapter')}, odd: ${odd ? 'true' : 'false'})\n\n${c.summary || c.essence.length ? keepLast(c.body) : c.body}`)
    if (c.summary || c.essence.length) parts.push(`#companion(summary: ${c.summary ? `[${c.summary}]` : 'none'}, essence: (${c.essence.map((e) => `[${e}]`).join(', ')}${c.essence.length === 1 ? ',' : ''}), brief: ${w('brief', 'In brief')}, insights: ${w('insights', 'Key insights')}, long: ${c.long ? 'true' : 'false'})`)
  }
  if (twoParts) {
    parts.push(`#part-opener(1, ${w('part-one', 'Part one')}, ${w('part-one-title', 'The Modern Edition')}, book-title: ${str(book.title || '')}${firstArg()})`)
    for (const [k, c] of briefSrc.entries()) chapterOut(c, 'ch-1-' + (k + 1), k === 0)
    parts.push(`#part-opener(2, ${w('part-two', 'Part two')}, ${w('part-two-title', 'The Original Full Text')}, book-title: ${str(book.title || '')})`)
    for (const [k, c] of chapterSrc.entries()) chapterOut(c, 'ch-2-' + (c.i + 1), rectoChapters || k === 0)
  } else for (const [k, c] of chapterSrc.entries()) chapterOut(c, 'ch-' + (c.i + 1), rectoChapters || k === 0)
  if (marks.length) {
    /* one list per part — the lines in the order they are met, each with its page and its
       element (which picks the drawing beneath it); a line that begins mid-sentence is given
       its capital, since it stands alone on a page */
    const marksOf = (list) => list.flatMap((c) => c.own)
    const lists = twoParts
      ? [{ title: words['marks-from-edition'] || 'From the Modern Edition', marks: marksOf(briefSrc) }, { title: words['marks-from-text'] || 'From the original full text', marks: marksOf(chapterSrc) }]
      : [{ title: words['marks-from-book'] || 'From the book', marks: marksOf(chapterSrc) }]
    const data = lists.map((l) => `(title: ${str(l.title)}, marks: (${l.marks.map((m) => `(n: ${m.n}, colour: ${str(m.colour || 'sun')}, text: [${inline(m.text.replace(/^[a-z]/, (ch) => ch.toUpperCase()), [])}])`).join(', ')}${l.marks.length === 1 ? ',' : ''}))`).join(', ')
    parts.push(`#marks-page(lists: (${data}${lists.length === 1 ? ',' : ''}), eye: ${w('marks-eyebrow', 'The Highlights')}, title: ${w('marks', 'The lines worth noticing')}, page-word: ${w('page', 'p.')})`)
  }
  return { source: parts.join('\n\n') + '\n', chapters: chapters.length, marks: marks.length }
}

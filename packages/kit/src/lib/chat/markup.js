/*
 * What a person may write in a message, and how it is cut up to be drawn.
 *
 * Every chat surface in the product — a room, a direct message, the desk's queues, the widget —
 * offers the same handful of marks, because they are the marks people already type: **bold**,
 * *italic*, ~~struck~~, `code`, a line beginning `- ` as a bullet, a line beginning `> ` as a
 * quotation, and a bare url or a [word](url) as a link. Nothing else. This is deliberately NOT
 * markdown: a message is one person talking, not a document, and a heading, a table or an image
 * tag in a chat line is somebody's punctuation being read as a command.
 *
 * It is a parser and not a renderer: it returns parts, and the component draws them with real
 * elements. Nothing here ever produces html, so nothing a person types can become markup.
 *
 * Pure, no imports, pinned by build/markup.test.mjs.
 */

/* a mark's opening and closing run, longest first so ** is never read as two * */
const MARKS = [
  { mark: 'b', tag: '**' },
  { mark: 's', tag: '~~' },
  { mark: 'i', tag: '*' },
  { mark: 'i', tag: '_' },
]
const CODE = '`'
/* a bare address: http(s), or a www. that a person wrote without one */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()[\]]+[^\s<>()[\].,;:!?'"]/gi
const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g

const href = (raw) => (/^www\./i.test(raw) ? 'https://' + raw : raw)

/* ------------------------------------------------------------------ inline */

/* the text between the marks, as parts carrying the marks they are under. Code is taken first and
   whole: what is inside it is text, never a mark, which is the whole point of writing it in code. */
export function inlineParts(text, marks = []) {
  const s = String(text == null ? '' : text)
  if (!s) return []
  const out = []

  /* `code` — the one mark that stops the others */
  const c1 = s.indexOf(CODE)
  if (c1 >= 0) {
    const c2 = s.indexOf(CODE, c1 + 1)
    if (c2 > c1 + 1) {
      out.push(...inlineParts(s.slice(0, c1), marks))
      out.push({ kind: 'text', text: s.slice(c1 + 1, c2), marks: marks.concat('code') })
      out.push(...inlineParts(s.slice(c2 + 1), marks))
      return out
    }
  }

  for (const { mark, tag } of MARKS) {
    const a = s.indexOf(tag)
    if (a < 0) continue
    const b = s.indexOf(tag, a + tag.length)
    if (b < 0) continue
    const inner = s.slice(a + tag.length, b)
    /* ** ** with nothing between it is two asterisks somebody typed, not a mark */
    if (!inner.trim()) continue
    out.push(...inlineParts(s.slice(0, a), marks))
    out.push(...inlineParts(inner, marks.includes(mark) ? marks : marks.concat(mark)))
    out.push(...inlineParts(s.slice(b + tag.length), marks))
    return out
  }

  return linkParts(s, marks)
}

/* an address is a part of its own, so the surface can make it a link without ever writing html */
function linkParts(s, marks) {
  const out = []
  let last = 0
  const spans = []
  for (const m of s.matchAll(LINK_RE)) spans.push({ at: m.index, len: m[0].length, text: m[1], to: m[2] })
  for (const m of s.matchAll(URL_RE)) {
    if (spans.some((x) => m.index >= x.at && m.index < x.at + x.len)) continue
    spans.push({ at: m.index, len: m[0].length, text: m[0], to: href(m[0]) })
  }
  spans.sort((x, y) => x.at - y.at)
  for (const sp of spans) {
    if (sp.at < last) continue
    if (sp.at > last) out.push({ kind: 'text', text: s.slice(last, sp.at), marks })
    out.push({ kind: 'link', text: sp.text, href: sp.to, marks })
    last = sp.at + sp.len
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last), marks })
  return out
}

/* ------------------------------------------------------------------ blocks */

/* A MESSAGE IS PARAGRAPHS, and two of its lines mean something on their own: one beginning `- ` is
   an item of a list, one beginning `> ` is quoted. A run of either is one block, so a list of three
   is a list and not three lists. Everything else is prose, and its own newlines are kept. */
export function messageBlocks(body, inline = inlineParts) {
  const whole = String(body == null ? '' : body)
  if (!whole.trim()) return []   /* an empty message draws nothing, not an empty paragraph */
  const lines = whole.split('\n')
  const out = []
  let prose = []
  const flush = () => { if (prose.length) { out.push({ kind: 'p', lines: prose.map((l) => inline(l)) }); prose = [] } }
  for (const line of lines) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (bullet) {
      flush()
      const last = out[out.length - 1]
      const parts = inline(bullet[1])
      if (last && last.kind === 'ul') last.lines.push(parts)
      else out.push({ kind: 'ul', lines: [parts] })
    } else if (quote) {
      flush()
      const last = out[out.length - 1]
      const parts = inline(quote[1])
      if (last && last.kind === 'quote') last.lines.push(parts)
      else out.push({ kind: 'quote', lines: [parts] })
    } else {
      prose.push(line)
    }
  }
  flush()
  return out
}

/* the words with every mark taken off — what a preview, a search row, a notification and a
   transcript say, where a bold asterisk would be noise */
export function plainMarkup(body) {
  return messageBlocks(body).map((b) => b.lines.map((parts) => parts.map((p) => p.text).join('')).join('\n')).join('\n')
}

/*
 * A SAVE THAT KEEPS WHAT THE FILE SAID ABOUT ITSELF.
 *
 * The admin reads a record's front matter into an object, the person edits fields, and the object
 * is written back. Comments are not data, so a round trip through a parser loses them — and what
 * they carry is the only documentation at the point of use: the vocabulary of a field (`off ·
 * everyone · members · hosts`), the reason a default is what it is ("a score changes what people
 * write as well as what they read"), the rule that is not obvious ("Scunthorpe is not held by a
 * word inside it"). The admin's own help text says some of it and the docs site says more, but
 * neither is in front of somebody editing the file in a checkout, which is who those lines are for.
 * Losing them silently, on somebody else's save, is how a deliberate default gets tidied away later
 * by a person who never knew why it was set.
 *
 * So a file that HAS comments is written by editing its own document rather than by building a new
 * one: the parsed tree is kept and only what actually changed is touched. A file with no comments
 * takes the path it always took, byte for byte, because there is nothing to preserve and a second
 * serialiser is a second set of formatting habits.
 *
 * WHAT SURVIVES. A comment above a key, a comment at the end of its line, the blank lines between
 * groups of keys, the order the file puts them in, and the quoting and flow style of every value
 * nobody touched. A key that is REMOVED takes its own comments with it, which is right — they
 * described it. A key that is ADDED arrives with none, because nobody has written any.
 *
 * WHAT IT IS NOT. It is not a formatter: a file's existing style is left alone rather than
 * normalised, so saving a record changes the lines that changed and nothing else.
 */
import YAML from 'yaml'

/* deep value equality over what YAML holds: scalars, arrays, plain objects. Used to leave a key
   entirely alone when the save did not change it — which is what keeps the rest of the file's
   formatting exactly as its author wrote it. */
export function same(a, b) {
  if (a === b) return true
  if (a instanceof Date) a = a.toISOString().slice(0, 10)
  if (b instanceof Date) b = b.toISOString().slice(0, 10)
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => same(v, b[i]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && same(a[k], b[k]))
  }
  return false
}

/* whether this document carries anything a rebuild would throw away */
export function hasComments(doc) {
  if (doc.commentBefore || doc.comment) return true
  let found = false
  YAML.visit(doc, {
    Node(_, node) { if (node.comment || node.commentBefore) { found = true; return YAML.visit.BREAK } },
    Pair(_, pair) { if (pair.key?.comment || pair.key?.commentBefore || pair.value?.comment || pair.value?.commentBefore) { found = true; return YAML.visit.BREAK } },
  })
  return found
}

/*
 * The value of a pair carries its END-OF-LINE comment (`allow: off   # off · everyone …`), so
 * replacing the value drops the very thing this module exists to keep. The comment describes the
 * FIELD and not the value that happened to be in it, so it is lifted off the old value and put on
 * the new one. `commentBefore` and `spaceBefore` sit on the key and survive by themselves.
 */
function setValue(doc, node, key, value) {
  const pair = node.items.find((p) => String(p.key?.value ?? p.key) === key)
  if (!pair) { node.set(doc.createNode(key), doc.createNode(value)); return }
  const keep = { comment: pair.value?.comment, spaceBefore: pair.value?.spaceBefore }
  pair.value = doc.createNode(value)
  if (keep.comment != null) pair.value.comment = keep.comment
  if (keep.spaceBefore) pair.value.spaceBefore = keep.spaceBefore
}

/*
 * A MAP IS MERGED KEY BY KEY, not replaced whole: a nested block (a book's `print:`, an article's
 * `comments:`) has comments of its own inside it, and setting the whole block because one field
 * under it moved would lose every one of them.
 */
function mergeMap(doc, node, data) {
  const want = new Set(Object.keys(data))
  for (const pair of [...node.items]) {
    const k = String(pair.key?.value ?? pair.key)
    if (!want.has(k)) { node.delete(pair.key); continue }   /* gone from the record: its comments described it, and go with it */
    const was = pair.value ? pair.value.toJSON() : undefined
    const now = data[k]
    if (same(was, now)) continue                            /* untouched: leave the author's own formatting alone */
    if (YAML.isMap(pair.value) && now && typeof now === 'object' && !Array.isArray(now) && !(now instanceof Date)) mergeMap(doc, pair.value, now)
    else setValue(doc, node, k, now)
  }
  for (const k of want) if (!node.items.some((p) => String(p.key?.value ?? p.key) === k)) node.set(doc.createNode(k), doc.createNode(data[k]))
}

/*
 * The front matter as it should now read, or null when there is nothing to preserve and the caller
 * should write it the way it has always written it.
 *
 * `current` is the whole file as it stands — which is the checkout's file in one shape and the
 * row's text in another, and this neither knows nor cares which: it is handed the text.
 */
/*
 * The whole file, for a grammar that writes its own. A record with a grammar of its own still has
 * front matter and still deserves to keep what it says about itself — the comment policy is the
 * file this was written for, and it has one. The alternative is each of them keeping a copy of
 * this decision, which is how two of them end up disagreeing.
 */
export function writeKeeping(current, data, body, stringify) {
  const kept = current ? keepComments(current, data) : null
  return kept == null ? stringify() : '---\n' + kept + '\n---\n' + body
}

export function keepComments(current, data) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(String(current || ''))
  if (!m) return null
  let doc
  try { doc = YAML.parseDocument(m[1], { keepSourceTokens: false }) } catch { return null }
  if (doc.errors?.length || !YAML.isMap(doc.contents) || !hasComments(doc)) return null
  if (same(doc.contents.toJSON(), data)) return m[1]
  mergeMap(doc, doc.contents, data)
  /*
   * toString renders the WHOLE tree, not only what moved, so the library's own style defaults
   * would reach lines nobody edited. Two are pinned to what this project writes: lineWidth 0 is
   * gray-matter's `lineWidth: -1` (never fold a long line — a folded url is a diff nobody asked
   * for), and no padding inside a flow collection, so [yes, maybe, no] stays as it was typed
   * rather than coming back as [ yes, maybe, no ] on a save that changed nothing.
   */
  return realign(doc.toString({ lineWidth: 0, flowCollectionPadding: false }).replace(/\n$/, ''), m[1])
}

/*
 * THE LIBRARY PUTS ONE SPACE BEFORE AN END-OF-LINE COMMENT; A PERSON LINES THEM UP.
 *
 * Which means a no-op save would reflow the comment column of every file that has one — the exact
 * "it rewrote my file" this was written to prevent, arriving by the other door. A line whose code
 * and whose comment are both unchanged is therefore emitted as the source wrote it, spacing and
 * all. Only a line that actually differs is left as the library set it, because there is no
 * original spacing for a line that did not exist.
 *
 * The split is on the LAST ` #`, and both halves must match for a line to be restored — so a `#`
 * inside a quoted value can only ever fail to match, never restore the wrong line.
 */
function realign(out, src) {
  const cut = (line) => { const i = line.lastIndexOf(' #'); return i < 0 ? null : [line.slice(0, i).replace(/\s+$/, ''), line.slice(i + 1)] }
  const was = new Map()
  for (const line of src.split('\n')) { const c = cut(line); if (c) was.set(c[0] + '\u0000' + c[1], line) }
  const lines = out.split('\n').map((line) => {
    const c = cut(line)
    if (!c) return line
    const had = was.get(c[0] + '\u0000' + c[1])
    return had == null ? line : had
  })
  /* and the blank lines the front matter opens with, which the library also tidies away. A file
     that begins with air begins with air after a save too: that is a line of somebody's diff. */
  const blanks = (t) => { let i = 0; const l = t.split('\n'); while (i < l.length && l[i].trim() === '') i++; return i }
  const owed = blanks(src) - blanks(lines.join('\n'))
  return (owed > 0 ? '\n'.repeat(owed) : '') + lines.join('\n')
}

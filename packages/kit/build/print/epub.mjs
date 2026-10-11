/*
 * The EPUB of an edition, from the same words the print is set from: the note, the
 * introduction, the parts and chapters as build/print/typeset.mjs plans them (the same
 * numbering and titles), each chapter with its key insights after it, every `==mark==`
 * a highlight, and the highlights gathered at the back with links to their chapters
 * (an EPUB has no pages). EPUB 3, one XHTML file per chapter, a stylesheet in the
 * spirit of the printed page, the site's cover art as the cover. The zip is fflate's:
 * the mimetype first and stored, as the format asks.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { zipSync, strToU8 } from 'fflate'
import { Marked } from 'marked'
import { plan, flow } from './typeset.mjs'

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/* markdown → XHTML, with the book's marks as <mark> and its escapes read as themselves */
const md = new Marked({ gfm: true, breaks: false })
md.use({
  extensions: [{
    name: 'sysmark', level: 'inline',
    start(src) { const i = src.indexOf('=='); return i < 0 ? undefined : i },
    tokenizer(src) { const m = /^==(?=\S)([\s\S]*?\S)==(?:\{([a-z]+)\})?/.exec(src); if (!m) return; return { type: 'sysmark', raw: m[0], colour: m[2] || 'sun', tokens: this.lexer.inlineTokens(m[1]) } },
    renderer(tok) { return `<mark class="hl">${this.parser.parseInline(tok.tokens)}</mark>` },
  }],
})
/* what marked writes is HTML; an EPUB wants XHTML — the few differences closed here */
const xhtml = (html) => html.replace(/<(br|hr|img[^>]*)>/g, '<$1 />').replace(/&nbsp;/g, '&#160;').replace(/&([a-z]+);/g, (m, e) => (['amp', 'lt', 'gt', 'quot', 'apos'].includes(e) ? m : m))
const render = (src) => xhtml(md.parse(flow(src).replace(/\\\n/g, '  \n')))
const plain = (s) => String(s || '').replace(/==([^=]+)==(?:\{[a-z]+\})?/g, '$1').replace(/\\\n|  \n/g, ' ').replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, '$1').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(\*|_)(.+?)\1/g, '$2')

const CSS = `
@page { margin: 1em; }
body { font-family: Georgia, "Times New Roman", serif; line-height: 1.55; color: #1e1a17; }
h1, h2, h3 { font-weight: 600; line-height: 1.2; }
.eyebrow { font-family: Menlo, Consolas, monospace; font-size: 0.66em; letter-spacing: 0.14em; text-transform: uppercase; color: #8a847c; margin: 0 0 0.6em; }
.opener { margin-top: 18vh; }
.opener h1 { font-size: 1.9em; margin: 0 0 1.2em; }
.part { text-align: center; margin-top: 30vh; }
.part h1 { font-size: 1.6em; letter-spacing: 0.06em; text-transform: uppercase; margin: 0.3em 0 0.2em; }
.part p { color: #5a554f; margin: 0; }
.title { text-align: center; margin-top: 22vh; }
.title h1 { font-size: 2em; margin: 0 0 0.5em; }
.title .author { color: #5a554f; }
.title .edition { margin-top: 30vh; }
p { margin: 0 0 0.75em; text-align: left; }
.verse p { margin-left: 1.2em; }
blockquote { margin: 1em 1.6em; color: #5a554f; }
mark.hl { background: #fbeeb6; color: inherit; border-radius: 3px; padding: 0 0.1em; }
.companion { border-top: 1px solid #ddd8d0; border-bottom: 1px solid #ddd8d0; padding: 0.9em 0; margin: 2em 0 1em; font-size: 0.94em; }
.companion ol { margin: 0.4em 0 0 1.2em; padding: 0; }
.companion li { margin: 0 0 0.35em; }
.marks li { margin: 0 0 1.4em; list-style: none; font-size: 1.05em; line-height: 1.5; }
.marks ol { margin: 0; padding: 0; }
.marks .where { display: block; font-family: Menlo, Consolas, monospace; font-size: 0.66em; letter-spacing: 0.12em; text-transform: uppercase; color: #8a847c; margin-top: 0.3em; }
.rule { text-align: center; color: #8a847c; margin: 1.6em 0; }
`

const doc = (title, body, lang = 'en') => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8" /><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css" /></head>
<body>
${body}
</body>
</html>
`

/*
 * THE EDITION AS ONE EPUB — the bytes, a Uint8Array and not a Buffer: Deno has no Buffer global,
 * and this is one of the modules an Edge Function runs to set a book where there is no machine.
 * Node writes a Uint8Array to a file, and uploads it, exactly as it did a Buffer.
 *
 * `art` is the cover picture, HANDED IN rather than looked for: on a machine print.mjs reads it
 * off the disk, and in an Edge Function there is no disk — it already has the bytes it sized for
 * the paperback. A module that opens a file itself is a module only one of the two can run.
 * (`root` stays for the old way: a picture written beside the book's markdown.)
 */
export async function makeEpub({ book, companion, contents = 'parts', note = '', words = {}, root = process.cwd(), art = null }) {
  /* who published it: the site's own word, never a constant — this was hardcoded to one
     customer's name, so every book every site made said that in its metadata */
  const publisher = String(words.publisher || words.site || '').trim()
  const W = (k, d) => words[k] || d
  const { twoParts, chapters } = plan({ book, companion, contents })
  const files = []            /* { id, href, title, body, nav } */
  const add = (id, title, body, nav = true) => { files.push({ id, href: id + '.xhtml', title, body, nav }); return files.length - 1 }
  const marks = []            /* { text, href, part } */
  const collect = (src, href, part) => { for (const m of flow(src).matchAll(/==(?=\S)([\s\S]*?\S)==(?:\{([a-z]+)\})?/g)) marks.push({ text: plain(m[1]).replace(/\s+/g, ' ').trim(), href, part }) }

  /* the title page, the note, the introduction */
  add('title', book.title, `<section class="title" epub:type="titlepage"><h1>${esc(book.title)}</h1><p class="author">${esc(book.author || '')}</p><p class="edition eyebrow">${esc(W('edition', 'The modern edition'))}</p></section>`, false)
  if (String(note || '').trim()) add('note', W('note-title', 'A Note on This Edition'), `<section class="opener"><h1>${esc(W('note-title', 'A Note on This Edition'))}</h1>${render(note)}</section>`)
  if (book.introduction) { add('intro', W('intro', 'Before you begin'), `<section class="opener"><p class="eyebrow">${esc(W('intro-eyebrow', 'Before you begin'))}</p><h1>${esc(W('intro-title', words.intro || 'Before you begin'))}</h1>${render(book.introduction)}</section>`); collect(book.introduction, 'intro.xhtml', null) }

  const chapterFile = (c, id, text, essence, part) => {
    const head = `<section class="opener"><p class="eyebrow">${c.n == null ? '' : esc(W('chapter', 'Chapter') + ' ' + c.n)}</p><h1>${esc(c.title)}</h1>`
    const box = essence.length ? `<aside class="companion"><p class="eyebrow">${esc(W('insights', 'Key insights'))}</p><ol>${essence.map((e) => `<li>${render(e).replace(/^<p>|<\/p>\s*$/g, '')}</li>`).join('')}</ol></aside>` : ''
    add(id, c.n == null ? c.title : c.n + '. ' + c.title, head + render(text) + box + '</section>')
    collect(text, id + '.xhtml', part)
  }
  if (twoParts) {
    const one = W('part-one-title', 'The Modern Edition'), two = W('part-two-title', 'The Original Full Text')
    add('part-1', one, `<section class="part"><p class="eyebrow">${esc(W('part-one', 'Part one'))}</p><h1>${esc(book.title)}</h1><p>${esc(one)}</p></section>`)
    for (const c of chapters) if (c.summaryMd.trim() || c.essence.length) chapterFile(c, `ch-1-${c.i + 1}`, c.summaryMd, c.essence, one)
    add('part-2', two, `<section class="part"><p class="eyebrow">${esc(W('part-two', 'Part two'))}</p><h1>${esc(book.title)}</h1><p>${esc(two)}</p></section>`)
    for (const c of chapters) chapterFile(c, `ch-2-${c.i + 1}`, c.md, [], two)
  } else {
    for (const c of chapters) chapterFile(c, `ch-${c.i + 1}`, contents === 'summary' ? c.summaryMd : c.md, contents === 'full' ? [] : c.essence, null)
  }
  /* the highlights, gathered: by part when there are two */
  if (marks.length) {
    const groups = twoParts
      ? [[W('marks-from-edition', 'From the Modern Edition'), marks.filter((m) => m.part === W('part-one-title', 'The Modern Edition'))], [W('marks-from-text', 'From the original full text'), marks.filter((m) => m.part === W('part-two-title', 'The Original Full Text'))]]
      : [[W('marks-from-book', 'From the book'), marks]]
    const body = `<section class="opener marks"><p class="eyebrow">${esc(W('marks-eyebrow', 'The Highlights'))}</p><h1>${esc(W('marks', 'The lines worth noticing'))}</h1>` +
      groups.filter(([, l]) => l.length).map(([t, l]) => `<h2 class="eyebrow">${esc(t)}</h2><ol>${l.map((m) => `<li>${esc(m.text)}<a class="where" href="${m.href}">${esc(files.find((f) => f.href === m.href)?.title || '')}</a></li>`).join('')}</ol>`).join('') + '</section>'
    add('marks', W('marks', 'The lines worth noticing'), body)
  }

  /* the cover: the site's art, when the book has it — handed in, or read from beside the book */
  let cover = art
  const coverSrc = book.cover && (book.cover.src || book.cover)
  if (!cover && typeof coverSrc === 'string' && /^\.?\//.test(coverSrc) && fs) {
    const p = path.join(root, 'content/books', coverSrc.replace(/^\.\//, ''))
    if (fs.existsSync(p)) cover = { name: 'cover' + path.extname(p).toLowerCase(), data: fs.readFileSync(p), type: /\.png$/i.test(p) ? 'image/png' : 'image/jpeg' }
  }

  const uid = 'urn:uuid:' + createHash('sha1').update(book.slug + ':' + contents).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5')
  const manifest = files.map((f) => `<item id="${f.id}" href="${f.href}" media-type="application/xhtml+xml" />`).join('\n    ')
  const spine = files.map((f) => `<itemref idref="${f.id}" />`).join('\n    ')
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${uid}</dc:identifier>
    <dc:title>${esc(book.title)}</dc:title>
    <dc:creator>${esc(book.author || '')}</dc:creator>
    <dc:language>en</dc:language>
    ${publisher ? `<dc:publisher>${esc(publisher)}</dc:publisher>` : ''}
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
    ${cover ? '<meta name="cover" content="cover-image" />' : ''}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="css" href="style.css" media-type="text/css" />
    ${cover ? `<item id="cover-image" href="${cover.name}" media-type="${cover.type}" properties="cover-image" />\n    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" />` : ''}
    ${manifest}
  </manifest>
  <spine>
    ${cover ? '<itemref idref="cover" linear="yes" />' : ''}
    ${spine}
  </spine>
</package>
`
  const nav = doc(book.title, `<nav epub:type="toc" id="toc"><h1>${esc(W('contents', 'Contents'))}</h1><ol>${files.filter((f) => f.nav).map((f) => `<li><a href="${f.href}">${esc(f.title)}</a></li>`).join('')}</ol></nav>`)
  const zip = { mimetype: [strToU8('application/epub+zip'), { level: 0 }] }
  zip['META-INF/container.xml'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles></container>\n`)
  zip['OEBPS/content.opf'] = strToU8(opf)
  zip['OEBPS/nav.xhtml'] = strToU8(nav)
  zip['OEBPS/style.css'] = strToU8(CSS)
  if (cover) { zip['OEBPS/' + cover.name] = new Uint8Array(cover.data); zip['OEBPS/cover.xhtml'] = strToU8(doc(book.title, `<section epub:type="cover" style="text-align:center;margin:0"><img src="${cover.name}" alt="${esc(book.title)}" style="max-height:95vh;max-width:100%" /></section>`)) }
  for (const f of files) zip['OEBPS/' + f.href] = strToU8(doc(f.title, f.body))
  return zipSync(zip, { level: 6 })
}

/*
 * The one markdown renderer for a document (an article, a wiki page, a doc, an ad, a product's copy): marked,
 * gfm, every heading given its id (github-slugger, as GitHub does) and wrapped in an anchor to itself, and a
 * fenced code block handed to a highlighter when one is given — the build's is shiki (build/velite.mjs), the
 * browser's none, so the same document renders the same html either side but for the colours inside a
 * <pre>, which come with the deploy. `plain(html)` is the text of the html as a browser reads it, what the
 * excerpt and the word count are made from; `toc(md)` the headings as a tree ({ title, url, items }).
 *
 * The book reader has its own marked with the ==marks== extension; the landing sections their inline one;
 * this is the document's, and velite's markdown schema is pointed at it, so a row rendered in the browser
 * (lib/content-live.js) is the entry the build would have made.
 */
import { Marked, Renderer } from 'marked'
import GithubSlugger from 'github-slugger'

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const unescape = (s) => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]))
const textOf = (tokens) => (tokens || []).map((t) => (t.tokens ? textOf(t.tokens) : t.type === 'text' || t.type === 'codespan' || t.type === 'escape' ? unescape(t.text) : t.raw || '')).join('')

/* a renderer: `highlight(code, lang) → html | null` (async allowed) decorates a fenced block; without one the
   block is escaped with its language on the code element, as marked writes it */
export function renderer({ highlight } = {}) {
  /*
   * THE SLUGGER BELONGS TO ONE PARSE, AND SO DOES EVERYTHING THAT READS IT.
   *
   * It used to be a variable of the renderer, reset at the top of parse() — which is safe only while
   * no two parses overlap. An async parse (the highlighter) yields, so two documents parsed at once
   * on one renderer share the slugger: the second resets what the first was using and their headings
   * are numbered against each other. The comment here predicted it; velite never showed it, because
   * velite parses one document at a time. A content engine that transforms documents concurrently
   * shows it at once — the second product with a "What's included" heading came out as
   * whats-included-1, and every anchor and table of contents pointing at it was wrong.
   *
   * So a parse builds its own marked, with its own renderer and its own slugger, and nothing is
   * shared between two of them. It costs an object per document, which is nothing beside
   * highlighting a single fenced block.
   */
  const make = () => {
    const slugger = new GithubSlugger()
    const r = new Renderer()
    r.heading = function ({ tokens, depth, id: given }) {
      const text = this.parser.parseInline(tokens)
      const id = given ?? slugger.slug(textOf(tokens))
      return `<h${depth} id="${id}"><a class="anchor" href="#${id}">${text}</a></h${depth}>\n`
    }
    r.code = function ({ text, lang, html }) {
      if (html) return html
      const l = (lang || '').match(/^\S*/)[0]
      return `<pre><code${l ? ` class="language-${escape(l)}"` : ''}>${escape(text)}\n</code></pre>\n`
    }
    const ids = (t) => { if (t.type === 'heading') t.id = slugger.slug(textOf(t.tokens)) }
    return new Marked({ gfm: true, renderer: r, async: !!highlight, walkTokens: highlight ? async (t) => { ids(t); if (t.type === 'code') { try { t.html = await highlight(t.text, (t.lang || '').match(/^\S*/)[0]) } catch { t.html = null } } } : ids })
  }
  return {
    /* the html; each document gets its own marked, so its own slugger, so its own numbering */
    parse(md) { const out = make().parse(String(md == null ? '' : md)); return typeof out.then === 'function' ? out.then(quotes) : quotes(out) },
    toc(md) { return tocOf(String(md == null ? '' : md), make()) },
  }
}

/* a quote or an apostrophe in prose stays itself (marked writes the entity; rehype did not, and the text reads the same) — inside a tag it is left alone */
const quotes = (html) => html.replace(/(<[^>]*>)|&#39;|&quot;/g, (m, tag) => (tag ? tag : m === '&#39;' ? "'" : '"'))

/* the headings of a document as a tree, urls to their ids, the shape velite's toc gave */
function tocOf(md, m) {
  const slugger = new GithubSlugger()
  const root = { items: [] }, stack = [{ depth: 0, node: root }]
  for (const t of m.lexer(md)) {
    if (t.type !== 'heading') continue
    const node = { title: textOf(t.tokens), url: '#' + slugger.slug(textOf(t.tokens)), items: [] }
    while (stack.length > 1 && stack[stack.length - 1].depth >= t.depth) stack.pop()
    stack[stack.length - 1].node.items.push(node)
    stack.push({ depth: t.depth, node })
  }
  return root.items
}

/* the text of the html, the tags gone and the entities read, as an excerpt or a word count sees it */
export function plain(html) {
  if (typeof DOMParser !== 'undefined') { try { return new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent || '' } catch { /* below */ } }
  return String(html || '').replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" }[e]))
}
/* velite's reading time and word count over the plain text, kept to the letter (265 words a minute, never zero) */
export function metadata(text) {
  const words = (String(text || '').match(/['’]?([a-zA-Z]+(?:['’]?[a-zA-Z]+)*)/g) || []).length
  const time = Math.round(words / 265)
  return { readingTime: time === 0 ? 1 : time, wordCount: words }
}

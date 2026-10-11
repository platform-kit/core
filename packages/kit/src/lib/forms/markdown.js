/*
 * A form's free copy → HTML: the bindings and nunjucks tags rendered first (logic.js), then marked
 * with forms.md's block attributes honoured — a paragraph, a heading or a list whose first line is
 * `[#id .class attr="v"]` wears them, the classes prefixed as forms.md prefixes them (`fmd-`), which is
 * what lets its utility classes (`.fmd-text-center`, `.fmd-mb-2`, `.fmd-col-6`…) mean the same here
 * (the theme's form stylesheet defines the set). A private Marked instance: nothing else on the page
 * shares its renderer. Sanitising is the caller's (DOMPurify, in a browser).
 */
import { Marked, Lexer } from 'marked'
import { parseElemAttrs } from '../../../vendor/formsmd/attrs-parse.js'
import { renderCopy } from './logic.js'

const ATTRS = /^\[(.*?)\]\s*/s
const md = new Marked({ gfm: true, breaks: false })
md.use({
  renderer: {
    paragraph(token) {
      const text = token.text || ''
      const m = ATTRS.exec(text)
      if (!m) return false   /* the default */
      const inner = this.parser.parseInline(Lexer.lexInline(text.slice(m[0].length), this.parser.options))
      return `<p ${parseElemAttrs(m[1], 'fmd-')}>${inner}</p>\n`
    },
    heading(token) {
      const text = token.text || ''
      const m = ATTRS.exec(text)
      if (!m) return false
      const inner = this.parser.parseInline(Lexer.lexInline(text.slice(m[0].length), this.parser.options))
      return `<h${token.depth} ${parseElemAttrs(m[1], 'fmd-')}>${inner}</h${token.depth}>\n`
    },
    list(token) {
      const first = token.items && token.items[0]
      const m = first && ATTRS.exec(first.text || '')
      if (!m) return false
      const tag = token.ordered ? 'ol' : 'ul'
      const body = token.items.slice(1).map((it) => `<li>${this.parser.parseInline(Lexer.lexInline(it.text, this.parser.options))}</li>\n`).join('')
      return `<${tag} ${parseElemAttrs(m[1], 'fmd-')}>\n${body}</${tag}>\n`
    },
  },
})

/* the copy of a block, as HTML, over the context (data + answers) */
export function renderMarkdown(text, ctx) {
  const src = renderCopy(text, ctx)
  try { return md.parse(src) } catch (e) { if (typeof console !== 'undefined') console.warn('[forms] copy not rendered: ' + (e.message || e)); return `<p>${String(src).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</p>` }
}

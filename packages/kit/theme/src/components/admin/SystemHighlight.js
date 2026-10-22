/*
 * System highlights inside the admin's TipTap editor.
 *
 * Books carry baked-in editorial marks written straight into the markdown as
 * `==text==`, rendered on the site as a coloured wavy underline, with an optional
 * colour tag after the close: `==text=={ocean}` (default `sun`). See
 * BookReader.vue for the reader-side `marked` extension and AGENTS.md for the
 * five-colour element code.
 *
 * Without an extension for it, TipTap's markdown layer would treat `==…=={x}` as
 * plain text and could reflow or mangle it on a round-trip. This makes it a real
 * mark instead: markdown-it parses `==…=={colour}` into the mark on the way in, the
 * editor shows the wavy underline, and the serialiser writes exactly `==…=={colour}`
 * back out (bare `==…==` for the default `sun`), so an edited book file keeps its
 * marks intact.
 */
import { Mark, mergeAttributes } from '@tiptap/core'

const COLORS = ['sun', 'leaf', 'sky', 'ocean', 'ember']
const MARKER = 0x3d /* = */

/* a markdown-it inline plugin: pair `==` delimiters (like markdown-it-mark) and
   absorb an optional trailing `{colour}` into the opening token */
function markdownItSysHl(md) {
  function tokenize(state, silent) {
    const marker = state.src.charCodeAt(state.pos)
    if (silent || marker !== MARKER) return false
    const scanned = state.scanDelims(state.pos, true)
    let len = scanned.length
    if (len < 2) return false
    if (len % 2) { const t = state.push('text', '', 0); t.content = '='; len-- }
    for (let i = 0; i < len; i += 2) {
      const t = state.push('text', '', 0); t.content = '=='
      state.delimiters.push({ marker, length: 0, token: state.tokens.length - 1, end: -1, open: scanned.can_open, close: scanned.can_close })
    }
    state.pos += scanned.length
    return true
  }

  function postProcess(state, delimiters) {
    const lone = []
    for (let i = 0; i < delimiters.length; i++) {
      const start = delimiters[i]
      if (start.marker !== MARKER || start.end === -1) continue
      const end = delimiters[start.end]
      const open = state.tokens[start.token]
      const close = state.tokens[end.token]

      /* a trailing {colour} sits in the text token right after the close. Keep the
         tag verbatim so an explicit `{sun}` is written back as `{sun}`, not dropped */
      let color = 'sun', raw = ''
      const after = state.tokens[end.token + 1]
      if (after && after.type === 'text') {
        const m = /^\{([a-z]+)\}/.exec(after.content)
        if (m && COLORS.includes(m[1])) { color = m[1]; raw = m[0]; after.content = after.content.slice(m[0].length) }
      }

      open.type = 'systemHighlight_open'; open.tag = 'span'; open.nesting = 1; open.markup = '=='; open.content = ''
      open.attrSet('data-sys-hl', color); open.attrSet('data-sys-raw', raw)
      close.type = 'systemHighlight_close'; close.tag = 'span'; close.nesting = -1; close.markup = '=='; close.content = ''

      if (state.tokens[end.token - 1].type === 'text' && state.tokens[end.token - 1].content === '=') lone.push(end.token - 1)
    }
    while (lone.length) {
      const j = lone.pop(); let k = j + 1
      while (k < state.tokens.length && state.tokens[k].type === 'systemHighlight_close') k++
      k--
      if (j !== k) { const t = state.tokens[k]; state.tokens[k] = state.tokens[j]; state.tokens[j] = t }
    }
  }

  md.inline.ruler.before('emphasis', 'system_highlight', tokenize)
  md.inline.ruler2.before('emphasis', 'system_highlight', (state) => {
    const tokens = state.tokens_meta, max = (state.tokens_meta || []).length
    postProcess(state, state.delimiters)
    for (let i = 0; i < max; i++) if (tokens[i] && tokens[i].delimiters) postProcess(state, tokens[i].delimiters)
  })
}

export default Mark.create({
  name: 'systemHighlight',
  inclusive: false,

  addAttributes() {
    return {
      color: {
        default: 'sun',
        parseHTML: (el) => el.getAttribute('data-sys-hl') || 'sun',
        renderHTML: (attrs) => ({ 'data-sys-hl': attrs.color || 'sun' }),
      },
      /* the colour tag exactly as authored ('{sun}', '{leaf}', … or '' for none),
         kept so the serialiser reproduces the source byte-for-byte */
      raw: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-sys-raw') || '',
        renderHTML: (attrs) => (attrs.raw ? { 'data-sys-raw': attrs.raw } : {}),
      },
    }
  },

  parseHTML() { return [{ tag: 'span[data-sys-hl]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'sys-hl' }), 0]
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: '==',
          close: (_state, mark) => '==' + (mark.attrs.raw || (mark.attrs.color && mark.attrs.color !== 'sun' ? `{${mark.attrs.color}}` : '')),
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: { setup: (md) => md.use(markdownItSysHl) },
      },
    }
  },
})

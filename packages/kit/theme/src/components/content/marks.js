/*
 * THE HOUSE MARKS (the e-book's, and a course lesson's): `==text==` becomes a suggestion, a wavy coloured underline,
 * deliberately not a background, so it reads as "this line is worth noticing" without pre-empting a reader's own
 * highlighting. An optional colour tag follows the close, `==text=={ocean}`, and says what the line speaks to:
 * ember spirit · sky mind · leaf practice and conduct · ocean feeling · sun a truth that holds at every level.
 * The default is sun. A mark carries no `bk-hl` class, so the reader's highlight menu never treats it as theirs.
 * The look is marks.css.
 */
import './marks.css'

export const MARK_COLORS = ['sun', 'leaf', 'sky', 'ocean', 'ember']
export const MARK_RE = /==(?=\S)([\s\S]*?\S)==(?:\{([a-z]+)\})?/g
export const markColor = (c) => (MARK_COLORS.includes(c) ? c : 'sun')

/* the marked extension: a mark is inline, and its words keep their own markdown */
export const sysmark = {
  extensions: [{
    name: 'sysmark',
    level: 'inline',
    start(src) { const i = src.indexOf('=='); return i < 0 ? undefined : i },
    tokenizer(src) {
      const m = /^==(?=\S)([\s\S]*?\S)==(?:\{([a-z]+)\})?/.exec(src)
      if (!m) return
      return { type: 'sysmark', raw: m[0], color: markColor(m[2]), tokens: this.lexer.inlineTokens(m[1]) }
    },
    renderer(token) {
      return `<mark class="sys-mark sug-${token.color}">${this.parser.parseInline(token.tokens)}</mark>`
    },
  }],
}

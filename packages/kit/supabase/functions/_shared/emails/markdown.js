/*
 * A funnel step's or a blast's markdown as an email can carry it: marked's html with the
 * styles an email needs written INLINE on every element (a mail client keeps no stylesheet
 * for the body a design drops in), in the site's face and colours as the designs use them.
 * The body is dropped into the `campaign` design's html block as `{{{body}}}`.
 *
 * It lives under _shared because BOTH sides need it: the build compiles a funnel step once, and the
 * providers function turns the terms into the letter that carries them at send time. Two copies of
 * this would be two sets of inline styles quietly drifting apart.
 */
import { marked } from 'marked'

const INK = '#0c0d0b', INK2 = '#4a4c47', INK3 = '#6c6f69', HAIR = '#e6e2d6', ACCENT = '#b8402e'
const FONT = "Georgia, 'Times New Roman', serif"
const STYLE = {
  p: `margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK}`,
  h1: `margin:22px 0 10px;font-family:${FONT};font-size:24px;line-height:1.2;font-weight:600;color:${INK}`,
  h2: `margin:22px 0 8px;font-family:${FONT};font-size:20px;line-height:1.25;font-weight:600;color:${INK}`,
  h3: `margin:18px 0 6px;font-family:${FONT};font-size:17px;line-height:1.3;font-weight:600;color:${INK}`,
  ul: `margin:0 0 14px;padding-left:22px;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK}`,
  ol: `margin:0 0 14px;padding-left:22px;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK}`,
  li: `margin:0 0 6px`,
  a: `color:${ACCENT};text-decoration:underline`,
  blockquote: `margin:0 0 14px;padding:2px 0 2px 16px;border-left:3px solid ${HAIR};font-family:${FONT};font-size:16px;line-height:1.6;color:${INK2};font-style:italic`,
  hr: `border:0;border-top:1px solid ${HAIR};margin:22px 0`,
  img: `max-width:100%;height:auto;display:block;border-radius:8px`,
  code: `font-family:Menlo,Consolas,monospace;font-size:14px;background:#f3f1ea;padding:1px 4px;border-radius:3px`,
  strong: `font-weight:600`,
  em: `font-style:italic;color:${INK2}`,
}
export function mdToEmailHtml(md) {
  let html = marked.parse(String(md || ''), { gfm: true, breaks: false })
  for (const [tag, style] of Object.entries(STYLE)) html = html.replace(new RegExp(`<${tag}(\\s[^>]*)?>`, 'g'), (m, attrs = '') => (/\sstyle=/.test(attrs) ? m : `<${tag}${attrs} style="${style}">`))
  /* a link opens in its own tab; a heading's anchor id is no use in mail */
  html = html.replace(/<a (?![^>]*target=)/g, '<a target="_blank" ').replace(/<h([1-6]) id="[^"]*"/g, '<h$1')
  return html.trim()
}
/* the plain twin, from the markdown itself rather than the html */
export function mdToText(md) {
  return String(md || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/^#{1,6}\s+/gm, '').replace(/(\*\*|__)(.*?)\1/g, '$2').replace(/(\*|_)(.*?)\1/g, '$2').replace(/^>\s?/gm, '').replace(/`/g, '').trim()
}

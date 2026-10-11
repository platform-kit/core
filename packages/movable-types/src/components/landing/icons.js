/*
 * A glyph by name, drawn: one of the theme's own few (glyphs.js, a 20-grid) or any of Lucide's the
 * page names (`.velite/icons.json`, written by the icons build step from the names the pages use —
 * every icon in dev; Lucide's 24-grid). A name neither knows draws the spark. Browser only: the
 * schemas (Node too) read glyphs.js for the names.
 */
import ICONS from '#content/icons.json'
import { GLYPHS } from './glyphs.js'
const A = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'
export const glyph = (name) => {
  const n = String(name || '').trim()
  if (GLYPHS[n]) return `<svg class="lpglyph" viewBox="0 0 20 20" stroke-width="1.5" ${A}>${GLYPHS[n]}</svg>`
  if (ICONS[n]) return `<svg class="lpglyph" viewBox="0 0 24 24" stroke-width="1.75" ${A}>${ICONS[n]}</svg>`
  return `<svg class="lpglyph" viewBox="0 0 20 20" stroke-width="1.5" ${A}>${GLYPHS.spark}</svg>`
}
export const hasGlyph = (name) => !!(GLYPHS[name] || ICONS[name])

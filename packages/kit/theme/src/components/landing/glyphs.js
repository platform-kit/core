/*
 * The small stroke glyphs a section's item may carry (Features, Bento, How): named, drawn once
 * here as SVG paths on a 20 × 20 grid, chosen in the builder by name. A name the list lacks draws
 * the spark. Generic marks a marketing site reaches for; nothing of any one site's meaning.
 */
export const GLYPHS = {
  spark: '<path d="M10 2.5l1.8 5.2 5.2 1.8-5.2 1.8L10 16.5l-1.8-5.2-5.2-1.8 5.2-1.8z"/>',
  bolt: '<path d="M11 2.5L4.5 11h5l-.5 6.5L15.5 9h-5z"/>',
  book: '<path d="M3.5 4.5a2 2 0 0 1 2-2H10v14H5.5a2 2 0 0 0-2 2z"/><path d="M16.5 4.5a2 2 0 0 0-2-2H10v14h4.5a2 2 0 0 1 2 2z"/>',
  chat: '<path d="M3.5 5.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H5.5a2 2 0 0 1-2-2z"/>',
  shield: '<path d="M10 2.5l6.5 2.5v5c0 3.8-2.8 6.5-6.5 7.5-3.7-1-6.5-3.7-6.5-7.5V5z"/><path d="M7.5 10l1.8 1.8L12.8 8"/>',
  clock: '<circle cx="10" cy="10" r="7.5"/><path d="M10 5.5V10l3 2"/>',
  star: '<path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/>',
  heart: '<path d="M10 17s-6.5-4-6.5-8.5A3.5 3.5 0 0 1 10 6.3a3.5 3.5 0 0 1 6.5 2.2C16.5 13 10 17 10 17z"/>',
  check: '<circle cx="10" cy="10" r="7.5"/><path d="M6.5 10.2l2.3 2.3 4.7-4.8"/>',
  globe: '<circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2.5 2.5 2.5 12.5 0 15M10 2.5c-2.5 2.5-2.5 12.5 0 15"/>',
  pen: '<path d="M3.5 16.5l1-4L13.8 3.2a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1L7.5 15.5z"/><path d="M12.5 4.5l3 3"/>',
  layers: '<path d="M10 3l7 3.5-7 3.5-7-3.5z"/><path d="M3 10l7 3.5 7-3.5M3 13.5L10 17l7-3.5"/>',
  users: '<circle cx="7.5" cy="7" r="2.8"/><path d="M2.5 16c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5"/><circle cx="14" cy="7.5" r="2.2"/><path d="M13.5 11.5c2.4.2 4 1.8 4 4.5"/>',
  mail: '<rect x="2.5" y="4.5" width="15" height="11" rx="2"/><path d="M2.5 6.5l7.5 5 7.5-5"/>',
  map: '<path d="M10 17.5s-5.5-5-5.5-9a5.5 5.5 0 0 1 11 0c0 4-5.5 9-5.5 9z"/><circle cx="10" cy="8.5" r="2"/>',
  sun: '<circle cx="10" cy="10" r="3"/><path d="M10 2.5v3.2M10 14.3v3.2M2.5 10h3.2M14.3 10h3.2M4.7 4.7l2.3 2.3M13 13l2.3 2.3M15.3 4.7L13 7M7 13l-2.3 2.3"/>',
  bars: '<path d="M3 16.5V10M8 16.5V4M13 16.5v-4.5M18 16.5V7.5"/>',
  doc: '<rect x="2.5" y="3" width="15" height="14" rx="2.5"/><path d="M5.5 7.5h9M5.5 11h6"/>',
  lock: '<rect x="4" y="9" width="12" height="8.5" rx="2"/><path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9"/>',
  play: '<circle cx="10" cy="10" r="7.5"/><path d="M8.3 7l4.4 3-4.4 3z"/>',
  gift: '<rect x="3" y="8" width="14" height="9" rx="1.5"/><path d="M3 11.5h14M10 8v9M10 8c-2-3-5-3-5-1.2S8 8 10 8zm0 0c2-3 5-3 5-1.2S12 8 10 8z"/>',
  headphones: '<path d="M3.5 12V10a6.5 6.5 0 0 1 13 0v2"/><rect x="3" y="11.5" width="3.5" height="5.5" rx="1.5"/><rect x="13.5" y="11.5" width="3.5" height="5.5" rx="1.5"/>',
  compass: '<circle cx="10" cy="10" r="7.5"/><path d="M13 7l-1.8 4.2L7 13l1.8-4.2z"/>',
  leaf: '<path d="M4 16c0-7 4-11 12-12-1 8-5 12-12 12z"/><path d="M4 16c3-3 6-6 8.5-8.5"/>',
}
export const GLYPH_NAMES = Object.keys(GLYPHS)
export const glyph = (name) => `<svg class="lpglyph" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPHS[name] || GLYPHS.spark}</svg>`

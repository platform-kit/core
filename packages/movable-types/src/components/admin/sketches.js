/*
 * The page builder's sketches: a small line drawing of each section's layout, drawn once here as
 * SVG (120 × 72, in currentColor) and shown on the block, in the picker and in the empty page —
 * so an editor recognises a section by its shape before reading its name. A section names its
 * sketch on its schema entry (`sketch`); one without gets the generic block.
 */
const R = (x, y, w, h, o = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" ${o}/>`
const L = (x, y, w, o = '') => `<rect x="${x}" y="${y}" width="${w}" height="3" rx="1.5" ${o}/>`   /* a line of text */
const F = 'fill="currentColor" opacity=".18" stroke="none"'      /* a filled block */
const D = 'fill="currentColor" opacity=".5" stroke="none"'       /* a dark filled block (a button, a heading) */
const T = 'fill="currentColor" opacity=".32" stroke="none"'      /* text */
const C = (cx, cy, r, o = F) => `<circle cx="${cx}" cy="${cy}" r="${r}" ${o}/>`
const head = (x = 12, y = 12, w = 60) => L(x, y, w * 0.4, T) + L(x, y + 7, w, D) + L(x, y + 14, w * 0.8, D)
const lines = (x, y, w, n = 3) => Array.from({ length: n }, (_, i) => L(x, y + i * 6, w - (i === n - 1 ? w * 0.35 : 0), T)).join('')
const btn = (x, y) => R(x, y, 24, 8, D)

export const SKETCHES = {
  Hero: head(12, 16, 50) + btn(12, 44) + R(72, 12, 40, 48, F),
  Marquee: R(0, 30, 120, 12, F) + [8, 40, 72, 104].map((x) => L(x, 34.5, 22, D)).join(''),
  How: head(12, 10, 60) + [12, 50, 88].map((x) => R(x, 36, 26, 24, F) + C(x + 6, 42, 3, D) + L(x + 4, 50, 16, T)).join(''),
  Close: L(30, 22, 60, D) + L(38, 29, 44, D) + btn(48, 40) + `<ellipse cx="60" cy="72" rx="50" ry="10" ${F}/>`,
  Library: head(12, 10, 50) + R(12, 34, 30, 30, F) + R(48, 34, 30, 30, F) + R(84, 34, 24, 30, F),
  Coaching: head(12, 16, 40) + btn(12, 44) + R(64, 12, 48, 48, F) + C(78, 30, 7, D) + C(98, 30, 7, D),
  Creator: C(28, 36, 16, F) + head(56, 16, 52) + lines(56, 40, 52, 2),
  Pricing: head(12, 8, 50) + [12, 46, 80].map((x, i) => R(x, 28, 28, 36, i === 1 ? D : F) + L(x + 4, 34, 12, T) + L(x + 4, 42, 20, T) + L(x + 4, 48, 16, T) + R(x + 4, 55, 20, 5, i === 1 ? 'fill="currentColor" opacity=".9" stroke="none"' : D)).join(''),
  Form: head(12, 10, 50) + R(12, 32, 96, 9, F) + R(12, 45, 96, 9, F) + btn(12, 58),
  Entries: head(12, 8, 50) + [12, 46, 80].map((x) => R(x, 30, 28, 20, F) + L(x, 54, 20, T) + L(x, 60, 14, T)).join(''),
  Logos: L(36, 14, 48, T) + [10, 32, 54, 76, 98].map((x) => R(x, 32, 14, 10, D)).join(''),
  Features: head(12, 8, 50) + [12, 46, 80].map((x) => C(x + 5, 36, 4, D) + L(x, 45, 20, D) + L(x, 52, 26, T) + L(x, 58, 22, T)).join(''),
  Split: R(12, 14, 44, 44, F) + head(66, 18, 42) + lines(66, 40, 42, 2) + btn(66, 54),
  Stats: [12, 46, 80].map((x) => L(x, 22, 22, 'fill="currentColor" opacity=".9" stroke="none"') + L(x, 30, 22, D) + L(x, 40, 16, T)).join('') + L(12, 52, 96, T),
  Testimonials: [12, 46, 80].map((x) => R(x, 14, 28, 44, F) + lines(x + 4, 20, 20, 3) + C(x + 7, 50, 3, D) + L(x + 12, 48.5, 12, T)).join(''),
  FAQ: head(12, 6, 50) + [30, 40, 50, 60].map((y, i) => L(12, y, 70, D) + (i === 0 ? L(12, y + 5, 90, T) : '') + L(102, y, 6, T)).join(''),
  Team: head(12, 6, 50) + [12, 46, 80].map((x) => C(x + 14, 38, 9, F) + L(x + 4, 52, 20, D) + L(x + 6, 58, 16, T)).join(''),
  Compare: R(12, 20, 96, 44, 'fill="none" stroke="currentColor" opacity=".35" stroke-width="1.5"') + [32, 43, 54].map((y) => L(16, y, 30, T) + C(66, y + 1.5, 2.5, D) + C(84, y + 1.5, 2.5, D) + C(102, y + 1.5, 2.5, F)).join('') + L(60, 24, 44, D),
  Gallery: [[12, 12, 30, 22], [46, 12, 30, 22], [80, 12, 28, 22], [12, 38, 30, 22], [46, 38, 30, 22], [80, 38, 28, 22]].map(([x, y, w, h]) => R(x, y, w, h, F)).join(''),
  Video: R(12, 10, 96, 52, F) + `<path d="M55 28 L69 36 L55 44 Z" ${D}/>`,
  Prose: L(12, 10, 50, D) + lines(12, 22, 96, 6),
  Timeline: `<path d="M24 10 V 64" stroke="currentColor" opacity=".35" stroke-width="1.5"/>` + [16, 34, 52].map((y) => C(24, y, 3.5, D) + L(34, y - 3, 16, T) + L(34, y + 3, 50, D)).join(''),
  Bento: R(12, 10, 56, 26, F) + R(72, 10, 36, 26, F) + R(12, 40, 36, 24, F) + R(52, 40, 56, 24, F),
  Quote: `<text x="14" y="34" font-size="34" font-family="Georgia,serif" ${D}>“</text>` + L(34, 22, 66, D) + L(34, 30, 60, D) + L(34, 38, 40, D) + L(54, 50, 26, T),
  Contact: L(12, 14, 20, T) + lines(12, 22, 36, 3) + R(60, 12, 48, 9, F) + R(60, 25, 48, 9, F) + R(60, 38, 48, 12, F) + btn(60, 54),
  Cta: R(12, 14, 96, 44, F) + L(30, 24, 60, D) + L(38, 31, 44, T) + R(44, 42, 32, 9, D),
  Steps: `<path d="M20 30 H100" stroke="currentColor" opacity=".4" stroke-width="1.5" stroke-dasharray="2 3"/>` + [20, 60, 100].map((x) => C(x, 30, 6, D) + L(x - 10, 44, 20, D) + L(x - 12, 51, 24, T)).join(''),
  Newsletter: L(30, 18, 60, D) + L(40, 26, 40, T) + R(22, 38, 54, 12, F) + R(80, 38, 18, 12, D),
  Integrations: [[14, 14], [46, 14], [78, 14], [14, 40], [46, 40], [78, 40]].map(([x, y]) => R(x, y, 28, 20, F) + C(x + 8, y + 10, 4, D) + L(x + 15, y + 8.5, 9, T)).join(''),
  Perks: [8, 36, 64, 92].map((x) => C(x + 6, 36, 5, D) + L(x + 14, 32, 10, D) + L(x + 14, 38, 8, T)).join(''),
  Announcement: R(0, 30, 120, 12, D) + L(30, 34.5, 50, 'fill="#fff" opacity=".8" stroke="none"') + L(84, 34.5, 8, 'fill="#fff" opacity=".8" stroke="none"'),
  Countdown: L(30, 12, 60, D) + [12, 38, 64, 90].map((x) => R(x, 24, 20, 22, F) + L(x + 4, 31, 12, 'fill="currentColor" opacity=".9" stroke="none"') + L(x + 6, 40, 8, T)).join('') + btn(48, 54),
  BeforeAfter: R(12, 10, 96, 52, F) + R(12, 10, 48, 52, D) + `<path d="M60 6 V66" stroke="currentColor" opacity=".9" stroke-width="2"/>` + C(60, 36, 5, 'fill="currentColor" opacity=".9" stroke="none"'),
  Showcase: [12, 30, 48].map((y, i) => L(12, y, i === 0 ? 30 : 24, i === 0 ? D : T) + L(12, y + 6, 20, T)).join('') + R(52, 8, 56, 56, F) + R(58, 14, 44, 44, D),
  Carousel: R(4, 20, 20, 34, F) + R(30, 12, 60, 50, F) + R(96, 20, 20, 34, F) + C(52, 68, 2, D) + C(60, 68, 2, T) + C(68, 68, 2, T),
  Tabs: [12, 40, 68].map((x, i) => R(x, 8, 24, 8, i === 0 ? D : F)).join('') + R(12, 22, 96, 42, F) + lines(18, 28, 40, 3) + R(64, 28, 38, 30, D),
  Divider: `<path d="M12 36 H108" stroke="currentColor" opacity=".4" stroke-width="1.5"/>` + C(60, 36, 3, D),
  Footer: R(0, 8, 120, 64, F) + L(12, 18, 24, D) + lines(12, 26, 30, 2) + [52, 76, 100].map((x) => L(x, 18, 12, D) + lines(x, 26, 14, 3)).join('') + `<path d="M12 58 H108" stroke="currentColor" opacity=".3"/>` + L(12, 63, 30, T),
  Products: [12, 46, 80].map((x) => R(x, 8, 28, 30, F) + L(x, 42, 22, D) + L(x, 48, 12, T) + R(x, 55, 28, 7, D)).join(''),
  Spotlight: R(12, 8, 48, 56, F) + [12, 26, 40].map((x) => R(x, 56, 10, 8, D)).join('') + head(68, 12, 40) + L(68, 36, 16, 'fill="currentColor" opacity=".9" stroke="none"') + lines(68, 44, 40, 2) + btn(68, 56),
  Collections: [[12, 10, 46, 24], [62, 10, 46, 24], [12, 38, 46, 24], [62, 38, 46, 24]].map(([x, y, w, h]) => R(x, y, w, h, F) + L(x + 4, y + h - 8, 20, D)).join(''),
  Articles: [12, 46, 80].map((x) => R(x, 12, 28, 18, F) + L(x, 34, 8, T) + L(x, 40, 24, D) + L(x, 47, 20, T) + L(x, 53, 14, T)).join(''),
  generic: R(12, 12, 96, 48, F) + L(24, 30, 72, D) + L(34, 38, 52, T),
}
export const sketchOf = (key) => `<svg viewBox="0 0 120 72" aria-hidden="true">${SKETCHES[key] || SKETCHES.generic}</svg>`

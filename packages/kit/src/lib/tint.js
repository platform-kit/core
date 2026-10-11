/*
 * A COLOUR MADE FROM A NAME — the answer to "there is no picture", everywhere.
 *
 * A thing with no picture must still look like something. A grey rectangle says "this is unfinished";
 * a ground made from the thing's own name says "this is what it looks like", and two things never
 * come out alike. The community's front page decided this first (a space with no cover wears its own
 * band), and the store now asks the same question about a product with no photograph, so the rule
 * lives here rather than twice.
 *
 * A HUE IS NOT A RANDOM NUMBER. Taking the whole wheel hands out olive and mustard — 40° to 95°,
 * which no amount of gradient rescues at low lightness and which made that page look like a bruise.
 * The hash picks from a wheel with that arc cut out of it instead, so everything gets a colour that
 * is its own and nothing gets one that is ugly.
 *
 * Pure: no imports, no environment, the same answer in the browser and under node.
 */
const ARC = 265                     /* the wheel less the 95 degrees of olive */

export function hueOf(seed) {
  let n = 0
  for (const ch of String(seed || 'a')) n = (n * 31 + ch.charCodeAt(0)) % 9973
  const h = n % ARC
  return h < 40 ? h : h + 95        /* 0–39 stays; 40+ is pushed past the olives */
}

/* the two stops a band or a tile is painted with */
export function tint(seed) {
  const h = hueOf(seed)
  return { '--a': 'hsl(' + h + ' 54% 46%)', '--b': 'hsl(' + ((h + 38) % 360) + ' 58% 34%)' }
}

/* the same hue, pale, for a tile that has words set on it and must stay readable */
export function wash(seed) {
  const h = hueOf(seed)
  return { '--a': 'hsl(' + h + ' 42% 93%)', '--b': 'hsl(' + ((h + 38) % 360) + ' 36% 86%)', '--ink': 'hsl(' + h + ' 38% 26%)' }
}

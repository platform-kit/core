/*
 * HOW BIG THE CARD'S TYPE IS, so a long title cannot push the card apart.
 *
 * The card's text block is anchored to the BOTTOM — SharePage's `.sh-art-in` sits at `padding: 0
 * 84px 76px` inside a flex-end frame — which is right for two lines and wrong for eight: the block
 * grows upward, the title clears the top of the frame, and it ends up set over the bright part of
 * the picture where the scrim has nothing left to do. The photographed card does this and so did
 * the drawn one; a 130-character title reaches the top edge in both.
 *
 * So the type steps down until the block fits. The rule is HERE, once, because two things set this
 * card — SharePage.vue for the camera and the share-image function for the host with no browser —
 * and a card that fits in one and not the other is worse than one that is a little small in both.
 *
 * It is an estimate, deliberately: the width of a line is taken as characters × the advance of "0"
 * × the size, which is what a `ch` is. That is a few per cent out on a proportional face, and a few
 * per cent is nothing when the question is "does this need to be smaller".
 */

/* what SharePage states for each of its two article layouts */
export const CARD = {
  picture: { title: 66, titleCh: 16, sub: 24, subCh: 48, lineTitle: 1.04, lineSub: 1.45, bottom: 76, brand: 13 },
  paper: { title: 60, titleCh: 18, sub: 24, subCh: 48, lineTitle: 1.06, lineSub: 1.45, bottom: 76, brand: 22 },
}
export const FRAME = { w: 1200, h: 675 }
/* the air kept above the block: the title never runs to the edge of the sheet */
const TOP_AIR = 44
/* the brand row and the gap under it */
const brandBlock = (brand) => Math.max(26, brand * 1.4) + 26

const lines = (text, size, ch, maxWidth) => {
  const per = Math.max(1, Math.floor(maxWidth / (size * ch)))
  /* words, so a line break lands between them as it would in either renderer */
  let n = 1, room = per
  for (const w of String(text || '').split(/\s+/).filter(Boolean)) {
    if (w.length + 1 > room && room < per) { n++; room = per }
    room -= w.length + 1
  }
  return n
}

/*
 * → { titleSize, subSize, sub } — the sizes to set, and the subtitle possibly shortened.
 *
 * `chDisplay` / `chBody` are the advance of "0" in each face (ttf-metrics reads it from the file;
 * a browser gets it from the DOM). Left out, a reasonable proportional average is used.
 */
export function fitCard({ title = '', sub = '', variant = 'picture', chDisplay = 0.64, chBody = 0.64 } = {}) {
  const c = CARD[variant] || CARD.picture
  const room = FRAME.h - c.bottom - brandBlock(c.brand) - TOP_AIR
  let cut = String(sub || '')
  for (const scale of [1, 0.88, 0.78, 0.68, 0.6, 0.54]) {
    const ts = Math.round(c.title * scale)
    const ss = Math.round(c.sub * Math.max(0.82, scale))
    const tw = c.titleCh * chDisplay * c.title      /* the max-width is the FULL size's ch, as the CSS states it */
    const sw = c.subCh * chBody * c.sub
    const h = lines(title, ts, chDisplay, tw) * ts * c.lineTitle
      + (cut ? 22 + lines(cut, ss, chBody, sw) * ss * c.lineSub : 0)
    if (h <= room) return { titleSize: ts, subSize: ss, sub: cut, titleMax: Math.round(tw), subMax: Math.round(sw) }
  }
  /* still too tall at the smallest step: the subtitle is what goes, a sentence at a time */
  const ts = Math.round(c.title * 0.54), ss = Math.round(c.sub * 0.82)
  const tw = c.titleCh * chDisplay * c.title, sw = c.subCh * chBody * c.sub
  while (cut.length > 40) {
    cut = cut.replace(/[^.!?]*[.!?]\s*$/, '').trim() || cut.slice(0, Math.floor(cut.length * 0.7)).trim() + '…'
    const h = lines(title, ts, chDisplay, tw) * ts * c.lineTitle + 22 + lines(cut, ss, chBody, sw) * ss * c.lineSub
    if (h <= room) break
  }
  return { titleSize: ts, subSize: ss, sub: cut, titleMax: Math.round(tw), subMax: Math.round(sw) }
}

/*
 * THE ADVANCE OF "0" IN A FONT FILE — which is what a CSS `ch` is.
 *
 * SharePage sizes the card's two text blocks in `ch` (`max-width: 16ch` on the title, `48ch` on the
 * subtitle). satori has no `ch`, so the fallback card has to give those widths in pixels — and a
 * guessed ratio is how the subtitle ended up wrapping a word early: 0.52 was assumed where Bitter
 * is 0.641 and Fraunces 0.616, which is 140px of difference on one line.
 *
 * The font file says so exactly, and the function has already downloaded it, so it is read rather
 * than guessed or carried from a build — a cloud-only deployment never builds, and the metric is a
 * property of the face, not of the site.
 *
 * Enough of the format to answer one question: the table directory, `head` for unitsPerEm, `cmap`
 * for the glyph that draws "0", `hhea`+`hmtx` for its advance. Anything unexpected returns null and
 * the caller falls back to a ratio — a card that wraps a word early is a great deal better than one
 * that does not render.
 */
export function zeroAdvance(buf: ArrayBuffer): number | null {
  try {
    const d = new DataView(buf)
    const u16 = (o: number) => d.getUint16(o), u32 = (o: number) => d.getUint32(o)
    /* a TrueType collection or an OpenType/CFF file both start with a table directory we can read */
    const numTables = u16(4)
    const tables: Record<string, number> = {}
    for (let i = 0; i < numTables; i++) {
      const p = 12 + i * 16
      const tag = String.fromCharCode(d.getUint8(p), d.getUint8(p + 1), d.getUint8(p + 2), d.getUint8(p + 3))
      tables[tag] = u32(p + 8)
    }
    if (!tables.head || !tables.hhea || !tables.hmtx || !tables.cmap) return null
    const unitsPerEm = u16(tables.head + 18)
    if (!unitsPerEm) return null

    /* the glyph for "0" (U+0030), from a format 4 or format 12 subtable */
    const cmap = tables.cmap
    let sub = 0
    const n = u16(cmap + 2)
    for (let i = 0; i < n; i++) {
      const rec = cmap + 4 + i * 8
      const plat = u16(rec), enc = u16(rec + 2), off = u32(rec + 4)
      /* windows unicode BMP, windows UCS-4, or unicode */
      if ((plat === 3 && (enc === 1 || enc === 10)) || plat === 0) sub = cmap + off
    }
    if (!sub) return null
    const gid = glyphFor(d, sub, 0x30)
    if (!gid) return null

    /* hmtx: numberOfHMetrics pairs, then advances repeat the last one */
    const numH = u16(tables.hhea + 34)
    if (!numH) return null
    const adv = u16(tables.hmtx + 4 * Math.min(gid, numH - 1))
    return adv ? adv / unitsPerEm : null
  } catch { return null }
}

function glyphFor(d: DataView, sub: number, code: number): number | null {
  const u16 = (o: number) => d.getUint16(o), u32 = (o: number) => d.getUint32(o)
  const format = u16(sub)
  if (format === 4) {
    const segX2 = u16(sub + 6), seg = segX2 / 2
    const ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2
    for (let i = 0; i < seg; i++) {
      if (code > u16(ends + i * 2)) continue
      const start = u16(starts + i * 2)
      if (code < start) return 0
      const ro = u16(ranges + i * 2)
      if (ro === 0) return (code + d.getInt16(deltas + i * 2)) & 0xffff
      const gi = u16(ranges + i * 2 + ro + (code - start) * 2)
      return gi === 0 ? 0 : (gi + d.getInt16(deltas + i * 2)) & 0xffff
    }
    return 0
  }
  if (format === 12) {
    const groups = u32(sub + 12)
    for (let i = 0; i < groups; i++) {
      const g = sub + 16 + i * 12
      const s = u32(g), e = u32(g + 4)
      if (code >= s && code <= e) return u32(g + 8) + (code - s)
    }
    return 0
  }
  return null
}

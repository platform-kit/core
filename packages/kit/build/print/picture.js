/*
 * THE PAPERBACK'S PICTURE, AT THE SIZE THE PRINTER NEEDS.
 *
 * A paperback wears the e-book's own cover art, and the printer wants it decoded whole and capped
 * at 2800 px tall — 300 dpi over the front and its bleed. On a machine that is `sharp`. In an Edge
 * Function there is no `sharp` and there is no way to get one: it is a native binary.
 *
 * So this is the second of the two things with no cloud answer, and its answer is Storage's own
 * image transform, which does the same two operations — honour the orientation, cap the height —
 * and is part of Supabase rather than something to install.
 *
 * ONE RULE ABOUT WHAT IS NOT DONE HERE. The picture is never cropped to the page's shape: cover.typ
 * does that (`fit: "cover"`), the way the site's shelves do. Bands were tried twice and rejected
 * twice — a letterboxed cover is a cover somebody has to explain.
 *
 * Both paths take the same picture to the same pixels, so the edition hash — which includes the
 * picture byte for byte — is the same either way. That is the whole reason this is one module with
 * two branches rather than two functions that happen to agree.
 */

export const MAX_HEIGHT = 2800

/*
 * A machine's: sharp, decoded as it is, rotated by its EXIF and capped. Never enlarged — a small
 * picture made big is a blurry cover, and the printer would rather have the pixels there are.
 */
export async function resizeWithSharp(src, { height = MAX_HEIGHT } = {}) {
  const sharp = (await import('sharp')).default
  return sharp(src).rotate().resize({ height, withoutEnlargement: true }).png().toBuffer()
}

/*
 * A FUNCTION'S: Storage's render endpoint, which takes the same two operations as query parameters.
 * `url` is the object's public or signed address; the transform is a different path on the same
 * host, so it is rewritten rather than appended to — /object/ becomes /render/image/.
 *
 * `fetchFn` is taken rather than assumed so this can be tested without a network, the way the
 * github and the printer modules take theirs.
 */
export function transformUrl(url, { height = MAX_HEIGHT } = {}) {
  const u = String(url || '')
  if (!u) return ''
  /* public and signed objects both live under /storage/v1/object/…; the transform is /render/image/ */
  const rendered = u.includes('/storage/v1/render/image/')
    ? u
    : u.replace('/storage/v1/object/', '/storage/v1/render/image/')
  const sep = rendered.includes('?') ? '&' : '?'
  /* height alone keeps the aspect; `resize=contain` is Storage's "do not crop", which matters
     because cover.typ is what decides the shape and this must not pre-empt it */
  return `${rendered}${sep}height=${height}&resize=contain`
}

export async function resizeFromStorage(url, { height = MAX_HEIGHT, fetchFn = fetch } = {}) {
  const at = transformUrl(url, { height })
  if (!at) throw new Error('print: no picture to size')
  const r = await fetchFn(at)
  if (!r || !r.ok) throw new Error(`print: the picture could not be sized (${(r && r.status) || 'no answer'}) — ${at}`)
  return new Uint8Array(await r.arrayBuffer())
}

/*
 * WHICHEVER IS THERE. A caller that knows says so; otherwise it is sharp where the picture is a
 * path on a disk and Storage where it is a url, which is exactly the difference between the two
 * places this runs.
 */
export async function sizePicture(src, { height = MAX_HEIGHT, driver, fetchFn } = {}) {
  const isUrl = /^https?:\/\//i.test(String(src || ''))
  const pick = driver || (isUrl ? 'storage' : 'sharp')
  return pick === 'storage'
    ? resizeFromStorage(src, { height, fetchFn })
    : resizeWithSharp(src, { height })
}

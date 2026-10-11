/*
 * WHAT A POST MAY CARRY, AND HOW IT GOES OVER THE PROTOCOL (streamline-social-layout). Plain
 * JavaScript, no imports: the browser's composer and card, the atproto function and
 * build/network-media.test.mjs all read this one file.
 *
 * A post carries up to ten items, each a picture or a video. atproto's records carry less — four
 * pictures, or one video — so a post that holds more, or a mix, goes out as its first four pictures
 * and a link to the whole post on the site.
 */

export const MEDIA = {
  max: 10,
  imageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  videoTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
  maxImageBytes: 10 * 1024 * 1024,
  maxVideoBytes: 100 * 1024 * 1024,
  maxVideoSeconds: 180,
  /* what the protocol's records take */
  protocolImages: 4,
}

/* an item's kind; a picture saved before videos existed has none */
export const kindOf = (item) => (item && item.kind === 'video' ? 'video' : 'image')

/* a file's kind by its type, or null where it is neither */
export const kindOfType = (type) => (MEDIA.imageTypes.includes(type) ? 'image' : MEDIA.videoTypes.includes(type) ? 'video' : null)

/*
 * WHY A SET OF FILES CANNOT GO ON A POST, or null where it can: files are { type, size, duration? },
 * `have` how many the post already holds. The answer is a key the composer words (network.md).
 */
export function refuseMedia(files, have = 0) {
  if (have + files.length > MEDIA.max) return 'media-many'
  for (const f of files) {
    const k = kindOfType(f.type)
    if (!k) return 'media-kind'
    if (k === 'image' && f.size > MEDIA.maxImageBytes) return 'media-big'
    if (k === 'video' && f.size > MEDIA.maxVideoBytes) return 'media-big'
    if (k === 'video' && f.duration > MEDIA.maxVideoSeconds) return 'media-long'
  }
  return null
}

/* THE SHAPE ONE ITEM IS SHOWN AT: its own, held between 4:5 (tall) and 1.91:1 (wide) — Instagram's
   bounds — and square where it does not say */
export function shapeOf(item) {
  const w = Number(item && item.width) || 0, h = Number(item && item.height) || 0
  if (!w || !h) return 1
  return Math.min(1.91, Math.max(0.8, w / h))
}

/*
 * HOW A POST'S MEDIA GOES OVER THE PROTOCOL: { images: [...] } for up to four pictures, { video } for
 * exactly one video, and otherwise the first four pictures (none, where there are only videos) with
 * `link: true`, meaning a link to the whole post goes with them. Null for a post with no media.
 */
export function planEmbed(media) {
  const items = (media || []).filter(Boolean)
  if (!items.length) return null
  const images = items.filter((m) => kindOf(m) === 'image')
  const videos = items.filter((m) => kindOf(m) === 'video')
  if (!videos.length && images.length <= MEDIA.protocolImages) return { images, video: null, link: false }
  if (videos.length === 1 && !images.length) return { images: [], video: videos[0], link: false }
  return { images: images.slice(0, MEDIA.protocolImages), video: null, link: true }
}

/*
 * WHAT A PICTURE OR A VIDEO IS, read in the browser before it is sent: its size (so a card keeps its
 * shape before it loads), a video's length, and a video's first frame as a JPEG poster — so a tile,
 * a card and the For You grid show a picture and never fetch a video to do it.
 */
import { kindOfType } from '../../../supabase/functions/_shared/atproto/media.js'

const picture = (file) => new Promise((resolve) => {
  try {
    const url = URL.createObjectURL(file)
    const im = new Image()
    im.onload = () => { resolve({ width: im.naturalWidth, height: im.naturalHeight }); URL.revokeObjectURL(url) }
    im.onerror = () => { resolve({}); URL.revokeObjectURL(url) }
    im.src = url
  } catch { resolve({}) }
})

/* a video's size, length and first frame (a moment in, where the first frame is often black) */
const video = (file) => new Promise((resolve) => {
  let done = false
  const finish = (v) => { if (!done) { done = true; resolve(v) } }
  try {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url
    v.onloadedmetadata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 4) }
    v.onseeked = () => {
      const width = v.videoWidth, height = v.videoHeight, duration = Math.round(v.duration || 0)
      try {
        const c = document.createElement('canvas')
        const scale = Math.min(1, 1280 / Math.max(width, height || 1))
        c.width = Math.round(width * scale); c.height = Math.round(height * scale)
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
        c.toBlob((poster) => { URL.revokeObjectURL(url); finish({ width, height, duration, poster }) }, 'image/jpeg', 0.82)
      } catch { URL.revokeObjectURL(url); finish({ width, height, duration }) }
    }
    v.onerror = () => { URL.revokeObjectURL(url); finish({}) }
    setTimeout(() => finish({}), 15000)
  } catch { finish({}) }
})

export async function probe(file) {
  const kind = kindOfType(file.type)
  if (kind === 'video') return { kind, ...(await video(file)) }
  if (kind === 'image') return { kind, ...(await picture(file)) }
  return { kind: null }
}

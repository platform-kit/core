/*
 * A video by its address: a YouTube, Vimeo or Loom url becomes the provider's embed
 * (its iframe src); a file (.mp4, .webm, .mov, .m4v, .ogv) plays in a <video>; anything
 * else is refused — nothing but these three providers is ever embedded, since an
 * iframe to an arbitrary address is a hole a page must not have. Pure: no DOM, no
 * environment; pinned by build/sections.test.mjs. Used by the Video section and the
 * hero's video visual.
 */
const YT = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})(?:[?&#].*)?$/
const VIMEO = /^(?:https?:\/\/)?(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d+)(?:[/?#].*)?$/
const LOOM = /^(?:https?:\/\/)?(?:www\.)?loom\.com\/(?:share|embed)\/([0-9a-f]{32})(?:[?#].*)?$/
const FILE = /\.(mp4|webm|mov|m4v|ogv)(?:[?#].*)?$/i

/* { kind: 'file', src } | { kind: 'embed', provider, src } | null when it is neither */
export function embedOf(url) {
  const u = String(url || '').trim()
  if (!u) return null
  let m
  if ((m = u.match(YT))) return { kind: 'embed', provider: 'youtube', src: `https://www.youtube-nocookie.com/embed/${m[1]}` }
  if ((m = u.match(VIMEO))) return { kind: 'embed', provider: 'vimeo', src: `https://player.vimeo.com/video/${m[1]}?dnt=1` }
  if ((m = u.match(LOOM))) return { kind: 'embed', provider: 'loom', src: `https://www.loom.com/embed/${m[1]}` }
  if (FILE.test(u)) return { kind: 'file', src: u }
  return null
}

/* the same, with the provider's flags for a muted loop beside a hero's words (no controls, autoplay, muted, looping) */
export function loopSrc(e) {
  if (!e || e.kind !== 'embed') return e ? e.src : ''
  if (e.provider === 'youtube') { const id = e.src.split('/').pop(); return `${e.src}?autoplay=1&mute=1&loop=1&playlist=${id}&controls=0&playsinline=1&rel=0` }
  if (e.provider === 'vimeo') return `${e.src}&autoplay=1&muted=1&loop=1&background=1`
  if (e.provider === 'loom') return `${e.src}?autoplay=1&hide_owner=true&hide_share=true&hide_title=true&hideEmbedTopBar=true`
  return e.src
}

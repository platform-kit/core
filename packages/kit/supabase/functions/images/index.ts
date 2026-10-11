/*
 * The Images API on every asset of the content API: /images/<space>/<asset id>/<hash>/<file>?w=&h=&fit=&f=&fm=&q=&r=&bg=
 * — Contentful's parameters on the media library's pictures. The original comes from the site (git mode: the static
 * host serves /uploads/… and /…) or the bucket (cloud mode); a transformed picture is made once, kept in the
 * content-assets bucket under its parameters' hash, and served with an ETag and a year's Cache-Control (the hash in the
 * path changes when the file does, so the address is immutable). No JWT; nothing here writes but its own cache.
 *
 *   w, h         the size; the aspect kept unless fit says otherwise
 *   fit          pad (to the exact size on a background), fill (cover and crop at the focus), scale (stretch), crop (the
 *                focus cut from the picture), thumb (fill, for thumbnails); none: fit within
 *   f            the focus: center, top, right, left, bottom, top_right, top_left, bottom_right, bottom_left; face and
 *                faces are taken as center
 *   fm           jpg, png, webp, gif — avif is answered as webp; the file's own format by default
 *   q            1–100 for jpg and webp
 *   r            a corner radius in pixels, or max (a circle)
 *   bg           rgb:rrggbb, behind pad and a transparent picture flattened to jpg
 * A parameter out of range is BadQuery, as Contentful answers it.
 */
import { initPhoton, PhotonImage, Rgba, SamplingFilter, resize, crop, padding_uniform } from '@cf-wasm/photon/others'
import wasm from '../_shared/vendor/photon_rs_bg.wasm.inline.js'
const ready = initPhoton(wasm)   /* photon (Rust's image crate on wasm, Apache-2.0), the wasm inlined so the runtime needs no file */
import { admin } from '../_shared/lib.ts'
import { contentIndexes } from '../_shared/content-index.ts'
import { assetId } from '../_shared/api/ids.js'

const BUCKET = 'content-assets'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Expose-Headers': 'ETag' }
const err = (id: string, message: string, status = 400) => new Response(JSON.stringify({ sys: { type: 'Error', id }, message, requestId: Math.random().toString(36).slice(2, 12) }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const site = () => (Deno.env.get('APP_URL') ?? Deno.env.get('VITE_APP_URL') ?? '').replace(/\/+$/, '').replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/, '//host.docker.internal')
const CLOUD = (Deno.env.get('CONTENT_STORE') ?? '') === 'cloud'
const FOCUS = ['center', 'top', 'right', 'left', 'bottom', 'top_right', 'top_left', 'bottom_right', 'bottom_left', 'face', 'faces']
const FITS = ['pad', 'fill', 'scale', 'crop', 'thumb']
const FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']

async function original(address: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (/^https?:\/\//i.test(address)) { const r = await fetch(address); return r.ok ? { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get('content-type') ?? '' } : null }
  if (CLOUD) {
    const rel = address.startsWith('/uploads/') ? 'content/uploads/' + address.slice(9) : 'public' + address
    const { data } = await admin.storage.from(BUCKET).download(rel)
    return data ? { bytes: new Uint8Array(await data.arrayBuffer()), type: data.type } : null
  }
  const r = await fetch(site() + address)
  return r.ok ? { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get('content-type') ?? '' } : null
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const sha = async (s: string) => hex(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'GET' && req.method !== 'HEAD') return err('BadRequest', 'This method is not allowed.', 405)
  const url = new URL(req.url)
  /* the tail is <space>/<id>/<hash>/<file>, wherever it arrives: the site's media room strips to it
     (/api/media/…), and the function's own address is /functions/v1/images/… */
  const m = /\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url.pathname)
  if (!m) return err('NotFound', 'The resource could not be found.', 404)
  const { live } = await contentIndexes()
  if (m[1] !== live.space) return err('NotFound', 'The resource could not be found.', 404)
  const asset = live.assets.find((a) => assetId(a.address) === m[2])
  if (!asset) return err('NotFound', 'The resource could not be found.', 404)

  /* the parameters, checked */
  const q = url.searchParams
  const int = (k: string, lo: number, hi: number) => { if (!q.has(k)) return null; const n = Number(q.get(k)); if (!Number.isInteger(n) || n < lo || n > hi) throw new RangeError(`${k} must be an integer between ${lo} and ${hi}`); return n }
  let w: number | null, h: number | null, qual: number | null, r: number | 'max' | null
  try { w = int('w', 1, 4000); h = int('h', 1, 4000); qual = int('q', 1, 100); r = q.get('r') === 'max' ? 'max' : int('r', 0, 4000) } catch (e) { return err('BadQuery', (e as Error).message) }
  const fit = q.get('fit'), f = q.get('f'), fm = q.get('fm'), bg = q.get('bg')
  if (fit && !FITS.includes(fit)) return err('BadQuery', 'fit must be one of pad, fill, scale, crop, thumb')
  if (f && !FOCUS.includes(f)) return err('BadQuery', 'f must be one of ' + FOCUS.join(', '))
  if (fm && !FORMATS.includes(fm)) return err('BadQuery', 'fm must be one of jpg, png, webp, gif, avif')
  if (bg && !/^rgb:[0-9a-fA-F]{6}$/.test(bg)) return err('BadQuery', 'bg must be rgb:rrggbb')
  const isImage = /^image\/(png|jpeg|webp|gif)$/.test(asset.mime || '')
  const wantsWork = isImage && (w || h || fm || qual || r)
  const outFormat = (fm === 'avif' ? 'webp' : fm === 'jpeg' ? 'jpg' : fm) || ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[asset.mime] || 'png'
  const mime = ({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as Record<string, string>)[outFormat] ?? asset.mime
  const headers = (etag: string, type: string, len?: number) => ({ ...CORS, 'Content-Type': type, ETag: etag, 'Cache-Control': 'public, max-age=31536000, immutable', ...(len != null ? { 'Content-Length': String(len) } : {}) })

  /* the cache: this address and these parameters, once */
  const cacheKey = '.cache/images/' + (await sha(asset.address + '|' + m[3] + '|' + [w, h, fit, f, outFormat, qual, r, bg].join('|'))) + '.' + outFormat
  const etag = '"' + cacheKey.slice(14, 30) + '"'
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: headers(etag, mime) })
  if (wantsWork) { const { data } = await admin.storage.from(BUCKET).download(cacheKey); if (data) return new Response(req.method === 'HEAD' ? null : await data.arrayBuffer(), { status: 200, headers: headers(etag, mime, data.size) }) }

  const src = await original(asset.address)
  if (!src) return err('NotFound', 'The original could not be read.', 404)
  if (!wantsWork) return new Response(req.method === 'HEAD' ? null : src.bytes, { status: 200, headers: headers(etag, src.type || asset.mime || 'application/octet-stream', src.bytes.byteLength) })

  await ready
  let img: PhotonImage
  try { img = PhotonImage.new_from_byteslice(src.bytes) } catch { return err('BadQuery', 'The picture could not be decoded.', 415) }
  const focus = f && f !== 'face' && f !== 'faces' ? f : 'center'
  const W = img.get_width(), H = img.get_height()
  const tw = w ?? (h ? Math.round(W * (h / H)) : W), th = h ?? (w ? Math.round(H * (w / W)) : H)
  const vert = (space: number, size: number) => (focus.startsWith('top') ? 0 : focus.startsWith('bottom') ? space - size : Math.round((space - size) / 2))
  const horz = (space: number, size: number) => (focus.endsWith('left') ? 0 : focus.endsWith('right') ? space - size : Math.round((space - size) / 2))
  const scaled = (sw: number, sh: number) => resize(img, Math.max(1, sw), Math.max(1, sh), SamplingFilter.Lanczos3)
  const rgba = (hexRgb: string, a = 255) => new Rgba(parseInt(hexRgb.slice(0, 2), 16), parseInt(hexRgb.slice(2, 4), 16), parseInt(hexRgb.slice(4, 6), 16), a)
  if (fit === 'scale') img = scaled(tw, th)
  else if (fit === 'fill' || fit === 'thumb') { const s = Math.max(tw / W, th / H); const r1 = scaled(Math.round(W * s), Math.round(H * s)); const x = horz(r1.get_width(), tw), y = vert(r1.get_height(), th); img = crop(r1, x, y, x + tw, y + th) }
  else if (fit === 'crop') { const cw = Math.min(W, tw), ch = Math.min(H, th); const x = horz(W, cw), y = vert(H, ch); img = crop(img, x, y, x + cw, y + ch) }
  else if (fit === 'pad') { const s = Math.min(tw / W, th / H); const r1 = scaled(Math.round(W * s), Math.round(H * s)); img = pad(r1, tw, th, bg ? rgba(bg.slice(4)) : new Rgba(0, 0, 0, 0)) }
  else if (w || h) { const s = Math.min(tw / W, th / H, 1); img = scaled(Math.round(W * s), Math.round(H * s)) }
  if (r) img = rounded(img, r === 'max' ? Math.min(img.get_width(), img.get_height()) / 2 : r)
  if (outFormat === 'jpg' && bg) img = flatten(img, rgba(bg.slice(4)))
  const out: Uint8Array = outFormat === 'jpg' ? img.get_bytes_jpeg(qual ?? 80) : outFormat === 'webp' ? img.get_bytes_webp() : img.get_bytes()
  admin.storage.from(BUCKET).upload(cacheKey, out, { contentType: mime, upsert: true }).then(() => {}, () => {})
  return new Response(req.method === 'HEAD' ? null : out, { status: 200, headers: headers(etag, mime, out.byteLength) })
})

/* on the raw pixels: a canvas of the size asked with the picture centred on a colour; corners rounded by alpha; a
   transparent picture flattened onto a colour for jpg */
function pad(img: PhotonImage, tw: number, th: number, bgc: Rgba) {
  const sw = img.get_width(), sh = img.get_height(), src = img.get_raw_pixels()
  const out = new Uint8Array(tw * th * 4)
  for (let i = 0; i < tw * th; i++) { out[i * 4] = bgc.r; out[i * 4 + 1] = bgc.g; out[i * 4 + 2] = bgc.b; out[i * 4 + 3] = bgc.a }
  const ox = Math.round((tw - sw) / 2), oy = Math.round((th - sh) / 2)
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const tx = ox + x, ty = oy + y; if (tx < 0 || ty < 0 || tx >= tw || ty >= th) continue; const si = (y * sw + x) * 4, di = (ty * tw + tx) * 4; const a = src[si + 3] / 255; out[di] = Math.round(src[si] * a + out[di] * (1 - a)); out[di + 1] = Math.round(src[si + 1] * a + out[di + 1] * (1 - a)); out[di + 2] = Math.round(src[si + 2] * a + out[di + 2] * (1 - a)); out[di + 3] = Math.max(out[di + 3], src[si + 3]) }
  return new PhotonImage(out, tw, th)
}
function rounded(img: PhotonImage, radius: number) {
  const w = img.get_width(), h = img.get_height(), px = img.get_raw_pixels(), r = Math.min(radius, w / 2, h / 2)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cx = x < r ? r - x - 0.5 : x >= w - r ? x - (w - r) + 0.5 : 0, cy = y < r ? r - y - 0.5 : y >= h - r ? y - (h - r) + 0.5 : 0
    if (cx > 0 && cy > 0) { const d = Math.sqrt(cx * cx + cy * cy) - r; if (d > 0) { const i = (y * w + x) * 4; px[i + 3] = d >= 1 ? 0 : Math.round(px[i + 3] * (1 - d)) } }
  }
  return new PhotonImage(px, w, h)
}
function flatten(img: PhotonImage, bgc: Rgba) {
  const w = img.get_width(), h = img.get_height(), px = img.get_raw_pixels()
  for (let i = 0; i < w * h; i++) { const a = px[i * 4 + 3] / 255; if (a < 1) { px[i * 4] = Math.round(px[i * 4] * a + bgc.r * (1 - a)); px[i * 4 + 1] = Math.round(px[i * 4 + 1] * a + bgc.g * (1 - a)); px[i * 4 + 2] = Math.round(px[i * 4 + 2] * a + bgc.b * (1 - a)); px[i * 4 + 3] = 255 } }
  return new PhotonImage(px, w, h)
}

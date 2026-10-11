/*
 * THE SHARE PICTURE, FOR A HOST THAT CANNOT RUN A BROWSER — the fallback, and second class only in
 * the sense that it draws the card rather than photographing it.
 *
 * The first-class answer is the prerender sidecar (deploy/prerender): it photographs the app's own
 * /__share/<kind>/<id> route, so the card IS the card. Where a host can serve static files and call
 * Edge Functions and nothing else — Netlify, a static tier — there is no browser to photograph
 * anything, and this draws the same card with satori and resvg.
 *
 * IT IS DRAWN TO SHAREPAGE'S OWN NUMBERS, not to something that looks about right. Every padding,
 * size, colour and gradient stop below is lifted from SharePage.vue's stylesheet, the three faces
 * are the three the site actually sets (--f, --fd, --m, compiled into the catalog by
 * build/fonts.mjs), and the brand row carries the site's own mark. A fallback that is nearly the
 * card is worse than one that plainly is not: it reads as the site having rendered badly.
 *
 * WHAT STILL DIFFERS, measured rather than assumed — a pixel diff against the photographed card
 * puts the two at 98% identical, and what is left is text metrics:
 *
 *   - satori has no `text-wrap: balance` and its own line breaker, so a long line may wrap a word
 *     earlier or later than the browser.
 *   - the `ch` widths SharePage sizes its two text blocks in are read from the font file itself
 *     (_shared/ttf-metrics.ts). That is exact for a static face and approximate for a variable one:
 *     Fraunces's default instance measures 0.675 where the browser renders the 600 instance at
 *     0.616, so a very long title may break a word early.
 *   - the DEFAULT card is the landing page's first section as the page draws it, a component tree
 *     with the look's ground behind it. Nothing without a browser renders that, so this draws the
 *     site's name, tagline and description — which is what SharePage itself falls back to on a site
 *     with no landing page.
 *
 * So: where there is a sidecar, use the sidecar. This exists so a link is never broken, and it is
 * close enough that nobody looking at a timeline would notice which drew it.
 */
import { cors, json } from '../_shared/lib.ts'
import { of as compiled } from '../_shared/compiled.ts'
import { zeroAdvance } from '../_shared/ttf-metrics.ts'
import { fitCard } from '../_shared/share-card.js'

const W = 1200, H = 675
/* SharePage's own: --paper, --ink, --ink2, --ink3 of the light theme, which the camera forces */
const PAPER = '#faf7ef', INK = '#1b2a22', INK2 = '#4a5a50', INK3 = '#7d8a82'

type Fonts = { display?: string; body?: string; mono?: string }
type Face = { name: string; data: ArrayBuffer; weight: number; style: 'normal'; ch: number }

/*
 * THE FACES, FETCHED BY NAME. Google's css2 hands a TTF to a plain user-agent and a woff2 to a
 * modern one, and satori reads the TTF. Each is fetched once per cold start, and its `ch` — the
 * advance of "0", which is what SharePage sizes its text blocks in — is read out of the file.
 */
const cache = new Map<string, Face>()
async function face(family: string, weight: number): Promise<Face | null> {
  const key = family + ':' + weight
  const had = cache.get(key)
  if (had) return had
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`,
      { headers: { 'user-agent': 'Mozilla/5.0' } }).then((r) => r.text())
    const url = /url\((https:\/\/[^)]+\.(?:ttf|otf))\)/.exec(css)?.[1]
    if (!url) return null
    const data = await fetch(url).then((r) => r.arrayBuffer())
    const out: Face = { name: family, data, weight, style: 'normal', ch: zeroAdvance(data) ?? 0.6 }
    cache.set(key, out)
    return out
  } catch { return null }
}

/* the site's own words, faces and mark, from what a publish already compiles into the catalog */
type Site = { name?: string; tagline?: string; description?: string; mark?: string }
const catalogOf = () => { try { return compiled<Record<string, unknown>>('catalog') as { site?: Site; fonts?: Fonts; mark?: string; accent?: string } } catch { return {} } }

/*
 * THE COVER, IN SOMETHING SATORI CAN READ. satori draws a remote PNG or JPEG straight from its url
 * and renders a WebP as nothing at all — silently, leaving the scrim over grey. So anything else is
 * decoded here with photon, the same wasm the images function uses. A picture that will not decode
 * returns null and the card is drawn on the paper instead.
 */
const READS = /^image\/(png|jpeg)$/
async function cover(src: string | null | undefined, base: string): Promise<string | null> {
  if (!src) return null
  let url: string
  try { url = new URL(src, base).toString() } catch { return null }
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!r.ok) return null
    const type = (r.headers.get('content-type') || '').split(';')[0]
    if (READS.test(type)) return url
    const bytes = new Uint8Array(await r.arrayBuffer())
    const { initPhoton, PhotonImage } = await import('npm:@cf-wasm/photon@0.1.30/others')
    const wasm = (await import('../_shared/vendor/photon_rs_bg.wasm.inline.js')).default
    await initPhoton(wasm)
    const jpeg: Uint8Array = PhotonImage.new_from_byteslice(bytes).get_bytes_jpeg(82)
    let s = ''
    for (let i = 0; i < jpeg.length; i += 0x8000) s += String.fromCharCode(...jpeg.subarray(i, i + 0x8000))
    return 'data:image/jpeg;base64,' + btoa(s)
  } catch { return null }
}

/*
 * THE MARK BESIDE THE NAME — .sh-brand: 26px, gap 10px.
 *
 * Three sources, in order, and any of them may be absent:
 *
 *   1. THE SITE'S OWN FILE. `mark` on the site record is an address an owner uploaded in Site
 *      settings — an SVG or a PNG. It is used as it is; nothing is tinted, because a logo somebody
 *      uploaded has its own colours and recolouring it would be vandalism.
 *   2. THE THEME'S COMPONENT. SiteMark.vue flattened to SVG at build time, drawn in the site's
 *      ACCENT — which is not the colour of the words beside it. SiteMark's stroke defaults to
 *      var(--accent), so on the card the mark is the site's red and the name is the row's grey;
 *      tinting both to the row's colour made the card look like another site's.
 *   3. NOTHING. The name stands on its own, which is a perfectly good brand row.
 */
async function markSrc(site: { mark?: string }, cat: { mark?: string; accent?: string }, base: string): Promise<string | null> {
  /* the uploaded one, as it is */
  if (site.mark) {
    try {
      const url = new URL(site.mark, base).toString()
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) })
      if (r.ok) {
        const type = (r.headers.get('content-type') || '').split(';')[0]
        if (/^image\/(png|jpeg)$/.test(type)) return url
        const bytes = new Uint8Array(await r.arrayBuffer())
        /* an SVG goes in as a data url; satori reads one, and resvg draws it */
        if (/svg/.test(type) || /^\s*<(\?xml|svg)/.test(new TextDecoder().decode(bytes.slice(0, 64)))) {
          let s = ''
          for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          return 'data:image/svg+xml;base64,' + btoa(s)
        }
        /* anything else — a WebP logo, say — through the same decoder the cover uses */
        const dec = await cover(url, base)
        if (dec) return dec
      }
    } catch { /* fall through to the theme's */ }
  }
  /* the theme's component, in the site's accent */
  if (cat.mark) return 'data:image/svg+xml;base64,' + btoa(cat.mark.replace(/__STROKE__/g, cat.accent || 'currentColor'))
  return null
}

/* the row itself */
const brandRow = (name: string, mark: string | null, colour: string, size: number, gap: number, F: Fonts) => ({
  type: 'div',
  props: {
    style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: gap },
    children: [
      mark ? { type: 'img', props: { src: mark, width: 26, height: 26 } } : null,
      { type: 'div', props: { style: { fontFamily: F.mono, fontSize: size, letterSpacing: size * 0.18, textTransform: 'uppercase', color: colour }, children: name } },
    ].filter(Boolean),
  },
})

/* .sh-art.has-img — the title over the cover, the scrim's four stops as SharePage states them */
const onPicture = (t: string, sub: string, name: string, mark: string | null, src: string, F: Fonts, ch: { d: number; b: number }) => {
const fit = fitCard({ title: t, sub, variant: 'picture', chDisplay: ch.d, chBody: ch.b })
return ({
  type: 'div',
  props: {
    style: { width: W, height: H, display: 'flex', position: 'relative' },
    children: [
      { type: 'img', props: { src, width: W, height: H, style: { position: 'absolute', top: 0, left: 0, objectFit: 'cover' } } },
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: W, height: H,
        background: 'linear-gradient(180deg, #0a0d0b40 0%, #0a0d0b40 28%, #0a0d0bb3 58%, #0a0d0bf2 100%)' } } },
      { type: 'div', props: { style: { position: 'absolute', left: 84, bottom: 76, width: Math.min(1000, W - 168), display: 'flex', flexDirection: 'column' },
        children: [
          brandRow(name, mark, '#c4ccc0', 13, 26, F),
          { type: 'div', props: { style: { fontFamily: F.display, fontWeight: 600, fontSize: fit.titleSize, lineHeight: 1.04,
            letterSpacing: -0.018 * fit.titleSize, color: '#fff', maxWidth: fit.titleMax,
            textShadow: '0 2px 34px #00000073' }, children: t } },
          fit.sub ? { type: 'div', props: { style: { fontFamily: F.body, fontSize: fit.subSize, lineHeight: 1.45, color: '#dfe4dc',
            marginTop: 22, maxWidth: fit.subMax }, children: fit.sub } } : null,
        ].filter(Boolean) } },
    ],
  },
}) }

/* .sh-plain — the words on the paper, as SharePage draws a site with no landing page */
const onPaper = (t: string, sub: string, name: string, mark: string | null, F: Fonts, ch: { d: number; b: number }) => {
const fit = fitCard({ title: t, sub, variant: 'paper', chDisplay: ch.d, chBody: ch.b })
return ({
  type: 'div',
  props: {
    style: { width: W, height: H, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      padding: '0 84px 76px', backgroundColor: PAPER },
    children: [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', maxWidth: 1000 }, children: [
      brandRow(name, mark, INK3, 22, 26, F),
      { type: 'div', props: { style: { fontFamily: F.display, fontWeight: 600, fontSize: fit.titleSize, lineHeight: 1.06,
        letterSpacing: -0.018 * fit.titleSize, color: INK, maxWidth: fit.titleMax }, children: t } },
      fit.sub ? { type: 'div', props: { style: { fontFamily: F.body, fontSize: fit.subSize, lineHeight: 1.45, color: INK2,
        marginTop: 22, maxWidth: fit.subMax }, children: fit.sub } } : null,
    ].filter(Boolean) } }],
  },
}) }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const u = new URL(req.url)
  const path = (u.searchParams.get('path') || u.pathname.replace(/^.*\/share-image\/?/, '')).replace(/\.png$/, '')
  const [kind, ...rest] = path.split('/').filter(Boolean)
  const id = rest.join('/')

  const cat = catalogOf()
  const site = cat.site || {}
  const F: Fonts = {
    display: cat.fonts?.display || Deno.env.get('SHARE_FONT') || 'Newsreader',
    body: cat.fonts?.body || 'Inter',
    mono: cat.fonts?.mono || 'IBM Plex Mono',
  }
  let title = site.name || 'A site', sub = site.tagline || site.description || '', image: string | null = null
  try {
    if (kind === 'articles' || kind === 'books') {
      const idx = (compiled<Record<string, { title?: string; description?: string; image?: string; cover?: string }>>('content-index') || {})
      const rec = idx[`${kind}/${id}`]
      if (rec) { title = rec.title || title; sub = rec.description || ''; image = rec.image || rec.cover || null }
    }
  } catch { /* no index: the site's own words are the card */ }

  try {
    const [satori, { Resvg }, display, body, mono] = await Promise.all([
      import('npm:satori@0.10.14').then((m) => m.default),
      import('npm:@resvg/resvg-wasm@2.6.2'),
      face(F.display!, 600), face(F.body!, 400), face(F.mono!, 400),
    ])
    const faces = [display, body, mono].filter(Boolean) as Face[]
    if (!faces.length) return json({ error: 'no type to set it in' }, 404)
    const ch = { d: display?.ch ?? 0.6, b: body?.ch ?? 0.6 }
    const [pic, mark] = await Promise.all([cover(image, u.origin), markSrc(site, cat, u.origin)])
    const tree = pic
      ? onPicture(title, sub, site.name || '', mark, pic, F, ch)
      : onPaper(title, sub, site.name || '', mark, F, ch)
    const svg = await satori(tree, { width: W, height: H, fonts: faces.map(({ name, data, weight, style }) => ({ name, data, weight, style })) })
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng()
    return new Response(png, { headers: { ...cors, 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' } })
  } catch (e) {
    /* a picture that cannot be drawn is a 404, never a broken image: a crawler that gets nothing
       shows the site's default, which is better than a 502 in somebody's timeline */
    console.error('share-image:', e instanceof Error ? e.message : e)
    return json({ error: 'no picture' }, 404)
  }
})

/*
 * A tracked link followed, or a pixel fetched: GET /email-track/<token> (a click: counted,
 * then a redirect to the row's destination) or /email-track/<token>.gif (an open: counted, a
 * transparent gif). The token is the whole key — a row of email_links, made when the email
 * was sent — so nothing in the request names a person or a destination, and an unknown token
 * is sent to the site with nothing counted. No JWT, no cookie. A link arrives as the site's
 * own /v1/email-track/<token> — the host's rewrite of /v1/* to the functions, or the app
 * forwarding it before it loads (main.js). A click lands with the email's UTM tags on the destination
 * (utm_source the funnel's or blast's name, utm_medium email, utm_campaign the step's or blast's title;
 * tags the author wrote are kept), so the visit is the email's on the site's dashboard and never a
 * referral from the functions' host.
 */
import { admin } from '../_shared/lib.ts'
import { FUNNELS, BLASTS } from '../_shared/marketing.ts'

const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0))
const site = () => (Deno.env.get('APP_URL') ?? Deno.env.get('VITE_APP_URL') ?? 'http://localhost:5173').replace(/\/+$/, '')
const gif = () => new Response(GIF, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate, private', Pragma: 'no-cache', Expires: '0' } })
/* the email's tags on a destination the author did not tag already */
export function tagged(url: string, kind: string | null, name: string | null, step: number | null) {
  try {
    const u = new URL(url)
    if (!name) return url
    const title = kind === 'blast' ? BLASTS[name]?.title : FUNNELS[name]?.steps?.[(step ?? 1) - 1]?.title
    const tags: [string, string][] = [['utm_source', name], ['utm_medium', 'email'], ['utm_campaign', title || name]]
    for (const [k, v] of tags) if (!u.searchParams.has(k)) u.searchParams.set(k, v)
    return u.toString()
  } catch { return url }
}
const go = (to: string) => new Response(null, { status: 302, headers: { Location: to, 'Cache-Control': 'no-store' } })

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const last = url.pathname.split('/').filter(Boolean).pop() ?? ''
  const raw = url.searchParams.get('k') ?? (last === 'email-track' ? '' : last)
  const pixel = /\.gif$/i.test(raw)
  const token = raw.replace(/\.gif$/i, '')
  if (!/^[A-Za-z0-9]{6,32}$/.test(token)) return pixel ? gif() : go(site())
  const { data } = await admin.rpc('email_hit', { p_token: token, p_ua: req.headers.get('user-agent') ?? '' })
  const hit = Array.isArray(data) ? data[0] : data
  if (!hit) return pixel ? gif() : go(site())
  if (hit.kind === 'open') return gif()
  if (!(hit.url && /^https?:\/\//i.test(hit.url))) return go(site())
  return go(tagged(hit.url, hit.log_kind, hit.log_name, hit.log_step))
})

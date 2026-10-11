/*
 * The link at the foot of every funnel and blast email: GET ?u=<user id>&t=<hmac>, no JWT —
 * the signature is the proof (marketing.ts makes and checks it); &l=<log id> names the send the link was
 * in. Sets profiles.email_opt_out_at, after which email_audience never returns the person, and marks that
 * send as the one unsubscribed from — only when it is the person's own, so a swapped id marks nothing;
 * the emails about an order still come.
 * Answers a small page in the site's words (strings.json ## unsubscribe).
 */
import { admin } from '../_shared/lib.ts'
import * as SITE from '../_shared/pipe/site.js'
const SITE_NAME = String((SITE as any).name || '')
import { unsubscribeOk } from '../_shared/marketing.ts'
import strings from '../_shared/emails/strings.json' with { type: 'json' }

const W = ((strings as any).unsubscribe ?? {}) as Record<string, string>
const site = () => (Deno.env.get('APP_URL') ?? Deno.env.get('VITE_APP_URL') ?? 'http://localhost:5173').replace(/\/+$/, '')
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const page = (title: string, body: string) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="robots" content="noindex"></head>
<body style="margin:0;background:#fbfaf3;color:#0c0d0b;font-family:Georgia,'Times New Roman',serif"><div style="max-width:520px;margin:12vh auto;padding:36px 32px;background:#fff;border:1px solid #e6e2d6;border-radius:18px">
<p style="font-family:Menlo,Consolas,monospace;font-size:12px;letter-spacing:.18em;text-transform:uppercase;margin:0 0 18px">${esc(SITE_NAME)}</p>
<h1 style="font-size:26px;line-height:1.15;margin:0 0 12px;font-weight:600">${esc(title)}</h1><p style="font-size:16px;line-height:1.6;color:#4a4c47;margin:0 0 22px">${esc(body)}</p>
<a href="${site()}" style="display:inline-block;background:#0c0d0b;color:#fbfaf3;text-decoration:none;border-radius:999px;padding:12px 22px;font-weight:600">${esc(W.back ?? 'Back')}</a></div></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } })

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const u = url.searchParams.get('u') ?? '', t = url.searchParams.get('t') ?? '', l = url.searchParams.get('l') ?? ''
  if (!(await unsubscribeOk(u, t))) return page(W['bad-title'] ?? 'That link did not work', W['bad-body'] ?? '')
  await admin.from('profiles').update({ email_opt_out_at: new Date().toISOString() }).eq('id', u).is('email_opt_out_at', null)
  if (/^\d{1,12}$/.test(l)) await admin.from('email_log').update({ unsubscribed_at: new Date().toISOString() }).eq('id', Number(l)).eq('user_id', u).is('unsubscribed_at', null)
  return page(W.title ?? 'Unsubscribed', W.body ?? '')
})

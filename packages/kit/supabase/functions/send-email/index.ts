/*
 * The site's emails, for the admin: POST { kind, to, html?,
 * subject? }. Sends the email to `to` — a test, filled with the sample order — from the design
 * as compiled, or from `html` when the Emails page hands in the design as it is being built
 * (compiled in the browser, unsaved), and `subject` as typed. Without `to` it answers with the
 * filled email instead (a preview). Admins only. The real emails are sent from the ledger and
 * the printer's status, never from here.
 */
import { admin, json, preflight, getUser } from '../_shared/lib.ts'
import { rolesOf, isAdmin } from '../_shared/roles.ts'
import { renderEmail, sendEmail, smtpConfigured, SAMPLES, type EmailKind } from '../_shared/email.ts'

const KINDS: EmailKind[] = ['order', 'shipped', 'files', 'chat', 'support', 'support-digest', 'magic-link', 'recovery', 'campaign', 'provider-terms', 'session-booked', 'session-held', 'session-to-confirm', 'session-declined', 'session-moved', 'session-cancelled', 'session-reminder', 'event-reminder']

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const user = await getUser(req)
  if (!user) return json({ error: 'sign in' }, 401)
  if (!isAdmin(await rolesOf(user.id))) return json({ error: 'admins only' }, 403)
  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const kind = String(body?.kind ?? 'order') as EmailKind
  if (!KINDS.includes(kind)) return json({ error: 'unknown email' }, 400)
  const opts = { ...(typeof body?.html === 'string' && body.html.length ? { html: String(body.html).slice(0, 400_000) } : {}), ...(typeof body?.subject === 'string' ? { subject: String(body.subject).slice(0, 300) } : {}) }
  const data = { ...(SAMPLES as any)[kind], ...(body?.sample && typeof body.sample === 'object' ? body.sample : {}) }
  const to = String(body?.to ?? '').trim()
  if (!to) return json({ ok: true, ...renderEmail(kind, data, opts) })
  if (!smtpConfigured) return json({ error: 'SMTP is not configured on the functions (SMTP_HOST, SMTP_PORT, SMTP_FROM)', code: 'no-smtp' }, 400)
  const sent = await sendEmail(to, kind, data, opts)
  return json({ ok: sent, to })
})

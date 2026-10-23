/*
 * The emails the functions send (and the two Supabase Auth sends from the same designs — see
 * tags.js GOTRUE; this module never sends those): the order's confirmation (checkout.session.completed, from the
 * ledger), the parcel shipped (the printer's webhook or a refresh, from print.ts), the files
 * ready (with the confirmation, when a purchase carries files). Each is a design built in the
 * admin's Emails page — a Templatical template in content/emails/<kind>.json — compiled to
 * HTML by build/emails.mjs into ./emails/compiled.json beside this file (deploy runs it; the
 * admin's save runs it), and filled here with the real order (emails/fill.js: the Handlebars a
 * design may use — `{{name}}`, `{{#each lines}}`, `{{#if ships}}`; emails/tags.js names them
 * and their samples). The subject is a line of content/app/ui/emails.md (strings.json here),
 * filled the same way. Sent over SMTP with nodemailer (SMTP_HOST / SMTP_PORT / SMTP_USER /
 * SMTP_PASS / SMTP_FROM, the relay chat-notify uses); with those unset nothing is sent and the
 * caller is told. Nothing here ever throws into a ledger write: an email that fails is logged,
 * and the purchase stands.
 */
import nodemailer from 'npm:nodemailer@6'
import { fill, plain, unescapeText } from './emails/fill.js'
import { SAMPLES } from './emails/tags.js'
import { of, onRefresh } from './compiled.ts'
import strings from './emails/strings.json' with { type: 'json' }
import { appUrl } from './lib.ts'

export type EmailKind = 'order' | 'shipped' | 'files' | 'chat' | 'support' | 'support-digest' | 'magic-link' | 'recovery' | 'campaign' | 'session-booked' | 'session-held' | 'session-to-confirm' | 'session-declined' | 'session-moved' | 'session-cancelled' | 'session-reminder' | 'event-reminder' | 'provider-terms' | 'course-lesson' | 'course-complete'

const SMTP = {
  host: Deno.env.get('SMTP_HOST') ?? '',
  port: Number(Deno.env.get('SMTP_PORT') ?? '0'),
  user: Deno.env.get('SMTP_USER') ?? '',
  pass: Deno.env.get('SMTP_PASS') ?? '',
  from: Deno.env.get('SMTP_FROM') ?? '',
}
export const smtpConfigured = SMTP.host.length > 0 && SMTP.port > 0 && SMTP.from.length > 0

/* the designs as this deployment has them: the file the build shipped, or the row a publish wrote
   where nothing rebuilds. A live binding, so a refresh reaches every reader (./compiled.ts). */
export let DESIGNS: Record<EmailKind, string> = {} as Record<EmailKind, string>
onRefresh(() => { DESIGNS = of<Record<EmailKind, string>>('emails') })
export const WORDS = strings as unknown as Record<string, Record<string, string>>
export { SAMPLES }

/* the email as it will arrive: the compiled design (or one handed in — the admin's, as it is
   being built) and the subject, filled with the order */
export function renderEmail(kind: EmailKind, data: any, opts: { html?: string; subject?: string } = {}) {
  /* a subject dropped into the design as {{subject}} is filled first, so its own {{name}} is a name */
  const d = data && typeof data.subject === 'string' ? { ...data, subject: fill(data.subject, data) } : data
  const html = fill(opts.html ?? DESIGNS[kind] ?? '', d)
  /* the subject is plain text: a title with an apostrophe must not arrive as &#39; */
  const subject = unescapeText(fill(opts.subject ?? WORDS[kind]?.subject ?? '', d))
  return { subject, html, text: plain(html) }
}

/* send one; false when SMTP is not configured or the relay refused it. `rendered` sends an
   email already made (marketing lays its tracking into the html first) as it is. */
export async function sendEmail(to: string, kind: EmailKind, data: any, opts: { html?: string; subject?: string; rendered?: { subject: string; html: string; text: string }; ical?: { method: 'REQUEST' | 'CANCEL'; content: string } } = {}): Promise<boolean> {
  if (!to || !smtpConfigured) return false
  try {
    const m = opts.rendered ?? renderEmail(kind, data, opts)
    if (!m.html) { console.warn(`email: ${kind} has no compiled design — node build/emails.mjs`); return false }
    const transport = nodemailer.createTransport({ host: SMTP.host, port: SMTP.port, secure: SMTP.port === 465, ...(SMTP.user ? { auth: { user: SMTP.user, pass: SMTP.pass } } : {}) })
    /* a calendar invitation rides as the message's iCalendar part (nodemailer's icalEvent), so a mail client offers to add it */
    await transport.sendMail({ from: SMTP.from, to, subject: m.subject, text: m.text, html: m.html, ...(opts.ical ? { icalEvent: { method: opts.ical.method, content: opts.ical.content } } : {}) })
    return true
  } catch (e) { console.warn(`email: ${kind} to ${to} not sent —`, (e as any)?.message ?? e); return false }
}

/* ---- the data each email is made from, by the names tags.js gives them ---- */
const money = (cents: number | null | undefined, currency: string) => (typeof cents === 'number' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(cents / 100) : '')
export const addressLines = (a: any) => (a ? [a.name, a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(' '), a.country].map((x) => String(x || '').trim()).filter(Boolean) : [])
const firstName = (s: string | null | undefined) => String(s || '').trim().split(/\s+/)[0] || ''

/* the order's confirmation, from Stripe's session and what the ledger read of its lines */
export type BoughtLine = { title: string; detail: string; qty: number; amount: number; currency: string; book?: string | null; files?: boolean; ships?: boolean }
export async function orderEmail(o: any, lines: BoughtLine[], opts: { guest: boolean; url: string | null }) {
  const to = o.customer_details?.email ?? o.customer_email ?? ''
  const currency = o.currency ?? lines[0]?.currency ?? 'usd'
  const ships = lines.some((l) => l.ships)
  const files = lines.some((l) => l.files)
  const sd = o.shipping_details ?? o.collected_information?.shipping_details ?? null
  const url = opts.url ?? `${appUrl()}/store`
  const data = {
    name: firstName(o.customer_details?.name ?? sd?.name), title: lines[0]?.title ?? '', url,
    lines: lines.map((l) => ({ title: l.title, detail: l.detail, qty: l.qty, amount: money(l.amount * l.qty, l.currency) })),
    subtotal: money(o.amount_subtotal ?? null, currency), shipping: money(o.shipping_cost?.amount_total ?? null, currency), total: money(o.amount_total ?? null, currency),
    address: ships ? addressLines(sd?.address ? { name: sd.name, ...sd.address } : null) : [],
    ships, files, guest: opts.guest,
  }
  const sent = await sendEmail(to, 'order', data)
  /* the files, in a letter of their own, when the purchase carries any */
  if (files) await sendEmail(to, 'files', { name: data.name, title: data.title, url, files: 'PDF and EPUB', guest: opts.guest })
  return sent
}

/* the parcel shipped, from the order's row as the printer's status just moved it */
export async function shippedEmail(row: any, title: string) {
  const t = row.tracking || {}
  return sendEmail(row.email, 'shipped', { name: firstName(row.address?.name), title, url: `${appUrl()}/store/products/${row.book}-print`, carrier: t.carrier || '', tracking_id: t.id || '', tracking_url: t.url || '', address: addressLines(row.address) })
}

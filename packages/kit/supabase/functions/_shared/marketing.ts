/*
 * Marketing mail — the funnels and the blasts — as the functions send it: the audience from
 * email_audience (migration 20260916120000), the design filled with the step's or blast's
 * html and the reader's name, the unsubscribe link every such email carries, the cooldowns
 * (the policy's daily / weekly / monthly count of marketing emails to one person, a funnel's
 * own gap between its emails), and the log. funnels-run and email-blast share this; nothing
 * transactional (an order, a reset) goes through it or counts against a cooldown.
 *
 * Once, ever: every email has an id (the step's or blast's uuid, in its markdown), and the log
 * row is written BEFORE the send under the unique (user, email) index (migration
 * 20260916130000) — a row refused is a person who already had it, whatever the funnel is now
 * called or however its steps are ordered. Every link in it, and its open pixel, is a row of
 * email_links under a random token that is the whole url — so nothing in a link names a
 * person, a row or a destination.
 *
 * Where a reader-facing link points: the functions on the site's own domain, <site>/v1/…
 * (PUBLIC_FUNCTIONS_URL — the host rewrites /v1/* to the project's functions/v1/*, one rule
 * for every function). Unset, links still read <site>/v1/… and the site itself forwards them
 * (main.js, before anything loads); only the pixel then goes to the function's own address,
 * since an image cannot come back through the site's shell.
 */
import { admin } from './lib.ts'
import { renderEmail, sendEmail, DESIGNS } from './email.ts'
import { of } from './compiled.ts'
/* the funnels as this deployment has them: the shipped file, or the row a publish wrote */
const funnelsJson = () => of<Record<string, any>>('funnels')

export type Rules = Record<string, unknown>
export type Person = { user_id: string; email: string; name: string | null; last_active: string | null }
export type Policy = { daily: number; weekly: number; monthly: number; 'blasts-respect-cooldown': boolean; 'support-wait': number; 'support-presence': number; 'support-keep-files': number; 'recordings-keep'?: number; 'session-reminders'?: number[] }
export type Step = { id: string; title: string; after: number; subject: string; html: string; text: string; version: string }
export type Funnel = { title: string; published: boolean; design: string; cooldown: number; rules: Rules; steps: Step[] }
/* a funnel's chat step, as the support function needs it: the line the thread opens with */
export type Choice = { key: string; text: string; children: Choice[] }
export type Prompt = { id: string; funnel: string; title: string; text: string; image?: string; choices: Choice[]; default: boolean; version: string }
export type Blast = { id: string; version: string; title: string; subject: string; design: string; respectCooldown: boolean; status: string; rules: Rules; html: string; text: string }
export const FUNNELS = ((funnelsJson() as any).funnels ?? {}) as Record<string, Funnel>
export const BLASTS = ((funnelsJson() as any).blasts ?? {}) as Record<string, Blast>
export const PROMPTS = ((funnelsJson() as any).prompts ?? {}) as Record<string, Prompt>
export const POLICY = ((funnelsJson() as any).policy ?? { daily: 1, weekly: 3, monthly: 8, 'blasts-respect-cooldown': true, 'support-wait': 15, 'support-presence': 5, 'support-keep-files': 90, 'recordings-keep': 0, 'session-reminders': [24, 1] }) as Policy

const env = (k: string) => Deno.env.get(k) ?? ''
export const functionsUrl = () => env('SUPABASE_URL').replace(/\/+$/, '') + '/functions/v1'

/* the unsubscribe link: the user's id and an HMAC of it under a key derived from the service
   role key — nothing to store, nothing a reader can forge */
async function hmac(purpose: string, id: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(purpose + ':' + env('SUPABASE_SERVICE_ROLE_KEY')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(id))
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('')
}
export const unsubscribeUrl = async (userId: string) => `${publicFunctionsUrl()}/email-unsubscribe?u=${encodeURIComponent(userId)}&t=${await hmac('unsubscribe', userId)}`
export const unsubscribeOk = async (userId: string, t: string) => /^[0-9a-f-]{36}$/.test(userId) && t === await hmac('unsubscribe', userId)
/* the tracking: every link and the pixel as a row under a random token — ten characters of
   base62 from the system's randomness (~60 bits), the whole url */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
const token = () => { const b = crypto.getRandomValues(new Uint8Array(10)); let s = ''; for (const x of b) s += ALPHABET[x % ALPHABET.length]; return s }
const site = () => (env('APP_URL') || env('VITE_APP_URL') || '').replace(/\/+$/, '')
/* the functions as a reader reaches them: the site's /v1 (forwarded by the host, else by the app) */
/* the app's own backend on the site's domain: /v1/<function>, the Edge Functions gateway (the v1
   is Supabase's, not ours). It can never be renamed: the links below are in people's inboxes. */
export const publicFunctionsUrl = () => (env('PUBLIC_FUNCTIONS_URL') || (site() ? `${site()}/v1` : functionsUrl())).replace(/\/+$/, '')
export async function tracked(html: string, logId: number) {
  const base = `${publicFunctionsUrl()}/email-track`
  /* the pixel: through the site only when the host is known to rewrite /v1 (the app's shell cannot answer an image) */
  const pixelBase = `${env('PUBLIC_FUNCTIONS_URL') ? publicFunctionsUrl() : functionsUrl()}/email-track`
  const rows: { token: string; log_id: number; kind: string; url: string | null }[] = []
  const out = html.replace(/<a\s([^>]*?)href="(https?:\/\/[^"]+)"/gi, (m, pre, href) => {
    /* the unsubscribe link is left as it is but for the send it was in, so an opt-out is credited to its email */
    if (/email-unsubscribe/.test(href)) return `<a ${pre}href="${href}${/&amp;/.test(href) ? '&amp;' : '&'}l=${logId}"`
    const t = token(); rows.push({ token: t, log_id: logId, kind: 'click', url: href.replace(/&amp;/g, '&') })
    return `<a ${pre}href="${base}/${t}"`
  })
  const o = token(); rows.push({ token: o, log_id: logId, kind: 'open', url: null })
  const { error } = await admin.from('email_links').insert(rows)
  if (error) { console.warn('email_links:', error.message); return html }
  const pixel = `<img src="${pixelBase}/${o}.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" />`
  return /<\/body>/i.test(out) ? out.replace(/<\/body>/i, pixel + '</body>') : out + pixel
}

export const audience = async (rules: Rules): Promise<Person[]> => {
  const { data, error } = await admin.rpc('email_audience', { rules })
  if (error) throw new Error('email_audience: ' + error.message)
  return (data ?? []) as Person[]
}

/* what each person was sent lately, for the cooldowns: one read for everyone in hand */
const DAY = 86400e3
export async function recentSends(userIds: string[]) {
  const since = new Date(Date.now() - 31 * DAY).toISOString()
  const by = new Map<string, { at: number; kind: string; name: string }[]>()
  for (let i = 0; i < userIds.length; i += 500) {
    const { data } = await admin.from('email_log').select('user_id, kind, name, sent_at').in('user_id', userIds.slice(i, i + 500)).gte('sent_at', since)
    for (const r of data ?? []) { const l = by.get(r.user_id) ?? []; l.push({ at: Date.parse(r.sent_at), kind: r.kind, name: r.name }); by.set(r.user_id, l) }
  }
  return by
}
/* who among these already had an email (by its id): the log's word, whatever the file is called now */
export async function alreadyHad(emailId: string, userIds: string[]) {
  const had = new Set<string>()
  for (let i = 0; i < userIds.length; i += 500) {
    const { data } = await admin.from('email_log').select('user_id').eq('email_id', emailId).in('user_id', userIds.slice(i, i + 500))
    for (const r of data ?? []) had.add(r.user_id)
  }
  return had
}
/* the policy's counts hold for this person now; and, for a funnel, its own gap since its last */
export function cooled(sends: { at: number; kind: string; name: string }[] | undefined, policy: Policy, funnel?: { name: string; cooldown: number }) {
  const now = Date.now(), l = sends ?? []
  const within = (d: number) => l.filter((s) => now - s.at < d * DAY).length
  if (policy.daily && within(1) >= policy.daily) return false
  if (policy.weekly && within(7) >= policy.weekly) return false
  if (policy.monthly && within(30) >= policy.monthly) return false
  if (funnel) { const last = l.filter((s) => s.kind === 'funnel' && s.name === funnel.name).map((s) => s.at).sort((a, b) => b - a)[0]; if (last != null && now - last < funnel.cooldown * DAY) return false }
  return true
}

const firstName = (s: string | null | undefined) => String(s || '').trim().split(/\s+/)[0] || ''
/* one marketing email: the log row claimed first (refused = already had it: 'had'), the design
   filled, the tracking laid in, sent, the row stamped — or deleted when the relay refused */
export type SendResult = 'sent' | 'had' | 'failed'
export async function sendMarketing(kind: 'funnel' | 'blast', name: string, step: number | null, p: Person, design: string, email: { id: string; version: string; subject: string; html: string }): Promise<SendResult> {
  if (!DESIGNS[design as keyof typeof DESIGNS]) throw new Error(`no compiled design "${design}"`)
  const data = { name: firstName(p.name) || firstName(p.email.split('@')[0]), subject: email.subject, body: email.html, unsubscribe_url: await unsubscribeUrl(p.user_id) }
  const m = renderEmail(design as any, data, { subject: email.subject })
  const { data: row, error } = await admin.from('email_log').insert({ user_id: p.user_id, email: p.email, kind, name, step, email_id: email.id, version: email.version, subject: m.subject, sent_at: null }).select('id').single()
  if (error || !row) { if (error && /duplicate|unique|23505/i.test(error.message + error.code)) return 'had'; console.warn('email_log:', error?.message); return 'failed' }
  const ok = await sendEmail(p.email, design as any, data, { rendered: { subject: m.subject, html: await tracked(m.html, row.id), text: m.text } })
  if (!ok) { await admin.from('email_log').delete().eq('id', row.id); return 'failed' }
  await admin.from('email_log').update({ sent_at: new Date().toISOString() }).eq('id', row.id)
  return 'sent'
}

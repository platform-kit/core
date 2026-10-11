/*
 * The support desk's shared side (support-chat, support-api): the constants, the guards, the contact's resolution,
 * the threads, the acknowledgement, the escalation — everything the `support` function (the widget's door) and the
 * `support-api` function (Chatwoot's Client and Application APIs) do alike, so a contact who arrives through either
 * is the same guest of the desk. The `support` function's header says what each does.
 */
import { admin, json, getUser, appUrl } from './lib.ts'
import { isSupport } from './roles.ts'
import { sendEmail, WORDS } from './email.ts'
import { PROMPTS, POLICY, type Choice } from './marketing.ts'
export { PROMPTS, POLICY, WORDS }
export type { Choice }


export const PRESENT_MS = 2 * 60 * 1000
export const MIN_GAP_MS = 1000
export const MAX_BODY = 4000
export const MAX_FILE = 10 * 1024 * 1024
export const MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'audio/mpeg': 'mp3', 'application/pdf': 'pdf', 'text/plain': 'txt' }
export const MSG = 'id, author, agent_id, bot, kind, body, attachment_path, attachment_type, attachment_name, attachment_size, seconds, choices, choice_at, choice_key, deleted_at, created_at'
/* a withdrawn line is a placeholder: its words and its file are gone from the answer */
export const hush = <T extends { deleted_at?: string | null }>(rows: T[]) => rows.map((r) => (r.deleted_at ? { ...r, body: null, attachment_path: null, attachment_name: null } : r))
export const SIGN_S = 3600
export const HOUR = 3600e3
export const LIMITS = { guests: 5, threads: 8, uploads: 30, tickets: 10 }
export const TYPING_GAP_MS = 2500
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const env = (k: string) => Deno.env.get(k) ?? ''

export type Contact = { id: string; user_id: string | null; token_hash: string | null; last_seen_at: string | null }
export type Profile = { display_name: string | null; email: string | null; email_verified_at: string | null; role: string | null; roles?: string[] | null }

export const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')
export const newToken = () => { const b = crypto.getRandomValues(new Uint8Array(24)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
export const clean = (s: unknown, max: number) => String(s ?? '').replace(/\s+$/, '').slice(0, max)
export const firstName = (s: string | null | undefined) => String(s || '').trim().split(/\s+/)[0] || ''

/* a choice by its key path, anywhere in a prompt's tree */
/* the choice grammar is one module, shared with the client and the agents (../_shared/choices.js):
   a copy of findChoice here was the beginning of two grammars that agree until they do not */
export { findChoice } from './choices.js'
/* the caller's address, for the guards */
export const ipOf = (req: Request) => (req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? '').split(',')[0].trim().slice(0, 64) || null
/* how many of a thing this address has made in the last hour */
export async function madeLately(ip: string | null, what: 'guests' | 'threads' | 'uploads'): Promise<number> {
  if (!ip) return 0
  const since = new Date(Date.now() - HOUR).toISOString()
  if (what === 'guests') { const { count } = await admin.from('support_contacts').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', since); return count ?? 0 }
  const { data: ks } = await admin.from('support_contacts').select('id').eq('ip', ip)
  const ids = (ks ?? []).map((k: any) => k.id)
  if (!ids.length) return 0
  if (what === 'threads') { const { count } = await admin.from('support_conversations').select('id', { count: 'exact', head: true }).in('contact_id', ids).gte('created_at', since); return count ?? 0 }
  const { count } = await admin.from('support_messages').select('id, support_conversations!inner(contact_id)', { count: 'exact', head: true }).in('support_conversations.contact_id', ids).neq('kind', 'text').gte('created_at', since)
  return count ?? 0
}
/* the contact as the widget sees it: who they are comes from the account, or is nothing */
/* what an away email says of a line that is not words */
export const W_ATTACH = (m: any) => ((WORDS as any).support?.[m.kind === 'voice' ? 'voice-line' : 'file-line']) || (m.attachment_name ?? '')
export const nameOf = (p: Profile | null) => (p ? p.display_name || String(p.email || '').split('@')[0] || null : null)
export const publicContact = (c: Contact, p: Profile | null) => ({ id: c.id, signed_in: !!c.user_id, name: nameOf(p), email: p?.email ?? null, verified: !!p?.email_verified_at })
export async function profileOf(uid: string | null): Promise<Profile | null> {
  if (!uid) return null
  const { data } = await admin.from('profiles').select('display_name, email, email_verified_at, role, roles').eq('id', uid).maybeSingle()
  return (data as Profile) ?? null
}
/* the thread as its owner sees it — listen_key included: the topic the widget listens on for its wake-ups */
export const CONV = 'id, status, source, prompt_id, path, created_at, last_message_at, last_contact_at, last_agent_at, resolved_at, contact_read_at, agent_read_at, agent_typing_at, acknowledged_at, listen_key, bot_off_at'

/* an agent's line carries the agent's name (the display name, else the front of the address) — the
   widget shows their initial in place of the mark once one has answered; the id itself stays here */
export async function withAgents<T extends { agent_id?: string | null }>(rows: T[]): Promise<(Omit<T, 'agent_id'> & { agent_name?: string | null })[]> {
  const ids = [...new Set(rows.map((r) => r.agent_id).filter((x): x is string => !!x))]
  const names = new Map<string, string>()
  if (ids.length) {
    const { data } = await admin.from('profiles').select('id, display_name, email').in('id', ids)
    for (const p of data ?? []) names.set(p.id, p.display_name || String(p.email || '').split('@')[0] || '')
  }
  return rows.map(({ agent_id, ...r }) => ({ ...r, ...(agent_id ? { agent_name: names.get(agent_id) || null } : {}) }))
}
/* every attachment with a url the reader can fetch: the site's own for a prompt's image (an
   absolute url or a /path), the bucket's signed for an hour otherwise — given as the path under the
   project's host (/storage/v1/…), which the widget completes with the host it knows, since the one
   this function knows is the stack's own (kong:8000, locally) */
export async function withUrls<T extends { attachment_path?: string | null }>(rows: T[]): Promise<(T & { url?: string })[]> {
  const paths = rows.map((r) => r.attachment_path).filter((p): p is string => !!p && !/^(https?:)?\//.test(p))
  const signed = new Map<string, string>()
  if (paths.length) {
    const { data } = await admin.storage.from('support').createSignedUrls([...new Set(paths)], SIGN_S)
    for (const d of data ?? []) if (d.path && d.signedUrl) signed.set(d.path, d.signedUrl.replace(/^https?:\/\/[^/]+(?=\/storage\/v1\/)/, ''))
  }
  return rows.map((r) => (r.attachment_path ? { ...r, url: /^(https?:)?\//.test(r.attachment_path) ? r.attachment_path : signed.get(r.attachment_path) } : r))
}

/* the guest contact under the token, or null */
export async function byToken(token: string | null): Promise<Contact | null> {
  if (!token || token.length < 16 || token.length > 128) return null
  const { data } = await admin.from('support_contacts').select('*').eq('token_hash', await sha256(token)).maybeSingle()
  return (data as Contact) ?? null
}
export async function byUser(uid: string): Promise<Contact | null> {
  const { data } = await admin.from('support_contacts').select('*').eq('user_id', uid).maybeSingle()
  return (data as Contact) ?? null
}

/* a guest contact becomes the account's: linked when the account has none, merged when it
   has — the guest's threads move over (a prompt's thread the account already has loses its
   prompt mark rather than its lines), the guest row goes */
export async function adopt(guest: Contact, uid: string): Promise<Contact> {
  const own = await byUser(uid)
  if (!own) {
    const { data } = await admin.from('support_contacts').update({ user_id: uid, token_hash: null, updated_at: new Date().toISOString() }).eq('id', guest.id).select('*').single()
    return data as Contact
  }
  const { data: mine } = await admin.from('support_conversations').select('prompt_id').eq('contact_id', own.id).not('prompt_id', 'is', null)
  const had = new Set((mine ?? []).map((c: any) => c.prompt_id))
  const { data: theirs } = await admin.from('support_conversations').select('id, prompt_id').eq('contact_id', guest.id)
  for (const c of theirs ?? []) {
    await admin.from('support_conversations').update({ contact_id: own.id, ...(c.prompt_id && had.has(c.prompt_id) ? { prompt_id: null } : {}) }).eq('id', c.id)
  }
  await admin.from('support_contacts').delete().eq('id', guest.id)
  return (await byUser(uid)) ?? own
}

/* the caller: a reader (their contact, made on demand by `start`), a guest, or nobody yet */
export type Who = { user: any | null; profile: Profile | null; contact: Contact | null; linked: boolean; staff: boolean }
export async function resolve(req: Request, token: string | null): Promise<Who | Response> {
  const user = await getUser(req)
  if (user) {
    const profile = await profileOf(user.id)
    const staff = isSupport((profile?.roles ?? []) as string[])
    let contact = await byUser(user.id)
    let linked = false
    const guest = await byToken(token)
    if (guest && !guest.user_id) { contact = await adopt(guest, user.id); linked = true }
    return { user, profile, contact, linked, staff }
  }
  if (token) {
    const contact = await byToken(token)
    if (!contact) return json({ error: 'token' }, 401)
    if (contact.user_id) return json({ error: 'signin' }, 401)
    return { user: null, profile: null, contact, linked: false, staff: false }
  }
  return { user: null, profile: null, contact: null, linked: false, staff: false }
}

export async function seen(contact: Contact, body: any, req: Request) {
  await admin.from('support_contacts').update({
    last_seen_at: new Date().toISOString(), last_path: clean(body?.path, 300) || null,
    ua: clean(req.headers.get('user-agent'), 300) || null, ip: ipOf(req), ...(UUID.test(String(body?.anon_id ?? '')) ? { anon_id: String(body.anon_id) } : {}),
  }).eq('id', contact.id)
}

/* the contact's threads, latest first, each with its last line and how many of ours are unread */
export async function threads(contact: Contact) {
  const { data: convs } = await admin.from('support_conversations').select(CONV).eq('contact_id', contact.id).order('last_message_at', { ascending: false, nullsFirst: false }).limit(50)
  const out = []
  for (const c of convs ?? []) {
    const { data: last } = await admin.from('support_messages').select('id, author, kind, body, seconds, created_at').eq('conversation_id', c.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    const { count } = await admin.from('support_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', c.id).eq('author', 'agent').gt('created_at', c.contact_read_at ?? '1970-01-01')
    const { data: agent } = await admin.from('support_messages').select('agent_id').eq('conversation_id', c.id).eq('author', 'agent').not('agent_id', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
    const agentName = agent?.agent_id ? nameOf(await profileOf(agent.agent_id)) : null
    out.push({ ...c, last: last ?? null, unread: count ?? 0, agent_name: agentName })
  }
  return out
}

export async function ownConversation(contact: Contact, id: unknown): Promise<any | null> {
  if (!UUID.test(String(id ?? ''))) return null
  const { data } = await admin.from('support_conversations').select(CONV + ', contact_id').eq('id', String(id)).eq('contact_id', contact.id).maybeSingle()
  return (data as any) ?? null
}

/* the desk's acknowledgement, once per thread: after the reader's first real line — words, a file,
   or the last choice of a prompt's tree — a system line says the message is in and a person will
   answer when they can; nothing more until someone does */
export async function acknowledge(conv: any): Promise<any | null> {
  if (conv.acknowledged_at) return null
  const line = (WORDS as any).support?.received
  if (!line) return null
  const { data: had } = await admin.from('support_messages').select('id').eq('conversation_id', conv.id).eq('author', 'agent').limit(1)
  if (had && had.length) return null
  const { data: msg } = await admin.from('support_messages').insert({ conversation_id: conv.id, author: 'system', body: line }).select(MSG).single()
  await admin.from('support_conversations').update({ acknowledged_at: new Date().toISOString() }).eq('id', conv.id)
  return msg
}
export const isLeaf = (c: Choice | null) => !!c && !(c.children && c.children.length)

/* a line taken back: its file removed, the row kept as a placeholder */
export async function withdraw(msg: { id: string; attachment_path?: string | null }) {
  if (msg.attachment_path && !/^(https?:)?\//.test(msg.attachment_path)) await admin.storage.from('support').remove([msg.attachment_path])
  await admin.from('support_messages').update({ deleted_at: new Date().toISOString(), attachment_path: null }).eq('id', msg.id)
}

/* the escalation: the threads waiting on us past the policy's clock, to whoever should answer —
   the assignee, else SUPPORT_EMAIL, else every staff address — one digest each, each thread once.
   Nothing while an agent is at the desk (support_agents_seen within support-presence); nothing
   for a guest or an unconfirmed address, who cannot be answered by email anyway. */
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
export const spanOf = (ms: number) => { const m = Math.round(ms / 60000); return m < 60 ? m + 'm' : m < 2880 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd' }
export async function escalate(dry = false) {
  const now = Date.now()
  const waitMs = POLICY['support-wait'] * 60000, presenceMs = POLICY['support-presence'] * 60000
  const { data: seen } = await admin.from('support_agents_seen').select('user_id, last_seen_at')
  const present = new Set((seen ?? []).filter((a: any) => now - new Date(a.last_seen_at).getTime() < presenceMs).map((a: any) => a.user_id))
  const { data: convs } = await admin.from('support_conversations').select('id, contact_id, assignee_id, last_contact_at, last_agent_at, created_at')
    .eq('status', 'open').is('escalated_at', null).not('last_contact_at', 'is', null)
  const due: any[] = []
  for (const c of convs ?? []) {
    if (!c.last_contact_at || (c.last_agent_at && new Date(c.last_agent_at) > new Date(c.last_contact_at))) continue
    if (c.assignee_id ? present.has(c.assignee_id) : present.size > 0) continue
    const { data: k } = await admin.from('support_contacts').select('user_id').eq('id', c.contact_id).maybeSingle()
    const p = await profileOf(k?.user_id ?? null)
    if (!p?.email || !p.email_verified_at) continue
    const { data: first } = await admin.from('support_messages').select('body, created_at').eq('conversation_id', c.id).eq('author', 'contact').gt('created_at', c.last_agent_at ?? '1970-01-01').order('created_at', { ascending: true }).limit(1).maybeSingle()
    /* the clock runs from the first line of the unanswered run, not the latest */
    const since = first?.created_at ?? c.last_contact_at
    if (now - new Date(since).getTime() < waitMs) continue
    due.push({ ...c, name: nameOf(p) ?? '', line: first?.body ?? '', since })
  }
  if (!due.length || dry) return { escalated: 0, recipients: 0, would: due.map((c) => ({ id: c.id, name: c.name, since: c.since, assignee_id: c.assignee_id })) }
  /* who gets which: the assignee their own; the rest to the desk */
  let desk = env('SUPPORT_EMAIL').split(/[,\s]+/).filter(Boolean)
  if (!desk.length) { const { data } = await admin.from('profiles').select('email').overlaps('roles', ['admin', 'support']).not('email', 'is', null); desk = (data ?? []).map((p: any) => p.email).filter(Boolean) }
  const byAddr = new Map<string, any[]>()
  for (const c of due) {
    let addrs = desk
    if (c.assignee_id) { const a = await profileOf(c.assignee_id); if (a?.email) addrs = [a.email] }
    for (const addr of addrs) byAddr.set(addr, (byAddr.get(addr) ?? []).concat([c]))
  }
  const W = (WORDS as any)['support-digest'] ?? {}
  const waiting = (c: any) => String(W.waiting || 'waiting {span}').replace('{span}', spanOf(now - new Date(c.since).getTime()))
  const row = (c: any) => `<p style="margin:0 0 12px;font-family:Georgia,serif;font-size:15px;line-height:1.5;color:#0c0d0b"><b>${esc(c.name)}</b> · ${esc(waiting(c))}<br><span style="color:#6c6f69">${esc(c.line.slice(0, 200))}</span></p>`
  let sent = 0
  for (const [addr, list] of byAddr) {
    const ok = await sendEmail(addr, 'support-digest', { count: String(list.length), body: list.map(row).join(''), url: `${appUrl()}/admin/support` })
    if (ok) sent++
  }
  if (sent) await admin.from('support_conversations').update({ escalated_at: new Date().toISOString() }).in('id', due.map((c) => c.id))
  return { escalated: sent ? due.length : 0, recipients: sent }
}


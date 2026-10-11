/*
 * The Support API — the desk served as Chatwoot's APIs (support-api): the Client API (the widget's own door — a guest
 * contact by its source_id, its conversations and messages, typing, last seen; no token, the inbox identifier the
 * site's space id, the widget's guards) at /public/api/v1/…, and the Application API (the desk's — conversations,
 * messages, status, assignments, contacts, inboxes, agents, the profile, webhooks) at /api/v1/… under a key of kind
 * `support` sent as api_access_token (or a bearer), every write attributed to the key's maker. The host rewrites
 * /public/* here and /api/* to the storefront function, which hands /api/v1/* on; the function's own address answers
 * both. The shapes are _shared/api/chatwoot/shapes.js; the contact side is the `support` function's own helpers
 * (_shared/support.ts), so a guest who arrives here is the same guest of the desk. Webhooks: the database tells
 * `deliver` (the service bearer) of every insert and change, and Chatwoot's payload goes to every subscription
 * holding the event.
 *
 *   POST /public/api/v1/inboxes/{inbox}/contacts                              a guest
 *   GET|PATCH …/contacts/{source_id}                                          the contact (custom attributes kept)
 *   GET|POST …/contacts/{source_id}/conversations   GET …/conversations/{id}  the threads; a new one (the desk's default prompt)
 *   GET|POST …/contacts/{source_id}/conversations/{id}/messages               the lines; a line { content, echo_id }
 *   POST …/conversations/{id}/toggle_typing { typing_status }  POST …/update_last_seen  POST …/toggle_status
 *   GET  /api/v1/accounts/{id}/conversations?status&assignee_type&page        GET …/conversations/{id}
 *   GET|POST …/conversations/{id}/messages   POST …/toggle_status { status }   POST …/assignments { assignee_id }
 *   GET  …/contacts?page   GET …/contacts/{id}   GET …/contacts/{id}/conversations   GET …/inboxes   GET …/agents
 *   GET  /api/v1/profile   GET|POST …/webhooks   PATCH|DELETE …/webhooks/{id}
 *   POST /deliver { event, id }                                               the database's, with the service bearer
 */
import { admin, appUrl, isServiceBearer } from '../_shared/lib.ts'
import { isAdmin, isSupport } from '../_shared/roles.ts'
import { tokenOf, keyOf, rateLimit } from '../_shared/api/keys.ts'
import { API_ON, SPACE, SUPPORT_ON } from '../_shared/api/flags.ts'
import * as SITE from '../_shared/pipe/site.js'
import { MSG, CONV, LIMITS, MAX_BODY, MIN_GAP_MS, UUID, sha256, newToken, clean, ipOf, madeLately, profileOf, nameOf, withAgents, withUrls, hush, byToken, seen, threads, ownConversation, acknowledge, PROMPTS, type Contact } from '../_shared/support.ts'
import { messageOf, clientConversationOf, clientContactOf, conversationOf, contactOf, agentOf, inboxOf, webhookOf, webhookPayload, EVENTS, errorOf, contactSender } from '../_shared/api/chatwoot/shapes.js'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, accept, api_access_token, api-access-token, x-support-token', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS' }
const site = () => ({ name: (SITE as any).name || 'Support', space: SPACE, url: appUrl() })
const PAGE = 25

/* a contact with the words the shapes want: the account's name and address, its kind */
async function contactView(k: any) {
  const p = await profileOf(k.user_id ?? null)
  let kind = k.user_id ? 'user' : 'guest'
  if (k.user_id) { const { count } = await admin.from('purchases').select('id', { count: 'exact', head: true }).eq('user_id', k.user_id).eq('status', 'paid'); if (count) kind = 'customer' }
  return { ...k, name: nameOf(p), email: p?.email ?? null, verified: !!p?.email_verified_at, kind }
}
const agentRow = async (id: string | null) => { if (!id) return null; const { data } = await admin.from('profiles').select('id, display_name, email, roles').eq('id', id).maybeSingle(); return data ? { ...data, name: nameOf(data as any) } : null }
async function messagesOf(convId: string, contact: any, since: string | null = null) {
  let q = admin.from('support_messages').select(MSG).eq('conversation_id', convId).order('created_at', { ascending: true }).limit(200)
  if (since) q = q.gt('created_at', since)
  const { data } = await q
  const rows = await withAgents(await withUrls(hush((data ?? []) as any[])))
  return rows.map((m: any) => messageOf(m, { contact, agentName: m.agent_name, conversationId: convId }))
}
/* the Application API's conversation, whole */
async function fullConversation(c: any, { withMessages = true } = {}) {
  const { data: k } = await admin.from('support_contacts').select('*').eq('id', c.contact_id).maybeSingle()
  const contact = k ? await contactView(k) : null
  const assignee = await agentRow(c.assignee_id)
  const messages = withMessages ? await messagesOf(c.id, contact) : []
  const { count: unread } = await admin.from('support_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', c.id).eq('author', 'contact').gt('created_at', c.agent_read_at ?? '1970-01-01')
  let waitingSince: string | null = null
  if (c.status !== 'resolved' && c.last_contact_at && (!c.last_agent_at || new Date(c.last_contact_at) > new Date(c.last_agent_at))) { const { data: first } = await admin.from('support_messages').select('created_at').eq('conversation_id', c.id).eq('author', 'contact').gt('created_at', c.last_agent_at ?? '1970-01-01').order('created_at', { ascending: true }).limit(1).maybeSingle(); waitingSince = first?.created_at ?? c.last_contact_at }
  return conversationOf(c, { contact, assignee, messages, unread: unread ?? 0, waitingSince })
}
const CONV_ALL = CONV + ', contact_id, assignee_id, custom_attributes'

/* the webhooks' delivery: Chatwoot's payload for the event, to every subscription holding it */
async function deliver(event: string, id: string) {
  const { data: subs } = await admin.from('support_webhooks').select('*')
  const want = (subs ?? []).filter((w: any) => (w.subscriptions || []).includes(event))
  if (!want.length) return { delivered: 0 }
  let payload: any = null
  if (event === 'message_created' || event === 'message_updated') {
    const { data: m } = await admin.from('support_messages').select(MSG + ', conversation_id').eq('id', id).maybeSingle(); if (!m) return { delivered: 0 }
    const { data: c } = await admin.from('support_conversations').select(CONV_ALL).eq('id', m.conversation_id).maybeSingle(); if (!c) return { delivered: 0 }
    const conv = await fullConversation(c, { withMessages: false })
    const contact = conv.meta.sender
    const [row] = await withAgents(await withUrls([m as any]))
    payload = webhookPayload(event, { message: messageOf(row as any, { contact: { ...contact, custom_attributes: contact?.custom_attributes }, agentName: (row as any).agent_name, conversationId: c.id }), conversation: conv, site: site() })
  } else if (event.startsWith('conversation_')) {
    const { data: c } = await admin.from('support_conversations').select(CONV_ALL).eq('id', id).maybeSingle(); if (!c) return { delivered: 0 }
    payload = webhookPayload(event, { conversation: await fullConversation(c), site: site() })
  } else if (event.startsWith('contact_')) {
    const { data: k } = await admin.from('support_contacts').select('*').eq('id', id).maybeSingle(); if (!k) return { delivered: 0 }
    payload = { event, ...contactOf(await contactView(k)), account: { id: 1, name: site().name } }
  } else return { delivered: 0 }
  let delivered = 0
  for (const w of want) {
    try {
      const r = await fetch(w.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!r.ok) throw new Error('the subscriber answered ' + r.status)
      await admin.from('support_webhooks').update({ last_at: new Date().toISOString(), last_error: null }).eq('id', w.id); delivered++
    } catch (e) { await admin.from('support_webhooks').update({ last_error: String((e as Error)?.message ?? e).slice(0, 300) }).eq('id', w.id) }
  }
  return { delivered }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  const path = url.pathname.replace(/^(?:.*?\/functions\/v1)?\/support-api(?=\/|$)/, '').replace(/\/+$/, '') || '/'
  const q: Record<string, string> = {}; url.searchParams.forEach((v, k) => { q[k] = v })
  let extra: Record<string, string> = {}
  const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { ...CORS, ...extra, 'Content-Type': 'application/json', ...headers } })
  const fail = (status: number, message: string, code: string | null = null) => reply(errorOf(message, code), status)
  if (!API_ON || !SUPPORT_ON) return fail(404, 'The Support API is not on for this site.')
  const m = req.method
  let body: any = {}
  if (m === 'POST' || m === 'PATCH' || m === 'PUT') { const text = await req.text(); if (text) { try { body = JSON.parse(text) } catch { return fail(400, 'The body is not JSON.') } } }
  const S = site()

  /* ---- the database's: a delivery ---- */
  if (path === '/deliver' && m === 'POST') {
    if (!(await isServiceBearer(req))) return fail(401, 'The deliveries are the database\'s (the service bearer).')
    if (!EVENTS.includes(String(body.event)) || !UUID.test(String(body.id ?? ''))) return fail(400, 'event and id')
    return reply(await deliver(String(body.event), String(body.id)))
  }

  /* ---- the Client API: /public/api/v1/inboxes/<inbox>/… ---- */
  const pub = /^\/public\/api\/v1\/inboxes\/([^/]+)(\/.*)?$/.exec(path)
  if (pub) {
    if (pub[1] !== SPACE) return fail(404, `No inbox "${pub[1]}": this site's inbox identifier is "${SPACE}".`)
    const seg = (pub[2] || '').split('/').filter(Boolean)
    const rl = await rateLimit(ipOf(req) ?? 'anon'); extra = rl.headers
    if (rl.over) return reply(errorOf('Throttled'), 429, { 'Retry-After': String(rl.reset) })
    /* POST contacts: a guest, under a new token (Chatwoot's source_id) */
    if (seg.length === 1 && seg[0] === 'contacts' && m === 'POST') {
      const ip = ipOf(req)
      if (await madeLately(ip, 'guests') >= LIMITS.guests) return fail(429, 'Too many new contacts from this address; try again later.', 'slow down')
      const token = newToken()
      const attrs = body.custom_attributes && typeof body.custom_attributes === 'object' ? body.custom_attributes : {}
      const { data, error } = await admin.from('support_contacts').insert({ token_hash: await sha256(token), ip, custom_attributes: attrs }).select('*').single()
      if (error) return fail(500, error.message)
      await seen(data as Contact, { path: body.path }, req)
      return reply(clientContactOf(await contactView(data), token))
    }
    if (seg[0] !== 'contacts' || !seg[1]) return fail(404, 'Not found.')
    const contact = await byToken(seg[1])
    if (!contact) return fail(404, 'No such contact (the source_id is the contact\'s token).')
    if (contact.user_id) return fail(401, 'This contact is an account\'s: the site\'s own sign-in opens it, not the Client API.')
    const view = () => contactView(contact)
    if (seg.length === 2) {
      if (m === 'GET') return reply(clientContactOf(await view(), seg[1]))
      if (m === 'PATCH' || m === 'PUT') {
        /* the custom attributes are kept; a name or an address typed here is no identity (the site's rule) and is not */
        const attrs = body.custom_attributes && typeof body.custom_attributes === 'object' ? body.custom_attributes : null
        if (attrs) await admin.from('support_contacts').update({ custom_attributes: { ...((contact as any).custom_attributes || {}), ...attrs }, updated_at: new Date().toISOString() }).eq('id', contact.id)
        const { data: fresh } = await admin.from('support_contacts').select('*').eq('id', contact.id).single()
        return reply(clientContactOf(await contactView(fresh), seg[1]))
      }
      return fail(405, 'GET or PATCH.')
    }
    if (seg[2] !== 'conversations') return fail(404, 'Not found.')
    const cv = await view()
    if (seg.length === 3) {
      if (m === 'GET') { const list = await threads(contact); const out = []; for (const c of list) { const msgs = await messagesOf(c.id, cv); out.push(clientConversationOf(c, { contact: cv, messages: msgs })) } return reply(out) }
      if (m === 'POST') {
        if (await madeLately(ipOf(req), 'threads') >= LIMITS.threads) return fail(429, 'Too many new conversations from this address; try again later.', 'slow down')
        /* the desk's default prompt opens the thread, as the panel's start does; none: an empty thread waiting for its first line */
        const def = Object.values(PROMPTS).find((p: any) => p.default) as any
        const { data: conv, error } = await admin.from('support_conversations').insert({ contact_id: contact.id, source: def ? 'prompt' : 'contact', path: clean(body.path, 300) || null, custom_attributes: body.custom_attributes && typeof body.custom_attributes === 'object' ? body.custom_attributes : {} }).select(CONV_ALL).single()
        if (error || !conv) return fail(500, error?.message ?? 'not made')
        if (def) await admin.from('support_messages').insert({ conversation_id: conv.id, author: 'system', body: def.text })
        await seen(contact, { path: body.path }, req)
        return reply(clientConversationOf(conv, { contact: cv, messages: await messagesOf(conv.id, cv) }))
      }
      return fail(405, 'GET or POST.')
    }
    const conv = await ownConversation(contact, seg[3])
    if (!conv) return fail(404, 'No such conversation.')
    if (seg.length === 4) { if (m === 'GET') return reply(clientConversationOf(conv, { contact: cv, messages: await messagesOf(conv.id, cv) })); return fail(405, 'GET.') }
    const op = seg[4]
    if (op === 'messages') {
      if (m === 'GET') { const since = q.after ? new Date(Number(q.after) * 1000).toISOString() : null; return reply(await messagesOf(conv.id, cv, since)) }
      if (m === 'POST') {
        const text = clean(body.content, MAX_BODY).trim(); if (!text) return fail(400, 'content is required.')
        if (conv.last_contact_at && Date.now() - new Date(conv.last_contact_at).getTime() < MIN_GAP_MS) return fail(429, 'One line a second.', 'slow down')
        const { data: msg, error } = await admin.from('support_messages').insert({ conversation_id: conv.id, author: 'contact', body: text }).select(MSG).single()
        if (error) return fail(500, error.message)
        await acknowledge(conv)
        return reply(messageOf(msg as any, { contact: cv, conversationId: conv.id, echoId: body.echo_id ? String(body.echo_id) : null }))
      }
      return fail(405, 'GET or POST.')
    }
    if (op === 'toggle_typing' && m === 'POST') { if (String(body.typing_status || 'on') !== 'off') await admin.from('support_conversations').update({ contact_typing_at: new Date().toISOString() }).eq('id', conv.id); return reply({ ok: true }) }
    if (op === 'update_last_seen' && m === 'POST') { await admin.from('support_conversations').update({ contact_read_at: new Date().toISOString() }).eq('id', conv.id); return reply({ ok: true }) }
    if (op === 'toggle_status' && m === 'POST') { const { data: c2 } = await admin.from('support_conversations').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', conv.id).select(CONV_ALL).single(); return reply(clientConversationOf(c2, { contact: cv, messages: await messagesOf(conv.id, cv) })) }
    return fail(404, 'Not found.')
  }

  /* ---- the Application API: /api/v1/accounts/<id>/… and /api/v1/profile, under a support key ---- */
  const app = /^\/api\/v1(?:\/accounts\/[^/]+)?(\/.*)?$/.exec(path)
  if (!app) return fail(404, 'Not found: the Client API is /public/api/v1/inboxes/<inbox>/…, the Application API /api/v1/accounts/<id>/….')
  const token = req.headers.get('api_access_token') || req.headers.get('api-access-token') || tokenOf(req, q)
  const caller = await keyOf(token, ['support'])
  if (caller === 'other-kind') return fail(403, 'This key does not open the Support API: make one of kind support under Settings → API.')
  if (!caller) return fail(401, 'You need to sign in or sign up before continuing.')
  const rl = await rateLimit(caller.id ?? 'key'); extra = rl.headers
  if (rl.over) return reply(errorOf('Throttled'), 429, { 'Retry-After': String(rl.reset) })
  const { data: keyRow } = await admin.from('api_keys').select('created_by, name').eq('id', caller.id!).maybeSingle()
  const me = await agentRow(keyRow?.created_by ?? null)
  if (!me || !isSupport(((me as any).roles ?? []) as string[])) return fail(403, 'The key\'s maker is not on the desk.')
  const seg = (app[1] || '').split('/').filter(Boolean)
  const paged = (list: any[]) => { const page = Math.max(1, Number(q.page) || 1); return list.slice((page - 1) * PAGE, page * PAGE) }

  if (seg[0] === 'profile' && m === 'GET') return reply({ ...agentOf(me), accounts: [{ id: 1, name: S.name, role: isAdmin(((me as any).roles ?? []) as string[]) ? 'administrator' : 'agent' }] })
  if (seg[0] === 'inboxes' && m === 'GET') return reply({ payload: [inboxOf(S)] })
  /* who is on the desk is the set of roles, never the old single column: somebody given `support`
     on the People page keeps whatever `role` said before, so filtering on that dropped them. */
  if (seg[0] === 'agents' && m === 'GET') { const { data } = await admin.from('profiles').select('id, display_name, email, roles').overlaps('roles', ['admin', 'support']).order('display_name'); return reply((data ?? []).map((p: any) => agentOf({ ...p, name: nameOf(p) }))) }

  if (seg[0] === 'conversations') {
    if (seg.length === 1 && m === 'GET') {
      const status = ['open', 'pending', 'resolved'].includes(String(q.status)) ? String(q.status) : null
      let sel = admin.from('support_conversations').select(CONV_ALL).order('last_message_at', { ascending: false, nullsFirst: false }).limit(1000)
      if (status) sel = sel.eq('status', status)
      const { data: rows } = await sel
      const all = (rows ?? []) as any[]
      const mine = all.filter((c) => c.assignee_id === (me as any).id), unassigned = all.filter((c) => !c.assignee_id)
      const which = q.assignee_type === 'me' ? mine : q.assignee_type === 'unassigned' ? unassigned : all
      const payload = []; for (const c of paged(which)) payload.push(await fullConversation(c, { withMessages: false }))
      return reply({ data: { meta: { mine_count: mine.length, unassigned_count: unassigned.length, all_count: all.length }, payload } })
    }
    if (!UUID.test(String(seg[1] ?? ''))) return fail(404, 'Not found.')
    const { data: c } = await admin.from('support_conversations').select(CONV_ALL).eq('id', seg[1]).maybeSingle()
    if (!c) return fail(404, 'Conversation not found.')
    if (seg.length === 2 && m === 'GET') return reply(await fullConversation(c))
    if (seg[2] === 'messages') {
      const conv = await fullConversation(c, { withMessages: false })
      if (m === 'GET') return reply({ meta: { labels: [], additional_attributes: conv.additional_attributes, contact: conv.meta.sender, assignee: conv.meta.assignee }, payload: await messagesOf(c.id, conv.meta.sender) })
      if (m === 'POST') {
        const text = clean(body.content, MAX_BODY).trim(); if (!text) return fail(400, 'content is required.')
        if (body.private) return fail(422, 'Private notes are not kept here: the note on the contact is (contacts.notes).')
        if (body.message_type && body.message_type !== 'outgoing') return fail(422, 'An agent\'s message is outgoing.')
        const { data: msg, error } = await admin.from('support_messages').insert({ conversation_id: c.id, author: 'agent', agent_id: (me as any).id, body: text }).select(MSG).single()
        if (error) return fail(500, error.message)
        await admin.from('support_conversations').update({ agent_read_at: new Date().toISOString() }).eq('id', c.id)
        return reply(messageOf(msg as any, { contact: conv.meta.sender, agentName: (me as any).name, conversationId: c.id }))
      }
      return fail(405, 'GET or POST.')
    }
    if (seg[2] === 'toggle_status' && m === 'POST') {
      const status = ['open', 'pending', 'resolved'].includes(String(body.status)) ? String(body.status) : (c.status === 'resolved' ? 'open' : 'resolved')
      await admin.from('support_conversations').update({ status, ...(status === 'resolved' ? { resolved_at: new Date().toISOString() } : {}) }).eq('id', c.id)
      return reply({ meta: {}, payload: { success: true, current_status: status, conversation_id: c.id } })
    }
    if (seg[2] === 'assignments' && m === 'POST') {
      const id = body.assignee_id == null || body.assignee_id === 0 || body.assignee_id === '' ? null : String(body.assignee_id)
      const agent = id ? await agentRow(id) : null
      if (id && (!agent || !isSupport(((agent as any).roles ?? []) as string[]))) return fail(422, 'No such agent.')
      await admin.from('support_conversations').update({ assignee_id: id }).eq('id', c.id)
      return reply(agent ? agentOf(agent) : null)
    }
    return fail(404, 'Not found.')
  }

  if (seg[0] === 'contacts') {
    if (seg.length === 1 && m === 'GET') {
      const { data: rows } = await admin.from('support_contacts').select('*').order('last_seen_at', { ascending: false, nullsFirst: false }).limit(1000)
      const payload = []; for (const k of paged((rows ?? []) as any[])) payload.push(contactOf(await contactView(k)))
      return reply({ meta: { count: (rows ?? []).length, current_page: Math.max(1, Number(q.page) || 1) }, payload })
    }
    if (!UUID.test(String(seg[1] ?? ''))) return fail(404, 'Not found.')
    const { data: k } = await admin.from('support_contacts').select('*').eq('id', seg[1]).maybeSingle()
    if (!k) return fail(404, 'Contact not found.')
    if (seg.length === 2 && m === 'GET') { const { count } = await admin.from('support_conversations').select('id', { count: 'exact', head: true }).eq('contact_id', k.id); return reply({ payload: contactOf(await contactView(k), { conversationsCount: count ?? 0 }) }) }
    if (seg[2] === 'conversations' && m === 'GET') { const { data: rows } = await admin.from('support_conversations').select(CONV_ALL).eq('contact_id', k.id).order('last_message_at', { ascending: false, nullsFirst: false }); const payload = []; for (const c of (rows ?? []) as any[]) payload.push(await fullConversation(c, { withMessages: false })); return reply({ payload }) }
    return fail(404, 'Not found.')
  }

  if (seg[0] === 'webhooks') {
    const view = (w: any) => ({ payload: { webhook: webhookOf(w) } })
    if (seg.length === 1 && m === 'GET') { const { data } = await admin.from('support_webhooks').select('*').order('created_at'); return reply({ payload: { webhooks: (data ?? []).map(webhookOf) } }) }
    const input = () => { const w = body.webhook && typeof body.webhook === 'object' ? body.webhook : body; const urlOk = typeof w.url === 'string' && /^https?:\/\/\S+$/.test(w.url); const subs = Array.isArray(w.subscriptions) ? w.subscriptions.map(String).filter((e: string) => EVENTS.includes(e)) : null; return { url: urlOk ? w.url : null, subscriptions: subs } }
    if (seg.length === 1 && m === 'POST') {
      const w = input(); if (!w.url) return fail(422, 'url is required and must be http(s).'); if (!w.subscriptions || !w.subscriptions.length) return fail(422, 'subscriptions names at least one event: ' + EVENTS.join(', '))
      const { data, error } = await admin.from('support_webhooks').insert({ url: w.url, subscriptions: w.subscriptions, created_by: (me as any).id }).select('*').single(); if (error) return fail(500, error.message)
      return reply(view(data), 201)
    }
    if (!UUID.test(String(seg[1] ?? ''))) return fail(404, 'Not found.')
    if (m === 'PATCH' || m === 'PUT') { const w = input(); const patch: any = { updated_at: new Date().toISOString() }; if (w.url) patch.url = w.url; if (w.subscriptions && w.subscriptions.length) patch.subscriptions = w.subscriptions; const { data, error } = await admin.from('support_webhooks').update(patch).eq('id', seg[1]).select('*').maybeSingle(); if (error) return fail(500, error.message); return data ? reply(view(data)) : fail(404, 'Webhook not found.') }
    if (m === 'DELETE') { await admin.from('support_webhooks').delete().eq('id', seg[1]); return reply(null, 204) }
    return fail(405, 'GET, POST, PATCH or DELETE.')
  }
  return fail(404, 'Not found.')
})

/* The Support API (support-api): the desk as Chatwoot's.
   (1) Under Node: Chatwoot's shapes from the desk's rows — a message by author (incoming, outgoing, activity) with an
       attachment, a conversation with its meta, a contact, the inbox, an agent, a webhook payload. (2) With the stack
       up and the function served: the Client API's life of a guest — a contact (source_id), a conversation opening on
       the desk's default prompt, a message with its echo_id, the acknowledgement as an activity line, typing, last
       seen, the guards; the Application API under a support key — the list with its counts, a conversation with its
       messages, a reply landing as the key's maker's, toggle_status, an assignment, contacts, agents, the profile;
       no token 401, a delivery key 403; a webhook subscription receiving a contact's line (the Client API), an
       agent's line under RLS (the seed's agent), a status change. (3) On Playwright: Chatwoot's snippet on a page of
       another origin — chatwidget:ready (and chatwoot:ready beside it), $chatwidget.toggle, a line sent, reset through the alias. Skipped where the stack is down or the
       support or api module is off; SUPPORT_API_TEST=0 skips it. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { loadSite } from './site.mjs'
import { messageOf, conversationOf, contactOf, clientContactOf, clientConversationOf, inboxOf, agentOf, webhookPayload, webhookOf, EVENTS, TYPE_WORD } from '../supabase/functions/_shared/api/chatwoot/shapes.js'
import { context as browserContext } from './browser.mjs'   /* one timeout for every browser here: build/browser.mjs */

const note = (m) => console.log('support-api: ' + m)
if (process.env.SUPPORT_API_TEST === '0') { note('skipped (SUPPORT_API_TEST=0)'); process.exit(0) }
const ROOT = process.cwd()
const c = await loadSite(ROOT)
if ((c.modules && c.modules.support === false) || (c.modules && c.modules.api === false)) { note('skipped — the support or the api module is off'); process.exit(0) }
let pass = 0, fail = 0
const ok = async (name, fn) => { try { await fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + (e && e.message ? e.message.split('\n').join('\n    ') : e)) } }

/* ---- (1) the shapes ---- */
await ok('Chatwoot\'s shapes: a message by author with its type, an attachment, a conversation with its meta, a contact, the inbox, an agent, a webhook payload', () => {
  const contact = { id: 'k1', user_id: null, name: null, email: null, verified: false, kind: 'guest', custom_attributes: { plan: 'free' }, created_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-01-02T00:00:00Z' }
  const inc = messageOf({ id: 'm1', author: 'contact', kind: 'text', body: 'Hello', created_at: '2026-01-01T00:00:10Z' }, { contact, conversationId: 'c1', echoId: 'e1' })
  assert.equal(inc.message_type, 0); assert.equal(inc.content, 'Hello'); assert.equal(inc.sender.type, 'contact'); assert.equal(inc.sender.name, 'Guest'); assert.equal(inc.echo_id, 'e1'); assert.equal(inc.created_at, 1767225610); assert.equal(inc.content_type, 'text')
  const out = messageOf({ id: 'm2', author: 'agent', agent_id: 'a1', kind: 'text', body: 'Hi', created_at: '2026-01-01T00:00:20Z' }, { contact, agentName: 'Sam' }); assert.equal(out.message_type, 1); assert.equal(out.sender.type, 'user'); assert.equal(out.sender.name, 'Sam')
  const sys = messageOf({ id: 'm3', author: 'system', kind: 'text', body: 'Got it', created_at: '2026-01-01T00:00:30Z' }); assert.equal(sys.message_type, 2); assert.equal(sys.sender, null)
  const file = messageOf({ id: 'm4', author: 'contact', kind: 'file', body: 'a.png', attachment_path: 'c1/m4.png', attachment_type: 'image/png', attachment_name: 'a.png', attachment_size: 12, url: '/storage/v1/x', created_at: '2026-01-01T00:00:40Z' }, { contact })
  assert.equal(file.attachments[0].file_type, 'image'); assert.equal(file.attachments[0].data_url, '/storage/v1/x'); assert.equal(file.attachments[0].extension, 'png')
  const voice = messageOf({ id: 'm5', author: 'contact', kind: 'voice', attachment_path: 'c1/m5.mp3', attachment_type: 'audio/mpeg', seconds: 4, url: '/s', created_at: '2026-01-01T00:00:50Z' }, { contact }); assert.equal(voice.attachments[0].file_type, 'audio'); assert.equal(voice.content_attributes.seconds, 4)
  const gone = messageOf({ id: 'm6', author: 'contact', kind: 'text', body: null, deleted_at: '2026-01-01T00:01:00Z', created_at: '2026-01-01T00:00:55Z' }, { contact }); assert.equal(gone.content, null); assert.deepEqual(gone.content_attributes, { deleted: true })
  const conv = conversationOf({ id: 'c1', status: 'open', source: 'contact', path: '/store', created_at: '2026-01-01T00:00:00Z', last_message_at: '2026-01-01T00:00:20Z', assignee_id: 'a1', agent_read_at: null, contact_read_at: null, custom_attributes: {} }, { contact, assignee: { id: 'a1', name: 'Sam', email: 's@x', role: 'support' }, messages: [inc, out, sys], unread: 1, waitingSince: '2026-01-01T00:00:10Z' })
  assert.equal(conv.status, 'open'); assert.equal(conv.meta.sender.id, 'k1'); assert.equal(conv.meta.assignee.role, 'agent'); assert.equal(conv.unread_count, 1); assert.equal(conv.waiting_since, 1767225610); assert.equal(conv.last_non_activity_message.id, 'm2'); assert.equal(conv.channel, 'Channel::WebWidget'); assert.equal(conv.additional_attributes.path, '/store')
  const k = contactOf(contact, { sourceId: 'tok' }); assert.equal(k.name, 'Guest'); assert.equal(k.contact_inboxes[0].source_id, 'tok'); assert.equal(k.additional_attributes.kind, 'guest'); assert.deepEqual(k.custom_attributes, { plan: 'free' })
  const user = contactOf({ ...contact, user_id: 'u1', name: 'Ada', email: 'ada@x', verified: true, kind: 'customer' }); assert.equal(user.name, 'Ada'); assert.equal(user.identifier, 'u1'); assert.equal(user.additional_attributes.kind, 'customer')
  assert.equal(clientContactOf(contact, 'tok').source_id, 'tok'); assert.equal(clientConversationOf({ id: 'c1', status: 'open', listen_key: 'lk', created_at: '2026-01-01T00:00:00Z' }, { contact, messages: [inc] }).pubsub_token, 'lk')
  const inbox = inboxOf({ name: 'Site', space: 'site', url: 'https://x.test' }); assert.equal(inbox.channel_type, 'Channel::WebWidget'); assert.equal(inbox.website_token, 'site')
  assert.equal(agentOf({ id: 'a1', name: 'Sam', email: 's@x', roles: ['admin'] }).role, 'administrator')
  const wh = webhookPayload('message_created', { message: out, conversation: conv, site: { name: 'Site' } }); assert.equal(wh.event, 'message_created'); assert.equal(wh.message_type, 'outgoing'); assert.equal(wh.created_at, '2026-01-01T00:00:20.000Z'); assert.equal(wh.conversation.id, 'c1'); assert.equal(wh.inbox.name, 'Site'); assert.equal(wh.account.id, 1)
  const wc = webhookPayload('conversation_status_changed', { conversation: conv, site: {} }); assert.equal(wc.event, 'conversation_status_changed'); assert.equal(wc.status, 'open')
  assert.deepEqual(webhookOf({ id: 'w1', url: 'https://x', subscriptions: ['message_created'] }).subscriptions, ['message_created']); assert.ok(EVENTS.includes('conversation_created')); assert.equal(TYPE_WORD.agent, 'outgoing')
})

/* ---- (2) the served door ---- */
const url = supabaseUrl(), anon = process.env.VITE_SUPABASE_ANON_KEY || ''
const FN = url + '/functions/v1/support-api'
let served = false
try { served = !!(url && anon && localStack()) && (await fetch(FN + '/api/v1/profile', { signal: AbortSignal.timeout(4000) })).status === 401 } catch { /* down */ }
if (!served) { note(`${pass} passed${fail ? ', ' + fail + ' failed' : ''} (the shapes — the local stack is not up or the support-api function is not served)`); process.exit(fail ? 1 : 0) }
const { createClient } = await import('@supabase/supabase-js')
const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const sha256 = async (s) => { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('') }
const made = []
const makeKey = async (kind) => { const key = `pk_${kind}_probe${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; const { data: admin } = await service.from('profiles').select('id').eq('email', 'admin@example.com').maybeSingle(); const { error } = await service.from('api_keys').insert({ name: 'support-api test', kind, gated: false, prefix: key.slice(0, 12), hash: await sha256(key), created_by: admin ? admin.id : null }); if (error) throw new Error(error.message); made.push(key); return key }
const call = async (p, { method = 'GET', body = null, headers = {} } = {}) => { const r = await fetch(FN + p, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) } }
const INBOX = (await import('./content-json.mjs')).contentIndex ? String((await (await import('./content-json.mjs')).contentIndex({ root: ROOT })).space) : ''
const PUB = `/public/api/v1/inboxes/${INBOX}`
const ids = { contacts: [], convs: [], hooks: [] }
try {
  const key = await makeKey('support')
  const AUTH = { api_access_token: key }
  let sourceId = null, convId = null, echoOk = false
  await ok('the Client API: a guest contact (source_id), a conversation on the desk\'s default prompt, a message with its echo_id, the acknowledgement as an activity line, typing and last seen, the contact read and patched; a wrong inbox 404', async () => {
    assert.equal((await call('/public/api/v1/inboxes/nope/contacts', { method: 'POST', body: {} })).status, 404)
    const made = await call(PUB + '/contacts', { method: 'POST', body: { custom_attributes: { plan: 'trial' } } }); assert.equal(made.status, 200, JSON.stringify(made.body)); sourceId = made.body.source_id; assert.ok(sourceId && sourceId.length >= 16); ids.contacts.push(made.body.id)
    assert.equal(made.body.name, null, 'a guest has no name'); assert.deepEqual(made.body.custom_attributes, { plan: 'trial' })
    const got = await call(PUB + '/contacts/' + sourceId); assert.equal(got.status, 200); assert.equal(got.body.id, made.body.id)
    const patched = await call(PUB + '/contacts/' + sourceId, { method: 'PATCH', body: { name: 'Typed Name', custom_attributes: { city: 'Lisbon' } } }); assert.equal(patched.body.name, null, 'a typed name is no identity'); assert.deepEqual(patched.body.custom_attributes, { plan: 'trial', city: 'Lisbon' })
    const conv = await call(PUB + '/contacts/' + sourceId + '/conversations', { method: 'POST', body: { path: '/store' } }); assert.equal(conv.status, 200, JSON.stringify(conv.body)); convId = conv.body.id; ids.convs.push(convId)
    assert.equal(conv.body.status, 'open'); assert.ok(conv.body.pubsub_token, 'the thread\'s topic key'); assert.equal(conv.body.contact.id, made.body.id)
    const msg = await call(PUB + '/contacts/' + sourceId + '/conversations/' + convId + '/messages', { method: 'POST', body: { content: 'Where is my order?', echo_id: 'e-1' } }); assert.equal(msg.status, 200, JSON.stringify(msg.body)); assert.equal(msg.body.message_type, 0); assert.equal(msg.body.content, 'Where is my order?'); echoOk = msg.body.echo_id === 'e-1'
    const list = await call(PUB + '/contacts/' + sourceId + '/conversations/' + convId + '/messages'); assert.equal(list.status, 200); assert.ok(list.body.some((x) => x.message_type === 0 && x.content === 'Where is my order?')); assert.ok(list.body.some((x) => x.message_type === 2), 'the acknowledgement as an activity line: ' + JSON.stringify(list.body.map((x) => [x.message_type, x.content])))
    const { data: row } = await service.from('support_contacts').select('token_hash, user_id').eq('id', made.body.id).single(); assert.equal(row.token_hash, await sha256(sourceId), 'the source_id is the contact token'); assert.equal(row.user_id, null)
    assert.equal((await call(PUB + '/contacts/' + sourceId + '/conversations/' + convId + '/toggle_typing', { method: 'POST', body: { typing_status: 'on' } })).status, 200)
    const { data: c1 } = await service.from('support_conversations').select('contact_typing_at').eq('id', convId).single(); assert.ok(c1.contact_typing_at, 'typing stamped')
    assert.equal((await call(PUB + '/contacts/' + sourceId + '/conversations/' + convId + '/update_last_seen', { method: 'POST', body: {} })).status, 200)
    const { data: c2 } = await service.from('support_conversations').select('contact_read_at').eq('id', convId).single(); assert.ok(c2.contact_read_at, 'read stamped')
    const all = await call(PUB + '/contacts/' + sourceId + '/conversations'); assert.equal(all.status, 200); assert.ok(all.body.some((x) => x.id === convId))
    assert.equal((await call(PUB + '/contacts/' + sourceId + '/conversations/' + '0'.repeat(8) + '-0000-0000-0000-000000000000')).status, 404)
    assert.equal(echoOk, true, 'echo_id echoed')
  })
  await ok('the Application API under a support key: the list with its counts, a conversation with its messages, a reply landing as the key\'s maker\'s, toggle_status, an assignment, contacts, agents, inboxes, the profile; no token 401, a delivery key 403', async () => {
    assert.equal((await call('/api/v1/profile')).status, 401)
    const dk = await makeKey('delivery'); assert.equal((await call('/api/v1/profile', { headers: { api_access_token: dk } })).status, 403)
    const me = await call('/api/v1/profile', { headers: AUTH }); assert.equal(me.status, 200); assert.equal(me.body.email, 'admin@example.com'); assert.equal(me.body.role, 'administrator')
    const list = await call('/api/v1/accounts/1/conversations?status=open&assignee_type=all', { headers: AUTH }); assert.equal(list.status, 200, JSON.stringify(list.body)); assert.ok(list.body.data.meta.all_count >= 1); assert.ok(list.body.data.payload.some((x) => x.id === convId)); const mine = list.body.data.payload.find((x) => x.id === convId); assert.equal(mine.meta.sender.name, 'Guest'); assert.equal(mine.unread_count, 1)
    const one = await call('/api/v1/accounts/1/conversations/' + convId, { headers: AUTH }); assert.equal(one.status, 200); assert.ok(one.body.messages.some((x) => x.message_type === 0)); assert.equal(one.body.additional_attributes.path, '/store')
    const reply = await call('/api/v1/accounts/1/conversations/' + convId + '/messages', { method: 'POST', headers: AUTH, body: { content: 'On its way.', message_type: 'outgoing' } }); assert.equal(reply.status, 200, JSON.stringify(reply.body)); assert.equal(reply.body.message_type, 1); assert.equal(reply.body.sender.type, 'user')
    const { data: m } = await service.from('support_messages').select('author, agent_id, body').eq('id', reply.body.id).single(); assert.equal(m.author, 'agent'); assert.equal(m.body, 'On its way.'); const { data: admin } = await service.from('profiles').select('id').eq('email', 'admin@example.com').single(); assert.equal(m.agent_id, admin.id, 'the key\'s maker')
    const msgs = await call('/api/v1/accounts/1/conversations/' + convId + '/messages', { headers: AUTH }); assert.equal(msgs.status, 200); assert.ok(msgs.body.payload.some((x) => x.id === reply.body.id)); assert.equal(msgs.body.meta.contact.id, ids.contacts[0])
    const { data: agents } = await service.from('profiles').select('id, email').overlaps('roles', ['admin', 'support']); const other = agents.find((a) => a.email !== 'admin@example.com') || agents[0]
    const asg = await call('/api/v1/accounts/1/conversations/' + convId + '/assignments', { method: 'POST', headers: AUTH, body: { assignee_id: other.id } }); assert.equal(asg.status, 200); assert.equal(asg.body.id, other.id)
    const { data: c1 } = await service.from('support_conversations').select('assignee_id').eq('id', convId).single(); assert.equal(c1.assignee_id, other.id)
    assert.equal((await call('/api/v1/accounts/1/conversations/' + convId + '/assignments', { method: 'POST', headers: AUTH, body: { assignee_id: '00000000-0000-0000-0000-000000000000' } })).status, 422)
    const st = await call('/api/v1/accounts/1/conversations/' + convId + '/toggle_status', { method: 'POST', headers: AUTH, body: { status: 'resolved' } }); assert.equal(st.status, 200); assert.equal(st.body.payload.current_status, 'resolved')
    const { data: c2 } = await service.from('support_conversations').select('status, resolved_at').eq('id', convId).single(); assert.equal(c2.status, 'resolved'); assert.ok(c2.resolved_at)
    const resolved = await call('/api/v1/accounts/1/conversations?status=resolved', { headers: AUTH }); assert.ok(resolved.body.data.payload.some((x) => x.id === convId))
    const contacts = await call('/api/v1/accounts/1/contacts', { headers: AUTH }); assert.equal(contacts.status, 200); const k = contacts.body.payload.find((x) => x.id === ids.contacts[0]); assert.ok(k, 'the guest listed'); assert.equal(k.name, 'Guest'); assert.deepEqual(k.custom_attributes, { plan: 'trial', city: 'Lisbon' })
    const kone = await call('/api/v1/accounts/1/contacts/' + ids.contacts[0], { headers: AUTH }); assert.equal(kone.body.payload.conversations_count, 1)
    const kconvs = await call('/api/v1/accounts/1/contacts/' + ids.contacts[0] + '/conversations', { headers: AUTH }); assert.ok(kconvs.body.payload.some((x) => x.id === convId))
    const ag = await call('/api/v1/accounts/1/agents', { headers: AUTH }); assert.ok(ag.body.some((a) => a.email === 'admin@example.com' && a.role === 'administrator'))
    const inb = await call('/api/v1/accounts/1/inboxes', { headers: AUTH }); assert.equal(inb.body.payload[0].website_token, INBOX); assert.equal(inb.body.payload[0].channel_type, 'Channel::WebWidget')
  })
  await ok('webhooks: a subscription made through the Application API receives a contact\'s line (the Client API), an agent\'s line under RLS (the seed\'s support agent), and a status change; listed, updated, deleted', async () => {
    const hits = []
    const server = http.createServer((rq, rs) => { let b = ''; rq.on('data', (c) => { b += c }); rq.on('end', () => { hits.push(JSON.parse(b)); rs.writeHead(200); rs.end('ok') }) })
    await new Promise((r) => server.listen(0, '0.0.0.0', r))
    const receiver = `http://host.docker.internal:${server.address().port}/hook`
    try {
      const w = await call('/api/v1/accounts/1/webhooks', { method: 'POST', headers: AUTH, body: { url: receiver, subscriptions: ['message_created', 'conversation_status_changed', 'conversation_created'] } }); assert.equal(w.status, 201, JSON.stringify(w.body)); const hookId = w.body.payload.webhook.id; ids.hooks.push(hookId)
      const listed = await call('/api/v1/accounts/1/webhooks', { headers: AUTH }); assert.ok(listed.body.payload.webhooks.some((x) => x.id === hookId))
      const upd = await call('/api/v1/accounts/1/webhooks/' + hookId, { method: 'PATCH', headers: AUTH, body: { webhook: { url: receiver, subscriptions: ['message_created', 'conversation_status_changed'] } } }); assert.equal(upd.status, 200); assert.deepEqual(upd.body.payload.webhook.subscriptions, ['message_created', 'conversation_status_changed'])
      /* a contact's line through the Client API */
      const conv2 = await call(PUB + '/contacts/' + sourceId + '/conversations', { method: 'POST', body: {} }); ids.convs.push(conv2.body.id)
      hits.length = 0
      await call(PUB + '/contacts/' + sourceId + '/conversations/' + conv2.body.id + '/messages', { method: 'POST', body: { content: 'A second question' } })
      for (let i = 0; i < 40 && !hits.some((h) => h.event === 'message_created' && h.message_type === 'incoming' && h.content === 'A second question'); i++) await new Promise((r) => setTimeout(r, 300))
      const inc = hits.find((h) => h.event === 'message_created' && h.message_type === 'incoming' && h.content === 'A second question'); assert.ok(inc, 'the contact\'s line delivered: ' + JSON.stringify(hits.map((h) => [h.event, h.message_type, h.content])))
      assert.equal(inc.conversation.id, conv2.body.id); assert.equal(inc.sender.type, 'contact'); assert.equal(inc.inbox.id, 1); assert.ok(inc.account.name)
      /* an agent's line under RLS, as the inbox writes one */
      const anonKey = anon; const agent = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
      const { error: se } = await agent.auth.signInWithPassword({ email: 'support@example.com', password: 'password123' }); if (se) { const { error: se2 } = await agent.auth.signInWithPassword({ email: 'admin@example.com', password: 'password123' }); assert.ok(!se2, 'a staff sign-in') }
      const { data: who } = await agent.auth.getUser()
      const { error: ie } = await agent.from('support_messages').insert({ conversation_id: conv2.body.id, author: 'agent', agent_id: who.user.id, body: 'From the inbox' }); assert.ok(!ie, ie && ie.message)
      for (let i = 0; i < 40 && !hits.some((h) => h.event === 'message_created' && h.message_type === 'outgoing'); i++) await new Promise((r) => setTimeout(r, 300))
      const out = hits.find((h) => h.event === 'message_created' && h.message_type === 'outgoing'); assert.ok(out, 'the agent\'s line delivered'); assert.equal(out.sender.type, 'user'); assert.equal(out.content, 'From the inbox')
      /* a status change through the Application API */
      await call('/api/v1/accounts/1/conversations/' + conv2.body.id + '/toggle_status', { method: 'POST', headers: AUTH, body: { status: 'resolved' } })
      for (let i = 0; i < 40 && !hits.some((h) => h.event === 'conversation_status_changed'); i++) await new Promise((r) => setTimeout(r, 300))
      const sc = hits.find((h) => h.event === 'conversation_status_changed'); assert.ok(sc, 'the status change delivered'); assert.equal(sc.status, 'resolved'); assert.equal(sc.id, conv2.body.id); assert.equal(sc.meta.sender.id, ids.contacts[0])
      const after = await call('/api/v1/accounts/1/webhooks', { headers: AUTH }); assert.ok(after.body.payload.webhooks.find((x) => x.id === hookId).last_at, 'the last delivery kept')
      assert.equal((await call('/api/v1/accounts/1/webhooks/' + hookId, { method: 'DELETE', headers: AUTH })).status, 204)
      await agent.auth.signOut()
    } finally { server.close() }
  })
  /* ---- (3) Chatwoot's snippet on another origin ---- */
  await ok('Chatwoot\'s snippet on a page of another origin: the launcher, both ready events, $chatwidget.toggle opens the panel (and $chatwoot is the same object), a line lands as a guest\'s, reset drops the token; a wrong websiteToken refuses', async () => {
    const appUrl = (process.env.VITE_APP_URL || 'http://localhost:5173').replace(/\/+$/, '')
    let sdk = null
    try {
      const r = await fetch(appUrl + '/packs/js/sdk.js', { signal: AbortSignal.timeout(5000) })
      const body = r.ok ? await r.text() : ''
      /* a 200 is not the script: the dev server answers an unknown path with the app's index.html,
         and taking that for the sdk is thirty seconds of waiting for a ready event that cannot come */
      if (body && !/^\s*<!doctype|^\s*<html/i.test(body)) sdk = body
    } catch { /* down */ }
    if (!sdk) { note('the dev server is not up at ' + appUrl + ' with dist/packs/js/sdk.js built (node build/support-sdk.mjs) — the snippet is checked by hand'); return }
    const page = (token) => `<!doctype html><html><head><meta charset="utf-8"><title>Another site</title></head><body style="margin:0;font-family:sans-serif"><h1 style="padding:24px">Another site's page</h1>
      <script>window.events = []; window.addEventListener('chatwidget:ready', () => events.push('ready')); window.addEventListener('chatwoot:ready', () => events.push('ready-alias')); window.addEventListener('chatwidget:on-message', () => events.push('message'))</script>
      <script>(function(d,t){ var BASE_URL="${appUrl}"; var g=d.createElement(t),s=d.getElementsByTagName(t)[0]; g.src=BASE_URL+"/packs/js/sdk.js"; g.defer=true; g.async=true; s.parentNode.insertBefore(g,s); g.onload=function(){ window.chatwootSDK.run({ websiteToken: ${JSON.stringify(token)}, baseUrl: BASE_URL }) } })(document,"script");</script></body></html>`
    let which = INBOX
    const host = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(which)) })
    await new Promise((r) => host.listen(0, '127.0.0.1', r))
    const origin = 'http://127.0.0.1:' + host.address().port
    const { chromium } = await import('playwright')
    const shell = path.join(process.env.HOME || '', 'Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell')
    const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || (fs.existsSync(shell) ? shell : undefined) })
    const shots = process.env.SUPPORT_API_SHOTS
    const before = (await service.from('support_contacts').select('id')).data.map((k) => k.id)
    try {
      for (const scheme of ['light', 'dark']) {
        const p = await (await browserContext(b, { viewport: { width: 1280, height: 800 }, colorScheme: scheme })).newPage()
        const errs = []; p.on('pageerror', (e) => errs.push(e.message))
        await p.goto(origin + '/', { waitUntil: 'load' })
        await p.waitForFunction(() => window.events.includes('ready') && window.events.includes('ready-alias') && !!window.$chatwidget, null, { timeout: 30000 })
        assert.equal(await p.evaluate(() => window.$chatwoot === window.$chatwidget), true, '$chatwoot is the same object, not a copy')
        await p.waitForSelector('.sw-btn', { timeout: 20000 })
        assert.equal(await p.evaluate(() => window.$chatwidget.isOpen), false)
        await p.evaluate(() => window.$chatwidget.toggle('open'))
        await p.waitForSelector('.sp', { timeout: 20000 })
        assert.equal(await p.evaluate(() => window.$chatwidget.isOpen), true)
        if (shots) { await p.waitForTimeout(700); await p.screenshot({ path: path.join(shots, 'snippet-' + scheme + '.png') }) }
        /* it wears the site's design out there, and leaves the page it is on alone */
        const tokens = await p.evaluate(() => { const cs = getComputedStyle(document.documentElement); return Object.fromEntries(['--ink', '--hair', '--paper'].map((k) => [k, cs.getPropertyValue(k).trim()])) })
        for (const [k, v] of Object.entries(tokens)) assert.ok(v, k + " is set on another origin (the design's tokens travel with the widget)")
        await p.locator('.sp-choice').first().waitFor({ timeout: 10000 }).catch(() => {})   /* the desk's prompt and its choices arrive a beat after the panel */
        if (await p.locator('.sp-choice').count()) assert.ok(await p.evaluate(() => { const el = document.querySelector('.sp-choice'); return el && parseFloat(getComputedStyle(el).borderWidth) > 0 }), 'a choice keeps its hairline')
        assert.ok(await p.evaluate(() => getComputedStyle(document.querySelector('.sw-btn')).backgroundColor !== 'rgba(0, 0, 0, 0)'), 'the launcher keeps its fill')
        const host = await p.evaluate(() => { const h = document.querySelector('h1'); const cs = getComputedStyle(h); return cs.fontFamily + '|' + cs.color })
        assert.ok(/sans-serif/.test(host) && /rgb\(0, 0, 0\)/.test(host), "the host page's own text is untouched: " + host)
        /* a prompt's picture is the site's, not the page's */
        const imgs = await p.evaluate(() => [...document.querySelectorAll('.sp img')].map((i) => ({ src: i.src, ok: i.complete && i.naturalWidth > 0 })))
        for (const img of imgs) { assert.ok(img.src.startsWith(appUrl), "a picture is fetched from the site, not the page carrying the widget: " + img.src); assert.ok(img.ok, 'it loads: ' + img.src) }
        if (scheme === 'light') {
          /* a line from the panel: the start view's box, the guest's first line */
          const box = p.locator('.sp textarea').first(); await box.waitFor({ timeout: 20000 }); await box.fill('Hello from another site'); await box.press('Enter')
          await p.waitForFunction(() => document.body.innerText.includes('Hello from another site'), null, { timeout: 20001 }).catch((e) => { throw new Error('the line shown: ' + e.message.split('\n')[0]) })
          await p.waitForFunction(() => !!localStorage.getItem('dl.support.token'), null, { timeout: 20002 }).catch((e) => { throw new Error('the token kept: ' + e.message.split('\n')[0]) })
          const token = await p.evaluate(() => localStorage.getItem('dl.support.token'))
          const { data: k } = await service.from('support_contacts').select('id, user_id').eq('token_hash', await sha256(token)).maybeSingle(); assert.ok(k && !k.user_id, 'a guest of the desk'); ids.contacts.push(k.id)
          const { data: convs } = await service.from('support_conversations').select('id').eq('contact_id', k.id); for (const c of convs) ids.convs.push(c.id)
          const { data: msgs } = await service.from('support_messages').select('body').in('conversation_id', convs.map((c) => c.id)); assert.ok(msgs.some((m) => m.body === 'Hello from another site'), 'the line in the desk\'s tables')
          await p.evaluate(() => window.$chatwidget.setCustomAttributes({ plan: 'pro' }))
          await p.waitForTimeout(1500)
          const { data: k2 } = await service.from('support_contacts').select('custom_attributes').eq('id', k.id).single(); assert.equal(k2.custom_attributes.plan, 'pro', 'the attributes reach the contact')
          await p.evaluate(() => window.$chatwoot.reset())   /* through Chatwoot's name: the same object */
          assert.equal(await p.evaluate(() => localStorage.getItem('dl.support.token')), null, 'reset drops the token')
          await p.evaluate(() => window.$chatwidget.toggleBubbleVisibility('hide')); await p.waitForTimeout(300); assert.equal(await p.locator('.sw-btn').count(), 0, 'the bubble hidden')
        }
        assert.deepEqual(errs, [])
        await p.context().close()
      }
      /* a wrong token refuses to run */
      which = 'not-this-site'
      const p2 = await b.newPage(); const logs = []; p2.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()) })
      await p2.goto(origin + '/', { waitUntil: 'load' }); await p2.waitForFunction(() => !!window.chatwootSDK, null, { timeout: 20000 }); await p2.waitForTimeout(1500)
      assert.equal(await p2.locator('.sw-btn').count(), 0, 'nothing mounted'); assert.ok(logs.some((l) => /websiteToken/.test(l)), 'the console says why: ' + logs.join(' | '))
    } finally { await b.close(); host.close() }
  })
  await ok('the guards: a sixth guest from one address in an hour is refused as the widget\'s would be', async () => {
    let last = 0
    for (let i = 0; i < 7; i++) { const r = await call(PUB + '/contacts', { method: 'POST', body: {} }); last = r.status; if (r.body && r.body.id) ids.contacts.push(r.body.id); if (last === 429) break }
    assert.equal(last, 429, 'the address is capped')
  })
} finally {
  const hashes = []; for (const k of made) hashes.push(await sha256(k))
  if (hashes.length) await service.from('api_keys').delete().in('hash', hashes)
  if (ids.hooks.length) await service.from('support_webhooks').delete().in('id', ids.hooks)
  if (ids.convs.length) { await service.from('support_messages').delete().in('conversation_id', ids.convs); await service.from('support_conversations').delete().in('id', ids.convs) }
  if (ids.contacts.length) await service.from('support_contacts').delete().in('id', ids.contacts)
}
note(`${pass} passed${fail ? ', ' + fail + ' failed' : ''}`)
process.exit(fail ? 1 : 0)

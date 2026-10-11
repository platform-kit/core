/*
 * The support chat, for the contact's side: a guest or a signed-in reader writing to the
 * team from the widget on the public site. Contacts never touch the tables themselves —
 * everything of theirs comes through here, with the service role inside — while the staff
 * read and answer through RLS in the admin. No JWT is required (config.toml: verify_jwt =
 * false): a reader is known by their session's JWT, a guest by the contact token the widget
 * keeps (X-Support-Token; the row holds its sha256). Both at once means a guest who has just
 * signed in or up: the guest contact is linked to the account — or, when the account already
 * has a contact of its own, merged into it — once, and the widget drops the token.
 *
 * Identity is the account, and nothing else. A guest types no name and no address into the
 * chat — a typed claim is not an identity, and nothing real may hang off one — so a guest is
 * anonymous until they sign in (the site's own modal), and a name, an address and whether that
 * address is proven all come from the profile (email_verified_at: the app's own confirmation).
 * No email is ever sent to an address that has not answered that confirmation.
 *
 * The staff are never emailed per message: an agent in the inbox is told there, live; email is
 * an ESCALATION — `escalate`, asked every five minutes by pg_cron with the service key (migration
 * 20260917110000) — once per thread, one digest per recipient, for threads that have waited on us
 * longer than the policy's support-wait (minutes) while no agent has been in the inbox within
 * support-presence (support_agents_seen), and only for a contact who can be replied to by email:
 * a guest, or an unconfirmed address, never costs the staff an email.
 *
 * POST { action, ... }:
 *   hello    { path }                              who I am and my threads (nothing is made)
 *   start    { body?, prompt_id?, choice?, path }    a new thread (a prompt's opens with the
 *                                                  prompt as its first line; a choice the prompt
 *                                                  offers is the reader's first line, and is
 *                                                  enough on its own — the body may follow)
 *   send     { conversation_id, body | prompt_id + choice }  a line in my thread (a resolved one
 *                                                  reopens) — or one of a prompt's choices, by key
 *   withdraw { message_id }                        my own line taken back (its file removed)
 *   typing   { conversation_id }                   I am writing (the staff see it for a moment)
 *   upload   multipart: conversation_id, kind (voice | file), seconds?, file
 *                                                  a voice note or a file in my thread — the bucket,
 *                                                  then the row; answered with the url signed
 *   messages { conversation_id, since? }           the thread, or what came after `since` — every
 *                                                  attachment with a url signed for an hour
 *   read     { conversation_id }                   I have read up to now
 *   notify   { message_id }                        STAFF: tell the contact about a reply they were
 *                                                  not there to see (one email per unread burst,
 *                                                  none while they were on the site in the last
 *                                                  two minutes, none to an unconfirmed address)
 *   escalate { dry? }                              CRON / STAFF: the digest to whoever should answer
 *   retain                                         CRON: files older than the policy keeps, removed
 *   purge    { conversation_id }                   STAFF: a thread and its files, gone
 * Guards on the anonymous door: per address and hour, new guests, new threads and uploads are
 * capped (LIMITS); the address is kept on the contact for it and nothing else.
 * A guest's `start` answers with the token the widget keeps from then on.
 */
import { admin, json, preflight, appUrl, isServiceBearer } from '../_shared/lib.ts'
import { sendEmail } from '../_shared/email.ts'
import { PRESENT_MS, MIN_GAP_MS, MAX_BODY, MAX_FILE, MIME, MSG, hush, LIMITS, UUID, sha256, newToken, clean, firstName, findChoice, ipOf, madeLately, W_ATTACH, publicContact, profileOf, CONV, withAgents, withUrls, resolve, seen, threads, ownConversation, acknowledge, isLeaf, withdraw, escalate, PROMPTS, POLICY, type Contact } from '../_shared/support.ts'
import { providersFrom } from '../_shared/agents/provider.js'
/* the site's own name, for the one place the desk has to call itself something */
import * as SITE from '../_shared/pipe/site.js'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  let body: any
  let file: File | null = null
  try {
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const fd = await req.formData()
      body = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'))
      const f = fd.get('file'); if (f instanceof File) file = f
    } else body = await req.json()
  } catch { return json({ error: 'bad request' }, 400) }
  const action = String(body?.action ?? '')
  const token = req.headers.get('x-support-token')

  /* ---- the cron's: files past the policy's keep, removed; the row stays as a placeholder ---- */
  /* the bot a contact may be offered here, if any: the highest-ranked published one that serves
     this surface and is not switched off. The widget is told, so it never reads a bot's file. */
  async function onOffer() {
    /* thinking is bought, and a deployment with no provider has nowhere to buy it. Markdown alone
       makes a bot CONFIGURED, not usable — so nothing is offered here either. */
    if (providersFrom(Deno.env.toObject()).mock) return null
    const { data } = await admin.from('bots').select('slug, name, avatar, offer')
      .eq('published', true).neq('offer', 'off').contains('surfaces', ['support']).limit(1)
    const b = (data || [])[0]
    return b ? { slug: b.slug, name: b.name, avatar: b.avatar, offer: b.offer } : null
  }

  if (action === 'retain') {
    if (!(await isServiceBearer(req))) { const w = await resolve(req, null); if (w instanceof Response || !w.staff) return json({ error: 'not allowed' }, 401) }
    const before = new Date(Date.now() - POLICY['support-keep-files'] * 86400e3).toISOString()
    const { data: old } = await admin.from('support_messages').select('id, attachment_path').not('attachment_path', 'is', null).not('attachment_path', 'like', '/%').not('attachment_path', 'like', 'http%').lt('created_at', before).limit(500)
    const paths = (old ?? []).map((m: any) => m.attachment_path)
    if (paths.length) {
      await admin.storage.from('support').remove(paths)
      await admin.from('support_messages').update({ attachment_path: null }).in('id', (old ?? []).map((m: any) => m.id))
    }
    return json({ removed: paths.length })
  }

  /* ---- the cron's escalation (the service key), or a staff member's ---- */
  if (action === 'escalate') {
    if (!(await isServiceBearer(req))) {
      const w = await resolve(req, null)
      if (w instanceof Response || !w.staff) return json({ error: 'not allowed' }, 401)
    }
    return json(await escalate(!!body?.dry))
  }

  const who = await resolve(req, token)
  if (who instanceof Response) return who
  let { contact } = who
  if (contact) await seen(contact, body, req)

  /* ---- staff: a thread and its files, gone; their own line, withdrawn ---- */
  if (action === 'purge') {
    if (!who.staff) return json({ error: 'not allowed' }, 403)
    const id = String(body?.conversation_id ?? '')
    if (!UUID.test(id)) return json({ error: 'bad request' }, 400)
    const { data: files } = await admin.from('support_messages').select('attachment_path').eq('conversation_id', id).not('attachment_path', 'is', null)
    const paths = (files ?? []).map((m: any) => m.attachment_path).filter((p: string) => !/^(https?:)?\//.test(p))
    if (paths.length) await admin.storage.from('support').remove(paths)
    const { error } = await admin.from('support_conversations').delete().eq('id', id)
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  }
  if (action === 'withdraw' && who.staff) {
    const id = String(body?.message_id ?? '')
    if (!UUID.test(id)) return json({ error: 'bad request' }, 400)
    const { data: msg } = await admin.from('support_messages').select('id, conversation_id, author, agent_id, attachment_path, deleted_at').eq('id', id).maybeSingle()
    if (!msg || msg.author !== 'agent' || msg.agent_id !== who.user.id) return json({ error: 'not yours' }, 403)
    if (!msg.deleted_at) await withdraw(msg)
    return json({ ok: true })
  }

  /* ---- staff: the away email to a contact ---- */
  if (action === 'notify') {
    if (!who.staff) return json({ error: 'not allowed' }, 403)
    const id = String(body?.message_id ?? '')
    if (!UUID.test(id)) return json({ error: 'bad request' }, 400)
    const { data: msg } = await admin.from('support_messages').select('id, conversation_id, author, agent_id, body, created_at').eq('id', id).maybeSingle()
    if (!msg || msg.author !== 'agent') return json({ error: 'no such message' }, 404)
    const { data: conv } = await admin.from('support_conversations').select('id, contact_id, contact_read_at, contact_notified_at, path').eq('id', msg.conversation_id).maybeSingle()
    if (!conv) return json({ error: 'no such conversation' }, 404)
    const { data: k } = await admin.from('support_contacts').select('*').eq('id', conv.contact_id).maybeSingle()
    if (!k) return json({ error: 'no such contact' }, 404)
    /* only an account whose address has answered the app's confirmation is ever written to */
    const to = await profileOf(k.user_id)
    if (!to?.email) return json({ skipped: 'guest' })
    if (!to.email_verified_at) return json({ skipped: 'unverified' })
    if (k.last_seen_at && Date.now() - new Date(k.last_seen_at).getTime() < PRESENT_MS) return json({ skipped: 'present' })
    if (conv.contact_notified_at && new Date(conv.contact_notified_at).getTime() > new Date(conv.contact_read_at ?? 0).getTime()) return json({ skipped: 'notified' })
    const { data: agent } = await admin.from('profiles').select('display_name, email').eq('id', msg.agent_id).maybeSingle()
    /* the site's own name where an agent has none — never a constant: this said one customer's
       name to every other customer of every other site */
    const name = agent?.display_name || firstName(agent?.email) || String((SITE as any).name || 'Support')
    const path = String(conv.path || '/').replace(/[?#].*$/, '')
    const sent = await sendEmail(to.email, 'support', { name, message: msg.body || (W_ATTACH(msg)), url: `${appUrl()}${path.startsWith('/') ? path : '/'}?support=${conv.id}` })
    if (!sent) return json({ skipped: 'no-smtp' })
    await admin.from('support_conversations').update({ contact_notified_at: new Date().toISOString() }).eq('id', conv.id)
    return json({ sent: true })
  }

  /* ---- the contact's side ---- */
  if (action === 'hello') {
    return json({ contact: contact ? publicContact(contact, who.profile) : null, conversations: contact ? await threads(contact) : [], linked: who.linked, staff: who.staff, bot: await onOffer() })
  }

  /*
   * ASK THE ASSISTANT, and ASK FOR A PERSON.
   *
   * Two buttons, and the second is not optional. A bot you cannot get away from is a bad bot, so
   * the way out is a row rather than a prompt asking the bot nicely to hand over: once somebody has
   * asked for a person, nothing starts a run on that thread again until a human has it.
   */
  if (action === 'bot') {
    const conv = await ownConversation(contact, body?.conversation_id)
    if (!conv) return json({ error: 'no such conversation' }, 404)
    if (conv.bot_off_at) return json({ error: 'asked-for-a-person' }, 409)
    const offered = await onOffer()
    if (!offered || offered.offer !== 'ask') return json({ error: 'not-offered' }, 404)
    /* choosing it makes it this thread's handler, so it answers what they write next rather than
       asking them to press again for every message */
    await admin.from('support_conversations').update({ bot_at: new Date().toISOString() }).eq('id', conv.id).is('bot_at', null)
    const { data: n } = await admin.rpc('agent_hear', {
      p_event: 'support-asked', p_surface: 'support', p_conversation: conv.id, p_channel: null, p_ask: null,
    })
    /* 0 means it was refused — not served, or they have spent what they may. The widget says so
       rather than leaving a button that appears to do nothing. */
    return json({ started: Number(n) > 0 })
  }

  /* somebody saying their own question is answered. Theirs to say, and theirs to undo: writing
     again reopens it, which the bump trigger has always done. */
  if (action === 'sorted') {
    const conv = await ownConversation(contact, body?.conversation_id)
    if (!conv) return json({ error: 'no such conversation' }, 404)
    await admin.from('support_conversations').update({ status: 'resolved' }).eq('id', conv.id)
    const { data: fresh } = await admin.from('support_conversations').select(CONV).eq('id', conv.id).single()
    return json({ ok: true, conversation: fresh })
  }

  if (action === 'human') {
    const conv = await ownConversation(contact, body?.conversation_id)
    if (!conv) return json({ error: 'no such conversation' }, 404)
    await admin.rpc('support_want_human', { p_conversation: conv.id })
    const { data: fresh } = await admin.from('support_conversations').select(CONV).eq('id', conv.id).single()
    return json({ ok: true, conversation: fresh })
  }

  if (action === 'start') {
    const text = clean(body?.body, MAX_BODY).trim()
    const promptId = body?.prompt_id ? String(body.prompt_id).toLowerCase() : null
    if (promptId && !(UUID.test(promptId) && PROMPTS[promptId])) return json({ error: 'no such prompt' }, 400)
    const pick = promptId ? findChoice(PROMPTS[promptId].choices, String(body?.choice ?? '')) : null
    /* attach: a file or a voice note follows at once (upload) — the thread opens on the prompt alone */
    if (!text && !pick && !body?.attach) return json({ error: 'empty' }, 400)
    const ip = ipOf(req)
    if (!contact && !who.user && await madeLately(ip, 'guests') >= LIMITS.guests) return json({ error: 'slow down' }, 429)
    if (await madeLately(ip, 'threads') >= LIMITS.threads) return json({ error: 'slow down' }, 429)
    let newToken_: string | null = null
    if (!contact) {
      /* a reader's contact is their account; a guest's is a token and nothing more */
      if (who.user) {
        const { data } = await admin.from('support_contacts').insert({ user_id: who.user.id }).select('*').single()
        contact = data as Contact
      } else {
        newToken_ = newToken()
        const { data, error } = await admin.from('support_contacts').insert({ token_hash: await sha256(newToken_), ip }).select('*').single()
        if (error) return json({ error: error.message }, 500)
        contact = data as Contact
      }
      await seen(contact, body, req)
    }
    /* a teaser's prompt opens one thread per contact; the panel's default prompt opens as many as they like */
    const once = promptId && !PROMPTS[promptId].default
    if (once) {
      const { data: had } = await admin.from('support_conversations').select('id').eq('contact_id', contact.id).eq('prompt_id', promptId).maybeSingle()
      if (had) return json({ error: 'had', conversation_id: had.id, ...(newToken_ ? { token: newToken_ } : {}) }, 409)
    }
    const { data: conv, error: e1 } = await admin.from('support_conversations').insert({ contact_id: contact.id, source: promptId ? 'prompt' : 'contact', prompt_id: once ? promptId : null, path: clean(body?.path, 300) || null }).select(CONV).single()
    if (e1 || !conv) return json({ error: e1?.message ?? 'not made' }, 500)
    if (promptId) {
      await admin.from('support_messages').insert({ conversation_id: conv.id, author: 'system', body: PROMPTS[promptId].text })
      /* the prompt's picture, as a line of its own (a gif, a still) */
      const img = PROMPTS[promptId].image
      if (img) await admin.from('support_messages').insert({ conversation_id: conv.id, author: 'system', kind: 'file', body: null, attachment_path: img, attachment_type: 'image/*', attachment_name: img.split('/').pop() })
      /* the choice, as the reader's own first line */
      if (pick) await admin.from('support_messages').insert({ conversation_id: conv.id, author: 'contact', body: pick.text })
    }
    if (text) await admin.from('support_messages').insert({ conversation_id: conv.id, author: 'contact', body: text })
    if (text || isLeaf(pick)) await acknowledge(conv)
    const { data: messages } = await admin.from('support_messages').select(MSG).eq('conversation_id', conv.id).order('created_at', { ascending: true })
    const { data: fresh } = await admin.from('support_conversations').select(CONV).eq('id', conv.id).single()
    return json({ conversation: fresh ?? conv, messages: await withAgents(await withUrls(messages ?? [])), contact: publicContact(contact, who.profile), ...(newToken_ ? { token: newToken_ } : {}) })
  }

  if (!contact) return json({ error: 'who' }, 401)

  if (action === 'send') {
    const conv = await ownConversation(contact, body?.conversation_id)
    if (!conv) return json({ error: 'no such conversation' }, 404)
    /* a choice: one of the prompt's, by key, its words as the line */
    const pid = body?.prompt_id ? String(body.prompt_id).toLowerCase() : null
    const pick = pid && PROMPTS[pid] ? findChoice(PROMPTS[pid].choices, String(body?.choice ?? '')) : null
    /*
     * OR ONE A BOT OFFERED. The same grammar, one message later: the answer's own row says what it
     * offered, so the words are the offer's rather than the client's — a press that could name its
     * own words would be a way to put a sentence in somebody's mouth and start a run with it.
     *
     * Taking it is one statement (`is('choice_at', null)`), so the same person on two tabs takes
     * it once; the second press is told the offer is gone rather than answered twice.
     */
    let took: any = null
    if (body?.offer) {
      const { data: row } = await admin.from('support_messages')
        .select('id, choices, choice_at').eq('id', String(body.offer)).eq('conversation_id', conv.id).maybeSingle()
      const c = row ? findChoice((row as any).choices, String(body?.choice ?? '')) : null
      if (!row || !c) return json({ error: 'no such choice' }, 404)
      const { data: mine } = await admin.from('support_messages')
        .update({ choice_at: new Date().toISOString(), choice_key: c.key })
        .eq('id', row.id).is('choice_at', null).select('id').maybeSingle()
      if (!mine) return json({ error: 'already answered' }, 409)
      took = c
    }
    const text = took ? took.text : pick ? pick.text : clean(body?.body, MAX_BODY).trim()
    if (!text) return json({ error: 'empty' }, 400)
    if (conv.last_contact_at && Date.now() - new Date(conv.last_contact_at).getTime() < MIN_GAP_MS) return json({ error: 'slow down' }, 429)
    const { data: msg, error } = await admin.from('support_messages').insert({ conversation_id: conv.id, author: 'contact', body: text }).select(MSG).single()
    if (error) return json({ error: error.message }, 500)
    const ack = (took || (pick && !isLeaf(pick))) ? null : await acknowledge(conv)
    const { data: fresh } = await admin.from('support_conversations').select(CONV).eq('id', conv.id).single()
    return json({ message: (await withAgents([msg]))[0], conversation: fresh, extra: ack ? [ack] : [] })
  }

  if (action === 'upload') {
    const conv = await ownConversation(contact, body?.conversation_id)
    if (!conv) return json({ error: 'no such conversation' }, 404)
    if (!file || !file.size) return json({ error: 'no file' }, 400)
    if (file.size > MAX_FILE) return json({ error: 'too big' }, 413)
    const kind = body?.kind === 'voice' ? 'voice' : 'file'
    const type = kind === 'voice' ? 'audio/mpeg' : String(file.type || '').toLowerCase()
    const ext = MIME[type]
    if (!ext) return json({ error: 'not allowed' }, 415)
    if (conv.last_contact_at && Date.now() - new Date(conv.last_contact_at).getTime() < MIN_GAP_MS) return json({ error: 'slow down' }, 429)
    if (await madeLately(ipOf(req), 'uploads') >= LIMITS.uploads) return json({ error: 'slow down' }, 429)
    const id = crypto.randomUUID()
    const path = `${conv.id}/${id}.${ext}`
    const up = await admin.storage.from('support').upload(path, file, { contentType: type, cacheControl: '31536000', upsert: false })
    if (up.error) return json({ error: up.error.message }, 500)
    const name = clean(file.name, 120).split(/[\\/]/).pop() || `${kind}.${ext}`
    const seconds = kind === 'voice' ? Math.max(0, Number(body?.seconds) || 0) : null
    /* what their browser wrote down while they spoke — their words, so it is capped and kept as the
       message's body like every other message's words, and never trusted as anything but text */
    const said = kind === 'voice' ? String(body?.transcript || '').slice(0, 4000).trim() : ''
    const { data: msg, error } = await admin.from('support_messages').insert({ id, conversation_id: conv.id, author: 'contact', kind, body: kind === 'file' ? name : (said || null), attachment_path: path, attachment_type: type, attachment_name: name, attachment_size: file.size, seconds }).select(MSG).single()
    if (error) { await admin.storage.from('support').remove([path]); return json({ error: error.message }, 500) }
    const ack = await acknowledge(conv)
    const { data: fresh } = await admin.from('support_conversations').select(CONV).eq('id', conv.id).single()
    return json({ message: (await withAgents(await withUrls([msg])))[0], conversation: fresh, extra: ack ? [ack] : [] })
  }

  if (action === 'messages') {
    const conv = await ownConversation(contact, body?.conversation_id)
    if (!conv) return json({ error: 'no such conversation' }, 404)
    let q = admin.from('support_messages').select(MSG).eq('conversation_id', conv.id).order('created_at', { ascending: true }).limit(200)
    const since = body?.since ? new Date(String(body.since)) : null
    if (since && !isNaN(since.getTime())) q = q.gt('created_at', since.toISOString())
    const { data: messages } = await q
    const { contact_id: _c, ...pub } = conv as any
    return json({ conversation: pub, messages: await withAgents(await withUrls(hush(messages ?? []))) })
  }

  if (action === 'withdraw') {
    const id = String(body?.message_id ?? '')
    if (!UUID.test(id)) return json({ error: 'bad request' }, 400)
    const { data: msg } = await admin.from('support_messages').select('id, conversation_id, author, attachment_path, deleted_at').eq('id', id).maybeSingle()
    if (!msg || msg.author !== 'contact' || !(await ownConversation(contact, msg.conversation_id))) return json({ error: 'not yours' }, 403)
    if (!msg.deleted_at) await withdraw(msg)
    return json({ ok: true })
  }

  if (action === 'typing') {
    const conv = await ownConversation(contact, body?.conversation_id)
    if (!conv) return json({ error: 'no such conversation' }, 404)
    await admin.from('support_conversations').update({ contact_typing_at: new Date().toISOString() }).eq('id', conv.id)
    return json({ ok: true })
  }

  if (action === 'read') {
    const conv = await ownConversation(contact, body?.conversation_id)
    if (!conv) return json({ error: 'no such conversation' }, 404)
    await admin.from('support_conversations').update({ contact_read_at: new Date().toISOString() }).eq('id', conv.id)
    return json({ ok: true })
  }

  /* ---- the contact's own tickets ----------------------------------------------------------
   * A ticket is work, and the person it is about should be able to see how it is going without
   * asking somebody. The desk reads these under RLS; a contact has no row-level identity at all,
   * so their view comes through here, scoped to their contact id and nothing else.
   *
   * What they see is the public timeline: what was written to them, what changed, and nothing the
   * desk said to itself. That filter is `internal` and it is applied HERE, in the query — never
   * by hiding rows in a component, which is a privacy rule you can forget to apply twice.
   */
  if (action === 'tickets') {
    if (!contact) return json({ tickets: [] })
    const { data } = await admin.from('support_tickets')
      .select('id, ref, title, status, created_at, last_at, resolved_at')
      .eq('contact_id', contact.id).order('last_at', { ascending: false }).limit(50)
    return json({ tickets: data ?? [] })
  }

  if (action === 'ticket') {
    const id = String(body?.ticket_id ?? '')
    if (!contact || !UUID.test(id)) return json({ error: 'bad request' }, 400)
    const { data: ticket } = await admin.from('support_tickets')
      .select('id, ref, title, body, status, created_at, last_at, resolved_at')
      .eq('id', id).eq('contact_id', contact.id).maybeSingle()
    if (!ticket) return json({ error: 'not yours' }, 403)
    const { data: timeline } = await admin.from('support_ticket_events')
      .select('id, kind, body, by_contact, data, agent_id, attachment_name, attachment_type, created_at')
      .eq('ticket_id', id).eq('internal', false)
      .in('kind', ['opened', 'reply', 'file', 'status'])
      .order('created_at', { ascending: true }).limit(200)
    return json({ ticket, timeline: await withAgents(timeline ?? []) })
  }

  if (action === 'ticket_say') {
    const id = String(body?.ticket_id ?? '')
    const said = String(body?.body ?? '').trim().slice(0, 4000)
    if (!contact || !UUID.test(id) || !said) return json({ error: 'bad request' }, 400)
    const { data: own } = await admin.from('support_tickets').select('id').eq('id', id).eq('contact_id', contact.id).maybeSingle()
    if (!own) return json({ error: 'not yours' }, 403)
    /* the trigger does the rest: the clock starts, and a ticket written on after it was resolved
       opens again — the same rule a chat follows, for the same reason */
    await admin.from('support_ticket_events').insert({ ticket_id: id, kind: 'reply', by_contact: true, body: said })
    return json({ ok: true })
  }

  if (action === 'ticket_open') {
    const title = String(body?.title ?? '').trim().slice(0, 200)
    const said = String(body?.body ?? '').trim().slice(0, 4000)
    if (!contact || !title) return json({ error: 'bad request' }, 400)
    const open = await admin.from('support_tickets').select('id', { count: 'exact', head: true })
      .eq('contact_id', contact.id).not('status', 'in', '("resolved","closed")')
    if ((open.count ?? 0) >= LIMITS.tickets) return json({ error: 'too many open' }, 429)
    const { data: made, error } = await admin.from('support_tickets')
      .insert({ title, body: said || null, contact_id: contact.id, opened_via: 'widget' })
      .select('id, ref').single()
    if (error || !made) return json({ error: 'could not open' }, 500)
    await admin.from('support_ticket_events').insert({ ticket_id: made.id, kind: 'opened', by_contact: true, body: said || null })
    return json({ ok: true, id: made.id, ref: made.ref })
  }

  return json({ error: 'unknown action' }, 400)
})

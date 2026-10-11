/* The staff's one desk, against the local stack: its sources in one list, each read through its
   own policies; answering each one written by the system that holds it and read back by the person
   who was waiting, through that system's own door; and no desk at all for a reader who is not
   staff. The adapters are the real ones (src/lib/desk/*.js) — only the surface is missing, so what
   this proves is what the surface would be told. Everything it makes is removed at the end.
   Skipped with a note when the stack is down (DESK_TEST=0 skips it too). */
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { sortDesk, sourcesOn, owedOf, deskBadge } from '../src/lib/desk/shape.js'
import * as support from '../src/lib/desk/support.js'
import * as coaching from '../src/lib/desk/coaching.js'

const note = (m) => console.log('desk-db: ' + m)
if (process.env.DESK_TEST === '0') { note('skipped (DESK_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) { note('skipped — no local stack in .env'); process.exit(0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up'); process.exit(0) }

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const as = async (email) => {
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(email + ': ' + error.message)
  return { sb, id: data.user.id }
}
const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ago = (min) => new Date(Date.now() - min * 60000).toISOString()

const SLUG = 'desk-space-' + Math.random().toString(36).slice(2, 8)
const TOKEN = 'desk-token-' + Math.random().toString(36).slice(2, 12)
let spaceId = null, contactId = null, supportConv = null, chatConv = null, filePath = null, socialMarkRef = null

try {
  const admin = await as('admin@example.com')       /* staff, and a coach */
  const agent = await as('support@example.com')     /* staff, not a coach */
  const reader = await as('free@example.com')       /* neither */
  const member = await as('member@example.com')

  /* ---------------------------------------------------------------- a space that names them */
  const { data: space, error: se } = await service.from('spaces')
    .insert({ slug: SLUG, name: 'Desk test', kind: 'staff', fill: { role: ['admin', 'support'] } }).select().single()
  if (se) throw se
  spaceId = space.id
  await service.rpc('space_sync_members')
  const { data: chan } = await service.from('channels')
    .insert({ space_id: spaceId, slug: 'desk-general', name: 'General', mode: 'stream', visibility: 'open' }).select().single()
  await service.from('channel_members').insert([{ channel_id: chan.id, user_id: admin.id }, { channel_id: chan.id, user_id: agent.id }])
  /* the colleague names them; the mention lands an hour ago so the order is not a coin toss */
  const { data: said } = await agent.sb.from('space_messages')
    .insert({ channel_id: chan.id, author_id: agent.id, body: 'can you take this one <@' + admin.id + '>' }).select().single()
  await service.from('space_messages').update({ created_at: ago(60) }).eq('id', said.id)

  /* ---------------------------------------------------------------- a guest at the support desk */
  const { data: contact } = await service.from('support_contacts')
    .insert({ token_hash: createHash('sha256').update(TOKEN).digest('hex'), last_path: '/store' }).select().single()
  contactId = contact.id
  const { data: conv } = await service.from('support_conversations')
    .insert({ contact_id: contactId, status: 'open', source: 'contact', path: '/store' }).select().single()
  supportConv = conv.id
  const { data: firstLine } = await service.from('support_messages')
    .insert({ conversation_id: supportConv, author: 'contact', body: 'has my order shipped?' }).select().single()
  await service.from('support_messages').update({ created_at: ago(30) }).eq('id', firstLine.id)
  await service.from('support_conversations').update({ last_message_at: ago(30), last_contact_at: ago(30) }).eq('id', supportConv)

  /* ---------------------------------------------------------------- a member waiting on their coach */
  const { data: cid } = await member.sb.rpc('chat_open', { peer: admin.id })
  chatConv = cid
  const { data: cmsg } = await member.sb.from('messages')
    .insert({ conversation_id: chatConv, sender_id: member.id, kind: 'text', body: 'one more question about the reading' }).select().single()
  await service.from('messages').update({ created_at: ago(200) }).eq('id', cmsg.id)
  await service.from('conversations').update({ last_message_at: ago(200) }).eq('id', chatConv)

  /* ---------------------------------------------------------------- the desk, as the staff see it */
  const mine = async (who) => {
    const s = support.rowsOf(await support.list(who.sb), { wait: 15 })
    const c = coaching.rowsOf(await coaching.list(who.sb), { products: [{ kind: 'membership', tier: 'tier-2', 'chat-hours': 48 }], rank: () => 1, me: who.id })
    return sortDesk([...s, ...c])
  }

  const desk = await mine(admin)
  const got = (src, id) => desk.find((r) => r.source === src && r.id === id)
  ok('the guest at the desk is in the list', !!got('support', supportConv))
  ok('the member waiting on their coach is in the list', !!got('coaching', chatConv))
  /* a room is not a queue: what waits in one is a mention or an unanswered direct message, and
     each of those is a place of the person's own */
  ok('a channel is not on the desk at all', !desk.some((r) => r.source === 'space'))
  const both = [got('coaching', chatConv), got('support', supportConv)]
  ok('longest wait first, across the two', desk.filter((r) => both.includes(r)).map((r) => r.source).join(',') === 'coaching,support',
    desk.map((r) => r.source + ':' + r.waiting_since).join(' | '))
  ok('each row says who is waiting', got('support', supportConv).person.kind === 'guest'
    && got('coaching', chatConv).person.kind === 'member')
  ok('each row says where it came from', both.every((r) => ['support', 'coaching'].includes(r.source)))
  const words = { 'due-in': 'due in {span}', 'due-over': 'over by {span}', waiting: 'waiting {span}' }
  ok('what is owed is said in one set of words', both.every((r) => !!owedOf(r, words, Date.now())))
  ok('the badge counts them', deskBadge(desk.filter((r) => both.includes(r))).waiting === 2)

  /* ---------------------------------------------------------------- answered where it lives */
  await support.send(admin.sb, supportConv, 'yes — it went out this morning.', admin.id)
  await coaching.send(admin.sb, chatConv, 'of course, ask away.', admin.id)

  /* the member reads their own thread under the coaching policies */
  const theirs = await coaching.messages(member.sb, chatConv, member.id)
  ok('the member sees the coach\'s reply in their own thread', theirs.some((m) => m.body === 'of course, ask away.'))

  /* the guest has no principal at all: their door is the function, and it is theirs alone */
  let widget = null
  try {
    const r = await fetch(url + '/functions/v1/support', {
      method: 'POST', signal: AbortSignal.timeout(4000),
      headers: { 'content-type': 'application/json', apikey: anon, authorization: 'Bearer ' + anon, 'x-support-token': TOKEN },
      body: JSON.stringify({ action: 'messages', conversation_id: supportConv }),
    })
    widget = r.ok ? await r.json() : null
  } catch { /* the functions are not served in this run */ }
  if (widget) ok('the guest sees the reply in the widget', JSON.stringify(widget).includes('went out this morning'))
  else note('the guest\'s own read is the support function — not served in this run, so not checked here')

  /* and the desk no longer says any of them is waiting */
  const after = await mine(admin)
  ok('an answered thread stops waiting', !(after.find((r) => r.id === supportConv) || {}).waiting_since
    && !(after.find((r) => r.id === chatConv) || {}).waiting_since)

  /* ---------------------------------------------------------------- a line that is not words.
     An adapter that hands the surface a row without the file on it draws a word where a picture
     should be, and nothing fails: this is the check that says so. */
  const SITE_PIC = '/uploads/hello-there.gif'
  filePath = supportConv + '/probe.txt'
  await service.storage.from('support').upload(filePath, new Blob(['a receipt'], { type: 'text/plain' }), { upsert: true, contentType: 'text/plain' })
  await service.from('support_messages').insert([
    { conversation_id: supportConv, author: 'system', kind: 'file', body: null, attachment_path: SITE_PIC, attachment_type: 'image/*', attachment_name: 'hello-there.gif' },
    { conversation_id: supportConv, author: 'contact', kind: 'file', body: 'here is the receipt', attachment_path: filePath, attachment_type: 'text/plain', attachment_name: 'probe.txt', attachment_size: 9 },
  ])
  const lines = await support.messages(admin.sb, supportConv)
  const pic = lines.find((m) => m.name === 'hello-there.gif')
  const file = lines.find((m) => m.name === 'probe.txt')
  ok('a prompt\'s picture is handed on at the address it was written at', pic && pic.url === SITE_PIC && pic.type === 'image/*', JSON.stringify(pic))
  ok('a file in the private bucket is handed on signed', file && /^https?:\/\//.test(file.url || '') && /token=/.test(file.url || ''), JSON.stringify(file))
  ok('…with the name, the type, the size and the caption that draw it',
    file && file.type === 'text/plain' && file.size === 9 && file.body === 'here is the receipt')
  /* the coaching side's own: a voice note plays from the path, fetched by the two parties' client */
  const { data: vmsg } = await service.from('messages')
    .insert({ conversation_id: chatConv, sender_id: member.id, kind: 'voice', audio_path: chatConv + '/probe.mp3', seconds: 7 }).select().single()
  const heard = await coaching.messages(admin.sb, chatConv, admin.id)
  ok('a voice note is handed on with the path that plays it',
    (heard.find((m) => m.id === vmsg.id) || {}).audio_path === chatConv + '/probe.mp3')

  /* ---------------------------------------------------------------- not for a reader */
  ok('a reader is refused the support inbox outright', (await reader.sb.rpc('support_inbox', { p_status: 'open' })).data === null)
  const rChat = (await reader.sb.rpc('chat_inbox')).data || []
  ok('…and sees none of the coaching threads', !rChat.some((c) => c.id === chatConv))
  ok('…no message of the guest\'s', ((await reader.sb.from('support_messages').select('id').eq('conversation_id', supportConv)).data || []).length === 0)
  ok('…no conversation of the guest\'s', ((await reader.sb.from('support_conversations').select('id').eq('id', supportConv)).data || []).length === 0)
  ok('…no room of the staff\'s', !((await reader.sb.rpc('space_unread')).data || []).some((x) => x.channel === chan.id))
  ok('…and the channel\'s history is refused', (await reader.sb.rpc('space_history', { p_channel: chan.id })).data === null)

  /* ---------------------------------------------------------------- provider conversations have only a private desk mark */
  socialMarkRef = JSON.stringify([crypto.randomUUID(), 'dm', crypto.randomUUID()])
  const { error: markError } = await admin.sb.from('desk_done').upsert({
    user_id: admin.id, source: 'social', ref: socialMarkRef,
  }, { onConflict: 'user_id,source,ref' })
  if (markError) throw new Error('write Social completion mark: ' + markError.message)
  const adminMarks = (await admin.sb.from('desk_done').select('source, ref').eq('ref', socialMarkRef)).data || []
  const agentMarksBefore = (await agent.sb.from('desk_done').select('source, ref').eq('ref', socialMarkRef)).data || []
  ok('a staff member may mark a namespaced Social conversation done', adminMarks.length === 1 && adminMarks[0].source === 'social')
  ok('another staff member cannot see that private Social completion mark', agentMarksBefore.length === 0)
  const { error: otherMarkError } = await agent.sb.from('desk_done').upsert({
    user_id: agent.id, source: 'social', ref: socialMarkRef,
  }, { onConflict: 'user_id,source,ref' })
  if (otherMarkError) throw new Error('write second staff Social mark: ' + otherMarkError.message)
  const separateMarks = await Promise.all([admin, agent].map(async (staff) => {
    const { data, error } = await staff.sb.from('desk_done').select('user_id').eq('ref', socialMarkRef)
    if (error) throw error
    return data || []
  }))
  ok('the same provider reference remains independently markable by two staff members',
    separateMarks.every((marks) => marks.length === 1))

  /* ---------------------------------------------------------------- a source a site does not run */
  ok('with spaces off there is no desk at all', sourcesOn({ spaces: false }).length === 0)
  /* the comments queue is not a module of its own: comments come with the content, and a
     conversation no room owns would otherwise be nobody's job */
  ok('with coaching off the desk is the support queue and the comments', sourcesOn({ coaching: false }).join(',') === 'support,comments')
} finally {
  if (socialMarkRef) await service.from('desk_done').delete().eq('ref', socialMarkRef)
  if (filePath) await service.storage.from('support').remove([filePath])
  if (chatConv) await service.from('conversations').delete().eq('id', chatConv)
  if (supportConv) await service.from('support_conversations').delete().eq('id', supportConv)
  if (contactId) await service.from('support_contacts').delete().eq('id', contactId)
  if (spaceId) await service.from('spaces').delete().eq('id', spaceId)
}

console.log('\ndesk-db: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)

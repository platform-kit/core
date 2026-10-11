/*
 * POST { message_id } → tells the other party about a message they were not
 * there to see. The sender's client calls this right after the insert.
 *
 * One email per unread burst: nothing goes out while the recipient has been on
 * the page in the last two minutes (realtime shows them the message), and
 * nothing goes out again until they have read since the last email
 * (notified_at > last_read_at). Sending is SMTP through nodemailer — Mailgun's
 * SMTP endpoint, or any other — configured by SMTP_HOST / SMTP_PORT / SMTP_USER
 * / SMTP_PASS / SMTP_FROM; with any of those unset the function does nothing
 * and says so. The words come from strings.json, written from
 * content/app/ui/chat.md by build/chat-email-strings.mjs.
 */
import { admin, json, preflight, getUser, appUrl } from '../_shared/lib.ts'
import { sendEmail, smtpConfigured } from '../_shared/email.ts'

const PRESENT_MS = 2 * 60 * 1000

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const user = await getUser(req)
  if (!user) return json({ error: 'sign in' }, 401)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const id = String(body?.message_id ?? '')
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'bad request' }, 400)

  const { data: msg } = await admin.from('messages')
    .select('id, conversation_id, sender_id, kind, body, deleted_at, created_at, conversations(member_id, provider_id)')
    .eq('id', id).maybeSingle()
  if (!msg) return json({ error: 'no such message' }, 404)
  if (msg.sender_id !== user.id) return json({ error: 'not yours' }, 403)
  if (msg.deleted_at) return json({ skipped: 'deleted' })

  const conv = msg.conversations as any
  const to = conv.member_id === user.id ? conv.provider_id : conv.member_id

  const { data: cm } = await admin.from('conversation_members')
    .select('last_read_at, last_seen_at, notified_at').eq('conversation_id', msg.conversation_id).eq('user_id', to).maybeSingle()
  if (!cm) return json({ skipped: 'no-recipient' })
  if (cm.last_seen_at && Date.now() - new Date(cm.last_seen_at).getTime() < PRESENT_MS) return json({ skipped: 'present' })
  if (cm.notified_at && new Date(cm.notified_at).getTime() > new Date(cm.last_read_at).getTime()) return json({ skipped: 'notified' })
  if (!smtpConfigured) return json({ skipped: 'no-smtp' })

  const [{ data: rcpt }, { data: sender }] = await Promise.all([
    admin.from('profiles').select('email, display_name').eq('id', to).maybeSingle(),
    admin.from('profiles').select('email, display_name').eq('id', user.id).maybeSingle(),
  ])
  if (!rcpt?.email) return json({ skipped: 'no-email' })
  const name = sender?.display_name || (sender?.email ?? '').split('@')[0] || 'Someone'

  /* the design built under admin → Emails, filled with who wrote and where */
  const sent = await sendEmail(rcpt.email, 'chat', { name, url: `${appUrl()}/app/chat/${msg.conversation_id}` })
  if (!sent) return json({ error: 'mail: the relay refused it' }, 502)
  await admin.from('conversation_members').update({ notified_at: new Date().toISOString() })
    .eq('conversation_id', msg.conversation_id).eq('user_id', to)
  return json({ sent: true })
})

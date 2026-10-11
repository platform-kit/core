/*
 * Web push to the staff's browsers. A browser that opted in holds a row of push_subscriptions
 * (the push service's endpoint and the keys it made, the topics it wants); this sends to them,
 * signed with the deployment's VAPID pair (VAPID_PRIVATE_KEY, VAPID_SUBJECT; the public key is
 * the client's, VITE_VAPID_PUBLIC_KEY), through web-push. Unset, nothing is sent and the caller
 * is told.
 *
 * POST { action, ... }:
 *   notify { topic, data }   the database (pg_net, the service key): every subscription that holds
 *                            the topic, worded from ## push in emails.md with the facts filled in;
 *                            a support topic goes to any staff member, the others to admins alone,
 *                            whatever the row says
 *   test                     STAFF: one to the caller's own browsers, so they see what one looks like
 * A push service that says the subscription is gone (404, 410) has its row removed; other failures
 * are counted on the row.
 */
import webpush from 'npm:web-push@3.6.7'
import { admin, json, preflight, getUser, isServiceBearer } from '../_shared/lib.ts'
import { rolesOf, isSupport } from '../_shared/roles.ts'
import strings from '../_shared/emails/strings.json' with { type: 'json' }

const env = (k: string) => Deno.env.get(k) ?? ''
const configured = () => !!(env('VAPID_PUBLIC_KEY') || env('VITE_VAPID_PUBLIC_KEY')) && !!env('VAPID_PRIVATE_KEY')
const WORDS = ((strings as any).push ?? {}) as Record<string, { title?: string; body?: string; url?: string }>
/* `space-mention-sealed` is the same notification from an end-to-end encrypted room: the same
   facts (who, which room) and no words, because there are none to have — a topic of its own
   rather than an `if` here, so the sentence lives in the strings with every other one */
const TOPICS = ['support-new', 'support-message', 'users', 'purchases', 'subscriptions', 'bookings', 'space-mention', 'space-mention-sealed']
const STAFF_TOPICS = ['support-new', 'support-message']
/* a topic addressed to one person rather than to a desk: the database has already decided who may
   have it (they are a member of the channel and asked to be told), so the role is not the gate —
   the named person is. Such a call carries a recipient and reaches their browsers alone. */
const MEMBER_TOPICS = ['space-mention', 'space-mention-sealed']

const fill = (s: string | undefined, d: Record<string, unknown>) => String(s ?? '').replace(/\{(\w+)\}/g, (_, k) => (d[k] == null ? '' : String(d[k])))
const money = (cents: unknown, currency: unknown) => (typeof cents === 'number' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'usd').toUpperCase() }).format(cents / 100) : '')
const when = (iso: unknown) => { const d = new Date(String(iso || '')); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }

/* the notification's words and where it opens, from the topic's record and the facts */
function compose(topic: string, data: Record<string, unknown>) {
  const w = WORDS[topic] ?? {}
  const d = { ...data, amount: money(data.amount, data.currency), when: when(data.start_at), name: data.name || (topic.startsWith('support') ? 'A guest' : '') }
  return { title: fill(w.title, d) || topic, body: fill(w.body, d), url: fill(w.url, d) || '/admin', tag: topic + (data.conversation_id ? ':' + data.conversation_id : ''), topic }
}

async function sendAll(rows: any[], payload: Record<string, unknown>) {
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:support@example.com', env('VAPID_PUBLIC_KEY') || env('VITE_VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'))
  let sent = 0, gone = 0, failed = 0
  for (const r of rows) {
    try {
      await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, JSON.stringify(payload), { TTL: 600, urgency: 'high' })
      sent++
      await admin.from('push_subscriptions').update({ last_sent_at: new Date().toISOString(), failures: 0 }).eq('id', r.id)
    } catch (e) {
      const code = (e as any)?.statusCode
      if (code === 404 || code === 410) { gone++; await admin.from('push_subscriptions').delete().eq('id', r.id) }
      else { failed++; await admin.from('push_subscriptions').update({ failures: (r.failures ?? 0) + 1 }).eq('id', r.id) }
    }
  }
  return { sent, gone, failed }
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const action = String(body?.action ?? '')

  if (action === 'notify') {
    if (!(await isServiceBearer(req))) return json({ error: 'not allowed' }, 401)
    const topic = String(body?.topic ?? '')
    if (!TOPICS.includes(topic)) return json({ error: 'no such topic' }, 400)
    if (!configured()) return json({ skipped: 'not configured' })
    if (MEMBER_TOPICS.includes(topic)) {
      const to = String((body?.data as Record<string, unknown>)?.user ?? '')
      if (!to) return json({ error: 'no recipient' }, 400)
      const { data: mine } = await admin.from('push_subscriptions').select('*').eq('user_id', to).contains('topics', [topic])
      if (!mine?.length) return json({ sent: 0 })
      return json(await sendAll(mine, compose(topic, body?.data ?? {})))
    }
    const { data: rows } = await admin.from('push_subscriptions').select('*').contains('topics', [topic])
    if (!rows?.length) return json({ sent: 0 })
    /* the row says what was asked; the role says what may be had */
    const { data: profs } = await admin.from('profiles').select('id, role').in('id', [...new Set(rows.map((r: any) => r.user_id))])
    const role = new Map((profs ?? []).map((p: any) => [p.id, p.role]))
    const allowed = rows.filter((r: any) => { const ro = role.get(r.user_id); return ro === 'admin' || (ro === 'support' && STAFF_TOPICS.includes(topic)) })
    return json(await sendAll(allowed, compose(topic, body?.data ?? {})))
  }

  if (action === 'test') {
    const user = await getUser(req)
    if (!user) return json({ error: 'sign in' }, 401)
    const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (!isSupport(await rolesOf(user.id))) return json({ error: 'not allowed' }, 403)
    if (!configured()) return json({ error: 'not configured' }, 503)
    const { data: rows } = await admin.from('push_subscriptions').select('*').eq('user_id', user.id)
    if (!rows?.length) return json({ sent: 0 })
    return json(await sendAll(rows, compose('test', {})))
  }

  return json({ error: 'unknown action' }, 400)
})

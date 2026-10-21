/*
 * THE FUNCTIONS NOTHING ELSE CALLED — each one's door, against the stack as it is served: the wrong caller refused,
 * and the right one answered (a real answer, not a 503) wherever that is safe on a local stack. Written because the
 * coverage check (test-coverage.test.mjs) found seventeen functions no test named; a function no test calls is one
 * nothing has shown boots.
 *
 * Run by the end-to-end run (it reads its stack from test-stack.mjs, and every early exit there fails).
 */
import { createClient } from '@supabase/supabase-js'
import { requireStack } from './test-stack.mjs'

const S = requireStack('function-doors')
let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + String(detail).slice(0, 240) : '')) } }
const O = { auth: { persistSession: false, autoRefreshToken: false } }
const tokenOf = async (email) => { const c = createClient(S.api, S.anon, O); const { data } = await c.auth.signInWithPassword({ email, password: 'password123' }); return data?.session?.access_token || null }
const call = async (fn, body = {}, bearer = null, init = {}) => {
  const r = await fetch(`${S.functions}/${fn}`, { method: 'POST', redirect: 'manual', ...init, headers: { apikey: S.anon, 'content-type': 'application/json', ...(bearer ? { authorization: 'Bearer ' + bearer } : {}), ...(init.headers || {}) }, body: init.method === 'GET' ? undefined : JSON.stringify(body) })
  const text = await r.text(); let data = null; try { data = JSON.parse(text) } catch { /* not json */ }
  return { status: r.status, data, text, type: r.headers.get('content-type') || '' }
}
const refused = (r) => r.status === 401 || r.status === 403
const booted = (r) => r.status > 0 && r.status !== 502 && r.status !== 503 && r.status < 500

const member = await tokenOf('member@example.com'), admin = await tokenOf('admin@example.com'), support = await tokenOf('support@example.com')
if (!member || !admin) { console.log('function-doors: the seed\'s member@ or admin@ does not sign in'); process.exit(1) }
const service = S.service

/* ─── a member's own: they are asked as themselves ─── */
{
  const n = await call('chat-notify', { message_id: '00000000-0000-0000-0000-000000000000' })
  ok('chat-notify refuses a caller who is nobody', refused(n), n.status)
  const m = await call('chat-notify', { message_id: '00000000-0000-0000-0000-000000000000' }, member)
  ok('chat-notify answers a member about a message that is not theirs with no letter sent', booted(m) && m.status >= 400, m.status + ' ' + m.text)
}
{
  const g = await call('create-portal-session', {})
  ok('create-portal-session refuses a caller who is nobody', refused(g), g.status)
  const m = await call('create-portal-session', {}, member)
  ok('create-portal-session answers a member', booted(m), m.status + ' ' + m.text)
}
{
  const g = await call('usage-topup', { action: 'read' })
  ok('usage-topup refuses a caller who is nobody', refused(g), g.status)
  const m = await call('usage-topup', { action: 'read' }, member)
  ok('usage-topup answers a member about their own top-up', booted(m), m.status + ' ' + m.text)
}
{
  const bogus = await call('confirm-checkout', { session: 'cs_test_not_a_session' }, member)
  ok('confirm-checkout confirms nothing for a session that is not theirs', booted(bogus) && bogus.status >= 400 && !(bogus.data && bogus.data.ok), bogus.status + ' ' + bogus.text)
}

/* ─── an administrator's: refused to a member, answered to an administrator ─── */
{
  const m = await call('email-blast', { name: 'no-such-blast', dry: true }, member)
  ok('email-blast refuses a member', refused(m), m.status)
  const a = await call('email-blast', { name: 'no-such-blast', dry: true }, admin)
  ok('email-blast answers an administrator (a blast that is not there is named, nothing sent)', booted(a), a.status + ' ' + a.text)
}
{
  const m = await call('send-email', { kind: 'order-confirmation' }, member)
  ok('send-email refuses a member', refused(m), m.status)
  const a = await call('send-email', { kind: 'order-confirmation' }, admin)
  ok('send-email previews a design to an administrator, sending nothing', booted(a), a.status + ' ' + a.text)
}
{
  const m = await call('print-order', { id: '00000000-0000-0000-0000-000000000000', action: 'refresh' }, member)
  ok('print-order refuses a member', refused(m), m.status)
  const a = await call('print-order', { id: '00000000-0000-0000-0000-000000000000', action: 'refresh' }, admin)
  ok('print-order answers an administrator about an order that is not there', booted(a) && a.status >= 400, a.status + ' ' + a.text)
}
{
  const m = await call('push-catalog', {}, member)
  ok('push-catalog refuses a member', refused(m), m.status)
}

/* ─── the schedule's: the service bearer and nobody else ─── */
for (const [fn, body] of [['event-reminders', { action: 'send', dry: true }], ['social-automation', {}], ['usage-meter-report', {}], ['hyperswitch-subscription-renewal', {}]]) {
  const g = await call(fn, body)
  ok(`${fn} refuses a caller who is nobody`, refused(g), g.status)
  const m = await call(fn, body, member)
  ok(`${fn} refuses a member`, refused(m), m.status)
  const s = await call(fn, body, service)
  ok(`${fn} answers the schedule`, booted(s), s.status + ' ' + s.text)
}
{
  const g = await call('push', { action: 'notify', topic: 'support-new', data: {} })
  ok('push refuses a notification from a caller who is nobody', refused(g), g.status)
  const m = await call('push', { action: 'notify', topic: 'support-new', data: {} }, member)
  ok('push refuses a notification from a member', refused(m), m.status)
  if (support) { const t = await call('push', { action: 'test' }, support); ok('push answers the staff\'s own test', booted(t), t.status + ' ' + t.text) }
}

/* ─── the assistant's doors: a grant, never a session ─── */
for (const fn of ['copilot-llm', 'copilot-speak']) {
  const g = await call(fn, { model: 'x', messages: [{ role: 'user', content: 'hello' }], input: 'hello' })
  ok(`${fn} refuses a call without its grant`, g.status >= 400 && g.status < 500, g.status + ' ' + g.text)
  const m = await call(fn, { model: 'x', messages: [{ role: 'user', content: 'hello' }], input: 'hello' }, member)
  ok(`${fn} refuses a member\'s session in place of a grant`, m.status >= 400 && m.status < 500, m.status + ' ' + m.text)
}

/* ─── the printer's door, by its older name ─── */
{
  const r = await call('lulu-webhook', { topic: 'PRINT_JOB_STATUS_CHANGED', data: { id: 1 } })
  ok('lulu-webhook answers without trusting the body', booted(r) && !(r.data && r.data.changed), r.status + ' ' + r.text)
}

/* ─── the share picture, drawn ─── */
{
  const r = await call('share-image', null, null, { method: 'GET' })
  ok('share-image answers', booted(r) || r.status === 404, r.status + ' ' + r.type)
}

console.log(fail ? `function-doors: ${fail} failed, ${pass} passed` : `function-doors: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)

/* The funnel analytics reads against the local stack's seed: admin_funnel for the seeded funnel answers the counts
   recomputed here from the rows — sent · opened · clicked · unsubscribed per step in the window, who is in it and
   through it, and the conversions credited last touch (a purchase, a subscription or a goal page view in the seven
   days after a send goes to the last email of the funnel the person clicked before it, else the last opened, else
   nowhere) — a member is refused; and, where the functions are served, the unsubscribe link with the send it was in
   opts the person out and marks that send alone, and another person's send in the link marks nothing. Everything the
   run changes is put back. Skipped with a note when the stack is down (FUNNELS_TEST=0 skips it too). */
import fs from 'node:fs'
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'

const note = (m) => console.log('funnels-analytics: ' + m)
if (process.env.FUNNELS_TEST === '0') { note('skipped (FUNNELS_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) { note('skipped — no local stack in .env'); process.exit(0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up'); process.exit(0) }

let pass = 0, fail = 0
const ok = (msg, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg) } }
const as = async (email) => {
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(email + ': ' + error.message)
  return { sb, id: data.user.id }
}
const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const funnels = JSON.parse(fs.readFileSync('supabase/functions/_shared/emails/funnels.json', 'utf8'))

/* the seeded funnel: the one with the most rows in the log */
const log = (await service.from('email_log').select('id, user_id, kind, name, step, email_id, sent_at, opened_at, clicked_at, unsubscribed_at').not('sent_at', 'is', null)).data || []
const byName = {}
for (const r of log) if (r.kind === 'funnel') byName[r.name] = (byName[r.name] || 0) + 1
const name = Object.keys(byName).sort((a, b) => byName[b] - byName[a])[0]
if (!name || !funnels.funnels[name]) { note('the seed holds no funnel sends here — skipped'); process.exit(0) }
const f = funnels.funnels[name]
const steps = f.steps.map((s) => ({ id: s.id, after: s.after, channel: 'email' }))
const DAYS = 90, DAY = 86400e3
const since = Date.now() - DAYS * DAY
const rows = log.filter((r) => r.kind === 'funnel' && r.name === name)
const inWin = rows.filter((r) => Date.parse(r.sent_at) >= since)
/* the journey's cohort: everyone who entered in the window, and every send they had */
const members = (await service.from('funnel_members').select('user_id, entered_at, step, last_sent_at, done_at').eq('funnel', name)).data || []

const cohort = new Set(members.filter((m) => Date.parse(m.entered_at) >= since).map((m) => m.user_id))
const jrows = rows.filter((r) => cohort.has(r.user_id))
const admin = await as('admin@example.com')
const { data: got, error } = await admin.sb.rpc('admin_funnel', { kind: 'funnel', name, days: DAYS, steps, rules: null, goal: f.goal || null, tz: 'Europe/Amsterdam' })
ok('admin_funnel answers the administrator', !error && got && Array.isArray(got.steps))
if (got) {
  ok('sent in the window', got.now.sent === inWin.length)
  ok('opened, clicked and unsubscribed in the window', got.now.opened === inWin.filter((r) => r.opened_at).length && got.now.clicked === inWin.filter((r) => r.clicked_at).length && got.now.unsubscribed === inWin.filter((r) => r.unsubscribed_at).length)
  ok('in it now and through it', got.now.active === members.filter((m) => !m.done_at).length && got.now.done_ever === members.filter((m) => m.done_at).length)
  for (const [i, s] of steps.entries()) {
    const mine = jrows.filter((r) => r.email_id === s.id), g = got.steps[i]
    ok(`step ${i + 1}: sent · opened · clicked · unsubscribed`, g && g.sent === mine.length && g.opened === mine.filter((r) => r.opened_at).length && g.clicked === mine.filter((r) => r.clicked_at).length && g.unsubscribed === mine.filter((r) => r.unsubscribed_at).length)
  }
  /* the journey's between states: members not done, by their next email step, due or not, in the audience or not (no rules here: opted out is the one way out) */
  const opted = new Set(((await service.from('profiles').select('id').not('email_opt_out_at', 'is', null)).data || []).map((p) => p.id))
  const between = steps.map(() => ({ waiting: 0, held: 0, left: 0 }))
  for (const m of members) {
    if (m.done_at || m.step >= steps.length) continue
    const b = between[m.step]
    if (opted.has(m.user_id)) { b.left++; continue }
    const due = Date.parse(m.step === 0 ? m.entered_at : m.last_sent_at || m.entered_at) + steps[m.step].after * DAY
    if (due < Date.now()) b.held++; else b.waiting++
  }
  ok('waiting, held and left before each step', steps.every((s, i) => got.steps[i].waiting === between[i].waiting && got.steps[i].held === between[i].held && got.steps[i].left === between[i].left))
  /* the conversions, credited last touch — the rule again in plain JavaScript */
  const purchases = (await service.from('purchases').select('user_id, created_at, amount_total').eq('status', 'paid')).data || []
  const subs = (await service.from('subscriptions').select('user_id, created_at')).data || []
  const goals = f.goal ? ((await service.from('events').select('user_id, occurred_at').eq('type', 'pageview').eq('path', f.goal).not('user_id', 'is', null)).data || []) : []
  const credit = (userId, at) => {
    const t = Date.parse(at)
    const c = rows.filter((r) => r.user_id === userId && Date.parse(r.sent_at) > t - 7 * DAY && Date.parse(r.sent_at) <= t)
      .map((r) => ({ r, clicked: r.clicked_at && Date.parse(r.clicked_at) <= t ? Date.parse(r.clicked_at) : null, opened: r.opened_at && Date.parse(r.opened_at) <= t ? Date.parse(r.opened_at) : null }))
      .filter((x) => x.clicked || x.opened)
    if (!c.length) return null
    c.sort((a, b) => (b.clicked ? 1 : 0) - (a.clicked ? 1 : 0) || (b.clicked || b.opened) - (a.clicked || a.opened))
    return c[0].r
  }
  /* the tiles count conversions in the window; a step counts those credited to a cohort send, whenever they happened */
  const exp = steps.map(() => ({ conversions: 0, goal: 0, revenue: 0 }))
  let total = 0, revenue = 0, goalN = 0
  for (const [kind, list] of [['purchase', purchases], ['subscription', subs], ['goal', goals]]) {
    for (const c of list) {
      const at = c.created_at || c.occurred_at
      const r = credit(c.user_id, at)
      if (!r) continue
      const i = steps.findIndex((s) => s.id === r.email_id)
      if (i < 0) continue   /* a send of a step the files no longer have */
      if (Date.parse(at) >= since) { if (kind === 'goal') goalN++; else { total++; if (kind === 'purchase') revenue += c.amount_total || 0 } }
      if (cohort.has(r.user_id)) { if (kind === 'goal') exp[i].goal++; else { exp[i].conversions++; if (kind === 'purchase') exp[i].revenue += c.amount_total || 0 } }
    }
  }
  ok('the conversions credited last touch, in all', got.now.conversions === total && got.now.revenue === revenue && got.now.goal === goalN)
  ok('the conversions credited last touch, per step', steps.every((s, i) => got.steps[i].conversions === exp[i].conversions && got.steps[i].revenue === exp[i].revenue && got.steps[i].goal === exp[i].goal))
  ok('a purchase after a click sits on the funnel', total >= 1)
  const idx = (await admin.sb.rpc('admin_funnels', { days: DAYS, goals: f.goal ? { ['funnel:' + name]: f.goal } : {} })).data
  ok('the index lists the funnel with the same sends', idx && (idx.items || []).some((it) => it.kind === 'funnel' && it.name === name && it.sent === inWin.length))
}
const member = await as('member@example.com')
const refused = await member.sb.rpc('admin_funnel', { kind: 'funnel', name, days: DAYS, steps })
ok('a member is refused (42501)', refused.error && /42501|admin only/.test(refused.error.code + refused.error.message))

/* the unsubscribe link, against the served function */
let served = false
try { served = (await fetch(url + '/functions/v1/email-unsubscribe', { method: 'OPTIONS', signal: AbortSignal.timeout(2000) })).status < 500 } catch { /* not served */ }
if (!served) note('the functions are not served (npm run dev serves them) — the unsubscribe link is not checked')
else {
  const hmac = (id) => createHmac('sha256', 'unsubscribe:' + serviceKey()).update(id).digest().subarray(0, 16).toString('hex')
  const clean = (await service.from('profiles').select('id').is('email_opt_out_at', null).like('email', 'reader%@example.com').limit(2)).data || []
  const a = rows.find((r) => r.user_id === clean[0]?.id && !r.unsubscribed_at), b = rows.find((r) => r.user_id === clean[1]?.id && !r.unsubscribed_at)
  if (!a || !b) note('no clean seeded send to unsubscribe from — skipped')
  else {
    const go = (u, l) => fetch(`${url}/functions/v1/email-unsubscribe?u=${u}&t=${hmac(u)}&l=${l}`)
    const r1 = await go(a.user_id, a.id)
    const row1 = (await service.from('email_log').select('unsubscribed_at').eq('id', a.id).single()).data
    const p1 = (await service.from('profiles').select('email_opt_out_at').eq('id', a.user_id).single()).data
    ok('the unsubscribe link opts the person out and marks the send it was in', r1.ok && row1 && row1.unsubscribed_at && p1 && p1.email_opt_out_at)
    /* the second person's link, with the first person's send in it: opted out, nothing marked */
    const r2 = await go(b.user_id, a.id)
    const rowB = (await service.from('email_log').select('unsubscribed_at').eq('id', b.id).single()).data
    const p2 = (await service.from('profiles').select('email_opt_out_at').eq('id', b.user_id).single()).data
    ok("another person's send in the link marks nothing", r2.ok && p2 && p2.email_opt_out_at && rowB && !rowB.unsubscribed_at)
    /* put back */
    await service.from('email_log').update({ unsubscribed_at: null }).in('id', [a.id, b.id])
    await service.from('profiles').update({ email_opt_out_at: null }).in('id', [a.user_id, b.user_id])
  }
}
/* a tracked click lands with the email's tags: the redirect's address carries utm_source (the funnel), utm_medium email and utm_campaign (the step's title) */
if (served) {
  const link = (await service.from('email_links').select('token, log_id, url').eq('kind', 'click').not('url', 'is', null).limit(1)).data?.[0]
  if (!link) note('no seeded click link — the redirect is not checked')
  else {
    const before = (await service.from('email_links').select('hits').eq('token', link.token).single()).data.hits
    const logBefore = (await service.from('email_log').select('clicks, clicked_at, opened_at').eq('id', link.log_id).single()).data
    const started = new Date().toISOString()
    const r = await fetch(url + '/functions/v1/email-track/' + link.token, { redirect: 'manual' })
    const to = r.headers.get('location') || ''
    let q = null; try { q = new URL(to).searchParams } catch { /* none */ }
    ok('a tracked click redirects to the destination with the email\'s UTM tags', r.status === 302 && q && q.get('utm_source') === name && q.get('utm_medium') === 'email' && !!q.get('utm_campaign') && to.startsWith(link.url.split('?')[0]))
    /* the hit put back: the link's count, the log's, the event */
    await service.from('email_links').update({ hits: before }).eq('token', link.token)
    await service.from('email_log').update(logBefore).eq('id', link.log_id)
    await service.from('email_events').delete().eq('log_id', link.log_id).gte('at', started)
  }
}

console.log(`funnels-analytics: ${pass} passed${fail ? `, ${fail} failed` : ''}`)
process.exit(fail ? 1 : 0)

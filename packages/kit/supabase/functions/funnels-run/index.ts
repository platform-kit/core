/*
 * The funnels, run: every hour (pg_cron → run_email_funnels() → pg_net → here; or the admin's
 * "Run now"), for every published funnel — its audience now, each person's place in it
 * (funnel_members), the step that is due (the first at once on entering, each next one
 * `after` days since the last was sent), the cooldowns (the policy's counts, the funnel's own
 * gap), and a person still matching the audience at that moment — sent, logged, moved on.
 * Someone who stops matching stays where they are and resumes if they match again; someone
 * who has had every step is done. Let in by the service role key as bearer (the cron's, the
 * deploy's, the admin server's) or an admin's JWT. On every authorised call it also writes
 * app_settings with its own url, so a hosted project's cron learns where its functions are.
 * `{ dry: true }` says what it would send and sends nothing.
 */
import { admin, json, preflight, getUser, isServiceBearer } from '../_shared/lib.ts'
import { rolesOf, isAdmin } from '../_shared/roles.ts'
import { FUNNELS, POLICY, audience, recentSends, cooled, sendMarketing, functionsUrl } from '../_shared/marketing.ts'

const DAY = 86400e3
const env = (k: string) => Deno.env.get(k) ?? ''

async function allowed(req: Request) {
  /* the service key in either of its forms (the deploy's sb_secret_…, the runtime's legacy JWT) */
  if (await isServiceBearer(req)) return true
  const user = await getUser(req)
  if (!user) return false
  const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  return isAdmin(await rolesOf(user.id))
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  if (!(await allowed(req))) return json({ error: 'not allowed' }, 401)
  let body: any = {}
  try { body = await req.json() } catch { /* none */ }
  const dry = !!body?.dry
  const only = typeof body?.funnel === 'string' ? body.funnel : null
  /* the cron's settings, kept current from here */
  await admin.from('app_settings').upsert([{ key: 'functions_url', value: functionsUrl(), updated_at: new Date().toISOString() }, { key: 'functions_secret', value: env('SUPABASE_SERVICE_ROLE_KEY'), updated_at: new Date().toISOString() }])

  const report: Record<string, { audience: number; sent: number; held: number; done: number; would?: string[] }> = {}
  for (const [name, f] of Object.entries(FUNNELS)) {
    /* a chat prompt is never an email step (the build keeps them apart; this holds it) */
    const emailSteps = f.steps.filter((s: any) => s.channel !== 'chat')
    if (!f.published || (only && only !== name) || !emailSteps.length) continue
    const people = await audience(f.rules)
    const r = { audience: people.length, sent: 0, held: 0, done: 0, ...(dry ? { would: [] as string[] } : {}) }
    report[name] = r
    if (!people.length) continue
    const ids = people.map((p) => p.user_id)
    const { data: mrows } = await admin.from('funnel_members').select('user_id, entered_at, step, last_sent_at, done_at').eq('funnel', name).in('user_id', ids)
    const members = new Map((mrows ?? []).map((m) => [m.user_id, m]))
    const sends = await recentSends(ids)
    const now = Date.now()
    for (const p of people) {
      let m = members.get(p.user_id)
      if (!m) {
        /* entering now: the row first, so a crash between never sends step one twice */
        m = { user_id: p.user_id, entered_at: new Date().toISOString(), step: 0, last_sent_at: null, done_at: null }
        if (!dry) await admin.from('funnel_members').upsert({ user_id: p.user_id, funnel: name, entered_at: m.entered_at, step: 0 })
      }
      if (m.done_at) { r.done++; continue }
      const next = emailSteps[m.step]
      if (!next) { r.done++; if (!dry) await admin.from('funnel_members').update({ done_at: new Date().toISOString() }).eq('funnel', name).eq('user_id', p.user_id); continue }
      const since = Date.parse(m.step === 0 ? m.entered_at : m.last_sent_at ?? m.entered_at)
      if (now - since < next.after * DAY) { r.held++; continue }
      if (!cooled(sends.get(p.user_id), POLICY, { name, cooldown: f.cooldown })) { r.held++; continue }
      if (dry) { r.would!.push(`${p.email} ← step ${m.step + 1} "${next.subject}"`); r.sent++; continue }
      const res = await sendMarketing('funnel', name, m.step + 1, p, f.design, next)
      if (res === 'failed') { r.held++; continue }
      /* 'had': the log already holds this email for them (a renamed funnel, a reordered step) — moved on, not sent again */
      if (res === 'sent') r.sent++
      const done = m.step + 1 >= emailSteps.length
      await admin.from('funnel_members').update({ step: m.step + 1, last_sent_at: new Date().toISOString(), ...(done ? { done_at: new Date().toISOString() } : {}) }).eq('funnel', name).eq('user_id', p.user_id)
      const l = sends.get(p.user_id) ?? []; l.push({ at: now, kind: 'funnel', name }); sends.set(p.user_id, l)
    }
  }
  return json({ ok: true, dry, policy: POLICY, funnels: report })
})

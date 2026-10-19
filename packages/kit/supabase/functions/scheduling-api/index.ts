/*
 * The Scheduling API — the site's sessions served as cal.com's API v2 (scheduling-api): event types, slots, bookings
 * (list, get, make, move, cancel), a host's schedule, me, and webhooks — at <domain>/v2/… (a host rewrite `/v2/*` → this
 * function; its own address answers too), so anything written against api.cal.com works with the host changed — the
 * kit's own cal.js scheduler included (CAL_API_BASE). A caller is a key of kind `scheduling` (Settings → API: the
 * site's authority — every type, every booking, the hosts' hours, the webhooks) or a signed-in reader's JWT (their own
 * bookings, the types their tier admits; no webhooks); never no one. The judge holds for every booking whoever asks: the
 * attendee is the account with that email (a guest only for a type that admits guests and sells nothing), the tier
 * and the allowance apply, a paid type needs a credit on the account. The shapes are _shared/api/cal/*, the
 * envelope cal.com's; the scheduling itself the schedulers behind sessions.ts, the aftermath booking.ts.
 *
 *   GET  /v2/me                                         GET  /v2/event-types[?username|eventSlug]   GET /v2/event-types/{id}
 *   GET  /v2/slots?eventTypeId|eventTypeSlug&start&end&timeZone&format        (cal-api-version 2024-09-04)
 *   GET  /v2/bookings?status&attendeeEmail&eventTypeId&afterStart&beforeEnd&sortStart&take&skip   GET /v2/bookings/{uid}
 *   POST /v2/bookings   { start, eventTypeId | eventTypeSlug, attendee { name, email, timeZone, language, phoneNumber }, guests, metadata, bookingFieldsResponses }
 *   POST /v2/bookings/{uid}/reschedule { start, reschedulingReason }        POST /v2/bookings/{uid}/cancel { cancellationReason }
 *   GET  /v2/schedules   GET /v2/schedules/{id}          (a key: every host's; a JWT: the caller's own)
 *   GET  /v2/ooo                                          the days somebody is away, and who covers
 *   POST /v2/bookings/{uid}/confirm   .../decline        the host's word on one that waits for it
 *   GET|POST /v2/webhooks    GET|PATCH|DELETE /v2/webhooks/{id}             (a key alone)
 */
import { admin, appUrl, getUser } from '../_shared/lib.ts'
import { tokenOf, keyOf, rateLimit } from '../_shared/api/keys.ts'
import { API_ON, SESSIONS_ON } from '../_shared/api/flags.ts'
import { SESSIONS, sessionBySlug, judge, tiersOf, forRank, schedulerOf, schedulerIdOf, type Session } from '../_shared/cal.ts'
import { formsNow } from '../_shared/forms-live.ts'
import { makeBooking, moveBooking, cancelBooking } from '../_shared/booking.ts'
import { offer } from '../_shared/offers.ts'
import { eventTypeOf, eventTypeId } from '../_shared/api/cal/event-type.js'
import { bookingOf, statusFilter } from '../_shared/api/cal/booking.js'
import { scheduleOf } from '../_shared/api/cal/schedule.js'
import { ok, fail, CODES } from '../_shared/api/cal/envelope.js'
import { TRIGGERS } from '../_shared/api/cal/webhook.js'
import { calBookingOf } from '../_shared/scheduling-events.ts'
import { fresh } from '../_shared/compiled.ts'   /* the compiled artefacts, re-read within a few seconds of a publish */

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, cal-api-version, apikey', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' }
type Caller = { kind: 'key'; id: string } | { kind: 'jwt'; id: string; email: string; role: string; name: string }
const site = () => appUrl()
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const typeOf = (idOrSlug: string | null) => { if (!idOrSlug) return null; const n = Number(idOrSlug); return SESSIONS.find((s) => s.slug === idOrSlug || (Number.isFinite(n) && eventTypeId(s.slug) === n)) ?? null }
async function hostsOf(s: Session) { if (!s.hosts?.length) return []; const { data } = await admin.from('profiles').select('id, email, display_name').in('email', s.hosts); return (data ?? []).map((h: any) => ({ id: h.id, email: h.email, name: h.display_name || '' })) }
const priceOf = (s: Session) => { if (!s.sku) return null; try { const o = offer(s.sku) as any; return o ? { amount: Number(o.price) || 0, currency: String(o.currency || 'usd').toLowerCase() } : null } catch { return null } }
const WEBHOOK_COLS = 'id, subscriber_url, triggers, active, payload_template, event_type_slug, created_by, created_at, updated_at, last_at, last_error'
const webhookView = (w: any) => ({ id: eventTypeId('webhook:' + w.id), uid: w.id, subscriberUrl: w.subscriber_url, triggers: w.triggers, active: !!w.active, payloadTemplate: w.payload_template || null, eventTypeId: w.event_type_slug ? eventTypeId(w.event_type_slug) : null, userId: w.created_by ? eventTypeId('user:' + w.created_by) : null, createdAt: w.created_at, updatedAt: w.updated_at, lastDeliveredAt: w.last_at, lastError: w.last_error })

Deno.serve(async (req) => {
  await fresh()
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  const q: Record<string, string> = {}; url.searchParams.forEach((v, k) => { q[k] = v })
  const path = url.pathname.replace(/^(?:.*?\/functions\/v1)?\/scheduling-api(?=\/|$)/, '').replace(/\/+$/, '') || '/'
  let extra: Record<string, string> = {}
  const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...CORS, ...extra, 'Content-Type': 'application/json', ...headers } })
  const err = (status: number, message: string, details?: unknown) => { const e = fail(status, CODES[status as keyof typeof CODES] || 'ERROR', message, details); return reply(e.body, e.status) }
  if (!API_ON || !SESSIONS_ON) return err(404, 'The Scheduling API is not on for this site.')
  const m = req.method
  const seg = path.split('/').filter(Boolean)
  if (seg[0] !== 'v2') return err(404, 'The Scheduling API is under /v2.')

  /* who is asking: a scheduling key, else a reader's JWT */
  const token = tokenOf(req, q)
  let caller: Caller | null = null
  const key = await keyOf(token, ['scheduling'])
  if (key === 'other-kind') return err(403, 'This key does not open the Scheduling API: make one of kind scheduling under Settings → API.')
  if (key) caller = { kind: 'key', id: key.id ?? 'key' }
  else if (token) { const user = await getUser(req); if (user) { const { data: prof } = await admin.from('profiles').select('email, email_verified_at, display_name, role, roles').eq('id', user.id).maybeSingle(); caller = { kind: 'jwt', id: user.id, email: prof?.email_verified_at ? (prof?.email ?? '').toLowerCase() : '', role: (Array.isArray(prof?.roles) && prof.roles.includes('admin')) || prof?.role === 'admin' ? 'admin' : 'user', name: (user.user_metadata?.full_name ?? user.user_metadata?.name ?? prof?.display_name ?? '') as string } } }
  if (!caller) return err(401, 'A key of kind scheduling, or a signed-in reader.')
  const rl = await rateLimit(caller.id); extra = rl.headers
  if (rl.over) return reply(fail(429, 'TOO_MANY_REQUESTS', 'Rate limit exceeded.').body, 429, { 'Retry-After': String(rl.reset) })
  const isKey = caller.kind === 'key'
  const admitted = async (s: Session) => { if (isKey) return true; const c = caller as Extract<Caller, { kind: 'jwt' }>; if (c.role === 'admin') return true; const { rank, tiers } = await tiersOf(c.id); return forRank(s, rank, true, tiers) }
  const readBody = async () => { try { return await req.json() } catch { return null } }

  try {
    /* ---- me ---- */
    if (m === 'GET' && path === '/v2/me') {
      if (isKey) { const { data: k } = await admin.from('api_keys').select('name, created_by').eq('id', caller.id).maybeSingle(); const { data: p } = k?.created_by ? await admin.from('profiles').select('email, display_name').eq('id', k.created_by).maybeSingle() : { data: null }; return reply(ok({ id: eventTypeId('user:' + (p?.email || caller.id)), username: String(p?.email || k?.name || 'api').split('@')[0], email: p?.email || '', name: p?.display_name || k?.name || 'API key', timeFormat: 24, defaultScheduleId: null, weekStart: 'Monday', timeZone: 'UTC', organizationId: null, organization: null })) }
      const c = caller as Extract<Caller, { kind: 'jwt' }>; const { data: hr } = await admin.from('provider_schedules').select('timezone').eq('user_id', c.id).eq('is_default', true).maybeSingle()
      return reply(ok({ id: eventTypeId('user:' + c.email), username: c.email.split('@')[0], email: c.email, name: c.name, timeFormat: 24, defaultScheduleId: hr ? eventTypeId('user:' + c.email) : null, weekStart: 'Monday', timeZone: hr?.timezone || 'UTC', organizationId: null, organization: null }))
    }
    /* ---- event types ---- */
    if (seg[1] === 'event-types') {
      if (m !== 'GET') return err(405, 'Event types are written in content/sessions; the API reads them.')
      const list = []
      for (const s of SESSIONS) { if (!(await admitted(s))) continue; if (q.eventSlug && s.slug !== q.eventSlug) continue; const hosts = await hostsOf(s); if (q.username && !hosts.some((h) => String(h.email).split('@')[0] === q.username || h.email === q.username)) continue; list.push(eventTypeOf(s, { hosts, price: priceOf(s), site: site(), form: s.form ? (await formsNow())[s.form] : null })) }
      if (seg.length === 2) return reply(ok(list))
      const one = list.find((e) => String(e.id) === seg[2] || e.slug === seg[2]); return one ? reply(ok(one)) : err(404, `No event type ${seg[2]}.`)
    }
    /* ---- slots ---- */
    if (seg[1] === 'slots' && seg.length === 2 && m === 'GET') {
      const s = typeOf(q.eventTypeId || q.eventTypeSlug || null); if (!s) return err(404, 'eventTypeId or eventTypeSlug names no type.')
      if (!(await admitted(s))) return err(403, 'Not yours to book.', { code: 'not-included' })
      const day = (v: string) => { const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10) }
      const from = day(q.start || ''), to = day(q.end || ''); if (!from || !to) return err(400, 'start and end are dates.')
      const timeZone = q.timeZone || 'UTC'
      const r = await (schedulerOf(s) as any).slots(s, from, to, timeZone)
      const data: Record<string, { start: string; end?: string }[]> = {}
      for (const [d, list] of Object.entries(r.slots || {})) data[d] = (list as string[]).map((start) => (q.format === 'range' ? { start, end: new Date(Date.parse(start) + (r.minutes || s.duration) * 60000).toISOString() } : { start }))
      return reply(ok(data))
    }
    /* ---- bookings ---- */
    if (seg[1] === 'bookings') {
      const own = (row: any) => isKey || row.user_id === caller.id || row.host_id === caller.id || row.provider_id === caller.id || (caller as any).role === 'admin' || (row.attendee_emails || []).includes((caller as any).email)
      const view = async (uid: string) => { const b = await calBookingOf(uid); return b }
      if (seg.length === 2 && m === 'GET') {
        let qb: any = admin.from('bookings').select('uid, user_id, host_id, provider_id, attendee_emails, email, start_at, event, status').order('start_at', { ascending: q.sortStart !== 'desc' })
        qb = statusFilter(q.status)(qb)
        if (q.attendeeEmail) qb = qb.or(`email.ilike.${q.attendeeEmail},attendee_emails.cs.{${q.attendeeEmail}}`)
        if (q.eventTypeId || q.eventTypeSlug) { const s = typeOf(q.eventTypeId || q.eventTypeSlug); if (!s) return reply(ok([])); qb = qb.eq('event', s.event) }
        if (q.afterStart) qb = qb.gte('start_at', q.afterStart); if (q.beforeEnd) qb = qb.lte('end_at', q.beforeEnd)
        if (!isKey && (caller as any).role !== 'admin') qb = qb.or(`user_id.eq.${caller.id},host_id.eq.${caller.id},provider_id.eq.${caller.id}`)
        const take = Math.min(250, Math.max(1, Number(q.take) || 100)), skip = Math.max(0, Number(q.skip) || 0)
        const { data: rows } = await qb.range(skip, skip + take - 1)
        const out = []; for (const r of rows ?? []) { const b = await view(r.uid); if (b) out.push(b) }
        return reply(ok(out))
      }
      if (seg.length === 2 && m === 'POST') {
        const body = await readBody(); if (!body) return err(400, 'A JSON body.')
        const s = typeOf(body.eventTypeId != null ? String(body.eventTypeId) : body.eventTypeSlug || null); if (!s) return err(404, 'eventTypeId or eventTypeSlug names no type.')
        const start = String(body.start || ''); if (Number.isNaN(Date.parse(start))) return err(400, 'start is a date-time.')
        if (Date.parse(start) < Date.now()) return err(400, 'That time has passed.')
        const a = body.attendee || {}
        let email = String(a.email || (isKey ? '' : (caller as any).email) || '').trim().toLowerCase()
        if (!EMAIL.test(email)) return err(400, 'attendee.email is required.')
        if (!isKey && (caller as any).role !== 'admin' && email !== (caller as any).email) return err(403, 'A reader books for themselves.')
        const { data: prof } = await admin.from('profiles').select('id, email, display_name').ilike('email', email).maybeSingle()
        const user_id = prof?.id ?? null
        const name = String(a.name || prof?.display_name || '').slice(0, 120)
        const timeZone = String(a.timeZone || 'UTC')
        const notes = String((body.bookingFieldsResponses || {}).notes || body.notes || '').slice(0, 1000)
        const phone = String(a.phoneNumber || (body.bookingFieldsResponses || {}).attendeePhoneNumber || '').slice(0, 40)
        if (!user_id && !['anyone', 'guest'].includes(s.requires)) return err(403, 'No account with that address; this type is for members.', { code: 'guest' })
        const v = await judge(s.event, user_id, email, null)
        if (!v.ok) return err(v.reason === 'unpaid' ? 402 : 403, v.reason === 'unpaid' ? 'This type is paid: a credit on the account is needed.' : v.reason === 'over' ? 'Over the allowance.' : v.reason === 'guest' ? 'Sign in: this type is for members.' : 'Not included in the plan.', { code: v.reason, next: (v as any).next ?? null, allowance: (v as any).allowance ?? null })
        if (schedulerIdOf(s) === 'native') { if ((!s.hosts?.length && !s.team) || !(s.duration > 0)) return err(503, 'This type has no host or no length yet.'); if (s.where?.kind === 'phone' && !s.where.number && !phone) return err(400, 'attendee.phoneNumber is required for this type.') }
        try {
          const made = await makeBooking(s, { start, attendee: { email, name, timeZone, user_id }, user_id, notes, phone, credit: v.credit })
          if (body.metadata && typeof body.metadata === 'object') { const { data: row } = await admin.from('bookings').select('payload').eq('uid', made.uid).maybeSingle(); await admin.from('bookings').update({ payload: { ...(row?.payload || {}), metadata: { ...((row?.payload || {}).metadata || {}), ...body.metadata } } }).eq('uid', made.uid) }
          return reply(ok(await view(made.uid)), 201)
        } catch (e) {
          const msg = String((e as any)?.message ?? e), code = String((e as any)?.code ?? '')
          const taken = code === 'taken' || /slot|available|already|booked|conflict/i.test(msg) || (e as any)?.status === 409
          return taken ? err(409, 'That time was just taken.', { code: 'taken' }) : err(502, `${schedulerIdOf(s)}: ${msg}`)
        }
      }
      if (seg.length >= 3) {
        const uid = seg[2]
        const { data: row } = await admin.from('bookings').select('uid, user_id, email, host_id, provider_id, attendee_emails, event, status, start_at, credit_id').eq('uid', uid).maybeSingle()
        if (!row || !own(row)) return err(404, `No booking ${uid}.`)
        if (seg.length === 3 && m === 'GET') return reply(ok(await view(uid)))
        const s = sessionBySlug(SESSIONS.find((x) => x.event === row.event)?.slug ?? null)
        const by = { email: isKey ? row.email || '' : (caller as any).email, role: (isKey || (caller as any).role === 'admin' ? 'admin' : row.user_id === caller.id ? 'reader' : 'host') as 'reader' | 'host' | 'admin' }
        if (seg[3] === 'reschedule' && m === 'POST') {
          const body = await readBody(); const start = String(body?.start || ''); if (Number.isNaN(Date.parse(start))) return err(400, 'start is a date-time.')
          if (!s) return err(400, 'This booking\'s type is gone.')
          if (!['accepted', 'pending'].includes(row.status)) return err(400, 'That booking is over.')
          if (schedulerIdOf(s) === 'native' && by.role === 'reader' && s.notice > 0 && row.start_at && Date.parse(row.start_at) - Date.now() < s.notice * 36e5) return err(403, 'Too soon to move.', { code: 'too-soon', hours: s.notice })
          try { const made = await moveBooking(s, uid, start, by, row.user_id ?? caller.id); return reply(ok(await view(made.uid))) } catch (e) { const msg = String((e as any)?.message ?? e); return /slot|available|already|booked|conflict|taken/i.test(msg) ? err(409, 'That time was just taken.', { code: 'taken' }) : err(502, msg) }
        }
        /* THE HOST'S WORD on a booking that waits for it — cal.com's own two routes. Saying yes IS
           the booking being made, so both go to the same function the app's own buttons go to. */
        if ((seg[3] === 'confirm' || seg[3] === 'decline') && m === 'POST') {
          if (!(isKey || row.host_id === caller.id || row.provider_id === caller.id || (caller as any).role === 'admin')) return err(403, 'The host says.')
          if (row.status !== 'pending') return err(400, 'That booking has been answered.')
          const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/book-session`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: req.headers.get('authorization') || '' }, body: JSON.stringify({ action: seg[3] === 'confirm' ? 'accept' : 'decline', uid: row.uid }) })
          if (!r.ok) { const j = await r.json().catch(() => ({})); return err(r.status === 403 ? 403 : 400, String(j.error || 'That could not be answered.')) }
          const b2 = await view(row.uid); return reply(ok(b2))
        }
        if (seg[3] === 'cancel' && m === 'POST') {
          const body = await readBody()
          if (!['accepted', 'pending'].includes(row.status)) return err(400, 'That booking is over.')
          await cancelBooking(row, by, String(body?.cancellationReason || 'cancelled through the API').slice(0, 300))
          return reply(ok(await view(uid)))
        }
        return err(404, 'No such route.')
      }
      return err(405, 'GET or POST.')
    }
    /* ---- out of office ---- */
    if (seg[1] === 'ooo' && m === 'GET') {
      /* a key reads every host's; a person reads their own — cal.com's route is per user and this
         answers the same shape for whichever of the two is asking */
      let q2: any = admin.from('provider_ooo').select('id, user_id, from, to, reason, cover_id').order('from')
      if (!isKey && (caller as any).role !== 'admin') q2 = q2.eq('user_id', caller.id)
      const { data: rows } = await q2
      const ids = [...new Set((rows ?? []).flatMap((r: any) => [r.user_id, r.cover_id]).filter(Boolean))]
      const { data: ps } = ids.length ? await admin.from('profiles').select('id, email, display_name').in('id', ids) : { data: [] }
      const who = (id: string) => (ps ?? []).find((p: any) => p.id === id)
      return reply(ok((rows ?? []).map((r: any) => ({
        id: r.id, userId: eventTypeId('user:' + (who(r.user_id)?.email || r.user_id)),
        start: r.from, end: r.to, notes: r.reason || null,
        reason: { emoji: '🌴', reason: r.reason || 'unspecified' },
        toUser: r.cover_id ? { id: eventTypeId('user:' + (who(r.cover_id)?.email || r.cover_id)), username: String(who(r.cover_id)?.email || '').split('@')[0] } : null,
      }))))
    }
    if (seg[1] === 'ooo') return err(405, 'Days away are set in the app (Coaching → When you are away); the API reads them.')
    /* ---- schedules ---- */
    if (seg[1] === 'schedules' && m === 'GET') {
      let hosts: { id: string; email: string; name: string }[]
      if (isKey || (caller as any).role === 'admin') { const { data } = await admin.from('provider_schedules').select('user_id'); const ids = (data ?? []).map((h: any) => h.user_id); const { data: ps } = ids.length ? await admin.from('profiles').select('id, email, display_name').in('id', ids) : { data: [] }; hosts = (ps ?? []).map((p: any) => ({ id: p.id, email: p.email, name: p.display_name || '' })) }
      else { const c = caller as Extract<Caller, { kind: 'jwt' }>; hosts = [{ id: c.id, email: c.email, name: c.name }] }
      const out = []
      /* EVERY set a host keeps, not one: cal.com answers all of them with one marked isDefault, and a
         client that asks for schedules and gets a single row cannot tell which hours a type will use */
      for (const h of hosts) {
        const { data: sets } = await admin.from('provider_schedules').select('id, name, is_default, timezone, weekly, buffer_before, buffer_after, notice_hours, max_per_day, max_per_week').eq('user_id', h.id).order('is_default', { ascending: false }).order('name')
        if (!sets || !sets.length) continue
        const { data: ov } = await admin.from('provider_overrides').select('day, ranges, schedule_id').eq('user_id', h.id)
        for (const s of sets) out.push(scheduleOf(h, { ...s, overrides: (ov ?? []).filter((x: any) => x.schedule_id === s.id || (!x.schedule_id && s.is_default)) }))
      }
      if (seg.length === 2) return reply(ok(out))
      const one = out.find((x) => String(x.id) === seg[2]); return one ? reply(ok(one)) : err(404, `No schedule ${seg[2]}.`)
    }
    if (seg[1] === 'schedules') return err(405, 'A host\'s hours are set in the app (Coaching → Your hours); the API reads them.')
    /* ---- webhooks ---- */
    if (seg[1] === 'webhooks') {
      if (!isKey) return err(403, 'Webhooks are the site\'s: a key of kind scheduling.')
      if (seg.length === 2 && m === 'GET') { const { data } = await admin.from('scheduling_webhooks').select(WEBHOOK_COLS).order('created_at'); return reply(ok((data ?? []).map(webhookView))) }
      const parse = (body: any, partial: boolean) => {
        const out: any = {}
        if (body.subscriberUrl !== undefined || !partial) { if (typeof body.subscriberUrl !== 'string' || !/^https?:\/\/\S+$/.test(body.subscriberUrl)) return { error: 'subscriberUrl is required and must be http(s).' }; out.subscriber_url = body.subscriberUrl }
        if (body.triggers !== undefined || !partial) { if (!Array.isArray(body.triggers) || !body.triggers.length || body.triggers.some((t: unknown) => !TRIGGERS.includes(String(t)))) return { error: 'triggers is a list of ' + TRIGGERS.join(', ') + '.' }; out.triggers = body.triggers.map(String) }
        if (body.active !== undefined) out.active = !!body.active
        if (body.secret !== undefined) out.secret = body.secret ? String(body.secret).slice(0, 200) : null
        if (body.payloadTemplate !== undefined) out.payload_template = body.payloadTemplate ? String(body.payloadTemplate).slice(0, 4000) : null
        if (body.eventTypeId !== undefined) { const s = body.eventTypeId == null ? null : typeOf(String(body.eventTypeId)); if (body.eventTypeId != null && !s) return { error: 'eventTypeId names no type.' }; out.event_type_slug = s ? s.slug : null }
        return { value: out }
      }
      if (seg.length === 2 && m === 'POST') {
        const body = await readBody(); if (!body) return err(400, 'A JSON body.')
        const p = parse(body, false); if (p.error) return err(400, p.error)
        const { data: k } = await admin.from('api_keys').select('created_by').eq('id', caller.id).maybeSingle()
        const { data, error } = await admin.from('scheduling_webhooks').insert({ ...p.value, created_by: k?.created_by ?? null }).select(WEBHOOK_COLS).single()
        if (error) return err(400, error.message)
        return reply(ok(webhookView(data)), 201)
      }
      if (seg.length === 3) {
        const { data: w } = await admin.from('scheduling_webhooks').select(WEBHOOK_COLS).or(`id.eq.${/^[0-9a-f-]{36}$/.test(seg[2]) ? seg[2] : '00000000-0000-0000-0000-000000000000'}`).maybeSingle()
        const byNum = w ? w : (await (async () => { const { data: all } = await admin.from('scheduling_webhooks').select(WEBHOOK_COLS); return (all ?? []).find((x: any) => String(eventTypeId('webhook:' + x.id)) === seg[2]) ?? null })())
        if (!byNum) return err(404, `No webhook ${seg[2]}.`)
        if (m === 'GET') return reply(ok(webhookView(byNum)))
        if (m === 'PATCH') { const body = await readBody(); if (!body) return err(400, 'A JSON body.'); const p = parse(body, true); if (p.error) return err(400, p.error); const { data, error } = await admin.from('scheduling_webhooks').update({ ...p.value, updated_at: new Date().toISOString() }).eq('id', byNum.id).select(WEBHOOK_COLS).single(); if (error) return err(400, error.message); return reply(ok(webhookView(data))) }
        if (m === 'DELETE') { await admin.from('scheduling_webhooks').delete().eq('id', byNum.id); return reply(ok(webhookView(byNum))) }
      }
      return err(405, 'GET, POST, PATCH or DELETE.')
    }
    return err(404, 'No such route.')
  } catch (e) {
    console.error('scheduling-api', e)
    return err(500, String((e as any)?.message ?? e))
  }
})

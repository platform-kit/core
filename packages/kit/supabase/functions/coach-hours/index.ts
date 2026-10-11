/*
 * A host's own hours (the Coaching tab's *Your hours*), behind the JWT: `get` — the hours and the
 * exceptions; `set { hours }` — the week, the zone, the breathing room, the notice, the cap, checked
 * here in one place (a range's from before its to, at most four a day, a zone the runtime knows);
 * `override { day, ranges | null, note? }` — a day off (null) or a day's ranges instead of the
 * week's; `unoverride { day }`. Only an account that gives appointments (an administrator today)
 * may set hours, and only their own — a reader is refused, and nothing here reads another host's.
 */
import { admin, json, preflight, getUser } from '../_shared/lib.ts'
import { rolesOf, isProvider } from '../_shared/roles.ts'

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const ZONES = new Set((Intl as any).supportedValuesOf ? (Intl as any).supportedValuesOf('timeZone') : [])
const cleanRanges = (v: unknown): [string, string][] | null => {
  if (!Array.isArray(v)) return null
  const out: [string, string][] = []
  for (const r of v.slice(0, 4)) { if (!Array.isArray(r) || r.length !== 2 || !HHMM.test(String(r[0])) || !HHMM.test(String(r[1])) || String(r[0]) >= String(r[1])) return null; out.push([String(r[0]), String(r[1])]) }
  return out
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const user = await getUser(req)
  if (!user) return json({ error: 'sign in first' }, 401)
  if (!isProvider(await rolesOf(user.id))) return json({ error: 'hours are a host\'s own', code: 'not-host' }, 403)
  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const action = String(body?.action ?? 'get')
  /* WHICH SET OF HOURS this call is about. A host keeps any number; one is theirs by default, and a
     call that names none means that one — which is what every call meant before there was more than
     one, so nothing that already worked has to say anything new. */
  const setOf = async (id?: unknown) => {
    const { data } = await admin.from('provider_schedules').select('*').eq('user_id', user.id)
    const all = data || []
    if (id) return all.find((s: any) => s.id === String(id)) ?? null
    return all.find((s: any) => s.is_default) ?? all[0] ?? null
  }
  const read = async () => {
    const { data: sets } = await admin.from('provider_schedules')
      .select('id, name, is_default, timezone, weekly, buffer_before, buffer_after, notice_hours, max_per_day, max_per_week, updated_at')
      .eq('user_id', user.id).order('is_default', { ascending: false }).order('name')
    const { data: overrides } = await admin.from('provider_overrides').select('id, day, ranges, note, schedule_id').eq('user_id', user.id).order('day')
    const all = sets ?? []
    const dflt = all.find((s: any) => s.is_default) ?? all[0] ?? null
    /* `hours` is the default set, as it always was: a surface that has not learned about several
       still reads the one it used to */
    return { schedules: all, hours: dflt, overrides: overrides ?? [] }
  }
  if (action === 'get') return json(await read())
  if (action === 'set') {
    const h = body?.hours ?? {}
    const timezone = String(h.timezone ?? 'UTC')
    if (ZONES.size && !ZONES.has(timezone)) return json({ error: 'unknown time zone', code: 'zone' }, 400)
    const weekly: Record<string, [string, string][]> = {}
    for (const [k, v] of Object.entries(h.weekly ?? {})) {
      if (!/^[1-7]$/.test(k)) return json({ error: 'a weekday is 1 to 7', code: 'weekday' }, 400)
      const r = cleanRanges(v); if (r === null) return json({ error: 'a range is from before to, HH:MM, at most four a day', code: 'range' }, 400)
      if (r.length) weekly[k] = r
    }
    const num = (v: unknown, d: number, max: number) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? Math.min(max, Math.floor(x)) : d }
    const name = String(h.name ?? '').trim().slice(0, 60) || 'Working hours'
    const mine = await setOf(body?.schedule)
    const row: Record<string, unknown> = {
      user_id: user.id, name, timezone, weekly,
      buffer_before: num(h.buffer_before ?? h.buffer_min, 0, 240),
      buffer_after: num(h.buffer_after ?? h.buffer_min, 0, 240),
      notice_hours: num(h.notice_hours, 24, 24 * 30),
      max_per_day: num(h.max_per_day, 0, 48), max_per_week: num(h.max_per_week, 0, 200),
      updated_at: new Date().toISOString(),
    }
    /* the first set a person writes is their default; after that, being the default is its own act */
    if (mine) row.id = mine.id
    else row.is_default = !(await setOf())
    const { error } = await admin.from('provider_schedules').upsert(row, { onConflict: 'id' })
    if (error) return json({ error: /provider_schedules_user_name_key/.test(error.message) ? 'you already keep a set of hours called that' : error.message }, error.message.includes('user_name_key') ? 400 : 500)
    return json(await read())
  }
  /* MARKING ONE THE DEFAULT unmarks the last, in one act — the database holds "exactly one", so two
     writes would refuse each other */
  if (action === 'default') {
    const mine = await setOf(body?.schedule)
    if (!mine) return json({ error: 'no such set of hours', code: 'unknown' }, 404)
    const { error } = await admin.rpc('provider_schedule_default', { p_id: mine.id })
    if (error) return json({ error: error.message }, 500)
    return json(await read())
  }
  /* A SET CAN GO, unless it is the only one: a host with none is offered by no native type, and
     deleting your way to that by accident is not a thing anybody means to do. */
  if (action === 'forget') {
    const mine = await setOf(body?.schedule)
    if (!mine) return json({ error: 'no such set of hours', code: 'unknown' }, 404)
    const { count } = await admin.from('provider_schedules').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
    if ((count || 0) < 2) return json({ error: 'this is the only set of hours you keep', code: 'last' }, 400)
    await admin.from('provider_overrides').delete().eq('schedule_id', mine.id)
    await admin.from('provider_schedules').delete().eq('id', mine.id)
    if (mine.is_default) { const next = await setOf(); if (next) await admin.rpc('provider_schedule_default', { p_id: next.id }) }
    return json(await read())
  }
  if (action === 'override' || action === 'unoverride') {
    const day = String(body?.day ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: 'a day (YYYY-MM-DD)', code: 'day' }, 400)
    const mine = await setOf(body?.schedule)
    if (action === 'unoverride') { await admin.from('provider_overrides').delete().eq('user_id', user.id).eq('day', day).eq('schedule_id', mine ? mine.id : null); return json(await read()) }
    const ranges = body?.ranges === null || body?.ranges === undefined ? null : cleanRanges(body.ranges)
    if (body?.ranges != null && ranges === null) return json({ error: 'a range is from before to, HH:MM, at most four a day', code: 'range' }, 400)
    const note = typeof body?.note === 'string' ? body.note.slice(0, 200) : null
    const { error } = await admin.from('provider_overrides').upsert({ user_id: user.id, day, ranges, note, schedule_id: mine ? mine.id : null }, { onConflict: 'user_id,day,schedule_id' })
    if (error) return json({ error: error.message }, 500)
    return json(await read())
  }
  return json({ error: 'unknown action' }, 400)
})

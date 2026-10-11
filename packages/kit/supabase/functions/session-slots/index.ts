/*
 * POST { event, from, to, timeZone, host?, minutes?, count? } → { slots: { 'YYYY-MM-DD': [iso…] }, minutes }
 * — the open times of a booking type between two days, as the reader's zone sees
 * them, from whoever schedules the type (the site's own calendar: the hosts' hours
 * less their bookings; cal.com: its API, the key staying here). A visitor may read
 * availability only for a public type (`anyone` or `guest`); other types require a
 * signed-in reader who may book them. The response contains no booking records.
 *
 * `host` narrows a type given by several to ONE of them — which is what a host booking for somebody
 * needs, since the ordinary answer is the union and a time somebody else keeps is no use to them.
 * Only a host may ask it; a reader asking is ignored rather than refused, because it changes nothing
 * they are entitled to see.
 */
import { json, preflight, getUser } from '../_shared/lib.ts'
import { rolesOf, isProvider } from '../_shared/roles.ts'
import { typeFor, sessionOf, tiersOf, forRank, schedulerOf, schedulerIdOf } from '../_shared/cal.ts'
import { fresh } from '../_shared/compiled.ts'   /* the compiled artefacts, re-read within a few seconds of a publish */

Deno.serve(async (req) => {
  await fresh()
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const user = await getUser(req)
  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const s = await typeFor(String(body?.event ?? ''))
  if (!s) return json({ error: 'unknown session' }, 404)
  const provider = user ? isProvider(await rolesOf(user.id)) : false
  if (!user) {
    const declared = await sessionOf(String(body?.event ?? ''))
    if (!declared || body?.host || !forRank(declared, 0, false, [])) return json({ error: 'sign in first' }, 401)
  } else {
    /* a host (an administrator) reads any type's times — to book for people; a reader those their tier admits */
    if (!provider) { const { rank, tiers } = await tiersOf(user.id); if (!forRank(s, rank, true, tiers)) return json({ error: 'not yours to book', code: 'not-included' }, 403) }
  }
  const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  const from = day(body.from), to = day(body.to)
  if (!from || !to) return json({ error: 'from and to are days (YYYY-MM-DD)' }, 400)
  const timeZone = typeof body.timeZone === 'string' && body.timeZone ? body.timeZone : 'UTC'
  const host = provider && typeof body.host === 'string' && body.host ? body.host : null
  /* the length they are choosing, where the type offers several: a ninety-minute session fits in
     fewer places than an hour, and showing the hour's times would offer what cannot be booked */
  const minutes = Number(body.minutes) > 0 ? Math.round(Number(body.minutes)) : 0
  /* how many sessions of a run they are asking for: a run is only offered where all of it fits */
  const count = Number(body.count) > 0 ? Math.round(Number(body.count)) : 0
  try { const r = await (schedulerOf(s) as any).slots(s, from, to, timeZone, host, minutes, count); return json({ ...r, scheduler: schedulerIdOf(s), where: s.where ?? null, notice: s.notice ?? 0 }) }
  catch (e) { return json({ error: `${schedulerIdOf(s)}: ${(e as any)?.message ?? e}` }, 502) }
})

/*
 * THE APPLICATIONS QUEUE (openspec: applications-and-intro-calls).
 *
 * POST { op: 'list', status? } → { items: [...] }: the admissions a reviewer may see, newest first, each with the
 * applicant, the form's answers and the call when one was booked. An administrator sees every offer's; the host of
 * an offer's call sees that offer's alone.
 * POST { op: 'decide', id, act: 'approve' | 'decline' | 'close' | 'reopen', note? } → { admission }: moves one along
 * its paths (47-admissions.sql) and emails the applicant (_shared/admissions.ts).
 * POST { op: 'not-a-fit', booking, note? }: the host of an offer's required call closes the admission that call is on.
 */
import { admin, json, preflight, getUser } from '../_shared/lib.ts'
import { offer } from '../_shared/offers.ts'
import { mayReview, decide } from '../_shared/admissions.ts'

const ACTS = ['approve', 'decline', 'close', 'reopen']

Deno.serve(async (req: Request) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const user = await getUser(req)
  if (!user) return json({ error: 'sign in' }, 401)
  let body: any = {}
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }

  if (body.op === 'decide') {
    const id = String(body.id ?? ''), act = String(body.act ?? '')
    if (!ACTS.includes(act)) return json({ error: 'act is approve, decline, close or reopen' }, 400)
    const { data: a } = await admin.from('admissions').select('sku').eq('id', id).maybeSingle()
    if (!a) return json({ error: 'no such application' }, 404)
    if (!(await mayReview(user.id, a.sku))) return json({ error: 'not yours to review' }, 403)
    const out = await decide(id, act as any, user.id, String(body.note ?? '').slice(0, 2000))
    if ((out as any).error) return json({ error: (out as any).error }, 409)
    return json(out)
  }

  /* the host of an offer's required call says the person is not a fit: their admission closes, and they are told */
  if (body.op === 'not-a-fit') {
    const { data: a } = await admin.from('admissions').select('id, sku, status').eq('booking_id', String(body.booking ?? '')).maybeSingle()
    if (!a) return json({ error: 'this booking is not the call before an offer' }, 404)
    if (!(await mayReview(user.id, a.sku))) return json({ error: 'not yours to decide' }, 403)
    const out = await decide(a.id, a.status === 'open' ? 'close' : 'decline', user.id, String(body.note ?? '').slice(0, 2000))
    if ((out as any).error) return json({ error: (out as any).error }, 409)
    return json(out)
  }

  if (body.op !== 'list') return json({ error: 'unknown op' }, 400)
  const { data: rows, error } = await admin.from('admissions').select('*').order('created_at', { ascending: false }).limit(500)
  if (error) return json({ error: error.message }, 500)
  const mine: any[] = []
  const may: Record<string, boolean> = {}
  for (const r of rows ?? []) {
    if (!(r.sku in may)) may[r.sku] = await mayReview(user.id, r.sku)
    if (may[r.sku]) mine.push(r)
  }
  if (!mine.length && !Object.values(may).some(Boolean)) {
    /* nobody to review for, and not an administrator: say so rather than show an empty queue as if it were theirs */
    const { data: p } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (p?.role !== 'admin') return json({ error: 'not a reviewer' }, 403)
  }
  const users = [...new Set(mine.map((r) => r.user_id))]
  const responses = mine.map((r) => r.response_id).filter(Boolean)
  const bookings = mine.map((r) => r.booking_id).filter(Boolean)
  const [{ data: people }, { data: answers }, { data: calls }] = await Promise.all([
    users.length ? admin.from('profiles').select('id, email, display_name').in('id', users) : Promise.resolve({ data: [] }),
    responses.length ? admin.from('form_answers').select('response_id, field, value').in('response_id', responses) : Promise.resolve({ data: [] }),
    bookings.length ? admin.from('bookings').select('uid, start_at, status').in('uid', bookings) : Promise.resolve({ data: [] }),
  ] as any)
  const live = (r: any) => (r.status === 'open' && r.open_until && new Date(r.open_until) <= new Date() ? 'expired' : r.status)
  const items = mine.map((r) => ({
    id: r.id, sku: r.sku, offer: String((offer(r.sku) as any)?.title || r.sku), status: live(r), note: r.note,
    created_at: r.created_at, decided_at: r.decided_at, open_until: r.open_until,
    person: (people ?? []).find((p: any) => p.id === r.user_id) ?? { id: r.user_id },
    answers: (answers ?? []).filter((a: any) => a.response_id === r.response_id).map((a: any) => ({ field: a.field, value: a.value })),
    call: (calls ?? []).find((b: any) => b.uid === r.booking_id) ?? null,
  })).filter((x) => !body.status || x.status === body.status)
  return json({ items })
})

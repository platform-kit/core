/*
 * A course's emails (openspec: courses): "a new lesson is open", once per lesson, and "you finished", once per course.
 *
 * The database decides what is owed (course_notices_due): which lessons have opened since somebody enrolled, who has
 * already been told, and the one-a-day limit on lesson emails to one person. The notice is written BEFORE the send, so
 * a rerun never repeats one and a relay that refuses loses the email rather than sending it twice — the trade the
 * event and session reminders make. One lesson email per person per run, across every course they are taking.
 *
 * pg_cron asks every fifteen minutes with the service bearer (`{ action: 'send' }`; `dry: true` lists what would go
 * without sending or writing anything).
 */
import { admin, json, preflight } from '../_shared/lib.ts'
import { sendEmail } from '../_shared/email.ts'

const APP = () => (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!bearer || bearer !== (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')) return json({ error: 'the service bearer' }, 401)

  let body: any = {}
  try { body = await req.json() } catch { /* none */ }
  const { data: due, error } = await admin.rpc('course_notices_due', { p_late_hours: 48 })
  if (error) return json({ error: error.message }, 500)
  const rows = (due ?? []) as any[]
  if (body.dry) return json({ due: rows.length, notices: rows.map((r) => ({ to: r.email, course: r.course, lesson: r.lesson })) })

  let sent = 0
  const failed: string[] = []
  const told = new Set<string>()
  for (const r of rows) {
    const lessonEmail = r.lesson !== '*complete'
    if (lessonEmail && told.has(r.user_id)) continue        /* one lesson email to a person per run */
    /* written first: a relay that refuses loses this one rather than sending it twice */
    const { error: e1 } = await admin.from('course_notices').insert({ enrollment: r.enrollment, lesson: r.lesson })
    if (e1) continue                                          /* somebody else's run got there */
    if (lessonEmail) told.add(r.user_id)
    const course = `${APP()}/courses/${r.course}`
    try {
      const ok = lessonEmail
        ? await sendEmail(r.email, 'course-lesson', { name: r.name, course: r.course_title, lesson: r.lesson_title, url: `${course}/${r.lesson}` })
        : await sendEmail(r.email, 'course-complete', { name: r.name, course: r.course_title, url: course, certificate: r.certificate_id ? `${APP()}/certificates/${r.certificate_id}` : '' })
      if (ok) sent++
    } catch (e) { failed.push(String((e as Error).message || e).slice(0, 120)) }
  }
  return json({ sent, due: rows.length, failed })
})

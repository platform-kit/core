/*
 * COURSES AGAINST THE STACK (openspec: courses). The database decides everything a reader meets: who gets in (free, a
 * purchase, a tier), what is open and why not (released over time, in order), that a closed lesson's text is never
 * sent, what finishes a lesson (marked, a form answered, a session booked), the course completing with its event and
 * certificate, an enrolment that survives a refund and resumes on a second purchase, the emails owed (once per lesson,
 * one a day), the member card and the staff's view behind their rules, a space filled by a course's people, and a
 * course whose file has gone unpublished rather than deleted.
 *
 * It makes its own courses (slugs starting courses-db-) through the push's own projection, and removes them after.
 */
import { createClient } from '@supabase/supabase-js'
import { requireStack, moduleOn, notHere } from './test-stack.mjs'
import { projectCourses, parseCourse } from './courses-io.mjs'

const S = requireStack('courses-db')
if (!(await moduleOn('courses'))) { notHere('courses-db', 'the courses module is off'); process.exit(0) }
let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300) : '')) } }
const O = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(S.api, S.service, O)
const anon = createClient(S.api, S.anon, O)
const as = async (email) => { const c = createClient(S.api, S.anon, O); const { error } = await c.auth.signInWithPassword({ email, password: 'password123' }); return error ? null : c }
const idOf = async (email) => (await service.from('profiles').select('id').eq('email', email).maybeSingle()).data?.id
const call = async (who, fn, args) => { const { data, error } = await who.rpc(fn, args); if (error) throw new Error(`${fn}: ${error.message}`); return data }

const member = await as('member@example.com'), buyer = await as('buyer@example.com'), admin = await as('admin@example.com'), other = await as('member2@example.com')
if (!member || !buyer || !admin || !other) { console.log('courses-db: the seed\'s member@, buyer@, member2@ or admin@ does not sign in'); process.exit(1) }
const memberId = await idOf('member@example.com'), buyerId = await idOf('buyer@example.com')
const STAMP = Date.now().toString(36)
const FREE = `courses-db-free-${STAMP}`, SOLD = `courses-db-sold-${STAMP}`, SKU = `courses-db-sku-${STAMP}`
const file = (fm, body = '') => `---\n${fm}\n---\n${body}`
const courses = [
  parseCourse(FREE, file(`title: Free one
access: { free: true }
release: drip
every: 2
inOrder: true
certificate: true
lessons:
  - { key: a, title: Lesson A }
  - { key: b, title: Lesson B }
  - { key: c, title: Lesson C, kind: form, ref: courses-db-form-${STAMP} }
  - { key: d, title: Lesson D, kind: session, ref: courses-db-type-${STAMP}, required: false }`, '## a\n\nThe words of A.\n\n## b\n\nThe words of B.\n')),
  parseCourse(SOLD, file(`title: Sold one
access: { skus: [${SKU}] }
lessons:
  - { key: one, title: One }
  - { key: two, title: Two }
  - { key: three, title: Three }`, '## one\n\nOne.\n\n## two\n\nTwo.\n\n## three\n\nThree.\n')),
]
const purchases = []
const backdate = (course, user, days) => service.from('enrollments').update({ started_at: new Date(Date.now() - days * 86400000).toISOString() }).eq('course', course).eq('user_id', user)

try {
  const pushed = await projectCourses({ courses, db: service })
  ok('the declaration is projected', pushed.courses === 2 && !pushed.refused.length, pushed)

  /* who gets in, and the outline anybody may read */
  const guest = await call(anon, 'course_state', { p_course: FREE })
  ok('a guest reads the outline, titles only', guest && guest.lessons.length === 4 && guest.lessons.every((l) => !('body' in l)) && guest.access === false)
  ok('…and is told to sign in', guest.lessons[0].why === 'sign-in')
  const closedForGuest = await call(anon, 'course_lesson', { p_course: FREE, p_lesson: 'a' })
  ok('a guest is sent no lesson text', closedForGuest.open === false && !('body' in closedForGuest))
  const before = await call(member, 'course_lesson', { p_course: FREE, p_lesson: 'a' })
  ok('signed in but not started: told to start, sent nothing', before.why === 'not-enrolled' && !('body' in before))
  const started = await call(member, 'course_enroll', { p_course: FREE })
  ok('a free course: starting it enrolls', started && started.enrollment && started.access === true)

  /* released over time, in order */
  const a = await call(member, 'course_lesson', { p_course: FREE, p_lesson: 'a' })
  ok('the first lesson is open and sent', a.open === true && a.body === 'The words of A.')
  const b = await call(member, 'course_lesson', { p_course: FREE, p_lesson: 'b' })
  ok('a lesson not yet released says when, and sends nothing', b.open === false && b.why === 'not-yet' && b.opens_at && !('body' in b), b)
  ok('it cannot be finished before it opens', (await call(member, 'course_complete', { p_course: FREE, p_lesson: 'b' })).error === 'not-yet')
  await backdate(FREE, memberId, 3)
  const inOrder = await call(member, 'course_lesson', { p_course: FREE, p_lesson: 'b' })
  ok('released, but the lesson before is not finished: in order', inOrder.open === false && inOrder.why === 'in-order', inOrder)
  const afterA = await call(member, 'course_complete', { p_course: FREE, p_lesson: 'a' })
  ok('marking a lesson complete counts it', afterA.done === 1 && afterA.lessons[0].done === true)
  ok('…and opens the next', (await call(member, 'course_lesson', { p_course: FREE, p_lesson: 'b' })).body === 'The words of B.')
  await call(member, 'course_complete', { p_course: FREE, p_lesson: 'b' })

  /* a form, and a session: the server checks */
  await backdate(FREE, memberId, 7)
  ok('a form lesson is not finished until the form is answered', (await call(member, 'course_complete', { p_course: FREE, p_lesson: 'c' })).error === 'form-not-finished')
  const { data: resp } = await service.from('form_responses').insert({ form: `courses-db-form-${STAMP}`, user_id: memberId, completed_at: new Date().toISOString(), passed: false }).select('id').single()
  ok('a scored form not passed does not finish it', (await call(member, 'course_complete', { p_course: FREE, p_lesson: 'c' })).error === 'form-not-finished')
  await service.from('form_responses').update({ passed: true }).eq('id', resp.id)
  const done = await call(member, 'course_complete', { p_course: FREE, p_lesson: 'c' })
  ok('every required lesson finished: the course is complete (the optional session not needed)', done.enrollment && done.enrollment.completed_at && done.done === done.total, done)
  ok('…with a certificate', !!done.certificate_id)
  ok('a session lesson is not finished until one is booked', (await call(member, 'course_complete', { p_course: FREE, p_lesson: 'd' })).error === 'not-booked')
  const cert = await call(anon, 'certificate_public', { p_id: done.certificate_id })
  ok('anybody holding the certificate\'s address can check it', cert && cert.course === 'Free one' && cert.slug === FREE && !!cert.name)
  ok('a made-up address is no certificate', (await call(anon, 'certificate_public', { p_id: 'nothing-here' })) === null)
  const { count: events } = await service.from('events').select('*', { count: 'exact', head: true }).eq('type', 'course_completed').eq('user_id', memberId).contains('props', { course: FREE })
  ok('finishing is an event, for a site\'s achievement rule', events === 1, events)
  const { data: rule } = await service.from('achievements').select('slug').eq('event', 'course_completed').limit(1).maybeSingle()
  if (rule) {
    const { data: won } = await service.from('user_achievements').select('slug').eq('user_id', memberId).eq('slug', rule.slug).maybeSingle()
    ok('…and a site\'s rule on it awards its achievement', !!won)
  }
  await service.from('form_responses').delete().eq('id', resp.id)

  /* a purchase gets somebody in on the way, a refund closes it, a second purchase resumes it */
  const buy = async () => { const { data } = await service.from('purchases').insert({ user_id: buyerId, email: 'buyer@example.com', sku: SKU, status: 'paid', checkout_identity: `cs_courses_db_${STAMP}_${purchases.length}`, amount_total: 100, currency: 'usd' }).select('id').single(); purchases.push(data.id); return data.id }
  const first = await buy()
  const auto = await call(buyer, 'course_state', { p_course: SOLD })
  ok('buying a course enrolls the buyer on the way in', auto.access === true && !!auto.enrollment, auto)
  for (const k of ['one', 'two']) await call(buyer, 'course_complete', { p_course: SOLD, p_lesson: k })
  await service.from('purchases').update({ status: 'refunded' }).eq('id', first)
  const refunded = await call(buyer, 'course_lesson', { p_course: SOLD, p_lesson: 'three' })
  ok('refunded: the lessons close, and nothing is sent', refunded.open === false && refunded.why === 'no-access' && !('body' in refunded), refunded)
  ok('…while the enrolment and its progress are kept', (await call(buyer, 'course_state', { p_course: SOLD })).done === 2)
  await buy()
  const back = await call(buyer, 'course_state', { p_course: SOLD })
  ok('bought again: the same enrolment reopens, two lessons still done', back.access === true && back.done === 2 && back.lessons[2].open === true, back)
  ok('a course nobody gave them is refused, not enrolled', (await call(other, 'course_enroll', { p_course: SOLD })).error === 'no-access')

  /* the emails owed: a drip lesson that opened after somebody started, once, and a course finished, once */
  const due = (await service.rpc('course_notices_due', { p_late_hours: 24 * 30 })).data || []
  ok('a finished course is owed its email', due.some((r) => r.course === FREE && r.lesson === '*complete' && r.user_id === memberId), due)
  const lessonDue = due.filter((r) => r.user_id === memberId && r.course === FREE && r.lesson !== '*complete')
  ok('a finished course owes no lesson emails', lessonDue.length === 0, lessonDue)
  await call(other, 'course_enroll', { p_course: FREE })
  await call(other, 'course_complete', { p_course: FREE, p_lesson: 'a' })
  await backdate(FREE, await idOf('member2@example.com'), 3)
  const owed = ((await service.rpc('course_notices_due', { p_late_hours: 24 * 30 })).data || []).filter((r) => r.course === FREE && r.lesson !== '*complete' && r.email === 'member2@example.com')
  ok('a lesson released after somebody started is owed, the earliest first, one at a time', owed.length === 1 && owed[0].lesson === 'b', owed)
  const { data: e2 } = await service.from('enrollments').select('id').eq('course', FREE).eq('user_id', await idOf('member2@example.com')).single()
  await service.from('course_notices').insert({ enrollment: e2.id, lesson: 'b' })
  await call(other, 'course_complete', { p_course: FREE, p_lesson: 'b' })
  await backdate(FREE, await idOf('member2@example.com'), 5)
  const sameDay = ((await service.rpc('course_notices_due', { p_late_hours: 24 * 30 })).data || []).filter((r) => r.email === 'member2@example.com' && r.lesson !== '*complete')
  ok('one lesson email a day: the next waits for tomorrow', sameDay.length === 0, sameDay)
  await service.from('course_notices').update({ sent_at: new Date(Date.now() - 86400000).toISOString() }).eq('enrollment', e2.id)
  const nextDay = ((await service.rpc('course_notices_due', { p_late_hours: 24 * 30 })).data || []).filter((r) => r.email === 'member2@example.com' && r.lesson !== '*complete')
  ok('…and never the same lesson twice', nextDay.length === 1 && nextDay[0].lesson === 'c', nextDay)
  const fn = await fetch(`${S.functions}/course-notify`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${S.anon}` }, body: JSON.stringify({ action: 'send', dry: true }) })
  ok('course-notify answers only the service', fn.status === 401, fn.status)

  /* the member card, the staff's view */
  ok('a person sees their own courses on their card', (await call(member, 'member_courses', { p_user: memberId })).some((c) => c.slug === FREE && c.completed_at))
  ok('staff see anybody\'s', (await call(admin, 'member_courses', { p_user: memberId })).some((c) => c.slug === FREE))
  ok('anybody else sees nothing to show', (await call(other, 'member_courses', { p_user: memberId })).length === 0)
  const view = await call(admin, 'admin_course_enrollments', { p_course: FREE })
  ok('staff see who is where in a course', view.enrolled === 2 && view.completed === 1 && view.people.length === 2, view)
  ok('…and the lesson where most of the unfinished have stopped', view.stuck && view.stuck.lesson === 'c', view.stuck)
  ok('a member is refused the staff\'s view', (await call(member, 'admin_course_enrollments', { p_course: FREE })).error === 'not-allowed')
  ok('a reader cannot read anybody else\'s enrolment rows', ((await member.from('enrollments').select('user_id').eq('course', SOLD)).data || []).length === 0)

  /* a space filled by a course's people */
  ok('a space\'s rule matches somebody enrolled in the course', (await service.rpc('space_fill_matches', { p_user: memberId, p_fill: { course: FREE } })).data === true)
  ok('…and not somebody who is not', (await service.rpc('space_fill_matches', { p_user: buyerId, p_fill: { course: FREE } })).data === false)
  ok('…nor somebody outside the cohort the rule names', (await service.rpc('space_fill_matches', { p_user: memberId, p_fill: { course: FREE, cohort: 'spring' } })).data === false)

  /* a course whose file has gone */
  await projectCourses({ courses: [courses[1]], db: service })
  ok('a course whose file has gone is unpublished, not deleted', (await call(member, 'course_state', { p_course: FREE })) === null)
  const { count: kept } = await service.from('enrollments').select('*', { count: 'exact', head: true }).eq('course', FREE)
  ok('…and its enrolments and certificates are kept', kept === 2, kept)
} finally {
  for (const id of purchases) await service.from('purchases').delete().eq('id', id)
  await service.from('events').delete().eq('type', 'course_completed').contains('props', { course: FREE })
  await service.from('courses').delete().in('slug', [FREE, SOLD])
}

console.log(fail ? `courses-db: ${fail} failed, ${pass} passed` : `courses-db: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)

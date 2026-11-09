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
import type { Database } from '../supabase/functions/_shared/database.types.js'

const S: any = requireStack('courses-db')
if (!(await moduleOn('courses'))) { notHere('courses-db', 'the courses module is off'); process.exit(0) }
let pass = 0, fail = 0
const ok = (msg: string, cond: boolean|null, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300) : '')) } }
const O = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient<Database>(S.api, S.service, O)
const anon = createClient<Database>(S.api, S.anon, O)
const as = async (email: string) => { const c = createClient<Database>(S.api, S.anon, O); const { error } = await c.auth.signInWithPassword({ email, password: 'password123' }); return error ? null : c }
const idOf = async (email: string) => (await service.from('profiles').select('id').eq('email', email).maybeSingle()).data?.id
const call = async (who: any, fn: string, args?: { p_course?: string; p_lesson?: string; p_id?: any; p_user?: string|undefined }|undefined) => { const { data, error } = await who.rpc(fn, args); if (error) throw new Error(`${fn}: ${error.message}`); return data }

const member = await as('member@example.com'), buyer = await as('buyer@example.com'), admin = await as('admin@example.com'), other = await as('member2@example.com')
if (!member || !buyer || !admin || !other) { console.log('courses-db: the seed\'s member@, buyer@, member2@ or admin@ does not sign in'); process.exit(1) }
const memberId = await idOf('member@example.com'), buyerId = await idOf('buyer@example.com')
const STAMP = Date.now().toString(36)
const FREE = `courses-db-free-${STAMP}`, SOLD = `courses-db-sold-${STAMP}`, SKU = `courses-db-sku-${STAMP}`
const file = (fm: string, body = '') => `---\n${fm}\n---\n${body}`
const courses = [
  parseCourse(FREE, file(`title: Free one
access: { free: true }
release: drip
every: 2
inOrder: true
certificate: true
lessons:
  - { key: a, title: Lesson A, media: { type: video, src: /courses-db/a.mp4 } }
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
const purchases: any = []
const backdate = (course: string, user: any, days: number) => service.from('enrollments').update({ started_at: new Date(Date.now() - days * 86400000).toISOString() }).eq('course', course).eq('user_id', user)

try {
  const pushed = await projectCourses({ courses, db: service })
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ courses: number; lessons: number; unpublished: number; refused: string[]; }' is not assignable to parameter of type 'str
  ok('the declaration is projected', pushed.courses === 2 && !pushed.refused.length, pushed)

  /* who gets in, and the outline anybody may read */
  const guest = await call(anon, 'course_state', { p_course: FREE })
  ok('a guest reads the outline, titles only', guest && guest.lessons.length === 4 && guest.lessons.every((l: any) => !('body' in l)) && guest.access === false)
  ok('…with what each lesson carries, and never where it is', JSON.stringify(guest.lessons[0].has) === '["video"]' && !JSON.stringify(guest.lessons).includes('a.mp4'), guest.lessons[0])
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
  /* A QUIZ FINISHES ITS OWN LESSON: the response completing is what records it, never a button */
  const attempt = async (score: number, passed: boolean) => (await service.from('form_responses').insert({ form: `courses-db-form-${STAMP}`, user_id: memberId, completed_at: new Date().toISOString(), score, total: 5, passed }).select('id').single()).data!.id
  /* EVERY QUIZ PASSED EARNS ITS ACHIEVEMENT: the rule the achievements push declares for it, made here the same way */
  const awards = await moduleOn('achievements')
  const AWARD = `quiz-${FREE}-c`
  if (awards) await service.from('achievements').insert({ slug: AWARD, title: 'Passed C', event: 'quiz_passed', match: { course: FREE, lesson: 'c' } })
  // @ts-expect-error TS2345, from the conversion: Argument of type 'string | undefined' is not assignable to parameter of type 'string'. Type 'undefined' is not assignable to type 'string'.
  const passes = async () => (await service.from('events').select('*', { count: 'exact', head: true }).eq('type', 'quiz_passed').eq('user_id', memberId).contains('props', { course: FREE, lesson: 'c' })).count
  const tries = [await attempt(2, false)]
  const failed = await call(member, 'course_state', { p_course: FREE })
  ok('a scored form not passed does not finish it', failed.lessons[2].done === false && (await call(member, 'course_complete', { p_course: FREE, p_lesson: 'c' })).error === 'form-not-finished')
  ok('…and the course shows the score', failed.lessons[2].quiz && failed.lessons[2].quiz.score === 2 && failed.lessons[2].quiz.total === 5 && failed.lessons[2].quiz.passed === false && failed.lessons[2].quiz.attempts === 1, failed.lessons[2].quiz)
  ok('a quiz not passed is no quiz passed', (await passes()) === 0)
  tries.push(await attempt(4, true))
  const done = await call(member, 'course_state', { p_course: FREE })
  // @ts-expect-error TS2345, from the conversion: Argument of type 'number | null' is not assignable to parameter of type 'string | undefined'. Type 'null' is not assignable to type 'string 
  ok('the first pass records a quiz_passed event', (await passes()) === 1, await passes())
  // @ts-expect-error TS2345, from the conversion: Argument of type 'string | undefined' is not assignable to parameter of type 'string'. Type 'undefined' is not assignable to type 'string'.
  if (awards) ok('…and earns that quiz’s achievement', !!(await service.from('user_achievements').select('slug').eq('user_id', memberId).eq('slug', AWARD).maybeSingle()).data)
  ok('passing the form finishes its lesson as the response completes', done.lessons[2].done === true)
  ok('…keeping the best attempt and counting them', done.lessons[2].quiz && done.lessons[2].quiz.score === 4 && done.lessons[2].quiz.passed === true && done.lessons[2].quiz.attempts === 2, done.lessons[2].quiz)
  tries.push(await attempt(1, false))
  ok('a worse attempt afterwards undoes nothing', (await call(member, 'course_state', { p_course: FREE })).lessons[2].done === true)
  tries.push(await attempt(5, true))
  // @ts-expect-error TS2345, from the conversion: Argument of type 'number | null' is not assignable to parameter of type 'string | undefined'. Type 'null' is not assignable to type 'string 
  ok('passing again records no second event', (await passes()) === 1, await passes())
  ok('every required lesson finished: the course is complete (the optional session not needed)', done.enrollment && done.enrollment.completed_at && done.done === done.total, done)
  const scores = (await call(admin, 'admin_course_enrollments', { p_course: FREE })).people.find((p: { email: string }) => p.email === 'member@example.com')
  ok('the staff see each person\'s best score and attempts', scores && scores.quizzes.length === 1 && scores.quizzes[0].lesson === 'c' && scores.quizzes[0].score === 5 && scores.quizzes[0].attempts === 4, scores && scores.quizzes)
  ok('…with a certificate', !!done.certificate_id)
  ok('a session lesson is not finished until one is booked', (await call(member, 'course_complete', { p_course: FREE, p_lesson: 'd' })).error === 'not-booked')
  const cert = await call(anon, 'certificate_public', { p_id: done.certificate_id })
  ok('anybody holding the certificate\'s address can check it', cert && cert.course === 'Free one' && cert.slug === FREE && !!cert.name)
  ok('a made-up address is no certificate', (await call(anon, 'certificate_public', { p_id: 'nothing-here' })) === null)
  // @ts-expect-error TS2345, from the conversion: Argument of type 'string | undefined' is not assignable to parameter of type 'string'. Type 'undefined' is not assignable to type 'string'.
  const { count: events } = await service.from('events').select('*', { count: 'exact', head: true }).eq('type', 'course_completed').eq('user_id', memberId).contains('props', { course: FREE })
  // @ts-expect-error TS2345, from the conversion: Argument of type 'number | null' is not assignable to parameter of type 'string | undefined'. Type 'null' is not assignable to type 'string 
  ok('finishing is an event, for a site\'s achievement rule', events === 1, events)
  const { data: rule } = await service.from('achievements').select('slug').eq('event', 'course_completed').limit(1).maybeSingle()
  if (rule) {
    // @ts-expect-error TS2345, from the conversion: Argument of type 'string | undefined' is not assignable to parameter of type 'string'. Type 'undefined' is not assignable to type 'string'.
    const { data: won } = await service.from('user_achievements').select('slug').eq('user_id', memberId).eq('slug', rule.slug).maybeSingle()
    ok('…and a site\'s rule on it awards its achievement', !!won)
  }
  await service.from('form_responses').delete().in('id', tries)
  // @ts-expect-error TS2345, from the conversion: Argument of type 'string | undefined' is not assignable to parameter of type 'string'. Type 'undefined' is not assignable to type 'string'.
  await service.from('events').delete().eq('type', 'quiz_passed').eq('user_id', memberId).contains('props', { course: FREE })
  if (awards) await service.from('achievements').delete().eq('slug', AWARD)

  /* a purchase gets somebody in on the way, a refund closes it, a second purchase resumes it */
  const buy = async () => { const { data } = await service.from('purchases').insert({ user_id: buyerId, email: 'buyer@example.com', sku: SKU, status: 'paid', checkout_identity: `cs_courses_db_${STAMP}_${purchases.length}`, amount_total: 100, currency: 'usd' }).select('id').single(); purchases.push((data as any).id); return (data as any).id }
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
  /* the library: where the reader is in each course, what is next, and what getting in takes */
  const shelf = await call(buyer, 'courses_list')
  const sold = shelf.find((c: { slug: string }) => c.slug === SOLD), free = shelf.find((c: { slug: string }) => c.slug === FREE)
  ok('the library names the next open lesson of a course in progress', sold && sold.enrolled && sold.next && sold.next.key === 'three' && sold.done === 2 && !!sold.last_at, sold)
  ok('…and, for a course they are not in, what getting in takes and no next lesson', free && !free.enrolled && free.free === true && free.next === null && free.sections === 1, free)
  const finished = (await call(member, 'courses_list')).find((c: { slug: string }) => c.slug === FREE)
  ok('a finished course carries its certificate and nothing next', finished && !!finished.completed_at && !!finished.certificate_id && finished.next === null, finished)
  ok('a guest has the catalogue, in nothing', (await call(anon, 'courses_list')).every((c: any) => !c.enrolled && c.access === false && c.next === null))
  ok('a course nobody gave them is refused, not enrolled', (await call(other, 'course_enroll', { p_course: SOLD })).error === 'no-access')

  /* the emails owed: a drip lesson that opened after somebody started, once, and a course finished, once */
  const due = (await service.rpc('course_notices_due', { p_late_hours: 24 * 30 })).data || []
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ certificate_id: string; course: string; course_title: string; email: string; enrollment: string; lesson: string; lesson_
  ok('a finished course is owed its email', due.some((r) => r.course === FREE && r.lesson === '*complete' && r.user_id === memberId), due)
  const lessonDue = due.filter((r) => r.user_id === memberId && r.course === FREE && r.lesson !== '*complete')
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ certificate_id: string; course: string; course_title: string; email: string; enrollment: string; lesson: string; lesson_
  ok('a finished course owes no lesson emails', lessonDue.length === 0, lessonDue)
  await call(other, 'course_enroll', { p_course: FREE })
  await call(other, 'course_complete', { p_course: FREE, p_lesson: 'a' })
  await backdate(FREE, await idOf('member2@example.com'), 3)
  const owed = ((await service.rpc('course_notices_due', { p_late_hours: 24 * 30 })).data || []).filter((r) => r.course === FREE && r.lesson !== '*complete' && r.email === 'member2@example.com')
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ certificate_id: string; course: string; course_title: string; email: string; enrollment: string; lesson: string; lesson_
  ok('a lesson released after somebody started is owed, the earliest first, one at a time', owed.length === 1 && owed[0].lesson === 'b', owed)
  // @ts-expect-error TS2345, from the conversion: Argument of type 'string | undefined' is not assignable to parameter of type 'string'. Type 'undefined' is not assignable to type 'string'.
  const { data: e2 } = await service.from('enrollments').select('id').eq('course', FREE).eq('user_id', await idOf('member2@example.com')).single()
  await service.from('course_notices').insert({ enrollment: (e2 as any).id, lesson: 'b' })
  await call(other, 'course_complete', { p_course: FREE, p_lesson: 'b' })
  await backdate(FREE, await idOf('member2@example.com'), 5)
  const sameDay = ((await service.rpc('course_notices_due', { p_late_hours: 24 * 30 })).data || []).filter((r) => r.email === 'member2@example.com' && r.lesson !== '*complete')
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ certificate_id: string; course: string; course_title: string; email: string; enrollment: string; lesson: string; lesson_
  ok('one lesson email a day: the next waits for tomorrow', sameDay.length === 0, sameDay)
  await service.from('course_notices').update({ sent_at: new Date(Date.now() - 86400000).toISOString() }).eq('enrollment', (e2 as any).id)
  const nextDay = ((await service.rpc('course_notices_due', { p_late_hours: 24 * 30 })).data || []).filter((r) => r.email === 'member2@example.com' && r.lesson !== '*complete')
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ certificate_id: string; course: string; course_title: string; email: string; enrollment: string; lesson: string; lesson_
  ok('…and never the same lesson twice', nextDay.length === 1 && nextDay[0].lesson === 'c', nextDay)
  const fn = await fetch(`${S.functions}/course-notify`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${S.anon}` }, body: JSON.stringify({ action: 'send', dry: true }) })
  // @ts-expect-error TS2345, from the conversion: Argument of type 'number' is not assignable to parameter of type 'string'.
  ok('course-notify answers only the service', fn.status === 401, fn.status)

  /* the member card, the staff's view */
  ok('a person sees their own courses on their card', (await call(member, 'member_courses', { p_user: memberId })).some((c: { slug: string; completed_at: any }) => c.slug === FREE && c.completed_at))
  ok('staff see anybody\'s', (await call(admin, 'member_courses', { p_user: memberId })).some((c: { slug: string }) => c.slug === FREE))
  ok('anybody else sees nothing to show', (await call(other, 'member_courses', { p_user: memberId })).length === 0)
  const view = await call(admin, 'admin_course_enrollments', { p_course: FREE })
  ok('staff see who is where in a course', view.enrolled === 2 && view.completed === 1 && view.people.length === 2, view)
  ok('…and the lesson where most of the unfinished have stopped', view.stuck && view.stuck.lesson === 'c', view.stuck)
  ok('a member is refused the staff\'s view', (await call(member, 'admin_course_enrollments', { p_course: FREE })).error === 'not-allowed')
  ok('a reader cannot read anybody else\'s enrolment rows', ((await member.from('enrollments').select('user_id').eq('course', SOLD)).data || []).length === 0)

  /* a space filled by a course's people */
  // @ts-expect-error TS2322, from the conversion: Type 'string | undefined' is not assignable to type 'string | null'. Type 'undefined' is not assignable to type 'string | null'.
  ok('a space\'s rule matches somebody enrolled in the course', (await service.rpc('space_fill_matches', { p_user: memberId, p_fill: { course: FREE } })).data === true)
  // @ts-expect-error TS2322, from the conversion: Type 'string | undefined' is not assignable to type 'string | null'. Type 'undefined' is not assignable to type 'string | null'.
  ok('…and not somebody who is not', (await service.rpc('space_fill_matches', { p_user: buyerId, p_fill: { course: FREE } })).data === false)
  // @ts-expect-error TS2322, from the conversion: Type 'string | undefined' is not assignable to type 'string | null'. Type 'undefined' is not assignable to type 'string | null'.
  ok('…nor somebody outside the cohort the rule names', (await service.rpc('space_fill_matches', { p_user: memberId, p_fill: { course: FREE, cohort: 'spring' } })).data === false)

  /* a lesson of a kind the site registers: written by the push, finished by the reader as a text lesson is */
  const OWN = `courses-db-own-${STAMP}`
  const own = parseCourse(OWN, file(`title: Own kind\naccess: { free: true }\nlessons:\n  - { key: rate, title: Rate it, kind: self-rating, ref: How sure are you? }`), { kinds: { 'self-rating': { check: null } } })
  const ownPush = await projectCourses({ courses: [...courses, own], db: service })
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ courses: number; lessons: number; unpublished: number; refused: string[]; }' is not assignable to parameter of type 'str
  ok('a course with a site kind\'s lesson is written', !ownPush.refused.length && (await service.from('course_lessons').select('kind').eq('course', OWN).single()).data?.kind === 'self-rating', ownPush)
  await call(member, 'course_enroll', { p_course: OWN })
  const ownDone = await call(member, 'course_complete', { p_course: OWN, p_lesson: 'rate' })
  ok('…the reader finishes it, and the course with it', ownDone.done === 1 && ownDone.lessons[0].done === true && !!ownDone.enrollment.completed_at, ownDone)
  const { data: ownRow } = await service.from('lesson_progress').select('how, enrollments!inner(course)').eq('enrollments.course', OWN).single()
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ how: string; enrollments: { course: string; }; } | null' is not assignable to parameter of type 'string | undefined'. Ty
  ok('…recorded as marked, as a text lesson is', ownRow && ownRow.how === 'marked', ownRow)
  const { error: oddKind } = await service.from('course_lessons').insert({ course: OWN, key: 'odd', position: 2, title: 'Odd', kind: 'Not a kind', ref: 'x' })
  // @ts-expect-error TS2345, from the conversion: Argument of type 'PostgrestError | null' is not assignable to parameter of type 'string | undefined'. Type 'null' is not assignable to type 
  ok('the database refuses a kind that is no kind\'s name', !!oddKind && /course_lessons_kind_check/.test(oddKind.message), oddKind)

  /* a course whose file has gone */
  await projectCourses({ courses: [courses[1]], db: service })
  ok('a course whose file has gone is unpublished, not deleted', (await call(member, 'course_state', { p_course: FREE })) === null)
  const { count: kept } = await service.from('enrollments').select('*', { count: 'exact', head: true }).eq('course', FREE)
  // @ts-expect-error TS2345, from the conversion: Argument of type 'number | null' is not assignable to parameter of type 'string | undefined'. Type 'null' is not assignable to type 'string 
  ok('…and its enrolments and certificates are kept', kept === 2, kept)
} finally {
  for (const id of purchases) await service.from('purchases').delete().eq('id', id)
  await service.from('events').delete().eq('type', 'course_completed').contains('props', { course: FREE })
  await service.from('courses').delete().in('slug', [FREE, SOLD, `courses-db-own-${STAMP}`])
}

console.log(fail ? `courses-db: ${fail} failed, ${pass} passed` : `courses-db: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)

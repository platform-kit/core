/*
 * A COURSE'S WORKBOOK AGAINST THE STACK (openspec: courses, forms-api). A text lesson's workbook form: the lesson waits
 * for it where its answers are required; the answers are private, so no administrator reads them as such; the reader
 * reads their workbook, shares it with a coach and withdraws it, and the coach reads it only in between. Where the site
 * has the demo's workbook form, the `form` function itself: an ordered list kept in order with its empty rows dropped,
 * and a workbook response reopened and revised rather than answered twice.
 *
 * It makes its own course (slug starting course-wb-) through the push's projection, and removes it and its rows after.
 */
import { createClient } from '@supabase/supabase-js'
import { requireStack, moduleOn, notHere } from './test-stack.mjs'
import { projectCourses, parseCourse } from './courses-io.mjs'
import type { Database } from '../supabase/functions/_shared/database.types.js'

const S: any = requireStack('course-workbook-db')
if (!(await moduleOn('courses')) || !(await moduleOn('forms'))) { notHere('course-workbook-db', 'the courses or the forms module is off'); process.exit(0) }
let pass = 0, fail = 0
const ok = (msg: string, cond: unknown, detail: unknown = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) : '')) } }
const O = { auth: { persistSession: false, autoRefreshToken: false } }
const service: any = createClient<Database>(S.api, S.service, O)
const as = async (email: string) => { const c = createClient<Database>(S.api, S.anon, O); const { error } = await c.auth.signInWithPassword({ email, password: 'password123' }); return error ? null : c as any }
const idOf = async (email: string) => (await service.from('profiles').select('id').eq('email', email).maybeSingle()).data?.id as string
const call = async (who: any, fn: string, args?: any) => { const { data, error } = await who.rpc(fn, args); if (error) throw new Error(`${fn}: ${error.message}`); return data }

const member = await as('member@example.com'), coach = await as('coach@example.com'), admin = await as('admin@example.com'), other = await as('member2@example.com')
if (!member || !coach || !admin || !other) { console.log('course-workbook-db: the seed\'s member@, coach@, member2@ or admin@ does not sign in'); process.exit(1) }
const memberId = await idOf('member@example.com'), coachId = await idOf('coach@example.com'), adminId = await idOf('admin@example.com')
const STAMP = Date.now().toString(36)
const COURSE = `course-wb-${STAMP}`, FORM = `course-wb-form-${STAMP}`, OPEN = `course-wb-open-${STAMP}`
const course = parseCourse(COURSE, `---
title: Workbook course
access: { free: true }
lessons:
  - { key: look, title: Look, section: Your circumstances, form: ${FORM}, answers: required }
  - { key: think, title: Think, section: Your circumstances, form: ${FORM}-2 }
  - { key: last, title: Last, section: After }
---

## look

Look.

## think

Think.

## last

Last.
`)
const made: string[] = []
try {
  ok('the course is well formed', !course.problems.length, course.problems.join('; '))
  await projectCourses({ courses: [course], db: service })

  /* ---- answers required: the lesson waits for its form ---- */
  await call(member, 'course_enroll', { p_course: COURSE })
  const early = await call(member, 'course_complete', { p_course: COURSE, p_lesson: 'look' })
  ok('a lesson whose answers are required waits for its form', early && early.error === 'answers-needed', early)
  const lesson = await call(member, 'course_lesson', { p_course: COURSE, p_lesson: 'look' })
  ok('the lesson names its form and that its answers are required', lesson.form === FORM && lesson.answers_required === true, lesson)
  const st = await call(member, 'course_state', { p_course: COURSE })
  ok('the course says it has a workbook, and which lessons carry forms', st.workbook === true && st.lessons[0].form === FORM && st.lessons[2].form === null, st)

  /* the reader's answers: a private response, as the function writes one for a workbook form */
  const resp = (await service.from('form_responses').insert({ form: FORM, user_id: memberId, private: true, completed_at: new Date().toISOString() }).select('id').single()).data!.id
  made.push(resp)
  await service.from('form_answers').insert([{ response_id: resp, field: 'going_well', value: ['my health', 'my work', 'my love life'] }, { response_id: resp, field: 'note', value: 'Plainly.' }])
  const done = await call(member, 'course_complete', { p_course: COURSE, p_lesson: 'look' })
  ok('once the form is finished, the lesson completes', done && !done.error && done.lessons.find((l: any) => l.key === 'look').done, done)
  const optional = await call(member, 'course_complete', { p_course: COURSE, p_lesson: 'think' })
  ok('a lesson whose answers are optional completes without them', optional && !optional.error, optional)

  /* ---- private: the reader reads it, an administrator doesn't ---- */
  const open = (await service.from('form_responses').insert({ form: OPEN, user_id: memberId }).select('id').single()).data!.id
  made.push(open)
  ok('the reader reads their own private response', ((await member.from('form_responses').select('id').eq('id', resp)).data || []).length === 1)
  ok('an administrator does not read a private response', ((await admin.from('form_responses').select('id').eq('id', resp)).data || []).length === 0)
  ok('…nor its answers', ((await admin.from('form_answers').select('field').eq('response_id', resp)).data || []).length === 0)
  ok('…and still reads a response that is not private', ((await admin.from('form_responses').select('id').eq('id', open)).data || []).length === 1)
  await admin.from('form_responses').delete().eq('id', resp)
  ok('an administrator cannot delete a private response', ((await service.from('form_responses').select('id').eq('id', resp)).data || []).length === 1)

  /* ---- the workbook ---- */
  const book = await call(member, 'course_workbook', { p_course: COURSE })
  ok('the workbook holds every lesson that carries a form, in order', book.mine === true && book.lessons.map((l: any) => l.key).join() === 'look,think', book)
  const look = book.lessons[0].entries
  ok('…with the reader\'s answers, a list in their order', look.length === 1 && JSON.stringify(look[0].answers.going_well) === JSON.stringify(['my health', 'my work', 'my love life']) && look[0].answers.note === 'Plainly.', book.lessons[0])
  ok('…and nothing for a lesson not answered yet', book.lessons[1].entries.length === 0, book.lessons[1])
  /* a form about each row of an earlier list: a response a row, kept apart */
  for (const [item, feeling] of [['money', 'worry'], ['work', 'dread']]) {
    const id = (await service.from('form_responses').insert({ form: `${FORM}-2`, user_id: memberId, private: true, item }).select('id').single()).data!.id
    made.push(id)
    await service.from('form_answers').insert({ response_id: id, field: 'feelings', value: [feeling] })
  }
  const rows = (await call(member, 'course_workbook', { p_course: COURSE })).lessons[1].entries
  ok('a lesson about each row keeps a response a row, in the order they were begun', rows.map((e: any) => e.item + ':' + e.answers.feelings[0]).join() === 'money:worry,work:dread', rows)

  /* ---- sharing with a coach ---- */
  const coaches = await call(member, 'course_workbook_coaches')
  ok('the coaches offered hold the coach or provider role', coaches.some((c: any) => c.id === coachId) && !coaches.some((c: any) => c.id === adminId), coaches)
  const notShared = await call(coach, 'course_workbook', { p_course: COURSE, p_reader: memberId })
  ok('a coach reads no workbook that was not shared with them', notShared.error === 'not-shared', notShared)
  ok('…nor its answers directly', ((await coach.from('form_responses').select('id').eq('id', resp)).data || []).length === 0)
  const toAdmin = await call(member, 'course_workbook_share', { p_course: COURSE, p_coach: adminId })
  ok('an administrator who is not a coach cannot be shared one', toAdmin.error === 'not-a-coach', toAdmin)
  const shared = await call(member, 'course_workbook_share', { p_course: COURSE, p_coach: coachId })
  ok('the reader shares it with a coach', shared.shares && shared.shares.length === 1 && shared.shares[0].coach === coachId, shared)
  await call(member, 'course_workbook_share', { p_course: COURSE, p_coach: coachId })
  ok('sharing twice is one share', (await service.from('course_workbook_shares').select('id').eq('reader', memberId).eq('course', COURSE).is('withdrawn_at', null)).data!.length === 1)
  const list = await call(coach, 'course_workbooks_shared')
  ok('the coach sees what was shared with them', list.some((w: any) => w.course === COURSE && w.reader === memberId))
  const theirs = await call(coach, 'course_workbook', { p_course: COURSE, p_reader: memberId })
  ok('the coach reads the shared workbook, with the reader named and no sharing controls', !theirs.error && theirs.mine === false && theirs.shares === null && theirs.lessons[0].entries[0].answers.note === 'Plainly.' && theirs.lessons[1].entries.length === 2, theirs)
  ok('…and its answers directly', ((await coach.from('form_answers').select('field').eq('response_id', resp)).data || []).length === 2)
  ok('…but not the reader\'s other responses', ((await coach.from('form_responses').select('id').eq('id', open)).data || []).length === 0)
  ok('another reader still can\'t', (await call(other, 'course_workbook', { p_course: COURSE, p_reader: memberId })).error === 'not-shared')
  ok('…and the administrator still can\'t', (await call(admin, 'course_workbook', { p_course: COURSE, p_reader: memberId })).error === 'not-shared')

  /* ---- withdrawing ---- */
  const back = await call(member, 'course_workbook_withdraw', { p_share: shared.shares[0].id })
  ok('the reader withdraws it', back.shares && back.shares.length === 0, back)
  ok('the coach reads it no longer', (await call(coach, 'course_workbook', { p_course: COURSE, p_reader: memberId })).error === 'not-shared')
  ok('…nor its answers', ((await coach.from('form_answers').select('field').eq('response_id', resp)).data || []).length === 0)
  const rec = (await service.from('course_workbook_shares').select('granted_at, withdrawn_at').eq('id', shared.shares[0].id).single()).data
  ok('the share stays on record, withdrawn', rec && rec.granted_at && rec.withdrawn_at, rec)
  ok('nobody else withdraws a share', (await call(coach, 'course_workbook_withdraw', { p_share: shared.shares[0].id })).error === 'no-share')

  /* ---- the `form` function, where the site has the demo's workbook form ---- */
  const DEMO = 'one-page-workbook'
  const post = async (values: Record<string, unknown>, end = true, item = '') => {
    const fd = new FormData(); fd.append('_form', DEMO); fd.append('_slide', '1'); if (end) fd.append('_end', 'true'); if (item) fd.append('_item', item)
    for (const [k, v] of Object.entries(values)) fd.append(k, Array.isArray(v) ? JSON.stringify(v) : String(v))
    const { data, error } = await member.functions.invoke('form', { body: fd })
    if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg } catch { /* none */ } return { error: msg } }
    return data
  }
  const first = await post({ cuts: ['  really ', '', 'very'], left: 'Less.' })
  if (first && first.error && /not a form|no such form|not found|unknown/i.test(first.error)) console.log('course-workbook-db: this site has no one-page-workbook form; the function\'s part is the demo\'s')
  else {
    await service.from('form_responses').delete().eq('form', DEMO).eq('user_id', memberId).neq('id', first.response_id)
    made.push(first.response_id)
    const row = (await service.from('form_responses').select('id, private, completed_at').eq('id', first.response_id).single()).data
    const cuts = (await service.from('form_answers').select('value').eq('response_id', first.response_id).eq('field', 'cuts').single()).data
    ok('a workbook response is private', row && row.private === true, row)
    ok('an ordered list is kept in order, each row tidied and the empty ones dropped', JSON.stringify(cuts && cuts.value) === JSON.stringify(['really', 'very']), cuts)
    const again = await post({ cuts: ['very', 'really'] })
    ok('coming back revises the same response', again.response_id === first.response_id, again)
    const other = await post({ cuts: ['other'] }, true, '  a second   row ')
    made.push(other.response_id)
    const otherRow = (await service.from('form_responses').select('item, private').eq('id', other.response_id).single()).data
    ok('a response about another row is a response of its own, its row tidied', other.response_id !== first.response_id && otherRow && otherRow.item === 'a second row' && otherRow.private === true, otherRow)
    const getOther = await member.functions.invoke('form', { body: { action: 'get', form: DEMO, item: 'a second row' } })
    ok('…and reopens with its own answers', getOther.data && JSON.stringify(getOther.data.answers.cuts) === JSON.stringify(['other']), getOther.data)
    const after = (await service.from('form_answers').select('value').eq('response_id', first.response_id).eq('field', 'cuts').single()).data
    const count = (await service.from('form_responses').select('id').eq('form', DEMO).eq('user_id', memberId).is('item', null)).data!.length
    const row2 = (await service.from('form_responses').select('completed_at').eq('id', first.response_id).single()).data
    ok('…with the changed answer, still one response, and the day it was first finished', JSON.stringify(after && after.value) === JSON.stringify(['very', 'really']) && count === 1 && row2 && row2.completed_at === row!.completed_at, { after, count, row2 })
    const get = await member.functions.invoke('form', { body: { action: 'get', form: DEMO } })
    ok('it reopens with every answer', get.data && get.data.completed === true && get.data.already === false && get.data.answers.left === 'Less.', get.data)
  }
} catch (e: any) {
  fail++; console.log('  FAIL  ' + (e.message || e))
} finally {
  if (made.length) await service.from('form_responses').delete().in('id', made)
  await service.from('course_workbook_shares').delete().eq('course', COURSE)
  await service.from('enrollments').delete().eq('course', COURSE)
  await service.from('courses').delete().eq('slug', COURSE)
}
console.log(fail ? `course-workbook-db: ${fail} failed, ${pass} passed` : `course-workbook-db: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)

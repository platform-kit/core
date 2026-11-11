<!--
  A COURSE'S WORKBOOK (openspec: courses): everything the reader has written in the course's workbook forms, by module
  and lesson in course order, each question with its answer (a list in the reader's order). It prints on its own. The
  reader shares it with a coach here, and stops sharing it here; a coach it was shared with reads it at the same
  address with ?reader=<id>. All of it is course_workbook's answer, which the database decides who may have.
-->
<template>
  <div class="crs-wrap crs-wb">
    <a class="crs-crumb crs-wb-noprint" :href="courseHref"><CourseIcon name="back" :size="15" />{{ S.back }}</a>

    <div v-if="loading && !book" class="crs-ov-ghost" aria-hidden="true"><span class="crs-ghost-line is-title" /><span class="crs-ghost-line" /><span class="crs-ghost-line is-short" /></div>
    <div v-else-if="!book || book.error" class="crs-empty">
      <span class="crs-empty-ico"><CourseIcon name="workbook" :size="26" /></span>
      <h2>{{ B[(book && book.error) || 'no-course'] || B['no-course'] }}</h2>
      <button v-if="book && book.error === 'sign-in'" type="button" class="btn solid" @click="signIn">{{ K['sign-in'] }}</button>
    </div>

    <template v-else>
      <div class="crs-wb-head">
        <div>
          <p class="crs-kicker">{{ B.kicker }} · {{ book.title }}</p>
          <h1>{{ book.mine ? B['title-mine'] : fill(B['title-theirs'], { name: book.reader.name }) }}</h1>
          <p class="crs-lead">{{ book.mine ? B['lead-mine'] : fill(B['lead-theirs'], { name: book.reader.name }) }}</p>
        </div>
        <button type="button" class="btn crs-btn-ico crs-wb-noprint" @click="print"><CourseIcon name="print" :size="16" />{{ B.print }}</button>
      </div>

      <p v-if="!book.lessons.length" class="crs-wb-empty">{{ B.empty }}</p>

      <!-- by module, as the course runs; or, where lessons follow up on the rows of an earlier list, by row: each one's
           answers together, lesson after lesson -->
      <div v-if="rowsKept.length" class="crs-wb-views crs-wb-noprint" role="tablist">
        <button type="button" role="tab" class="crs-wb-view" :class="{ 'is-on': by === 'module' }" :aria-selected="by === 'module'" @click="by = 'module'">{{ B['by-module'] }}</button>
        <button type="button" role="tab" class="crs-wb-view" :class="{ 'is-on': by === 'row' }" :aria-selected="by === 'row'" @click="by = 'row'">{{ B['by-row'] }}</button>
      </div>

      <template v-if="by === 'module' || !rowsKept.length">
        <div v-for="m in modules" :key="m.key" class="crs-wb-mod">
          <h2 class="crs-wb-mod-title"><span class="crs-kicker">{{ fill(S['module-of'], { n: m.n }) }}</span>{{ m.name }}</h2>
          <div v-for="l in m.lessons" :key="l.key" class="crs-wb-lesson">
            <div class="crs-wb-lesson-head"><h3>{{ l.title }}</h3></div>
            <template v-if="answered(l).length">
              <div v-for="e in answered(l)" :key="e.item || ''" class="crs-wb-entry">
                <p v-if="e.item" class="crs-wb-about">{{ e.item }}</p>
                <WbAnswers :lesson="l" :entry="e" />
              </div>
            </template>
            <p v-else class="crs-wb-blank">
              {{ B['not-answered'] }}<template v-if="book.mine && openLesson(l.key)"> · <a :href="courseHref + '/' + l.key">{{ B['answer-it'] }}</a></template>
            </p>
          </div>
        </div>
      </template>
      <template v-else>
        <div v-for="row in rowsKept" :key="row" class="crs-wb-mod">
          <h2 class="crs-wb-mod-title"><span class="crs-kicker">{{ B['row-kicker'] }}</span>{{ row }}</h2>
          <div v-for="x in chainOf(row)" :key="x.lesson.key" class="crs-wb-lesson">
            <div class="crs-wb-lesson-head"><h3>{{ x.lesson.title }}</h3></div>
            <WbAnswers :lesson="x.lesson" :entry="x.entry" />
          </div>
        </div>
      </template>

      <!-- the reader's sharing: who can read it now, and a coach to share it with -->
      <div v-if="book.mine" class="crs-side-card crs-wb-share crs-wb-noprint">
        <h2 class="crs-wb-share-title"><CourseIcon name="share" :size="18" />{{ B['share-title'] }}</h2>
        <p class="crs-wb-share-lead">{{ B['share-lead'] }}</p>
        <ul v-if="book.shares && book.shares.length" class="crs-wb-shares" :aria-label="B['shared-with']">
          <li v-for="s in book.shares" :key="s.id">
            <span><strong>{{ s.name }}</strong> <small>{{ fill(B['shared-on'], { date: day(s.granted_at) }) }}</small></span>
            <button type="button" class="btn" :disabled="busy" @click="withdraw(s.id)">{{ B.withdraw }}</button>
          </li>
        </ul>
        <p v-if="coaches && !choices.length && !(book.shares && book.shares.length)" class="crs-wb-share-lead">{{ B['share-none'] }}</p>
        <div v-if="choices.length" class="crs-wb-share-row">
          <label class="fq-vh" for="crs-wb-coach">{{ B['share-pick'] }}</label>
          <select id="crs-wb-coach" v-model="pick" class="crs-wb-select">
            <option value="">{{ B['share-pick'] }}</option>
            <option v-for="c in choices" :key="c.id" :value="c.id">{{ c.name }}{{ c.title ? ' · ' + c.title : '' }}</option>
          </select>
          <button type="button" class="btn solid" :disabled="!pick || busy" @click="share">{{ B['share-button'] }}</button>
        </div>
        <p v-if="problem" class="crs-problem" role="alert">{{ problem }}</p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, h } from 'vue'
import { user } from 'platformkit/lib/auth.js'
import { setHead } from 'platformkit/lib/seo.js'
import { forms as FORMS } from '#content'
import { renderCopy } from 'platformkit/lib/forms/logic.js'
import { words, fill, day, rpc, loadCourse, courseState } from './course-ui.js'
import CourseIcon from './CourseIcon.vue'

const props = defineProps({ base: { type: String, required: true }, slug: { type: String, required: true } })
const { K, S, B } = words()
const courseHref = computed(() => props.base + '/' + props.slug)
const book = ref<any>(null), loading = ref(false), busy = ref(false), problem = ref('')
const coaches = ref<any[] | null>(null), pick = ref('')
const reader = () => { try { return new URLSearchParams(location.search).get('reader') || null } catch { return null } }

async function load() {
  loading.value = true; problem.value = ''
  try {
    if (!user.value) { book.value = { error: 'sign-in' }; return }
    const [b] = await Promise.all([rpc('course_workbook', { p_course: props.slug, p_reader: reader() }), loadCourse(props.slug).catch(() => null)])
    book.value = b
    if (b && b.mine && coaches.value == null) coaches.value = (await rpc('course_workbook_coaches')) || []
    setHead({ title: b && !b.error ? `${b.mine ? B.value['title-mine'] : fill(B.value['title-theirs'], { name: b.reader.name })} — ${b.title}` : B.value['title-mine'], noindex: true })
  } catch (e) { problem.value = String((e as any).message || e) } finally { loading.value = false }
}
watch(() => [props.slug, user.value ? user.value.id : null], load, { immediate: true })
function signIn() { if ((window as any).DLauth) (window as any).DLauth.open({}) }
function print() { window.print() }

/* the course's modules, numbered as the course numbers them, holding the lessons that carry a form */
const state = computed(() => courseState(props.slug))
const modules = computed(() => {
  const all: any[] = (state.value && state.value.lessons) || []
  const order: string[] = []
  for (const l of all) { const s = l.section || ''; if (!order.includes(s)) order.push(s) }
  const out: any[] = []
  for (const l of (book.value && book.value.lessons) || []) {
    const s = l.section || ''
    let m = out[out.length - 1]
    if (!m || m.key !== s) { m = { key: s, name: s, n: order.indexOf(s) + 1 || out.length + 1, lessons: [] }; out.push(m) }
    m.lessons.push(l)
  }
  return out
})
const openLesson = (key: string) => { const l = ((state.value && state.value.lessons) || []).find((x: any) => x.key === key); return !!(l && l.open) }

/* a form's questions, from the form itself, in its order, with what they follow up on filled in as it was for this
   entry: the row it is about, and the earlier answers it names, read from the same workbook */
const modelOf = (slug: string) => { const f = (FORMS || []).find((x: any) => x.slug === slug); return f ? f.model : null }
const earlier = (form: string, field: string, item: string | null) => {
  const l = ((book.value && book.value.lessons) || []).find((x: any) => x.form === form)
  const about = modelOf(form) && modelOf(form).kit && modelOf(form).kit.about
  const e = l && (l.entries || []).find((x: any) => (about ? x.item === item : !x.item))
  return e ? e.answers[field] : undefined
}
const contextOf = (l: any, entry: any) => {
  const kit = (modelOf(l.form) || {}).kit || {}
  const ctx: any = { ...((entry && entry.answers) || {}) }
  if (kit.about) ctx[kit.about.name] = entry && entry.item
  for (const [name, r] of Object.entries(kit.uses || {}) as any) { const v = earlier(r.form, r.field, entry && entry.item); ctx[name] = r.top && Array.isArray(v) ? v[0] : v }
  return ctx
}
const questionsOf = (l: any, entry: any = null) => {
  const m = modelOf(l.form)
  const fields = (m && m.fields) || []
  const ctx = contextOf(l, entry)
  const q = (x: any) => [x.question, x.params && x.params.question].find((v) => v && v !== '...' && v !== x.name) || x.name
  return fields.map((x: any) => ({ name: x.name, kind: x.kind, question: renderCopy(q(x), ctx) }))
}
const present = (v: any) => v != null && v !== '' && !(Array.isArray(v) && !v.length)
const said = (v: any) => (Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v))
/* a lesson's responses that say something: one, or one a row for a form about each row of an earlier list */
const answered = (l: any) => (l.entries || []).filter((e: any) => e.answers && Object.values(e.answers).some(present))
/* the rows the reader has followed up on, in the order they first did, and each one's chain through the lessons */
const by = ref<'module' | 'row'>('module')
const rowsKept = computed(() => [...new Set(((book.value && book.value.lessons) || []).flatMap((l: any) => answered(l).map((e: any) => e.item).filter(Boolean)))] as string[])
const chainOf = (row: string) => ((book.value && book.value.lessons) || []).map((l: any) => ({ lesson: l, entry: answered(l).find((e: any) => e.item === row) })).filter((x: any) => x.entry)
/* one response's questions and answers, a list in its order */
const WbAnswers = (p: { lesson: any; entry: any }) => h('dl', { class: 'crs-wb-qa' }, questionsOf(p.lesson, p.entry).filter((q: any) => present(p.entry.answers[q.name])).flatMap((q: any) => {
  const v = p.entry.answers[q.name]
  return [h('dt', q.question), h('dd', Array.isArray(v) && q.kind === 'list' ? h('ol', { class: 'crs-wb-list' }, v.map((r: any) => h('li', String(r)))) : h('p', { class: 'crs-wb-text' }, said(v)))]
}))
WbAnswers.props = ['lesson', 'entry']

/* sharing: anyone with the coach role but the people it is already shared with */
const choices = computed(() => (coaches.value || []).filter((c: any) => !((book.value && book.value.shares) || []).some((s: any) => s.coach === c.id)))
async function act(fn: string, args: any) {
  busy.value = true; problem.value = ''
  try { const r = await rpc(fn, args); if (r && r.error) problem.value = B.value[r.error] || r.error; else { book.value = r; pick.value = '' } }
  catch (e) { problem.value = String((e as any).message || e) }
  busy.value = false
}
const share = () => act('course_workbook_share', { p_course: props.slug, p_coach: pick.value })
const withdraw = (id: string) => act('course_workbook_withdraw', { p_share: id })
</script>

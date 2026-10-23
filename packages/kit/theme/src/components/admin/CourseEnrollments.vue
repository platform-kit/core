<script setup>
/*
 * ENROLLMENTS (openspec: courses): who is taking a course, how far each person is, how many finish, and the lesson
 * where most of those who have not are stopped. One course at a time, picked at the top. It lists names and
 * addresses, so it is an administrator's (admin_course_enrollments asks is_admin), as orders are.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { supabase } from 'platformkit/lib/supabase.js'
import AdminHead from './AdminHead.vue'

const W = computed(() => ((us('courses').admin || {}).enrollments) || {})
const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : String(m[k])))
const day = (iso) => { try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) } catch { return '' } }
const pct = (d, t) => (t ? Math.round((100 * d) / t) : 0)

const courses = ref([]), pick = ref(''), view = ref(null), loading = ref(true), error = ref('')
const course = computed(() => courses.value.find((c) => c.slug === pick.value) || null)
/* a course with a form lesson shows each person's scores */
const quizzed = computed(() => !!(view.value && (view.value.people || []).some((p) => (p.quizzes || []).length)))
const lessonTitle = (key) => { const s = view.value && view.value.lessons; return (s && s[key]) || key }

onMounted(async () => {
  const { data } = await supabase.rpc('courses_list')
  courses.value = data || []
  pick.value = (courses.value[0] && courses.value[0].slug) || ''
  if (!pick.value) loading.value = false
})
watch(pick, async (slug) => {
  if (!slug) return
  loading.value = true; error.value = ''
  const [{ data, error: e }, { data: state }] = await Promise.all([supabase.rpc('admin_course_enrollments', { p_course: slug }), supabase.rpc('course_state', { p_course: slug })])
  if (e || (data && data.error)) { error.value = data && data.error === 'not-allowed' ? W.value.denied : (e && e.message) || ''; view.value = null }
  else view.value = { ...data, lessons: Object.fromEntries(((state && state.lessons) || []).map((l) => [l.key, l.title])) }
  loading.value = false
})
</script>

<template>
  <div class="ui-page ce">
    <AdminHead :title="W.title" :sub="W.lead">
      <template v-if="courses.length > 1" #actions>
        <label class="ce-pick">
          <span>{{ W.course }}</span>
          <select v-model="pick">
            <option v-for="c in courses" :key="c.slug" :value="c.slug">{{ c.title }}</option>
          </select>
        </label>
      </template>
    </AdminHead>

    <div v-if="!loading && !courses.length" class="ce-empty">
      <h2>{{ W['none-title'] }}</h2>
      <p>{{ W['none-body'] }}</p>
      <a class="ce-act" href="/admin/courses">{{ W['none-action'] }}</a>
    </div>
    <p v-else-if="error" class="ce-err" role="alert">{{ error }}</p>

    <template v-else-if="view">
      <ul class="ce-nums">
        <li><b>{{ view.enrolled }}</b><span>{{ W.enrolled }}</span></li>
        <li><b>{{ view.completed }}</b><span>{{ W.finished }}</span></li>
        <li><b>{{ view.enrolled ? pct(view.completed, view.enrolled) + '%' : '—' }}</b><span>{{ W.rate }}</span></li>
        <li class="ce-wide"><b>{{ view.stuck ? fill(W['stuck-line'], { n: view.stuck.people, lesson: view.stuck.title || view.stuck.lesson }) : W['stuck-none'] }}</b><span>{{ W.stuck }}</span></li>
      </ul>

      <div v-if="!view.people.length" class="ce-empty">
        <h2>{{ fill(W['empty-title'], { course: course ? course.title : '' }) }}</h2>
        <p>{{ W['empty-body'] }}</p>
      </div>
      <div v-else class="ce-table" :class="{ 'has-quiz': quizzed }" role="table">
        <div class="ce-row ce-th" role="row">
          <span role="columnheader">{{ W.name }}</span>
          <span role="columnheader">{{ W.cohort }}</span>
          <span role="columnheader">{{ W.started }}</span>
          <span role="columnheader">{{ W.progress }}</span>
          <span role="columnheader">{{ W.at }}</span>
          <span v-if="quizzed" role="columnheader">{{ W.quizzes }}</span>
        </div>
        <div v-for="p in view.people" :key="p.email + p.started_at" class="ce-row" role="row">
          <span class="ce-who" role="cell"><b>{{ p.name }}</b><i>{{ p.email }}</i></span>
          <span class="ce-cell" role="cell" :data-label="W.cohort">{{ p.cohort || '—' }}</span>
          <span class="ce-cell" role="cell" :data-label="W.started">{{ day(p.started_at) }}</span>
          <span class="ce-cell ce-prog" role="cell" :data-label="W.progress">
            <span class="ce-bar"><span :style="{ width: pct(p.done, view.total) + '%' }" /></span>
            <em>{{ p.done }} / {{ view.total }}</em>
          </span>
          <span class="ce-cell" role="cell" :data-label="W.at">{{ p.completed_at ? fill(W.done, { date: day(p.completed_at) }) : lessonTitle(p.at) }}</span>
          <!-- each quiz: the best score, and how many attempts it took -->
          <span v-if="quizzed" class="ce-cell ce-quiz" role="cell" :data-label="W.quizzes">
            <span v-for="q in p.quizzes || []" :key="q.lesson" class="ce-score" :class="{ 'is-passed': q.passed }" :title="q.title + ' · ' + fill(W.attempts, { n: q.attempts })">{{ q.attempts ? q.score + '/' + q.total : '—' }}</span>
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ce-pick { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ink3) }
.ce-pick select { font: inherit; font-size: 13.5px; color: var(--ink); padding: 7px 10px; border: 1px solid var(--hair); border-radius: 8px; background: var(--paper); max-width: 18rem }
.ce-err { margin: 0 0 12px; font-size: 13px; color: #c4362a }
.ce-act { display: inline-block; font-size: 13px; padding: 7px 14px; border: 1px solid var(--hair); border-radius: 999px; color: var(--ink); text-decoration: none }
.ce-act:hover { border-color: var(--ink3) }
.ce-empty { padding: 28px 22px; border: 1px dashed var(--hair); border-radius: 12px; display: grid; gap: 6px; justify-items: start }
.ce-empty h2 { margin: 0; font-size: 16px; font-weight: 600; color: var(--ink) }
.ce-empty p { margin: 0 0 6px; font-size: 13.5px; color: var(--ink3); max-width: 36rem }
.ce-nums { list-style: none; margin: 0 0 18px; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 2fr); gap: 8px }
.ce-nums li { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; border: 1px solid var(--hair); border-radius: 10px; background: var(--card); min-width: 0 }
.ce-nums b { font-family: var(--fd); font-size: 19px; font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ce-nums .ce-wide b { font-size: 15px; line-height: 1.6 }
.ce-nums span { font-family: var(--m); font-size: 9.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--ink3) }
.ce-table { border: 1px solid var(--hair); border-radius: 12px; background: var(--card); overflow: hidden }
.ce-row { display: grid; grid-template-columns: minmax(0, 2.2fr) minmax(0, .9fr) minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1.6fr); gap: 12px; align-items: center; padding: 11px 15px; border-top: 1px solid var(--hair); font-size: 13.5px; color: var(--ink2) }
.ce-row:first-child { border-top: 0 }
.has-quiz .ce-row { grid-template-columns: minmax(0, 2.2fr) minmax(0, .9fr) minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1.6fr) minmax(0, 1.8fr) }
.ce-quiz { display: flex; flex-wrap: wrap; gap: 4px }
.ce-score { font-family: var(--m); font-size: 11.5px; padding: 2px 6px; border: 1px solid var(--hair); border-radius: 6px; color: var(--ink3); white-space: nowrap }
.ce-score.is-passed { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.ce-th { font-family: var(--m); font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); padding-top: 9px; padding-bottom: 9px }
.ce-who { display: flex; flex-direction: column; min-width: 0 }
.ce-who b { color: var(--ink); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ce-who i { font-style: normal; font-size: 12px; color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ce-prog { display: flex; align-items: center; gap: 8px }
.ce-prog em { font-style: normal; font-family: var(--m); font-size: 12px; color: var(--ink3); white-space: nowrap }
.ce-bar { flex: 1; height: 4px; border-radius: 2px; background: var(--hair); overflow: hidden; min-width: 40px }
.ce-bar > span { display: block; height: 100%; background: var(--ink) }
@media (max-width: 760px) {
  .ce-nums { grid-template-columns: repeat(3, minmax(0, 1fr)) }
  .ce-nums .ce-wide { grid-column: 1 / -1 }
  .ce-th { display: none }
  .ce-row, .has-quiz .ce-row { grid-template-columns: 1fr 1fr; gap: 6px 12px }
  .ce-quiz { grid-column: 1 / -1 }
  .ce-who { grid-column: 1 / -1 }
  .ce-cell::before { content: attr(data-label); display: block; font-family: var(--m); font-size: 9px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3) }
  .ce-prog { flex-wrap: wrap }
  .ce-prog::before { flex-basis: 100% }
}
</style>

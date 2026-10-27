<!--
  THE COURSES THEMSELVES (openspec: courses): the library, a course's overview and the lesson player, drawn the same
  wherever they are — on pages of their own (pages/CoursesPage.vue, at /courses) and in the community's Courses place
  (CoursesPlace.vue, at <community>/courses). `base` is the address they are at and `path` what follows it: '' the
  library, '<slug>' a course, '<slug>/<lesson>' a lesson.

  This holds what the screens are drawn from and does what they ask: course_state for the outline and what is open,
  course_lesson for a lesson's text (none for a closed one), course_enroll and course_complete. Nothing here decides
  what is open; the database does, and the screens say why something is not.

  Divs throughout, not header/section/main: the theme styles those elements as a landing page's bands.
-->
<template>
  <div class="crs" :class="{ 'is-place': place, 'is-playing': view === 'lesson' && state }">
    <CourseLibrary v-if="view === 'list'" :base="base" />
    <CourseOverview
      v-else-if="view === 'course' || !state" :base="base" :state="state" :loading="loading" :busy="busy" :problem="problem"
      @enroll="enroll" @sign-in="signIn" />
    <CoursePlayer
      v-else :base="base" :state="state" :lesson-key="lessonKey" :lesson="lesson" :loading="loading" :busy="busy" :problem="problem" :outcome="outcome"
      :earned="earned" @enroll="enroll" @sign-in="signIn" @complete="complete" @form-done="formDone" />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { navigate } from 'platformkit/lib/router.js'
import { user } from 'platformkit/lib/auth.js'
import { capture } from 'platformkit/lib/analytics.js'
import { loadMine } from 'platformkit/lib/awards.js'
import { setHead } from 'platformkit/lib/seo.js'
import CourseLibrary from './CourseLibrary.vue'
import CourseOverview from './CourseOverview.vue'
import CoursePlayer from './CoursePlayer.vue'
import { words, rpc, leadOf, courseState, loadCourse, keepCourse, forgetCourses } from './course-ui.js'
import './courses.css'

const props = defineProps({
  /* the address the courses are at, and what follows it */
  base: { type: String, default: '/courses' },
  path: { type: String, default: '' },
  /* drawn inside the community's frame rather than a page of its own */
  place: { type: Boolean, default: false },
})
const { K, S } = words()

/* where we are, under the base: '' · <slug> · <slug>/<lesson> */
const parts = computed(() => String(props.path || '').split('/').filter(Boolean))
const view = computed(() => (parts.value.length >= 2 ? 'lesson' : parts.value.length === 1 ? 'course' : 'list'))
const slug = computed(() => parts.value[0] || null)
const lessonKey = computed(() => (view.value === 'lesson' ? parts.value[1] : null))

const loading = ref(false), busy = ref(false), problem = ref(''), outcome = ref('')
const lesson = ref(null)
const state = computed(() => (slug.value ? courseState(slug.value) : null))

async function load() {
  problem.value = ''
  if (view.value === 'list') return
  loading.value = true
  try {
    const [s, l] = await Promise.all([
      loadCourse(slug.value),
      view.value === 'lesson' ? rpc('course_lesson', { p_course: slug.value, p_lesson: lessonKey.value }) : null,
    ])
    lesson.value = l
    setHead({ title: l && l.title ? `${l.title} — ${s && s.title}` : s ? s.title : K.value.missing, description: s ? leadOf(s.about) : '' })
  } catch (e) { console.warn('courses:', e.message || e) }
  loading.value = false
}
let who
watch([() => props.path, () => (user.value ? user.value.id : null)], ([, id]) => {
  /* somebody signing in or out sees every course afresh */
  if (who !== undefined && id !== who) forgetCourses()
  who = id
  if (view.value !== 'lesson' || (lesson.value && lesson.value.key !== lessonKey.value)) lesson.value = null
  outcome.value = ''
  load()
  if (typeof window !== 'undefined') {
    const pane = props.place ? document.querySelector('.crs.is-place') : null
    if (pane) pane.scrollTop = 0; else window.scrollTo({ top: 0 })
  }
}, { immediate: true })

function signIn() { if (window.DLauth) window.DLauth.open({}) }
async function enroll() {
  busy.value = true; problem.value = ''
  try {
    const r = await rpc('course_enroll', { p_course: slug.value })
    if (r && r.error) problem.value = S.value[r.error] || r.error
    else { keepCourse(slug.value, r); capture('course_started', { course: slug.value }); if (view.value === 'lesson') await load() }
  } catch (e) { problem.value = String(e.message || e) }
  busy.value = false
}
/* THE ACHIEVEMENT A QUIZ EARNS (openspec: courses): awarded in the database as the quiz is passed, so this only looks
   it up, by the slug the achievements push gives it. Where the achievements module is off there is none to find. */
const earned = ref(null)
async function lookUpEarned(force = false) {
  earned.value = null
  const l = state.value && lessonKey.value ? (state.value.lessons || []).find((x) => x.key === lessonKey.value) : null
  if (!l || l.kind !== 'form' || !l.done) return
  try {
    const held = await loadMine(force)
    earned.value = (held || []).find((a) => a.slug === `quiz-${slug.value}-${lessonKey.value}`) || null
  } catch { /* no achievements here */ }
}
watch(() => [lessonKey.value, state.value && state.value.slug], () => lookUpEarned(), { immediate: true })

/* A FORM LESSON'S FORM FINISHED: the server has recorded the lesson as the response completed (where it passed), so
   the course is only read again; where that finished the course, the player says so */
async function formDone() {
  const at = lessonKey.value
  const was = !!(state.value && state.value.enrollment && state.value.enrollment.completed_at)
  try {
    const s = await loadCourse(slug.value)
    const l = s && (s.lessons || []).find((x) => x.key === at)
    if (l && l.done) { capture('lesson_completed', { course: slug.value, lesson: at }); await lookUpEarned(true) }
    if (s && s.enrollment && s.enrollment.completed_at && !was) outcome.value = 'course-done'
  } catch (e) { problem.value = String(e.message || e) }
}
/* COMPLETE AND CONTINUE: the lesson is recorded done, then the next open lesson opens; where there is none yet, the
   player says when the next one opens; where that was the course, it says the course is finished */
async function complete() {
  busy.value = true; problem.value = ''
  const at = lessonKey.value
  /* an optional lesson done after the course was finished finishes nothing new */
  const was = !!(state.value && state.value.enrollment && state.value.enrollment.completed_at)
  try {
    const r = await rpc('course_complete', { p_course: slug.value, p_lesson: at })
    if (r && r.error) { problem.value = S.value[r.error] || r.error; busy.value = false; return }
    keepCourse(slug.value, r)
    capture('lesson_completed', { course: slug.value, lesson: at })
    const ls = r.lessons || [], i = ls.findIndex((l) => l.key === at)
    const go = ls.find((l, j) => j > i && l.open && !l.done) || ls.find((l) => l.open && !l.done && l.required)
    if (r.enrollment && r.enrollment.completed_at && !was) outcome.value = 'course-done'
    else if (go) navigate(props.base + '/' + slug.value + '/' + go.key)
    else outcome.value = 'lesson-done'
  } catch (e) { problem.value = String(e.message || e) }
  busy.value = false
}
</script>

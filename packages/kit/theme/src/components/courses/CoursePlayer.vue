<!--
  THE LESSON PLAYER (openspec: courses): a bar of its own — the way back to the course, how far through it the reader
  is, the curriculum, previous and next — with the curriculum beside the lesson (behind the bar's Lessons control on a
  phone, and folded away on a wide screen when the reader wants the room), and one action at the foot of the lesson
  that finishes it and opens the next. Finishing the last required lesson says so here and offers the certificate.

  A closed lesson's text never arrives (course_lesson sends none); this says why it is closed and what opens it.
-->
<template>
  <div class="crs-player" :class="{ 'is-wide': !sideOpen }">
    <div class="crs-pbar">
      <a class="crs-pbar-back" :href="courseHref" :title="state.title"><CourseIcon name="back" :size="16" /><span>{{ state.title }}</span></a>
      <span v-if="state.enrollment" class="crs-pbar-progress" :title="fill(K.progress, { done: state.done, total: state.total })">
        <span class="crs-bar"><span :style="{ width: pct(state.done, state.total) + '%' }" /></span>
        <span class="crs-pbar-n">{{ state.done }}/{{ state.total }}</span>
      </span>
      <span class="crs-pbar-acts">
        <button type="button" class="crs-icon-btn crs-pbar-list" :aria-expanded="sideOpen || drawer" :aria-label="sideOpen ? S['hide-lessons'] : S['show-lessons']" :title="sideOpen ? S['hide-lessons'] : S['show-lessons']" @click="toggleSide">
          <CourseIcon name="list" :size="18" /><span class="crs-pbar-word">{{ S.steps }}</span>
        </button>
        <a class="crs-icon-btn" :class="{ 'is-off': !prev }" :href="prev ? courseHref + '/' + prev.key : null" :aria-label="S.previous" :title="prev ? S.previous + ': ' + prev.title : S.previous"><CourseIcon name="back" :size="18" /></a>
        <a class="crs-icon-btn" :class="{ 'is-off': !after }" :href="after ? courseHref + '/' + after.key : null" :aria-label="S.next" :title="after ? S.next + ': ' + after.title : S.next"><CourseIcon name="chev" :size="18" /></a>
      </span>
    </div>

    <div class="crs-pgrid">
      <!-- the curriculum: beside the lesson, or a sheet over it on a phone -->
      <div v-if="drawer" class="crs-scrim" @click="drawer = false" />
      <nav class="crs-pside" :class="{ 'is-drawer': drawer }" :aria-label="K.curriculum">
        <div class="crs-pside-head">
          <strong>{{ K.curriculum }}</strong>
          <span v-if="state.enrollment" class="crs-pside-n">{{ fill(K.percent, { n: pct(state.done, state.total) }) }}</span>
          <button type="button" class="crs-icon-btn crs-pside-close" :aria-label="S.close" @click="drawer = false"><CourseIcon name="close" :size="18" /></button>
        </div>
        <div v-for="m in modules" :key="m.n" class="crs-pmod">
          <p class="crs-pmod-head">
            <span class="crs-pmod-name"><b class="crs-pmod-num" :class="{ 'is-done': m.finished }">{{ m.n }}</b>{{ m.name || fill(K['module-n'], { n: m.n }) }}</span>
            <span v-if="state.enrollment && m.total" class="crs-pmod-n" :class="{ 'is-done': m.finished }"><CourseIcon v-if="m.finished" name="done" :size="13" />{{ m.done }}/{{ m.total }}</span>
          </p>
          <!-- how far through the section: a bar under its name -->
          <span v-if="state.enrollment && m.done > 0 && !m.finished" class="crs-pmod-bar" :class="{ 'is-done': m.finished }"><span :style="{ width: pct(m.done, m.total) + '%' }" /></span>
          <ol class="crs-plist">
            <li v-for="l in m.lessons" :key="l.key">
              <a :href="courseHref + '/' + l.key" :class="['is-' + stateOf(l), { 'is-here': l.key === lessonKey, 'is-closed': !l.open, 'is-done': l.done, 'has-score': l.quiz && l.quiz.total }]" :aria-current="l.key === lessonKey ? 'page' : null">
                <CourseIcon :name="markOf(l)" :size="18" class="crs-mark" />
                <span class="crs-plist-title">{{ l.title }}</span>
                <!-- at the end: a quiz's score, else what kind of lesson it is where that is anything but reading -->
                <span v-if="l.quiz && l.quiz.total" class="crs-plist-score" :title="(stateOf(l) === 'failed' ? S['quiz-not-passed'] + ' · ' : '') + fill(S['quiz-best'], l.quiz)">{{ l.quiz.score }}/{{ l.quiz.total }}</span>
                <CourseIcon v-else-if="kindOf(l) !== 'text'" :name="kindOf(l)" :size="14" class="crs-plist-kind" />
              </a>
            </li>
          </ol>
        </div>
      </nav>

      <div class="crs-pmain">
        <div class="crs-pcol">
          <!-- the course finished, here, on the lesson that finished it -->
          <div v-if="outcome === 'course-done'" class="crs-finale">
            <span class="crs-finale-badge"><CourseIcon name="award" :size="34" /></span>
            <h1>{{ S['course-done-title'] }}</h1>
            <p>{{ fill(S['course-done-body'], { course: state.title }) }}</p>
            <div class="crs-finale-acts">
              <a v-if="state.certificate_id" class="btn solid crs-btn-ico" :href="ROUTES.certificates + '/' + state.certificate_id"><CourseIcon name="award" :size="15" />{{ S['see-certificate'] }}</a>
              <a class="btn" :href="courseHref">{{ S.back }}</a>
              <a class="btn" :href="base">{{ K.back }}</a>
            </div>
          </div>

          <div v-else-if="loading && !lesson" class="crs-ov-ghost" aria-hidden="true"><span class="crs-ghost-line is-short" /><span class="crs-ghost-line is-title" /><span class="crs-ghost-line" /><span class="crs-ghost-line" /></div>

          <template v-else-if="lesson && lesson.open">
            <p class="crs-kicker">{{ here && here.section ? here.section + ' · ' : '' }}{{ fill(S.of, hereIn) }}</p>
            <h1 class="crs-ptitle">{{ lesson.title }}</h1>
            <MediaBlock v-if="tracks.length" :media="tracks" class="crs-media" />
            <div v-if="lesson.body" class="crs-prose"><MarkdownDoc :source="lesson.body" marks /></div>

            <!-- a lesson that is something the site already has: what it is, and the way to it -->
            <a v-if="lesson.kind === 'chapter'" class="crs-pointer" :href="pointerHref(lesson)">
              <span class="crs-pointer-book" :style="bookCover ? null : { background: coverTint(bookSlug) }">
                <img v-if="bookCover" :src="bookCover" alt="" />
                <span v-else>{{ book ? book.title : '' }}</span>
              </span>
              <span class="crs-pointer-text">
                <span class="crs-kicker">{{ fill(S['chapter-n'], { n: chapterN }) }}</span>
                <strong>{{ book ? book.title : bookSlug }}</strong>
                <small v-if="book && book.author">{{ book.author }}</small>
              </span>
              <span class="btn solid crs-btn-ico crs-pointer-go"><CourseIcon name="chapter" :size="15" />{{ S['read-chapter'] }}</span>
            </a>
            <!-- a form lesson: the form itself, here, and its result in place of the form's own end -->
            <div v-else-if="lesson.kind === 'form' && formDoc" class="crs-quiz">
              <div v-if="result" class="crs-quiz-result" :class="{ 'is-passed': result.passed !== false }" role="status">
                <span class="crs-quiz-badge"><CourseIcon :name="result.passed !== false ? 'done' : 'form'" :size="26" /></span>
                <div class="crs-quiz-text">
                  <strong>{{ result.passed !== false ? (result.total ? S['quiz-passed'] : S['form-done']) : S['quiz-failed'] }}</strong>
                  <span v-if="result.total" class="crs-quiz-score">{{ fill(result.best ? S['quiz-best'] : S['quiz-score'], result) }}</span>
                  <span v-if="result.passed === false && passMark" class="crs-quiz-need">{{ fill(S['quiz-need'], { pass: passMark, total: result.total }) }}</span>
                  <!-- the achievement this quiz earns, once it is held -->
                  <a v-if="earned && result.passed !== false" class="crs-quiz-award" :href="ROUTES.awards + '/' + earned.slug"><CourseIcon name="award" :size="15" />{{ S['achievement-earned'] }}: {{ earned.title }}</a>
                </div>
                <button type="button" class="btn" :class="{ solid: result.passed === false }" @click="again">{{ result.passed === false ? S['try-again'] : S.retake }}</button>
              </div>
              <FormRun v-else :key="lessonKey + ':' + runs" :form="formDoc" embed class="crs-quiz-run" @complete="onForm" />
            </div>
            <a v-else-if="lesson.kind !== 'text'" class="crs-pointer" :href="pointerHref(lesson)">
              <span class="crs-pointer-ico"><CourseIcon :name="lesson.kind" :size="24" /></span>
              <span class="crs-pointer-text"><strong>{{ S['kind-' + lesson.kind] }}</strong></span>
              <span class="btn solid crs-pointer-go">{{ goWord }}</span>
            </a>

            <div v-if="downloads.length" class="crs-files">
              <p class="crs-kicker">{{ S.downloads }}</p>
              <a v-for="d in downloads" :key="d.src" class="crs-file" :href="d.src" download>
                <span class="crs-file-ico"><CourseIcon name="file" :size="18" /></span>
                <span>{{ d.title || d.src.split('/').pop() }}</span>
              </a>
            </div>

            <!-- the one action: finish it and go on -->
            <div class="crs-pfoot">
              <a v-if="prev" class="crs-pfoot-prev" :href="courseHref + '/' + prev.key"><CourseIcon name="back" :size="15" />{{ S.previous }}</a>
              <span v-else />
              <span class="crs-pfoot-acts">
                <p v-if="problem" class="crs-problem" role="alert">{{ problem }}</p>
                <template v-if="here && here.done">
                  <span class="crs-done-word"><CourseIcon name="done" :size="18" />{{ S.completed }}</span>
                  <a v-if="after && after.open" class="btn solid crs-btn-ico" :href="courseHref + '/' + after.key">{{ S['next-lesson'] }}<CourseIcon name="arrow" :size="15" /></a>
                </template>
                <!-- a form lesson finishes itself when the form is passed; the button is only for one passed before it opened -->
                <button v-else-if="state.enrollment && (lesson.kind !== 'form' || !formDoc || (here && here.quiz && here.quiz.passed))" type="button" class="btn solid crs-btn-ico" :disabled="busy" @click="emit('complete')">
                  {{ finishes ? S['complete-finish'] : S['complete-continue'] }}<CourseIcon name="arrow" :size="15" />
                </button>
              </span>
            </div>
            <p v-if="here && here.done && !(after && after.open) && opening" class="crs-waiting"><CourseIcon name="clock" :size="16" />{{ S['lesson-done'] }} — {{ fill(S['next-opens'], { date: day(opening.opens_at) }) }}</p>
          </template>

          <!-- a closed lesson: why, and what opens it -->
          <div v-else-if="here" class="crs-locked">
            <span class="crs-locked-badge"><CourseIcon :name="here.why === 'not-yet' ? 'clock' : 'closed'" :size="26" /></span>
            <p class="crs-kicker">{{ here.section ? here.section + ' · ' : '' }}{{ fill(S.of, hereIn) }}</p>
            <h1 class="crs-ptitle">{{ here.title }}</h1>
            <p class="crs-locked-why">{{ whyWord(here) }}</p>
            <button v-if="here.why === 'not-enrolled' && state.access" type="button" class="btn solid" :disabled="busy" @click="emit('enroll')">{{ K.start }}</button>
            <button v-else-if="here.why === 'sign-in'" type="button" class="btn solid" @click="emit('sign-in')">{{ K['sign-in'] }}</button>
            <a v-else-if="here.why === 'in-order' && prev" class="btn solid" :href="courseHref + '/' + prev.key">{{ S.previous }}: {{ prev.title }}</a>
            <a v-else class="btn" :href="courseHref">{{ S.back }}</a>
          </div>
          <div v-else class="crs-locked">
            <h1 class="crs-ptitle">{{ K.missing }}</h1>
            <a class="btn" :href="courseHref">{{ S.back }}</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ROUTES } from 'platformkit/lib/router.js'
import { bookShelf, coverTint } from 'platformkit/lib/content.js'
import { bookCoverOf } from 'platformkit/lib/book-art.js'
import { forms as FORMS } from '#content'
import MarkdownDoc from '../MarkdownDoc.vue'
import MediaBlock from '../content/MediaBlock.vue'
import FormRun from '../forms/FormRun.vue'
import CourseIcon from './CourseIcon.vue'
import { words, fill, pct, day, modulesOf, kindOf, stateOf, markOf, nextOpening, pointerHref } from './course-ui.js'

const props = defineProps({
  base: { type: String, required: true },
  state: { type: Object, required: true },
  lessonKey: { type: String, required: true },
  lesson: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  problem: { type: String, default: '' },
  outcome: { type: String, default: '' },
  /* the achievement a passed quiz on this lesson has earned, where the reader holds it: { slug, title } */
  earned: { type: Object, default: null },   /* after Complete and continue: 'lesson-done' (nothing open next yet) · 'course-done' */
})
const emit = defineEmits(['enroll', 'sign-in', 'complete', 'form-done'])
const { K, S } = words()

const courseHref = computed(() => props.base + '/' + props.state.slug)
const lessons = computed(() => (props.state.lessons || []).map((l, i) => ({ ...l, n: i + 1 })))
const modules = computed(() => modulesOf(props.state.lessons || []))
const hereAt = computed(() => lessons.value.findIndex((l) => l.key === props.lessonKey))
/* where the lesson sits in its own module: "Lesson 2 of 5" counts within it, not across the course */
const hereIn = computed(() => {
  const m = modules.value.find((x) => x.lessons.some((l) => l.key === props.lessonKey))
  return m ? { n: m.lessons.findIndex((l) => l.key === props.lessonKey) + 1, total: m.lessons.length } : { n: hereAt.value + 1, total: lessons.value.length }
})
const here = computed(() => lessons.value[hereAt.value] || null)
const prev = computed(() => (hereAt.value > 0 ? lessons.value[hereAt.value - 1] : null))
const after = computed(() => (hereAt.value >= 0 && hereAt.value < lessons.value.length - 1 ? lessons.value[hereAt.value + 1] : null))
const opening = computed(() => nextOpening(lessons.value))
/* the last required lesson still to do: finishing it finishes the course */
const finishes = computed(() => !!here.value && here.value.required && lessons.value.filter((l) => l.required && !l.done).length === 1)

/* the curriculum: beside the lesson on a wide screen (the reader may fold it away), a sheet on a phone */
const sideOpen = ref(true), drawer = ref(false)
const narrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
function toggleSide() { if (narrow()) drawer.value = !drawer.value; else sideOpen.value = !sideOpen.value }
watch(() => props.lessonKey, () => { drawer.value = false })

const tracks = computed(() => ((props.lesson && props.lesson.media) || []).filter((m) => m.type !== 'file'))
const downloads = computed(() => ((props.lesson && props.lesson.media) || []).filter((m) => m.type === 'file'))
const bookSlug = computed(() => String((props.lesson && props.lesson.ref) || '').split('#')[0])
const chapterN = computed(() => String((props.lesson && props.lesson.ref) || '').split('#')[1] || '')
const book = computed(() => bookShelf().find((b) => b.slug === bookSlug.value) || null)
const bookCover = computed(() => (bookSlug.value ? bookCoverOf(bookSlug.value) : ''))
const goWord = computed(() => ({ article: S.value['read-article'], form: S.value['answer-form'], session: S.value['book-session'] }[props.lesson && props.lesson.kind] || S.value.open))
/* A FORM LESSON'S FORM, run here. Its result replaces the form's own end: the attempt just made, or, opening a lesson
   already passed, the reader's best. Finishing it is recorded by the server as the response completes, so the course
   is only asked again. Try again and Take it again start the form afresh; a retake never undoes the lesson. */
const formDoc = computed(() => (props.lesson && props.lesson.kind === 'form' ? (FORMS || []).find((f) => f.slug === props.lesson.ref && f.published !== false) || null : null))
const passMark = computed(() => (formDoc.value && formDoc.value.model.kit && formDoc.value.model.kit.pass) || 0)
const result = ref(null), runs = ref(0)
watch(() => [props.lessonKey, here.value && here.value.quiz && here.value.quiz.passed], ([, passed], was) => {
  if (was && was[0] === props.lessonKey && result.value) return
  const q = here.value && here.value.quiz
  result.value = passed ? { ...q, best: true } : here.value && here.value.done && !q ? { passed: true } : null
}, { immediate: true })
function onForm({ grade }) {
  result.value = grade ? { score: grade.score, total: grade.total, passed: grade.passed } : { passed: true }
  emit('form-done')
}
function again() { result.value = null; runs.value++ }
const whyWord = (l) => (l.why === 'not-yet' ? fill(S.value['not-yet'], { date: day(l.opens_at) }) : S.value[l.why] || '')
</script>

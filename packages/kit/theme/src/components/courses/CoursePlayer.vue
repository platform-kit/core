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
            <span>{{ m.name || fill(K['module-n'], { n: m.n }) }}</span>
            <span v-if="state.enrollment && m.total" class="crs-pmod-n" :class="{ 'is-done': m.finished }">{{ m.done }}/{{ m.total }}</span>
          </p>
          <ol class="crs-plist">
            <li v-for="l in m.lessons" :key="l.key">
              <a :href="courseHref + '/' + l.key" :class="{ 'is-here': l.key === lessonKey, 'is-closed': !l.open, 'is-done': l.done }" :aria-current="l.key === lessonKey ? 'page' : null">
                <CourseIcon :name="l.done ? 'done' : l.open ? 'open' : 'closed'" :size="18" class="crs-mark" />
                <span class="crs-plist-title">{{ l.title }}</span>
                <CourseIcon :name="kindOf(l)" :size="14" class="crs-plist-kind" />
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
            <p class="crs-kicker">{{ here && here.section ? here.section + ' · ' : '' }}{{ fill(S.of, { n: hereAt + 1, total: lessons.length }) }}</p>
            <h1 class="crs-ptitle">{{ lesson.title }}</h1>
            <MediaBlock v-if="tracks.length" :media="tracks" class="crs-media" />
            <div v-if="lesson.body" class="crs-prose"><MarkdownDoc :source="lesson.body" /></div>

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
                <button v-else-if="state.enrollment" type="button" class="btn solid crs-btn-ico" :disabled="busy" @click="emit('complete')">
                  {{ finishes ? S['complete-finish'] : S['complete-continue'] }}<CourseIcon name="arrow" :size="15" />
                </button>
              </span>
            </div>
            <p v-if="here && here.done && !(after && after.open) && opening" class="crs-waiting"><CourseIcon name="clock" :size="16" />{{ S['lesson-done'] }} — {{ fill(S['next-opens'], { date: day(opening.opens_at) }) }}</p>
          </template>

          <!-- a closed lesson: why, and what opens it -->
          <div v-else-if="here" class="crs-locked">
            <span class="crs-locked-badge"><CourseIcon :name="here.why === 'not-yet' ? 'clock' : 'closed'" :size="26" /></span>
            <p class="crs-kicker">{{ here.section ? here.section + ' · ' : '' }}{{ fill(S.of, { n: hereAt + 1, total: lessons.length }) }}</p>
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
import MarkdownDoc from '../MarkdownDoc.vue'
import MediaBlock from '../content/MediaBlock.vue'
import CourseIcon from './CourseIcon.vue'
import { words, fill, pct, day, modulesOf, kindOf, nextOpening, pointerHref } from './course-ui.js'

const props = defineProps({
  base: { type: String, required: true },
  state: { type: Object, required: true },
  lessonKey: { type: String, required: true },
  lesson: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  problem: { type: String, default: '' },
  outcome: { type: String, default: '' },   /* after Complete and continue: 'lesson-done' (nothing open next yet) · 'course-done' */
})
const emit = defineEmits(['enroll', 'sign-in', 'complete'])
const { K, S } = words()

const courseHref = computed(() => props.base + '/' + props.state.slug)
const lessons = computed(() => (props.state.lessons || []).map((l, i) => ({ ...l, n: i + 1 })))
const modules = computed(() => modulesOf(props.state.lessons || []))
const hereAt = computed(() => lessons.value.findIndex((l) => l.key === props.lessonKey))
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
const whyWord = (l) => (l.why === 'not-yet' ? fill(S.value['not-yet'], { date: day(l.opens_at) }) : S.value[l.why] || '')
</script>

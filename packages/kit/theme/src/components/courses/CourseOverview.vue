<!--
  A COURSE'S OVERVIEW (openspec: courses): what it is, where this reader stands in it and the one thing to do next, and
  its curriculum as modules that fold, each saying how much of it is done and when it opens. The card beside the
  curriculum is the reader's: their progress and next step, or what getting in takes, then the course's facts.
-->
<template>
  <div class="crs-wrap crs-ov">
    <div v-if="!state && loading" class="crs-ov-ghost" aria-hidden="true"><span class="crs-ghost-line is-title" /><span class="crs-ghost-line" /><span class="crs-ghost-line is-short" /></div>
    <div v-else-if="!state" class="crs-empty">
      <span class="crs-empty-ico"><CourseIcon name="layers" :size="26" /></span>
      <h2>{{ K.missing }}</h2>
      <a class="btn" :href="base">{{ K.back }}</a>
    </div>
    <template v-else>
      <a class="crs-crumb" :href="base"><CourseIcon name="back" :size="15" />{{ K.back }}</a>

      <div class="crs-ov-hero">
        <div class="crs-ov-hero-text">
          <p class="crs-kicker">{{ K.kicker }}</p>
          <h1>{{ state.title }}</h1>
          <p v-if="lead" class="crs-lead">{{ lead }}</p>
        </div>
        <CourseCover :slug="state.slug" :title="state.title" :image="state.image" :meta="metaLine" size="hero" />
      </div>

      <div class="crs-ov-body">
        <!-- the reader's card: where they stand and what is next, or what getting in takes; then the course's facts -->
        <div class="crs-ov-side">
          <div class="crs-side-card">
            <template v-if="state.enrollment">
              <div v-if="state.enrollment.completed_at" class="crs-done-head">
                <span class="crs-done-badge"><CourseIcon name="award" :size="22" /></span>
                <span><strong>{{ K.complete }}</strong><small>{{ K['complete-line'] }}</small></span>
              </div>
              <div v-else class="crs-ring-row">
                <ProgressRing :value="pct(state.done, state.total)" />
                <span class="crs-ring-words">
                  <strong>{{ fill(state.total < state.lessons.length ? K['progress-required'] : K.progress, { done: state.done, total: state.total }) }}</strong>
                  <small v-if="cohortStart">{{ fill(K.cohort, { date: day(cohortStart) }) }}</small>
                  <small v-else-if="!next && opening">{{ fill(K['next-opens'], { date: day(opening.opens_at) }) }}</small>
                </span>
              </div>
              <a v-if="next" class="btn solid crs-btn-block" :href="courseHref + '/' + next.key">
                <span class="crs-btn-main"><CourseIcon name="play" :size="14" />{{ state.done ? K.continue : K.start }}</span>
                <span class="crs-btn-sub">{{ next.title }}</span>
              </a>
              <a v-if="state.certificate_id" class="btn crs-btn-block" :class="{ solid: !next }" :href="ROUTES.certificates + '/' + state.certificate_id">
                <span class="crs-btn-main"><CourseIcon name="award" :size="15" />{{ K.certificate }}</span>
              </a>
              <a v-if="state.enrollment.completed_at && first" class="btn crs-btn-block" :href="courseHref + '/' + first.key">{{ K.review }}</a>
            </template>
            <template v-else>
              <p class="crs-access">{{ accessLine }}</p>
              <button v-if="state.access" type="button" class="btn solid crs-btn-block" :disabled="busy" @click="emit('enroll')">{{ K.start }}</button>
              <template v-else>
                <button v-if="!state.signed_in && state.free" type="button" class="btn solid crs-btn-block" @click="emit('sign-in')">{{ K['sign-in'] }}</button>
                <a v-if="state.skus.length" class="btn solid crs-btn-block" :href="'/store/products/' + state.skus[0]">{{ K.buy }}</a>
                <a v-if="state.tiers.length && !state.free" class="btn crs-btn-block" :class="{ solid: !state.skus.length }" href="/pricing">{{ K.member }}</a>
                <button v-if="!state.signed_in && !state.free" type="button" class="btn crs-btn-block" @click="emit('sign-in')">{{ K['sign-in'] }}</button>
              </template>
            </template>
            <p v-if="problem" class="crs-problem" role="alert">{{ problem }}</p>

            <ul class="crs-facts">
              <li><CourseIcon name="layers" :size="17" />{{ metaLine }}</li>
              <li><CourseIcon name="clock" :size="17" />{{ cadence }}</li>
              <li v-if="state.in_order"><CourseIcon name="order" :size="17" />{{ K['in-order'] }}</li>
              <li v-if="state.certificate"><CourseIcon name="award" :size="17" />{{ K['certificate-on'] }}</li>
            </ul>
          </div>
        </div>

        <div class="crs-ov-main">
          <div class="crs-bar-head">
            <h2>{{ K.curriculum }}</h2>
            <span class="crs-bar-head-meta">{{ metaLine }}</span>
            <button v-if="modules.length > 1" type="button" class="crs-text-btn" @click="toggleAll">{{ allOpen ? K.collapse : K.expand }}</button>
          </div>

          <div class="crs-modules">
            <div v-for="m in modules" :key="m.n" class="crs-module" :class="{ 'is-shut': !isOpen(m), 'is-finished': m.finished }">
              <button type="button" class="crs-module-head" :aria-expanded="isOpen(m)" @click="toggle(m)">
                <span class="crs-module-n" :class="{ 'is-done': m.finished }">
                  <CourseIcon v-if="m.finished" name="done" :size="26" />
                  <template v-else>{{ m.n }}</template>
                </span>
                <span class="crs-module-text">
                  <span class="crs-module-kicker">{{ fill(K['module-n'], { n: m.n }) }}</span>
                  <strong>{{ m.name || fill(K['module-n'], { n: m.n }) }}</strong>
                </span>
                <span class="crs-module-state">
                  <template v-if="m.finished">{{ K['module-complete'] }}</template>
                  <template v-else-if="state.enrollment && m.open">{{ fill(K['module-done'], { done: m.done, total: m.total }) }}</template>
                  <template v-else-if="state.enrollment && m.opensAt"><CourseIcon name="clock" :size="14" />{{ fill(K['module-opens'], { date: shortDay(m.opensAt) }) }}</template>
                  <template v-else>{{ m.lessons.length === 1 ? K['module-lesson'] : fill(K['module-lessons'], { n: m.lessons.length }) }}</template>
                </span>
                <CourseIcon name="down" :size="18" class="crs-module-chev" />
              </button>
              <span v-if="state.enrollment && m.total && m.open" class="crs-module-bar"><span :style="{ width: pct(m.done, m.total) + '%' }" /></span>
              <ol v-show="isOpen(m)" class="crs-lessons">
                <li v-for="l in m.lessons" :key="l.key">
                  <a class="crs-lesson-row" :class="{ 'is-closed': !l.open, 'is-done': l.done, 'is-next': next && l.key === next.key }" :href="courseHref + '/' + l.key">
                    <CourseIcon :name="l.done ? 'done' : l.open ? 'open' : 'closed'" :size="20" class="crs-mark" />
                    <span class="crs-lesson-text">
                      <span class="crs-lesson-title">{{ l.title }}</span>
                      <span class="crs-lesson-kind"><CourseIcon :name="kindOf(l)" :size="14" />{{ kindWord(l) }}<template v-if="!l.required"> · {{ S.optional }}</template></span>
                    </span>
                    <span v-if="next && l.key === next.key" class="crs-chip is-next">{{ K['up-next'] }}</span>
                    <span v-else-if="!l.open && l.why === 'not-yet' && l.opens_at" class="crs-lesson-when">{{ shortDay(l.opens_at) }}</span>
                    <CourseIcon v-else-if="l.open" name="chev" :size="16" class="crs-lesson-go" />
                  </a>
                </li>
              </ol>
            </div>
          </div>

          <div v-if="rest" class="crs-ov-about">
            <h2>{{ K.about }}</h2>
            <div class="crs-prose"><MarkdownDoc :source="rest" marks /></div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, h, ref, watch } from 'vue'
import { ROUTES } from 'platformkit/lib/router.js'
import MarkdownDoc from '../MarkdownDoc.vue'
import CourseCover from './CourseCover.vue'
import CourseIcon from './CourseIcon.vue'
import { words, fill, pct, day, shortDay, leadOf, restOf, modulesOf, kindOf, nextOpen, nextOpening, cadenceOf } from './course-ui.js'

const props = defineProps({
  base: { type: String, required: true },
  state: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  problem: { type: String, default: '' },
})
const emit = defineEmits(['enroll', 'sign-in'])
const { L, K, S } = words()

/* a ring that fills as the course does */
const ProgressRing = (p) => {
  const r = 26, c = 2 * Math.PI * r
  return h('span', { class: 'crs-ring' }, [
    h('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true' }, [
      h('circle', { cx: 32, cy: 32, r, class: 'crs-ring-track' }),
      h('circle', { cx: 32, cy: 32, r, class: 'crs-ring-fill', 'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - p.value / 100) }),
    ]),
    h('span', { class: 'crs-ring-n' }, fill(K.value.percent, { n: p.value })),
  ])
}
ProgressRing.props = ['value']

const courseHref = computed(() => props.base + '/' + (props.state ? props.state.slug : ''))
const lessons = computed(() => (props.state && props.state.lessons) || [])
const modules = computed(() => modulesOf(lessons.value))
const next = computed(() => (props.state && props.state.enrollment && !props.state.enrollment.completed_at ? nextOpen(lessons.value) : null))
const opening = computed(() => nextOpening(lessons.value))
const first = computed(() => lessons.value[0] || null)
const lead = computed(() => leadOf(props.state && props.state.about))
const rest = computed(() => restOf(props.state && props.state.about))
const cadence = computed(() => cadenceOf(props.state || {}, K.value))
const cohortStart = computed(() => { const s = props.state || {}; const e = s.enrollment; const c = e && (s.cohorts || []).find((x) => x.key === e.cohort); return c && new Date(c.starts_on) > new Date() ? c.starts_on : null })
const metaLine = computed(() => {
  const n = lessons.value.length, m = modules.value.length
  const ls = n === 1 ? L.value.lesson : fill(L.value.lessons, { n })
  return m > 1 ? `${ls} · ${fill(L.value.modules, { n: m })}` : ls
})
const accessLine = computed(() => { const s = props.state || {}; return s.free ? K.value.free : s.tiers && s.tiers.length && !(s.skus && s.skus.length) ? K.value.included : K.value.sold })
const kindWord = (l) => { const k = kindOf(l); return S.value['tag-' + k] || S.value['kind-' + k] || '' }

/* which modules are unfolded: the one holding the next lesson, or the first; the reader's own choice after that */
const shut = ref(null)
watch(() => props.state && props.state.slug, () => { shut.value = null })
const defaultOpen = computed(() => {
  const at = next.value ? modules.value.find((m) => m.lessons.some((l) => l.key === next.value.key)) : null
  return new Set([(at || modules.value[0] || {}).n])
})
const isOpen = (m) => (shut.value ? !shut.value.has(m.n) : defaultOpen.value.has(m.n))
function toggle(m) {
  const s = shut.value ? new Set(shut.value) : new Set(modules.value.filter((x) => !defaultOpen.value.has(x.n)).map((x) => x.n))
  if (s.has(m.n)) s.delete(m.n); else s.add(m.n)
  shut.value = s
}
const allOpen = computed(() => modules.value.every(isOpen))
function toggleAll() { shut.value = allOpen.value ? new Set(modules.value.map((m) => m.n)) : new Set() }
</script>

<!--
  THE LIBRARY (openspec: courses): /courses, or the community's Courses place. For a reader who is in a course, the one
  they were last in leads with its next lesson; then the rest they are taking, then what they finished, each with its
  certificate; then every other course, with what getting in takes. A guest, or somebody in nothing yet, sees the
  catalogue. All of it is courses_list's answer for this reader.
-->
<template>
  <div class="crs-wrap crs-lib">
    <div class="crs-lib-head">
      <h1>{{ L.title }}</h1>
      <p class="crs-lead">{{ L.sub }}</p>
    </div>

    <!-- waiting: the shapes of what is coming, not a dot in a corner -->
    <div v-if="loading && !list.length" class="crs-grid" aria-hidden="true">
      <div v-for="i in 3" :key="i" class="crs-card is-ghost"><span class="crs-cover is-card" /><span class="crs-card-body"><span class="crs-ghost-line" /><span class="crs-ghost-line is-short" /></span></div>
    </div>

    <div v-else-if="!list.length" class="crs-empty">
      <span class="crs-empty-ico"><CourseIcon name="layers" :size="26" /></span>
      <h2>{{ L['empty-title'] }}</h2>
      <p>{{ L['empty-body'] }}</p>
      <a v-if="isStaff" class="btn solid" href="/admin/courses">{{ L['empty-staff'] }}</a>
    </div>

    <template v-else>
      <!-- the course they were last in, and the one thing to do next in it -->
      <div v-if="current" class="crs-hero-card">
        <a class="crs-hero-cover" :href="hrefOf(current)" tabindex="-1" aria-hidden="true">
          <CourseCover :slug="current.slug" :title="current.title" :image="current.image" :meta="metaOf(current)" size="hero" />
        </a>
        <div class="crs-hero-text">
          <p class="crs-kicker">{{ L['continue-kicker'] }}</p>
          <h2 class="crs-hero-title"><a :href="hrefOf(current)">{{ current.title }}</a></h2>
          <p v-if="current.next" class="crs-hero-next">
            <CourseIcon name="play" :size="14" />
            <span><span v-if="current.next.section" class="crs-hero-section">{{ current.next.section }} · </span>{{ current.next.title }}</span>
          </p>
          <p v-else-if="current.next_opens_at" class="crs-hero-next is-wait"><CourseIcon name="clock" :size="15" />{{ fill(L['next-opens'], { date: day(current.next_opens_at) }) }}</p>
          <div class="crs-progress">
            <span class="crs-bar"><span :style="{ width: pct(current.done, current.total) + '%' }" /></span>
            <span class="crs-progress-words">{{ fill(L.progress, { done: current.done, total: current.total }) }} · {{ fill(L.percent, { n: pct(current.done, current.total) }) }}</span>
          </div>
          <div class="crs-hero-acts">
            <a v-if="current.next" class="btn solid crs-btn-ico" :href="hrefOf(current) + '/' + current.next.key"><CourseIcon name="play" :size="14" />{{ current.done ? L.continue : L.start }}</a>
            <a class="btn" :href="hrefOf(current)">{{ L.overview }}</a>
          </div>
        </div>
      </div>

      <div v-if="others.length" class="crs-shelf">
        <h2 class="crs-shelf-title">{{ L['in-progress'] }}<span class="crs-count">{{ others.length }}</span></h2>
        <ul class="crs-grid">
          <li v-for="c in others" :key="c.slug"><CourseCard :c="c" /></li>
        </ul>
      </div>

      <div v-if="finished.length" class="crs-shelf">
        <h2 class="crs-shelf-title">{{ L['finished-title'] }}<span class="crs-count">{{ finished.length }}</span></h2>
        <ul class="crs-grid">
          <li v-for="c in finished" :key="c.slug"><CourseCard :c="c" /></li>
        </ul>
      </div>

      <div v-if="catalogue.length" class="crs-shelf">
        <h2 v-if="mine.length" class="crs-shelf-title">{{ L.more }}<span class="crs-count">{{ catalogue.length }}</span></h2>
        <ul class="crs-grid">
          <li v-for="c in catalogue" :key="c.slug"><CourseCard :c="c" /></li>
        </ul>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, h, ref, watch } from 'vue'
import { user, isStaff } from 'platformkit/lib/auth.js'
import { ROUTES } from 'platformkit/lib/router.js'
import { setHead } from 'platformkit/lib/seo.js'
import { words, fill, pct, day, leadOf, rpc } from './course-ui.js'
import CourseCover from './CourseCover.vue'
import CourseIcon from './CourseIcon.vue'

const props = defineProps({ base: { type: String, default: '/courses' } })
const { L } = words()
const list = ref([]), loading = ref(true)

watch(() => (user.value ? user.value.id : null), async () => {
  loading.value = true
  try { list.value = (await rpc('courses_list')) || [] } catch (e) { console.warn('courses:', e.message || e) }
  loading.value = false
}, { immediate: true })
setHead({ title: L.value.title })

const hrefOf = (c) => props.base + '/' + c.slug
const lessonsWord = (n) => (n === 1 ? L.value.lesson : fill(L.value.lessons, { n }))
const modulesWord = (n) => (n === 1 ? L.value.module : fill(L.value.modules, { n }))
const metaOf = (c) => (c.sections > 1 ? `${lessonsWord(c.lessons)} · ${modulesWord(c.sections)}` : lessonsWord(c.lessons))

/* what they are taking, the last one they were in first; what they finished; and everything else */
const mine = computed(() => list.value.filter((c) => c.enrolled))
const taking = computed(() => mine.value.filter((c) => !c.completed_at).sort((a, b) => String(b.last_at || '').localeCompare(String(a.last_at || ''))))
const current = computed(() => taking.value[0] || null)
const others = computed(() => taking.value.slice(1))
const finished = computed(() => mine.value.filter((c) => c.completed_at))
const catalogue = computed(() => list.value.filter((c) => !c.enrolled))

/* what getting into a course takes, said from where this reader stands */
const accessOf = (c) => {
  if (c.access) return c.free ? L.value['access-free'] : L.value['access-yours']
  if (c.free) return L.value['access-free-sign-in']
  if (c.skus && c.skus.length) return L.value['access-buy']
  return L.value['access-members']
}

/* one course on a shelf: the cover and the title are the way in; the certificate is a way of its own */
const CourseCard = (p) => {
  const c = p.c
  const foot = c.completed_at
    ? [h('span', { class: 'crs-card-state is-done' }, [h(CourseIcon, { name: 'done', size: 16 }), L.value.finished]),
       c.certificate_id ? h('a', { class: 'crs-card-cert', href: ROUTES.certificates + '/' + c.certificate_id }, [h(CourseIcon, { name: 'award', size: 15 }), L.value.certificate]) : null]
    : c.enrolled
      ? [h('span', { class: 'crs-progress' }, [h('span', { class: 'crs-bar' }, [h('span', { style: { width: pct(c.done, c.total) + '%' } })]),
          h('span', { class: 'crs-progress-words' }, fill(L.value.percent, { n: pct(c.done, c.total) }))]),
         c.next ? h('span', { class: 'crs-card-next' }, fill(L.value.next, { title: c.next.title }))
           : c.next_opens_at ? h('span', { class: 'crs-card-next' }, fill(L.value['next-opens'], { date: day(c.next_opens_at) })) : null]
      : [h('span', { class: 'crs-card-meta' }, metaOf(c)), h('span', { class: ['crs-chip', c.access ? 'is-yours' : ''] }, accessOf(c))]
  return h('div', { class: ['crs-card', { 'is-enrolled': c.enrolled }] }, [
    h(CourseCover, { slug: c.slug, title: c.title, image: c.image, size: 'card' }),
    h('span', { class: 'crs-card-body' }, [
      h('a', { class: 'crs-card-title', href: hrefOf(c) }, c.title),
      !c.enrolled && c.about ? h('span', { class: 'crs-card-about' }, leadOf(c.about)) : null,
      h('span', { class: ['crs-card-foot', { 'is-row': !c.enrolled || c.completed_at }] }, foot),
    ]),
  ])
}
CourseCard.props = ['c']
</script>

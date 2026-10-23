<!--
  THE COURSES THEMSELVES (openspec: courses): the list, a course and a lesson, drawn the same wherever they live —
  on pages of their own (pages/CoursesPage.vue, at /courses) or as a place of the community (CoursesPlace.vue, at
  <community>/courses; courses.where). `base` is the address they live at and `path` what follows it: '' the list,
  '<slug>' a course, '<slug>/<lesson>' a lesson.

  Everything shown is the database's answer for this reader: course_state for the outline and what is open,
  course_lesson for a lesson's text (it sends none for a closed lesson), course_complete to finish one. Nothing here
  decides what is open; it only says why something is not, in the words of content/ui/courses.md.

  Divs throughout, not header/section/main: the theme styles those elements as a landing page's bands.
-->
<template>
    <div class="crs" :class="{ 'is-place': place }">
      <!-- every course -->
      <div v-if="view === 'list'" class="crs-wrap">
        <div class="crs-top">
          <h1>{{ L.title }}</h1>
          <p class="crs-lead">{{ L.sub }}</p>
        </div>
        <p v-if="loading" class="crs-quiet">…</p>
        <ul v-else-if="list.length" class="crs-grid">
          <li v-for="c in list" :key="c.slug">
            <a class="crs-card" :href="base + '/' + c.slug">
              <span v-if="c.image" class="crs-card-img"><img :src="c.image" alt="" /></span>
              <span class="crs-card-body">
                <strong class="crs-card-title">{{ c.title }}</strong>
                <span v-if="c.about" class="crs-card-about">{{ firstLine(c.about) }}</span>
                <span class="crs-card-foot">
                  <span class="crs-card-meta">{{ c.completed_at ? L.finished : c.enrolled ? fill(L.progress, { done: c.done, total: c.total }) : fill(L.lessons, { n: c.lessons }) }}</span>
                  <span v-if="c.enrolled" class="crs-bar" :class="{ 'is-full': c.completed_at }"><span :style="{ width: pct(c.done, c.total) + '%' }" /></span>
                </span>
              </span>
            </a>
          </li>
        </ul>
        <div v-else class="crs-empty">
          <h2>{{ L['empty-title'] }}</h2>
          <p>{{ L['empty-body'] }}</p>
          <a v-if="isStaff" class="btn" href="/admin/courses">{{ L['empty-staff'] }}</a>
        </div>
      </div>

      <!-- a course -->
      <div v-else-if="view === 'course'" class="crs-wrap">
        <p v-if="loading && !state" class="crs-quiet">…</p>
        <div v-else-if="!state" class="crs-empty"><h2>{{ K.missing }}</h2><a class="btn" :href="listHref">{{ L.title }}</a></div>
        <template v-else>
          <div class="crs-intro" :class="{ 'has-img': state.image }">
            <div class="crs-intro-text">
              <p class="crs-kicker">{{ K.kicker }}</p>
              <h1>{{ state.title }}</h1>
              <div v-if="state.about" class="crs-about"><MarkdownDoc :source="state.about" /></div>
              <ul class="crs-facts">
                <li>{{ fill(K.lessons, { n: state.lessons.length }) }}</li>
                <li>{{ cadence }}</li>
                <li v-if="state.in_order">{{ K['in-order'] }}</li>
                <li v-if="state.certificate">{{ K['certificate-on'] }}</li>
              </ul>
            </div>
            <img v-if="state.image" :src="state.image" alt="" class="crs-cover" />
          </div>

          <!-- where the reader stands, and the one thing to do next -->
          <div class="crs-panel">
            <template v-if="state.enrollment">
              <div class="crs-panel-main">
                <p class="crs-kicker">{{ K['your-progress'] }}</p>
                <p class="crs-panel-line">{{ state.enrollment.completed_at ? K.complete : fill(state.total < state.lessons.length ? K['progress-required'] : K.progress, { done: state.done, total: state.total }) }}</p>
                <span class="crs-bar" :class="{ 'is-full': state.enrollment.completed_at }"><span :style="{ width: pct(state.done, state.total) + '%' }" /></span>
                <p v-if="!state.enrollment.completed_at && !nextLesson && nextOpening" class="crs-quiet">{{ fill(K['next-opens'], { date: day(nextOpening.opens_at) }) }}</p>
                <p v-if="cohortStart" class="crs-quiet">{{ fill(K.cohort, { date: day(cohortStart) }) }}</p>
              </div>
              <div class="crs-panel-act">
                <a v-if="state.certificate_id" class="btn" :href="ROUTES.certificates + '/' + state.certificate_id">{{ K.certificate }}</a>
                <a v-if="nextLesson" class="btn solid" :href="courseHref + '/' + nextLesson.key">{{ state.done ? K.continue : K.start }}<span class="crs-btn-sub">{{ nextLesson.title }}</span></a>
                <a v-else-if="state.enrollment.completed_at && firstLesson" class="btn" :href="courseHref + '/' + firstLesson.key">{{ K.review }}</a>
              </div>
            </template>
            <template v-else>
              <div class="crs-panel-main">
                <p class="crs-panel-line">{{ accessLine }}</p>
              </div>
              <div class="crs-panel-act">
                <button v-if="state.access" type="button" class="btn solid" :disabled="busy" @click="enroll">{{ K.start }}</button>
                <template v-else>
                  <button v-if="!state.signed_in && state.free" type="button" class="btn solid" @click="signIn">{{ K['sign-in'] }}</button>
                  <a v-if="state.skus.length" class="btn solid" :href="'/store/products/' + state.skus[0]">{{ K.buy }}</a>
                  <a v-if="state.tiers.length && !state.free" class="btn" :class="{ solid: !state.skus.length }" href="/pricing">{{ K.member }}</a>
                  <button v-if="!state.signed_in && !state.free" type="button" class="btn" @click="signIn">{{ K['sign-in'] }}</button>
                </template>
              </div>
            </template>
          </div>
          <p v-if="problem" class="crs-problem" role="alert">{{ problem }}</p>

          <h2 class="crs-h2">{{ K.outline }}</h2>
          <div class="crs-syllabus">
            <div v-for="(g, i) in sections" :key="i" class="crs-syl-group">
              <p v-if="g.name" class="crs-syl-section">{{ g.name }}</p>
              <ol class="crs-syl-list">
                <li v-for="l in g.lessons" :key="l.key">
                  <a class="crs-syl-row" :class="{ 'is-closed': !l.open && !staffOpen(l) }" :href="courseHref + '/' + l.key">
                    <span class="crs-num">{{ l.n }}</span>
                    <span class="crs-syl-title">{{ l.title }}<span v-if="l.kind !== 'text'" class="crs-tag">{{ kindWord(l.kind) }}</span><span v-if="!l.required" class="crs-tag crs-tag-opt">{{ S.optional }}</span></span>
                    <span class="crs-state"><StateMark :l="l" /><span class="crs-state-word">{{ stateWord(l) }}</span></span>
                  </a>
                </li>
              </ol>
            </div>
          </div>
        </template>
      </div>

      <!-- a lesson -->
      <div v-else class="crs-wrap crs-lesson">
        <p v-if="loading && !state" class="crs-quiet">…</p>
        <div v-else-if="!state" class="crs-empty"><h2>{{ K.missing }}</h2><a class="btn" :href="listHref">{{ L.title }}</a></div>
        <template v-else>
          <nav class="crs-side" :aria-label="K.outline">
            <a class="crs-back" :href="courseHref">← {{ state.title }}</a>
            <span v-if="state.enrollment" class="crs-bar crs-side-bar"><span :style="{ width: pct(state.done, state.total) + '%' }" /></span>
            <div v-for="(g, i) in sections" :key="i">
              <p v-if="g.name" class="crs-syl-section">{{ g.name }}</p>
              <ol class="crs-side-list">
                <li v-for="l in g.lessons" :key="l.key">
                  <a :href="courseHref + '/' + l.key" :class="{ 'is-here': l.key === lessonKey, 'is-closed': !l.open }" :aria-current="l.key === lessonKey ? 'page' : null">
                    <StateMark :l="l" />
                    <span>{{ l.title }}</span>
                  </a>
                </li>
              </ol>
            </div>
          </nav>

          <div class="crs-body">
            <a class="crs-back crs-back-top" :href="courseHref">← {{ state.title }}</a>
            <p v-if="loading && !lesson" class="crs-quiet">…</p>
            <template v-else-if="lesson && lesson.open">
              <p class="crs-kicker">{{ here && here.section ? here.section + ' · ' : '' }}{{ fill(S.of || '{n} of {total}', { n: hereAt + 1, total: lessons.length }) }}</p>
              <h1>{{ lesson.title }}</h1>
              <MediaBlock v-if="tracks.length" :media="tracks" class="crs-media" />
              <div v-if="lesson.body" class="crs-about"><MarkdownDoc :source="lesson.body" /></div>
              <div v-if="lesson.kind !== 'text'" class="crs-pointer">
                <span class="crs-pointer-kind">{{ S['kind-' + lesson.kind] }}</span>
                <a class="btn" :href="pointerHref(lesson)">{{ S.open }} →</a>
              </div>
              <div v-if="downloads.length" class="crs-downloads">
                <p class="crs-kicker">{{ S.downloads }}</p>
                <a v-for="d in downloads" :key="d.src" class="crs-download" :href="d.src" download>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v10m0 0-4-4m4 4 4-4M4 16h12" /></svg>
                  <span>{{ d.title || d.src.split('/').pop() }}</span>
                </a>
              </div>
              <div class="crs-done-bar">
                <p v-if="problem" class="crs-problem" role="alert">{{ problem }}</p>
                <span v-if="here && here.done" class="crs-done-mark"><StateMark :l="{ done: true, open: true }" />{{ S.done }}</span>
                <button v-else type="button" class="btn solid" :disabled="busy" @click="complete">{{ markWord }}</button>
              </div>
            </template>
            <div v-else-if="here" class="crs-closed">
              <StateMark :l="here" big />
              <h1>{{ here.title }}</h1>
              <p>{{ whyWord(here) }}</p>
              <button v-if="here.why === 'not-enrolled' && state.access" type="button" class="btn solid" :disabled="busy" @click="enroll">{{ K.start }}</button>
              <button v-else-if="here.why === 'sign-in'" type="button" class="btn solid" @click="signIn">{{ K['sign-in'] }}</button>
              <a v-else-if="here.why === 'in-order' && prevLesson" class="btn solid" :href="courseHref + '/' + prevLesson.key">{{ S.previous }}: {{ prevLesson.title }}</a>
              <a v-else class="btn" :href="courseHref">{{ S.back }}</a>
            </div>
            <nav class="crs-step" :aria-label="S.steps || 'Lessons'">
              <a v-if="prevLesson" :href="courseHref + '/' + prevLesson.key"><span>← {{ S.previous }}</span>{{ prevLesson.title }}</a><span v-else />
              <a v-if="nextAfter" class="crs-step-next" :href="courseHref + '/' + nextAfter.key"><span>{{ S.next }} →</span>{{ nextAfter.title }}</a>
            </nav>
          </div>
        </template>
      </div>
    </div>
</template>

<script setup>
import { computed, ref, watch, h } from 'vue'
import { ROUTES } from 'platformkit/lib/router.js'
import { us } from 'platformkit/lib/content.js'
import { supabase } from 'platformkit/lib/supabase.js'
import { user, isStaff } from 'platformkit/lib/auth.js'
import { capture } from 'platformkit/lib/analytics.js'
import { setHead } from 'platformkit/lib/seo.js'
import MarkdownDoc from '../MarkdownDoc.vue'
import MediaBlock from '../content/MediaBlock.vue'

const props = defineProps({
  /* the address the courses live at, and what follows it */
  base: { type: String, default: '/courses' },
  path: { type: String, default: '' },
  /* drawn inside the community's frame rather than a page of its own */
  place: { type: Boolean, default: false },
})

/* a lesson's state as a mark: done (a tick), open (a ring), not open yet (a lock) — the same mark in every list */
const StateMark = (props) => {
  const l = props.l || {}
  const kind = l.done ? 'done' : l.open ? 'open' : 'closed'
  const paths = {
    done: [h('circle', { cx: 10, cy: 10, r: 8 }), h('path', { d: 'm6.5 10.2 2.4 2.4 4.6-5' })],
    open: [h('circle', { cx: 10, cy: 10, r: 7.25 })],
    closed: [h('rect', { x: 5.5, y: 9, width: 9, height: 7, rx: 1.5 }), h('path', { d: 'M7.5 9V7a2.5 2.5 0 0 1 5 0v2' })],
  }
  return h('svg', { class: ['crs-mark', 'is-' + kind, props.big !== undefined && props.big !== false ? 'is-big' : ''], viewBox: '0 0 20 20', 'aria-hidden': 'true' }, paths[kind])
}
StateMark.props = ['l', 'big']

const W = computed(() => us('courses').page || {})
const L = computed(() => W.value.list || {}), K = computed(() => W.value.course || {}), S = computed(() => W.value.lesson || {}), C = computed(() => W.value.certificate || {})
const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : String(m[k])))
const pct = (d, t) => (t ? Math.round((100 * d) / t) : 0)
const firstLine = (s) => String(s || '').split(/\n\s*\n/)[0].replace(/[#*_>`]/g, '').trim()
const day = (iso) => { try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)) } catch { return String(iso || '') } }
const shortDay = (iso) => { try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(iso)) } catch { return '' } }

/* where we are, under the base: '' · <slug> · <slug>/<lesson> */
const parts = computed(() => String(props.path || '').split('/').filter(Boolean))
const view = computed(() => (parts.value.length >= 2 ? 'lesson' : parts.value.length === 1 ? 'course' : 'list'))
const slug = computed(() => parts.value[0] || null)
const lessonKey = computed(() => (view.value === 'lesson' ? parts.value[1] : null))
const listHref = computed(() => props.base)
const courseHref = computed(() => props.base + '/' + slug.value)

const loading = ref(false), busy = ref(false), problem = ref('')
const list = ref([]), state = ref(null), lesson = ref(null)
const rpc = async (fn, args) => { if (!supabase) return null; const { data, error } = await supabase.rpc(fn, args); if (error) throw error; return data }

async function load() {
  loading.value = true; problem.value = ''
  try {
    if (view.value === 'list') { list.value = (await rpc('courses_list')) || []; setHead({ title: L.value.title }) }
    else {
      if (!state.value || state.value.slug !== slug.value) state.value = await rpc('course_state', { p_course: slug.value })
      lesson.value = view.value === 'lesson' ? await rpc('course_lesson', { p_course: slug.value, p_lesson: lessonKey.value }) : null
      setHead({ title: lesson.value && lesson.value.title ? `${lesson.value.title} — ${state.value && state.value.title}` : state.value ? state.value.title : K.value.missing, description: state.value ? firstLine(state.value.about) : '' })
    }
  } catch (e) { console.warn('courses:', e.message || e) }
  loading.value = false
}
watch([() => props.path, () => (user.value ? user.value.id : null)], (now, before) => {
  const was = before ? before[1] : undefined
  /* somebody signing in or out sees the course afresh */
  if (view.value === 'list' || (user.value ? user.value.id : null) !== was) state.value = null
  load()
  if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
}, { immediate: true })

/* the outline, numbered and gathered under its sections in order */
const lessons = computed(() => ((state.value && state.value.lessons) || []).map((l, i) => ({ ...l, n: i + 1 })))
const sections = computed(() => {
  const out = []
  for (const l of lessons.value) {
    const last = out[out.length - 1]
    if (last && last.name === (l.section || '')) last.lessons.push(l)
    else out.push({ name: l.section || '', lessons: [l] })
  }
  return out
})
const here = computed(() => lessons.value.find((l) => l.key === lessonKey.value) || null)
const hereAt = computed(() => lessons.value.findIndex((l) => l.key === lessonKey.value))
const prevLesson = computed(() => (hereAt.value > 0 ? lessons.value[hereAt.value - 1] : null))
const nextAfter = computed(() => (hereAt.value >= 0 && hereAt.value < lessons.value.length - 1 ? lessons.value[hereAt.value + 1] : null))
const firstLesson = computed(() => lessons.value[0] || null)
const nextLesson = computed(() => lessons.value.find((l) => l.open && !l.done) || null)
const nextOpening = computed(() => lessons.value.find((l) => !l.open && l.why === 'not-yet') || null)
const cohortStart = computed(() => { const e = state.value && state.value.enrollment; const c = e && (state.value.cohorts || []).find((x) => x.key === e.cohort); return c && new Date(c.starts_on) > new Date() ? c.starts_on : null })
const staffOpen = () => false

/* what the course asks of somebody, in a line */
const cadence = computed(() => {
  const s = state.value || {}
  if (s.release === 'all' || !s.every_days) return K.value['all-at-once']
  if (s.drip === 'section') return fill(K.value['every-section'], { n: s.every_days })
  return s.every_days === 1 ? K.value['every-day'] : fill(K.value['every-days'], { n: s.every_days })
})
const accessLine = computed(() => { const s = state.value || {}; return s.free ? K.value.free : s.tiers && s.tiers.length && !(s.skus && s.skus.length) ? K.value.included : K.value.sold })
const kindWord = (k) => (S.value['tag-' + k] || '')
const stateWord = (l) => (l.done ? S.value.done : l.open ? '' : l.why === 'not-yet' && l.opens_at ? shortDay(l.opens_at) : '')

const tracks = computed(() => ((lesson.value && lesson.value.media) || []).filter((m) => m.type !== 'file'))
const downloads = computed(() => ((lesson.value && lesson.value.media) || []).filter((m) => m.type === 'file'))
const markWord = computed(() => ({ chapter: S.value.read, article: S.value.read, form: S.value.answered, session: S.value.booked }[lesson.value && lesson.value.kind] || S.value.mark))
function pointerHref(l) {
  const ref = String(l.ref || '')
  if (l.kind === 'chapter') { const [book, n] = ref.split('#'); return `/content/books/${book}${n ? `?chapter=${n}` : ''}` }
  return { article: '/content/articles/', form: '/form/', session: '/book/' }[l.kind] + ref
}
const whyWord = (l) => (l.why === 'not-yet' ? fill(S.value['not-yet'], { date: day(l.opens_at) }) : S.value[l.why] || '')

function signIn() { if (window.DLauth) window.DLauth.open({}) }
async function enroll() {
  busy.value = true; problem.value = ''
  try {
    const r = await rpc('course_enroll', { p_course: slug.value })
    if (r && r.error) problem.value = S.value[r.error] || r.error
    else { state.value = r; capture('course_started', { course: slug.value }); if (view.value === 'lesson') await load() }
  } catch (e) { problem.value = String(e.message || e) }
  busy.value = false
}
async function complete() {
  busy.value = true; problem.value = ''
  try {
    const r = await rpc('course_complete', { p_course: slug.value, p_lesson: lessonKey.value })
    if (r && r.error) problem.value = S.value[r.error] || r.error
    else { state.value = r; capture('lesson_completed', { course: slug.value, lesson: lessonKey.value }) }
  } catch (e) { problem.value = String(e.message || e) }
  busy.value = false
}
</script>

<style scoped>
.crs { padding: 48px 24px 88px; }
/* in the community the frame has its own margins */
.crs.is-place { padding: 28px 28px 64px; height: 100%; overflow-y: auto; box-sizing: border-box; }   /* a place scrolls inside the community's pane, as its feed does */
.crs.is-place .crs-side { top: 24px; max-height: calc(100dvh - 48px); }
.crs-wrap { width: 100%; max-width: 1080px; margin: 0 auto; }
.crs h1 { margin: 0 0 14px; max-width: 22ch; }
.crs-quiet { color: var(--ink3); font-size: 14px; margin: 0; }
.crs-kicker { font-family: var(--m); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3); margin: 0 0 10px; }
.crs-lead { font-size: 18px; color: var(--ink2); margin: 0; max-width: 60ch; }
.crs-top { margin-bottom: 36px; }
.crs-h2 { font-size: 22px; margin: 48px 0 16px; }
.crs-about :deep(.purpose) { padding: 0; border: 0; }
.crs-about :deep(.purpose p:last-child) { margin-bottom: 0; }

/* the list */
.crs-grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.crs-card { display: flex; flex-direction: column; height: 100%; border: 1px solid var(--hair); border-radius: 16px; overflow: hidden; text-decoration: none; color: inherit; background: var(--card); transition: border-color .15s, transform .15s; }
.crs-card:hover { border-color: var(--ink3); transform: translateY(-2px); }
.crs-card-img { display: block; aspect-ratio: 16 / 9; background: var(--wash, var(--hair)); }
.crs-card-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.crs-card-body { display: flex; flex-direction: column; gap: 8px; padding: 18px 20px 20px; flex: 1; }
.crs-card-title { font-size: 18px; color: var(--ink); }
.crs-card-about { color: var(--ink2); font-size: 14.5px; line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.crs-card-foot { margin-top: auto; padding-top: 10px; display: grid; gap: 8px; }
.crs-card-meta { font-family: var(--m); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); }

.crs-bar { display: block; height: 4px; border-radius: 2px; background: var(--hair); overflow: hidden; }
.crs-bar > span { display: block; height: 100%; background: var(--accent); border-radius: 2px; }

/* empty and missing */
.crs-empty { border: 1px dashed var(--hair); border-radius: 16px; padding: 40px 32px; display: grid; gap: 10px; justify-items: start; }
.crs-empty h2 { margin: 0; font-size: 20px; }
.crs-empty p { margin: 0 0 6px; color: var(--ink2); max-width: 52ch; }

/* the course */
.crs-intro { display: grid; gap: 40px; align-items: start; }
.crs-intro.has-img { grid-template-columns: minmax(0, 1fr) 340px; }
.crs-cover { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 16px; border: 1px solid var(--hair); }
.crs-facts { list-style: none; margin: 20px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.crs-facts li { font-size: 13px; color: var(--ink2); padding: 5px 12px; border: 1px solid var(--hair); border-radius: 999px; }
.crs-panel { margin-top: 32px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 20px 32px; padding: 22px 24px; border: 1px solid var(--hair); border-radius: 16px; background: var(--card); }
.crs-panel-main { flex: 1 1 260px; display: grid; gap: 10px; min-width: 0; }
.crs-panel-main .crs-kicker { margin: 0; }
.crs-panel-line { margin: 0; font-size: 17px; font-weight: 600; color: var(--ink); }
.crs-panel-act { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.crs-panel-act .btn { text-decoration: none; display: inline-flex; flex-direction: column; align-items: center; line-height: 1.25; }
.crs-btn-sub { font-weight: 400; font-size: 12px; opacity: .75; max-width: 24ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crs-problem { color: #c4362a; font-size: 14px; margin: 12px 0 0; }

/* the syllabus */
.crs-syllabus { border: 1px solid var(--hair); border-radius: 16px; overflow: hidden; background: var(--card); }
.crs-syl-group + .crs-syl-group { border-top: 1px solid var(--hair); }
.crs-syl-section { font-family: var(--m); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3); margin: 0; padding: 16px 20px 6px; }
.crs-syl-list { list-style: none; margin: 0; padding: 0 0 8px; }
.crs-syl-row { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 11px 20px; text-decoration: none; color: var(--ink); }
.crs-syl-row:hover { background: color-mix(in srgb, var(--ink) 4%, transparent); }
.crs-syl-row.is-closed { color: var(--ink3); }
.crs-num { font-family: var(--m); font-size: 12px; color: var(--ink3); text-align: right; }
.crs-syl-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; font-size: 15.5px; }
.crs-tag { font-family: var(--m); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); padding: 2px 7px; border: 1px solid var(--hair); border-radius: 999px; }
.crs-tag-opt { border-style: dashed; }
.crs-state { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink3); white-space: nowrap; }

/* the marks */
.crs :deep(.crs-mark) { width: 18px; height: 18px; flex: 0 0 18px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.crs :deep(.crs-mark.is-done) { color: var(--accent); }
.crs :deep(.crs-mark.is-done circle) { fill: var(--accent); stroke: var(--accent); }
.crs :deep(.crs-mark.is-done path) { stroke: var(--paper); stroke-width: 2; }
.crs :deep(.crs-mark.is-open) { color: var(--ink3); }
.crs :deep(.crs-mark.is-closed) { color: var(--ink3); opacity: .8; }
.crs :deep(.crs-mark.is-big) { width: 40px; height: 40px; flex-basis: 40px; margin-bottom: 14px; }

/* a lesson */
.crs-lesson { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 56px; align-items: start; }
.crs-side { position: sticky; top: calc(var(--headh, 68px) + 24px); display: grid; gap: 4px; max-height: calc(100dvh - var(--headh, 68px) - 48px); overflow: auto; padding-bottom: 8px; }
.crs-back { font-weight: 600; color: var(--ink); text-decoration: none; font-size: 15px; margin-bottom: 8px; }
.crs-back:hover { text-decoration: underline; }
.crs-side-bar { margin-bottom: 6px; }
.crs-back-top { display: none; }
.crs-side .crs-syl-section { padding: 14px 10px 4px; }
.crs-side-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; }
.crs-side-list a { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; text-decoration: none; color: var(--ink2); font-size: 14.5px; line-height: 1.35; }
.crs-side-list a:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); }
.crs-side-list a.is-here { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--ink); font-weight: 600; }
.crs-side-list a.is-closed { color: var(--ink3); }
.crs-body { min-width: 0; max-width: 720px; }
.crs-body h1 { margin-bottom: 22px; }
.crs-media { margin: 0 0 28px; border-radius: 14px; overflow: hidden; }
.crs-pointer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px; margin: 24px 0; padding: 18px 20px; border: 1px solid var(--hair); border-radius: 14px; background: var(--card); }
.crs-pointer-kind { font-size: 15px; color: var(--ink); font-weight: 600; }
.crs-pointer .btn { text-decoration: none; }
.crs-downloads { margin: 28px 0 0; display: grid; gap: 8px; justify-items: start; }
.crs-downloads .crs-kicker { margin: 0 0 2px; }
.crs-download { display: inline-flex; align-items: center; gap: 10px; padding: 10px 16px; border: 1px solid var(--hair); border-radius: 12px; color: var(--ink); text-decoration: none; font-size: 14.5px; }
.crs-download:hover { border-color: var(--ink3); }
.crs-download svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.crs-done-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 36px; padding-top: 24px; border-top: 1px solid var(--hair); }
.crs-done-bar .crs-problem { flex-basis: 100%; margin: 0; }
.crs-done-bar .btn { text-decoration: none; }
.crs-done-mark { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; color: var(--ink); }
.crs-closed { padding: 48px 32px; border: 1px dashed var(--hair); border-radius: 16px; display: grid; justify-items: start; }
.crs-closed h1 { font-size: clamp(26px, 3.5vw, 34px); margin-bottom: 8px; }
.crs-closed p { color: var(--ink2); margin: 0 0 20px; }
.crs-closed .btn { text-decoration: none; }
.crs-step { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 56px; }
.crs-step a { display: grid; gap: 4px; padding: 14px 16px; border: 1px solid var(--hair); border-radius: 14px; text-decoration: none; color: var(--ink); font-weight: 600; font-size: 15px; }
.crs-step a:hover { border-color: var(--ink3); }
.crs-step a span { font-family: var(--m); font-weight: 400; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); }
.crs-step-next { text-align: right; grid-column: 2; }

@media (max-width: 860px) {
  .crs-intro.has-img { grid-template-columns: 1fr; }
  .crs-cover { order: -1; aspect-ratio: 16 / 9; }
  .crs-lesson { grid-template-columns: 1fr; gap: 32px; }
  .crs-side { position: static; max-height: none; order: 2; padding-top: 24px; border-top: 1px solid var(--hair); }
  .crs-back-top { display: inline-block; font-size: 14px; margin-bottom: 18px; }
}
@media (max-width: 560px) {
  .crs { padding: 28px 16px 64px; }
  .crs-panel { padding: 18px; }
  .crs-panel-act, .crs-panel-act .btn { width: 100%; }
  .crs-syl-row { grid-template-columns: 22px minmax(0, 1fr) auto; gap: 10px; padding: 11px 14px; }
  .crs-syl-section { padding: 14px 14px 4px; }
  .crs-state-word { display: none; }
  .crs-step { grid-template-columns: 1fr; }
  .crs-step-next { grid-column: auto; }
}
</style>

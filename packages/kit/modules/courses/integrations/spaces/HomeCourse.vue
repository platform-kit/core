<script setup lang="ts">
/*
 * HOME'S COURSE CARD (openspec: community-home), spaces' home slot: a card the width of the page, above Reading, for the
 * courses on the site. Each course is in one of three states, drawn the way Reading draws its books:
 *   not started   the course's cover, its first line and what it holds, and Start the course — the invitation
 *   under way     the bar, how many lessons are done and the next one, and Continue, which opens that lesson
 *   finished      the full bar and Finished, and Review
 * The one under way leads; with one course, it is drawn large beside its cover. A course the reader may not open yet
 * is still offered: its page says what opens it. Words: ## home in the courses strings.
 */
import { ref, computed, onMounted } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { navigate, COURSES_PLACE_BASE } from 'platformkit/lib/router.js'
import { rpc, fill, pct, day, leadOf } from '../../ui/course-ui.js'
import CourseCover from '../../ui/CourseCover.vue'
import '../../ui/courses.css'

const emit = defineEmits(['state'])
const W = computed(() => us('courses').home.main)
const list = ref<any[]>([])
const LIMIT = 3

const stateOf = (c: any) => (c.completed_at ? 'done' : c.enrolled && (c.done > 0 || c.next) ? 'going' : 'new')
onMounted(async () => {
  let all: any[] = []
  try { all = (await rpc('courses_list')) || [] } catch { all = [] }
  /* under way first, most recently worked in; then not started; then finished */
  const rank: any = { going: 0, new: 1, done: 2 }
  list.value = all.map((c) => ({ ...c, state: stateOf(c) }))
    .sort((a, b) => rank[a.state] - rank[b.state] || String(b.last_at || '').localeCompare(String(a.last_at || '')))
    .slice(0, LIMIT)
  emit('state', list.value.length ? 'ready' : 'empty')
})

const one = computed(() => list.value.length === 1)
const anyGoing = computed(() => list.value.some((c) => c.state === 'going'))
/* with one course the card is that course: its name is the heading, said once */
const title = computed(() => one.value ? list.value[0].title : (anyGoing.value ? W.value['title-going'] : list.value.every((c) => c.state === 'done') ? W.value['title-done'] : W.value['title-new']))
const base = (c: any) => COURSES_PLACE_BASE + '/' + c.slug
const hrefOf = (c: any) => (c.state === 'going' && c.next ? base(c) + '/' + c.next.key : base(c))
const actOf = (c: any) => (c.state === 'going' ? W.value.continue : c.state === 'done' ? W.value.review : W.value.start)
const metaOf = (c: any) => (c.sections > 1 ? fill(W.value['lessons-modules'], { n: c.lessons, m: c.sections }) : fill(W.value.lessons, { n: c.lessons }))
const lineOf = (c: any) => (c.state === 'going'
  ? (c.next ? fill(W.value.next, { title: c.next.title }) : c.next_opens_at ? fill(W.value.opens, { date: day(c.next_opens_at) }) : '')
  : c.state === 'done' ? W.value.finished : leadOf(c.about))
function go(to: string, e: Event) { e.preventDefault(); navigate(to) }
</script>

<template>
  <article v-if="list.length" class="hc hco" :class="{ 'is-one': one }">
    <header class="hc-head">
      <p class="hc-kicker">{{ W.kicker }}</p>
      <a class="hc-more" :href="COURSES_PLACE_BASE" @click="go(COURSES_PLACE_BASE, $event)">{{ W.all }}</a>
    </header>
    <h3 class="hc-title">{{ title }}</h3>
    <ul class="hco-list">
      <li v-for="c in list" :key="c.slug" class="hco-item" :class="'is-' + c.state">
        <a class="hco-cover" :href="base(c)" tabindex="-1" aria-hidden="true" @click="go(base(c), $event)">
          <CourseCover :slug="c.slug" :title="c.title" :image="c.image || ''" :meta="one ? metaOf(c) : ''" :size="one ? 'hero' : 'card'" />
        </a>
        <div class="hco-words">
          <a v-if="!one" class="hco-name" :href="base(c)" @click="go(base(c), $event)">{{ c.title }}</a>
          <p v-if="lineOf(c)" class="hco-line">{{ lineOf(c) }}</p>
          <p v-if="c.state === 'new' && !one" class="hc-meta">{{ metaOf(c) }}</p>
          <span v-else-if="c.state !== 'new'" class="hco-prog">
            <span class="hc-bar"><span :style="{ width: (c.state === 'done' ? 100 : pct(c.done, c.total)) + '%' }" /></span>
            <span class="hc-meta">{{ fill(W.progress, { done: c.state === 'done' ? c.total : c.done, total: c.total }) }}</span>
          </span>
          <div class="hco-foot"><a class="hc-go" :class="{ 'is-lead': c.state !== 'done' }" :href="hrefOf(c)" @click="go(hrefOf(c), $event)">{{ actOf(c) }}</a></div>
        </div>
      </li>
    </ul>
  </article>
</template>

<style scoped>
.hco-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
.hco-item { margin: 0; padding: 0; min-width: 0; display: flex; flex-direction: column; gap: 14px; }
.hco-cover { display: block; border-radius: 12px; overflow: hidden; text-decoration: none; color: inherit; box-shadow: 0 1px 0 color-mix(in srgb, var(--ink) 8%, transparent), 0 12px 26px -16px #0007; transition: transform .25s ease, box-shadow .25s ease; }
.hco-cover :deep(.crs-cover) { border-radius: 0; }
@media (hover: hover) { .hco-cover:hover { transform: translateY(-2px); } }
.hco-words { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1; }
.hco-name { font-family: var(--fd, inherit); font-size: 18px; font-weight: 700; line-height: 1.25; color: var(--ink); text-decoration: none; }
.hco-name:hover { text-decoration: underline; }
.hco-line { max-width: none; margin: 0; font-size: 15px; line-height: 1.55; color: var(--ink2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.hco-prog { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; max-width: 320px; }
.hco-foot { margin-top: auto; padding-top: 10px; }
/* the button that moves the reader on is the one solid button on Home */
.hco .hc-go.is-lead { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.hco .hc-go.is-lead:hover { background: var(--ink); opacity: .9; }

/* ONE COURSE: drawn large beside its cover, the card's whole width */
.hco.is-one .hco-list { grid-template-columns: minmax(0, 1fr); }
.hco.is-one .hco-item { display: grid; grid-template-columns: minmax(0, 340px) minmax(0, 1fr); gap: 28px; align-items: center; }
.hco.is-one .hco-name { font-size: 24px; }
.hco.is-one .hco-line { -webkit-line-clamp: 4; max-width: 60ch; }

@container (max-width: 640px) {
  .hco-list { grid-template-columns: minmax(0, 1fr); }
  .hco.is-one .hco-item { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .hco.is-one .hco-name { font-size: 20px; }
}
.hco { container-type: inline-size; }
</style>

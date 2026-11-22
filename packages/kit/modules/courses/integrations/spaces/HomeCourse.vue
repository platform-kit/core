<script setup lang="ts">
/*
 * HOME'S COURSE CARD (openspec: community-home), spaces' home slot: the course the reader worked in most recently, its
 * next lesson and how far they are, linked straight into the player in the community's Courses place; with none under
 * way, the first course they may start; with nothing to start, no card. Words: ## home in the courses strings.
 */
import { ref, computed, onMounted } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { navigate, COURSES_PLACE_BASE } from 'platformkit/lib/router.js'
import { rpc, fill, pct, day } from '../../ui/course-ui.js'

const emit = defineEmits(['state'])
const W = computed(() => us('courses').home.main)
const course = ref<any>(null)
const mode = ref<'continue' | 'start'>('start')

onMounted(async () => {
  let list: any[] = []
  try { list = (await rpc('courses_list')) || [] } catch { list = [] }
  const going = list.filter((c) => c.enrolled && !c.completed_at && c.access).sort((a, b) => String(b.last_at || '').localeCompare(String(a.last_at || '')))
  const fresh = list.filter((c) => !c.enrolled && c.access)
  course.value = going[0] || fresh[0] || null
  mode.value = going[0] ? 'continue' : 'start'
  emit('state', course.value ? 'ready' : 'empty')
})

const base = computed(() => (course.value ? COURSES_PLACE_BASE + '/' + course.value.slug : COURSES_PLACE_BASE))
const href = computed(() => (course.value && mode.value === 'continue' && course.value.next ? base.value + '/' + course.value.next.key : base.value))
const done = computed(() => (course.value ? pct(course.value.done, course.value.total) : 0))
function go(to: string, e: Event) { e.preventDefault(); navigate(to) }
</script>

<template>
  <article v-if="course" class="hc hco">
    <header class="hc-head">
      <p class="hc-kicker">{{ W.title }}</p>
      <a class="hc-more" :href="COURSES_PLACE_BASE" @click="go(COURSES_PLACE_BASE, $event)">{{ W.all }}</a>
    </header>
    <div class="hco-body">
      <a v-if="course.image" class="hco-cover" :href="base" :aria-label="course.title" @click="go(base, $event)"><img :src="course.image" alt="" /></a>
      <div class="hco-words">
        <h3 class="hc-title">{{ course.title }}</h3>
        <p v-if="mode === 'continue' && course.next" class="hc-line">{{ fill(W.next, { title: course.next.title }) }}</p>
        <p v-else-if="mode === 'continue' && course.next_opens_at" class="hc-line">{{ fill(W.opens, { date: day(course.next_opens_at) }) }}</p>
        <p v-else class="hc-line">{{ fill(W.lessons, { n: course.total || course.lessons }) }}</p>
      </div>
    </div>
    <div v-if="mode === 'continue'" class="hco-prog">
      <span class="hc-bar"><span :style="{ width: done + '%' }" /></span>
      <span class="hc-meta">{{ fill(W.progress, { done: course.done, total: course.total }) }}</span>
    </div>
    <div class="hc-foot"><a class="hc-go" :href="href" @click="go(href, $event)">{{ mode === 'continue' ? W.continue : W.start }}</a></div>
  </article>
</template>

<style scoped>
.hco-body { display: flex; gap: 16px; align-items: center; }
.hco-cover { flex: none; width: 112px; aspect-ratio: 16 / 10; border-radius: 10px; overflow: hidden; display: block; }
.hco-cover img { display: block; width: 100%; height: 100%; object-fit: cover; }
.hco-words { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.hco-prog { display: flex; flex-direction: column; gap: 7px; }
</style>

<script setup>
/*
 * The reader's courses, in their app area (the courses module): each with how far they are and the way back in.
 * my_courses answers for the reader alone. Words from the theme's content/ui/courses.md.
 */
import { ref, computed, onMounted } from 'vue'
import { supabase } from 'platformkit/lib/supabase.js'
import { us } from 'platformkit/lib/content.js'

const W = computed(() => (us('courses').page || {}).list || {})
const M = computed(() => (us('courses').page || {}).mine || {})
const rows = ref([])
const done = ref(false)
const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : String(m[k])))
const pct = (d, t) => (t ? Math.round((100 * d) / t) : 0)
onMounted(async () => {
  if (supabase) { const { data } = await supabase.rpc('my_courses'); rows.value = data || [] }
  done.value = true
})
</script>

<template>
  <section class="ct">
    <ul v-if="rows.length" class="ct-list">
      <li v-for="r in rows" :key="r.slug">
        <a :href="'/courses/' + r.slug" class="ct-row">
          <strong>{{ r.title }}</strong>
          <span class="ct-meta">{{ r.completed_at ? W.finished : fill(W.progress, { done: r.done, total: r.total }) }}</span>
          <span class="ct-bar"><span :style="{ width: pct(r.done, r.total) + '%' }" /></span>
        </a>
      </li>
    </ul>
    <div v-else-if="done" class="ct-empty">
      <h2>{{ M['empty-title'] }}</h2>
      <p>{{ M['empty-body'] }}</p>
      <a class="ui-btn" href="/courses">{{ M.browse }}</a>
    </div>
  </section>
</template>

<style scoped>
.ct { max-width: 44rem; }
.ct-list { list-style: none; margin: 0; padding: 0; display: grid; gap: .75rem; }
.ct-row { display: grid; gap: .3rem; padding: .9rem 1rem; border: 1px solid var(--hair); border-radius: 12px; text-decoration: none; color: inherit; }
.ct-row:hover { border-color: var(--accent); }
.ct-meta { font-size: .82rem; opacity: .65; }
.ct-bar { display: block; height: 4px; border-radius: 2px; background: var(--hair); overflow: hidden; }
.ct-bar > span { display: block; height: 100%; background: var(--accent); }
.ct-empty { border: 1px dashed var(--hair); border-radius: 12px; padding: 2rem 1.5rem; display: grid; gap: .5rem; justify-items: start; }
.ct-empty h2 { margin: 0; font-size: 1.15rem; }
.ct-empty p { margin: 0 0 .5rem; opacity: .75; }
</style>

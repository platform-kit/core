<script setup>
/*
 * The courses somebody is taking, with how far they are: member_courses, which asks may_see_member first, so anybody
 * else is answered as somebody with nothing to show. Words from the theme's content/ui/courses.md (## member-panel).
 */
import { ref, watch, computed } from 'vue'
import { supabase } from 'platformkit/lib/supabase.js'
import { us } from 'platformkit/lib/content.js'

const props = defineProps({ user: { type: String, default: '' }, mine: { type: Boolean, default: false } })
const W = computed(() => us('courses')['member-panel'].main)
const rows = ref([])
const done = ref(false)

watch(() => props.user, async (id) => {
  done.value = false
  rows.value = []
  if (!id) return
  const { data } = await supabase.rpc('member_courses', { p_user: id })
  rows.value = data || []
  done.value = true
}, { immediate: true })
const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : String(m[k])))
</script>

<template>
  <ul v-if="rows.length" class="mb">
    <li v-for="r in rows" :key="r.slug">
      <b><a :href="'/courses/' + r.slug">{{ r.title }}</a></b>
      <i>{{ r.completed_at ? W.finished : fill(W.progress, { done: r.done, total: r.total }) }}</i>
    </li>
  </ul>
  <p v-else-if="done" class="su-quiet">{{ W[mine ? 'empty-mine' : 'empty-theirs'] }}</p>
</template>

<style scoped>
.mb { list-style: none; margin: 0; padding: 0; display: grid; gap: .45rem; }
.mb li { display: flex; justify-content: space-between; gap: .75rem; align-items: baseline; }
.mb b { font-weight: 600; }
.mb b a { color: inherit; text-decoration: none; }
.mb i { font-style: normal; font-size: .8rem; opacity: .65; white-space: nowrap; }
</style>

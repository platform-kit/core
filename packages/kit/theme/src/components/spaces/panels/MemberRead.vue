<script setup>
/*
 * What somebody has read: the books and articles they have opened, most recent first. A panel of
 * the member card's private half — it is drawn only where the database has already said this
 * reader may see it, and its own read asks the same rule again before answering, so the guard is
 * never only the surface's.
 * Words from the theme's content/ui/spaces.md (## member-panels), which a site rewords in its own.
 */
import { ref, watch, computed } from 'vue'
import { supabase } from 'platformkit/lib/supabase.js'
import { us } from 'platformkit/lib/content.js'

const props = defineProps({ user: { type: String, default: '' }, mine: { type: Boolean, default: false } })
const W = computed(() => us('spaces')['member-panels'].main)
const rows = ref([])
const done = ref(false)

watch(() => props.user, async (id) => {
  done.value = false
  rows.value = []
  if (!id) return
  const { data } = await supabase.rpc('member_read', { p_user: id })
  rows.value = data || []
  done.value = true
}, { immediate: true })

const when = (v) => {
  const d = new Date(v)
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
</script>

<template>
  <ul v-if="rows.length" class="mr">
    <li v-for="r in rows" :key="r.kind + ':' + r.id">
      <b>{{ r.title || r.id }}</b>
      <i>{{ when(r.last_at) }}</i>
    </li>
  </ul>
  <p v-else-if="done" class="su-quiet">{{ W[mine ? 'read-none-own' : 'read-none'] }}</p>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; these say what they want instead */
.mr { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px }
.mr li { display: flex; align-items: baseline; gap: 10px; padding: 5px 0 }
.mr b { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 500; color: var(--ink2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.mr i { flex: none; font-style: normal; font-family: var(--m); font-size: 10.5px; color: var(--ink3) }
</style>

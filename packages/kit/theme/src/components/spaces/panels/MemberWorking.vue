<script setup>
/*
 * Where somebody is working: the level the sheet placed them at, what is already secure under it,
 * and the areas they have taken. The scoring runs in the reader's own browser and is written to
 * signals from there, so this reads their own result rather than scoring it a second time — which
 * is also why it can say nothing at all for somebody who has taken no diagnostic.
 * Words from the theme's content/ui/spaces.md (## member-panels), which a site rewords in its own; a level's own name is
 * the site's instrument's (#site/instrument, LEVELS).
 */
import { ref, watch, computed } from 'vue'
import { supabase } from 'platformkit/lib/supabase.js'
import { us } from 'platformkit/lib/content.js'
/* the levels as the SITE's instrument names them (#site/instrument): the kit has no idea what a level is called */
import { LEVELS } from '#site/instrument'

const props = defineProps({ user: { type: String, default: '' }, mine: { type: Boolean, default: false } })
const W = computed(() => us('spaces')['member-panels'].main)
const row = ref(null)
const done = ref(false)

watch(() => props.user, async (id) => {
  done.value = false
  row.value = null
  if (!id) return
  const { data } = await supabase.rpc('member_working', { p_user: id })
  row.value = data || null
  done.value = true
}, { immediate: true })

/* a level is named once, in the glossary, and read from there by everything — never as a literal */
const nameOf = (lv) => (lv && LEVELS[lv] && LEVELS[lv].name) || ''
const working = computed(() => nameOf(row.value && row.value.working))
const secured = computed(() => nameOf(row.value && row.value.secured))
const areas = computed(() => (row.value && row.value.areas) || [])
</script>

<template>
  <div v-if="row && (working || areas.length)" class="mw">
    <p v-if="working"><b>{{ working }}</b><i v-if="secured">{{ (W['working-secured'] || '').replace('{name}', secured) }}</i></p>
    <p v-if="areas.length" class="mw-areas">{{ (W['working-areas'] || '').replace('{n}', areas.length) }}</p>
  </div>
  <p v-else-if="done" class="su-quiet">{{ W[mine ? 'working-none-own' : 'working-none'] }}</p>
</template>

<style scoped>
.mw { display: grid; gap: 3px }
.mw p { margin: 0; max-width: none; display: flex; align-items: baseline; gap: 8px }
.mw b { font-size: 14px; font-weight: 700; color: var(--ink) }
.mw i { font-style: normal; font-size: 12px; color: var(--ink3) }
.mw-areas { font-size: 12.5px; color: var(--ink3) }
</style>

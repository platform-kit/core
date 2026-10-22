<script setup>
/* the chips under the range line: every filter in force with its word and value, a × each, and Clear; the source is the
   select in the head, not a chip. Words: `## page / ### filters` in analytics.md. */
import { us } from 'platformkit/lib/content.js'
import { useFilters } from '../lib/analytics-filters.js'
const FW = (us('analytics').page || {}).filters || {}
const { chips, remove, clear } = useFilters(FW)
const valueWords = (chip) => {
  const T = us('analytics')
  if (chip.key === 'channel') return ((T.acquisition && T.acquisition.ui) || {})['channel-' + chip.value] || chip.value
  if (chip.key === 'device' || chip.key === 'browser' || chip.key === 'os') return ((T.audience && T.audience.ui) || {})[chip.key + '-' + chip.value] || chip.value
  return chip.value
}
</script>

<template>
  <div v-if="chips.length" class="an-fchips">
    <span class="an-fchipslabel">{{ FW.filtered }}</span>
    <button v-for="c in chips" :key="c.key" type="button" class="an-fchip" :title="FW.remove" @click="remove(c.key)"><i>{{ c.label }}</i><b>{{ valueWords(c) }}</b><span aria-hidden="true">×</span></button>
    <button v-if="chips.length > 1" type="button" class="an-fchipclear" @click="clear">{{ FW.clear }}</button>
  </div>
</template>

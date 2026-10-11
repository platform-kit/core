<script setup>
import { us } from '../strings.js'
defineProps({ items: { type: Array, default: () => [] } })
const G = (us('pages').grid || {}).chrome || {}
</script>

<template>
  <div v-if="items.length" class="queue">
    <div class="section-label">{{ G['then-these'] }}</div>
    <ol><li v-for="(t, i) in items" :key="i"><span>{{ t }}</span></li></ol>
  </div>
</template>

<style scoped>
.queue { background: none; border: 0; border-radius: 0; padding: 0; margin: 0 0 var(--s4) }
.section-label {
  display: block; font-family: var(--m, ui-monospace, Menlo, monospace); font-size: 10px;
  font-weight: 500; letter-spacing: .17em; text-transform: uppercase;
  color: var(--qink3); margin: 0 0 var(--s2);
}
ol { list-style: none; margin: 0; padding: 0; counter-reset: n }
li {
  counter-increment: n; display: flex; gap: 13px; padding: 12px 0;
  border-top: 1px solid var(--qhair);
}
li::before {
  content: counter(n); font-family: var(--m, ui-monospace, Menlo, monospace); font-size: 11px;
  color: var(--qink3); padding-top: 3px; flex: none; width: 14px;
}
li span { font-size: 15.5px; line-height: 1.5; color: var(--qink2) }
</style>

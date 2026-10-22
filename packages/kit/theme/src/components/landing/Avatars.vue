<script setup>
/* a stack of faces — pictures, or initials from names — overlapping, and a line beside ("Join 5,482 others") */
import { md } from './md.js'
defineProps({ items: { type: Array, default: () => [] }, line: { type: String, default: '' }, size: { type: Number, default: 34 } })   /* [{ image?, name? }] */
const initials = (n) => String(n || '').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '·'
</script>

<template>
  <span class="lpav" :style="{ '--s': size + 'px' }">
    <span class="lpav-row">
      <span v-for="(a, i) in items" :key="i" class="lpav-one" :style="{ zIndex: items.length - i }"><img v-if="a.image" :src="a.image" :alt="a.name || ''" loading="lazy" /><i v-else>{{ initials(a.name) }}</i></span>
    </span>
    <span v-if="line" class="lpav-line" v-html="md(line)"></span>
  </span>
</template>

<style scoped>
.lpav { display: inline-flex; align-items: center; gap: 12px }
.lpav-row { display: inline-flex }
.lpav-one { width: var(--s); height: var(--s); border-radius: 50%; overflow: hidden; background: var(--accentbg); border: 2px solid var(--paper); margin-left: calc(var(--s) * -0.3); display: grid; place-items: center; box-shadow: 0 2px 6px #0002 }
.lpav-one:first-child { margin-left: 0 }
.lpav-one img { width: 100%; height: 100%; object-fit: cover; display: block }
.lpav-one i { font: 600 11px var(--m); font-style: normal; color: var(--accent2) }
.lpav-line { font-size: 14px; color: var(--ink2) }
.lpav-line :deep(strong) { color: var(--ink) }
</style>

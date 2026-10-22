<script setup>
/* a star rating: n of five, drawn in the accent; a half is a half. Beside it, a line ("4.9 from 1,200 reviews") */
import { md } from './md.js'
defineProps({ value: { type: Number, default: 5 }, line: { type: String, default: '' } })
const D = 'M10 1.8l2.5 5.3 5.8.7-4.3 4 1.1 5.7L10 14.7l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7z'
</script>

<template>
  <span class="lpstars" :aria-label="value + ' of 5'">
    <span class="lpstars-row" aria-hidden="true">
      <svg v-for="i in 5" :key="i" viewBox="0 0 20 20" width="16" height="16">
        <path :d="D" class="lpstars-off" />
        <path v-if="i <= value" :d="D" class="lpstars-on" :style="i > Math.floor(value) ? { clipPath: 'inset(0 ' + Math.round((1 - (value % 1)) * 100) + '% 0 0)' } : null" />
      </svg>
    </span>
    <span v-if="line" class="lpstars-line" v-html="md(line)"></span>
  </span>
</template>

<style scoped>
.lpstars { display: inline-flex; align-items: center; gap: 8px }
.lpstars-row { display: inline-flex; gap: 2px }
.lpstars-off { fill: color-mix(in srgb, var(--ink3) 35%, transparent) } .lpstars-on { fill: var(--accent) }
.lpstars-line { font-size: 13.5px; color: var(--ink3) }
.lpstars-line :deep(strong) { color: var(--ink) }
</style>

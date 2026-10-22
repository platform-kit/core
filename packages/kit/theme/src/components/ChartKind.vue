<script setup>
/* Bars or a line: the one switch for every series over time on the analytics pages (chartKind in charts-theme.js,
   remembered per browser). Words: `## page / ### head` in analytics.md. */
import { chartKind } from '../lib/charts-theme.js'
import { us } from 'platformkit/lib/content.js'
const H = us('analytics').page.head
</script>

<template>
  <div class="an-seg" role="radiogroup" :aria-label="H['chart-label']">
    <button type="button" :class="{ on: chartKind === 'bar' }" :aria-pressed="chartKind === 'bar'" @click="chartKind = 'bar'"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2 14V8h3v6zM6.5 14V3h3v11zM11 14V6h3v8z" fill="currentColor" /></svg>{{ H['chart-bars'] }}</button>
    <button type="button" :class="{ on: chartKind === 'line' }" :aria-pressed="chartKind === 'line'" @click="chartKind = 'line'"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2 12l4-5 3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>{{ H['chart-line'] }}</button>
  </div>
</template>

<style>
.an-seg button svg { vertical-align: -2px; margin-right: 5px; opacity: .8 }
</style>

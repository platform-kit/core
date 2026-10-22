<script setup>
import { md } from './md.js'
/* how it works: three steps, each with a small icon, a tag, a question and a paragraph */
defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  steps: { type: Array, default: () => [] },   /* [{ icon: 'sun'|'bars'|'doc', tag, title, body }] */
})
const ICONS = {
  sun: '<circle cx="10" cy="10" r="3"/><path d="M10 2.5v3.2M10 14.3v3.2M2.5 10h3.2M14.3 10h3.2M4.7 4.7l2.3 2.3M13 13l2.3 2.3M15.3 4.7L13 7M7 13l-2.3 2.3"/>',
  bars: '<path d="M3 16.5V10M8 16.5V4M13 16.5v-4.5M18 16.5V7.5"/>',
  doc: '<rect x="2.5" y="3" width="15" height="14" rx="2.5"/><path d="M5.5 7.5h9M5.5 11h6"/>',
}
const icon = (k) => ICONS[k] || ICONS.sun
</script>

<template>
  <section class="lpsec">
    <div id="lphow" class="lpwrap">
      <div class="lpcol lprv">
        <span v-if="eyebrow" class="lpeyebrow" v-html="md(eyebrow)"></span>
        <h2 class="lps" v-html="md(heading)"></h2>
      </div>
      <div class="lpsteps">
        <div v-for="(s, i) in steps" :key="i" class="lpcard lpstep lplift lprv" :class="{ lpd1: i === 1, lpd2: i === 2 }">
          <div class="lpk"><svg class="lpico" viewBox="0 0 20 20" aria-hidden="true" v-html="icon(s.icon)"></svg><b v-html="md(s.tag)"></b></div>
          <h4 v-html="md(s.title)"></h4>
          <p v-html="md(s.body)"></p>
        </div>
      </div>
    </div>
  </section>
</template>

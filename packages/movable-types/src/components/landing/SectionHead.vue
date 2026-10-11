<script setup>
import { md } from './md.js'
import RevealText from './RevealText.vue'
/* the words above a section — a badge, an eyebrow, a heading, a lead — as every section sets them, centred or left; drawn only for what the page gives; the heading arriving word by word when the section says so */
defineProps({ badge: { type: String, default: '' }, eyebrow: { type: String, default: '' }, heading: { type: String, default: '' }, lead: { type: String, default: '' }, center: { type: Boolean, default: false }, reveal: { type: String, default: '' } })
</script>

<template>
  <div v-if="badge || eyebrow || heading || lead" class="lpshead lprv" :class="{ 'lpshead-c': center }">
    <span v-if="badge" class="lpbadge lpk" v-html="md(badge)"></span>
    <span v-if="eyebrow" class="lpeyebrow lpk" style="--k: .05s" v-html="md(eyebrow)"></span>
    <h2 v-if="heading" class="lps" :class="{ lpk: reveal !== 'words' }" style="--k: .1s"><RevealText v-if="reveal === 'words'" :text="heading" mode="words" :delay="0.1" /><span v-else v-html="md(heading)"></span></h2>
    <p v-if="lead" class="lplead lpk" style="--k: .22s" v-html="md(lead)"></p>
  </div>
</template>

<style scoped>
.lpshead { max-width: 660px; margin-bottom: 40px; display: flex; flex-direction: column; align-items: flex-start }
.lpshead-c { margin-left: auto; margin-right: auto; text-align: center; align-items: center }
.lpshead-c .lpeyebrow { justify-content: center }
.lpshead .lplead { margin: 0 }
.lpshead .lpeyebrow + .lps { margin-top: 14px }
.lpbadge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 8px; border-radius: 999px; font-size: 12.5px; font-weight: 600; color: var(--accent2); background: var(--accentbg); border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); margin-bottom: 14px }
.lpbadge::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent) }
</style>

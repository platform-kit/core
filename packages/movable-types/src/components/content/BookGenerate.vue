<script setup>
/*
 * The player's slot when a chapter has no recording and this browser could
 * make one: a button, and then the state of the making — the voice being
 * fetched, warmed up, this chapter being read, or waiting its turn behind
 * the ones ahead. Every word comes from content/app/ui/library.md
 * (reader.generate); the numbers are filled in here.
 */
import { computed } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'

const props = defineProps({
  status: { type: Object, required: true },   /* the book's: phase, download, error */
  track: { type: Object, default: null },     /* this chapter's: status, piece, pieces */
  ahead: { type: Number, default: 0 },
})
const emit = defineEmits(['generate'])
const G = (us('library').reader || {}).generate || {}
const fill = (s, a) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (a[k] != null ? a[k] : ''))
const mb = (n) => Math.round((n || 0) / 1048576)

const line = computed(() => {
  const t = props.track, s = props.status
  if (t && t.status === 'failed') return { text: G.failed, failed: true }
  if (s.phase === 'failed') return { text: G.failed, failed: true }
  if (t && t.status === 'generating') return { text: t.pieces ? fill(G.speaking, { i: t.piece, n: t.pieces }) : G.starting, busy: true, frac: t.pieces ? t.piece / t.pieces : 0 }
  if (t && t.status === 'queued') {
    if (s.phase === 'downloading') return { text: fill(G.downloading, { done: mb(s.download.done), total: mb(s.download.total) }), busy: true, frac: s.download.total ? s.download.done / s.download.total : 0 }
    if (s.phase === 'loading') return { text: G.loading, busy: true }
    return { text: fill(G.queued, { n: props.ahead }), busy: true }
  }
  return null
})
</script>

<template>
  <div class="bg" :class="{ idle: !line, busy: line && line.busy, failed: line && line.failed }" role="region" :aria-label="G.eyebrow">
    <template v-if="!line">
      <button type="button" class="bg-btn" @click="emit('generate')">
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 7v6M7.5 4.5v11M11 7v6M14.5 5.5v9M18 8v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        {{ G.button }}
      </button>
    </template>
    <template v-else>
      <span class="bg-eyebrow">{{ G.eyebrow }}</span>
      <span class="bg-line">{{ line.text }}</span>
      <button v-if="line.failed" type="button" class="bg-retry" @click="emit('generate')">{{ G.retry }}</button>
      <span v-else-if="line.busy" class="bg-bar"><i :style="{ width: Math.round((line.frac || 0) * 100) + '%' }" :class="{ pulse: !line.frac }" /></span>
    </template>
  </div>
</template>

<style scoped>
.bg { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 4px 14px;
  width: 100%; max-width: 660px; margin: 0 auto; padding: 12px 22px 0; min-height: 52px }
/* idle: one button, centred */
.bg.idle { grid-template-columns: 1fr; justify-items: center }
.bg-btn { display: inline-flex; align-items: center; gap: 9px; font: inherit; font-size: 13.5px; font-weight: 600;
  color: var(--pg); background: var(--pgink); border: 0; border-radius: 999px; padding: 9px 16px; cursor: pointer; white-space: nowrap }
.bg-btn:hover { opacity: .9 }
.busy, .failed { grid-template-columns: 1fr auto }
.bg-eyebrow { grid-column: 1 / -1; font-family: var(--m); font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--pgink2) }
.bg-line { font-size: 13.5px; color: var(--pgink); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.bg-bar { grid-column: 1 / -1; display: block; height: 4px; border-radius: 2px; background: var(--pghair); overflow: hidden }
.bg-bar i { display: block; height: 100%; background: var(--accent2, #0b6e6e); border-radius: 2px; transition: width .3s }
.bg-bar i.pulse { width: 30% !important; animation: bg-pulse 1.4s ease-in-out infinite }
@keyframes bg-pulse { 0% { transform: translateX(-100%) } 100% { transform: translateX(340%) } }
.bg-retry { font: inherit; font-size: 12.5px; color: var(--pgink2); background: none; border: 1px solid var(--pghair); border-radius: 999px; padding: 5px 11px; cursor: pointer }
.bg-retry:hover { color: var(--pgink); border-color: var(--pgink2) }
@media (prefers-reduced-motion: reduce) { .bg-bar i.pulse { animation: none; width: 100% !important; opacity: .4 } }
</style>

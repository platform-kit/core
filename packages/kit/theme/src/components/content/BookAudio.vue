<script setup>
/*
 * The chapter read aloud. One player for the file the current chapter and mode
 * have (the text, or the summary), drawn as a waveform with the playhead on it
 * (wavesurfer.js), a play/pause button, the time, and a speed. The reader mounts
 * it only when a file exists — build/tts.mjs makes the files, velite reads the
 * manifest into the book — so a book without audio simply shows no player.
 * Every visible word comes from content/app/ui/library.md (reader.audio).
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import WaveSurfer from 'wavesurfer.js'
import { us } from 'platformkit/lib/content.js'

const props = defineProps({
  src: { type: String, required: true },
  seconds: { type: Number, default: 0 },
  /* the chapter's title, for the accessible name and the eyebrow */
  title: { type: String, default: '' },
  /* 'full' or 'summary' — which words are being read */
  kind: { type: String, default: 'full' },
})
const A = (us('library').reader || {}).audio || {}

const box = ref(null)
let ws = null
const playing = ref(false)
const ready = ref(false)
const failed = ref(false)
const now = ref(0)
const total = ref(props.seconds || 0)
const RATES = [1, 1.25, 1.5]
const rate = ref(1)

const fmt = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }
const clock = computed(() => fmt(now.value) + ' / ' + fmt(total.value))
const eyebrow = computed(() => (props.kind === 'summary' ? A['eyebrow-summary'] : props.kind === 'intro' ? A['eyebrow-intro'] : A.eyebrow) || '')

/* the waveform's colours follow the page tokens, so it sits right in both schemes */
const colours = () => {
  const cs = getComputedStyle(box.value)
  return { wave: cs.getPropertyValue('--pgink2').trim() || '#888', progress: cs.getPropertyValue('--accent2').trim() || '#0b6e6e' }
}

function make() {
  if (!box.value) return
  const c = colours()
  ws = WaveSurfer.create({
    container: box.value, url: props.src, height: 36, waveColor: c.wave, progressColor: c.progress, cursorColor: c.progress,
    cursorWidth: 1, barWidth: 2, barGap: 2, barRadius: 2, normalize: true, dragToSeek: true, audioRate: rate.value,
  })
  ws.on('ready', (d) => { ready.value = true; total.value = d || total.value })
  ws.on('timeupdate', (t) => { now.value = t })
  ws.on('play', () => { playing.value = true })
  ws.on('pause', () => { playing.value = false })
  ws.on('finish', () => { playing.value = false })
  ws.on('error', () => { failed.value = true })
}
function drop() { if (ws) { ws.destroy(); ws = null } playing.value = false; ready.value = false; failed.value = false; now.value = 0 }
function toggle() { if (ws && ready.value) ws.playPause() }
function nextRate() { rate.value = RATES[(RATES.indexOf(rate.value) + 1) % RATES.length]; if (ws) ws.setPlaybackRate(rate.value, true) }

/* the colours again when the theme changes, so the waveform is never left in the other scheme's ink */
function recolour() { if (!ws || !box.value) return; const c = colours(); ws.setOptions({ waveColor: c.wave, progressColor: c.progress, cursorColor: c.progress }) }
let mo = null
onMounted(() => { make(); mo = new MutationObserver(recolour); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-look'] }) })
onBeforeUnmount(() => { drop(); if (mo) mo.disconnect() })
/* a new chapter or mode is a new file: start again, quietly */
watch(() => props.src, () => { drop(); total.value = props.seconds || 0; make() })
</script>

<template>
  <div class="ba" :class="{ playing, ready, failed }" role="region" :aria-label="(A.aria || 'Listen') + ': ' + title">
    <button type="button" class="ba-play" :disabled="!ready || failed" :aria-label="playing ? A.pause : A.play" @click="toggle">
      <svg v-if="!playing" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M6 4.5v11l9-5.5z" fill="currentColor"/></svg>
      <svg v-else viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M6 4.5h3v11H6zM11 4.5h3v11h-3z" fill="currentColor"/></svg>
    </button>
    <div class="ba-body">
      <div class="ba-line">
        <span class="ba-eyebrow">{{ eyebrow }}</span>
        <span v-if="failed" class="ba-time">{{ A.failed }}</span>
        <span v-else class="ba-time">{{ clock }}</span>
      </div>
      <div ref="box" class="ba-wave" />
    </div>
    <button type="button" class="ba-rate" :aria-label="A.speed" :title="A.speed" @click="nextRate">{{ rate }}×</button>
  </div>
</template>

<style scoped>
.ba { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 14px;
  width: 100%; max-width: 660px; margin: 0 auto; padding: 10px 22px 0 }
.ba-play { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; flex: none;
  color: var(--pg); background: var(--pgink); border: 0; border-radius: 50%; cursor: pointer; transition: transform .12s }
.ba-play:hover:not(:disabled) { transform: scale(1.05) }
.ba-play:disabled { opacity: .35; cursor: default }
.ba-body { min-width: 0 }
.ba-line { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin: 0 0 2px }
.ba-eyebrow { font-family: var(--m); font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--pgink2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ba-time { font-family: var(--m); font-size: 11px; color: var(--pgink2); font-variant-numeric: tabular-nums; white-space: nowrap }
.ba-wave { width: 100%; height: 36px; cursor: pointer }
.ba-wave:empty { background: repeating-linear-gradient(90deg, var(--pghair) 0 2px, transparent 2px 4px); opacity: .6; border-radius: 3px }
.ba-rate { font-family: var(--m); font-size: 11px; color: var(--pgink2); background: none; border: 1px solid var(--pghair);
  border-radius: 999px; padding: 4px 9px; cursor: pointer; flex: none; min-width: 46px }
.ba-rate:hover { color: var(--pgink); border-color: var(--pgink2) }
@media (max-width: 480px) { .ba { gap: 10px; padding: 8px 16px 0 } .ba-rate { display: none } }
</style>

<script setup>
/*
 * A voice note in a bubble: play/pause, the waveform with the playhead on it
 * (wavesurfer.js, as the book's player), the time left, and a speed. The sound
 * comes through src/lib/chat/audio.js — the private bucket, or the blob this
 * browser just recorded. Words from content/app/ui/chat.md (voice).
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import WaveSurfer from 'wavesurfer.js'
import { us } from '@platform-kit/kit/lib/content.js'
import { voiceUrl } from '@platform-kit/kit/lib/chat/audio.js'
import { clock } from '@platform-kit/kit/lib/chat/model.js'

const props = defineProps({
  message: { type: Object, required: true },
  /* drawn on one's own (accent) bubble or the peer's */
  own: { type: Boolean, default: false },
})
const V = us('chat').voice.main

const box = ref(null)
let ws = null
const playing = ref(false)
const ready = ref(false)
const failed = ref(false)
const now = ref(0)
const total = ref(Number(props.message.seconds) || 0)
const RATES = [1, 1.5, 2]
const rate = ref(1)

const shown = computed(() => clock(playing.value || now.value > 0 ? Math.max(0, total.value - now.value) : total.value))

/* the colours as the canvas needs them: real rgb, read off two probe spans that
   wear the tokens (a token's own value can be a color-mix() the canvas will not
   take), and read again when the theme changes */
const waveEl = ref(null), progEl = ref(null)
const colours = () => ({
  wave: (waveEl.value && getComputedStyle(waveEl.value).color) || '#888',
  progress: (progEl.value && getComputedStyle(progEl.value).color) || '#0b6e6e',
})
function recolour() {
  if (!ws) return
  const c = colours()
  ws.setOptions({ waveColor: c.wave, progressColor: c.progress, cursorColor: c.progress })
}
let mo = null, mql = null
const onScheme = () => recolour()

async function make() {
  if (!box.value) return
  const url = await voiceUrl(props.message)
  if (!url || !box.value) { failed.value = !url; return }
  const c = colours()
  ws = WaveSurfer.create({
    container: box.value, url, height: 26, waveColor: c.wave, progressColor: c.progress, cursorColor: c.progress,
    cursorWidth: 1, barWidth: 2, barGap: 2, barRadius: 2, normalize: true, dragToSeek: true, audioRate: rate.value,
  })
  ws.on('ready', (d) => { ready.value = true; if (d) total.value = d })
  ws.on('timeupdate', (t) => { now.value = t })
  ws.on('play', () => { playing.value = true })
  ws.on('pause', () => { playing.value = false })
  ws.on('finish', () => { playing.value = false; now.value = 0 })
  ws.on('error', () => { failed.value = true })
}
function drop() { if (ws) { ws.destroy(); ws = null } playing.value = false; ready.value = false; now.value = 0 }
function toggle() { if (ws && ready.value) ws.playPause() }
function nextRate() { rate.value = RATES[(RATES.indexOf(rate.value) + 1) % RATES.length]; if (ws) ws.setPlaybackRate(rate.value, true) }

onMounted(() => {
  make()
  mo = new MutationObserver(recolour)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-look'] })
  mql = window.matchMedia('(prefers-color-scheme: dark)')
  mql.addEventListener('change', onScheme)
})
onBeforeUnmount(() => { drop(); if (mo) mo.disconnect(); if (mql) mql.removeEventListener('change', onScheme) })
watch(() => props.message.audio_path, () => { drop(); make() })
</script>

<template>
  <div class="vn" :class="{ own, playing, ready, failed }">
    <i ref="waveEl" class="vn-probe vn-probe-wave" aria-hidden="true" /><i ref="progEl" class="vn-probe vn-probe-prog" aria-hidden="true" />
    <button type="button" class="vn-play" :disabled="!ready || failed" :aria-label="playing ? V.pause : V.play" @click="toggle">
      <svg v-if="!playing" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M6 4.5v11l9-5.5z" fill="currentColor"/></svg>
      <svg v-else viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M6 4.5h3v11H6zM11 4.5h3v11h-3z" fill="currentColor"/></svg>
    </button>
    <div class="vn-body">
      <div ref="box" class="vn-wave" />
      <div class="vn-line">
        <span class="vn-time">{{ failed ? V.failed : shown }}</span>
        <button v-if="ready && (playing || now > 0)" type="button" class="vn-rate" @click="nextRate">{{ rate }}×</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vn { position: relative; --vn-wave: color-mix(in srgb, var(--ink) 30%, transparent); --vn-progress: var(--accent2);
  display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px; width: min(260px, 62vw); max-width: 100%; padding: 2px 0 }
.vn.own { --vn-wave: color-mix(in srgb, #fff 45%, transparent); --vn-progress: #fff }
.vn-probe { position: absolute; width: 0; height: 0; overflow: hidden }
.vn-probe-wave { color: var(--vn-wave) }
.vn-probe-prog { color: var(--vn-progress) }
.vn-play { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; flex: none;
  color: var(--paper); background: var(--ink); border: 0; border-radius: 50%; cursor: pointer; transition: transform .12s }
.vn.own .vn-play { color: #171716; background: #fff }
.vn-play:hover:not(:disabled) { transform: scale(1.05) }
.vn-play:disabled { opacity: .35; cursor: default }
.vn-body { min-width: 0 }
.vn-wave { width: 100%; height: 26px; cursor: pointer; overflow: hidden; border-radius: 3px }
.vn-wave:empty { background: repeating-linear-gradient(90deg, var(--vn-wave) 0 2px, transparent 2px 4px); opacity: .5; border-radius: 3px }
.vn-line { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 2px }
.vn-time { font-family: var(--m); font-size: 10.5px; color: var(--ink3); font-variant-numeric: tabular-nums }
.vn.own .vn-time { color: #fff; opacity: .8 }
.vn-rate { font-family: var(--m); font-size: 10px; color: inherit; background: none; border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
  border-radius: 999px; padding: 1px 7px; cursor: pointer; line-height: 1.4 }
.vn-rate:hover { color: var(--ink); border-color: var(--ink3) }
</style>

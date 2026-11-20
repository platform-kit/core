<script setup lang="ts">
/*
 * ONE RECORDED RUN, WATCHED BACK BY STATEMENT (openspec: recorded-rounds).
 *
 * The parts, joined into one file, in a <video> (or <audio> for a voice recording), and beside it every marked screen
 * as a chapter: the host's words for it (`chapters[id]`: its text, how it was answered, that answer's colour), in the
 * order they were shown. Choosing one seeks to the moment it was shown; the one being played is highlighted.
 */
import type { PropType } from 'vue'
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { us } from 'platformkit/lib/strings.js'
import { recordingUrl, type RecordingRow } from 'platformkit/lib/recording.js'

const props = defineProps({
  rec: { type: Object as PropType<RecordingRow>, required: true },
  owner: { type: String, required: true },
  chapters: { type: Object as PropType<Record<string, { text: string, label?: string, colour?: string }>>, default: () => ({}) },
})
const W = computed(() => ((us('recording').page || {}).main || {}))
const url = ref('')
const media = ref<HTMLMediaElement | null>(null)
const now = ref(0)
const list = computed(() => (props.rec.marks || [])
  .filter((m) => m.shown_ms != null && props.chapters[m.id])
  .sort((a, b) => (a.shown_ms as number) - (b.shown_ms as number))
  .map((m) => ({ ...m, ...props.chapters[m.id] })))
const playing = computed(() => {
  const t = now.value * 1000
  let at = -1
  list.value.forEach((c, i) => { if ((c.shown_ms as number) <= t) at = i })
  return at
})
function seek(ms: number | null) { if (media.value && ms != null) { media.value.currentTime = Math.max(0, ms / 1000 - 0.3); media.value.play().catch(() => {}) } }
onMounted(async () => { url.value = await recordingUrl(props.rec, props.owner) })
onBeforeUnmount(() => { if (url.value) URL.revokeObjectURL(url.value) })
</script>

<template>
  <div class="rp">
    <div class="rp-media">
      <p v-if="!url" class="rp-wait">{{ W.loading }}</p>
      <video v-else-if="rec.kind === 'video'" ref="media" class="rp-video" :src="url" controls playsinline @timeupdate="now = ($event.target as HTMLMediaElement).currentTime" />
      <audio v-else ref="media" class="rp-audio" :src="url" controls @timeupdate="now = ($event.target as HTMLMediaElement).currentTime" />
    </div>
    <ol class="rp-chapters">
      <li v-for="(c, i) in list" :key="c.id">
        <button type="button" class="rp-chapter" :class="{ on: i === playing }" :aria-current="i === playing ? 'true' : undefined" @click="seek(c.shown_ms)">
          <i class="rp-swatch" :style="{ background: c.colour || 'transparent' }" aria-hidden="true" />
          <span class="rp-text">{{ c.text }}</span>
          <span v-if="c.label" class="rp-label">{{ c.label }}</span>
        </button>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.rp { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 20px; align-items: start }
.rp-media { position: sticky; top: 16px }
.rp-video { width: 100%; border-radius: 14px; background: #000; aspect-ratio: 4 / 3 }
.rp-audio { width: 100% }
.rp-wait { margin: 0; padding: 40px 0; text-align: center; color: var(--ink2) }
.rp-chapters { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; max-height: 70vh; overflow-y: auto }
.rp-chapter { display: grid; grid-template-columns: 4px minmax(0, 1fr); gap: 4px 10px; width: 100%; padding: 10px 12px; border: 1px solid var(--hair); border-radius: 12px;
  background: transparent; color: var(--ink); font: inherit; text-align: left; cursor: pointer }
.rp-chapter.on { border-color: var(--ink); background: color-mix(in srgb, var(--ink) 5%, transparent) }
.rp-swatch { grid-row: span 2; align-self: stretch; border-radius: 2px }
.rp-text { line-height: 1.4 }
.rp-label { grid-column: 2; font-size: .82rem; color: var(--ink2) }
@media (max-width: 720px) { .rp { grid-template-columns: minmax(0, 1fr) } .rp-media { position: static } .rp-chapters { max-height: none } }
</style>

<script setup>
import { ref, computed } from 'vue'
import 'vidstack/styles/defaults.css'
import 'vidstack/styles/community-skin/video.css'
import 'vidstack/styles/community-skin/audio.css'
import { defineCustomElements } from 'vidstack/elements'
import { us } from '@platform-kit/kit/lib/content.js'

/*
 * The featured media on an article, wiki or docs page: one track or a playlist,
 * audio or video. Hosted files play through vidstack; a YouTube or Vimeo URL
 * renders as a responsive iframe embed (vidstack 0.6 has no provider for them).
 * `media` is the frontmatter — { type, src, title?, poster? } or an array of those.
 * In a playlist, a track that finishes rolls into the next one; a reader can turn
 * that off.
 */
const props = defineProps({ media: { type: [Object, Array], required: true } })
const M = us('library').media.playlist

defineCustomElements()

const tracks = computed(() => (Array.isArray(props.media) ? props.media : [props.media]))
const at = ref(0)
const cur = computed(() => tracks.value[at.value])

const autoplay = ref(true)     /* auto-advance the playlist (reader can switch it off) */
const autostart = ref(false)   /* whether the mounting track should begin playing itself */
function selectTrack(i) { autostart.value = true; at.value = i }
function onEnded() {
  if (autoplay.value && at.value < tracks.value.length - 1) { autostart.value = true; at.value += 1 }
}

/* youtube / vimeo → an embeddable player URL, or null for a hosted file */
function embedUrl(src) {
  const yt = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/.exec(src || '')
  if (yt) return 'https://www.youtube.com/embed/' + yt[1]
  const vm = /vimeo\.com\/(?:video\/)?(\d+)/.exec(src || '')
  if (vm) return 'https://player.vimeo.com/video/' + vm[1]
  return null
}
const curEmbed = computed(() => {
  const u = embedUrl(cur.value.src)
  if (!u) return null
  /* a track reached by ending/selecting should start playing; embeds have no
     end event, so they can't auto-advance, but they honour the intent to start */
  return autostart.value ? u + (u.includes('?') ? '&' : '?') + 'autoplay=1' : u
})
</script>

<template>
  <figure class="media-block">
    <!-- YouTube / Vimeo: a responsive iframe embed -->
    <div v-if="curEmbed" class="media-embed">
      <iframe :key="at" :src="curEmbed" :title="cur.title || ''" loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowfullscreen referrerpolicy="strict-origin-when-cross-origin" />
    </div>
    <!-- a hosted file: vidstack -->
    <media-player
      v-else
      :key="at"
      :src="cur.src"
      :poster="cur.poster || null"
      :title="cur.title || ''"
      :view-type="cur.type === 'audio' ? 'audio' : 'video'"
      :autoplay="autostart || null"
      playsinline
      @ended="onEnded"
    >
      <media-outlet />
      <!-- the video's own thumbnail (its poster), shown until playback starts;
           distinct from the article's cover image -->
      <media-poster v-if="cur.type !== 'audio'" :alt="cur.title || ''" />
      <media-community-skin />
    </media-player>

    <figcaption v-if="tracks.length > 1" class="playlist">
      <div class="playlist-bar">
        <span class="playlist-count">{{ tracks.length }} {{ M.count }}</span>
        <label class="playlist-auto">
          <input type="checkbox" v-model="autoplay" />
          <span>{{ M.autoplay }}</span>
        </label>
      </div>
      <button
        v-for="(t, i) in tracks"
        :key="i"
        type="button"
        class="track"
        :class="{ on: i === at }"
        @click="selectTrack(i)"
      >
        <span class="track-n">{{ String(i + 1).padStart(2, '0') }}</span>
        <span class="track-t">{{ t.title || M.track + ' ' + (i + 1) }}</span>
        <span class="track-k">{{ t.type === 'audio' ? M.audio : M.video }}</span>
      </button>
    </figcaption>
  </figure>
</template>

<style scoped>
.media-block { margin: 0 0 40px }
.media-embed { position: relative; aspect-ratio: 16 / 9; border-radius: 16px; overflow: hidden; border: 1px solid var(--hair); background: #000 }
.media-embed iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block }
media-player { border-radius: 16px; overflow: hidden; border: 1px solid var(--hair) }
media-player[view-type='audio'] { border-radius: 12px }
.playlist { margin-top: 10px; border: 1px solid var(--hair); border-radius: 14px; overflow: hidden }
.playlist-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 16px; background: var(--wash); border-bottom: 1px solid var(--hair) }
.playlist-count { font-family: var(--m); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3) }
.playlist-auto { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink2); cursor: pointer; user-select: none }
.playlist-auto input { width: 15px; height: 15px; accent-color: var(--accent2); cursor: pointer; margin: 0 }
.track { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 12px; align-items: center;
  width: 100%; text-align: left; background: none; border: 0; border-top: 1px solid var(--hair);
  font: inherit; padding: 12px 16px; cursor: pointer; color: var(--ink2) }
.track:first-child { border-top: 0 }
.track:hover { background: var(--wash) }
.track.on { color: var(--ink); background: var(--wash) }
.track.on .track-t { font-weight: 700 }
.track-n { font-family: var(--m); font-size: 11px; color: var(--accent2) }
.track-t { font-size: 14.5px }
.track-k { font-family: var(--m); font-size: 9.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3) }
</style>

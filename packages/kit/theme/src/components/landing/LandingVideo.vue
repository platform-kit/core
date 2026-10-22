<script setup>
import { ref, computed } from 'vue'
import { md } from './md.js'
import { embedOf } from '../../lib/embed.js'
import { us } from 'platformkit/lib/strings.js'
import SectionHead from './SectionHead.vue'
/*
 * Video: one video with a caption — a file, or a YouTube, Vimeo or Loom address (lib/embed.js says
 * which; nothing else is embedded). Nothing loads until the reader presses play: until then the
 * poster stands in a card with the play mark, so a page with a video costs no more than a picture.
 *
 * Slots for a look's skin: `head` and `player`.
 */
const props = defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  video: { type: String, default: '' },
  poster: { type: String, default: '' },
  caption: { type: String, default: '' },
  size: { type: String, default: 'wide' },    /* wide | narrow */
})
const W = (us('sections').video || {}).play || {}
const embed = computed(() => embedOf(props.video))
const playing = ref(false)
const src = computed(() => { const e = embed.value; if (!e || e.kind !== 'embed') return ''; return e.src + (e.src.includes('?') ? '&' : '?') + 'autoplay=1' })
</script>

<template>
  <section class="lpsec lpvideo">
    <div class="lpwrap">
      <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead"><SectionHead :eyebrow="eyebrow" :heading="heading" :lead="lead" center /></slot>
      <slot name="player" :embed="embed" :poster="poster" :caption="caption" :md="md">
        <figure v-if="embed" class="lpvd lprv" :class="'lpvd-' + size">
          <div class="lpcard lpvd-frame">
            <template v-if="!playing">
              <img v-if="poster" :src="poster" alt="" decoding="async" class="lpvd-poster" />
              <button type="button" class="lpvd-play" :aria-label="W.label" @click="playing = true"><span><svg viewBox="0 0 20 20" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M6.5 4.5l9 5.5-9 5.5z"/></svg></span></button>
            </template>
            <video v-else-if="embed.kind === 'file'" :src="embed.src" :poster="poster || undefined" controls autoplay playsinline></video>
            <iframe v-else :src="src" :title="heading || caption || ''" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
          </div>
          <figcaption v-if="caption" v-html="md(caption)"></figcaption>
        </figure>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lpvd { margin: 0 auto; display: flex; flex-direction: column; gap: 14px; align-items: center }
.lpvd-wide { max-width: 960px } .lpvd-narrow { max-width: 680px }
.lpvd-frame { position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; padding: 0; background: var(--ink) }
.lpvd-poster { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block }
.lpvd-frame video, .lpvd-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block }
.lpvd-play { position: absolute; inset: 0; width: 100%; border: 0; background: linear-gradient(180deg, transparent 40%, #00000066); cursor: pointer; display: grid; place-items: center }
.lpvd-play span { display: grid; place-items: center; width: 76px; height: 76px; border-radius: 50%; color: #111; background: #fff;   /* over a picture, not the ground: fixed on purpose */ box-shadow: 0 20px 50px -10px #000a; transition: transform .25s cubic-bezier(.2,.8,.2,1) }
.lpvd-play span svg { margin-left: 4px }
.lpvd-play:hover span { transform: scale(1.06) }
.lpvd figcaption { font-size: 14px; color: var(--ink3); text-align: center }
</style>

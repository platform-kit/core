<script setup>
/*
 * A POST'S PICTURES AND VIDEOS (streamline-social-layout). One item shows at its own shape, held
 * between 4:5 and 1.91:1; two or more are a carousel — it swipes on touch (scroll snap), steps with
 * arrows under a pointer, and says where it is with dots and a counter, the way Instagram's does. A
 * video shows its first frame, plays muted and looped while most of it is in view (never under
 * reduced motion), and a tap on its sound button gives it sound. Every address is signed for the
 * reader by the store (net.images), so nobody who may not read the post can fetch a file.
 * Words from network.md (media).
 */
import { computed, ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { net } from 'platformkit/lib/network/api.js'
import { shapeOf, kindOf } from 'platformkit/lib/network/model.js'

const props = defineProps({
  media: { type: Array, default: () => [] },
  /* in the For You viewer: as large as the room allows, no cropping */
  full: { type: Boolean, default: false },
  /* where the signed addresses are: the network's (net.images), or a space's (the spaces store's) */
  urls: { type: Object, default: null },
})
const M = computed(() => us('network').media.main)
const at_ = computed(() => props.urls || net.images)
const items = computed(() => props.media.map((m) => ({ ...m, kind: kindOf(m), url: at_.value[m.path] || '', posterUrl: m.poster ? at_.value[m.poster] || '' : '' })))
const shape = computed(() => shapeOf(items.value[0] || {}))
const many = computed(() => items.value.length > 1)

/* the carousel: where it is, and stepping */
const track = ref(null)
const at = ref(0)
function onScroll() {
  const el = track.value
  if (!el) return
  at.value = Math.round(el.scrollLeft / Math.max(1, el.clientWidth))
}
function go(i) {
  const el = track.value
  if (!el) return
  const n = Math.max(0, Math.min(items.value.length - 1, i))
  el.scrollTo({ left: n * el.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}

/* videos: play while most of one is in view, muted, unless the reader asked for less motion */
const root = ref(null)
const sound = ref(false)
let io = null
onMounted(async () => {
  await nextTick()
  if (!root.value || typeof IntersectionObserver === 'undefined') return
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target
      if (e.isIntersecting && e.intersectionRatio >= 0.6 && !still) v.play().catch(() => {})
      else v.pause()
    }
  }, { threshold: [0, 0.6, 1] })
  root.value.querySelectorAll('video').forEach((v) => io.observe(v))
})
onBeforeUnmount(() => { if (io) io.disconnect() })
function toggleSound(e) {
  sound.value = !sound.value
  const v = e.currentTarget.closest('.nm-item').querySelector('video')
  if (v) { v.muted = !sound.value; if (sound.value) v.play().catch(() => {}) }
}
</script>

<template>
  <div v-if="items.length" ref="root" class="nm" :class="{ 'nm-full': full, 'nm-many': many }" :style="{ '--shape': shape }" @click.stop>
    <div ref="track" class="nm-track" @scroll.passive="onScroll">
      <figure v-for="(m, i) in items" :key="m.path" class="nm-item">
        <img v-if="m.kind === 'image' && m.url" :src="m.url" :alt="m.alt || ''" loading="lazy" draggable="false" />
        <template v-else-if="m.kind === 'video'">
          <video :src="m.url || undefined" :poster="m.posterUrl || undefined" muted loop playsinline preload="metadata" :aria-label="m.alt || M.video" />
          <button type="button" class="nm-sound" :aria-pressed="sound" :aria-label="sound ? M['sound-off'] : M['sound-on']" @click.stop="toggleSound">
            <svg v-if="sound" viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8v4h3l4 3.5v-11L6.5 8zM14 7.5a3.5 3.5 0 0 1 0 5M16 5.5a6.5 6.5 0 0 1 0 9" /></svg>
            <svg v-else viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8v4h3l4 3.5v-11L6.5 8zM14 8l4 4M18 8l-4 4" /></svg>
          </button>
        </template>
        <span v-else class="nm-wait" aria-hidden="true"></span>
      </figure>
    </div>
    <template v-if="many">
      <span class="nm-count">{{ (M.of || '{i}/{n}').replace('{i}', at + 1).replace('{n}', items.length) }}</span>
      <button v-if="at > 0" type="button" class="nm-arrow nm-prev" :aria-label="M.prev" @click.stop="go(at - 1)">
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" /></svg>
      </button>
      <button v-if="at < items.length - 1" type="button" class="nm-arrow nm-next" :aria-label="M.next" @click.stop="go(at + 1)">
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5" /></svg>
      </button>
      <span class="nm-dots" aria-hidden="true"><i v-for="(m, i) in items" :key="i" :class="{ on: i === at }"></i></span>
    </template>
  </div>
</template>

<style scoped>
.nm { --e: cubic-bezier(.2, .8, .2, 1); position: relative; margin-top: 10px; border-radius: 16px; overflow: hidden; background: color-mix(in srgb, var(--ink) 6%, var(--paper));
  border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent); cursor: default }
.nm-track { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; overscroll-behavior-x: contain }
.nm-track::-webkit-scrollbar { display: none }
.nm-item { position: relative; flex: 0 0 100%; margin: 0; aspect-ratio: var(--shape); scroll-snap-align: start; overflow: hidden }
.nm-item img, .nm-item video { display: block; width: 100%; height: 100%; object-fit: cover; user-select: none }
.nm-full .nm-item { aspect-ratio: auto; height: min(78vh, 900px); background: #000 }
.nm-full .nm-item img, .nm-full .nm-item video { object-fit: contain }
.nm-wait { display: block; width: 100%; height: 100%; background: linear-gradient(90deg, color-mix(in srgb, var(--ink) 6%, transparent), color-mix(in srgb, var(--ink) 11%, transparent), color-mix(in srgb, var(--ink) 6%, transparent));
  background-size: 300% 100%; animation: nm-shimmer 1.4s ease-in-out infinite }
@keyframes nm-shimmer { from { background-position: 100% 0 } to { background-position: -100% 0 } }
/* the counter, the arrows and the dots sit over the picture on glass */
.nm-count { position: absolute; top: 10px; right: 10px; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 700; color: #fff;
  background: rgba(0, 0, 0, .5); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px) }
.nm-arrow { position: absolute; top: 50%; transform: translateY(-50%); display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 999px;
  color: #111; background: rgba(255, 255, 255, .9); box-shadow: 0 4px 14px rgba(0, 0, 0, .25); cursor: pointer; opacity: 0; transition: opacity .25s var(--e), transform .25s var(--e) }
.nm-prev { left: 10px } .nm-next { right: 10px }
.nm:hover .nm-arrow, .nm-arrow:focus-visible { opacity: 1 }
.nm-arrow:hover { transform: translateY(-50%) scale(1.06) }
.nm-dots { position: absolute; left: 0; right: 0; bottom: 10px; display: flex; justify-content: center; gap: 5px; pointer-events: none }
.nm-dots i { width: 6px; height: 6px; border-radius: 999px; background: rgba(255, 255, 255, .55); box-shadow: 0 0 4px rgba(0, 0, 0, .35); transition: background .25s var(--e), transform .25s var(--e) }
.nm-dots i.on { background: #fff; transform: scale(1.25) }
.nm-sound { position: absolute; right: 10px; bottom: 10px; display: grid; place-items: center; width: 30px; height: 30px; border: 0; border-radius: 999px;
  color: #fff; background: rgba(0, 0, 0, .55); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); cursor: pointer }
.nm-many .nm-sound { bottom: 26px }
@media (hover: none) { .nm-arrow { display: none } }
@media (prefers-reduced-motion: reduce) { .nm-arrow, .nm-dots i { transition: none } .nm-wait { animation: none } }
</style>

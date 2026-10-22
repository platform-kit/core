<script setup>
/*
 * A ticker: the slot's content, doubled and moved forever — across, or down for a cascade — at a
 * speed in pixels a second, the edges faded, paused under the pointer, and still under
 * prefers-reduced-motion (the content then simply stands, wrapped). The logo marquee, the
 * testimonial marquee and the bento's cascade are this.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
const props = defineProps({
  vertical: { type: Boolean, default: false },
  speed: { type: Number, default: 40 },     /* px per second */
  fade: { type: Boolean, default: true },
  reverse: { type: Boolean, default: false },
})
const track = ref(null), dur = ref(30)
let ro = null
function size() { const el = track.value; if (!el) return; const len = props.vertical ? el.scrollHeight / 2 : el.scrollWidth / 2; dur.value = Math.max(8, len / props.speed) }
onMounted(() => { size(); ro = new ResizeObserver(size); ro.observe(track.value) })
onBeforeUnmount(() => ro && ro.disconnect())
</script>

<template>
  <div class="tk" :class="{ 'tk-v': vertical, 'tk-fade': fade, 'tk-rev': reverse }">
    <div ref="track" class="tk-track" :style="{ '--dur': dur + 's' }">
      <div class="tk-set"><slot /></div>
      <div class="tk-set" aria-hidden="true"><slot /></div>
    </div>
  </div>
</template>

<style scoped>
.tk { overflow: hidden; position: relative }
.tk-fade { -webkit-mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent); mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent) }
.tk-v.tk-fade { -webkit-mask-image: linear-gradient(180deg, transparent, #000 12%, #000 88%, transparent); mask-image: linear-gradient(180deg, transparent, #000 12%, #000 88%, transparent) }
.tk-track { display: flex; width: max-content; animation: tk-x var(--dur) linear infinite }
.tk-v .tk-track { flex-direction: column; width: auto; height: max-content; animation-name: tk-y }
.tk-rev .tk-track { animation-direction: reverse }
.tk:hover .tk-track { animation-play-state: paused }
.tk-set { display: flex; flex: none }
.tk-v .tk-set { flex-direction: column }
@keyframes tk-x { to { transform: translateX(-50%) } }
@keyframes tk-y { to { transform: translateY(-50%) } }
@media (prefers-reduced-motion: reduce) {
  .tk-track { animation: none; width: auto; flex-wrap: wrap }
  .tk-set:last-child { display: none }
  .tk-set { flex-wrap: wrap; justify-content: center }
  .tk-fade { -webkit-mask-image: none; mask-image: none }
}
</style>

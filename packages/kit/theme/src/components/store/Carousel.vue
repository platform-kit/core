<script setup>
/*
 * A horizontal rail: scroll-snap, dragged with the mouse or a finger, stepped
 * with the arrows or the keyboard, and never showing an arrow it cannot use.
 * What goes in each slot is the caller's (a product card, a collection tile).
 */
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  keyOf: { type: Function, default: (x, i) => (x && (x.id || x.slug)) || i },
  labelPrev: { type: String, default: 'Previous' },
  labelNext: { type: String, default: 'Next' },
})

const rail = ref(null)
const canPrev = ref(false)
const canNext = ref(false)
function measure() {
  const el = rail.value
  if (!el) return
  canPrev.value = el.scrollLeft > 4
  canNext.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
}
function step(dir) {
  const el = rail.value
  if (!el) return
  const first = el.firstElementChild
  const w = first ? first.getBoundingClientRect().width + 20 : el.clientWidth * 0.8
  el.scrollBy({ left: dir * Math.max(w, el.clientWidth * 0.6), behavior: 'smooth' })
}

/* drag to scroll with a mouse; touch scrolls natively */
let drag = null
function down(e) {
  if (e.pointerType !== 'mouse') return
  drag = { x: e.clientX, left: rail.value.scrollLeft, moved: false }
  rail.value.classList.add('dragging')
}
function move(e) {
  if (!drag) return
  const dx = e.clientX - drag.x
  if (Math.abs(dx) > 4) drag.moved = true
  rail.value.scrollLeft = drag.left - dx
}
function up() {
  if (!drag) return
  const moved = drag.moved
  drag = null
  rail.value.classList.remove('dragging')
  /* a drag must not also count as a click on whatever it ended over */
  if (moved) { const stop = (ev) => { ev.stopPropagation(); ev.preventDefault() }; rail.value.addEventListener('click', stop, { capture: true, once: true }); setTimeout(() => rail.value && rail.value.removeEventListener('click', stop, { capture: true }), 0) }
}

let ro = null
onMounted(() => {
  measure()
  ro = new ResizeObserver(measure); ro.observe(rail.value)
})
onBeforeUnmount(() => { if (ro) ro.disconnect() })
watch(() => props.items, () => nextTick(measure))
</script>

<template>
  <div class="rail-wrap">
    <div ref="rail" class="rail" tabindex="0"
         @scroll.passive="measure" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @pointerleave="up"
         @keydown.left.prevent="step(-1)" @keydown.right.prevent="step(1)">
      <div v-for="(it, i) in items" :key="keyOf(it, i)" class="rail-item">
        <slot name="item" :item="it" :index="i" />
      </div>
    </div>
    <button v-show="canPrev" type="button" class="rail-btn rail-prev" :aria-label="labelPrev" @click="step(-1)">
      <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l-6 6 6 6" /></svg>
    </button>
    <button v-show="canNext" type="button" class="rail-btn rail-next" :aria-label="labelNext" @click="step(1)">
      <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4l6 6-6 6" /></svg>
    </button>
  </div>
</template>

<style scoped>
.rail-wrap { position: relative }
/* the rail scrolls, so it clips: it wears padding all round for the books' shadows and the lift on hover, and
   the same negative margin, so its cards sit where they would without it */
.rail { --rail-air: 36px; display: flex; gap: 20px; overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding: 0 calc(var(--rail-pad, 0px) + var(--rail-air));
  padding: var(--rail-air) calc(var(--rail-pad, 0px) + var(--rail-air)); margin: calc(-1 * var(--rail-air)); scrollbar-width: none; cursor: grab; outline: none;
  -webkit-overflow-scrolling: touch }
.rail::-webkit-scrollbar { display: none }
.rail.dragging { cursor: grabbing; scroll-snap-type: none; user-select: none }
.rail:focus-visible { box-shadow: 0 0 0 2px var(--accent) }
.rail-item { flex: 0 0 var(--rail-item, 300px); scroll-snap-align: start; min-width: 0 }
.rail-btn { position: absolute; top: calc(var(--rail-arrow-y, 40%)); transform: translateY(-50%); z-index: 2;
  width: 44px; height: 44px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  color: var(--ink); background: var(--paper); border: 1px solid var(--hair); box-shadow: 0 12px 30px -14px #0009; cursor: pointer;
  transition: transform .15s, box-shadow .15s }
.rail-btn:hover { transform: translateY(-50%) scale(1.06); box-shadow: 0 16px 34px -14px #000b }
.rail-prev { left: -22px } .rail-next { right: -22px }
/* on a phone the rail runs to the edge of the screen, so a card leaves the page rather than being cut mid-page */
@media (max-width: 720px) { .rail-btn { display: none } .rail { gap: 14px; --rail-air: 20px } }
</style>

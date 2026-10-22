<script setup>
import { ref } from 'vue'
import { md } from './md.js'
import SectionHead from './SectionHead.vue'
/*
 * Before / after: two pictures of the same size, one over the other, and a handle to drag between
 * them — a label on each side. A pointer drags it; the keyboard moves it (a slider underneath).
 *
 * Slots for a look's skin: `head` and `compare`.
 */
defineProps({
  badge: { type: String, default: '' }, eyebrow: { type: String, default: '' }, heading: { type: String, default: '' }, lead: { type: String, default: '' },
  before: { type: String, default: '' }, after: { type: String, default: '' },
  beforeLabel: { type: String, default: '' }, afterLabel: { type: String, default: '' },
  start: { type: Number, default: 50 },
  size: { type: String, default: 'wide' },    /* wide | narrow */
})
const at = ref(null), el = ref(null)
let dragging = false
function set(e) { const r = el.value.getBoundingClientRect(); at.value = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)) }
function down(e) { dragging = true; set(e); el.value.setPointerCapture(e.pointerId) }
function move(e) { if (dragging) set(e) }
function up() { dragging = false }
</script>
<template>
  <section class="lpsec lpcompareimg">
    <div class="lpwrap">
      <slot name="head" :heading="heading" :lead="lead"><SectionHead :badge="badge" :eyebrow="eyebrow" :heading="heading" :lead="lead" center /></slot>
      <slot name="compare" :before="before" :after="after">
        <div v-if="before && after" ref="el" class="lpba lpcard lprv" :class="'lpba-' + size" :style="{ '--at': (at ?? start) + '%' }" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
          <img :src="after" :alt="afterLabel || ''" class="lpba-img" decoding="async" />
          <img :src="before" :alt="beforeLabel || ''" class="lpba-img lpba-before" decoding="async" />
          <span v-if="beforeLabel" class="lpba-lab lpba-lab-l" v-html="md(beforeLabel)"></span>
          <span v-if="afterLabel" class="lpba-lab lpba-lab-r" v-html="md(afterLabel)"></span>
          <span class="lpba-handle" aria-hidden="true"><i><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5l-4 5 4 5M13 5l4 5-4 5" /></svg></i></span>
          <input type="range" min="0" max="100" :value="at ?? start" class="lpba-range" :aria-label="(beforeLabel || 'before') + ' / ' + (afterLabel || 'after')" @input="at = Number($event.target.value)" />
        </div>
      </slot>
    </div>
  </section>
</template>
<style scoped>
.lpba { position: relative; overflow: hidden; margin: 0 auto; user-select: none; touch-action: pan-y; cursor: col-resize; padding: 0 }
.lpba-wide { max-width: 980px } .lpba-narrow { max-width: 680px }
.lpba-img { display: block; width: 100%; height: auto }
.lpba-before { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; clip-path: inset(0 calc(100% - var(--at)) 0 0) }
.lpba-lab { position: absolute; top: 14px; padding: 5px 10px; border-radius: 999px; font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: #fff; background: #000000a0; backdrop-filter: blur(6px) }
.lpba-lab-l { left: 14px } .lpba-lab-r { right: 14px }
.lpba-handle { position: absolute; top: 0; bottom: 0; left: var(--at); width: 2px; background: #fff; transform: translateX(-1px); box-shadow: 0 0 0 1px #0002 }
.lpba-handle i { position: absolute; left: 50%; top: 50%; width: 40px; height: 40px; border-radius: 50%; background: #fff; color: #111; display: grid; place-items: center; transform: translate(-50%, -50%); box-shadow: 0 6px 20px -4px #0008 }
.lpba-range { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; margin: 0; cursor: col-resize }
.lpba-range:focus-visible + * { outline: 2px solid var(--accent) }
</style>

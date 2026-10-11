<script setup>
/*
 * The trophy: one drawing, three metals. Bronze for the first chapter of a
 * book, silver at halfway, gold for the whole book (src/lib/mastery.js), and
 * this is what a trophy looks like everywhere it is shown — the landing page,
 * a book's cover, the shelf, the sheet's Accomplishments page, the quiz's
 * "you earned" line. A cup with two handles on a stem and a plinth, lit from
 * the upper left, with a few sparkles that twinkle on their own (and hold
 * still for a reader who asks for reduced motion, or when `still` is set).
 * Purely decorative: the words beside it carry the meaning, so it is hidden
 * from assistive tech unless a label is given.
 */
import { computed } from 'vue'
const props = defineProps({
  tier: { type: String, default: 'gold' },      /* bronze | silver | gold | none (an empty outline) */
  size: { type: Number, default: 40 },
  still: { type: Boolean, default: false },
  label: { type: String, default: '' },
})
const METAL = {
  gold: { hi: '#fff1a8', mid: '#f2c94c', lo: '#b8811c', deep: '#8a5a0c', spark: '#fff6cc' },
  silver: { hi: '#f7f9fc', mid: '#c9d0da', lo: '#8a94a3', deep: '#5d6673', spark: '#ffffff' },
  bronze: { hi: '#ffd8b0', mid: '#d4914f', lo: '#a3612c', deep: '#6e3f18', spark: '#ffe6c8' },
  none: { hi: 'currentColor', mid: 'currentColor', lo: 'currentColor', deep: 'currentColor', spark: 'transparent' },
}
const m = computed(() => METAL[props.tier] || METAL.none)
const empty = computed(() => !METAL[props.tier] || props.tier === 'none')
/* gradient ids are document-wide, so each instance takes its own */
const uid = 'tr' + Math.random().toString(36).slice(2, 9)
</script>

<template>
  <span class="trophy" :class="['is-' + tier, { 'is-still': still, 'is-empty': empty }]" :style="{ width: size + 'px', height: size + 'px' }"
        :role="label ? 'img' : null" :aria-label="label || null" :aria-hidden="label ? null : 'true'">
    <svg viewBox="0 0 64 64" width="100%" height="100%">
      <defs>
        <linearGradient :id="uid + 'c'" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" :stop-color="m.hi" /><stop offset=".45" :stop-color="m.mid" /><stop offset="1" :stop-color="m.lo" />
        </linearGradient>
        <linearGradient :id="uid + 's'" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" :stop-color="m.lo" /><stop offset=".5" :stop-color="m.hi" /><stop offset="1" :stop-color="m.lo" />
        </linearGradient>
        <linearGradient :id="uid + 'b'" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" :stop-color="m.mid" /><stop offset="1" :stop-color="m.deep" />
        </linearGradient>
      </defs>
      <g v-if="empty" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity=".5">
        <path d="M18 9h28v14.5C46 32.6 39.8 40 32 40S18 32.6 18 23.5Z" />
        <path d="M19 15h-4.5A4.5 4.5 0 0 0 10 19.5c0 5 3.5 8.5 9 9.5M45 15h4.5a4.5 4.5 0 0 1 4.5 4.5c0 5-3.5 8.5-9 9.5" />
        <path d="M29.5 40v5.5h5V40M24 51h16l-2.6-5.5H26.6ZM21 51h22a2 2 0 0 1 2 2v1.5a2 2 0 0 1-2 2H21a2 2 0 0 1-2-2V53a2 2 0 0 1 2-2Z" />
      </g>
      <g v-else>
        <!-- the plinth and stem -->
        <path d="M21 56.5h22a2 2 0 0 0 2-2V53a2 2 0 0 0-2-2H21a2 2 0 0 0-2 2v1.5a2 2 0 0 0 2 2Z" :fill="m.deep" />
        <path d="M24 51h16l-2.6-6H26.6Z" :fill="'url(#' + uid + 'b)'" />
        <path d="M29.5 45h5v-5.5h-5Z" :fill="'url(#' + uid + 's)'" />
        <!-- the handles -->
        <path d="M19 15h-4.5A4.5 4.5 0 0 0 10 19.5c0 5 3.5 8.5 9 9.5" fill="none" :stroke="m.lo" stroke-width="3.2" stroke-linecap="round" />
        <path d="M45 15h4.5a4.5 4.5 0 0 1 4.5 4.5c0 5-3.5 8.5-9 9.5" fill="none" :stroke="m.lo" stroke-width="3.2" stroke-linecap="round" />
        <path d="M19 15h-4.5A4.5 4.5 0 0 0 10 19.5c0 5 3.5 8.5 9 9.5" fill="none" :stroke="m.hi" stroke-width="1.1" stroke-linecap="round" opacity=".55" />
        <path d="M45 15h4.5a4.5 4.5 0 0 1 4.5 4.5c0 5-3.5 8.5-9 9.5" fill="none" :stroke="m.hi" stroke-width="1.1" stroke-linecap="round" opacity=".35" />
        <!-- the cup -->
        <path d="M18 9h28v14.5C46 32.6 39.8 40 32 40S18 32.6 18 23.5Z" :fill="'url(#' + uid + 'c)'" />
        <path d="M18 9h28v3H18Z" :fill="m.hi" opacity=".55" />
        <path d="M22.5 14c0 8 1.5 14.5 5.5 20.5" fill="none" :stroke="m.hi" stroke-width="2.2" stroke-linecap="round" opacity=".7" />
        <path d="M18 9h28v14.5C46 32.6 39.8 40 32 40S18 32.6 18 23.5Z" fill="none" :stroke="m.deep" stroke-width=".8" opacity=".35" />
        <!-- the sparkles: one on the cup, two in the air, each with a hairline of
             the metal so they still read on a pale ground -->
        <g class="sparks" fill="#fff" :stroke="m.lo" stroke-width=".6" stroke-linejoin="round">
          <path class="sp sp1" d="M39 15l1.4 3.6 3.6 1.4-3.6 1.4-1.4 3.6-1.4-3.6-3.6-1.4 3.6-1.4Z" />
          <path class="sp sp2" d="M11 4l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6Z" />
          <path class="sp sp3" d="M55 31l1.1 2.8 2.8 1.1-2.8 1.1-1.1 2.8-1.1-2.8-2.8-1.1 2.8-1.1Z" />
        </g>
      </g>
    </svg>
  </span>
</template>

<style scoped>
.trophy { display: inline-block; flex: none; line-height: 0; vertical-align: middle; filter: drop-shadow(0 1px 1px #0000002a) }
.trophy.is-empty { filter: none }
.sp { transform-box: fill-box; transform-origin: center; animation: twinkle 2.8s ease-in-out infinite; opacity: 0 }
.sp2 { animation-delay: 1s; animation-duration: 3.4s }
.sp3 { animation-delay: 1.9s; animation-duration: 2.3s }
@keyframes twinkle {
  0%, 100% { opacity: 0; transform: scale(.2) rotate(0deg) }
  22% { opacity: 1; transform: scale(1) rotate(20deg) }
  44% { opacity: 0; transform: scale(.2) rotate(40deg) }
}
.trophy.is-still .sp, .trophy.is-still .sp2, .trophy.is-still .sp3 { animation: none; opacity: .9; transform: none }
@media (prefers-reduced-motion: reduce) { .sp, .sp2, .sp3 { animation: none; opacity: .9; transform: none } }
</style>

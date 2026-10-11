<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { md } from './md.js'
import { us } from '@platform-kit/kit/lib/strings.js'
import SectionHead from './SectionHead.vue'
/*
 * Countdown: days · hours · minutes · seconds to a moment — a launch, a sale's end (`until`, a date
 * and time) — or a span that runs for every visitor from their first look (`fomo`: hours, kept in
 * their browser, so the clock is theirs), with a line and a button; when it reaches zero, the words
 * for after. As a strip, centred, or a band (a tone).
 *
 * Slots for a look's skin: `head` and `clock`.
 */
const props = defineProps({
  badge: { type: String, default: '' }, eyebrow: { type: String, default: '' }, heading: { type: String, default: '' }, lead: { type: String, default: '' },
  until: { type: String, default: '' },        /* ISO date-time */
  fomo: { type: Number, default: 0 },          /* hours from each visitor's first look, when there is no `until` */
  layout: { type: String, default: 'centered' },   /* centered | strip */
  cta: { type: String, default: '' }, href: { type: String, default: '' },
  over: { type: String, default: '' },         /* the line when the time is up */
})
const W = (us('sections').countdown || {}).unit || {}
const left = ref(0)
let timer = null
function target() {
  if (props.until) return new Date(props.until).getTime()
  if (props.fomo > 0) { const k = 'lp.fomo.' + props.fomo; let t = 0; try { t = Number(localStorage.getItem(k)) || 0; if (!t) { t = Date.now() + props.fomo * 3600e3; localStorage.setItem(k, String(t)) } } catch (e) { t = Date.now() + props.fomo * 3600e3 } return t }
  return 0
}
function tick() { const t = target(); left.value = t ? Math.max(0, t - Date.now()) : 0 }
onMounted(() => { tick(); timer = setInterval(tick, 1000) })
onBeforeUnmount(() => clearInterval(timer))
const parts = computed(() => { const s = Math.floor(left.value / 1000); return [{ v: Math.floor(s / 86400), l: W.days }, { v: Math.floor((s % 86400) / 3600), l: W.hours }, { v: Math.floor((s % 3600) / 60), l: W.minutes }, { v: s % 60, l: W.seconds }] })
const pad = (n) => String(n).padStart(2, '0')
const done = computed(() => target() > 0 && left.value <= 0)
</script>
<template>
  <section class="lpsec lpcountdown" :class="'lpcd-' + layout">
    <div class="lpwrap lpcd">
      <slot name="head" :heading="heading" :lead="lead"><SectionHead class="lpcd-head" :badge="badge" :eyebrow="eyebrow" :heading="heading" :lead="lead" :center="layout === 'centered'" /></slot>
      <slot name="clock" :parts="parts" :done="done">
        <p v-if="done && over" class="lpcd-over lprv" v-html="md(over)"></p>
        <div v-else class="lpcd-clock lprv" role="timer">
          <div v-for="(p, i) in parts" :key="i" class="lpcd-unit lpk" :style="{ '--k': (0.05 + i * 0.08) + 's' }"><b class="lpnum">{{ pad(p.v) }}</b><span>{{ p.l }}</span></div>
        </div>
      </slot>
      <a v-if="cta && !done" :href="href || '#'" class="lpbtn text-white lpcd-cta lprv lpd1"><span v-html="md(cta)"></span></a>
    </div>
  </section>
</template>
<style scoped>
.lpcd { display: flex; flex-direction: column; align-items: center; gap: 8px }
.lpcd-head { margin-bottom: 22px }
.lpcd-clock { display: flex; gap: 12px; align-items: flex-start }
.lpcd-unit { display: flex; flex-direction: column; align-items: center; gap: 8px }
.lpcd-unit b { display: grid; place-items: center; min-width: 78px; height: 78px; padding: 0 10px; border-radius: 16px; font-family: var(--fd); font-weight: 600; font-size: 40px; letter-spacing: -.02em; color: var(--ink); background: var(--card); border: 1px solid var(--hair); box-shadow: var(--sh) }
.lpcd-unit span { font-family: var(--m); font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3) }
.lpcd-over { font-family: var(--fd); font-size: 24px; color: var(--ink2) }
.lpcd-cta { margin-top: 20px }
/* the strip: words left, clock right */
.lpcd-strip { padding: 32px 0 }
.lpcd-strip .lpcd { flex-direction: row; justify-content: space-between; flex-wrap: wrap; gap: 20px }
.lpcd-strip .lpcd-head { margin-bottom: 0 } .lpcd-strip .lpcd-head :deep(.lps) { font-size: 24px; margin: 6px 0 4px }
.lpcd-strip .lpcd-unit b { min-width: 56px; height: 56px; font-size: 26px; border-radius: 12px }
.lpcd-strip .lpcd-cta { margin: 0 }
@media (max-width: 600px) { .lpcd-unit b { min-width: 60px; height: 60px; font-size: 28px } .lpcd-clock { gap: 8px } }
</style>

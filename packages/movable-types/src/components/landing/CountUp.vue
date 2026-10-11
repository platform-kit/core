<script setup>
/*
 * A number that rolls into place as it enters view: the value as written ("12,000+", "4.9", "$1M+",
 * "98.29%") is kept exactly — the digits inside it count up from zero over a second, the rest stands
 * still — so a stat is never rounded or reformatted by the animation. Off under reduced motion, and
 * for anything with no digits. `on` false draws the value plainly.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { md } from './md.js'
const props = defineProps({ value: { type: [String, Number], default: '' }, on: { type: Boolean, default: true }, duration: { type: Number, default: 1100 } })
const el = ref(null), shown = ref('')
const text = computed(() => String(props.value ?? ''))
const m = computed(() => text.value.match(/^(.*?)(\d[\d,.]*)(.*)$/))
const rm = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
let io = null, raf = 0
function run() {
  const [, pre, num, post] = m.value
  const decimals = (num.split('.')[1] || '').length, target = Number(num.replace(/,/g, '')), grouped = num.includes(',')
  const t0 = performance.now()
  const step = (t) => {
    const k = Math.min(1, (t - t0) / props.duration), e = 1 - Math.pow(1 - k, 3)
    let v = (target * e).toFixed(decimals); if (grouped) v = Number(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    shown.value = pre + v + post
    if (k < 1) raf = requestAnimationFrame(step); else shown.value = text.value
  }
  raf = requestAnimationFrame(step)
}
onMounted(() => {
  if (!props.on || rm || !m.value) { shown.value = text.value; return }
  shown.value = m.value[1] + '0'.padEnd(1) + m.value[3]
  io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); run() } }, { threshold: .4 })
  io.observe(el.value)
})
onBeforeUnmount(() => { io && io.disconnect(); cancelAnimationFrame(raf) })
</script>
<template><span ref="el" class="lpnum" v-html="md(shown)"></span></template>

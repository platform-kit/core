<script setup>
/*
 * Words that arrive: the text split into words, each rising in a beat after the last as the block
 * is seen (`words`) — or the whole passage dim until it is scrolled through, each word brightening
 * in turn as the reader reaches it (`scroll`). Inline markdown is kept (a word inside **bold** stays
 * bold). Still under reduced motion: the words simply stand.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { md } from './md.js'
const props = defineProps({ text: { type: String, default: '' }, mode: { type: String, default: 'words' }, stagger: { type: Number, default: 0.05 }, delay: { type: Number, default: 0 } })
/* the rendered inline html, its text nodes split into word spans */
const html = computed(() => {
  const h = md(props.text); let i = 0
  return h.replace(/>([^<]+)</g, (_, t) => '>' + t.replace(/(\S+)(\s*)/g, (m, w, sp) => `<span class="lprw" style="--w:${i++}">${w}</span>${sp}`) + '<')
    .replace(/^([^<]+)/, (t) => t.replace(/(\S+)(\s*)/g, (m, w, sp) => `<span class="lprw" style="--w:${i++}">${w}</span>${sp}`))
})
const el = ref(null)
let onScroll = null
onMounted(() => {
  if (props.mode !== 'scroll') return
  const words = [...el.value.querySelectorAll('.lprw')]
  onScroll = () => {
    const r = el.value.getBoundingClientRect(), vh = window.innerHeight
    const k = Math.min(1, Math.max(0, (vh * 0.8 - r.top) / (r.height + vh * 0.3)))
    const n = Math.round(k * words.length); words.forEach((w, i) => w.classList.toggle('on', i < n))
  }
  onScroll(); window.addEventListener('scroll', onScroll, { passive: true })
})
onBeforeUnmount(() => onScroll && window.removeEventListener('scroll', onScroll))
</script>
<template><span ref="el" class="lprt" :class="'lprt-' + mode" :style="{ '--stagger': stagger + 's', '--delay': delay + 's' }" v-html="html"></span></template>
<style>
/* unscoped: the spans are made from a string */
.lprvwatch .lprv .lprt-words .lprw { display: inline-block; opacity: 0; transform: translateY(.6em); transition: opacity .6s ease, transform .8s cubic-bezier(.2,.8,.2,1); transition-delay: calc(var(--delay) + var(--w) * var(--stagger)) }
.lprvwatch .lprv.lpin .lprt-words .lprw { opacity: 1; transform: none }
.lprt-scroll .lprw { color: color-mix(in srgb, currentColor 22%, transparent); transition: color .35s ease }
.lprt-scroll .lprw.on { color: inherit }
@media (prefers-reduced-motion: reduce) { .lprvwatch .lprv .lprt-words .lprw { opacity: 1; transform: none; transition: none } .lprt-scroll .lprw { color: inherit } }
</style>

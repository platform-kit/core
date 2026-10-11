<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { md } from './md.js'
import { us } from '@platform-kit/kit/lib/strings.js'
/*
 * Announcement: the slim strip at the top of a page — a badge, a line, a link, a coupon code to copy
 * — dismissible with a × (remembered for the session, by the line's words), sticky when asked. A
 * tone makes it a band. The one section that is a line, not a block.
 */
const props = defineProps({
  badge: { type: String, default: '' },
  text: { type: String, default: '' },
  cta: { type: String, default: '' }, href: { type: String, default: '' },
  code: { type: String, default: '' },        /* a coupon, copied on a click */
  sticky: { type: Boolean, default: false },
  dismiss: { type: Boolean, default: true },
})
const W = (us('sections').announcement || {}).bar || {}
const key = computed(() => 'lp.ann.' + String(props.text).slice(0, 40))
const gone = ref((() => { try { return props.dismiss && sessionStorage.getItem(key.value) === '1' } catch (e) { return false } })())
function close() { gone.value = true; try { sessionStorage.setItem(key.value, '1') } catch (e) { /* private */ } }
const copied = ref(false)
/* the site's header sits over the landing (absolute, at the top): a bar that is the page's first section hands
   it its own height, so the header comes below the bar rather than across it, and takes it back when dismissed */
const el = ref(null)
let ro = null
const offset = (h) => { try { document.documentElement.style.setProperty('--sitehead-top', h ? h + 'px' : '') } catch (e) { /* no document */ } }
const first = () => el.value && el.value.parentElement && el.value.parentElement.querySelector('section, .lpwrap') === el.value
function measure() { if (!el.value || gone.value || !first()) return offset(0); offset(el.value.offsetHeight) }
onMounted(() => { measure(); if (typeof ResizeObserver !== 'undefined' && el.value) { ro = new ResizeObserver(measure); ro.observe(el.value) } })
watch(gone, (g) => { if (g) { offset(0); if (ro) ro.disconnect() } })
onBeforeUnmount(() => { offset(0); if (ro) ro.disconnect() })
async function copy() { try { await navigator.clipboard.writeText(props.code); copied.value = true; setTimeout(() => { copied.value = false }, 1600) } catch (e) { /* no clipboard */ } }
</script>
<template>
  <section v-if="!gone" ref="el" class="lpsec lpann" :class="{ 'lpann-sticky': sticky }">
    <div class="lpwrap lpann-in">
      <span v-if="badge" class="lpann-badge" v-html="md(badge)"></span>
      <span class="lpann-text" v-html="md(text)"></span>
      <button v-if="code" type="button" class="lpann-code" :title="W.copy" @click="copy"><code>{{ code }}</code><span>{{ copied ? W.copied : W.copy }}</span></button>
      <a v-if="cta" :href="href || '#'" class="lpann-link"><span v-html="md(cta)"></span> →</a>
      <button v-if="dismiss" type="button" class="lpann-x" :aria-label="W.close" @click="close"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg></button>
    </div>
  </section>
</template>
<style scoped>
.lpann { padding: 0 !important; border-bottom: 1px solid var(--hair); background: var(--wash); font-size: 13.5px }
.lpann-sticky { position: sticky; top: 0; z-index: 40; backdrop-filter: blur(10px) }
.lpann-in { display: flex; align-items: center; justify-content: center; gap: 12px; min-height: 40px; padding-top: 6px; padding-bottom: 6px; flex-wrap: wrap }
.lpann-badge { font-family: var(--m); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--paper); background: var(--accent); border-radius: 999px; padding: 3px 8px }
.lpann-text { color: var(--ink) } .lpann-text :deep(strong) { font-weight: 600 }
.lpann-code { display: inline-flex; align-items: center; gap: 8px; font: inherit; font-size: 12.5px; color: var(--ink); background: var(--paper); border: 1px dashed var(--ink3); border-radius: 8px; padding: 3px 8px; cursor: pointer }
.lpann-code code { font-family: var(--m); font-weight: 600; letter-spacing: .06em } .lpann-code span { color: var(--ink3) }
.lpann-link { color: var(--accent2); font-weight: 600; text-decoration: none; white-space: nowrap }
.lpann-x { position: absolute; right: 14px; display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; color: var(--ink3); background: none; border: 0; cursor: pointer } .lpann-x:hover { color: var(--ink); background: var(--card) }
.lpann-in { position: relative; padding-right: 44px }
</style>

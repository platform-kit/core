<script setup>
/*
 * A glyph chosen by name: the theme's own few first, then all of Lucide's, searched by name — the
 * chosen one drawn large beside the search, the matches as a grid of buttons. Every name the site
 * can draw in dev (the icons build step writes every icon then); a name typed that nothing draws
 * shows the spark and says so.
 */
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import NAMES from '#content/icon-names.json'
import { GLYPH_NAMES } from '../landing/glyphs.js'
import { glyph, hasGlyph } from '../landing/icons.js'
const props = defineProps({ modelValue: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue'])
const q = ref(''), open = ref(false)
/* the palette floats over the page (fixed, placed from the button), so a row that clips its overflow cannot cut it off;
   it closes on Escape, on a click elsewhere, and when the page scrolls away */
const btn = ref(null), field = ref(null), pos = ref({ top: 0, left: 0 })
function place() { if (!btn.value) return; const r = btn.value.getBoundingClientRect(); const w = Math.min(420, window.innerWidth * 0.9); pos.value = { top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) } }
function toggle() { open.value = !open.value; if (open.value) { place(); nextTick(() => field.value && field.value.focus()) } }
function onKey(e) { if (e.key === 'Escape' && open.value) { open.value = false; e.stopPropagation() } }
function onDoc(e) { if (open.value && btn.value && !btn.value.parentElement.contains(e.target)) open.value = false }
function onScroll() { if (open.value) place() }
document.addEventListener('keydown', onKey, true); document.addEventListener('mousedown', onDoc, true); window.addEventListener('scroll', onScroll, true)
onBeforeUnmount(() => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDoc, true); window.removeEventListener('scroll', onScroll, true) })
const matches = computed(() => {
  const s = q.value.trim().toLowerCase()
  const own = GLYPH_NAMES.filter((n) => !s || n.includes(s))
  const luc = (NAMES || []).filter((n) => !s || n.includes(s)).filter((n) => !own.includes(n))
  return own.map((n) => ({ n, own: true })).concat(luc.slice(0, 96).map((n) => ({ n, own: false })))
})
function pick(n) { emit('update:modelValue', n); open.value = false }
</script>

<template>
  <div class="gp" :class="{ open }">
    <button ref="btn" type="button" class="gp-cur" @click="toggle" :title="modelValue">
      <span class="gp-ico" v-html="glyph(modelValue)"></span>
      <span class="gp-name">{{ modelValue || '—' }}</span>
      <em v-if="modelValue && !hasGlyph(modelValue)" class="gp-warn">unknown</em>
    </button>
    <div v-if="open" class="gp-pop" :style="{ top: pos.top + 'px', left: pos.left + 'px' }">
      <input ref="field" v-model="q" type="text" class="gp-q" placeholder="Search icons…" spellcheck="false" />
      <div class="gp-grid">
        <button v-for="m in matches" :key="m.n" type="button" class="gp-b" :class="{ on: m.n === modelValue, own: m.own }" :title="m.n" @click="pick(m.n)" v-html="glyph(m.n)"></button>
      </div>
      <p class="gp-foot">{{ matches.length }} shown · {{ (NAMES || []).length + GLYPH_NAMES.length }} in all</p>
    </div>
  </div>
</template>

<style scoped>
.gp { position: relative }
.gp-cur { display: inline-flex; align-items: center; gap: 10px; height: 38px; padding: 0 12px 0 6px; font: inherit; font-size: 13px; color: var(--ink); background: var(--paper); border: 1px solid var(--hair); border-radius: 9px; cursor: pointer }
.gp-cur:hover { border-color: var(--ink3) }
.gp-ico { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px; color: var(--accent2); background: var(--accentbg, color-mix(in srgb, var(--accent2) 10%, transparent)) } .gp-ico :deep(svg) { width: 16px; height: 16px }
.gp-name { font-family: var(--m); font-size: 12px }
.gp-warn { font-size: 11px; color: #b45309; font-style: normal }
.gp-pop { position: fixed; z-index: 60; width: min(420px, 90vw); padding: 10px; background: var(--paper); border: 1px solid var(--hair); border-radius: 12px; box-shadow: 0 24px 50px -20px #000a }
.gp-q { width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; padding: 8px 10px; border: 1px solid var(--hair); border-radius: 8px; background: var(--card); color: var(--ink); outline: none; margin-bottom: 8px }
.gp-q:focus { border-color: var(--accent2) }
.gp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(34px, 1fr)); gap: 4px; max-height: 260px; overflow-y: auto }
.gp-b { display: grid; place-items: center; height: 34px; border-radius: 8px; color: var(--ink3); background: var(--paper); border: 1px solid var(--hair); cursor: pointer }
.gp-b :deep(svg) { width: 17px; height: 17px }
.gp-b.own { color: var(--ink2) }
.gp-b:hover { color: var(--ink); border-color: var(--ink3) }
.gp-b.on { color: var(--accent2); background: var(--accentbg, color-mix(in srgb, var(--accent2) 10%, transparent)); border-color: var(--accent2) }
.gp-foot { margin: 8px 0 0; font-family: var(--m); font-size: 10.5px; color: var(--ink3) }
</style>

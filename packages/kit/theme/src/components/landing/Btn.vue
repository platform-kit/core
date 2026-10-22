<script setup>
/* a button of the page's: the words, a link, a style — primary (the ink pill), secondary (outlined), ghost (quiet), link (words with an arrow) — a glyph before the words when named, and a glow behind it when asked */
import { md } from './md.js'
import { glyph } from './icons.js'
defineProps({ label: { type: String, default: '' }, href: { type: String, default: '#' }, variant: { type: String, default: 'primary' }, icon: { type: String, default: '' }, glow: { type: Boolean, default: false }, arrow: { type: Boolean, default: true } })
</script>
<template>
  <a v-if="label" :href="href" class="lpbtn2" :class="['lpbtn2-' + variant, { lpbtn: variant === 'primary', 'text-white': variant === 'primary', 'lpbtn2-glow': glow }]">
    <span v-if="icon" class="lpbtn2-ico" v-html="glyph(icon)"></span>
    <span v-html="md(label)"></span>
    <svg v-if="arrow && variant !== 'ghost'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5" /></svg>
  </a>
</template>
<style scoped>
.lpbtn2 { display: inline-flex; align-items: center; gap: 9px; font-weight: 600; font-size: 15.5px; text-decoration: none; position: relative; border-radius: 999px; transition: transform .18s ease, box-shadow .18s ease, background .15s, color .15s }
.lpbtn2-ico :deep(svg) { width: 17px; height: 17px }
.lpbtn2-secondary { padding: 13px 26px; color: var(--ink); background: transparent; border: 1.5px solid var(--hair) } .lpbtn2-secondary:hover { border-color: var(--ink3); transform: translateY(-2px) }
.lpbtn2-ghost { padding: 14px 6px; color: var(--ink2) } .lpbtn2-ghost:hover { color: var(--ink) }
.lpbtn2-link { padding: 4px 0; color: var(--accent2); border-radius: 0 }
.lpbtn2-glow::before { content: ''; position: absolute; inset: -4px; z-index: -1; border-radius: inherit; background: conic-gradient(from 90deg, var(--accent), var(--sun), var(--c2, var(--accent2)), var(--accent)); filter: blur(12px); opacity: .7 }
.lpbtn2-glow { isolation: isolate }
</style>

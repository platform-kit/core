<script setup>
/*
 * "Add a section": a gallery of the section types, each a sketch of its layout with its name
 * and one line — grouped (the openers, content, proof, people, what draws on the site's own
 * data, the site's own sections), searched from the top, chosen by a click or Enter. A plain
 * modal of the builder's own, teleported to <body> so it lifts above the drawer.
 */
import { ref, computed, watch, nextTick } from 'vue'
import { SECTION_SCHEMAS, SECTION_KEYS } from '../landing/schemas.js'
import { sketchOf } from './sketches.js'
import { SearchIcon, XIcon } from 'lucide-vue-next'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['update:open', 'pick'])
const q = ref(''), input = ref(null), active = ref(0)
const GROUPS = ['Openers', 'Content', 'Proof', 'Commerce', 'People', 'From the site', 'Closers', 'This site']
const groupOf = (k) => SECTION_SCHEMAS[k].group || 'This site'
/* the kit's sections in the order a page tends to use them; a section not named here (a site's own) follows in its file's order */
const ORDER = ['Announcement', 'Hero', 'Marquee',
  'Features', 'Split', 'Bento', 'Steps', 'Showcase', 'BeforeAfter', 'Carousel', 'Tabs', 'Gallery', 'Video', 'Prose', 'Timeline', 'Divider', 'How',
  'Logos', 'Stats', 'Testimonials', 'Quote', 'Compare', 'FAQ', 'Integrations',
  'Pricing', 'Products', 'Spotlight', 'Collections', 'Perks',
  'Team', 'Creator', 'Newsletter', 'Contact', 'Form',
  'Articles', 'Entries', 'Library', 'Coaching',
  'Cta', 'Countdown', 'Close', 'Footer']
const rank = (k) => { const i = ORDER.indexOf(k); return i < 0 ? ORDER.length + SECTION_KEYS.indexOf(k) : i }
const hits = computed(() => {
  const s = q.value.trim().toLowerCase()
  return [...SECTION_KEYS].sort((a, b) => rank(a) - rank(b)).filter((k) => !s || [k, SECTION_SCHEMAS[k].label, SECTION_SCHEMAS[k].description, groupOf(k)].join(' ').toLowerCase().includes(s))
})
/* the kit's groups in their order, then any a site names, then the rest */
const groups = computed(() => { const names = [...GROUPS, ...new Set(SECTION_KEYS.map(groupOf).filter((g) => !GROUPS.includes(g)))]; return names.map((g) => ({ name: g, keys: hits.value.filter((k) => groupOf(k) === g) })).filter((g) => g.keys.length) })
const flat = computed(() => groups.value.flatMap((g) => g.keys))
watch(hits, () => { active.value = 0 })
watch(() => props.open, async (v) => { if (v) { q.value = ''; active.value = 0; await nextTick(); input.value && input.value.focus() } })
function close() { emit('update:open', false) }
function pick(k) { emit('pick', k); close() }
function onKey(e) {
  if (e.key === 'Escape') { close(); return }
  const n = flat.value.length; if (!n) return
  const cols = 3
  if (e.key === 'ArrowRight') active.value = (active.value + 1) % n
  else if (e.key === 'ArrowLeft') active.value = (active.value - 1 + n) % n
  else if (e.key === 'ArrowDown') active.value = Math.min(n - 1, active.value + cols)
  else if (e.key === 'ArrowUp') active.value = Math.max(0, active.value - cols)
  else if (e.key === 'Enter') { pick(flat.value[active.value]); return }
  else return
  e.preventDefault()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="pk">
      <div v-if="open" class="pk-veil" @click.self="close" @keydown="onKey">
        <div class="pk" role="dialog" aria-modal="true" aria-label="Add a section">
          <div class="pk-top">
            <span class="pk-eyebrow">Add a section</span>
            <label class="pk-search"><SearchIcon :size="15" /><input ref="input" v-model="q" type="text" placeholder="Search sections…" spellcheck="false" /></label>
            <button type="button" class="pk-x" title="Close" @click="close"><XIcon :size="16" /></button>
          </div>
          <div class="pk-body">
            <p v-if="!flat.length" class="pk-none">No section matches that.</p>
            <div v-for="g in groups" :key="g.name" class="pk-group">
              <div class="pk-gname">{{ g.name }}</div>
              <div class="pk-grid">
                <button v-for="k in g.keys" :key="k" type="button" class="pk-card" :class="{ on: flat[active] === k }" @mouseenter="active = flat.indexOf(k)" @click="pick(k)">
                  <span class="pk-sketch" v-html="sketchOf(SECTION_SCHEMAS[k].sketch || k)"></span>
                  <b>{{ SECTION_SCHEMAS[k].label }}</b>
                  <span>{{ SECTION_SCHEMAS[k].description }}</span>
                </button>
              </div>
            </div>
          </div>
          <div class="pk-foot"><kbd>↑↓←→</kbd> move <kbd>↵</kbd> add <kbd>esc</kbd> close</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
/* global on purpose: the dialog lives in <body>, outside any component scope */
.pk-veil { position: fixed; inset: 0; z-index: 130; display: grid; place-items: center; padding: 24px; background: color-mix(in srgb, var(--ink) 38%, transparent); backdrop-filter: blur(6px) }
.pk { display: flex; flex-direction: column; width: min(880px, 100%); max-height: min(82vh, 760px); border-radius: 18px; overflow: hidden; color: var(--ink);
  background: var(--paper); border: 1px solid var(--hair); box-shadow: 0 50px 100px -30px #000c, 0 0 0 1px #0000000a }
.pk *, .pk *::before, .pk *::after { box-sizing: border-box }
.pk-top { display: flex; align-items: center; gap: 14px; padding: 14px 16px 14px 20px; border-bottom: 1px solid var(--hair) }
.pk-eyebrow { font-family: var(--m); font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--accent2); white-space: nowrap }
.pk-search { flex: 1; display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 12px; border-radius: 10px; background: var(--wash); border: 1px solid var(--hair); color: var(--ink3) }
.pk-search:focus-within { border-color: var(--accent2); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent2) 16%, transparent) }
.pk-search input { flex: 1; min-width: 0; font: inherit; font-size: 14px; color: var(--ink); background: none; border: 0; outline: none }
.pk-search input::placeholder { color: var(--ink3) }
.pk-x { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; color: var(--ink3); background: none; border: 0; border-radius: 9px; cursor: pointer } .pk-x:hover { color: var(--ink); background: var(--wash) }
.pk-body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 20px 20px }
.pk-group { margin-top: 18px; padding: 0; border: 0 }
.pk-gname { margin: 0 0 10px; font-family: var(--m); font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); font-weight: 500 }
.pk-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px }
.pk-card { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 10px 12px 12px; font: inherit; color: var(--ink); text-align: left; background: var(--card); border: 1px solid var(--hair); border-radius: 14px; cursor: pointer;
  transition: transform .15s cubic-bezier(.2,.8,.2,1), box-shadow .15s, border-color .15s }
.pk-card:hover, .pk-card.on { border-color: var(--accent2); box-shadow: 0 14px 30px -18px #0009; transform: translateY(-2px) }
.pk-card b { font-family: var(--fd); font-weight: 600; font-size: 14.5px; margin-top: 4px }
.pk-card > span:last-child { font-size: 12px; line-height: 1.4; color: var(--ink3); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden }
.pk-sketch { display: block; width: 100%; aspect-ratio: 120 / 72; border-radius: 9px; background: var(--wash); color: var(--ink); border: 1px solid var(--hair); overflow: hidden }
.pk-sketch svg { display: block; width: 100%; height: 100% }
.pk-card:hover .pk-sketch, .pk-card.on .pk-sketch { color: var(--accent2) }
.pk-none { padding: 30px; text-align: center; color: var(--ink3); font-size: 13.5px }
.pk-foot { display: flex; gap: 14px; padding: 10px 20px; border-top: 1px solid var(--hair); font-size: 12px; color: var(--ink3); background: var(--wash) }
.pk-foot kbd { font-family: var(--m); font-size: 10px; color: var(--ink2); border: 1px solid var(--hair); border-radius: 4px; padding: 1px 5px; margin-right: 4px; background: var(--paper) }
.pk-enter-active, .pk-leave-active { transition: opacity .18s } .pk-enter-active .pk, .pk-leave-active .pk { transition: transform .22s cubic-bezier(.2,.8,.2,1), opacity .18s }
.pk-enter-from, .pk-leave-to { opacity: 0 } .pk-enter-from .pk, .pk-leave-to .pk { transform: translateY(12px) scale(.98); opacity: 0 }
@media (max-width: 720px) { .pk-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) } }
</style>

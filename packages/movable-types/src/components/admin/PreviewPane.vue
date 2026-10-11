<script setup>
/*
 * The live preview in the admin: a banner (status, split toggle, exit) over a
 * frame that loads /__preview (PreviewPage.vue) and is fed the draft entry
 * over postMessage. The frame is what makes the preview honest — the page in
 * it has a real viewport, so the site's breakpoints and fixed chrome behave as
 * they do live, whether the preview fills the screen or sits beside the editor.
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { LOOKS, look as siteLook } from '@platform-kit/kit/lib/look.js'

const props = defineProps({
  col: { type: String, required: true },      /* the collection key */
  entry: { type: Object, default: null },     /* the last good compiled entry */
  issues: { type: Array, default: () => [] }, /* schema issues, when the draft does not compile */
  busy: { type: Boolean, default: false },
  split: { type: Boolean, default: false },   /* beside the editor rather than in its place */
  focus: { type: Number, default: -1 },       /* the page section being edited: the frame scrolls to it */
})
const emit = defineEmits(['close', 'toggle-split', 'pick'])

const frame = ref(null)
let ready = false
/* the look the frame wears: starts as the site's, flips without saving */
const look = ref(siteLook.value)
function setLook(l) {
  look.value = l
  const w = frame.value && frame.value.contentWindow
  if (w && ready) w.postMessage({ type: 'dl-look', look: l }, window.location.origin)
}
function post() {
  const w = frame.value && frame.value.contentWindow
  if (!w || !ready) return
  /* a plain copy: the entry is reactive here, and a proxy cannot cross a window */
  const entry = props.entry ? JSON.parse(JSON.stringify(props.entry)) : null
  w.postMessage({ type: 'dl-preview', col: props.col, entry }, window.location.origin)
}
function onMessage(e) {
  if (e.origin !== window.location.origin || !e.data) return
  if (e.data.type === 'dl-preview-ready') { ready = true; post(); setLook(look.value) }
  if (e.data.type === 'dl-preview-close') emit('close')
  if (e.data.type === 'dl-preview-pick') emit('pick', e.data.index)
}
watch(() => [props.col, props.entry], post)
watch(() => props.focus, (i) => { const w = frame.value && frame.value.contentWindow; if (w && ready && i >= 0) w.postMessage({ type: 'dl-focus', index: i }, window.location.origin) })
function onKey(e) { if (e.key === 'Escape' && !e.defaultPrevented) emit('close') }
onMounted(() => { window.addEventListener('message', onMessage); document.addEventListener('keydown', onKey) })
onBeforeUnmount(() => { window.removeEventListener('message', onMessage); document.removeEventListener('keydown', onKey) })
</script>

<template>
  <div class="pv" :class="{ 'pv-split': split }">
    <div class="pv-bar">
      <span class="pv-tag">Live preview</span>
      <span class="pv-note">The unsaved draft, as the site would show it</span>
      <span v-if="busy" class="pv-state pv-busy">Rendering…</span>
      <span v-else-if="issues.length" class="pv-state pv-warn">{{ issues.length }} {{ issues.length === 1 ? 'issue' : 'issues' }}</span>
      <span v-else-if="entry" class="pv-state pv-ok">Up to date</span>
      <span v-else class="pv-state" />
      <span v-if="LOOKS.length > 1" class="pv-looks" role="group" aria-label="Look">
        <button v-for="l in LOOKS" :key="l" type="button" class="pv-btn pv-look" :class="{ on: look === l }" :aria-pressed="look === l"
                :title="'Show the page in the ' + l + ' look (the site\'s own is set under Site settings)'" @click="setLook(l)">{{ l }}</button>
      </span>
      <button type="button" class="pv-btn" :class="{ on: split }" :aria-pressed="split" :title="split ? 'Preview fills the screen' : 'Preview beside the editor'"
              @click="emit('toggle-split')">
        <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="2.5" y="4" width="15" height="12" rx="2" /><path d="M10 4v12" /></svg>
        Split
      </button>
      <button type="button" class="pv-btn pv-exit" @click="emit('close')">
        <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
        Exit preview <kbd>esc</kbd>
      </button>
    </div>
    <ul v-if="issues.length" class="pv-issues">
      <li v-for="(i, n) in issues" :key="n"><code v-if="i.path">{{ i.path }}</code> {{ i.message }}</li>
    </ul>
    <iframe ref="frame" class="pv-frame" src="/__preview" title="Live preview" />
  </div>
</template>

<style scoped>
.pv { display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--paper); color: var(--ink) }
.pv-bar { flex: none; display: flex; align-items: center; gap: 12px; padding: 8px 14px 8px 16px; border-bottom: 1px solid var(--hair); background: var(--wash);
  font-family: var(--m); font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); white-space: nowrap }
.pv-tag { color: var(--accent2); flex: none }
.pv-note { text-transform: none; letter-spacing: 0; font-family: inherit; font-size: 12.5px; color: var(--ink3); min-width: 0; overflow: hidden; text-overflow: ellipsis }
.pv-state { margin-left: auto; flex: none }
/* beside the editor the pane is narrow: the note goes */
.pv-split .pv-note { display: none }
.pv-warn { color: #b45309 }
.pv-btn { display: inline-flex; align-items: center; gap: 7px; font: inherit; font-size: 12.5px; color: var(--ink2); background: var(--paper);
  border: 1px solid var(--hair); border-radius: 999px; padding: 6px 12px 6px 10px; cursor: pointer }
.pv-btn:hover { color: var(--ink); border-color: var(--ink3) }
.pv-btn.on { color: var(--accent2); border-color: var(--accent2); background: color-mix(in srgb, var(--accent2) 10%, transparent) }
.pv-exit { color: var(--ink) }
.pv-exit kbd { font-family: var(--m); font-size: 9.5px; color: var(--ink3); border: 1px solid var(--hair); border-radius: 4px; padding: 1px 4px }
.pv-issues { flex: none; margin: 0; padding: 10px 16px; list-style: none; background: #fff7ed; color: #7c2d12; border-bottom: 1px solid #fed7aa; font-size: 13px }
.pv-issues li + li { margin-top: 4px }
.pv-issues code { font-family: var(--m); font-size: 11.5px; margin-right: 6px }
.pv-frame { flex: 1; min-height: 0; width: 100%; border: 0; background: var(--paper) }
.pv-looks { display: inline-flex; gap: 4px; margin-left: 8px }
.pv-look { text-transform: capitalize }
</style>

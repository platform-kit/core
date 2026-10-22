<script setup>
/*
 * A body split into chapters at its `# ` headings — the top level of division
 * in any of our markdown. One chapter is open at a time in its own TipTap
 * instance; the others stay exactly as written on disk, byte for byte, until
 * they are opened. The list on the left is the table of contents: click to
 * open, drag to reorder, add, remove, rename. What leaves here is one
 * markdown string, reassembled, so the file keeps its frontmatter and shape.
 * A body with no `# ` heading is edited whole.
 */
import { ref, computed, watch } from 'vue'
import draggable from 'vuedraggable'
import MarkdownEditor from './MarkdownEditor.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  compact: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'chapters'])

/* ---- split / join ---- */
function split(md) {
  const lines = (md || '').split('\n')
  const pre = [], chapters = []
  let cur = null, fence = false
  for (const line of lines) {
    if (/^(```|~~~)/.test(line)) fence = !fence
    const h = !fence && /^#\s+(.+?)\s*#*\s*$/.exec(line)
    if (h) { cur = { title: h[1], lines: [] }; chapters.push(cur); continue }
    (cur ? cur.lines : pre).push(line)
  }
  return { pre: pre.join('\n'), chapters: chapters.map((c) => ({ title: c.title, body: c.lines.join('\n') })) }
}
function join(pre, chapters) {
  const parts = []
  if (pre.trim()) parts.push(pre.replace(/\n+$/, ''))
  for (const c of chapters) parts.push('# ' + c.title.trim() + '\n\n' + c.body.replace(/^\n+/, '').replace(/\n+$/, ''))
  return parts.join('\n\n') + (parts.length ? '\n' : '')
}

let ids = 0
const pre = ref('')
const chapters = ref([])   /* [{ id, title, body }] */
const active = ref(0)
let lastEmitted = null
function hydrate(md) {
  if (md === lastEmitted) return
  const s = split(md)
  pre.value = s.pre
  chapters.value = s.chapters.map((c) => ({ id: ++ids, ...c }))
  active.value = Math.min(active.value, Math.max(0, chapters.value.length - 1))
  emit('chapters', chapters.value.length)
}
watch(() => props.modelValue, hydrate, { immediate: true })
function emitAll() {
  lastEmitted = chapters.value.length ? join(pre.value, chapters.value) : pre.value
  emit('update:modelValue', lastEmitted)
}

const whole = computed(() => chapters.value.length === 0)   /* no chapters: edit the body as one */
const cur = computed(() => chapters.value[active.value] || null)
const words = (s) => (s || '').trim().split(/\s+/).filter(Boolean).length
const marks = (s) => ((s || '').match(/==[^=]+==/g) || []).length

function onBody(v) { if (cur.value) { cur.value.body = v; emitAll() } }
function onTitle(v) { if (cur.value) { cur.value.title = v; emitAll() } }
function onPre(v) { pre.value = v; emitAll() }
function add() { chapters.value.push({ id: ++ids, title: 'New chapter', body: '' }); active.value = chapters.value.length - 1; emitAll() }
function remove(i) {
  const c = chapters.value[i]
  if (!confirm(`Remove “${c.title}” and its ${words(c.body)} words?`)) return
  chapters.value.splice(i, 1); active.value = Math.max(0, Math.min(active.value, chapters.value.length - 1)); emitAll()
}
function onEnd(e) {
  if (e.oldIndex === e.newIndex) return
  const id = cur.value && cur.value.id
  const [m] = chapters.value.splice(e.oldIndex, 1); chapters.value.splice(e.newIndex, 0, m)
  active.value = Math.max(0, chapters.value.findIndex((c) => c.id === id))
  emitAll()
}
const showPre = ref(false)
</script>

<template>
  <MarkdownEditor v-if="whole" :model-value="pre" :compact="compact" @update:model-value="onPre" />
  <div v-else class="ce" :class="{ compact }">
    <aside class="ce-toc">
      <div class="ce-tochead">{{ chapters.length }} chapter{{ chapters.length === 1 ? '' : 's' }}</div>
      <button v-if="pre.trim() || showPre" type="button" class="ce-item ce-pre" :class="{ on: active === -1 }" @click="active = -1">
        <span class="ce-title">Before the first chapter</span>
        <span class="ce-meta">{{ words(pre) }} w</span>
      </button>
      <draggable v-model="chapters" item-key="id" handle=".ce-grip" class="ce-list" ghost-class="ce-ghost" :animation="150" :force-fallback="true" :fallback-tolerance="4" @end="onEnd">
        <template #item="{ element, index }">
          <div class="ce-item" :class="{ on: index === active }" @click="active = index">
            <span class="ce-grip" title="Drag to reorder">⋮⋮</span>
            <span class="ce-n">{{ index + 1 }}</span>
            <span class="ce-title">{{ element.title || 'Untitled' }}</span>
            <span class="ce-meta">{{ words(element.body) }} w<template v-if="marks(element.body)"> · {{ marks(element.body) }} ✎</template></span>
          </div>
        </template>
      </draggable>
      <div class="ce-tocfoot">
        <button type="button" class="ce-add" @click="add">+ Add chapter</button>
        <button v-if="!pre.trim() && !showPre" type="button" class="ce-link" @click="showPre = true; active = -1">Add text before the first chapter</button>
      </div>
    </aside>
    <div class="ce-main">
      <template v-if="active === -1">
        <div class="ce-head"><span class="ce-label">Before the first chapter</span></div>
        <MarkdownEditor key="pre" :model-value="pre" :compact="compact" @update:model-value="onPre" />
      </template>
      <template v-else-if="cur">
        <div class="ce-head">
          <span class="ce-label">Chapter {{ active + 1 }}</span>
          <input class="ce-titlein" :value="cur.title" type="text" placeholder="Chapter title" @input="onTitle($event.target.value)" />
          <button type="button" class="ce-rm" title="Remove this chapter" @click="remove(active)">Remove</button>
        </div>
        <MarkdownEditor :key="cur.id" :model-value="cur.body" :compact="compact" @update:model-value="onBody" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.ce { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 0; min-height: 0; height: 100%; border: 1px solid var(--hair); border-radius: 12px; overflow: hidden; background: var(--paper) }
.ce.compact { grid-template-columns: 210px minmax(0, 1fr) }
.ce-toc { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--hair); background: var(--wash) }
.ce-tochead { font-family: var(--m); font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3); padding: 12px 14px 8px }
.ce-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 6px 6px }
.ce-item { display: grid; grid-template-columns: 14px 22px minmax(0, 1fr); grid-template-rows: auto auto; column-gap: 6px; align-items: center; width: 100%; text-align: left; font: inherit;
  padding: 7px 8px; border-radius: 8px; cursor: pointer; color: var(--ink2); background: none; border: 0 }
.ce-item:hover { background: color-mix(in srgb, var(--ink) 6%, transparent) }
.ce-item.on { background: var(--paper); color: var(--ink); box-shadow: 0 1px 0 var(--hair), 0 0 0 1px var(--hair) }
.ce-pre { grid-template-columns: minmax(0, 1fr); margin: 0 6px 4px }
.ce-ghost { opacity: .4 }
.ce-grip { grid-row: 1 / span 2; font-size: 11px; letter-spacing: -2px; color: var(--ink3); cursor: grab }
.ce-n { grid-row: 1 / span 2; font-family: var(--m); font-size: 11px; color: var(--ink3); text-align: right }
.ce-title { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.ce-meta { font-family: var(--m); font-size: 10.5px; color: var(--ink3) }
.ce-tocfoot { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px 10px; border-top: 1px solid var(--hair) }
.ce-add { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink); background: var(--paper); border: 1px solid var(--hair); border-radius: 999px; padding: 6px 12px; cursor: pointer }
.ce-add:hover { border-color: var(--ink3) }
.ce-link { font: inherit; font-size: 11.5px; color: var(--ink3); background: none; border: 0; padding: 0; cursor: pointer; text-align: left }
.ce-link:hover { color: var(--accent2); text-decoration: underline }
.ce-main { display: flex; flex-direction: column; min-height: 0; padding: 12px 16px 14px }
.ce-head { display: flex; align-items: center; gap: 12px; margin: 0 0 10px }
.ce-label { font-family: var(--m); font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3); white-space: nowrap }
.ce-titlein { flex: 1; min-width: 0; font-family: var(--fd); font-size: 20px; font-weight: 600; color: var(--ink); background: none; border: 0; border-bottom: 1px solid var(--hair); padding: 4px 0 }
.ce-titlein:focus { outline: none; border-color: var(--accent2) }
.ce-rm { font: inherit; font-size: 12px; color: var(--ink3); background: none; border: 1px solid var(--hair); border-radius: 999px; padding: 4px 10px; cursor: pointer }
.ce-rm:hover { color: #dc2626; border-color: #dc262666 }
.ce-main :deep(.md) { flex: 1; min-height: 0 }
.ce-main :deep(.md .ProseMirror) { min-height: 0 }
</style>

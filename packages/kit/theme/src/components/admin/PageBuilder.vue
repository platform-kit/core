<script setup>
/*
 * The page builder: the page as an ordered list of section blocks — each a sketch of its
 * layout, its name and a line of what it says — dragged into order, added at any point
 * (the seam between two blocks, or the foot), duplicated, moved, removed, and opened into
 * a form drawn from the section's zod schema (components/landing/schemas.js, through
 * SectionFields.vue). Its output is the page's `sections` list, exactly what the markdown
 * holds; the live preview follows it, scrolls to the block being edited, and a click on a
 * section in the preview opens its block here. Editors never see JSON.
 */
import { ref, computed, watch, nextTick } from 'vue'
import draggable from 'vuedraggable'
import { GripVerticalIcon, ChevronDownIcon, CopyIcon, TrashIcon, PlusIcon, AlertCircleIcon, ArrowUpIcon, ArrowDownIcon, LayoutTemplateIcon } from 'lucide-vue-next'
import { SECTION_SCHEMAS, SECTION_KEYS, subSchema } from '../landing/schemas.js'
import { SECTION_NAMES } from '../landing/index.js'
import { sketchOf } from './sketches.js'
import SectionFields from './SectionFields.vue'
import SectionPicker from './SectionPicker.vue'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  compact: { type: Boolean, default: false },
  pick: { type: Number, default: -1 },   /* a section chosen in the preview: its index, opened here */
})
const emit = defineEmits(['update:modelValue', 'valid', 'focus'])

if (import.meta.env.DEV) {
  const a = new Set(SECTION_KEYS), b = new Set(SECTION_NAMES)
  for (const k of SECTION_NAMES) if (!a.has(k)) console.warn('[pages] section without a schema:', k)
  for (const k of SECTION_KEYS) if (!b.has(k)) console.warn('[pages] schema without a section:', k)
}

let seq = 0
const blocks = ref([])
const clone = (v) => JSON.parse(JSON.stringify(v == null ? null : v))
/* `key:` with nothing after it is null in YAML; the form treats it as blank */
const blankNulls = (v) => (v === null ? undefined : Array.isArray(v) ? v.map(blankNulls) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blankNulls(x)])) : v)
const def = (b) => SECTION_SCHEMAS[b.component] || null
/* the section against its schema, and its conditional record against the chosen kind's: { errors by path, valid } */
function check(b) {
  const d = def(b); if (!d) return { errors: {}, valid: b.valid }
  const errors = {}
  const r = d.schema.safeParse(blankNulls(b.props || {}))
  if (!r.success) for (const e of r.error.issues) errors[e.path.join('.')] = errors[e.path.join('.')] || e.message
  const sub = subSchema(d, b.props)
  if (sub) { const q = sub.schema.safeParse(blankNulls((b.props || {})[d.conditional.field] || {})); if (!q.success) for (const e of q.error.issues) errors[d.conditional.field + '.' + e.path.join('.')] = e.message }
  return { errors, valid: !Object.keys(errors).length }
}
const hydrate = (list) => (Array.isArray(list) ? list : []).map((s) => {
  const b = { id: ++seq, component: s.component, props: { ...((SECTION_SCHEMAS[s.component] && SECTION_SCHEMAS[s.component].defaults) || {}), ...(s.props || {}) }, open: false, valid: true, errors: {}, rawText: '' }
  Object.assign(b, check(b)); return b
})

/* the model is ours after every emit: re-hydrate only when someone else changes it */
let lastEmitted = ''
watch(() => props.modelValue, (v) => {
  const json = JSON.stringify(v || [])
  if (json === lastEmitted) return
  blocks.value = hydrate(v)
  emit('valid', blocks.value.every((b) => b.valid))
}, { immediate: true, deep: true })

function serialize() {
  return blocks.value.map((b) => {
    const d = def(b), p = clone(b.props || {})
    if (d && d.conditional && !subSchema(d, p)) delete p[d.conditional.field]   /* a stage's words go with the stage */
    return Object.keys(p).length ? { component: b.component, props: p } : { component: b.component }
  })
}
function emitAll() {
  const out = serialize()
  lastEmitted = JSON.stringify(out)
  emit('update:modelValue', out)
  emit('valid', blocks.value.every((b) => b.valid))
}
const plain = (s) => String(s || '').replace(/[*_`~]+/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
const summary = (b) => { const d = def(b); try { return plain((d && d.summary(b.props)) || '') } catch (e) { return '' } }
/* what the block holds, in a word: "6 features", "3 tiers" */
const meta = (b) => {
  const d = def(b); if (!d) return ''
  const p = b.props || {}
  for (const k of Object.keys(p)) if (Array.isArray(p[k]) && p[k].length && typeof p[k][0] === 'object') { const n = p[k].length, cfg = (d.fieldConfig || {})[k] || {}, one = (cfg.item || k.replace(/s$/, '')).toLowerCase(); return n + ' ' + (n === 1 ? one : (cfg.items || one + 's')) }
  return ''
}
const allValid = computed(() => blocks.value.every((b) => b.valid))

function onChange(b, values) {
  const d = def(b)
  /* the conditional record: seed the chosen kind's defaults the first time it is chosen */
  if (d && d.conditional) { const sub = subSchema(d, values); if (sub && !(values[d.conditional.field] && Object.keys(values[d.conditional.field]).length)) values = { ...values, [d.conditional.field]: clone(sub.defaults || {}) } }
  b.props = values; Object.assign(b, check(b))
  emitAll()
}
/* a preset lays its props over the block's (the section keeps what the preset does not say) */
function preset(b, pr) { b.props = { ...b.props, ...clone(pr.props) }; Object.assign(b, check(b)); b.open = false; nextTick(() => { b.open = true }); emitAll() }
function onSub(b, values) { b.props = { ...b.props, [def(b).conditional.field]: values }; Object.assign(b, check(b)); emitAll() }
const subOf = (b) => { const d = def(b); return d ? subSchema(d, b.props) : null }

/* adding: at the foot, or at the seam the + was pressed on */
const pickerOpen = ref(false), insertAt = ref(-1)
function askAdd(at = -1) { insertAt.value = at; pickerOpen.value = true }
async function add(key) {
  const d = SECTION_SCHEMAS[key]
  const b = { id: ++seq, component: key, props: clone(d.defaults || {}), open: true, valid: true, errors: {}, rawText: '' }
  Object.assign(b, check(b))
  for (const x of blocks.value) x.open = false
  if (insertAt.value >= 0) blocks.value.splice(insertAt.value, 0, b); else blocks.value.push(b)
  emitAll(); await nextTick(); scrollTo(b); emit('focus', blocks.value.indexOf(b))
}
function duplicate(i) {
  const b = blocks.value[i]
  blocks.value.splice(i + 1, 0, { ...clone({ component: b.component, props: b.props }), id: ++seq, open: false, valid: b.valid, errors: clone(b.errors), rawText: '' })
  emitAll()
}
function remove(i) {
  const b = blocks.value[i]
  if (b.props && Object.keys(b.props).length && !confirm('Remove this section?')) return
  blocks.value.splice(i, 1)
  emitAll()
}
function moveBy(i, d) { const j = i + d; if (j < 0 || j >= blocks.value.length) return; const [b] = blocks.value.splice(i, 1); blocks.value.splice(j, 0, b); emitAll() }
function toggle(b) { b.open = !b.open; if (b.open) { for (const x of blocks.value) if (x !== b) x.open = false; emit('focus', blocks.value.indexOf(b)) } }
const list = ref(null)
function scrollTo(b) { const el = list.value && list.value.$el && list.value.$el.querySelector(`[data-block="${b.id}"]`); if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }
/* the preview's click: open that block */
watch(() => props.pick, (i) => { const b = blocks.value[i]; if (!b) return; for (const x of blocks.value) x.open = x === b; nextTick(() => scrollTo(b)) })
/* an unknown component (a typo in the file): editable as text so the page is not stuck */
function setRaw(b, text) {
  b.rawText = text
  try { b.props = JSON.parse(text || '{}'); b.valid = true } catch (e) { b.valid = false }
  emitAll()
}
</script>

<template>
  <div class="pb" :class="{ compact }">
    <div v-if="!blocks.length" class="pb-empty">
      <span class="pb-empty-art"><LayoutTemplateIcon :size="26" /></span>
      <b>An empty page</b>
      <span>Add the first section — a hero, a line of logos, a few features — and the preview draws it as you write.</span>
      <button type="button" class="pb-add" @click="askAdd(-1)"><PlusIcon :size="15" /> Add a section</button>
    </div>
    <draggable ref="list" v-model="blocks" item-key="id" handle=".pb-grip" class="pb-list" ghost-class="pb-ghost" chosen-class="pb-chosen" :animation="180" :force-fallback="true" :fallback-tolerance="4" @end="emitAll">
      <template #item="{ element: b, index }">
        <div class="pb-item" :data-block="b.id">
          <button type="button" class="pb-seam" :class="{ first: index === 0 }" title="Add a section here" @click="askAdd(index)"><i></i><span><PlusIcon :size="12" /></span><i></i></button>
          <div class="pb-block" :class="{ open: b.open, bad: !b.valid }">
            <div class="pb-head">
              <button type="button" class="pb-grip" tabindex="-1" aria-label="Drag to reorder"><GripVerticalIcon :size="15" /></button>
              <button type="button" class="pb-title" :aria-expanded="b.open" @click="toggle(b)">
                <span class="pb-sketch" v-html="sketchOf(def(b) ? (def(b).sketch || b.component) : 'generic')"></span>
                <span class="pb-words">
                  <b>{{ def(b) ? def(b).label : b.component }}<em v-if="meta(b)">{{ meta(b) }}</em></b>
                  <span class="pb-sum">{{ summary(b) || (def(b) ? def(b).description : 'Unknown section') }}</span>
                </span>
                <span v-if="!b.valid" class="pb-bad" title="Something here needs fixing"><AlertCircleIcon :size="14" /></span>
                <ChevronDownIcon :size="15" class="pb-chev" />
              </button>
              <div class="pb-acts">
                <button type="button" class="pb-ib" title="Move up" :disabled="index === 0" @click="moveBy(index, -1)"><ArrowUpIcon :size="14" /></button>
                <button type="button" class="pb-ib" title="Move down" :disabled="index === blocks.length - 1" @click="moveBy(index, 1)"><ArrowDownIcon :size="14" /></button>
                <button type="button" class="pb-ib" title="Duplicate" @click="duplicate(index)"><CopyIcon :size="14" /></button>
                <button type="button" class="pb-ib danger" title="Remove" @click="remove(index)"><TrashIcon :size="14" /></button>
              </div>
            </div>
            <div v-if="b.open" class="pb-body">
              <p v-if="def(b) && def(b).description" class="pb-desc">{{ def(b).description }}</p>
              <!-- a section's presets: a few ready shapes to start from, laid over what is there -->
              <div v-if="def(b) && def(b).presets && def(b).presets.length" class="pb-presets">
                <span class="pb-presets-lab">Start from</span>
                <button v-for="(pr, pi) in def(b).presets" :key="pi" type="button" class="pb-preset" @click="preset(b, pr)">{{ pr.label }}</button>
              </div>
              <template v-if="def(b) && Object.keys(def(b).schema.shape).length">
                <SectionFields :key="b.id" :shape="def(b).schema" :config="def(b).fieldConfig || {}" :model-value="b.props" :errors="b.errors" @update:model-value="onChange(b, $event)" />
                <div v-if="subOf(b)" class="pb-sub">
                  <p class="pb-subhead"><b>{{ subOf(b).label }}</b><span v-if="subOf(b).description">{{ subOf(b).description }}</span></p>
                  <SectionFields :key="b.id + ':' + b.props.visual.kind" :shape="subOf(b).schema" :config="subOf(b).fieldConfig || {}" :model-value="b.props[def(b).conditional.field] || {}" :errors="b.errors" :base="def(b).conditional.field" @update:model-value="onSub(b, $event)" />
                </div>
              </template>
              <p v-else-if="def(b)" class="pb-none">This section has nothing to set.</p>
              <div v-else class="pb-unknown">
                <p>Unknown section “{{ b.component }}”. Sections available: {{ SECTION_KEYS.join(', ') }}.</p>
                <textarea :value="b.rawText || JSON.stringify(b.props, null, 2)" rows="6" spellcheck="false" @input="setRaw(b, $event.target.value)" />
              </div>
            </div>
          </div>
        </div>
      </template>
    </draggable>

    <div v-if="blocks.length" class="pb-foot">
      <button type="button" class="pb-add" @click="askAdd(-1)"><PlusIcon :size="15" /> Add a section</button>
      <span v-if="!allValid" class="pb-foot-bad"><AlertCircleIcon :size="13" /> A section needs fixing before this page can be saved.</span>
    </div>
    <SectionPicker v-model:open="pickerOpen" @pick="add" />
  </div>
</template>

<style scoped>
.pb :deep(*), .pb :deep(*::before), .pb :deep(*::after) { box-sizing: border-box }
.pb { display: flex; flex-direction: column; min-height: 0; flex: 1; overflow-y: auto; padding: 2px 2px 28px; color: var(--ink); font-size: 14px }
.pb-list { display: flex; flex-direction: column }
.pb-item { display: flex; flex-direction: column }
/* the seam between two blocks: a hairline that grows a + under the pointer */
.pb-seam { position: relative; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 6px; height: 18px; padding: 0 8px; background: none; border: 0; cursor: pointer; opacity: 0; transition: opacity .15s }
.pb-seam.first { height: 14px }
.pb-seam i { height: 1px; background: var(--accent2); opacity: .5 }
.pb-seam span { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; color: var(--paper); background: var(--accent2) }
.pb-seam:hover, .pb-seam:focus-visible { opacity: 1 }
.pb-block { border: 1px solid var(--hair); border-radius: 14px; background: var(--card); overflow: hidden; transition: box-shadow .18s, border-color .18s }
.pb-block:hover { border-color: color-mix(in srgb, var(--ink3) 60%, var(--hair)) }
.pb-block.open { border-color: var(--accent2); box-shadow: 0 22px 44px -32px #000b }
.pb-block.bad { border-color: #e11d4866 }
.pb-ghost { opacity: .3 } .pb-chosen .pb-block { box-shadow: 0 20px 40px -20px #0009 }
.pb-head { display: flex; align-items: center; gap: 2px; padding: 6px 8px 6px 4px }
.pb-grip { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 40px; color: var(--ink3); background: none; border: 0; cursor: grab; border-radius: 8px; flex: none }
.pb-grip:hover { color: var(--ink); background: var(--wash) } .pb-grip:active { cursor: grabbing }
.pb-title { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; font: inherit; color: var(--ink); background: none; border: 0; padding: 4px 8px 4px 2px; cursor: pointer; text-align: left; border-radius: 10px }
.pb-title:hover { background: var(--wash) }
.pb-sketch { flex: none; width: 60px; height: 36px; border-radius: 7px; background: var(--wash); border: 1px solid var(--hair); color: var(--ink2); overflow: hidden }
.pb-sketch :deep(svg) { display: block; width: 100%; height: 100% }
.pb-block.open .pb-sketch { color: var(--accent2) }
.pb-words { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px }
.pb-words b { font-family: var(--fd); font-weight: 600; font-size: 14.5px; white-space: nowrap; display: flex; align-items: baseline; gap: 8px }
.pb-words b em { font: 500 10.5px var(--m); letter-spacing: .04em; color: var(--ink3); font-style: normal; text-transform: uppercase }
.pb-sum { color: var(--ink3); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.pb-bad { color: #e11d48; display: inline-flex; flex: none }
.pb-chev { color: var(--ink3); transition: transform .18s; flex: none } .pb-block.open .pb-chev { transform: rotate(180deg) }
.pb-acts { display: flex; gap: 1px; opacity: 0; transition: opacity .15s } .pb-block:hover .pb-acts, .pb-block.open .pb-acts, .pb-block:focus-within .pb-acts { opacity: 1 }
.pb-ib { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; color: var(--ink3); background: none; border: 0; border-radius: 7px; cursor: pointer }
.pb-ib:hover { color: var(--ink); background: var(--wash) } .pb-ib.danger:hover { color: #e11d48 } .pb-ib:disabled { opacity: .3; cursor: default; background: none }
.pb-body { padding: 4px 18px 20px 18px; border-top: 1px solid var(--hair); background: var(--paper) }
.pb-desc { margin: 12px 0 14px; font-size: 12.5px; color: var(--ink3); line-height: 1.45 }
.pb-presets { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: -4px 0 16px }
.pb-presets-lab { font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); margin-right: 4px }
.pb-preset { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink2); background: var(--wash); border: 1px solid var(--hair); border-radius: 999px; padding: 5px 11px; cursor: pointer }
.pb-preset:hover { color: var(--accent2); border-color: var(--accent2) }
.pb-none { margin: 12px 0 4px; font-size: 13px; color: var(--ink3) }
.pb-sub { margin-top: 16px; padding: 14px 14px 16px; border: 1px solid var(--hair); border-radius: 12px; background: color-mix(in srgb, var(--wash) 45%, transparent) }
.pb-subhead { display: flex; flex-direction: column; gap: 2px; margin: 0 0 12px }
.pb-subhead b { font-family: var(--fd); font-weight: 600; font-size: 14px }
.pb-subhead span { font-size: 12.5px; color: var(--ink3) }
.pb-unknown p { margin: 10px 0 8px; font-size: 13px; color: #b45309 }
.pb-unknown textarea { width: 100%; font-family: var(--m); font-size: 12px; border: 1px solid var(--hair); border-radius: 8px; padding: 8px; background: var(--paper); color: var(--ink) }
.pb-foot { display: flex; align-items: center; gap: 14px; padding-top: 12px }
.pb-add { display: inline-flex; align-items: center; gap: 8px; font: inherit; font-size: 13.5px; font-weight: 600; color: var(--ink); background: var(--paper); border: 1px dashed color-mix(in srgb, var(--ink3) 70%, transparent); border-radius: 999px; padding: 9px 16px 9px 12px; cursor: pointer; transition: border-color .15s, background .15s }
.pb-add:hover { border-style: solid; border-color: var(--accent2); color: var(--accent2); background: color-mix(in srgb, var(--accent2) 7%, transparent) }
.pb-foot-bad { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: #e11d48 }
.pb-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; padding: 44px 24px 36px; border: 1px dashed var(--hair); border-radius: 16px; color: var(--ink3); font-size: 13px; max-width: 46ch; align-self: center; margin: 12px auto 18px }
.pb-empty-art { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 16px; background: var(--wash); color: var(--accent2); margin-bottom: 6px }
.pb-empty b { font-family: var(--fd); font-weight: 600; font-size: 16px; color: var(--ink) }
.pb-empty .pb-add { margin-top: 12px }
</style>

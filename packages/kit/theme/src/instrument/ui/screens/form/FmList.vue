<script setup lang="ts">
import type { PropType } from 'vue'
/* AN ORDERED LIST (the kit's ListInput): rows of one line, as many as the respondent wants, in the order they put
   them. A row's handle drags it (pointer events, so a finger works as well as a mouse) or, focused, moves it with
   the arrow keys. Enter starts a new row below; Backspace in an empty row removes it; Enter in an empty last row goes
   on to the next question. The value is the rows in order; the empty ones are dropped when the answer is kept. */
import { ref, computed, nextTick, onMounted, watch } from 'vue'
import FmLabel from './FmLabel.vue'
const props = defineProps({ field: { type: Object as PropType<any>, required: true }, modelValue: { default: () => [] }, ctx: { type: Object as PropType<any>, default: () => ({}) }, words: { type: Object as PropType<any>, default: () => ({}) }, error: { type: String, default: '' }, autofocus: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue', 'enter'])
const p = props.field.params || {}
const id = 'f_' + props.field.name
const max = Number(p.max) || 0
/* WHAT IT OFFERS TO TAP: the list's own common answers, then the earlier answers it names, less what is already a row */
const asList = (v: any) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map((x: any) => String(x).trim()).filter(Boolean)
const offered = computed(() => {
  const all = [...(p.optionsfrom || []).flatMap((n: string) => asList(props.ctx[n])), ...(p.options || [])]
  const taken = new Set(rows.value.map((r) => r.text.trim().toLowerCase()))
  const seen = new Set<string>()
  return all.filter((o) => { const k = o.toLowerCase(); if (taken.has(k) || seen.has(k)) return false; seen.add(k); return true })
})
function take(o: string) {
  const empty = rows.value.findIndex((r) => !r.text.trim())
  if (empty >= 0) rows.value[empty].text = o
  else if (!full()) rows.value.push({ id: ++seq, text: o })
  else return
  out()
}

let seq = 0
type Row = { id: number; text: string }
const toRows = (v: any): Row[] => (Array.isArray(v) ? v : []).map((t: any) => ({ id: ++seq, text: String(t ?? '') }))
const rows = ref<Row[]>(toRows(props.modelValue))
if (!rows.value.length) rows.value.push({ id: ++seq, text: '' })
/* an answer arriving from the server (a return) replaces what is shown, unless it is what we just sent */
let sent = ''
watch(() => props.modelValue, (v) => { const s = JSON.stringify(v || []); if (s !== sent) { rows.value = toRows(v); if (!rows.value.length) rows.value.push({ id: ++seq, text: '' }) } })
function out() { const v = rows.value.map((r) => r.text); sent = JSON.stringify(v); emit('update:modelValue', v) }

const inputs = ref<Record<number, HTMLInputElement>>({})
const handles = ref<Record<number, HTMLElement>>({})
const focusRow = (i: number, at: 'end' | 'start' = 'end') => nextTick(() => { const r = rows.value[i]; const el = r && inputs.value[r.id]; if (el) { el.focus(); const n = at === 'end' ? el.value.length : 0; el.setSelectionRange(n, n) } })
onMounted(() => { if (props.autofocus) setTimeout(() => focusRow(0), 60) })

const full = () => max > 0 && rows.value.length >= max
function add(after = rows.value.length - 1) { if (full()) return; rows.value.splice(after + 1, 0, { id: ++seq, text: '' }); out(); focusRow(after + 1) }
function remove(i: number) { rows.value.splice(i, 1); if (!rows.value.length) rows.value.push({ id: ++seq, text: '' }); out(); focusRow(Math.max(0, i - 1)) }
function onKey(e: KeyboardEvent, i: number) {
  const r = rows.value[i]
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if ((e.metaKey || e.ctrlKey) || (!r.text.trim() && i === rows.value.length - 1)) { emit('enter'); return }
    if (full()) { emit('enter'); return }
    add(i)
  } else if (e.key === 'Backspace' && !r.text && rows.value.length > 1) { e.preventDefault(); remove(i) }
  else if (e.key === 'ArrowUp' && i > 0 && !e.altKey) { e.preventDefault(); focusRow(i - 1) }
  else if (e.key === 'ArrowDown' && i < rows.value.length - 1 && !e.altKey) { e.preventDefault(); focusRow(i + 1) }
  else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(i, e.key === 'ArrowUp' ? -1 : 1, 'input') }
}

/* MOVING A ROW: the keyboard moves it one place; a drag moves it to wherever the pointer is */
const said = ref('')
function move(i: number, by: number, keep: 'input' | 'handle') {
  const j = i + by
  if (j < 0 || j >= rows.value.length) return
  const [r] = rows.value.splice(i, 1); rows.value.splice(j, 0, r); out()
  said.value = (props.words['list-moved'] || 'Moved to position {n} of {total}.').replace('{n}', String(j + 1)).replace('{total}', String(rows.value.length))
  nextTick(() => { const el = keep === 'handle' ? handles.value[r.id] : inputs.value[r.id]; if (el) el.focus() })
}
function onHandleKey(e: KeyboardEvent, i: number) {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); move(i, e.key === 'ArrowUp' ? -1 : 1, 'handle') }
}
const dragging = ref<number | null>(null)
const list = ref<HTMLElement | null>(null)
function onDown(e: PointerEvent, i: number) {
  if (e.button !== 0) return
  e.preventDefault()
  const r = rows.value[i]; dragging.value = r.id
  const handle = e.currentTarget as HTMLElement
  handle.setPointerCapture(e.pointerId)
  const onMove = (ev: PointerEvent) => {
    const items = list.value ? [...list.value.querySelectorAll<HTMLElement>('.ff-li')] : []
    const from = rows.value.findIndex((x) => x.id === r.id)
    let to = items.findIndex((el) => { const b = el.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2 })
    if (to < 0) to = items.length - 1
    else if (to > from) to -= 1
    if (to !== from) { rows.value.splice(from, 1); rows.value.splice(to, 0, r) }
  }
  const onUp = () => { handle.removeEventListener('pointermove', onMove); handle.removeEventListener('pointerup', onUp); handle.removeEventListener('pointercancel', onUp); dragging.value = null; out() }
  handle.addEventListener('pointermove', onMove); handle.addEventListener('pointerup', onUp); handle.addEventListener('pointercancel', onUp)
}
</script>

<template>
  <div class="ff ff-list" :class="{ 'ff-err': error }">
    <FmLabel :field="field" :ctx="ctx" :words="words" :id="id + '_0'" />
    <ol ref="list" class="ff-ol" :aria-label="words['list-label'] || null">
      <li v-for="(r, i) in rows" :key="r.id" class="ff-li" :class="{ 'is-dragging': dragging === r.id }">
        <button :ref="(el) => { if (el) handles[r.id] = el as HTMLElement }" type="button" class="ff-grip" :aria-label="(words['list-move'] || 'Move item {n}').replace('{n}', String(i + 1))" :title="words['list-move-hint'] || 'Drag, or use the arrow keys'" @pointerdown="(e) => onDown(e, i)" @keydown="(e) => onHandleKey(e, i)">
          <svg viewBox="0 0 12 16" aria-hidden="true"><circle cx="4" cy="3" r="1.3" /><circle cx="8" cy="3" r="1.3" /><circle cx="4" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="4" cy="13" r="1.3" /><circle cx="8" cy="13" r="1.3" /></svg>
        </button>
        <span class="ff-num" aria-hidden="true">{{ i + 1 }}.</span>
        <input :ref="(el) => { if (el) inputs[r.id] = el as HTMLInputElement }" :id="id + '_' + i" v-model="r.text" type="text" class="qwordin ff-in ff-li-in" :placeholder="i === 0 ? (p.placeholder || words['list-placeholder'] || '') : ''" :maxlength="p.maxlength || null" :disabled="p.disabled !== undefined" :aria-label="(words['list-item'] || 'Item {n}').replace('{n}', String(i + 1))" @input="out" @keydown="(e) => onKey(e, i)" />
        <button v-if="rows.length > 1" type="button" class="ff-li-x" :aria-label="(words['list-remove'] || 'Remove item {n}').replace('{n}', String(i + 1))" @click="remove(i)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </li>
    </ol>
    <div v-if="offered.length && !full()" class="ff-li-offer" role="group" :aria-label="words['list-offer'] || 'Common answers'">
      <button v-for="o in offered" :key="o" type="button" class="ff-li-chip" @click="take(o)">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>{{ o }}
      </button>
    </div>
    <button v-if="!full()" type="button" class="ff-li-add" @click="add()">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>{{ offered.length ? (words['list-add-own'] || 'Add your own') : (words['list-add'] || 'Add another') }}
    </button>
    <p v-if="!error" class="ff-hint"><kbd>Enter</kbd> {{ words['list-enter'] || 'for a new line' }}<template v-if="max"> · {{ (words['list-up-to'] || 'up to {n}').replace('{n}', String(max)) }}</template></p>
    <p v-if="error" class="ff-msg" role="alert">{{ error }}</p>
    <p class="fq-vh" aria-live="polite">{{ said }}</p>
  </div>
</template>

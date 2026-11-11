<script setup lang="ts">
import type { PropType } from 'vue'
/*
 * AN ORDERED LIST (the kit's ListInput), as a ranking: what the respondent has chosen sits on top, numbered, each
 * card with a handle to drag it (pointer events, so a finger works as well as a mouse; focused, the arrow keys move it)
 * and a way to take it out. Under it, what they can choose from: the list's common answers and the earlier answers it
 * names, as option cards the way a choice question shows them, and "Something else" to type their own. `min` and
 * `max` bound how many; at the most, the options rest until one is taken out. A list with nothing to offer is the
 * typing line alone. The value is the chosen rows in order.
 */
import { ref, computed, nextTick, onMounted, watch } from 'vue'
import FmLabel from './FmLabel.vue'
const props = defineProps({ field: { type: Object as PropType<any>, required: true }, modelValue: { default: () => [] }, ctx: { type: Object as PropType<any>, default: () => ({}) }, words: { type: Object as PropType<any>, default: () => ({}) }, error: { type: String, default: '' }, autofocus: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue', 'enter'])
const p = props.field.params || {}
const id = 'f_' + props.field.name
const max = Number(p.max) || 0
const min = Number(p.min) || 0
const w = (k: string, fallback: string, vars: Record<string, string | number> = {}) => Object.entries(vars).reduce((s, [a, b]) => s.replace('{' + a + '}', String(b)), props.words[k] || fallback)

let seq = 0
type Row = { id: number; text: string }
const clean = (v: any) => (Array.isArray(v) ? v : []).map((t: any) => String(t ?? '').trim()).filter(Boolean)
const rows = ref<Row[]>(clean(props.modelValue).map((text) => ({ id: ++seq, text })))
/* an answer arriving from the server (a return) replaces what is shown, unless it is what we just sent */
let sent = ''
watch(() => props.modelValue, (v) => { const s = JSON.stringify(clean(v)); if (s !== sent) rows.value = clean(v).map((text) => ({ id: ++seq, text })) })
function out() { const v = rows.value.map((r) => r.text); sent = JSON.stringify(v); emit('update:modelValue', v) }
const full = computed(() => max > 0 && rows.value.length >= max)
const has = (t: string) => rows.value.some((r) => r.text.toLowerCase() === t.toLowerCase())

/* WHAT THERE IS TO CHOOSE: the earlier answers it names first, then its own common answers, each once */
const asList = (v: any) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map((x: any) => String(x).trim()).filter(Boolean)
const options = computed(() => {
  const seen = new Set<string>()
  return [...(p.optionsfrom || []).flatMap((n: string) => asList(props.ctx[n])), ...(p.options || [])].filter((o) => { const k = o.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
})
const left = computed(() => options.value.filter((o) => !has(o)))
const hasOptions = computed(() => options.value.length > 0)

function choose(t: string) {
  const text = t.replace(/\s+/g, ' ').trim()
  if (!text || full.value || has(text)) return false
  rows.value.push({ id: ++seq, text }); out()
  said.value = w('list-added', '{item} added, number {n}.', { item: text, n: rows.value.length })
  return true
}
function remove(i: number) {
  const [r] = rows.value.splice(i, 1); out()
  said.value = w('list-removed', '{item} removed.', { item: r.text })
  nextTick(() => { const next = rows.value[Math.min(i, rows.value.length - 1)]; const el = next ? handles.value[next.id] : null; if (el) el.focus() })
}

/* SOMETHING ELSE: typed, and added on Enter. Where there is nothing to offer, it is the whole question. */
const typing = ref(false), draft = ref('')
const input = ref<HTMLInputElement | null>(null)
const showInput = computed(() => !full.value && (typing.value || !hasOptions.value))
function openTyping() { typing.value = true; nextTick(() => input.value && input.value.focus()) }
function onType(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (draft.value.trim()) { if (choose(draft.value)) draft.value = '' }
    else emit('enter')
  } else if (e.key === 'Escape' && hasOptions.value) { typing.value = false; draft.value = '' }
}
onMounted(() => { if (props.autofocus && !hasOptions.value) setTimeout(() => input.value && input.value.focus(), 60) })

/* MOVING ONE: the arrow keys on its handle move it a place; a drag moves it to wherever the pointer is */
const said = ref('')
const handles = ref<Record<number, HTMLElement>>({})
function move(i: number, by: number) {
  const j = i + by
  if (j < 0 || j >= rows.value.length) return
  const [r] = rows.value.splice(i, 1); rows.value.splice(j, 0, r); out()
  said.value = w('list-moved', 'Moved to position {n} of {total}.', { n: j + 1, total: rows.value.length })
  nextTick(() => { const el = handles.value[r.id]; if (el) el.focus() })
}
function onHandleKey(e: KeyboardEvent, i: number) {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); move(i, e.key === 'ArrowUp' ? -1 : 1) }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(i) }
}
/*
 * DRAGGING ONE, the way a sortable list moves: the card follows the pointer, lifted; the cards it passes slide aside to
 * open the place it would land; let go, and it settles into that place before the order is kept. A mouse can take the
 * card anywhere but its remove button; a finger takes it by the handle, so a swipe over the cards still scrolls.
 */
const dragging = ref<number | null>(null)
const settling = ref(false)
/* the moment the order is kept, nothing animates: the cards are already where they belong */
const instant = ref(false)
const offsets = ref<Record<number, number>>({})
/* where the held card would land, so every card shows the number it will have */
const span = ref<[number, number] | null>(null)
const rankOf = (i: number) => { if (!span.value) return i + 1; const [f, t] = span.value; if (i === f) return t + 1; if (f < t && i > f && i <= t) return i; if (f > t && i >= t && i < f) return i + 2; return i + 1 }
const list = ref<HTMLElement | null>(null)
const GAP = 8
function onDown(e: PointerEvent, i: number) {
  if (e.button !== 0 || p.disabled !== undefined || settling.value) return
  const target = e.target as HTMLElement
  if (target.closest('.ff-rank-x')) return
  if (e.pointerType !== 'mouse' && !target.closest('.ff-rank-grip')) return
  e.preventDefault()
  const cards = list.value ? [...list.value.querySelectorAll<HTMLElement>('.ff-rank')] : []
  const boxes = cards.map((c) => c.getBoundingClientRect())
  const from = i, r = rows.value[i], h = boxes[i].height + GAP
  const startY = e.clientY, top = boxes[0].top - boxes[i].top, bottom = boxes[boxes.length - 1].top - boxes[i].top
  let to = from
  dragging.value = r.id
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const onMove = (ev: PointerEvent) => {
    const dy = Math.max(top - h / 2, Math.min(bottom + h / 2, ev.clientY - startY))
    /* where it would land: past the middle of the card next to it */
    const centre = boxes[from].top + boxes[from].height / 2 + dy
    to = from
    for (let j = 0; j < boxes.length; j++) {
      const mid = boxes[j].top + boxes[j].height / 2
      if (j < from && centre < mid) { to = j; break }
      if (j > from && centre > mid) to = j
    }
    const next: Record<number, number> = { [r.id]: dy }
    rows.value.forEach((x, j) => { if (j === from) return; next[x.id] = from < to && j > from && j <= to ? -h : from > to && j >= to && j < from ? h : 0 })
    offsets.value = next
    span.value = [from, to]
  }
  const onUp = () => {
    el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp)
    /* settle into the place it lands, then keep the order with nothing moved */
    settling.value = true
    offsets.value = { ...offsets.value, [r.id]: (to - from) * h }
    setTimeout(() => {
      instant.value = true
      dragging.value = null
      if (to !== from) { rows.value.splice(from, 1); rows.value.splice(to, 0, r); out(); said.value = w('list-moved', 'Moved to position {n} of {total}.', { n: to + 1, total: rows.value.length }) }
      offsets.value = {}
      span.value = null
      nextTick(() => requestAnimationFrame(() => { instant.value = false; settling.value = false }))
    }, 160)
  }
  el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp)
}

/* the line under the question: how many, and what the order is for */
const guide = computed(() => {
  if (full.value) return w('list-full', "You've chosen {max}. Take one out to choose another.", { max })
  if (rows.value.length > 1) return w('list-reorder', 'Drag to change the order.')
  if (max && min) return w('list-range', 'Choose {min} to {max}.', { min, max })
  if (max) return w('list-up-to-n', 'Choose up to {max}.', { max })
  return ''
})
</script>

<template>
  <div class="ff ff-list" :class="{ 'ff-err': error }">
    <FmLabel :field="field" :ctx="ctx" :words="words" :id="id" tag="div" />
    <p v-if="guide" class="ff-list-guide">{{ guide }}<span v-if="max" class="ff-list-count">{{ rows.length }} / {{ max }}</span></p>

    <!-- what has been chosen, in order -->
    <ol v-if="rows.length" ref="list" class="ff-ranks" :aria-label="w('list-chosen', 'Your order')">
      <li v-for="(r, i) in rows" :key="r.id" class="ff-rank" :class="{ 'is-dragging': dragging === r.id, 'is-sorting': dragging !== null && !settling, 'is-settling': settling, 'is-instant': instant }"
        :style="offsets[r.id] ? { transform: 'translateY(' + offsets[r.id] + 'px)' } : undefined" @pointerdown="(e) => onDown(e, i)">
        <span class="ff-rank-n" aria-hidden="true">{{ rankOf(i) }}</span>
        <span class="ff-rank-text">{{ r.text }}</span>
        <button :ref="(el) => { if (el) handles[r.id] = el as HTMLElement }" type="button" class="ff-rank-grip"
          :aria-label="w('list-move', 'Move {item}, number {n}', { item: r.text, n: i + 1 })" :title="w('list-move-hint', 'Drag, or use the arrow keys')"
          @keydown="(e) => onHandleKey(e, i)">
          <svg viewBox="0 0 12 16" aria-hidden="true"><circle cx="4" cy="3" r="1.3" /><circle cx="8" cy="3" r="1.3" /><circle cx="4" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="4" cy="13" r="1.3" /><circle cx="8" cy="13" r="1.3" /></svg>
        </button>
        <button type="button" class="ff-rank-x" :aria-label="w('list-remove', 'Remove {item}', { item: r.text })" @click="remove(i)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
        </button>
      </li>
    </ol>

    <!-- what there is to choose from, and something else -->
    <div v-if="hasOptions && !full" class="ff-pool" role="group" :aria-label="w('list-offer', 'Choose from')">
      <button v-for="o in left" :key="o" type="button" class="qopt ff-pool-opt" :disabled="p.disabled !== undefined" @click="choose(o)">
        <span class="k" aria-hidden="true">+</span><span class="qoptl">{{ o }}</span>
      </button>
      <button v-if="!full && !typing" type="button" class="qopt ff-pool-opt ff-pool-other" @click="openTyping">
        <span class="k" aria-hidden="true">+</span><span class="qoptl">{{ w('list-other', 'Something else') }}</span>
      </button>
    </div>
    <div v-if="showInput" class="ff-list-type">
      <label class="fq-vh" :for="id">{{ w('list-type', 'Type an answer') }}</label>
      <input :id="id" ref="input" v-model="draft" type="text" class="qwordin ff-in" :placeholder="hasOptions ? w('list-other-placeholder', 'Type it, then press Enter') : (p.placeholder || w('list-placeholder', 'Type an answer, then press Enter'))" :maxlength="p.maxlength || null" :disabled="p.disabled !== undefined" @keydown="onType" />
      <button type="button" class="qbtn ff-list-add" :disabled="!draft.trim()" :aria-label="w('list-add-typed', 'Add')" @click="choose(draft) && (draft = '')"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg><span>{{ w('list-add-typed', 'Add') }}</span></button>
    </div>

    <p v-if="error" class="ff-msg" role="alert">{{ error }}</p>
    <p class="fq-vh" aria-live="polite">{{ said }}</p>
  </div>
</template>

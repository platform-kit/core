<script setup lang="ts">
import type { PropType } from 'vue'
/*
 * A LADDER (the kit's LadderInput): one question asked again of each answer, a step at a time, the way a coach asks
 * "and what's under that?" until there is nothing under it. Above the question sits the answer it is asked of: the
 * field `from` names (another field of the form, or one of its references) for the first step, then the step before.
 * Enter, or "Go deeper", keeps the answer and asks again of it; the slide's own button, which takes the field's `stop`
 * words, ends the ladder. `max` bounds the steps. The value is the steps in order, what is being typed counted as the
 * last of them, so ending with an answer in the box keeps it. The field's `placeholder` is the first step's example only.
 */
import { ref, computed, nextTick, onMounted, watch } from 'vue'
import FmLabel from './FmLabel.vue'
const props = defineProps({ field: { type: Object as PropType<any>, required: true }, modelValue: { default: () => [] }, ctx: { type: Object as PropType<any>, default: () => ({}) }, words: { type: Object as PropType<any>, default: () => ({}) }, error: { type: String, default: '' }, autofocus: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue', 'enter'])
const p = props.field.params || {}
const id = 'f_' + props.field.name
const max = Number(p.max) || 6
const w = (k: string, fallback: string) => props.words[k] || fallback

const clean = (v: any) => (Array.isArray(v) ? v : []).map((t: any) => String(t ?? '').trim()).filter(Boolean)
const steps = ref<string[]>(clean(props.modelValue))
const draft = ref('')
const input = ref<HTMLTextAreaElement | null>(null)
/* an answer arriving from the server (a return) replaces what is shown, unless it is what we just sent */
let sent = ''
watch(() => props.modelValue, (v) => { const s = JSON.stringify(clean(v)); if (s !== sent) { steps.value = clean(v); draft.value = '' } })
function out() { const v = [...steps.value, ...(draft.value.trim() ? [draft.value.trim()] : [])]; sent = JSON.stringify(v); emit('update:modelValue', v) }

/* what this step is asked of: the step before, or for the first, the answer the field starts from */
const start = computed(() => { const v = p.from ? props.ctx[p.from] : ''; return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '') })
const above = computed(() => (steps.value.length ? steps.value[steps.value.length - 1] : start.value).trim())
const full = computed(() => steps.value.length >= max)
/* the first step asks the field's question; every step after it asks `then`, when the field gives one */
const asked = computed(() => (steps.value.length && p.then ? { ...props.field, params: { ...p, question: p.then } } : props.field))

async function deeper() {
  const t = draft.value.trim()
  if (!t || full.value) return
  steps.value = [...steps.value, t]; draft.value = ''; out()
  await nextTick(); if (input.value) input.value.focus()
}
function back() { if (!steps.value.length) return; draft.value = steps.value[steps.value.length - 1]; steps.value = steps.value.slice(0, -1); out(); nextTick(() => input.value && input.value.focus()) }
function onKey(e: KeyboardEvent) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); deeper() } }
onMounted(() => { if (props.autofocus && input.value) input.value.focus() })
</script>

<template>
  <div class="ff ff-ladder" :class="{ 'ff-err': error }">
    <blockquote v-if="above" class="ff-ladder-above">{{ above }}</blockquote>
    <FmLabel :field="asked" :ctx="ctx" :words="words" :id="id" />
    <p class="ff-ladder-step">{{ w('ladder-step', 'Step {n}').replace('{n}', String(steps.length + 1)) }}</p>
    <template v-if="!full">
      <textarea :id="id" ref="input" v-model="draft" class="qwordin ff-in ff-ladder-in" rows="2" :placeholder="(!steps.length && p.placeholder) || w('ladder-placeholder', 'Type your answer')" :maxlength="p.maxlength || null" :disabled="p.disabled !== undefined" @input="out" @keydown="onKey" />
      <div class="ff-ladder-acts">
        <button type="button" class="qbtn ff-ladder-deeper" :disabled="!draft.trim()" @click="deeper">{{ w('ladder-deeper', 'Go deeper') }}</button>
        <button v-if="steps.length" type="button" class="ff-ladder-back" @click="back">{{ w('ladder-back', 'Back a step') }}</button>
      </div>
    </template>
    <p v-else class="ff-ladder-full">{{ w('ladder-full', 'That is as many steps as this question takes.') }}</p>
    <p v-if="error" class="ff-msg" role="alert">{{ error }}</p>
  </div>
</template>

<script setup>
/* a slide's blocks in order — copy, fields, divs (their blocks inside, their classes on) — each shown
   while its display condition holds over the answers as they are typed */
import { computed } from 'vue'
import { holds } from 'platformkit/lib/forms/logic.js'
import FmCopy from './FmCopy.vue'
import FmText from './FmText.vue'
import FmSelect from './FmSelect.vue'
import FmChoice from './FmChoice.vue'
import FmRating from './FmRating.vue'
import FmScale from './FmScale.vue'
import FmFile from './FmFile.vue'
import FmRecord from './FmRecord.vue'
const props = defineProps({ blocks: { type: Array, default: () => [] }, ctx: { type: Object, default: () => ({}) }, values: { type: Object, required: true }, errors: { type: Object, default: () => ({}) }, words: { type: Object, default: () => ({}) }, autofocusAll: { type: Boolean, default: false } })
const emit = defineEmits(['enter'])
const KIND = { text: FmText, email: FmText, url: FmText, tel: FmText, password: FmText, number: FmText, date: FmText, time: FmText, datetime: FmText, select: FmSelect, choice: FmChoice, picture: FmChoice, rating: FmRating, scale: FmScale, file: FmFile, voice: FmRecord, video: FmRecord }
const shown = computed(() => props.blocks.filter((b) => holds(b.condition, props.ctx)))
const classes = (b) => ['fdiv', ...(b.attrs && b.attrs.classes ? b.attrs.classes.map((c) => 'fmd-' + c) : [])]
/* the first field of the slide takes focus when the document asks for it on every slide, or the field does */
let focusGiven = false
const focus = (b) => { if (b.params && b.params.autofocus !== undefined) return true; if (props.autofocusAll && !focusGiven) { focusGiven = true; return true } return false }
</script>

<template>
  <template v-for="(b, i) in shown" :key="b.line + ':' + i">
    <FmCopy v-if="b.type === 'markdown'" :md="b.md" :ctx="ctx" />
    <component :is="KIND[b.kind] || FmText" v-else-if="b.type === 'field'" :field="b" :model-value="values[b.name]" :ctx="ctx" :words="words" :error="errors[b.name] || ''" :autofocus="focus(b)" @update:model-value="(v) => (values[b.name] = v)" @enter="(how) => emit('enter', how)" />
    <div v-else-if="b.type === 'div'" :class="classes(b)" :id="b.attrs && b.attrs.id || null">
      <FmBlocks :blocks="b.blocks" :ctx="ctx" :values="values" :errors="errors" :words="words" @enter="(how) => emit('enter', how)" />
    </div>
  </template>
</template>

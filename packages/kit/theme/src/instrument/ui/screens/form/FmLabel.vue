<script setup>
/* A field's question and its description — the same head for every kind. The question is forms.md's
   `question` param (its inline markdown rendered through the same renderer as the copy, so a binding
   in a question works); a required field wears the mark. */
import { computed } from 'vue'
import { renderMarkdown } from 'platformkit/lib/forms/markdown.js'
const props = defineProps({ field: { type: Object, required: true }, ctx: { type: Object, default: () => ({}) }, words: { type: Object, default: () => ({}) }, id: { type: String, default: '' }, tag: { type: String, default: 'label' } })
const strip = (html) => String(html).replace(/^<p>([\s\S]*)<\/p>\s*$/, '$1')
const question = computed(() => strip(renderMarkdown(props.field.params.question || '', props.ctx)))
const description = computed(() => props.field.params.description ? strip(renderMarkdown(props.field.params.description, props.ctx)) : '')
const small = computed(() => props.field.params.labelstyle === 'classic' || props.field.params.subfield !== undefined || props.field.params.fieldsize === 'sm')
</script>

<template>
  <component :is="tag" :for="tag === 'label' ? id : null" class="fq" :class="{ 'fq-sm': small }">
    <span v-html="question" /><sup v-if="field.required" class="fq-req" aria-hidden="true">*</sup><span v-if="field.required" class="fq-vh">({{ words['required-mark'] || 'required' }})</span>
  </component>
  <p v-if="description" class="fq-desc" v-html="description" />
</template>

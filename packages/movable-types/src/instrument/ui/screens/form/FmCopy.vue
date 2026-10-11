<script setup>
/* a block of a form's free copy: markdown with its bindings, rendered over the answers so far and
   sanitised before it lands (a document is content, but a binding carries what a reader typed) */
import { computed } from 'vue'
import DOMPurify from 'dompurify'
import { renderMarkdown } from '@platform-kit/kit/lib/forms/markdown.js'
const props = defineProps({ md: { type: String, default: '' }, ctx: { type: Object, default: () => ({}) } })
const html = computed(() => DOMPurify.sanitize(renderMarkdown(props.md, props.ctx), { ADD_ATTR: ['target'] }))
</script>

<template>
  <div class="fcopy" v-html="html" />
</template>

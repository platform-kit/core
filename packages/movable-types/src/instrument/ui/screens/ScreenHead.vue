<script setup>
/* The eyebrow, the sentence and its aside. The headline is the statement itself:
   escaped, then its own small markdown (bold, italic, underline — inline.js);
   the eyebrow and the aside carry markup on purpose. */
import { inline } from '../inline.js'
defineProps({
  eyebrow: { type: String, default: '' },
  headline: { type: String, default: '' },
  sub: { type: String, default: '' },
  headlineStyle: { type: String, default: '' },
})
</script>

<template>
  <span v-if="eyebrow" class="eyeb" v-html="eyebrow" />
  <h3 class="qh" :style="headlineStyle" v-html="inline(headline)" />
  <div v-if="sub" class="qsay" v-html="sub" />
</template>

<script setup>
/* The only v-html on the sheet.
   Charts and score bars come out of charts.js as SVG and markup; re-expressing
   them as component trees would buy nothing and lose the drawing code. Every
   other part of the sheet is a real component. */
defineProps({ html: { type: String, default: '' } })
</script>

<template>
  <div v-if="html" v-html="html" />
</template>

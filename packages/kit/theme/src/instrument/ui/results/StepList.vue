<script setup>
/* A definition list against rules: the label on the left, what it means on the
   right. Each row is written by the page that uses it. */
defineProps({ heading: { type: String, default: '' } })
</script>

<template>
  <div class="detail-list">
    <div v-if="heading" class="section-label">{{ heading }}</div>
    <slot />
  </div>
</template>

<style scoped>
.detail-list { background: none; border: 0; border-radius: 0; padding: 0; margin: 0 0 var(--s4) }
.section-label {
  display: block; font-family: var(--m, ui-monospace, Menlo, monospace); font-size: 10px;
  font-weight: 500; letter-spacing: .17em; text-transform: uppercase;
  color: var(--qink3); margin: 0 0 var(--s2);
}
/* the rows are StepRow's own elements, so they are reached through the child */
.detail-list :deep(.detail-row:last-child) { border-bottom: 1px solid var(--qhair) }
</style>

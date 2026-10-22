<script setup>
defineProps({ heading: { type: String, required: true } })
</script>

<template>
  <div class="warning">
    <div class="section-label">{{ heading }}</div>
    <p class="warning-text"><slot /></p>
  </div>
</template>

<style scoped>
/* a note set off by a rule, not a box */
.warning {
  background: none; border: 0; border-left: 2px solid var(--qink); border-radius: 0;
  padding: 2px 0 2px 20px; margin: 0 0 var(--s4);
}
.section-label {
  display: block; font-family: var(--m, ui-monospace, Menlo, monospace); font-size: 10px;
  font-weight: 500; letter-spacing: .17em; text-transform: uppercase;
  color: var(--qink3); margin: 0 0 var(--s2);
}
.warning-text { font-size: 16px; font-weight: 400; line-height: 1.65; color: var(--qink2); margin: 0 }
</style>

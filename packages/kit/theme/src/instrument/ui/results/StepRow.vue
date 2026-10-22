<script setup>
defineProps({ label: { type: String, required: true } })
</script>

<template>
  <div class="detail-row"><i>{{ label }}</i><span><slot /></span></div>
</template>

<style scoped>
.detail-row {
  display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 0 24px;
  align-items: baseline; padding: var(--s3) 0; border-top: 1px solid var(--qhair); margin: 0;
}
.detail-row i {
  font-family: var(--m, ui-monospace, Menlo, monospace); font-style: normal; font-size: 10px;
  font-weight: 500; letter-spacing: .14em; text-transform: uppercase; color: var(--qink3);
}
.detail-row span { font-size: 15.5px; font-weight: 400; line-height: 1.65; color: var(--qink2); max-width: 44ch }
@media (max-width: 640px) {
  .detail-row { grid-template-columns: 1fr; gap: var(--s1) }
}
</style>

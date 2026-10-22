<script setup>
/* One labelled bar. Was built as an HTML string by bar() in results.js. */
defineProps({
  label: { type: String, required: true },
  value: { type: Number, required: true },
  colour: { type: String, default: null },
  note: { type: [String, Number], default: null },
})
</script>

<template>
  <div class="score-row">
    <span class="score-label">{{ label }}</span>
    <span class="score-track">
      <i :style="{ width: Math.max(0, Math.min(100, value)) + '%',
                   background: colour || undefined }" />
    </span>
    <span class="score-value">{{ note !== null ? note : value }}</span>
  </div>
</template>

<style scoped>
.score-row {
  display: grid; grid-template-columns: minmax(0, 1fr) 120px 46px; gap: 0 12px;
  align-items: center; padding: 7px 0;
}
.score-label { font-size: 14px; color: var(--qink2); line-height: 1.3 }
.score-track { height: 4px; border-radius: 2px; background: #0C0D0B14; overflow: hidden }
.score-track i { display: block; height: 100%; border-radius: 2px; background: var(--qink) }
.score-value {
  font-family: var(--m, ui-monospace, Menlo, monospace); font-size: 11px;
  color: var(--qink3); text-align: right;
}
</style>

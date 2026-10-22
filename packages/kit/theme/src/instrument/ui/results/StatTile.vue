<script setup>
/* A figure with the range it could sit in. Was tileHTML() in results.js. */
const props = defineProps({
  label: { type: String, required: true },
  value: { type: [Number, String], required: true },
  low: { type: Number, default: null },
  high: { type: Number, default: null },
  note: { type: String, default: '' },
})
const hasRange = () => typeof props.low === 'number' && typeof props.high === 'number' && props.high > props.low
const clamp = (n) => Math.max(0, Math.min(100, n))
</script>

<template>
  <div class="stat-tile">
    <div class="stat-label">{{ label }}</div>
    <div class="stat-value">{{ value }}</div>
    <div v-if="hasRange()" class="stat-range">
      <i :style="{ left: clamp(low) + '%', width: Math.max(2, clamp(high) - clamp(low)) + '%' }" />
      <b :style="{ left: 'calc(' + clamp(Number(value)) + '% - 1px)' }" />
    </div>
    <div v-else class="stat-range is-empty" />
    <div v-if="note" class="stat-note">{{ note }}</div>
  </div>
</template>

<style scoped>
.stat-tile { flex: 1 1 130px; min-width: 120px }
.stat-label {
  font-family: var(--m, ui-monospace, Menlo, monospace); font-size: 9.5px; font-weight: 500;
  letter-spacing: .14em; text-transform: uppercase; color: var(--qink3); margin-bottom: 5px;
}
.stat-value { font-size: 24px; font-weight: 700; letter-spacing: -.02em; line-height: 1; color: var(--qink) }
.stat-range { position: relative; height: 4px; border-radius: 2px; background: #0C0D0B12; margin: 9px 0 6px }
.stat-range.is-empty { background: #0C0D0B0A }
.stat-range i { position: absolute; top: 0; height: 100%; border-radius: 2px; background: #0C0D0B2E }
.stat-range b { position: absolute; top: -2px; width: 2px; height: 8px; border-radius: 1px; background: var(--qink) }
.stat-note { font-size: 12px; line-height: 1.4; color: var(--qink3) }
</style>

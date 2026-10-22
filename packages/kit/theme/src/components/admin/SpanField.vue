<script setup>
/*
 * A span of time as a number and a unit — never as the "3d" the file holds. Reads and writes
 * the grammar the build understands (rules.js days(): a number, then h | d | w), so an editor
 * picks 3 and "days" and the file gets 3d.
 */
import { computed } from 'vue'

const props = defineProps({ modelValue: { type: [String, Number], default: '' }, units: { type: Array, default: () => ['h', 'd', 'w'] } })
const emit = defineEmits(['update:modelValue'])
const NAMES = { h: 'hours', d: 'days', w: 'weeks' }
const parsed = computed(() => { const m = /^\s*(\d+(?:\.\d+)?)\s*([hdw])?\s*$/i.exec(String(props.modelValue ?? '')); return m ? { n: Number(m[1]), u: (m[2] || 'd').toLowerCase() } : { n: 0, u: 'd' } })
function set(n, u) { const v = Math.max(0, Number(n) || 0); emit('update:modelValue', (Number.isInteger(v) ? v : v) + u) }
</script>

<template>
  <span class="sf">
    <input type="number" min="0" step="1" class="ui-input ui-mono sf-num" :value="parsed.n" @input="set($event.target.value, parsed.u)" />
    <select class="ui-select sf-unit" :value="parsed.u" @change="set(parsed.n, $event.target.value)"><option v-for="u in units" :key="u" :value="u">{{ NAMES[u] }}</option></select>
  </span>
</template>

<style scoped>
.sf { display: inline-flex; gap: 6px; align-items: center }
.sf-num { width: 84px }
.sf-unit { width: 100px }
</style>

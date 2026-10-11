<script setup>
/* a thin bar at the top of the page that fills as it is read (the page's `progress` field) */
import { ref, onMounted, onBeforeUnmount } from 'vue'
const at = ref(0)
function tick() { const d = document.documentElement; const h = d.scrollHeight - d.clientHeight; at.value = h > 0 ? Math.min(1, Math.max(0, d.scrollTop / h)) : 0 }
onMounted(() => { tick(); window.addEventListener('scroll', tick, { passive: true }); window.addEventListener('resize', tick) })
onBeforeUnmount(() => { window.removeEventListener('scroll', tick); window.removeEventListener('resize', tick) })
</script>
<template><div class="lpprogress" aria-hidden="true"><i :style="{ transform: 'scaleX(' + at + ')' }"></i></div></template>
<style scoped>
.lpprogress { position: fixed; left: 0; right: 0; top: 0; height: 3px; z-index: 60; pointer-events: none }
.lpprogress i { display: block; height: 100%; background: var(--accent); transform-origin: 0 50%; transition: transform .1s linear }
</style>

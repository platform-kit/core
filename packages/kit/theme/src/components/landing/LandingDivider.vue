<script setup>
/* a divider between sections: a hairline, three dots, the ornament (a rule with a diamond), plain space, or an edge — a wave, a curve, an angle — drawn in the next section's tone so a band meets the paper with a shape */
defineProps({ kind: { type: String, default: 'line' }, size: { type: String, default: 'normal' } })   /* line | dots | ornament | space | wave | curve | angle; small | normal | large */
</script>
<template>
  <section class="lpsec lpdivider" :class="['lpdv-' + kind, 'lpdv-' + size]" aria-hidden="true">
    <div v-if="kind === 'line'" class="lpwrap"><hr class="lpdv-line" /></div>
    <div v-else-if="kind === 'dots'" class="lpwrap lpdv-dots"><i></i><i></i><i></i></div>
    <div v-else-if="kind === 'ornament'" class="lpwrap lpdv-orn"><i></i><b></b><i></i></div>
    <svg v-else-if="kind === 'wave'" class="lpdv-svg" viewBox="0 0 1440 80" preserveAspectRatio="none"><path d="M0 40c240 40 480 40 720 0s480-40 720 0v40H0z" /></svg>
    <svg v-else-if="kind === 'curve'" class="lpdv-svg" viewBox="0 0 1440 80" preserveAspectRatio="none"><path d="M0 80C480 0 960 0 1440 80z" /></svg>
    <svg v-else-if="kind === 'angle'" class="lpdv-svg" viewBox="0 0 1440 80" preserveAspectRatio="none"><path d="M0 80L1440 0v80z" /></svg>
  </section>
</template>
<style scoped>
.lpdivider { padding: 0 !important; border-bottom: 0 !important }
.lpdv-line .lpwrap, .lpdv-dots, .lpdv-orn { padding-top: 8px; padding-bottom: 8px }
.lpdv-small .lpwrap { padding-top: 0; padding-bottom: 0 } .lpdv-large .lpwrap { padding-top: 40px; padding-bottom: 40px }
.lpdv-line { border: 0; border-top: 1px solid var(--hair); margin: 0 }
.lpdv-dots { display: flex; justify-content: center; gap: 10px } .lpdv-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--ink3) }
.lpdv-orn { display: flex; align-items: center; justify-content: center; gap: 14px } .lpdv-orn i { flex: 0 0 64px; height: 1px; background: var(--hair) } .lpdv-orn b { width: 8px; height: 8px; background: var(--accent); transform: rotate(45deg) }
.lpdv-space { height: 48px } .lpdv-space.lpdv-small { height: 24px } .lpdv-space.lpdv-large { height: 120px }
.lpdv-svg { display: block; width: 100%; height: 60px; fill: var(--paper) } .lpdv-large .lpdv-svg { height: 120px } .lpdv-small .lpdv-svg { height: 32px }
</style>

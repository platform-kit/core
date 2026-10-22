<script setup>
/* A person as their initials in a circle — there are no profile pictures. */
import { computed } from 'vue'
import { initials } from 'platformkit/lib/chat/model.js'

const props = defineProps({
  name: { type: String, default: '' },
  size: { type: Number, default: 36 },
  /* a coach wears the accent */
  coach: { type: Boolean, default: false },
})
const text = computed(() => initials(props.name))
</script>

<template>
  <span class="cav" :class="{ coach }" :style="{ width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.36) + 'px' }" aria-hidden="true">{{ text }}</span>
</template>

<style scoped>
.cav { display: inline-flex; align-items: center; justify-content: center; flex: none; border-radius: 50%;
  font-family: var(--m); font-weight: 700; letter-spacing: .02em; color: var(--ink2);
  background: color-mix(in srgb, var(--ink) 8%, var(--card)); border: 1px solid var(--hair) }
.cav.coach { color: var(--accent2); background: color-mix(in srgb, var(--accent) 10%, var(--card)); border-color: color-mix(in srgb, var(--accent) 30%, transparent) }
</style>

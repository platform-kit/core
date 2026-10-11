<script setup>
import SiteMark from '../SiteMark.vue'
/*
 * Who is on the other side, as a round mark: the site's own mark until a person has answered,
 * and then that person's initials (there are no profile pictures) — so a thread reads as the
 * house's until someone in it has a name. Ink on paper, never the accent: red reads as an
 * error inside the chat.
 */
import { computed } from 'vue'
import { initials } from '@platform-kit/kit/lib/chat/model.js'

const props = defineProps({
  /* the agent's name, once one has written; empty for the house */
  name: { type: String, default: '' },
  size: { type: Number, default: 34 },
})
const text = computed(() => (props.name ? initials(props.name) : ''))
</script>

<template>
  <span class="sm" :class="{ person: !!name }" :style="{ width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.4) + 'px' }" aria-hidden="true">
    <template v-if="name">{{ text }}</template>
    <SiteMark v-else :size="Math.round(size * 0.58)" stroke="currentColor" />
  </span>
</template>

<style scoped>
.sm { display: inline-flex; align-items: center; justify-content: center; flex: none; border-radius: 50%; color: var(--paper); background: var(--ink);
  font-family: var(--fd); font-weight: 700; letter-spacing: .02em; line-height: 1 }
.sm svg { display: block }
</style>

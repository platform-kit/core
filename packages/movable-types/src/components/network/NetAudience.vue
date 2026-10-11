<script setup>
/* WHO CAN SEE A POST, said on the post: a glyph and the audience's own word, with the longer note
   on hover. A reader should never have to guess whether what they are about to answer was said to
   the world or to the people here. Words from network.md (audience). */
import { computed } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'

const props = defineProps({ post: { type: Object, required: true } })
const A = computed(() => us('network').audience.main)
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const kind = computed(() => (props.post.kind === 'space' ? 'space' : props.post.audience))
const word = computed(() => (kind.value === 'space' ? fill(A.value.space, { space: (props.post.space && props.post.space.name) || '' }) : A.value[kind.value]))
const note = computed(() => A.value[kind.value + '-note'])
</script>

<template>
  <span class="na" :class="'na-' + kind" :title="note">
    <svg v-if="kind === 'everyone'" viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2.2 2.2 2.2 11.8 0 14M10 3c-2.2 2.2-2.2 11.8 0 14" /></svg>
    <svg v-else-if="kind === 'here'" viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 9 10 3.5 16.5 9v7.5h-13z" /><path d="M8 16.5v-4h4v4" /></svg>
    <svg v-else viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8.5" width="12" height="8" rx="1.5" /><path d="M7 8.5V6.5a3 3 0 0 1 6 0v2" /></svg>
    <span>{{ word }}</span>
  </span>
</template>

<style scoped>
.na { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px 1px 6px; border-radius: 999px;
  font-size: 11.5px; font-weight: 600; line-height: 18px; color: var(--ink3);
  background: color-mix(in srgb, var(--ink) 5%, transparent) }
.na-space { color: var(--ink2) }
</style>

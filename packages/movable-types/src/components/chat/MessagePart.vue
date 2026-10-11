<script setup>
/*
 * One part of a message's line, drawn with the element that MEANS it: **bold** is <strong> and not
 * a span wearing a weight, so a screen reader says it, a copy carries it, and a stylesheet is not
 * the only thing that knows. A part may be under several marks, so this component wears the first
 * and hands the rest to itself.
 */
import { computed } from 'vue'
const props = defineProps({
  part: { type: Object, required: true },
  me: { type: String, default: '' },
})
const TAG = { b: 'strong', i: 'em', s: 's', code: 'code' }
const marks = computed(() => (props.part.marks || []).filter((m) => TAG[m]))
const inner = computed(() => ({ ...props.part, marks: marks.value.slice(1) }))
</script>

<template>
  <component :is="TAG[marks[0]]" v-if="marks.length" class="mk-m"><MessagePart :part="inner" :me="me" /></component>
  <a v-else-if="part.kind === 'link'" class="mk-a" :href="part.href" target="_blank" rel="noopener nofollow">{{ part.text }}</a>
  <span v-else-if="part.kind === 'mention'" class="mk-at" :class="{ me: part.id === me }">@{{ part.name }}</span>
  <template v-else>{{ part.text }}</template>
</template>

<style scoped>
/* the elements carry the meaning; these say only what the site's own type wants of them */
.mk-m { font: inherit }
strong.mk-m { font-weight: 700 }
em.mk-m { font-style: italic }
s.mk-m { text-decoration: line-through; text-decoration-thickness: 1px }
code.mk-m { font-family: var(--m); font-size: .92em; background: color-mix(in srgb, var(--ink) 7%, transparent);
  border-radius: 4px; padding: 1px 4px }
.mk-a { color: var(--sp-link, var(--accent)); text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere }
/* a name is a name, not a badge — the treatment the rooms have always given it */
.mk-at { color: var(--sp-link, var(--accent)); background: color-mix(in srgb, currentColor 10%, transparent);
  border-radius: 3px; padding: 0 3px; font-weight: 600 }
.mk-at.me { color: color-mix(in srgb, var(--ink) 85%, var(--sp-tint-bar, var(--accent)));
  background: color-mix(in srgb, var(--sp-tint-bar, var(--accent)) 30%, transparent) }
</style>

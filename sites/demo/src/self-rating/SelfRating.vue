<!--
  A SELF-RATING LESSON: the lesson's question (its ref), a scale from 0 to 100, and the one action that saves the rating
  and finishes the lesson. The rating becomes the section's measure in the course's sidebar and outline.
-->
<template>
  <div class="nl-rating">
    <p class="nl-rating-q">{{ lesson.ref }}</p>
    <label class="nl-rating-scale">
      <input v-model.number="value" type="range" min="0" max="100" step="10" :aria-label="lesson.ref || ''" />
      <output>{{ fill(K.percent, { n: value }) }}</output>
    </label>
    <div v-if="enrollment" class="nl-rating-act">
      <button type="button" class="btn solid" @click="save">{{ done ? S.retake : S['complete-continue'] }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { readRating, saveRating } from './rating.ts'

const props = defineProps<{ lesson: { key: string, ref?: string | null }, course: string, enrollment: object | null, done: boolean }>()
const emit = defineEmits<{ complete: [], measure: [] }>()

/* the theme's own course words: a site kind says nothing in English of its own */
const words = (us('courses') as { page?: { course?: Record<string, string>, lesson?: Record<string, string> } }).page || {}
const K = words.course || {}, S = words.lesson || {}
const fill = (t: string | undefined, m: Record<string, string | number>) => String(t || '').replace(/\{(\w+)\}/g, (_, k: string) => String(m[k] ?? ''))

const value = ref(50)
watch(() => props.lesson.key, () => { value.value = readRating(props.course, props.lesson.key) ?? 50 }, { immediate: true })

function save() {
  saveRating(props.course, props.lesson.key, value.value)
  emit('measure')
  if (!props.done) emit('complete')
}
</script>

<style scoped>
.nl-rating { display: grid; gap: 1rem; margin: 1.5rem 0; padding: 1.25rem; border: 1px solid var(--line, rgba(0, 0, 0, .12)); border-radius: 12px; }
.nl-rating-q { margin: 0; font-size: 1.1rem; font-weight: 600; }
.nl-rating-scale { display: flex; align-items: center; gap: 1rem; }
.nl-rating-scale input { flex: 1; min-width: 0; accent-color: var(--accent, currentColor); }
.nl-rating-scale output { min-width: 3.5rem; text-align: right; font-variant-numeric: tabular-nums; }
.nl-rating-act { display: flex; justify-content: flex-end; }
</style>

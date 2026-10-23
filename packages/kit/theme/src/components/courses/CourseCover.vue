<script setup>
/*
 * A course's cover: its picture where it has one, else one drawn from its title in the colour the kit gives a book
 * with no cover of its own (coverTint), so a catalogue of courses without pictures still reads as a shelf of distinct
 * things rather than a row of empty boxes. The title is set whole — never initials — with what the course holds.
 */
import { coverTint } from 'platformkit/lib/content.js'

defineProps({
  slug: { type: String, default: '' },
  title: { type: String, default: '' },
  image: { type: String, default: '' },
  meta: { type: String, default: '' },     /* a line under the title on a drawn cover: "16 lessons · 5 modules" */
  size: { type: String, default: 'card' }, /* card · hero · thumb */
})
</script>

<template>
  <span class="crs-cover" :class="['is-' + size, { 'is-drawn': !image }]" :style="image ? null : { background: coverTint(slug) }">
    <img v-if="image" :src="image" alt="" loading="lazy" />
    <template v-else>
      <span class="crs-cover-title">{{ title }}</span>
      <span v-if="meta && size !== 'thumb'" class="crs-cover-meta">{{ meta }}</span>
    </template>
  </span>
</template>

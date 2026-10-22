<script setup>
/*
 * A BADGE. The achievement's own glyph in its own colour, on a disc — and the same disc, drained
 * of colour and outlined rather than filled, for one the reader has not earned.
 *
 * NOT EARNED IS NOT HIDDEN. A gallery that shows only what somebody has is a gallery that never
 * says what else there is; the point of saying a thing is worth doing is that people hear it said.
 * So an unearned badge is drawn quietly and is still a way in to its page.
 */
import { computed } from 'vue'
import SpaceIcon from './spaces/SpaceIcon.vue'

const props = defineProps({
  award: { type: Object, required: true },
  size: { type: Number, default: 48 },
  held: { type: Boolean, default: true },
})
const tone = computed(() => props.award.colour || 'var(--accent)')
</script>

<template>
  <span
    class="ab" :class="{ 'is-held': held }" :style="{ '--ab': tone, width: size + 'px', height: size + 'px' }"
    :title="award.title">
    <img v-if="award.cover" class="ab-img" :src="typeof award.cover === 'object' ? award.cover.src : award.cover" alt="" />
    <SpaceIcon v-else :name="award.icon || 'star'" :size="Math.round(size * 0.42)" />
  </span>
</template>

<style scoped>
.ab { display: inline-flex; align-items: center; justify-content: center; flex: none; border-radius: 50%;
  overflow: hidden; color: color-mix(in srgb, var(--ab) 55%, var(--ink3));
  background: color-mix(in srgb, var(--ab) 8%, transparent);
  border: 1.5px dashed color-mix(in srgb, var(--ab) 30%, transparent) }
/* earned: filled, in its own colour, and lifted off the page */
.ab.is-held { color: #fff; border: 0;
  background: linear-gradient(160deg, color-mix(in srgb, var(--ab) 88%, #fff), var(--ab));
  box-shadow: 0 6px 18px -8px color-mix(in srgb, var(--ab) 70%, transparent) }
.ab-img { width: 100%; height: 100%; object-fit: cover; display: block }
</style>

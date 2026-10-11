<script setup>
/*
 * A BADGE SOMEBODY WAS GIVEN. "Founding member", "Answered fifty questions", "Read the whole
 * shelf" — what a space invents to say something about a person that a role does not.
 *
 * It is drawn two ways and they are deliberately different weights:
 *
 *   inline — beside a name in a room. A glyph and nothing else where it has one, so a line of
 *   conversation keeps its shape; the name is its title, so it is there for anybody who looks.
 *   A badge whose file says `inline: false` is not drawn here at all.
 *
 *   full — on the member's card and in the directory. The glyph and the name, and the note
 *   underneath where the badge has one, which is where somebody finds out what it means.
 *
 * The glyph is a name from the surface's own set, never a picture: a wall of flair that is a wall
 * of uploaded logos is a wall of adverts. The colour is the badge's own, faded to a ground, and a
 * badge with none wears the room's quiet one — so a space that has thought about none still reads.
 */
import { computed } from 'vue'
import SpaceIcon from './SpaceIcon.vue'

const props = defineProps({
  flair: { type: Array, default: () => [] },
  /* inline beside a name, full on a card */
  mode: { type: String, default: 'inline' },
  size: { type: Number, default: 13 },
})
/* inline shows only what asked to be there; the card shows everything they have */
const rows = computed(() => (props.flair || []).filter((f) => props.mode !== 'inline' || f.inline !== false))
</script>

<template>
  <span v-if="rows.length" class="sfl" :class="'sfl-' + mode">
    <span
      v-for="f in rows" :key="f.slug" class="sfl-one"
      :style="f.colour ? { '--fl': f.colour } : null"
      :title="mode === 'inline' ? (f.note ? f.name + ' — ' + f.note : f.name) : (f.note || '')">
      <SpaceIcon v-if="f.icon" :name="f.icon" :size="size" />
      <b v-if="mode !== 'inline' || !f.icon">{{ f.name }}</b>
    </span>
  </span>
</template>

<style scoped>
.sfl { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0 }
.sfl-one { display: inline-flex; align-items: center; gap: 4px; color: var(--fl, var(--ink3)) }
/* beside a name: a mark, at the weight of the metadata around it */
.sfl-inline .sfl-one { line-height: 1 }
.sfl-inline b { font-size: 10.5px; font-weight: 700; letter-spacing: .02em }
/* on a card: a chip, the badge's own colour faded to a ground so a row of them still reads as text */
.sfl-full { gap: 6px }
.sfl-full .sfl-one { padding: 3px 9px 3px 7px; border-radius: 999px;
  background: color-mix(in srgb, var(--fl, var(--ink)) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--fl, var(--ink)) 26%, transparent) }
.sfl-full b { font-size: 11.5px; font-weight: 700; color: var(--fl, var(--ink2)) }
</style>

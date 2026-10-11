<script setup>
/* A person as a rounded square, the way a workspace chat draws them.
 *
 * The square holds a FACE, drawn for them by DiceBear from their own seed (lib/avatar.js) — the same
 * face every time, on every device, drawn in the page and never fetched from anybody's CDN. Initials
 * are what shows underneath it: while the face is drawing, if the collection will not draw at all,
 * and as the picture's alt text, because two letters read by a screen reader are better than "image".
 *
 * The tone under the face is still a person's own, from eight chosen ones rather than the whole
 * wheel: it shows through a transparent collection, it is what a broken face falls back to, and a
 * wall of faces is still scannable by colour from further away than a face is legible.
 */
import { computed } from 'vue'
import { initials } from '@platform-kit/kit/lib/chat/model.js'
import { avatarUrl, faceOf, seedOf } from '@platform-kit/kit/lib/avatar.js'

const props = defineProps({
  name: { type: String, default: '' },
  size: { type: Number, default: 36 },
  /* THE PERSON, where the caller has one — which is the answer to all three questions at once:
     the picture they uploaded, the style they picked, and the seed the database gave for them.
     A caller with only a name (a guest, a label) passes none and gets a face drawn from the name,
     which is honest; a caller with an id must pass the record, because a face drawn from a display
     name changes the day somebody renames themselves. */
  person: { type: Object, default: null },
  /* what the face is drawn from, where a caller has a seed but no record */
  seed: { type: String, default: '' },
  /* a picture they chose themselves always wins: this component is the fallback, not the rule */
  src: { type: String, default: '' },
})
/* A stable tone per person, so a wall of initials is still scannable — but from eight chosen ones
   rather than the whole wheel, which hands out a saturated maroon beside a saturated green and
   reads as a child's paintbox. All eight sit at one lightness, so a row of them is level, and all
   eight work on cream and on navy. */
const TONES = ['#6d5b86', '#4a678f', '#3d7369', '#86613c', '#8d5460', '#57724a', '#61668a', '#93634a']
/* the tone follows the same seed the face does, so both are stable across a rename */
const key = computed(() => (props.person ? seedOf(props.person) : String(props.seed || props.name || '').trim().toLowerCase()))
const tone = computed(() => {
  let h = 0
  for (const c of key.value) h = (h * 31 + c.charCodeAt(0)) % 9973
  return TONES[h % TONES.length]
})
const face = computed(() => props.src || (props.person ? faceOf(props.person) : avatarUrl(key.value)))
</script>

<template>
  <span
    class="sav"
    :style="{ width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.37) + 'px', borderRadius: Math.max(4, Math.round(size * 0.22)) + 'px', background: tone }">
    <span class="sav-in" aria-hidden="true">{{ initials(name) }}</span>
    <img v-if="face" class="sav-face" :src="face" :alt="initials(name)" loading="lazy" decoding="async" />
  </span>
</template>

<style scoped>
.sav { position: relative; display: inline-flex; align-items: center; justify-content: center; flex: none;
  font-weight: 700; letter-spacing: .02em; color: #fff; text-transform: uppercase; overflow: hidden }
.sav-in { line-height: 1 }
/* the face sits over the tone, which is then what shows through a transparent collection and what
   is left if the picture will not load at all */
.sav-face { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block }
</style>

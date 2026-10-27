<script setup>
/*
 * The course screens' own marks, one stroke weight throughout: what a lesson is (video, audio, reading, a chapter, an
 * article, a form, a session), what state it is in (done, open, closed), and the few controls the player needs.
 */
const props = defineProps({ name: { type: String, required: true }, size: { type: Number, default: 18 } })
const P = {
  video: ['M4 6.5h9a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 14V8A1.5 1.5 0 0 1 4 6.5Z', 'm14.5 9.5 3-2v7l-3-2'],
  audio: ['M3.5 12v-1a6.5 6.5 0 0 1 13 0v1', 'M3.5 12h2v4h-1a1 1 0 0 1-1-1v-3Zm13 0h-2v4h1a1 1 0 0 0 1-1v-3Z'],
  text: ['M5 3.5h7l3 3v10H5z', 'M12 3.5v3h3', 'M7.5 10h5M7.5 13h5'],
  chapter: ['M10 5.5c-1.6-1.2-3.6-1.6-6.5-1.5v11c2.9-.1 4.9.3 6.5 1.5 1.6-1.2 3.6-1.6 6.5-1.5V4c-2.9-.1-4.9.3-6.5 1.5Z', 'M10 5.5v11'],
  article: ['M4 4.5h12v11H4z', 'M6.5 7.5h7M6.5 10h7M6.5 12.5h4'],
  form: ['M6 3.5h8a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z', 'm7.5 8 1 1 2-2M7.5 13l1 1 2-2', 'M12 8.5h1M12 13.5h1'],
  session: ['M4 5.5h12v10.5H4z', 'M4 9h12M7.5 3.5v3M12.5 3.5v3'],
  file: ['M10 3.5v9m0 0-3.5-3.5M10 12.5l3.5-3.5', 'M4 15.5h12'],
  done: ['M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z', 'm6.8 10.2 2.2 2.2 4.3-4.6'],
  open: ['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z'],
  missed: ['M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z', 'm7.6 7.6 4.8 4.8M12.4 7.6l-4.8 4.8'],
  closed: ['M5.5 9h9v7h-9z', 'M7.5 9V7a2.5 2.5 0 0 1 5 0v2'],
  play: ['M7 5.2v9.6L15 10z'],
  chev: ['m7.5 5 5 5-5 5'],
  back: ['m12.5 5-5 5 5 5'],
  down: ['m5 7.5 5 5 5-5'],
  list: ['M7 5.5h9M7 10h9M7 14.5h9', 'M3.75 5.5h.5M3.75 10h.5M3.75 14.5h.5'],
  close: ['m5 5 10 10M15 5 5 15'],
  award: ['M10 2.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z', 'm7 11.5-1.5 6 4.5-2.5 4.5 2.5-1.5-6'],
  clock: ['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z', 'M10 6.5V10l2.5 1.5'],
  layers: ['m10 3 7 3.5-7 3.5-7-3.5z', 'm3 10 7 3.5 7-3.5', 'm3 13.5 7 3.5 7-3.5'],
  order: ['M4 5.5h3v3H4zM4 11.5h3v3H4z', 'M10 7h6M10 13h6'],
  arrow: ['M4 10h12m0 0-4.5-4.5M16 10l-4.5 4.5'],
}
</script>

<template>
  <svg class="crs-ico" :class="'is-' + name" :width="size" :height="size" viewBox="0 0 20 20" aria-hidden="true">
    <path v-for="(d, i) in P[name] || []" :key="i" :d="d" />
  </svg>
</template>

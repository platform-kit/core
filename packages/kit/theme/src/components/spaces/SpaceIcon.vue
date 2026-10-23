<script setup>
/* The glyphs the workspace chrome is drawn with, as line art rather than emoji, so the rail and the
   toolbars read as one set. Each is 20 units square and inherits the colour around it. */
const props = defineProps({ name: { type: String, required: true }, size: { type: Number, default: 18 } })
const P = {
  home: 'M3 9.5 10 3l7 6.5V17a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z',
  dm: 'M4 4h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8l-4 3v-3H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
  /* threads: a line said, and a second one answering it under the first */
  thread: 'M3 4h10a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H7l-3 2.2V10H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 13h7a1 1 0 0 0 1-1V8',
  /* the network's feed: posts stacked, newest at the top */
  feed: 'M4 3.5h12a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1zM4 11.5h12a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1zM5.5 6h5M5.5 14h7',
  /* one person: a head and shoulders */
  person: 'M10 3.5a3.25 3.25 0 1 1 0 6.5 3.25 3.25 0 0 1 0-6.5zM3.75 17a6.25 6.25 0 0 1 12.5 0',
  /* a picture: a frame, a sun, a hill */
  image: 'M4.5 4h11A1.5 1.5 0 0 1 17 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-9A1.5 1.5 0 0 1 4.5 4zM7.5 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM3.5 14l4-4 3 3 2-2 4 4',
  /* a month: what is on */
  calendar: 'M5 4.5h10a1.5 1.5 0 0 1 1.5 1.5v9.5A1.5 1.5 0 0 1 15 17H5a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 5 4.5zM3.5 8.5h13M7 3v3M13 3v3',
  /* the rest, folded: three dots in a ring */
  menu: 'M10 2.75a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5zM6.75 10h.01M10 10h.01M13.25 10h.01',
  bell: 'M10 3a4 4 0 0 0-4 4v3l-1.5 3h11L14 10V7a4 4 0 0 0-4-4zM8 16a2 2 0 0 0 4 0',
  clock: 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM10 7v3.2l2.2 1.3',
  search: 'M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM13.2 13.2 17 17',
  back: 'M12 4 6 10l6 6',
  fwd: 'M8 4l6 6-6 6',
  pencil: 'M4 16v-3l9-9 3 3-9 9zM12 5l3 3',
  hash: 'M6 3 4.6 17M12 3l-1.4 14M3.5 7.5h13M3 12.5h13',
  lock: 'M6 9V6.5a4 4 0 0 1 8 0V9M4.5 9h11v8h-11z',
  people: 'M7.5 9.5a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM13.4 9.6a2.1 2.1 0 1 0 0-4.2M2.8 16.2c0-2.3 2.1-3.7 4.7-3.7s4.7 1.4 4.7 3.7M14 12.7c2 .3 3.3 1.5 3.3 3.5',
  shield: 'M10 3 4.5 5.2v4.3c0 3.2 2.3 6.1 5.5 7.2 3.2-1.1 5.5-4 5.5-7.2V5.2z',
  flag: 'M5 17V4h8l-1.6 2.6L13 9.2H5',
  /* a tray with something in it: what is waiting to be read */
  unread: 'M3.5 11.5h3.2l1.2 2h4.2l1.2-2h3.2M3.5 11.5 5.8 5h8.4l2.3 6.5v3.2a1.3 1.3 0 0 1-1.3 1.3H4.8a1.3 1.3 0 0 1-1.3-1.3z',
  pin: 'M7.2 3.2h5.6M10 3.2v4.1l2.6 3.1v1.4H7.4v-1.4L10 7.3M10 11.8V17',
  ticket: 'M3.5 7.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1.2a1.4 1.4 0 0 0 0 2.6v1.2a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-1.2a1.4 1.4 0 0 0 0-2.6zM10 7v6',
  head: 'M4 12V9a6 6 0 0 1 12 0v3M3 12h3v5H4a1 1 0 0 1-1-1zM17 12h-3v5h2a1 1 0 0 0 1-1z',
  course: 'M2.5 7.5 10 4l7.5 3.5L10 11 2.5 7.5zM5.5 9v3.6c0 1.1 2 2.4 4.5 2.4s4.5-1.3 4.5-2.4V9M17.5 7.5v4',
  more: 'M10 5.5h.01M10 10h.01M10 14.5h.01',
  close: 'M5 5l10 10M15 5 5 15',
  chev: 'M5 8l5 5 5-5',
  plus: 'M10 4v12M4 10h12',
  bold: 'M6 4h5a3 3 0 0 1 0 6H6zM6 10h5.5a3 3 0 0 1 0 6H6z',
  italic: 'M8 4h6M6 16h6M12 4 8 16',
  under: 'M6 3v6a4 4 0 0 0 8 0V3M5 17h10',
  strike: 'M6 5.5C6 4 7.6 3 10 3s4 1 4 2.5M4 10h12M14 12.5c0 2-1.6 3.5-4 3.5s-4-1-4-2.5',
  link: 'M8.5 11.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0L5 10.8a3 3 0 0 0 4.2 4.2l1-1',
  ol: 'M4 5h1v3M4 8h2M4 12.5h2L4 16h2M9 6h8M9 14h8',
  chart: 'M4 6h11M4 12h7M4 18h14',
  ul: 'M4.5 6h.01M4.5 10h.01M4.5 14h.01M8 6h8M8 10h8M8 14h8',
  quote: 'M6 5h3v5H4V7a2 2 0 0 1 2-2zM13 5h3v5h-5V7a2 2 0 0 1 2-2z',
  code: 'M7 6 3 10l4 4M13 6l4 4-4 4',
  block: 'M3.5 4.5h13v11h-13zM6 8l-1.5 2L6 12M14 8l1.5 2L14 12',
  aa: 'M3 15 6.5 5 10 15M4.3 12h4.4M12 9.5a2.5 2.5 0 1 1 5 0V15M17 12h-2.5a2 2 0 0 0 0 4c1.3 0 2.5-.8 2.5-2',
  smile: 'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM7.5 8.5h.01M12.5 8.5h.01M7 12a4 4 0 0 0 6 0',
  at: 'M13 10a3 3 0 1 1-3-3M13 7v4a2 2 0 0 0 3 1.6A6.5 6.5 0 1 0 13.6 16',
  video: 'M3.5 6h9v8h-9zM12.5 9.5 17 7v6l-4.5-2.5z',
  send: 'M3 10 17 4l-5 13-2.5-5.5z',
  star: 'M10 3.5 12 8l4.8.4-3.6 3.1 1.1 4.6L10 13.7 5.7 16.1l1.1-4.6L3.2 8.4 8 8z',
  tick: 'M4.5 10.5 8 14l7.5-8',
  inbox: 'M3 11h4l1.2 2h3.6L13 11h4M3 11l2.2-6h9.6L17 11v4.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  sparkle: 'M10 3.2l1.6 4.2 4.2 1.6-4.2 1.6L10 14.8l-1.6-4.2L4.2 9l4.2-1.6zM15.4 13.4l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
  clip: 'M13.4 9.2l-4.1 4.1a1.9 1.9 0 0 0 2.7 2.7l4.7-4.7a3.4 3.4 0 0 0-4.8-4.8l-4.9 4.9a4.9 4.9 0 0 0 6.9 6.9l3.4-3.4',
  mic: 'M10 3.2a2.2 2.2 0 0 1 2.2 2.2v4.2a2.2 2.2 0 0 1-4.4 0V5.4A2.2 2.2 0 0 1 10 3.2zM5.8 9.6a4.2 4.2 0 0 0 8.4 0M10 13.8v3M7.6 16.8h4.8',
  /* a mic with a line through it: a muted person in a call was drawn with nothing at all, because
     the button asked for a glyph this set did not have and an unknown name draws empty */
  'mic-off': 'M10 3.2a2.2 2.2 0 0 1 2.2 2.2v4.2a2.2 2.2 0 0 1-.3 1.1M7.8 8.2V5.4M5.8 9.6a4.2 4.2 0 0 0 6.5 3.5M10 13.8v3M7.6 16.8h4.8M3.6 3.6l12.8 12.8',
  /* a month, for the calendar the rail opens */
  calendar: 'M4 5.5h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM3 9h14M7 3.5v3M13 3.5v3',
  'mic-off': 'M12.2 5.4a2.2 2.2 0 0 0-4.4 0v3.2M7.8 11.2a2.2 2.2 0 0 0 3.9 1.2M5.8 9.6a4.2 4.2 0 0 0 6.3 3.6M10 13.8v3M7.6 16.8h4.8M3.5 3.5l13 13',
  cam: 'M3.5 6.2h8.2v7.6H3.5zM11.7 9.4 16.5 7v6l-4.8-2.4z',
  'cam-off': 'M8.6 6.2h3.1v5M11.7 9.4 16.5 7v6l-2.6-1.3M3.5 7.6v6.2h7.3M3.5 3.5l13 13',
  hang: 'M3.2 11.6a13 13 0 0 1 13.6 0l-.4 2.3a1.6 1.6 0 0 1-1.9 1.3l-2.3-.5a1.4 1.4 0 0 1-1.1-1.3v-1a9 9 0 0 0-3.2 0v1a1.4 1.4 0 0 1-1.1 1.3l-2.3.5a1.6 1.6 0 0 1-1.9-1.3z',
  expand: 'M12 3.5h4.5V8M8 16.5H3.5V12M16.5 3.5 11.5 8.5M3.5 16.5l5-5',
  shrink: 'M16.5 7.5H12V3M3.5 12.5H8V17M11.5 8.5l5-5M8.5 11.5l-5 5',
}
</script>

<template>
  <svg class="si" :width="size" :height="size" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path :d="P[name] || ''" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>

<style scoped>
.si { display: block; flex: none }
</style>

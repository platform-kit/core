<script setup>
/*
 * THE BUTTONS UNDER A MESSAGE THAT OFFERS CHOICES — one control, every surface.
 *
 * A support prompt's choices and a bot's answer's are the same thing: a list at the end of some
 * markdown, cut off the words and drawn as buttons. They were drawn in the widget alone, in the
 * widget's own markup, which is how a room and a desk end up with two designs of one control and
 * a change to either is a change to one of them.
 *
 * Spent is not hidden. Once an offer is taken — or the conversation has moved past it — the buttons
 * stay under their own answer, faded and dead, so the thread still reads as what was offered and
 * what was taken. The taken one is marked, because "which did I press" is the first thing anybody
 * scrolling back wants to know.
 *
 * The rise is the widget's: one curve for the whole thing, staggered by 45ms, and never on a spent
 * set — it did not arrive, it has been sitting there. Off under prefers-reduced-motion.
 */
defineProps({
  /* [{ key, text, form?, href?, children? }] — as the grammar cut them */
  choices: { type: Array, default: () => [] },
  /* may they be pressed */
  live: { type: Boolean, default: true },
  /* the key of the one taken, where one was */
  taken: { type: String, default: '' },
  busy: { type: Boolean, default: false },
})
defineEmits(['choose'])
</script>

<template>
  <div v-if="choices.length" class="cc" :class="{ spent: !live }">
    <button
      v-for="(c, i) in choices" :key="c.key" type="button" class="cc-b"
      :class="{ took: taken && c.key === taken }" :style="{ '--i': i }"
      :disabled="!live || busy" @click="$emit('choose', c)"
    >{{ c.text }}</button>
  </div>
</template>

<style scoped>
.cc { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 2px; align-self: flex-start }
.cc-b { font: inherit; font-size: 13.5px; color: var(--ink); background: var(--paper); border: 1px solid var(--ink); border-radius: 999px; padding: 7px 13px; cursor: pointer; text-align: left; transition: background .16s, color .16s, transform .16s cubic-bezier(.2, .8, .2, 1) }
.cc-b:hover:not(:disabled) { color: var(--paper); background: var(--ink) }
.cc-b:active:not(:disabled) { transform: scale(.97) }
/* animation: none first — the arrival is filled BOTH ways, so it wins over a plain opacity and a
   spent set stayed solid. A set that has been answered did not arrive either. */
.spent .cc-b { animation: none; opacity: .5; cursor: default }
/* the one taken reads as taken rather than merely faded */
.spent .cc-b.took { opacity: .85; color: var(--paper); background: var(--ink) }
@media (prefers-reduced-motion: no-preference) {
  .cc:not(.spent) .cc-b { animation: cc-in .4s cubic-bezier(.2, .8, .2, 1) both; animation-delay: calc(.1s + var(--i, 0) * 45ms) }
  @keyframes cc-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
}
</style>

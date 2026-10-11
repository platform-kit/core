<script setup>
/* The one thing to do. The only filled block on a page, because it is the only
   thing on it that asks for anything. */
defineProps({
  kicker: { type: String, required: true },
  /* the light side: same card, paper instead of ink */
  light: { type: Boolean, default: false },
})
</script>

<template>
  <div class="action" :class="{ light }">
    <div class="action-kicker">{{ kicker }}</div>
    <div v-if="$slots.say" class="action-instruction"><slot name="say" /></div>
    <div v-if="$slots.why" class="action-rationale"><slot name="why" /></div>
  </div>
</template>

<style scoped>
/* the only filled block on a page */
.action {
  background: var(--qink); color: var(--qflip, #FBFBDA); border-radius: 16px;
  padding: 26px 30px; margin: 0 0 var(--s4);
}
.action-kicker {
  font-family: var(--m, ui-monospace, Menlo, monospace); font-size: 10px;
  font-weight: 500; letter-spacing: .17em; text-transform: uppercase;
  opacity: .5; margin-bottom: 14px;
}
.action-instruction {
  font-size: 26px; font-weight: 700; line-height: 1.24; letter-spacing: -.022em;
  margin-bottom: 14px; max-width: 34ch; text-wrap: balance;
}
.action-rationale { font-size: 15.5px; font-weight: 400; line-height: 1.65; opacity: .82; max-width: 62ch }

.action.light { background: var(--qcard, #FFFFFFDE); color: var(--qink); border: 1px solid var(--qhair) }
.action.light .action-kicker { color: var(--qink3); opacity: 1 }
.action.light .action-rationale { color: var(--qink2); opacity: 1 }
</style>

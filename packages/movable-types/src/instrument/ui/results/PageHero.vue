<script setup>
/* Every page opens the same way: a small label saying what you are looking at,
   then the finding as a short statement, then the prose. The words come from the
   page that uses it. */
import { us } from '../strings.js'
defineProps({ hero: { type: Object, default: () => ({}) } });
const H = ((us('pages').hero || {}).labels) || {}
</script>

<template>
  <div class="hero">
    <h3 class="headline"><slot name="statement" /></h3>
    <p v-if="$slots.prose" class="lede"><slot name="prose" /></p>
    <p v-if="$slots.also" class="also"><i>{{ H.also }}</i><slot name="also" /></p>
  </div>
</template>

<style scoped>
.hero {
  margin: 0 0 var(--s4);
  padding: 0;
  border: 0;
  background: none;
}
.eyebrow {
  display: block;
  font-family: var(--m, ui-monospace, Menlo, monospace);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.17em;
  text-transform: uppercase;
  color: var(--qink3);
  margin-bottom: var(--s2);
}
.headline {
  font-size: clamp(31px, 4.6vw, 45px);
  line-height: 1.1;
  letter-spacing: -0.03em;
  font-weight: 700;
  max-width: 100%;
  text-wrap: balance;
  margin: 0 0 var(--s3);
  color: var(--qink);
}
.lede {
  font-size: 16.5px;
  font-weight: 400;
  line-height: 1.65;
  color: var(--qink2);
  max-width: 100%;
  margin: 0;
}
.also {
  font-size: 15px;
  font-weight: 400;
  line-height: 1.6;
  color: var(--qink3);
  max-width: none;
  margin: var(--s2) 0 0;
}
.also i {
  font-style: normal;
  font-family: var(--m, ui-monospace, Menlo, monospace);
  font-size: 9.5px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  margin-right: 9px;
}
</style>

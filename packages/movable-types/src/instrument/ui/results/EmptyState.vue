<script setup>
/*
 * What a tab looks like before it has anything behind it.
 *
 * There are four of these and they were four different shapes: three headlines
 * were questions and one was a statement, three carried a dark action card
 * misused to describe a payoff rather than name an action, one carried nothing at
 * all, and none of them told you how long it takes or gave you a way to begin.
 *
 * They are all this now. Same order every time: what you will find out, one line
 * expanding it, what it gives you, and the way in.
 *
 * The second slot used to be "what you actually do" — a narration of the
 * answering — which is the machinery wearing a friendly face. It is a second
 * promise now, not a description of the act.
 *
 * Two kinds of tab need it. A TEST is something you go and answer, so it ends in
 * a button and a running time. A DERIVED page — the reading list — is not
 * something you take; it fills in once another tab has been answered, so it says
 * which one and offers no button it cannot honour.
 */
import { us } from '../strings.js'
const BOX = (us('pages').empty || {}).box || {}
defineProps({
  eyebrow: { type: String, default: "" },   /* not rendered; kept for the call sites */
  minutes: { type: String, default: "" },
  /* for a page that fills in from another rather than being answered */
  unlockedBy: { type: String, default: "" },
});
defineEmits(["start"]);
</script>

<template>
  <div class="empty">
    <h3 class="empty-headline"><slot name="headline" /></h3>
    <p class="empty-what"><slot name="promise" /></p>

    <div class="empty-gives">
      <span class="empty-gives-label">{{ BOX.gives }}</span>
      <ul>
        <slot name="gives" />
      </ul>
    </div>

    <div class="empty-foot">
      <template v-if="unlockedBy">
        <p class="empty-unlock">
          {{ BOX['unlock-a'] }} <b>{{ unlockedBy }}</b> {{ BOX['unlock-b'] }}
        </p>
      </template>
      <template v-else>
        <button class="empty-start" type="button" @click="$emit('start')">
          {{ BOX.start }}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h13M13 6l6 6-6 6" />
          </svg>
        </button>
        <span class="empty-time">{{ minutes }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.empty {
}
.empty-eyebrow {
  display: block;
  font-family: var(--m, ui-monospace, Menlo, monospace);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.17em;
  text-transform: uppercase;
  color: var(--qink3);
  margin-bottom: var(--s2);
}
.empty-headline {
  font-size: clamp(28px, 4.2vw, 40px);
  line-height: 1.14;
  letter-spacing: -0.028em;
  font-weight: 700;
  color: var(--qink);
  margin: 0 0 var(--s3);
  text-wrap: balance;
}
.empty-what {
  font-size: 16.5px;
  line-height: 1.65;
  color: var(--qink2);
  margin: 0 0 var(--s3);
}

.empty-gives {
  border-top: 1px solid var(--qhair);
  padding-top: var(--s3);
  margin-bottom: var(--s3);
}
.empty-gives-label {
  display: block;
  font-family: var(--m, ui-monospace, Menlo, monospace);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.17em;
  text-transform: uppercase;
  color: var(--qink3);
  margin-bottom: 12px;
}
.empty-gives ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.empty-gives :deep(li) {
  position: relative;
  padding-left: 22px;
  margin-bottom: 9px;
  font-size: 15.5px;
  line-height: 1.55;
  color: var(--qink2);
}
.empty-gives :deep(li:last-child) {
  margin-bottom: 0;
}
.empty-gives :deep(li)::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.62em;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--qink);
}

.empty-foot {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.empty-start {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font: inherit;
  font-size: 15.5px;
  font-weight: 600;
  background: var(--qink);
  color: var(--qflip, #fbfbda);
  border: 0;
  border-radius: 999px;
  padding: 13px 24px;
  cursor: pointer;
}
.empty-start:hover {
  opacity: 0.87;
}
.empty-start svg {
  width: 15px;
  height: 15px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.empty-time {
  font-family: var(--m, ui-monospace, Menlo, monospace);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--qink3);
}
.empty-unlock {
  font-size: 15.5px;
  line-height: 1.65;
  color: var(--qink3);
  margin: 0;
}
.empty-unlock b {
  color: var(--qink2);
  font-weight: 600;
}
</style>

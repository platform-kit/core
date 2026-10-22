<script setup>
/*
 * What a chat prompt shows above the launcher before the panel opens. Two shapes, by what the
 * prompt carries:
 *   — a `teaser` line: the line alone, as a message waiting to be answered — the whole card
 *     opens the panel on the prompt; the choices and the prompt's full line wait inside. This is
 *     how the desk's default rests above the launcher too;
 *   — none: the prompt's line itself, as though someone had just written, with its choices as
 *     buttons and Reply — a click sends the choice and opens the thread.
 * Entirely the browser's doing — nothing was sent, and nothing is until the reader writes back.
 * Words from content/app/ui/support.md (teaser).
 */
import { us } from 'platformkit/lib/content.js'
import { siteUrl } from 'platformkit/lib/support/api.js'
import SupportMark from './SupportMark.vue'

defineProps({ prompt: { type: Object, required: true } })
/* reply carries the choice picked, if the prompt offered any; open is the teaser's button */
const emit = defineEmits(['reply', 'open', 'dismiss'])
const T = us('support').teaser.main
</script>

<template>
  <div class="st" :class="{ 'st-nudge': !!prompt.teaser }" role="status" aria-live="polite">
  <!-- the short line and a way in -->
  <template v-if="prompt.teaser">
    <button type="button" class="st-x" :aria-label="T.dismiss" :title="T.dismiss" @click.stop="emit('dismiss')">
      <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    </button>
    <button type="button" class="st-row st-msg" :aria-label="T.open" @click="emit('open')">
      <SupportMark :size="34" />
      <span class="st-text">
        <small>{{ T.from }}</small>
        <p>{{ prompt.teaser }}</p>
        <img v-if="prompt.image" class="st-img" :src="siteUrl(prompt.image)" alt="" />
      </span>
    </button>
  </template>

  <!-- the line itself, with its choices -->
  <template v-else>
    <button type="button" class="st-x" :aria-label="T.dismiss" :title="T.dismiss" @click="emit('dismiss')">
      <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    </button>
    <div class="st-row">
      <SupportMark :size="34" />
      <div class="st-text">
        <small>{{ T.from }}</small>
        <p>{{ prompt.text }}</p>
        <img v-if="prompt.image" class="st-img" :src="siteUrl(prompt.image)" alt="" />
      </div>
    </div>
    <div v-if="prompt.choices && prompt.choices.length" class="st-choices">
      <button v-for="(c, i) in prompt.choices" :key="c.key" type="button" class="st-choice" :style="{ '--i': i }" @click="emit('reply', c)">{{ c.text }}</button>
    </div>
    <div class="st-acts">
      <button type="button" class="st-reply" @click="emit('reply', null)">{{ T.reply }}</button>
      <button type="button" class="st-later" @click="emit('dismiss')">{{ T.dismiss }}</button>
    </div>
  </template>
  </div>
</template>

<style scoped>
.st { position: relative; width: min(340px, calc(100vw - 32px)); padding: 14px 14px 12px; border-radius: 18px;
  background: var(--paper); color: var(--ink); border: 1px solid var(--hair); box-shadow: 0 26px 60px -28px #000c, 0 1px 2px #0000000d }
/* the balloon's tail, toward the launcher under it */
.st::after { content: ''; position: absolute; right: 22px; bottom: -7px; width: 12px; height: 12px; background: var(--paper);
  border-right: 1px solid var(--hair); border-bottom: 1px solid var(--hair); transform: rotate(45deg); border-bottom-right-radius: 3px }
.st-x { position: absolute; top: 8px; right: 8px; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
  color: var(--ink3); background: none; border: 0; border-radius: 50%; cursor: pointer }
.st-x:hover { color: var(--ink) }
.st-row { display: flex; align-items: flex-start; gap: 12px; padding-right: 20px }
.st-text small { display: block; font-family: var(--m); font-size: 9.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); margin: 2px 0 3px }
.st-text p { margin: 0; font-size: 14.5px; line-height: 1.45 }
.st-img { display: block; width: 100%; height: auto; border-radius: 12px; margin-top: 8px }
/* on a phone the picture would fill the screen above the launcher: the card keeps the line alone, the picture waits inside the panel */
@media (max-width: 480px) { .st-img { display: none } }
.st-choices { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0 46px }
.st-choice { font: inherit; font-size: 13px; color: var(--ink); background: var(--paper); border: 1px solid var(--ink); border-radius: 999px; padding: 6px 12px; cursor: pointer; text-align: left }
.st-choice:hover { color: var(--paper); background: var(--ink) }
.st-acts { display: flex; gap: 6px; margin: 10px 0 0 46px }
.st-reply, .st-later { font: inherit; font-size: 13px; font-weight: 600; border-radius: 999px; padding: 7px 14px; cursor: pointer; border: 0 }
.st-reply { color: var(--paper); background: var(--ink) }
.st-later { color: var(--ink2); background: none; border: 1px solid var(--hair) }
.st-later:hover { color: var(--ink) }
/* the nudge: a message waiting, the whole card the way in */
.st-nudge { padding: 0; cursor: pointer; transition: transform .16s cubic-bezier(.2, .8, .2, 1), box-shadow .16s }
.st-nudge:hover { transform: translateY(-1px); box-shadow: 0 30px 60px -26px #000c, 0 1px 2px #0000000d }
.st-msg { display: flex; width: 100%; text-align: left; font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 14px 40px 14px 14px; border-radius: 18px }
.st-msg .st-text { display: block }
/* the card's own motion is the widget's (sw-card); the choices settle a beat after the line */
.st-choice, .st-reply, .st-later { transition: background .16s, color .16s, transform .16s cubic-bezier(.2, .8, .2, 1) }
.st-choice:active, .st-reply:active { transform: scale(.96) }
@media (prefers-reduced-motion: no-preference) { .st-choices .st-choice { animation: st-in .4s cubic-bezier(.2, .8, .2, 1) both; animation-delay: calc(.12s + var(--i, 0) * 45ms) } @keyframes st-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } } }
</style>

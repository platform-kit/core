<script setup>
import { md, mdBlock } from './md.js'
/*
 * Prose: a heading and a passage of markdown — the section for anything the others do not say: a
 * manifesto, a note, terms, a long answer. Set on a reading measure, left or centred.
 *
 * Slots for a look's skin: `head` and `body`.
 */
defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  body: { type: String, default: '' },        /* markdown */
  align: { type: String, default: 'left' },   /* left | center */
  measure: { type: String, default: 'reading' },   /* reading (66ch) | wide */
})
</script>

<template>
  <section class="lpsec lpprose">
    <div class="lpwrap lppr" :class="['lppr-' + align, 'lppr-' + measure]">
      <slot name="head" :eyebrow="eyebrow" :heading="heading" :md="md">
        <div v-if="eyebrow || heading" class="lppr-head lprv">
          <span v-if="eyebrow" class="lpeyebrow" v-html="md(eyebrow)"></span>
          <h2 v-if="heading" class="lps lpk" style="--k: .1s" v-html="md(heading)"></h2>
        </div>
      </slot>
      <slot name="body" :body="body">
        <div v-if="body" class="lppr-body lprv lpd1" v-html="mdBlock(body)"></div>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lppr-reading { max-width: 760px }
.lppr-center { text-align: center; margin-left: auto; margin-right: auto } .lppr-center .lpeyebrow { justify-content: center }
.lppr-head { margin-bottom: 26px }
.lppr-body { font-size: 18px; line-height: 1.65; color: var(--ink2) }
.lppr-body :deep(p) { margin: 0 0 18px } .lppr-body :deep(p:last-child) { margin: 0 }
.lppr-body :deep(h3) { font-size: 22px; margin: 30px 0 10px; color: var(--ink) } .lppr-body :deep(h4) { font-size: 18px; margin: 24px 0 8px; color: var(--ink) }
.lppr-body :deep(strong) { color: var(--ink) } .lppr-body :deep(a) { color: var(--accent2) }
.lppr-body :deep(ul), .lppr-body :deep(ol) { padding-left: 1.3em; margin: 0 0 18px }
.lppr-body :deep(li) { margin: 6px 0 }
.lppr-body :deep(blockquote) { margin: 22px 0; padding: 4px 0 4px 20px; border-left: 3px solid var(--accent); font-family: var(--fd); font-size: 21px; color: var(--ink) }
.lppr-body :deep(hr) { border: 0; border-top: 1px solid var(--hair); margin: 30px 0 }
.lppr-body :deep(img) { max-width: 100%; border-radius: 12px }
.lppr-center .lppr-body :deep(ul), .lppr-center .lppr-body :deep(ol) { text-align: left }
</style>

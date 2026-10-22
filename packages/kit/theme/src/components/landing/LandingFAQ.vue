<script setup>
import { ref } from 'vue'
import { md, mdBlock } from './md.js'
import SectionHead from './SectionHead.vue'
import Avatars from './Avatars.vue'
/*
 * FAQ: questions that open to their answers, one at a time — a <details> each, so it works with
 * no script and reads to a screen reader as what it is; opening one closes the others. Or, laid
 * open: two columns of question and answer with nothing to press. The words beside the list, above
 * it, or beside a picture; and under it all, when the page says so, the "still have questions?"
 * card with its button. Answers are markdown.
 *
 * Slots for a look's skin: `head`, `questions`, `more`.
 */
defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  items: { type: Array, default: () => [] },   /* [{ question, answer }] */
  layout: { type: String, default: 'beside' }, /* beside | stacked | columns | picture | icons | gallery */
  prefix: { type: String, default: '' },       /* a mark before each question: "Q." */
  image: { type: String, default: '' }, alt: { type: String, default: '' },
  more: { type: Object, default: () => ({}) }, /* { heading, body, cta, href, faces: [{ image, name }] } */
})
const open = ref(-1)
function toggle(i, e) { open.value = e.target.open ? i : open.value === i ? -1 : open.value }
</script>

<template>
  <section class="lpsec lpfaq" :class="'lpfaq-' + layout">
    <div class="lpwrap lpfq" :class="{ 'lpfq-two': layout === 'beside' || layout === 'picture' }">
      <div class="lpfq-side">
        <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead"><SectionHead class="lpfq-head" :eyebrow="eyebrow" :heading="heading" :lead="lead" :center="layout === 'stacked' || layout === 'columns'" /></slot>
        <figure v-if="layout === 'picture' && image" class="lpcard lpfq-fig lprv"><img :src="image" :alt="alt || ''" loading="lazy" decoding="async" /></figure>
        <!-- the gallery: the open question's own picture, or the section's -->
        <figure v-if="layout === 'gallery'" class="lpcard lpfq-fig lpfq-gal lprv" :key="open"><img :src="(open >= 0 && items[open] && items[open].image) || image" :alt="alt || ''" loading="lazy" decoding="async" /></figure>
      </div>
      <slot name="questions" :items="items" :md="md">
        <!-- laid open, two columns; icons: with a ? mark before each -->
        <dl v-if="items.length && (layout === 'columns' || layout === 'icons')" class="lpfq-cols lprv lpd1" :class="{ 'lpfq-iconed': layout === 'icons' }">
          <div v-for="(q, i) in items" :key="i" class="lpk" :style="{ '--k': (0.1 + i * 0.06) + 's' }"><span v-if="layout === 'icons'" class="lpfq-q-ico" aria-hidden="true">?</span><div><dt><i v-if="prefix" class="lpfq-pre">{{ prefix }}</i><span v-html="md(q.question)"></span></dt><dd v-html="mdBlock(q.answer)"></dd></div></div>
        </dl>
        <div v-else-if="items.length" class="lpfq-list lprv lpd1">
          <details v-for="(q, i) in items" :key="i" class="lpfq-q" :open="open === i" @toggle="toggle(i, $event)">
            <summary><span><i v-if="prefix" class="lpfq-pre">{{ prefix }}</i><span v-html="md(q.question)"></span></span><i class="lpfq-plus" aria-hidden="true"></i></summary>
            <div class="lpfq-a" v-html="mdBlock(q.answer)"></div>
          </details>
        </div>
      </slot>
      <slot name="more" :more="more" :md="md">
        <div v-if="more.heading || more.cta" class="lpcard lpfq-more lprv lpd2" :class="{ 'lpfq-more-c': more.faces && more.faces.length }">
          <Avatars v-if="more.faces && more.faces.length" :items="more.faces" :size="44" class="lpfq-faces" />
          <div><h4 v-if="more.heading" v-html="md(more.heading)"></h4><p v-if="more.body" v-html="md(more.body)"></p></div>
          <a v-if="more.cta" :href="more.href || '#'" class="lpbtn text-white"><span v-html="md(more.cta)"></span></a>
        </div>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lpfq-two { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: 56px; align-items: start }
.lpfaq-gallery .lpfq { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 56px; align-items: start }
.lpfq-two .lpfq-head { margin-bottom: 0; position: sticky; top: 96px }
.lpfaq-picture .lpfq-side { position: sticky; top: 96px } .lpfaq-picture .lpfq-head { position: static; margin-bottom: 22px }
.lpfq-fig { margin: 0; overflow: hidden } .lpfq-fig img { display: block; width: 100%; height: auto }
.lpfaq-stacked .lpfq-list, .lpfaq-columns .lpfq-cols { max-width: 900px; margin: 0 auto }
.lpfaq-stacked .lpfq-list { max-width: 760px }
.lpfq-list { display: flex; flex-direction: column; border-top: 1px solid var(--hair) }
.lpfq-q { border-bottom: 1px solid var(--hair) }
.lpfq-q summary { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 20px 2px; cursor: pointer; list-style: none; font-size: 17.5px; font-weight: 600; letter-spacing: -.01em; color: var(--ink); transition: color .15s }
.lpfq-q summary::-webkit-details-marker { display: none }
.lpfq-q summary:hover { color: var(--accent2) }
.lpfq-plus { position: relative; flex: none; width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--hair); background: var(--card); transition: transform .3s cubic-bezier(.2,.8,.2,1), background .2s }
.lpfq-plus::before, .lpfq-plus::after { content: ''; position: absolute; left: 50%; top: 50%; width: 10px; height: 1.5px; background: currentColor; transform: translate(-50%, -50%) }
.lpfq-plus::after { transform: translate(-50%, -50%) rotate(90deg) }
.lpfq-q[open] .lpfq-plus { transform: rotate(45deg); background: var(--accentbg); border-color: transparent; color: var(--accent2) }
.lpfq-a { padding: 0 44px 22px 2px; font-size: 16px; line-height: 1.6; color: var(--ink2); animation: lpfq-in .3s ease }
@keyframes lpfq-in { from { opacity: 0; transform: translateY(-4px) } }
.lpfq-a :deep(p), .lpfq-cols dd :deep(p) { margin: 0 0 12px } .lpfq-a :deep(p:last-child), .lpfq-cols dd :deep(p:last-child) { margin: 0 }
.lpfq-a :deep(a), .lpfq-cols dd :deep(a) { color: var(--accent2) }
/* laid open */
.lpfq-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 36px 48px; margin: 0 }
.lpfq-cols dt { font-size: 17.5px; font-weight: 600; letter-spacing: -.01em; margin-bottom: 8px }
.lpfq-cols dd { margin: 0; font-size: 15.5px; line-height: 1.6; color: var(--ink2) }
.lpfq-pre { font-style: normal; color: var(--accent2); margin-right: 8px }
.lpfaq-gallery .lpfq-side { position: sticky; top: 96px } .lpfaq-gallery .lpfq-head { position: static; margin-bottom: 22px }
.lpfq-gal { animation: lpfq-in .35s ease }
.lpfq-iconed > div { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 12px }
.lpfq-q-ico { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; font-family: var(--fd); font-weight: 600; font-size: 15px; color: var(--accent2); background: var(--accentbg) }
/* still have questions? */
.lpfq-more { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 26px 30px; margin-top: 28px }
.lpfaq-stacked .lpfq-more, .lpfaq-columns .lpfq-more { max-width: 900px; margin-left: auto; margin-right: auto }
.lpfq-more h4 { font-size: 20px; margin-bottom: 4px } .lpfq-more p { margin: 0; font-size: 15px; color: var(--ink2) }
.lpfq-more-c { flex-direction: column; align-items: center; text-align: center; gap: 14px; padding: 36px 30px }
@media (max-width: 980px) { .lpfq-two { grid-template-columns: 1fr; gap: 24px } .lpfq-two .lpfq-head, .lpfaq-picture .lpfq-side { position: static; margin-bottom: 8px } .lpfq-cols { grid-template-columns: 1fr; gap: 26px } }
@media (max-width: 600px) { .lpfq-more { flex-direction: column; align-items: flex-start } }
</style>

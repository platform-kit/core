<script setup>
import { md, mdBlock } from './md.js'
import SectionHead from './SectionHead.vue'
/*
 * Timeline: dated milestones — a history, a changelog, a roadmap — each a date (as written:
 * "2019", "March", "Q3", "Soon"), a title, a passage and, when it has them, ticked points; down
 * the page on one line with a dot (an item still to come drawn hollow), or as columns — a phase
 * each, side by side, the roadmap's way.
 *
 * Slots for a look's skin: `head` and `items`.
 */
defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  layout: { type: String, default: 'list' },   /* list | columns */
  items: { type: Array, default: () => [] },   /* [{ date, title, body?, points?, upcoming?, percent? }] */
})
</script>

<template>
  <section class="lpsec lptimeline" :class="'lptimeline-' + layout">
    <div class="lpwrap">
      <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead"><SectionHead :eyebrow="eyebrow" :heading="heading" :lead="lead" :center="layout === 'columns'" /></slot>
      <slot name="items" :items="items" :md="md">
        <!-- columns: a phase each -->
        <ol v-if="layout === 'columns' && items.length" class="lptl-cols lprv" :style="{ '--n': items.length }">
          <li v-for="(it, i) in items" :key="i" class="lpcard lptl-col lpk" :class="{ 'lptl-soon': it.upcoming }" :style="{ '--k': (0.1 + i * 0.1) + 's' }">
            <span class="lptl-phase"><i class="lptl-dot"></i><span class="lptl-date lpnum" v-html="md(it.date)"></span></span>
            <h4 v-html="md(it.title)"></h4>
            <div v-if="it.body" class="lptl-text" v-html="mdBlock(it.body)"></div>
            <ul v-if="it.points && it.points.length" class="lptl-points"><li v-for="(p, j) in it.points" :key="j"><svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg><span v-html="md(p)"></span></li></ul>
          </li>
        </ol>
        <!-- down the page -->
        <ol v-else-if="items.length" class="lptl">
          <li v-for="(it, i) in items" :key="i" class="lptl-it lprv" :class="{ 'lptl-soon': it.upcoming }">
            <span class="lptl-date lpnum" :class="{ 'lptl-pct': it.percent != null && it.percent !== '' }" v-html="md(it.percent != null && it.percent !== '' ? it.percent + '%' : it.date)"></span>
            <span class="lptl-dot" aria-hidden="true"></span>
            <div class="lptl-body">
              <h4 v-html="md(it.title)"></h4>
              <div v-if="it.body" class="lptl-text" v-html="mdBlock(it.body)"></div>
              <ul v-if="it.points && it.points.length" class="lptl-points"><li v-for="(p, j) in it.points" :key="j"><svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg><span v-html="md(p)"></span></li></ul>
            </div>
          </li>
        </ol>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lptl { list-style: none; margin: 0; padding: 0; max-width: 820px; position: relative }
.lptl::before { content: ''; position: absolute; left: 139px; top: 8px; bottom: 8px; width: 1px; background: var(--hair) }
.lptl-it { display: grid; grid-template-columns: 120px 40px minmax(0, 1fr); gap: 0; padding: 0 0 36px; position: relative }
.lptl-it:last-child { padding-bottom: 0 }
.lptl-date { font-family: var(--m); font-size: 11.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); padding-top: 5px; text-align: right; padding-right: 8px }
.lptl-dot { display: block; width: 11px; height: 11px; border-radius: 50%; background: var(--accent); margin: 6px 0 0 14px; box-shadow: 0 0 0 4px var(--accentbg); flex: none }
.lptl-pct { font-family: var(--fd); font-size: 22px; font-weight: 600; color: var(--accent2); text-transform: none; letter-spacing: -.02em; padding-top: 0 }
.lptl-soon .lptl-dot { background: var(--paper); border: 2px solid var(--accent); width: 9px; height: 9px }
.lptl-soon .lptl-body, .lptl-soon.lptl-col { opacity: .78 }
.lptl h4 { font-size: 19px; letter-spacing: -.01em; margin-bottom: 6px }
.lptl-text { font-size: 15.5px; line-height: 1.55; color: var(--ink2) }
.lptl-text :deep(p) { margin: 0 0 10px } .lptl-text :deep(p:last-child) { margin: 0 }
.lptl-text :deep(a) { color: var(--accent2) }
.lptl-points { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px }
.lptl-points li { display: flex; gap: 8px; align-items: flex-start; font-size: 14.5px; line-height: 1.4; color: var(--ink2) }
.lptl-points svg { flex: none; color: var(--accent2); margin-top: 3px }
/* columns */
.lptl-cols { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(var(--n, 4), minmax(0, 1fr)); gap: 16px }
.lptl-col { display: flex; flex-direction: column; padding: 22px 22px 24px }
.lptl-phase { display: flex; align-items: center; gap: 10px; margin-bottom: 14px } .lptl-phase .lptl-dot { margin: 0 } .lptl-phase .lptl-date { padding: 0; text-align: left }
.lptl-col h4 { font-size: 18px }
@media (max-width: 980px) { .lptl-cols { grid-template-columns: repeat(2, minmax(0, 1fr)) } }
@media (max-width: 600px) { .lptl::before { left: 19px } .lptl-it { grid-template-columns: 40px minmax(0, 1fr); } .lptl-it .lptl-date { grid-column: 2; grid-row: 1; text-align: left; padding: 0 0 4px } .lptl-it .lptl-dot { grid-column: 1; grid-row: 1 / 3 } .lptl-body { grid-column: 2 } .lptl-cols { grid-template-columns: 1fr } }
</style>

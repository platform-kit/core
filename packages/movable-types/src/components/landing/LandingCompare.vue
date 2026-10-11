<script setup>
import { md } from './md.js'
import { us } from '@platform-kit/kit/lib/strings.js'
import SectionHead from './SectionHead.vue'
/*
 * Compare: a table — a column per plan or product, a row per thing, and in each cell a tick, a
 * cross or words ("yes" and "no" draw the marks; anything else is said as written). One column
 * may be marked, and each may end in a button. On a phone the table scrolls sideways under the
 * first column, which stays.
 *
 * Slots for a look's skin: `head` and `table`.
 */
defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  columns: { type: Array, default: () => [] },   /* [{ name, note?, featured?, cta?, href? }] */
  rows: { type: Array, default: () => [] },      /* [{ label, cells: ['yes' | 'no' | 'words'] }] */
})
const W = (us('sections').compare || {}).cell || {}
const YES = /^(yes|true|✓|✔|included)$/i, NO = /^(no|false|—|-|×|✗|not included)$/i
const kind = (c) => (c == null || c === '' ? 'blank' : YES.test(String(c).trim()) ? 'yes' : NO.test(String(c).trim()) ? 'no' : 'text')
</script>

<template>
  <section class="lpsec lpcompare">
    <div class="lpwrap">
      <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead"><SectionHead :eyebrow="eyebrow" :heading="heading" :lead="lead" center /></slot>
      <slot name="table" :columns="columns" :rows="rows" :md="md">
        <div v-if="columns.length" class="lpcp-scroll lprv">
          <table class="lpcp">
            <thead>
              <tr>
                <th class="lpcp-first"></th>
                <th v-for="(c, i) in columns" :key="i" :class="{ 'lpcp-feat': c.featured }">
                  <b v-html="md(c.name)"></b><span v-if="c.note" v-html="md(c.note)"></span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="i">
                <th class="lpcp-first" scope="row" v-html="md(r.label)"></th>
                <td v-for="(c, j) in columns" :key="j" :class="{ 'lpcp-feat': c.featured }">
                  <span v-if="kind((r.cells || [])[j]) === 'yes'" class="lpcp-yes" :title="W.yes"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg><i class="lpcp-sr">{{ W.yes }}</i></span>
                  <span v-else-if="kind((r.cells || [])[j]) === 'no'" class="lpcp-no" :title="W.no"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 10h10" /></svg><i class="lpcp-sr">{{ W.no }}</i></span>
                  <span v-else-if="kind((r.cells || [])[j]) === 'text'" class="lpcp-text" v-html="md((r.cells || [])[j])"></span>
                </td>
              </tr>
            </tbody>
            <tfoot v-if="columns.some((c) => c.cta)">
              <tr>
                <td class="lpcp-first"></td>
                <td v-for="(c, i) in columns" :key="i" :class="{ 'lpcp-feat': c.featured }"><a v-if="c.cta" :href="c.href || '#'" class="lpbtn text-white lpcp-cta" :class="{ 'lpcp-quiet': !c.featured }"><span v-html="md(c.cta)"></span></a></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lpcp-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; border-radius: 16px }
.lpcp { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 15px; min-width: 560px }
.lpcp th, .lpcp td { padding: 14px 16px; text-align: center; border-bottom: 1px solid var(--hair); vertical-align: middle; background: transparent; font: inherit; text-transform: none; letter-spacing: 0; color: var(--ink) }
.lpcp thead th { padding-top: 18px; padding-bottom: 18px; border-bottom: 1px solid var(--hair2, var(--hair)) }
.lpcp thead th b { display: block; font-family: var(--fd); font-size: 19px; font-weight: 600; letter-spacing: -.01em }
.lpcp thead th span { display: block; font-size: 13px; color: var(--ink3); margin-top: 3px; font-weight: 400 }
.lpcp-first { text-align: left !important; font-weight: 500; color: var(--ink); min-width: 180px; font-size: 15.5px }
.lpcp tbody tr:last-child td, .lpcp tbody tr:last-child th { border-bottom: 0 }
.lpcp tfoot td { border-bottom: 0; padding-top: 18px }
.lpcp-feat { background: color-mix(in srgb, var(--accentbg) 60%, transparent) }
.lpcp thead .lpcp-feat { border-radius: 14px 14px 0 0; box-shadow: inset 0 2px 0 var(--accent) }
.lpcp tfoot .lpcp-feat { border-radius: 0 0 14px 14px }
.lpcp-yes { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; color: var(--accent2); background: var(--accentbg) }
.lpcp-no { display: inline-grid; place-items: center; color: var(--ink3); opacity: .6 }
.lpcp-text { color: var(--ink2) }
.lpcp-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0) }
.lpcp-cta { padding: 10px 20px; font-size: 14px }
.lpcp a.lpbtn.lpcp-quiet { background: transparent; color: var(--ink); border: 1px solid var(--hair) }
.lpcp a.lpbtn.lpcp-quiet:hover { border-color: var(--ink3) }
@media (max-width: 720px) { .lpcp { min-width: 0 } .lpcp th, .lpcp td { padding: 12px 8px; font-size: 14px } .lpcp-first { position: sticky; left: 0; background: var(--paper); z-index: 1; min-width: 120px; max-width: 150px; font-size: 14px } .lpcp thead th b { font-size: 16px } }
</style>

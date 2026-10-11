<script setup>
import { ref, computed, watch } from 'vue'
import { md } from './md.js'
import { withBooker } from '@platform-kit/kit/lib/booking.js'
import { products as PRODUCTS } from '#content'
import { us } from '@platform-kit/kit/lib/content.js'
import { isSignedIn, plan, planKey, planNextKey, planNextAt, refreshEntitlements } from '@platform-kit/kit/lib/auth.js'
import { subscribe, checkout, openPortal } from '@platform-kit/kit/lib/commerce.js'
import { toast } from '@platform-kit/kit/lib/toast.js'
import { glyph } from './icons.js'
/*
 * Pricing: the value ladder. Every rung is the page's own words — a name, a
 * price and its period as written, a line, the features, a button — and the
 * page says how they sit: rungs run together as columns, and a rung marked
 * `wide` is a band across the whole row (the free tier above the memberships,
 * a one-off session below them), so five things of three kinds do not have to
 * share one grid. The columns between two bands are one row, however many.
 * A page may also put a toggle over the rungs — `filter`, its options each a
 * tag and a label — and tag its rungs; the toggle shows the rungs tagged with
 * the chosen option (weekly and monthly prices, say), and a rung with no tags
 * shows under every option. Nothing here knows what the tags mean.
 *
 * Layouts: columns (the rungs side by side, a band where marked); rows (every rung a band); single
 * (one rung, centred and narrow — "one price"). The featured rung is outlined, or drawn in ink
 * or the accent (`featuredTone`). Under the rungs, `compare` draws the plans-by-features table —
 * a column per rung, a row per thing, a tick, a cross or words in each cell — when the page has one.
 *
 * A rung with a `sku` BUYS: its button starts checkout for that offer (a product
 * file's sku) straight from this page — the store need not be on — asking for a
 * sign-in first when there is none and carrying on once it lands. A rung without
 * one links to its `href`.
 *
 * Slots for a look's skin (src/lib/look.js): `head` and `tiers`.
 */
const props = defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  tiers: { type: Array, default: () => [] },   /* [{ name, price, per, tagline, features: [], cta, href, featured }] */
  fine: { type: String, default: '' },
  layout: { type: String, default: 'columns' },       /* columns | rows | single | choice | selector */
  /* choice: the rungs as a list of radio rows and one button; selector: the rungs as options that add up to a total */
  selectorLabel: { type: String, default: '' },      /* the word before the total */
  featuredTone: { type: String, default: 'outline' }, /* outline | ink | accent */
  compare: { type: Object, default: () => ({}) },     /* { heading, rows: [{ label, cells: ['yes' | 'no' | 'words'] }] } */
  featuredLabel: { type: String, default: '' },   /* the word on the featured rung's flag, e.g. "Most popular" */
  filter: { type: Object, default: () => ({}) },  /* { label, default, options: [{ tag, label }] } */
  /* a subscriber's rungs: the one they are on, and the others as a switch */
  ctaCurrent: { type: String, default: '' },
  ctaSwitch: { type: String, default: '' },
  switched: { type: String, default: '' },        /* the toast after a switch; {name} */
  /* a step down waits for the period end: the rung it goes to, and what is said */
  ctaPending: { type: String, default: '' },      /* the button on that rung; {date} */
  switchedLater: { type: String, default: '' },   /* the toast after a step down; {name}, {date} */
  kept: { type: String, default: '' },            /* the toast after calling a step down off; {name} */
})
const when = (iso) => { try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' }).format(new Date(iso)) } catch (e) { return '' } }
const options = computed(() => ((props.filter && props.filter.options) || []).filter((o) => o && o.tag && o.label))
const toggled = computed(() => options.value.length >= 2)
const active = ref((props.filter && props.filter.default) || (options.value[0] && options.value[0].tag) || '')
const shown = (t) => !toggled.value || !Array.isArray(t.tags) || !t.tags.length || t.tags.includes(active.value)
/* a feature line written "- Priority support" is one the rung lacks: drawn crossed */
const featLines = (t) => (t.features || []).map((f) => (/^-\s+/.test(f) ? { text: f.replace(/^-\s+/, ''), off: true } : { text: f, off: false }))
const chosen = ref(0)
const ticked = ref({})
const selTotal = computed(() => rows.value.reduce((n, t, i) => n + (ticked.value[i] ? Number(String(t.price || '').replace(/[^\d.]/g, '')) || 0 : 0), 0))
const rows = computed(() => props.tiers.map((t) => {
  const offer = t.sku ? PRODUCTS.find((p) => p.sku === t.sku) : null
  const subscription = !!offer && offer.billing === 'subscription'
  /* a rung is the reader's by the offer's key, so a renamed sku still finds its subscriber */
  const current = subscription && !!planKey.value && planKey.value === offer.key
  const pending = subscription && !!planNextKey.value && planNextKey.value === offer.key && !current
  const switching = subscription && !!plan.value && !current && !pending
  /* A TRIAL IS SAID ON THE PAGE, not discovered at Stripe's. Somebody deciding whether to
     subscribe should know the first days are free before they press, and the only place that can
     say so is here — Stripe's own page is the one after the decision. */
  const trialDays = Number(offer && offer.trial) || 0
  return { ...t, priceText: t.price || '', perText: t.per || '', link: withBooker(t.href || ''), buys: !!offer, current, pending, switching, trialDays,
    label: current ? (props.ctaCurrent || t.cta) : pending ? (props.ctaPending || t.cta).replace('{date}', when(planNextAt.value)) : switching ? (props.ctaSwitch || t.cta) : t.cta }
}))

/* buying from the page: sign in first when there is none, then the offer's own
   checkout — a subscription through subscription mode, anything else as one line */
const SW = (us('store').page || {}).head || {}
const busy = ref('')
let pending = ''
async function buy(t) {
  if (!t.buys || busy.value) return
  if (!isSignedIn.value) { pending = t.sku; if (window.DLauth) window.DLauth.open({ intent: 'buy' }); return }
  const offer = PRODUCTS.find((p) => p.sku === t.sku)
  busy.value = t.sku
  try {
    /* the plan they are on: its button opens the portal (cancel, cards, invoices) */
    if (t.current) { await openPortal(); return }
    if (offer.billing === 'subscription') {
      /* the rung a step down is waiting for: pressing it again calls the step down off (their own plan, asked for again) */
      const own = PRODUCTS.find((p) => p.key === planKey.value)
      const d = await subscribe(t.pending ? (own ? own.sku : plan.value) : t.sku)
      if (d && d.switched) {
        await refreshEntitlements().catch(() => {})
        const ownRow = rows.value.find((r) => r.current)
        const title = d.kept ? (props.kept || '').replace('{name}', ownRow ? ownRow.name : '') : d.at ? (props.switchedLater || '').replace('{name}', t.name).replace('{date}', when(d.at)) : (props.switched || '').replace('{name}', t.name)
        toast({ kind: 'ok', title, body: '', dismiss: SW.dismiss || '' })
      }
    } else await checkout([{ sku: t.sku, quantity: 1 }])
  }
  catch (e) {
    const off = e && e.code === 'stripe_unconfigured'
    toast({ kind: 'warn', title: off ? SW['unconfigured-heading'] : SW['error-heading'], body: off ? SW['unconfigured-subtitle'] : (e && e.message) || '', dismiss: SW.dismiss || '' })
  } finally { busy.value = '' }
}
watch(isSignedIn, (on) => { if (on && pending) { const t = rows.value.find((r) => r.sku === pending); pending = ''; if (t) buy(t) } })
/* the rungs in the order written, grouped: a band stands alone, columns between bands share a row */
const groups = computed(() => {
  const out = []
  let run = null
  rows.value.forEach((t, i) => {
    if (!shown(t)) return
    if (t.wide || props.layout === 'rows') { run = null; out.push({ kind: 'band', tiers: [{ ...t, i }] }) }
    else { if (!run) { run = { kind: 'row', tiers: [] }; out.push(run) } run.tiers.push({ ...t, i }) }
  })
  return out
})
/* the compare table: a column per rung shown as a column */
const compareCols = computed(() => rows.value.filter((t) => shown(t)))
const YES = /^(yes|true|✓|✔|included)$/i, NO = /^(no|false|—|-|×|✗|not included)$/i
const cell = (c) => (c == null || c === '' ? 'blank' : YES.test(String(c).trim()) ? 'yes' : NO.test(String(c).trim()) ? 'no' : 'text')
</script>

<template>
  <section class="lpsec lpr-sec" :class="['lpr-' + layout, 'lpr-ft-' + featuredTone]">
    <div class="lpwrap lpr" id="lppricing">
      <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead" :md="md">
      <div class="lpcol lprv lpr-head">
        <span v-if="eyebrow" class="lpeyebrow" v-html="md(eyebrow)"></span>
        <h2 class="lps lpk" style="--k: .12s" v-html="md(heading)"></h2>
        <p v-if="lead" class="lpr-lead lpk" style="--k: .28s" v-html="md(lead)"></p>
      </div>
      </slot>
      <!-- the toggle over the rungs, when the page gives it two or more options -->
      <div v-if="toggled" class="lpr-toggle lprv lpd1" role="tablist" :aria-label="filter.label || ''">
        <button v-for="o in options" :key="o.tag" type="button" role="tab" class="lpr-opt" :class="{ on: active === o.tag }" :aria-selected="active === o.tag" @click="active = o.tag">
          <span v-html="md(o.label)"></span>
        </button>
      </div>
      <slot name="tiers" :tiers="rows" :md="md">
      <!-- the choice: rungs as rows with a radio, one button for the chosen -->
      <div v-if="layout === 'choice'" class="lpr-picklist lprv lpd1">
        <label v-for="(t, i) in rows.filter(shown)" :key="t.i" class="lpr-opt-row" :class="{ on: chosen === i }">
          <input type="radio" name="lpr-choice" :checked="chosen === i" @change="chosen = i" />
          <span class="lpr-radio"></span>
          <span class="lpr-optw"><b v-html="md(t.name)"></b><span v-if="t.tagline" v-html="md(t.tagline)"></span></span>
          <span class="lpr-optp"><b v-html="md(t.priceText)"></b><i v-if="t.perText" v-html="md(t.perText)"></i></span>
          <span v-if="t.featured && featuredLabel" class="lpr-save" v-html="md(featuredLabel)"></span>
        </label>
        <template v-if="rows.filter(shown)[chosen]">
          <button v-if="rows.filter(shown)[chosen].buys" type="button" class="lpbtn text-white lpr-cta lpr-choicebtn" :disabled="!!busy" @click="buy(rows.filter(shown)[chosen])"><span v-html="md(rows.filter(shown)[chosen].label)"></span></button>
          <a v-else-if="rows.filter(shown)[chosen].cta" :href="rows.filter(shown)[chosen].link" class="lpbtn text-white lpr-cta lpr-choicebtn"><span v-html="md(rows.filter(shown)[chosen].cta)"></span></a>
        </template>
      </div>
      <!-- the selector: options ticked add up -->
      <div v-else-if="layout === 'selector'" class="lpr-sellist lprv lpd1">
        <p class="lpr-total"><span v-if="selectorLabel" v-html="md(selectorLabel)"></span><b class="lpnum">{{ money(Math.round(selTotal * 100), 'usd') }}</b></p>
        <label v-for="(t, i) in rows" :key="t.i" class="lpr-opt-row lpr-check" :class="{ on: ticked[i] }">
          <input type="checkbox" :checked="!!ticked[i]" @change="ticked = { ...ticked, [i]: $event.target.checked }" />
          <span class="lpr-box"></span>
          <span class="lpr-optw"><b v-html="md(t.name)"></b><span v-if="t.tagline" v-html="md(t.tagline)"></span></span>
          <span class="lpr-optp"><b v-html="md(t.priceText)"></b></span>
        </label>
        <a v-if="rows[0] && rows[0].cta" :href="rows[0].link" class="lpbtn text-white lpr-cta lpr-choicebtn"><span v-html="md(rows[0].cta)"></span></a>
      </div>
      <div v-else class="lpr-tiers lprv lpd1">
        <template v-for="(g, gi) in groups" :key="gi">
          <div v-if="g.kind === 'row'" class="lpr-row" :style="{ '--n': g.tiers.length }">
            <div v-for="t in g.tiers" :key="t.i" class="lpcard lpr-tier lpr-in" :class="{ 'lpr-featured': t.featured }">
              <span v-if="t.featured && featuredLabel" class="lpr-flag" v-html="md(featuredLabel)"></span>
              <span v-if="t.icon" class="lpr-ico" v-html="glyph(t.icon)"></span>
              <span class="lpr-name" v-html="md(t.name)"></span>
              <span class="lpr-price"><i v-if="t.from" class="lpr-from" v-html="md(t.from)"></i><b v-html="md(t.priceText)"></b><i v-if="t.perText" v-html="md(t.perText)"></i></span>
              <span v-if="t.trialDays && !t.current" class="lpr-trial">{{ (SW['trial-free'] || '').replace('{n}', t.trialDays) }}</span>
              <p v-if="t.tagline" class="lpr-tag" v-html="md(t.tagline)"></p>
              <ul v-if="t.features && t.features.length" class="lpr-feats">
                <li v-for="(f, j) in featLines(t)" :key="j" :class="{ 'lpr-off': f.off }" v-html="md(f.text)"></li>
              </ul>
              <button v-if="t.cta && t.buys" type="button" class="lpbtn text-white lpr-cta" :class="{ 'lpr-current': t.current, 'lpr-pending': t.pending, 'lpr-switch': t.switching }" :disabled="busy === t.sku" @click="buy(t)"><span v-html="md(t.label)"></span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5" /></svg>
              </button>
              <a v-else-if="t.cta" :href="t.link" class="lpbtn text-white lpr-cta"><span v-html="md(t.cta)"></span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5" /></svg>
              </a>
            </div>
          </div>
          <!-- a band: the same parts laid across the row — the price and the line
               on the left, the features in the middle, the button on the right -->
          <div v-else v-for="t in g.tiers" :key="'b' + t.i" class="lpcard lpr-tier lpr-band lpr-in" :class="{ 'lpr-featured': t.featured }">
            <div class="lpr-band-head">
              <span class="lpr-name" v-html="md(t.name)"></span>
              <span class="lpr-price"><b v-html="md(t.priceText)"></b><i v-if="t.perText" v-html="md(t.perText)"></i></span>
              <span v-if="t.trialDays && !t.current" class="lpr-trial">{{ (SW['trial-free'] || '').replace('{n}', t.trialDays) }}</span>
              <p v-if="t.tagline" class="lpr-tag" v-html="md(t.tagline)"></p>
            </div>
            <ul v-if="t.features && t.features.length" class="lpr-feats lpr-band-feats">
              <li v-for="(f, j) in t.features" :key="j" v-html="md(f)"></li>
            </ul>
            <button v-if="t.cta && t.buys" type="button" class="lpbtn text-white lpr-cta lpr-band-cta" :class="{ 'lpr-current': t.current, 'lpr-pending': t.pending, 'lpr-switch': t.switching }" :disabled="busy === t.sku" @click="buy(t)"><span v-html="md(t.label)"></span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5" /></svg>
            </button>
            <a v-else-if="t.cta" :href="t.link" class="lpbtn text-white lpr-cta lpr-band-cta"><span v-html="md(t.cta)"></span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5" /></svg>
            </a>
          </div>
        </template>
      </div>
      <p v-if="fine" class="lpr-fine lprv lpd2" v-html="md(fine)"></p>
      <!-- the plans by their features -->
      <div v-if="compare.rows && compare.rows.length && compareCols.length" class="lpr-compare lprv">
        <h3 v-if="compare.heading" class="lpr-cmph" v-html="md(compare.heading)"></h3>
        <div class="lpr-cmpscroll">
          <table class="lpr-cmp">
            <thead><tr><th class="lpr-cmpfirst"></th><th v-for="t in compareCols" :key="t.i" :class="{ 'lpr-cmpfeat': t.featured }"><b v-html="md(t.name)"></b><span v-if="t.priceText" v-html="md(t.priceText + (t.perText ? ' ' + t.perText : ''))"></span></th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in compare.rows" :key="i">
                <th class="lpr-cmpfirst" scope="row" v-html="md(r.label)"></th>
                <td v-for="(t, j) in compareCols" :key="j" :class="{ 'lpr-cmpfeat': t.featured }">
                  <span v-if="cell((r.cells || [])[j]) === 'yes'" class="lpr-yes"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg></span>
                  <span v-else-if="cell((r.cells || [])[j]) === 'no'" class="lpr-no"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 10h10" /></svg></span>
                  <span v-else-if="cell((r.cells || [])[j]) === 'text'" v-html="md((r.cells || [])[j])"></span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      </slot>
    </div>
  </section>
</template>

<style scoped>
/* a trial is a note under the price, not a second price: quiet, and it keeps the rung's rhythm */
.lpr-trial { display: block; margin-top: 2px; font-size: 13px; color: var(--ink3) }
.lpr-sec { padding: 96px 0 }
.lpr-head { max-width: none }
/* single: one rung, narrow and centred */
.lpr-single .lpr-row { grid-template-columns: minmax(0, 520px); justify-content: center }
.lpr-single .lpr-head, .lpr-single .lpr-fine { text-align: center; margin-left: auto; margin-right: auto } .lpr-single .lpeyebrow { justify-content: center }
.lpr-single .lpr-toggle { display: inline-flex; margin-left: 50%; transform: translateX(-50%) }
/* the featured rung in ink, or the accent */
[data-look] .lproot .lpr-ft-ink .lpr-featured, [data-look] .lproot .lpr-ft-accent .lpr-featured { outline: 0; border-color: transparent; color: var(--paper) }
[data-look] .lproot .lpr-ft-ink .lpr-featured { background: var(--ink) } [data-look] .lproot .lpr-ft-accent .lpr-featured { background: var(--accent2) }
.lpr-ft-ink .lpr-featured .lpr-feats li, .lpr-ft-accent .lpr-featured .lpr-feats li, .lpr-ft-ink .lpr-featured .lpr-price b, .lpr-ft-accent .lpr-featured .lpr-price b { color: var(--paper) }
.lpr-ft-ink .lpr-featured .lpr-tag, .lpr-ft-accent .lpr-featured .lpr-tag, .lpr-ft-ink .lpr-featured .lpr-price i, .lpr-ft-accent .lpr-featured .lpr-price i { color: color-mix(in srgb, var(--paper) 75%, transparent) }
.lpr-ft-ink .lpr-featured .lpr-feats, .lpr-ft-accent .lpr-featured .lpr-feats { border-top-color: color-mix(in srgb, var(--paper) 18%, transparent) }
.lpr-ft-ink .lpr-featured .lpr-name, .lpr-ft-ink .lpr-featured .lpr-feats li::before { color: color-mix(in srgb, var(--accent) 45%, var(--paper)); background-color: var(--accent) }
.lpr-ft-ink .lpr-featured .lpr-name { background: none } .lpr-ft-accent .lpr-featured .lpr-name { color: var(--paper) } .lpr-ft-accent .lpr-featured .lpr-feats li::before { background: var(--paper); box-shadow: none }
.lpr-ft-ink .lpr-featured .lpr-cta, .lpr-ft-accent .lpr-featured .lpr-cta { background: var(--paper); color: var(--ink) }
.lpr-ft-ink .lpr-flag { background: var(--accent) } .lpr-ft-accent .lpr-flag { background: var(--paper); color: var(--accent2) }
/* the compare table */
.lpr-compare { margin-top: 56px }
.lpr-cmph { font-size: 24px; letter-spacing: -.015em; margin-bottom: 18px }
.lpr-cmpscroll { overflow-x: auto }
.lpr-cmp { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 15px; min-width: 520px }
.lpr-cmp th, .lpr-cmp td { padding: 13px 16px; text-align: center; border-bottom: 1px solid var(--hair); vertical-align: middle; background: transparent; font: inherit; text-transform: none; letter-spacing: 0; color: var(--ink) }
.lpr-cmp thead th b { display: block; font-family: var(--fd); font-size: 17px; font-weight: 600 } .lpr-cmp thead th span { display: block; font-size: 12.5px; color: var(--ink3); margin-top: 2px }
.lpr-cmpfirst { text-align: left !important; font-weight: 500 }
.lpr-cmp .lpr-cmpfeat { background: color-mix(in srgb, var(--accentbg) 60%, transparent) }
.lpr-yes { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; color: var(--accent2); background: var(--accentbg) }
.lpr-no { display: inline-grid; place-items: center; color: var(--ink3); opacity: .6 }
.lpr-cmp tbody tr:last-child td, .lpr-cmp tbody tr:last-child th { border-bottom: 0 }
.lpr-lead { max-width: none; font-size: 18px; line-height: 1.55; color: var(--ink2); margin: 14px 0 0 }
.lpr-toggle { display: inline-flex; gap: 2px; margin-top: 28px; padding: 3px; border-radius: 999px; background: var(--wash); border: 1px solid var(--hair) }
.lpr-opt { font: inherit; font-size: 14px; font-weight: 600; color: var(--ink3); background: none; border: 0; border-radius: 999px; padding: 8px 18px; cursor: pointer;
  transition: color .12s, background .12s }
.lpr-opt:hover { color: var(--ink) }
.lpr-opt.on { color: var(--paper); background: var(--ink) }
.lpr-toggle + .lpr-tiers { margin-top: 24px }
.lpr-tiers { display: flex; flex-direction: column; gap: 20px; margin-top: 36px }
/* a row of columns: as many as the page put between two bands */
.lpr-row { display: grid; grid-template-columns: repeat(var(--n, 3), minmax(0, 1fr)); gap: 20px; align-items: stretch }
.lpr-tier { display: flex; flex-direction: column; padding: 28px 26px 26px; position: relative }
/* a rung arriving — on reveal, or when the toggle brings it — rises in */
.lpr-in { animation: lprin .38s cubic-bezier(.2, .8, .2, 1) both }
@keyframes lprin { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
@media (prefers-reduced-motion: reduce) { .lpr-in { animation: none } }
.lpr-featured { outline: 2px solid var(--accent); outline-offset: -1px }
.lpr-flag { position: absolute; top: -12px; left: 26px; font-family: var(--m); font-size: 10px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--paper); background: var(--accent); border-radius: 999px; padding: 5px 10px; line-height: 1 }
.lpr-name { font-family: var(--m); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--accent2) }
.lpr-price { display: flex; align-items: baseline; gap: 8px; margin-top: 14px }
.lpr-price b { font-family: var(--fd); font-weight: 600; font-size: 40px; letter-spacing: -.02em; line-height: 1; font-variant-numeric: tabular-nums }
.lpr-price i { font-style: normal; font-family: var(--m); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3) }
.lpr-tag { margin: 12px 0 0; font-size: 15.5px; line-height: 1.5; color: var(--ink2); max-width: none }
.lpr-feats { list-style: none; margin: 18px 0 0; padding: 18px 0 0; border-top: 1px solid var(--hair); display: flex; flex-direction: column; gap: 9px; flex: 1 }
.lpr-feats li { position: relative; padding-left: 22px; font-size: 15px; line-height: 1.45; color: var(--ink) }
.lpr-feats li::before { content: ''; position: absolute; left: 2px; top: .55em; width: 9px; height: 9px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px var(--accentbg) }
.lpr-feats li.lpr-off { color: var(--ink3); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--ink3) 60%, transparent) } .lpr-feats li.lpr-off::before { background: var(--hair); box-shadow: none }
.lpr-ico { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; color: var(--accent2); background: var(--accentbg); margin-bottom: 14px } .lpr-ico :deep(svg) { width: 20px; height: 20px }
.lpr-from { font-size: 12px !important; letter-spacing: .04em !important; text-transform: none !important; margin-right: 4px }
/* the choice and the selector */
.lpr-picklist, .lpr-sellist { display: flex; flex-direction: column; gap: 10px; max-width: 560px; margin: 36px auto 0 }
.lpr-opt-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; gap: 14px; align-items: center; padding: 14px 18px; border-radius: 14px; background: var(--card); border: 1.5px solid var(--hair); cursor: pointer; transition: border-color .15s, box-shadow .15s }
.lpr-opt-row.on { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent) }
.lpr-opt-row input { position: absolute; opacity: 0; width: 0; height: 0 }
.lpr-radio, .lpr-box { width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid var(--ink3); background: var(--paper); position: relative } .lpr-box { border-radius: 6px }
.lpr-opt-row.on .lpr-radio::after { content: ''; position: absolute; inset: 4px; border-radius: 50%; background: var(--accent) }
.lpr-opt-row.on .lpr-box { background: var(--accent); border-color: var(--accent) } .lpr-opt-row.on .lpr-box::after { content: ''; position: absolute; left: 6px; top: 2px; width: 5px; height: 10px; border: solid var(--paper); border-width: 0 2px 2px 0; transform: rotate(45deg) }
.lpr-optw { display: flex; flex-direction: column; gap: 2px } .lpr-optw b { font-size: 15.5px } .lpr-optw span { font-size: 13px; color: var(--ink3) }
.lpr-optp { display: flex; align-items: baseline; gap: 4px } .lpr-optp b { font-family: var(--fd); font-size: 20px; font-weight: 600 } .lpr-optp i { font-style: normal; font-size: 12px; color: var(--ink3) }
.lpr-save { font-family: var(--m); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent2); background: var(--accentbg); border-radius: 999px; padding: 4px 8px }
.lpr-choicebtn { align-self: center; margin-top: 14px }
.lpr-choice .lpr-head, .lpr-selector .lpr-head { text-align: center; margin-left: auto; margin-right: auto } .lpr-choice .lpeyebrow, .lpr-selector .lpeyebrow { justify-content: center }
.lpr-total { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 0 6px; padding: 0 4px; font-size: 14px; color: var(--ink3) } .lpr-total b { font-family: var(--fd); font-size: 36px; font-weight: 600; color: var(--accent2); letter-spacing: -.02em }
.lpr-cta { margin-top: 24px; align-self: flex-start; cursor: pointer; font: inherit }
.lpr-cta:disabled { opacity: .6; cursor: default }
/* the plan they are on: a quiet button in the accent, that opens the portal; a switch reads as the offer it is */
[data-look] .lproot .lpr-cta.lpr-current { background: color-mix(in srgb, var(--accent, #d9433d) 14%, transparent); color: var(--ink); border: 1.5px solid var(--accent, #d9433d) }
[data-look] .lproot .lpr-cta.lpr-current:hover { background: color-mix(in srgb, var(--accent, #d9433d) 24%, transparent) }
.lpr-cta.lpr-switch { background: color-mix(in srgb, var(--ink) 82%, var(--accent, #d9433d)) }
/* the rung a step down is waiting for: outlined, dashed — theirs from the date it says */
[data-look] .lproot .lpr-cta.lpr-pending { background: transparent; color: var(--ink); border: 1.5px dashed var(--accent, #d9433d) }
[data-look] .lproot .lpr-cta.lpr-pending:hover { background: color-mix(in srgb, var(--accent, #d9433d) 10%, transparent) }
/* a band: head · features · button across the row */
.lpr-band { display: grid; grid-template-columns: minmax(200px, .8fr) minmax(0, 2fr) auto; align-items: center; gap: 12px 36px; padding: 26px 30px }
.lpr-band-head .lpr-price { margin-top: 10px }
.lpr-band-head .lpr-price b { font-size: 34px }
.lpr-band-head .lpr-tag { margin-top: 8px; font-size: 14.5px }
.lpr-band-feats { margin: 0; padding: 0 0 0 32px; border-top: 0; border-left: 1px solid var(--hair); display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 22px; flex: none; align-self: stretch; align-content: center }
.lpr-band-feats li { font-size: 14.5px }
.lpr-band-cta { margin-top: 0; align-self: center }
.lpr-fine { margin: 20px 0 0; max-width: none; font-size: 13.5px; color: var(--ink3) }
@media (max-width: 1080px) { .lpr-band { grid-template-columns: minmax(200px, 1fr) minmax(0, 1.4fr); } .lpr-band-cta { grid-column: 1 / -1; justify-self: start } }
@media (max-width: 900px) { .lpr-row { grid-template-columns: 1fr } .lpr-band { grid-template-columns: 1fr; gap: 16px; padding: 26px } .lpr-band-feats { padding: 16px 0 0; border-left: 0; border-top: 1px solid var(--hair); grid-template-columns: 1fr } }
</style>

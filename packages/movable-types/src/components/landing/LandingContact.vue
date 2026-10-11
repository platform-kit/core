<script setup>
import { moduleOn } from '@platform-kit/kit/lib/modules.js'
import { computed, defineAsyncComponent } from 'vue'
import { md } from './md.js'
import { glyph } from './icons.js'
import { forms as FORMS } from '#content'
import { modules } from '#site'
import SectionHead from './SectionHead.vue'
/*
 * Contact: where and how to reach the site — an address, an email, a phone, hours, a link to the
 * map — and beside them one of the site's forms (the forms module's runner, chosen by slug in the
 * builder; with the module off, or no form named, the details stand alone).
 *
 * Slots for a look's skin: `head`, `details` and `form`.
 */
const FormRun = moduleOn('forms') ? defineAsyncComponent(() => import('../forms/FormRun.vue')) : null
const props = defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  address: { type: String, default: '' },     /* markdown; a line break per line */
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  hours: { type: String, default: '' },
  map: { type: String, default: '' },         /* a link to the map */
  mapLabel: { type: String, default: '' },
  form: { type: String, default: '' },
  layout: { type: String, default: 'beside' },   /* beside | card | cards | quote */
  quote: { type: Object, default: () => ({}) },  /* { text, name, role, image } — the quote layout */
})
const form = computed(() => (FormRun && (FORMS || []).find((f) => f.slug === props.form && f.published !== false)) || null)
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])   /* an address is text, never marked down: marked would link it inside the link */
const rows = computed(() => [
  props.address && { icon: 'map', html: md(props.address).replace(/\n/g, '<br>'), href: props.map || '' },
  props.email && { icon: 'mail', html: esc(props.email), href: 'mailto:' + props.email },
  props.phone && { icon: 'chat', html: esc(props.phone), href: 'tel:' + props.phone.replace(/[^\d+]/g, '') },
  props.hours && { icon: 'clock', html: md(props.hours).replace(/\n/g, '<br>') },
].filter(Boolean))
</script>

<template>
  <section class="lpsec lpcontact">
    <div class="lpwrap lpct" :class="['lpct-' + layout, { 'lpct-two': !!form && layout !== 'cards' }]">
      <!-- the info as cards above the form -->
      <ul v-if="layout === 'cards' && rows.length" class="lpct-infocards lprv">
        <li v-for="(r, i) in rows" :key="i" class="lpcard lpk" :style="{ '--k': (0.05 + i * 0.08) + 's' }"><span class="lpct-ico" v-html="glyph(r.icon)"></span><component :is="r.href ? 'a' : 'span'" :href="r.href || undefined" v-html="r.html"></component></li>
      </ul>
      <div class="lpct-left">
        <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead"><SectionHead :eyebrow="eyebrow" :heading="heading" :lead="lead" :center="layout === 'cards'" /></slot>
        <figure v-if="layout === 'quote' && quote.text" class="lpct-quotecard lprv lpd1">
          <blockquote v-html="md(quote.text)"></blockquote>
          <figcaption><img v-if="quote.image" :src="quote.image" alt="" loading="lazy" /><span><b v-if="quote.name" v-html="md(quote.name)"></b><i v-if="quote.role" v-html="md(quote.role)"></i></span></figcaption>
        </figure>
        <slot name="details" :rows="rows" :map="map" :md="md">
          <ul v-if="rows.length && layout !== 'cards' && layout !== 'quote'" class="lpct-rows lprv lpd1">
            <li v-for="(r, i) in rows" :key="i" class="lpk" :style="{ '--k': (0.1 + i * 0.1) + 's' }">
              <span class="lpct-ico" v-html="glyph(r.icon)"></span>
              <component :is="r.href ? 'a' : 'span'" :href="r.href || undefined" v-html="r.html"></component>
            </li>
          </ul>
          <a v-if="map && mapLabel" :href="map" class="lpct-map lprv lpd2" target="_blank" rel="noopener"><span v-html="md(mapLabel)"></span><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5" /></svg></a>
        </slot>
      </div>
      <slot name="form" :form="form">
        <div v-if="form" class="lpct-form lprv lpd1" :class="{ lpcard: layout === 'card' || layout === 'cards' || layout === 'quote', 'lpct-formcard': layout !== 'beside' }"><FormRun :form="form" embed /></div>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lpct-two { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 56px; align-items: start }
.lpct-left :deep(.lpshead) { margin-bottom: 26px }
.lpct-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 16px; max-width: 460px }
.lpct-rows li { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 14px; align-items: start; font-size: 16px; line-height: 1.5; color: var(--ink) }
.lpct-rows a { color: inherit; text-decoration: none; border-bottom: 0 } .lpct-rows a:hover { color: var(--accent2) }
.lpct-ico { display: inline-grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; color: var(--accent2); background: var(--accentbg) }
.lpct-ico :deep(svg) { width: 18px; height: 18px }
.lpct-map { display: inline-flex; align-items: center; gap: 8px; margin-top: 22px; font-size: 14.5px; font-weight: 600; color: var(--accent2); text-decoration: none }
.lpct-form { min-width: 0 }
.lpct-form :deep(.frun) { min-height: 0 }
.lpct-formcard { padding: 10px 10px 14px }
.lpct-cards .lpct-formcard, .lpct-infocards { max-width: 760px; margin-left: auto; margin-right: auto }
.lpct-infocards { list-style: none; padding: 0; margin: 0 auto 28px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; grid-column: 1 / -1 }
.lpct-infocards li { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 22px 18px; text-align: center; font-size: 14.5px; line-height: 1.5 } .lpct-cards a { color: inherit; text-decoration: none; border: 0 }
.lpct-quotecard { margin: 8px 0 0; padding: 26px 28px; border-radius: 16px; background: var(--accent2); color: var(--paper); rotate: -1.5deg; max-width: 440px; box-shadow: var(--shhi) }
.lpct-quotecard blockquote { margin: 0 0 16px; font-family: var(--fd); font-size: 18px; line-height: 1.45 } .lpct-quotecard figcaption { display: flex; align-items: center; gap: 10px; font-size: 13px } .lpct-quote figcaption img { width: 34px; height: 34px; border-radius: 50%; object-fit: cover } .lpct-quote figcaption span { display: flex; flex-direction: column } .lpct-quote i { font-style: normal; opacity: .75 }
@media (max-width: 720px) { .lpct-infocards { grid-template-columns: 1fr } }
@media (max-width: 980px) { .lpct-two { grid-template-columns: 1fr; gap: 32px } }
</style>

<script setup>
import { md } from './md.js'
import { site as SITE_RAW } from '#content'
import SiteMark from '../SiteMark.vue'
import EmailCapture from './EmailCapture.vue'
/*
 * Footer: the foot of the page — the site's mark and a line about it, columns of links, an email
 * field into one of the site's forms, the social links, the legal line and the small links — as
 * columns; as a mega footer with a call above the columns; or minimal, one row centred. A tone
 * makes it a band (ink, mostly). The site's name comes from content/site.md; every other word is
 * the page's.
 *
 * Slots for a look's skin: `about`, `columns`, `legal`.
 */
defineProps({
  layout: { type: String, default: 'columns' },    /* columns | mega | minimal */
  about: { type: String, default: '' },
  columns: { type: Array, default: () => [] },     /* [{ title, links: [{ label, href }] }] */
  capture: { type: Object, default: () => ({}) },  /* { heading, form, button, placeholder } */
  social: { type: Array, default: () => [] },      /* [{ label, href }] — LinkedIn, X, GitHub, Instagram, Mail, YouTube, Facebook draw a glyph */
  legal: { type: String, default: '' },
  small: { type: Array, default: () => [] },       /* [{ label, href }] — privacy, terms */
  call: { type: Object, default: () => ({}) },     /* mega: { heading, cta, href } */
})
const SITE = (Array.isArray(SITE_RAW) ? SITE_RAW[0] : SITE_RAW) || {}
const NET = {
  linkedin: '<path d="M4 8h3v9H4zM5.5 3.5a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zM9 8h2.8v1.3c.4-.8 1.4-1.5 2.9-1.5 3 0 3.3 2 3.3 4.4V17h-3v-4.2c0-1.1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2V17H9z"/>',
  x: '<path d="M4 4l12 12M16 4L4 16" stroke="currentColor" stroke-width="2" fill="none"/>', twitter: '<path d="M4 4l12 12M16 4L4 16" stroke="currentColor" stroke-width="2" fill="none"/>',
  github: '<path d="M10 2a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4a3 3 0 0 1 .8-2.1c-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.6 7.6 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1a3 3 0 0 1 .8 2.1c0 3.1-1.8 3.8-3.6 4 .3.3.6.8.6 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 10 2z"/>',
  instagram: '<rect x="3" y="3" width="14" height="14" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="10" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="14.2" cy="5.8" r="1"/>',
  mail: '<rect x="2.5" y="4.5" width="15" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M2.5 6.5l7.5 5 7.5-5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  youtube: '<rect x="2" y="5" width="16" height="10" rx="3"/><path d="M8.5 7.8v4.4l3.8-2.2z" fill="var(--paper)"/>',
  facebook: '<path d="M11.5 17v-6h2l.3-2.5h-2.3V7c0-.7.2-1.2 1.2-1.2H14V3.6c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.1-3.2 3.2v1.8H6.8V11h2.1v6z"/>',
}
const net = (label) => NET[String(label || '').trim().toLowerCase()] || ''
</script>
<template>
  <section class="lpsec lpfooter" :class="'lpfo-' + layout">
    <div class="lpwrap">
      <div v-if="layout === 'mega' && (call.heading || call.cta)" class="lpfo-call lprv">
        <h2 class="lps" v-html="md(call.heading)"></h2>
        <a v-if="call.cta" :href="call.href || '#'" class="lpbtn text-white"><span v-html="md(call.cta)"></span></a>
      </div>
      <div class="lpfo-grid lprv lpd1" :class="{ 'lpfo-hascap': !!(capture && capture.form) }" :style="{ '--n': columns.length }">
        <slot name="about" :about="about">
          <div class="lpfo-about">
            <a href="/" class="lpfo-mark" :aria-label="SITE.name"><SiteMark class="lpfo-marksvg" /><b>{{ SITE.name }}</b></a>
            <p v-if="about" v-html="md(about)"></p>
            <ul v-if="social.length" class="lpfo-social"><li v-for="(l, i) in social" :key="i"><a :href="l.href" :title="l.label" :aria-label="l.label"><svg v-if="net(l.label)" viewBox="0 0 20 20" width="16" height="16" fill="currentColor" v-html="net(l.label)"></svg><span v-else v-html="md(l.label)"></span></a></li></ul>
          </div>
        </slot>
        <slot name="columns" :columns="columns">
          <div v-for="(c, i) in columns" :key="i" class="lpfo-col">
            <h4 v-html="md(c.title)"></h4>
            <ul><li v-for="(l, j) in (c.links || [])" :key="j"><a :href="l.href" v-html="md(l.label)"></a></li></ul>
          </div>
        </slot>
        <div v-if="capture && capture.form" class="lpfo-cap">
          <h4 v-if="capture.heading" v-html="md(capture.heading)"></h4>
          <EmailCapture :form="capture.form" :button="capture.button" :placeholder="capture.placeholder" :fine="capture.fine" />
        </div>
      </div>
      <slot name="legal" :legal="legal" :small="small">
        <div class="lpfo-legal lprv lpd2">
          <span v-if="legal" v-html="md(legal.replace('{year}', String(new Date().getFullYear())))"></span>
          <ul v-if="small.length"><li v-for="(l, i) in small" :key="i"><a :href="l.href" v-html="md(l.label)"></a></li></ul>
        </div>
      </slot>
    </div>
  </section>
</template>
<style>
.lpfo-col .badge {border-radius:5px; color:#888; border:1px solid #ddd !important;padding:0px 5px; } 
</style>
<style scoped>
.lpfooter { padding: 64px 0 40px; border-bottom: 0 !important }
.lpfo-call { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding-bottom: 44px; margin-bottom: 44px; border-bottom: 1px solid var(--hair) }
.lpfo-call .lps { margin: 0; max-width: 20ch }
/* repeat(auto-fit) cannot sit beside an fr track, so the column count is a variable */
.lpfo-grid { display: grid; grid-template-columns: 1.6fr repeat(var(--n, 2), minmax(120px, 1fr)); gap: 32px 40px }
.lpfo-hascap { grid-template-columns: 1.4fr repeat(var(--n, 2), minmax(110px, 1fr)) 1.6fr }
.lpfo-about { display: flex; flex-direction: column; gap: 14px; max-width: 320px }
.lpfo-mark { display: inline-flex; align-items: center; gap: 10px; color: var(--ink); text-decoration: none; font-family: var(--fd); font-weight: 600; font-size: 19px }
.lpfo-marksvg { width: 28px; height: 28px }
.lpfo-about p { margin: 0; font-size: 14.5px; line-height: 1.55; color: var(--ink2) }
.lpfo-social { list-style: none; margin: 4px 0 0; padding: 0; display: flex; gap: 8px }
.lpfo-social a { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; color: var(--ink2); background: var(--wash); border: 1px solid var(--hair); text-decoration: none; font-size: 12px } .lpfo-social a:hover { color: var(--accent2); border-color: var(--accent2) }
.lpfo-col h4, .lpfo-cap h4 { font-family: var(--m); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); font-weight: 500; margin-bottom: 14px }
.lpfo-col ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px }
.lpfo-col a { font-size: 14.5px; color: var(--ink2); text-decoration: none } .lpfo-col a:hover { color: var(--ink) }
.lpfo-legal { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-top: 44px; padding-top: 22px; border-top: 1px solid var(--hair); font-size: 13px; color: var(--ink3) }
.lpfo-legal ul { list-style: none; margin: 0; padding: 0; display: flex; gap: 18px } .lpfo-legal a { color: var(--ink3); text-decoration: none } .lpfo-legal a:hover { color: var(--ink) }
/* minimal */
.lpfo-minimal .lpfo-grid { grid-template-columns: 1fr; justify-items: center; text-align: center; gap: 18px }
.lpfo-minimal .lpfo-about { align-items: center } .lpfo-minimal .lpfo-col ul { flex-direction: row; gap: 22px; flex-wrap: wrap; justify-content: center } .lpfo-minimal .lpfo-col h4 { display: none }
.lpfo-minimal .lpfo-legal { justify-content: center; margin-top: 28px }
@media (max-width: 900px) { .lpfo-grid, .lpfo-hascap { grid-template-columns: repeat(2, minmax(0, 1fr)) } .lpfo-about, .lpfo-cap { grid-column: 1 / -1 } .lpfo-call { flex-direction: column; align-items: flex-start } }
</style>

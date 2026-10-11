<script setup>
import { md } from './md.js'
import SectionHead from './SectionHead.vue'
import Ticker from './Ticker.vue'
/*
 * Team: the people — a portrait, a name, a role, a line about them, and where else they are — as
 * a grid of portraits (three or four to a row), a row of circles, rows with a longer bio each, or
 * the whole team in one photograph under the words. Links are drawn as small glyphs when their
 * label is a network's name (LinkedIn, X, GitHub, Instagram, Mail), else as words.
 *
 * Slots for a look's skin: `head` and `people`.
 */
defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  layout: { type: String, default: 'grid' },    /* grid | circles | rows | photo | mono | tiles | marquee | solo */
  logos: { type: Array, default: () => [] },    /* [{ name, image }] under the people (mono) */
  columns: { type: Number, default: 3 },
  image: { type: String, default: '' }, alt: { type: String, default: '' },   /* the group photograph */
  cta: { type: String, default: '' }, href: { type: String, default: '' },
  people: { type: Array, default: () => [] },   /* [{ name, role?, image?, bio?, links?: [{ label, href }] }] */
})
const initials = (name) => String(name || '').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
const NET = {
  linkedin: '<path d="M4 8h3v9H4zM5.5 3.5a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zM9 8h2.8v1.3c.4-.8 1.4-1.5 2.9-1.5 3 0 3.3 2 3.3 4.4V17h-3v-4.2c0-1.1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2V17H9z"/>',
  x: '<path d="M4 4l12 12M16 4L4 16" stroke="currentColor" stroke-width="2" fill="none"/>',
  twitter: '<path d="M4 4l12 12M16 4L4 16" stroke="currentColor" stroke-width="2" fill="none"/>',
  github: '<path d="M10 2a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4a3 3 0 0 1 .8-2.1c-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.6 7.6 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1a3 3 0 0 1 .8 2.1c0 3.1-1.8 3.8-3.6 4 .3.3.6.8.6 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 10 2z"/>',
  instagram: '<rect x="3" y="3" width="14" height="14" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="10" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="14.2" cy="5.8" r="1"/>',
  mail: '<rect x="2.5" y="4.5" width="15" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M2.5 6.5l7.5 5 7.5-5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
}
const net = (label) => NET[String(label || '').trim().toLowerCase()] || ''
</script>

<template>
  <section class="lpsec lpteam" :class="'lpteam-' + layout">
    <div class="lpwrap">
      <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead"><SectionHead :eyebrow="eyebrow" :heading="heading" :lead="lead" :center="layout === 'photo' || layout === 'circles'" /></slot>
      <slot name="people" :people="people" :md="md">
        <!-- the whole team in one photograph -->
        <div v-if="layout === 'photo'" class="lptm-photo lprv">
          <figure v-if="image" class="lpcard lptm-group"><img :src="image" :alt="alt || ''" loading="lazy" decoding="async" /></figure>
          <a v-if="cta" :href="href || '#'" class="lpbtn text-white lptm-cta"><span v-html="md(cta)"></span></a>
        </div>
        <!-- tiles: portraits in a tight grid, the name on each -->
        <div v-else-if="layout === 'tiles' && people.length" class="lptm-tiles lprv">
          <figure v-for="(p, i) in people" :key="i" class="lptm-tile lpk" :style="{ '--k': (0.05 + i * 0.06) + 's' }">
            <img v-if="p.image" :src="p.image" :alt="p.name || ''" loading="lazy" decoding="async" /><span v-else class="lptm-tilefill"><i>{{ initials(p.name) }}</i></span>
            <figcaption><b v-html="md(p.name)"></b><span v-if="p.role" v-html="md(p.role)"></span></figcaption>
          </figure>
        </div>
        <!-- a marquee of circles -->
        <Ticker v-else-if="layout === 'marquee' && people.length" class="lptm-tk lprv" :speed="26">
          <figure v-for="(p, i) in people" :key="i" class="lptm-circ">
            <span class="lptm-port lptm-port-c"><img v-if="p.image" :src="p.image" :alt="p.name || ''" loading="lazy" /><i v-else>{{ initials(p.name) }}</i></span>
            <figcaption><b v-html="md(p.name)"></b><span v-if="p.role" v-html="md(p.role)"></span></figcaption>
          </figure>
        </Ticker>
        <!-- one large -->
        <div v-else-if="layout === 'solo' && people.length" class="lptm-solo lprv">
          <div class="lptm-solowords">
            <h3 v-html="md(people[0].name)"></h3><span v-if="people[0].role" class="lptm-role" v-html="md(people[0].role)"></span>
            <p v-if="people[0].bio" v-html="md(people[0].bio)"></p>
            <ul v-if="people[0].links && people[0].links.length" class="lptm-links"><li v-for="(l, j) in people[0].links" :key="j"><a :href="l.href" :title="l.label"><svg v-if="net(l.label)" viewBox="0 0 20 20" width="16" height="16" fill="currentColor" v-html="net(l.label)"></svg><span v-else v-html="md(l.label)"></span></a></li></ul>
          </div>
          <div class="lptm-solopic lpk" style="--k: .15s"><span class="lptm-blob" aria-hidden="true"></span><img v-if="people[0].image" :src="people[0].image" :alt="people[0].name || ''" loading="lazy" decoding="async" /></div>
        </div>
        <!-- rows: a longer word about each -->
        <div v-else-if="layout === 'rows' && people.length" class="lptm-rows">
          <div v-for="(p, i) in people" :key="i" class="lptm-row lprv">
            <span class="lptm-port lptm-port-s"><img v-if="p.image" :src="p.image" :alt="p.name || ''" loading="lazy" /><i v-else>{{ initials(p.name) }}</i></span>
            <div class="lptm-rowwords">
              <h4 v-html="md(p.name)"></h4>
              <span v-if="p.role" class="lptm-role" v-html="md(p.role)"></span>
              <p v-if="p.bio" v-html="md(p.bio)"></p>
              <ul v-if="p.links && p.links.length" class="lptm-links"><li v-for="(l, j) in p.links" :key="j"><a :href="l.href" :title="l.label"><svg v-if="net(l.label)" viewBox="0 0 20 20" width="16" height="16" fill="currentColor" v-html="net(l.label)"></svg><span v-else v-html="md(l.label)"></span></a></li></ul>
            </div>
          </div>
        </div>
        <div v-else-if="people.length" class="lptm-grid" :class="['lptm-c' + Math.min(5, Math.max(2, (layout === 'circles' || layout === 'mono') ? Math.max(columns, 4) : columns)), { 'lptm-mono': layout === 'mono' }]">
          <div v-for="(p, i) in people" :key="i" class="lptm lprv" :class="{ ['lpd' + Math.min(3, i % 4)]: i % 4 }">
            <span class="lptm-port"><img v-if="p.image" :src="p.image" :alt="p.name || ''" loading="lazy" decoding="async" /><i v-else>{{ initials(p.name) }}</i></span>
            <h4 v-html="md(p.name)"></h4>
            <span v-if="p.role" class="lptm-role" v-html="md(p.role)"></span>
            <p v-if="p.bio" v-html="md(p.bio)"></p>
            <ul v-if="p.links && p.links.length" class="lptm-links"><li v-for="(l, j) in p.links" :key="j"><a :href="l.href" :title="l.label"><svg v-if="net(l.label)" viewBox="0 0 20 20" width="16" height="16" fill="currentColor" v-html="net(l.label)"></svg><span v-else v-html="md(l.label)"></span></a></li></ul>
          </div>
        </div>
        <ul v-if="layout === 'mono' && logos.length" class="lptm-logos lprv lpd2"><li v-for="(l, i) in logos" :key="i"><img v-if="l.image" :src="l.image" :alt="l.name || ''" loading="lazy" /><b v-else v-html="md(l.name)"></b></li></ul>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lptm-grid { display: grid; gap: 36px 28px }
.lptm-c2 { grid-template-columns: repeat(2, minmax(0, 1fr)) } .lptm-c3 { grid-template-columns: repeat(3, minmax(0, 1fr)) } .lptm-c4 { grid-template-columns: repeat(4, minmax(0, 1fr)) } .lptm-c5 { grid-template-columns: repeat(5, minmax(0, 1fr)) }
.lptm { display: flex; flex-direction: column; gap: 6px; min-width: 0 }
.lptm-port { display: grid; place-items: center; aspect-ratio: 1; width: 100%; border-radius: 18px; overflow: hidden; background: var(--accentbg); margin-bottom: 10px; box-shadow: var(--sh) }
.lptm-port img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .6s cubic-bezier(.2,.8,.2,1) }
.lptm:hover .lptm-port img { transform: scale(1.03) }
.lptm-port i { font: 600 28px var(--fd); font-style: normal; color: var(--accent2) }
.lptm h4 { font-size: 18px; letter-spacing: -.01em }
.lptm-role { font-family: var(--m); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent2) }
.lptm p { margin: 6px 0 0; font-size: 14.5px; line-height: 1.55; color: var(--ink2) }
.lptm-links { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center }
.lptm-links a { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 600; color: var(--ink2); text-decoration: none }
.lptm-links a:hover { color: var(--accent2) }
.lptm-links svg { display: block }
/* circles: round, smaller, centred */
.lpteam-circles .lptm { align-items: center; text-align: center }
.lpteam-circles .lptm-port { width: min(100%, 150px); border-radius: 50% }
.lpteam-circles .lptm-links { justify-content: center }
/* mono: black and white circles, logos under */
.lptm-mono .lptm { align-items: center; text-align: center } .lptm-mono .lptm-port { width: min(100%, 130px); border-radius: 50%; filter: grayscale(1); transition: filter .3s } .lptm-mono .lptm:hover .lptm-port { filter: none }
.lptm-logos { list-style: none; margin: 40px 0 0; padding: 30px 0 0; border-top: 1px solid var(--hair); display: flex; justify-content: center; align-items: center; gap: 36px; flex-wrap: wrap; opacity: .6 }
.lptm-logos img { height: 26px } .lptm-logos b { font-family: var(--fd); font-size: 18px; font-weight: 600 }
/* tiles */
.lptm-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px }
.lptm-tile { position: relative; margin: 0; aspect-ratio: 1; overflow: hidden; border-radius: 8px; background: var(--wash) }
.lptm-tile img, .lptm-tilefill { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: grid; place-items: center } .lptm-tilefill i { font: 600 28px var(--fd); font-style: normal; color: var(--accent2) }
.lptm-tile figcaption { position: absolute; left: 0; right: 0; bottom: 0; padding: 30px 12px 10px; background: linear-gradient(180deg, transparent, #000000b0); color: #fff; display: flex; flex-direction: column; font-size: 12px } .lptm-tile figcaption b { font-size: 14px; color: #fff }
/* the marquee */
.lptm-tk { margin: 0 -28px } .lptm-circ { margin: 0 18px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; width: 150px }
.lptm-port-c { width: 120px; border-radius: 50%; margin: 0 } .lptm-circ figcaption { display: flex; flex-direction: column; font-size: 13.5px } .lptm-circ b { font-weight: 600 } .lptm-circ span { color: var(--ink3); font-size: 12.5px }
/* one large */
.lptm-solo { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 48px; align-items: center }
.lptm-solowords { display: flex; flex-direction: column; gap: 8px } .lptm-solowords h3 { font-size: clamp(28px, 3.4vw, 40px); letter-spacing: -.02em } .lptm-solowords p { font-size: 17px; line-height: 1.55; color: var(--ink2); margin: 8px 0 0 }
.lptm-solopic { position: relative; text-align: center } .lptm-solopic img { position: relative; z-index: 1; width: min(100%, 420px); height: auto; display: inline-block }
.lptm-blob { position: absolute; left: 50%; bottom: 0; width: 70%; aspect-ratio: 1; transform: translateX(-50%); border-radius: 46% 54% 40% 60% / 50% 40% 60% 50%; background: linear-gradient(135deg, var(--accent), var(--c2, var(--accent2))); opacity: .85 }
/* rows */
.lptm-rows { display: flex; flex-direction: column; gap: 14px; max-width: 860px }
.lptm-row { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 24px; align-items: start; padding: 22px 0; border-top: 1px solid var(--hair) }
.lptm-port-s { margin: 0; border-radius: 14px }
.lptm-rowwords { display: flex; flex-direction: column; gap: 4px }
.lptm-rowwords h4 { font-size: 20px } .lptm-rowwords p { font-size: 15.5px }
/* the photograph */
.lptm-photo { display: flex; flex-direction: column; align-items: center; gap: 28px }
.lptm-group { margin: 0; overflow: hidden; width: 100%; max-width: 980px } .lptm-group img { display: block; width: 100%; height: auto }
@media (max-width: 980px) { .lptm-c3, .lptm-c4, .lptm-c5 { grid-template-columns: repeat(2, minmax(0, 1fr)) } .lpteam-circles .lptm-c4, .lpteam-circles .lptm-c5 { grid-template-columns: repeat(3, minmax(0, 1fr)) } }
@media (max-width: 900px) { .lptm-tiles { grid-template-columns: repeat(3, minmax(0, 1fr)) } .lptm-solo { grid-template-columns: 1fr } .lptm-solopic { order: -1 } }
@media (max-width: 480px) { .lptm-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)) } .lptm-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 16px } .lptm-port { border-radius: 14px } .lptm-row { grid-template-columns: 72px minmax(0, 1fr); gap: 16px } }
</style>

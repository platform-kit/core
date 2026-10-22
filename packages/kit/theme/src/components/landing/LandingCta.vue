<script setup>
import { md } from './md.js'
import { glyph } from './icons.js'
import EmailCapture from './EmailCapture.vue'
import Avatars from './Avatars.vue'
import Stars from './Stars.vue'
/*
 * Call to action: the ask, in one of five layouts — centred; split (words beside a picture or a
 * screenshot); band (a full band, words centred, meant for a tone); bar (a slim line with one
 * button); cards (two asks side by side) — carrying whatever the ask needs: a button and a quiet
 * second, an email field into one of the site's forms, ticked points, faces and a count, a
 * rating, a row of logos, store badges, a picture, fine print. Nothing here is fixed: leave a
 * part empty and it is not drawn.
 *
 * Slots for a look's skin: `words`, `visual`, `cards`.
 */
defineProps({
  layout: { type: String, default: 'centered' },   /* centered | split | band | bar | cards | promo */
  from: { type: String, default: '' },              /* promo: "Starting from $29" */
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  cta: { type: String, default: '' }, href: { type: String, default: '' },
  cta2: { type: String, default: '' }, href2: { type: String, default: '' },
  fine: { type: String, default: '' },
  capture: { type: Object, default: () => ({}) },   /* { form, button, placeholder, fine } */
  points: { type: Array, default: () => [] },       /* [{ icon?, text }] */
  avatars: { type: Object, default: () => ({}) },   /* { items: [{ image, name }], line } */
  rating: { type: Object, default: () => ({}) },    /* { stars, line } */
  logos: { type: Array, default: () => [] },        /* [{ name, image }] */
  badges: { type: Object, default: () => ({}) },    /* { apple, google } — links to the stores */
  image: { type: String, default: '' }, alt: { type: String, default: '' },
  frame: { type: Boolean, default: false },         /* the picture inside a browser window */
  cards: { type: Array, default: () => [] },        /* [{ icon?, title, body, cta, href }] for the cards layout */
})
</script>

<template>
  <section class="lpsec lpcall" :class="'lpcall-' + layout">
    <div class="lpwrap">
      <!-- the bar: one line, one button -->
      <div v-if="layout === 'bar'" class="lpcta-bar lprv">
        <p><b v-if="heading" v-html="md(heading)"></b><span v-if="lead" v-html="md(lead)"></span></p>
        <a v-if="cta" :href="href || '#'" class="lpbtn text-white lpcta-barbtn"><span v-html="md(cta)"></span></a>
      </div>
      <!-- the promo: the words over the photograph, a badge, a "from" line -->
      <div v-else-if="layout === 'promo'" class="lpcta-promo lprv">
        <img v-if="image" :src="image" :alt="alt || ''" class="lpcta-promoimg" loading="lazy" decoding="async" />
        <div class="lpcta-promow">
          <span v-if="eyebrow" class="lpeyebrow lpk" v-html="md(eyebrow)"></span>
          <h2 v-if="heading" class="lps lpk" style="--k: .1s" v-html="md(heading)"></h2>
          <p v-if="lead" class="lplead lpk" style="--k: .2s" v-html="md(lead)"></p>
          <div class="lpcta-promoacts lpk" style="--k: .3s">
            <a v-if="cta" :href="href || '#'" class="lpbtn text-white"><span v-html="md(cta)"></span></a>
            <span v-if="from" class="lpcta-from" v-html="md(from)"></span>
          </div>
        </div>
      </div>
      <!-- two asks side by side -->
      <div v-else-if="layout === 'cards'" class="lpcta-cards">
        <slot name="cards" :cards="cards" :md="md">
          <div v-for="(c, i) in cards" :key="i" class="lpcard lpcta-card lprv" :class="{ lpd1: i === 1 }">
            <span v-if="c.icon" class="lpcta-ico" v-html="glyph(c.icon)"></span>
            <h3 v-html="md(c.title)"></h3>
            <p v-if="c.body" v-html="md(c.body)"></p>
            <a v-if="c.cta" :href="c.href || '#'" class="lpbtn text-white lpcta-cardbtn"><span v-html="md(c.cta)"></span></a>
          </div>
        </slot>
      </div>
      <div v-else class="lpcta-in" :class="{ 'lpcta-two': layout === 'split' && (image || logos.length) }">
        <slot name="words" :md="md">
          <div class="lpcta-words lprv">
            <Avatars v-if="avatars.items && avatars.items.length" class="lpcta-av lpk" :items="avatars.items" :line="avatars.line" />
            <span v-if="eyebrow" class="lpeyebrow" v-html="md(eyebrow)"></span>
            <h2 v-if="heading" class="lps lpk" style="--k: .1s" v-html="md(heading)"></h2>
            <p v-if="lead" class="lplead lpk" style="--k: .2s" v-html="md(lead)"></p>
            <ul v-if="points.length" class="lpcta-points lpk" style="--k: .3s">
              <li v-for="(p, i) in points" :key="i"><span class="lpcta-tick" v-html="glyph(p.icon || 'check')"></span><span v-html="md(p.text)"></span></li>
            </ul>
            <EmailCapture v-if="capture.form" class="lpcta-cap lpk" style="--k: .36s" :form="capture.form" :button="capture.button" :placeholder="capture.placeholder" :fine="capture.fine" size="large" />
            <div v-else-if="cta || cta2" class="lpcta lpk" style="--k: .36s">
              <a v-if="cta" :href="href || '#'" class="lpbtn text-white"><span v-html="md(cta)"></span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5" /></svg>
              </a>
              <a v-if="cta2" :href="href2 || '#'" class="lpcta-quiet" v-html="md(cta2)"></a>
            </div>
            <div v-if="badges.apple || badges.google" class="lpcta-badges lpk" style="--k: .4s">
              <a v-if="badges.apple" :href="badges.apple" class="lpcta-badge"><svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M14.4 10.6c0-2 1.6-2.9 1.7-3-1-1.4-2.4-1.6-2.9-1.6-1.3-.1-2.4.7-3.1.7-.6 0-1.6-.7-2.6-.7-1.4 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.5 2 2.5 2s1.4-.6 2.6-.6 1.5.6 2.6.6 1.7-1 2.4-2c.7-1.1 1-2.2 1.1-2.3-.1 0-2-.8-2-3.1zM12.5 4.7c.5-.7.9-1.6.8-2.5-.8 0-1.7.5-2.3 1.2-.5.6-.9 1.5-.8 2.4.9.1 1.8-.4 2.3-1.1z"/></svg><span>App Store</span></a>
              <a v-if="badges.google" :href="badges.google" class="lpcta-badge"><svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M3.5 2.4l8.3 7.6-8.3 7.6c-.2-.2-.3-.5-.3-.9V3.3c0-.4.1-.7.3-.9zm9.5 8.7l2.3 2.1-9.6 5.4c-.5.3-1 .3-1.4.1l8.7-7.6zm0-2.2L4.3 1.3c.4-.2.9-.2 1.4.1l9.6 5.4L13 8.9zm1 .9l2.7 1.5c.9.5.9 1.4 0 1.9l-2.7 1.5L11.8 10 14 8.8z"/></svg><span>Google Play</span></a>
            </div>
            <Stars v-if="rating.line || rating.stars" class="lpcta-stars lpk" style="--k: .44s" :value="Number(rating.stars) || 5" :line="rating.line" />
            <p v-if="fine" class="lpfine lpk" style="--k: .5s" v-html="md(fine)"></p>
            <ul v-if="logos.length && layout !== 'split'" class="lpcta-logos lpk" style="--k: .55s">
              <li v-for="(l, i) in logos" :key="i"><img v-if="l.image" :src="l.image" :alt="l.name || ''" loading="lazy" /><b v-else v-html="md(l.name)"></b></li>
            </ul>
          </div>
        </slot>
        <slot name="visual" :image="image" :logos="logos">
          <div v-if="layout === 'split' && image" class="lpcta-vis lprv lpd1">
            <div v-if="frame" class="lpcard lpappcard lpcta-frame"><div class="lpappbar"><span class="lpdots"><i></i><i></i><i></i></span></div><img :src="image" :alt="alt || ''" loading="lazy" decoding="async" /></div>
            <figure v-else class="lpcard lpcta-fig"><img :src="image" :alt="alt || ''" loading="lazy" decoding="async" /></figure>
          </div>
          <ul v-else-if="layout === 'split' && logos.length" class="lpcta-logos lpcta-logogrid lprv lpd1">
            <li v-for="(l, i) in logos" :key="i"><img v-if="l.image" :src="l.image" :alt="l.name || ''" loading="lazy" /><b v-else v-html="md(l.name)"></b></li>
          </ul>
        </slot>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* centred and band: the words in the middle */
.lpcall-centered .lpcta-words, .lpcall-band .lpcta-words { max-width: 720px; margin: 0 auto; text-align: center; display: flex; flex-direction: column; align-items: center }
.lpcall-centered .lpeyebrow, .lpcall-band .lpeyebrow { justify-content: center }
.lpcall-band { padding: 80px 0 }
.lpcall-band .lpwrap { max-width: 980px }
.lpcta-words { display: flex; flex-direction: column; align-items: flex-start; gap: 4px }
.lpcta-words .lps { margin: 12px 0 14px }
.lpcta-words .lplead { margin: 0 0 22px; max-width: 54ch }
.lpcta-av { margin-bottom: 10px }
.lpcta { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-top: 6px }
.lpcall-centered .lpcta, .lpcall-band .lpcta { justify-content: center }
.lpcta-quiet { font-weight: 600; font-size: 15.5px; color: var(--ink2); text-decoration: none; padding: 14px 6px } .lpcta-quiet:hover { color: var(--ink) }
.lpcta-cap { margin-top: 6px; width: 100%; max-width: 480px }
.lpcall-centered .lpcta-cap, .lpcall-band .lpcta-cap { align-items: center }
.lpcta-points { list-style: none; margin: 0 0 18px; padding: 0; display: flex; flex-wrap: wrap; gap: 10px 22px }
.lpcta-points li { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; color: var(--ink) }
.lpcta-tick { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 7px; color: var(--accent2); background: var(--accentbg) } .lpcta-tick :deep(svg) { width: 13px; height: 13px }
.lpfine { margin: 14px 0 0 }
.lpcta-stars { margin-top: 16px }
.lpcta-badges { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px }
.lpcta-badge { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 10px; background: var(--ink); color: var(--paper); text-decoration: none; font-weight: 600; font-size: 14px; border: 1px solid var(--hair) }
.lpcta-badge:hover { transform: translateY(-1px) }
.lpcta-logos { list-style: none; margin: 30px 0 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 14px 34px; opacity: .6 }
.lpcta-logos img { height: 26px; width: auto } .lpcta-logos b { font-family: var(--fd); font-size: 17px; font-weight: 600; white-space: nowrap }
/* split: words beside the visual */
.lpcta-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 56px; align-items: center }
.lpcta-vis { position: relative }
.lpcta-fig { margin: 0; overflow: hidden } .lpcta-fig img, .lpcta-frame img { display: block; width: 100%; height: auto }
.lpcta-logogrid { margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; opacity: 1 }
.lpcta-logogrid li { display: grid; place-items: center; height: 68px; border-radius: 12px; background: var(--card); border: 1px solid var(--hair); color: var(--ink2) }
/* the bar */
.lpcta-bar { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 14px 8px 14px 22px; border-radius: 999px; background: var(--card); border: 1px solid var(--hair); box-shadow: var(--sh) }
.lpcta-bar p { margin: 0; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; font-size: 15px; color: var(--ink2) } .lpcta-bar b { color: var(--ink); font-weight: 600 }
.lpcta-barbtn { padding: 10px 18px; font-size: 14px }

section.lpcall-bar { padding: 28px 0 }
/* the promo */
.lpcta-promo { position: relative; min-height: 420px; border-radius: 22px; overflow: hidden; display: flex; align-items: flex-end; background: var(--ink); color: #fff; --ink: #fff; --ink2: #ffffffd9; --ink3: #ffffffb0; --btntext: #111 }
.lpcta-promoimg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover }
.lpcta-promo::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, #0b0f14e6 0%, #0b0f14b8 42%, #0b0f1440 70%, #0b0f1414 100%) }
.lpcta-promow { position: relative; z-index: 1; padding: 48px 44px; max-width: 560px }
.lpcta-promow .lpeyebrow { color: #fff } .lpcta-promow .lps { color: #fff; margin: 12px 0 12px } .lpcta-promow .lplead { color: #ffffffd9; margin-bottom: 20px }
.lpcta-promoacts { display: flex; align-items: center; gap: 16px; flex-wrap: wrap } .lpcta-promow .lpbtn { background: #fff; color: #111 }
.lpcta-from { font-family: var(--m); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #fff; border: 1px solid #ffffff66; border-radius: 999px; padding: 8px 14px }
/* two cards */
.lpcta-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px }
.lpcta-card { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 32px 30px 30px }
.lpcta-ico { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; color: var(--accent2); background: var(--accentbg); margin-bottom: 6px } .lpcta-ico :deep(svg) { width: 20px; height: 20px }
.lpcta-card h3 { font-size: 24px; letter-spacing: -.015em } .lpcta-card p { margin: 0; font-size: 15.5px; line-height: 1.55; color: var(--ink2) }
.lpcta-cardbtn { margin-top: auto; padding-top: 12px; align-self: flex-start; margin-top: 12px }
@media (max-width: 980px) { .lpcta-two { grid-template-columns: 1fr; gap: 32px } }
@media (max-width: 640px) { .lpcta-promow { padding: 28px 22px; max-width: none } .lpcta-promo::after { background: linear-gradient(180deg, #0b0f1466, #0b0f14e6) } .lpcta-cards { grid-template-columns: 1fr } .lpcta-bar { flex-direction: column; align-items: flex-start; border-radius: 18px; padding: 18px } .lpcta-logogrid { grid-template-columns: repeat(2, minmax(0, 1fr)) } }
</style>

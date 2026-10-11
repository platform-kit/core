<script setup>
import { computed } from 'vue'
import { md } from './md.js'
import { embedOf, loopSrc } from '../../lib/embed.js'
import { STAGES } from '#site/landing'   /* the site's stages for the visual (platformkit.config.js landing.stages) */
import { site as SITE_RAW } from '#content'
import EmailCapture from './EmailCapture.vue'
import Avatars from './Avatars.vue'
import Stars from './Stars.vue'
import Device from './Device.vue'
import RevealText from './RevealText.vue'
import { us } from '@platform-kit/kit/lib/strings.js'
/*
 * The landing hero: an eyebrow, the headline lines, the sub, a button and a quiet second one, the
 * fine print — and beside, below or behind the words a visual of one kind: none (the words take
 * the width), an image, a video (a file, or a YouTube / Vimeo / Loom url as a muted loop), a frame
 * (a screenshot inside a browser window), or a stage the site registers — a component of the
 * site's own, mounted with `stage` as its props (a mock of the site's product, say). The kit
 * carries no stage of its own. Three layouts: split (words beside the visual), centered (words
 * centred, the visual below), backdrop (the visual behind the words, under a scrim). And the
 * proof a hero carries when it has it: faces and a line, a rating, a row of stats, an email field
 * into one of the site's forms, a card floating over the visual, a row of cards under it all.
 * Every word comes in as a prop from the page's markdown.
 *
 * Slots for a look's skin: `head` (the words), `visual` (whatever stands beside them), `cards`.
 */
const props = defineProps({
  layout: { type: String, default: 'split' },   /* split | centered | backdrop */
  eyebrow: { type: String, default: '' },
  lines: { type: Array, default: () => ['A short line', 'that says what', 'this is for.'] },
  sub: { type: String, default: '' },
  cta: { type: String, default: 'Get started' },
  href: { type: String, default: '/app' },
  cta2: { type: String, default: '' },
  href2: { type: String, default: '' },
  fine: { type: String, default: '' },
  visual: { type: Object, default: () => ({ kind: 'none' }) },   /* { kind: none | image | video | frame | <stage>, image, alt, video, poster } */
  stage: { type: Object, default: () => ({}) },                   /* the chosen stage's own words */
  avatars: { type: Object, default: () => ({}) },                 /* { items: [{ image, name }], line } */
  rating: { type: Object, default: () => ({}) },                  /* { stars, line } */
  stats: { type: Array, default: () => [] },                      /* [{ value, label }] */
  capture: { type: Object, default: () => ({}) },                 /* { form, button, placeholder, fine } — an email field in place of the buttons */
  float: { type: Object, default: () => ({}) },                   /* { value, title, line, image } — a card over the visual */
  floats: { type: Array, default: () => [] },                     /* more cards over the visual: [{ kind: card | chat | stat, at: tl|tr|bl|br, title, line, value, image }] */
  cards: { type: Array, default: () => [] },                      /* [{ icon?, title, body, image? }] under the hero */
  badges: { type: Object, default: () => ({}) },                  /* { apple, google } — links to the stores, under the buttons */
  arrive: { type: String, default: 'lines' },                     /* the headline arrives: lines | words | none */
  arrow: { type: Boolean, default: false },                       /* a scroll arrow at the foot */
})
const W = (us('sections').hero || {}).cue || {}
const KIT = ['image', 'video', 'frame', 'phone', 'laptop']
const stageComp = computed(() => (props.visual && STAGES[props.visual.kind]) || null)
/* the kind drawn: a stage the site no longer has, or a kit kind with nothing to show, leaves the words on their own */
const kind = computed(() => {
  const v = props.visual || {}
  if (stageComp.value) return 'stage'
  if (!KIT.includes(v.kind)) return 'none'
  if (v.kind === 'video') return embedOf(v.video) ? 'video' : 'none'
  return v.image ? v.kind : 'none'
})
const embed = computed(() => (kind.value === 'video' ? embedOf(props.visual.video) : null))
const mode = computed(() => (kind.value === 'none' ? 'solo' : props.layout === 'backdrop' && (kind.value === 'image' || kind.value === 'video') ? 'backdrop' : props.layout === 'centered' ? 'centered' : 'split'))
const host = (() => { try { return new URL(((Array.isArray(SITE_RAW) ? SITE_RAW[0] : SITE_RAW) || {}).url).host } catch (e) { return '' } })()
const hasFloat = computed(() => props.float && (props.float.value || props.float.title || props.float.line))
const allFloats = computed(() => (hasFloat.value ? [{ ...props.float, at: 'br' }] : []).concat(props.floats || []))
function scrollDown() { const el = document.querySelector('.lphero-sec'); const y = el ? el.getBoundingClientRect().bottom + window.scrollY : window.innerHeight; window.scrollTo({ top: y - 60, behavior: 'smooth' }) }
</script>

<template>
  <section class="lpsec lphero-sec" :class="'lphero-' + mode">
    <!-- the backdrop: the picture or the loop behind everything, under a scrim -->
    <div v-if="mode === 'backdrop'" class="lph-back" aria-hidden="true">
      <video v-if="kind === 'video' && embed.kind === 'file'" :src="embed.src" :poster="visual.poster || undefined" autoplay muted loop playsinline></video>
      <img v-else-if="kind === 'image'" :src="visual.image" alt="" decoding="async" />
      <iframe v-else :src="loopSrc(embed)" title="" allow="autoplay" tabindex="-1"></iframe>
      <span class="lph-scrim"></span>
    </div>
    <div class="lpwrap">
      <div class="lphero" :class="{ lpsolo: mode !== 'split' }">
        <!--
          BEHIND THE WORDS — empty in the theme, and a slot so a site can put something there.

          This used to be a canvas the theme itself rendered and animated — a slow drift of points
          behind the words. That belongs to whichever site wants it: an atmosphere suits one kind
          of site and no other, and every site built on the kit was wearing it whether it was a
          press, a shop or a documentation tree. A default must not carry one site's mood.

          A site that wants something here fills the slot, with its own element and its own effect,
          and does so WITHOUT replacing the hero — which is the point of a slot: the words, the
          buttons, the visual and the layout all stay the theme's.
        -->
        <slot name="behind"></slot>
        <slot name="head" :lines="lines" :sub="sub" :cta="cta" :href="href" :cta2="cta2" :href2="href2" :fine="fine" :md="md">
        <div class="lph-words">
          <Avatars v-if="avatars.items && avatars.items.length" class="lph-av" :items="avatars.items" :line="avatars.line" />
          <span v-if="eyebrow" class="lpeyebrow lph-eyebrow" v-html="md(eyebrow)"></span>
          <h1 :class="{ 'lph1-words': arrive === 'words', 'lph1-still': arrive === 'none' }">
            <template v-if="arrive === 'words'"><span v-for="(l, i) in lines" :key="i" class="lph1w lprv lpin"><i><RevealText :text="l" mode="words" :delay="i * 0.12" :stagger="0.06" /></i></span></template>
            <template v-else><span v-for="(l, i) in lines" :key="i" class="lph1w"><i v-html="md(l)"></i></span></template>
          </h1>
          <p v-if="sub" class="lpsub" v-html="md(sub)"></p>
          <EmailCapture v-if="capture.form" class="lph-cap" :form="capture.form" :button="capture.button || cta" :placeholder="capture.placeholder" :fine="capture.fine || fine" size="large" />
          <div v-else class="lpcta">
            <a :href="href" class="lpbtn text-white"><span v-html="md(cta)"></span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5" /></svg>
            </a>
            <a v-if="cta2" :href="href2 || '#'" class="lph-quiet" v-html="md(cta2)"></a>
            <span v-if="fine" class="lpfine" v-html="md(fine)"></span>
          </div>
          <div v-if="badges.apple || badges.google" class="lph-badges">
            <a v-if="badges.apple" :href="badges.apple" class="lph-badge"><svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M14.4 10.6c0-2 1.6-2.9 1.7-3-1-1.4-2.4-1.6-2.9-1.6-1.3-.1-2.4.7-3.1.7-.6 0-1.6-.7-2.6-.7-1.4 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.5 2 2.5 2s1.4-.6 2.6-.6 1.5.6 2.6.6 1.7-1 2.4-2c.7-1.1 1-2.2 1.1-2.3-.1 0-2-.8-2-3.1zM12.5 4.7c.5-.7.9-1.6.8-2.5-.8 0-1.7.5-2.3 1.2-.5.6-.9 1.5-.8 2.4.9.1 1.8-.4 2.3-1.1z"/></svg><span><small>{{ W['apple-small'] }}</small>{{ W.apple }}</span></a>
            <a v-if="badges.google" :href="badges.google" class="lph-badge"><svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M3.5 2.4l8.3 7.6-8.3 7.6c-.2-.2-.3-.5-.3-.9V3.3c0-.4.1-.7.3-.9zm9.5 8.7l2.3 2.1-9.6 5.4c-.5.3-1 .3-1.4.1l8.7-7.6zm0-2.2L4.3 1.3c.4-.2.9-.2 1.4.1l9.6 5.4L13 8.9zm1 .9l2.7 1.5c.9.5.9 1.4 0 1.9l-2.7 1.5L11.8 10 14 8.8z"/></svg><span><small>{{ W['google-small'] }}</small>{{ W.google }}</span></a>
          </div>
          <Stars v-if="rating.line || rating.stars" class="lph-stars" :value="Number(rating.stars) || 5" :line="rating.line" />
          <dl v-if="stats.length" class="lph-stats">
            <div v-for="(s, i) in stats" :key="i"><dt class="lpnum" v-html="md(s.value)"></dt><dd v-html="md(s.label)"></dd></div>
          </dl>
        </div>
        </slot>

        <slot name="visual" :kind="kind" :visual="visual" :stage="stage" :md="md">
        <div v-if="kind !== 'none' && mode !== 'backdrop'" class="lpstage lph-vis" :class="'lph-' + kind">
          <span class="lphalo"></span>
          <component v-if="kind === 'stage'" :is="stageComp" v-bind="stage" />
          <figure v-else-if="kind === 'image'" class="lpcard lph-img"><img :src="visual.image" :alt="visual.alt || ''" decoding="async" /></figure>
          <Device v-else-if="kind === 'frame' || kind === 'phone' || kind === 'laptop'" :kind="kind === 'frame' ? 'browser' : kind" :image="visual.image" :alt="visual.alt || ''" :video="visual.video" class="lph-device" />
          <div v-else-if="kind === 'video'" class="lpcard lph-video">
            <video v-if="embed.kind === 'file'" :src="embed.src" :poster="visual.poster || undefined" autoplay muted loop playsinline></video>
            <iframe v-else :src="loopSrc(embed)" :title="visual.alt || ''" allow="autoplay; fullscreen; picture-in-picture" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>
          </div>
          <!-- the floating cards: a number, a line, a chat bubble, over the visual's corners -->
          <div v-for="(f, i) in allFloats" :key="i" class="lpcard lph-float lpk" :class="['lph-float-' + (f.at || 'br'), 'lph-float-' + (f.kind || 'card')]" :style="{ '--k': (0.5 + i * 0.15) + 's' }">
            <img v-if="f.image" :src="f.image" alt="" loading="lazy" />
            <span class="lph-floatw"><b v-if="f.value" class="lpnum" v-html="md(f.value)"></b><strong v-if="f.title" v-html="md(f.title)"></strong><i v-if="f.line" v-html="md(f.line)"></i></span>
          </div>
        </div>
        </slot>
      </div>
      <button v-if="arrow" type="button" class="lph-arrow" :aria-label="W.scroll" @click="scrollDown"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v14M4 11l6 6 6-6" /></svg></button>
      <!-- the cards under it all -->
      <slot name="cards" :cards="cards" :md="md">
        <div v-if="cards.length" class="lph-cards" :style="{ '--n': cards.length }">
          <div v-for="(c, i) in cards" :key="i" class="lpcard lph-card lprv" :class="{ ['lpd' + Math.min(3, i)]: i }">
            <img v-if="c.image" :src="c.image" alt="" loading="lazy" />
            <div><h4 v-html="md(c.title)"></h4><p v-if="c.body" v-html="md(c.body)"></p></div>
          </div>
        </div>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lphero-sec { padding: 0; position: relative; border-bottom: 0 }
.lph-words { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: flex-start }
.lph-eyebrow { margin-bottom: 18px }
.lph-av { margin-bottom: 18px }
.lph-quiet { font-weight: 600; font-size: 15.5px; color: var(--ink2); text-decoration: none; padding: 14px 6px }
.lph-quiet:hover { color: var(--ink) }
.lph-cap { margin-bottom: 8px; width: 100%; max-width: 460px }
.lph-stars { margin-top: 22px }
.lph1-words .lph1w i { transform: none; animation: none }
.lph1-still .lph1w i { transform: none; animation: none }
.lph-badges { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px }
.lph-badge { display: inline-flex; align-items: center; gap: 9px; padding: 8px 16px 8px 12px; border-radius: 10px; background: var(--ink); color: var(--paper); text-decoration: none; line-height: 1.1; border: 1px solid var(--hair) }
.lph-badge span { display: flex; flex-direction: column; font-weight: 600; font-size: 14px } .lph-badge small { font-size: 9.5px; font-weight: 500; opacity: .75; letter-spacing: .04em; text-transform: uppercase }
.lph-badge:hover { transform: translateY(-1px) }
.lph-device { position: relative; z-index: 2 }
.lph-phone .lph-device { max-width: 300px; margin: 0 auto }
.lph-arrow { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--hair); background: var(--card); color: var(--ink2); display: grid; place-items: center; cursor: pointer; animation: lph-bob 2.2s ease-in-out infinite; z-index: 3 }
@keyframes lph-bob { 50% { transform: translate(-50%, 6px) } }
@media (prefers-reduced-motion: reduce) { .lph-arrow { animation: none } }
.lph-stats { display: flex; gap: 36px; flex-wrap: wrap; margin: 30px 0 0; padding-top: 22px; border-top: 1px solid var(--hair); align-self: stretch; max-width: 520px }
.lph-stats div { display: flex; flex-direction: column; gap: 2px }
.lph-stats dt { font-family: var(--fd); font-weight: 600; font-size: 30px; letter-spacing: -.02em; line-height: 1; color: var(--ink) }
.lph-stats dd { margin: 0; font-size: 13.5px; color: var(--ink3) }
/* the words alone, or centred with the visual under */
.lphero.lpsolo { grid-template-columns: 1fr; justify-items: center; text-align: center; padding-bottom: 40px }
.lphero.lpsolo .lph-badges { justify-content: center }
.lphero.lpsolo h1 { max-width: 18ch }
.lphero.lpsolo .lpcta { justify-content: center }
.lphero.lpsolo .lph-words { align-items: center }
.lphero.lpsolo .lph-stats { justify-content: center; border-top: 0; padding-top: 4px }
.lphero-centered .lphero { gap: 44px; padding-bottom: 60px }
.lphero-centered .lph-vis { width: min(100%, 980px); margin: 0 auto }
.lphero-centered .lpsub { margin-left: auto; margin-right: auto }
/* the backdrop: words on the picture */
.lph-back { position: absolute; inset: 0; z-index: 0; overflow: hidden }
.lph-back img, .lph-back video, .lph-back iframe { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border: 0 }
.lph-back iframe { width: 177.78vh; min-width: 100%; min-height: 56.25vw; left: 50%; transform: translateX(-50%) }
.lph-scrim { position: absolute; inset: 0; background: linear-gradient(180deg, #0a0a0a88, #0a0a0acc) }
.lphero-backdrop .lphero { padding: 120px 0 110px; min-height: 68vh; align-content: center; color: #fff; --ink: #fff; --ink2: #ffffffd9; --ink3: #ffffffa6; --hair: #ffffff2e; --card: #ffffff14; --btntext: #111 }
.lphero-backdrop .lpbtn { background: #fff; color: #111 }
.lphero-backdrop .lpeyebrow { color: #ffffffd9 }
/* the visuals: a picture, a window, a loop — each a card */
.lph-vis { z-index: 1 }
.lph-img { margin: 0; overflow: hidden; position: relative; z-index: 2 }
.lph-img img { display: block; width: 100%; height: auto }
.lph-frame { position: relative; z-index: 2 }
.lph-frame img { display: block; width: 100%; height: auto }
.lph-addr { flex: 1; margin-left: 8px; padding: 4px 10px; border-radius: 6px; background: var(--card); border: 1px solid var(--hair); font-family: var(--m); font-size: 10.5px; color: var(--ink3); letter-spacing: .02em }
.lph-video { overflow: hidden; position: relative; z-index: 2; aspect-ratio: 16 / 10; padding: 0 }
.lph-video video, .lph-video iframe { display: block; width: 100%; height: 100%; object-fit: cover; border: 0 }
/* the floating card */
.lph-float { position: absolute; z-index: 3; display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 14px; max-width: 260px; box-shadow: var(--shhi) }
.lph-float img { width: 40px; height: 40px; border-radius: 10px; object-fit: cover }
.lph-floatw { display: flex; flex-direction: column; line-height: 1.25 }
.lph-floatw b { font-family: var(--fd); font-weight: 600; font-size: 24px; letter-spacing: -.02em; color: var(--ink) }
.lph-floatw strong { font-size: 14px; font-weight: 600; color: var(--ink) } .lph-floatw i { font-style: normal; font-size: 12.5px; color: var(--ink3) }
.lph-float-br { right: -18px; bottom: 28px } .lph-float-bl { left: -18px; bottom: 28px } .lph-float-tr { right: -18px; top: 28px } .lph-float-tl { left: -18px; top: 28px }
.lph-float-chat { border-radius: 16px 16px 16px 4px; max-width: 240px } .lph-float-chat .lph-floatw strong { font-weight: 500 }
.lph-float-stat .lph-floatw b { font-size: 28px }
.lphero-centered .lph-float-br { right: 24px; bottom: -18px } .lphero-centered .lph-float-bl { left: 24px; bottom: -18px }
/* a phone stands at its own width, so the floats sit beside it, not at the column's far corners */
.lph-vis.lph-phone { width: max-content; max-width: 100%; margin-left: auto; margin-right: auto }
.lph-phone .lph-float-tl, .lph-phone .lph-float-bl { left: auto; right: calc(100% - 24px) } .lph-phone .lph-float-tr, .lph-phone .lph-float-br { left: calc(100% - 24px); right: auto }
.lph-phone .lph-float-tl, .lph-phone .lph-float-tr { top: 18% } .lph-phone .lph-float-bl, .lph-phone .lph-float-br { bottom: 18% }
.lphero-centered .lph-phone .lph-float-br, .lphero-centered .lph-phone .lph-float-bl { bottom: 18% }
/* the floats are always paper, whatever the tone: a card over a picture reads as a card */
[data-look] .lproot .lph-float { background: #fff; color: #111; --ink: #111; --ink2: #333; --ink3: #6b6b6b; --hair: #00000014; border-color: #00000014; width: max-content; backdrop-filter: none }
/* the cards under */
.lph-cards { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(var(--n, 3), minmax(0, 1fr)); gap: 16px; padding-bottom: 64px }
.lph-card { display: flex; gap: 14px; align-items: flex-start; padding: 18px 20px }
.lph-card img { width: 48px; height: 48px; border-radius: 12px; object-fit: cover; flex: none }
.lph-card h4 { font-size: 15.5px; margin-bottom: 4px } .lph-card p { margin: 0; font-size: 13.5px; line-height: 1.45; color: var(--ink2) }
@media (max-width: 980px) { .lph-float { right: 8px; bottom: 12px } .lph-phone .lph-float { position: static; margin: 10px auto 0; width: max-content } .lph-vis.lph-phone { display: flex; flex-direction: column; align-items: center } .lph-cards { grid-template-columns: 1fr; padding-bottom: 44px } .lphero-backdrop .lphero { padding: 80px 0 70px; min-height: 0 } }
@media (max-width: 600px) { .lph-stats { gap: 22px } .lph-stats dt { font-size: 24px } }
</style>

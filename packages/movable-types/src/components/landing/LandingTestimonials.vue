<script setup>
import { ref, computed } from 'vue'
import { md } from './md.js'
import { us } from '@platform-kit/kit/lib/strings.js'
import SectionHead from './SectionHead.vue'
import Ticker from './Ticker.vue'
import Stars from './Stars.vue'
/*
 * Testimonials: what readers say — each a quote, a name, a role, a face (or initials), stars when
 * they gave them, the company's logo when it has one, and for the big one, a stat or two beside
 * the words — as a grid of cards; a wall (masonry, mixed lengths); one at a time with Next and
 * Previous; a switcher (one quote, the faces beneath to change it); or a marquee that never stops.
 * `**bold**` in a quote is the highlighted phrase. The words are the page's; the buttons' are the
 * `sections` strings.
 *
 * Slots for a look's skin: `head` and `quotes`.
 */
const props = defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  layout: { type: String, default: 'grid' },    /* grid | wall | one | switcher | marquee | tweets | bubbles | photo | faces | stack */
  columns: { type: Number, default: 3 },
  more: { type: String, default: '' }, moreHref: { type: String, default: '' },   /* "See all 120 reviews" */
  items: { type: Array, default: () => [] },    /* [{ quote, name, role?, image?, stars?, logo?, stats?: [{ value, label }] }] */
})
const W = (us('sections').testimonials || {}).nav || {}
const at = ref(0)
const n = computed(() => props.items.length)
const go = (d) => { at.value = (at.value + d + n.value) % n.value }
const initials = (name) => String(name || '').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
const big = computed(() => props.items[at.value] || {})
/* the video the page names, opened large */
const playing = ref(-1)
const embedOfSafe = (u) => { try { return (u && /\.(mp4|webm|mov)(\?|$)/i.test(u)) ? { kind: 'file', src: u } : u ? { kind: 'embed', src: u } : null } catch (e) { return null } }
</script>

<template>
  <section class="lpsec lptest" :class="'lptest-' + layout">
    <div class="lpwrap">
      <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead"><SectionHead :eyebrow="eyebrow" :heading="heading" :lead="lead" center /></slot>
      <slot name="quotes" :items="items" :layout="layout" :md="md">
        <!-- one at a time, or the switcher -->
        <div v-if="items.length && (layout === 'one' || layout === 'switcher')" class="lpts-one lprv">
          <figure class="lpts-big lpk" :key="at" :class="{ 'lpts-hasstats': big.stats && big.stats.length }">
            <div class="lpts-bigw">
              <img v-if="big.logo" :src="big.logo" alt="" class="lpts-logo" loading="lazy" />
              <Stars v-if="big.stars" :value="Number(big.stars)" class="lpts-stars" />
              <blockquote v-html="md(big.quote)"></blockquote>
              <figcaption v-if="layout === 'one'">
                <span class="lpts-face"><img v-if="big.image" :src="big.image" :alt="big.name || ''" loading="lazy" /><i v-else>{{ initials(big.name) }}</i></span>
                <b v-html="md(big.name)"></b><span v-if="big.role" v-html="md(big.role)"></span>
              </figcaption>
            </div>
            <dl v-if="big.stats && big.stats.length" class="lpts-stats">
              <div v-for="(s, i) in big.stats" :key="i"><dt class="lpnum" v-html="md(s.value)"></dt><dd v-html="md(s.label)"></dd></div>
            </dl>
          </figure>
          <!-- the switcher: the faces choose -->
          <div v-if="layout === 'switcher'" class="lpts-faces" role="tablist">
            <button v-for="(t, i) in items" :key="i" type="button" class="lpts-facebtn" :class="{ on: i === at }" role="tab" :aria-selected="i === at" :title="t.name" @click="at = i">
              <span class="lpts-face"><img v-if="t.image" :src="t.image" :alt="t.name || ''" loading="lazy" /><i v-else>{{ initials(t.name) }}</i></span>
            </button>
            <span class="lpts-who"><b v-html="md(big.name)"></b><span v-if="big.role" v-html="md(big.role)"></span></span>
          </div>
          <div v-else-if="n > 1" class="lpts-nav">
            <button type="button" class="lpts-btn" :aria-label="W.previous" @click="go(-1)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8H2M7 3L2 8l5 5" /></svg></button>
            <span class="lpts-count lpnum">{{ (W.of || '{n} of {total}').replace('{n}', at + 1).replace('{total}', n) }}</span>
            <button type="button" class="lpts-btn" :aria-label="W.next" @click="go(1)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h12M9 3l5 5-5 5" /></svg></button>
          </div>
        </div>
        <!-- tweets: a handle, the words, a tag -->
        <div v-if="items.length && layout === 'tweets'" class="lpts-grid" :class="['lpts-c' + Math.min(4, Math.max(2, columns))]">
          <figure v-for="(t, i) in items" :key="i" class="lpcard lpts lpts-tweet lprv" :class="{ ['lpd' + Math.min(3, i % 4)]: i % 4 }">
            <figcaption>
              <span class="lpts-face"><img v-if="t.image" :src="t.image" :alt="t.name || ''" loading="lazy" /><i v-else>{{ initials(t.name) }}</i></span>
              <span class="lpts-who"><b v-html="md(t.name)"></b><span v-if="t.handle">@{{ String(t.handle).replace(/^@+/, '') }}</span><span v-else-if="t.role" v-html="md(t.role)"></span></span>
              <svg class="lpts-bird" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 4l12 12M16 4L4 16" /></svg>
            </figcaption>
            <blockquote class="lpts-tweetq" v-html="md(t.quote)"></blockquote>
          </figure>
        </div>
        <!-- bubbles: the quote in a pill beside the face -->
        <div v-else-if="items.length && layout === 'bubbles'" class="lpts-bubbles lprv">
          <figure v-for="(t, i) in items" :key="i" class="lpts-bubble lpk" :style="{ '--k': (0.05 + i * 0.07) + 's' }">
            <span class="lpts-face"><img v-if="t.image" :src="t.image" :alt="t.name || ''" loading="lazy" /><i v-else>{{ initials(t.name) }}</i></span>
            <blockquote v-html="md(t.quote)"></blockquote><figcaption>— <b v-html="md(t.name)"></b></figcaption>
          </figure>
        </div>
        <!-- photo: the big picture beside the quote, one at a time -->
        <div v-else-if="items.length && layout === 'photo'" class="lpts-photo lprv" :key="at">
          <figure class="lpcard lpts-photofig"><img v-if="big.image" :src="big.image" :alt="big.name || ''" loading="lazy" /><figcaption v-if="big.name"><b v-html="md(big.name)"></b><span v-if="big.role" v-html="md(big.role)"></span></figcaption></figure>
          <div class="lpts-photow">
            <img v-if="big.logo" :src="big.logo" alt="" class="lpts-logo" loading="lazy" />
            <Stars v-if="big.stars" :value="Number(big.stars)" class="lpts-stars" />
            <blockquote v-html="md(big.quote)"></blockquote>
            <div v-if="n > 1" class="lpts-nav">
              <button type="button" class="lpts-btn" :aria-label="W.previous" @click="go(-1)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8H2M7 3L2 8l5 5" /></svg></button>
              <span class="lpts-count lpnum">{{ (W.of || '{n} of {total}').replace('{n}', at + 1).replace('{total}', n) }}</span>
              <button type="button" class="lpts-btn" :aria-label="W.next" @click="go(1)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h12M9 3l5 5-5 5" /></svg></button>
            </div>
          </div>
        </div>
        <!-- faces: portraits in a grid, a name on each, the quote on hover -->
        <div v-else-if="items.length && layout === 'faces'" class="lpts-faces-grid lprv">
          <figure v-for="(t, i) in items" :key="i" class="lpts-facecard lpk" :class="{ 'lpts-hasvideo': !!t.video }" :style="{ '--k': (0.03 + i * 0.05) + 's' }" tabindex="0">
            <img v-if="t.image" :src="t.image" :alt="t.name || ''" loading="lazy" decoding="async" />
            <span v-else class="lpts-facefill"><i>{{ initials(t.name) }}</i></span>
            <button v-if="t.video" type="button" class="lpts-play" :aria-label="t.name" @click="playing = i"><svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor"><path d="M6.5 4.5l9 5.5-9 5.5z"/></svg></button>
            <figcaption><b v-html="md(t.name)"></b><span v-if="t.role" v-html="md(t.role)"></span><q v-if="t.quote" v-html="md(t.quote)"></q></figcaption>
          </figure>
          <div v-if="playing >= 0" class="lpts-dlg" @click.self="playing = -1"><div class="lpts-dlgin"><video v-if="embedOfSafe(items[playing].video) && embedOfSafe(items[playing].video).kind === 'file'" :src="items[playing].video" controls autoplay playsinline></video><iframe v-else :src="items[playing].video" allow="autoplay; fullscreen" allowfullscreen></iframe><button type="button" class="lpts-dlgx" @click="playing = -1">×</button></div></div>
        </div>
        <!-- the stack: one card in front, the others peeking behind, the arrows turn the deck -->
        <div v-else-if="items.length && layout === 'stack'" class="lpts-stack lprv">
          <div class="lpts-deck">
            <figure v-for="(t, i) in items" :key="i" class="lpcard lpcard-solid lpts lpts-deckcard" :style="{ '--d': (i - at + n) % n, zIndex: n - ((i - at + n) % n) }" :class="{ on: (i - at + n) % n === 0 }">
              <div class="lpts-top"><Stars v-if="t.stars" :value="Number(t.stars)" class="lpts-stars" /><img v-if="t.logo" :src="t.logo" alt="" class="lpts-logo lpts-logo-s" loading="lazy" /></div>
              <blockquote v-html="md(t.quote)"></blockquote>
              <figcaption><span class="lpts-face"><img v-if="t.image" :src="t.image" :alt="t.name || ''" loading="lazy" /><i v-else>{{ initials(t.name) }}</i></span><span class="lpts-who"><b v-html="md(t.name)"></b><span v-if="t.role" v-html="md(t.role)"></span></span></figcaption>
            </figure>
          </div>
          <div v-if="n > 1" class="lpts-nav">
            <button type="button" class="lpts-btn" :aria-label="W.previous" @click="go(-1)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8H2M7 3L2 8l5 5" /></svg></button>
            <span class="lpts-count lpnum">{{ (W.of || '{n} of {total}').replace('{n}', at + 1).replace('{total}', n) }}</span>
            <button type="button" class="lpts-btn" :aria-label="W.next" @click="go(1)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h12M9 3l5 5-5 5" /></svg></button>
          </div>
        </div>
        <!-- the marquee: cards on the move -->
        <Ticker v-else-if="items.length && layout === 'marquee'" class="lpts-tk lprv" :speed="30">
          <figure v-for="(t, i) in items" :key="i" class="lpcard lpts lpts-tkcard">
            <Stars v-if="t.stars" :value="Number(t.stars)" class="lpts-stars" />
            <blockquote v-html="md(t.quote)"></blockquote>
            <figcaption>
              <span class="lpts-face"><img v-if="t.image" :src="t.image" :alt="t.name || ''" loading="lazy" /><i v-else>{{ initials(t.name) }}</i></span>
              <span class="lpts-who"><b v-html="md(t.name)"></b><span v-if="t.role" v-html="md(t.role)"></span></span>
              <img v-if="t.logo" :src="t.logo" alt="" class="lpts-logo lpts-logo-s" loading="lazy" />
            </figcaption>
          </figure>
        </Ticker>
        <!-- the grid, or the wall -->
        <div v-else-if="items.length" class="lpts-grid" :class="['lpts-c' + Math.min(4, Math.max(2, columns))]">
          <figure v-for="(t, i) in items" :key="i" class="lpcard lpts lprv" :class="{ ['lpd' + Math.min(3, i % 3)]: i % 3 }">
            <div class="lpts-top"><Stars v-if="t.stars" :value="Number(t.stars)" class="lpts-stars" /><img v-if="t.logo" :src="t.logo" alt="" class="lpts-logo lpts-logo-s" loading="lazy" /></div>
            <blockquote v-html="md(t.quote)"></blockquote>
            <figcaption>
              <span class="lpts-face"><img v-if="t.image" :src="t.image" :alt="t.name || ''" loading="lazy" /><i v-else>{{ initials(t.name) }}</i></span>
              <span class="lpts-who"><b v-html="md(t.name)"></b><span v-if="t.role" v-html="md(t.role)"></span></span>
            </figcaption>
          </figure>
        </div>
        <p v-if="more" class="lpts-more lprv"><a :href="moreHref || '#'" v-html="md(more)"></a></p>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lpts-grid { display: grid; gap: 18px; align-items: start }
.lpts-c2 { grid-template-columns: repeat(2, minmax(0, 1fr)) } .lpts-c3 { grid-template-columns: repeat(3, minmax(0, 1fr)) } .lpts-c4 { grid-template-columns: repeat(4, minmax(0, 1fr)) }
/* the wall: columns of mixed heights */
.lptest-wall .lpts-grid { display: block; columns: 3; column-gap: 18px }
.lptest-wall .lpts { break-inside: avoid; margin-bottom: 18px }
.lpts { margin: 0; padding: 24px 24px 22px; display: flex; flex-direction: column; gap: 16px }
.lpts-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 0 } .lpts-top:empty { display: none }
.lpts blockquote { margin: 0; font-family: var(--fd); font-size: 18px; line-height: 1.5; color: var(--ink); text-wrap: pretty }
.lpts blockquote::before { content: '“'; color: var(--accent2); margin-right: 1px }
.lpts blockquote::after { content: '”'; color: var(--accent2) }
.lpts blockquote :deep(strong), .lpts-big blockquote :deep(strong) { font-weight: inherit; background: linear-gradient(transparent 55%, var(--accentbg) 55%); color: var(--accent2) }
.lpts figcaption, .lpts-big figcaption { display: flex; align-items: center; gap: 12px; font-size: 14px }
.lpts-who { display: flex; flex-direction: column; line-height: 1.3; min-width: 0 }
.lpts figcaption b, .lpts-big figcaption b { font-weight: 600; color: var(--ink) }
.lpts-who > span, .lpts-big figcaption > span:last-child { color: var(--ink3) }
.lpts-face { flex: none; width: 40px; height: 40px; border-radius: 50%; overflow: hidden; background: var(--accentbg); display: grid; place-items: center }
.lpts-face img { width: 100%; height: 100%; object-fit: cover; display: block }
.lpts-face i { font: 600 13px var(--m); font-style: normal; color: var(--accent2); letter-spacing: .04em }
.lpts-logo { height: 26px; width: auto; object-fit: contain; opacity: .7 } .lpts-logo-s { height: 20px; margin-left: auto }
.lpts-more { margin: 26px 0 0; text-align: center; font-size: 14.5px; width: 100% } .lpts-more a { color: var(--accent2); font-weight: 600; text-decoration: none }
/* one at a time */
.lpts-one { max-width: 860px; margin: 0 auto; text-align: center }
.lpts-big { margin: 0; animation: lpts-in .45s cubic-bezier(.2,.8,.2,1) }
@keyframes lpts-in { from { opacity: 0; transform: translateY(10px) } }
.lpts-bigw { display: flex; flex-direction: column; align-items: center; gap: 18px }
.lpts-bigw .lpts-logo { height: 30px }
.lpts-big blockquote { margin: 0; font-family: var(--fd); font-size: clamp(22px, 2.8vw, 32px); line-height: 1.35; letter-spacing: -.01em; color: var(--ink); text-wrap: balance }
.lpts-big blockquote::before { content: '“'; color: var(--accent2) } .lpts-big blockquote::after { content: '”'; color: var(--accent2) }
.lpts-big figcaption { justify-content: center; flex-wrap: wrap; gap: 8px 12px; margin-top: 8px }
.lpts-hasstats { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 40px; align-items: center; text-align: left }
.lpts-hasstats .lpts-bigw { align-items: flex-start } .lpts-hasstats figcaption { justify-content: flex-start }
.lpts-stats { display: flex; flex-direction: column; gap: 22px; margin: 0; padding-left: 40px; border-left: 1px solid var(--hair) }
.lpts-stats div { display: flex; flex-direction: column; gap: 4px }
.lpts-stats dt { font-family: var(--fd); font-weight: 600; font-size: 40px; line-height: 1; letter-spacing: -.03em; color: var(--ink) }
.lpts-stats dd { margin: 0; font-size: 13.5px; color: var(--ink3) }
.lpts-nav { display: inline-flex; align-items: center; gap: 14px; margin-top: 28px }
.lpts-btn { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; color: var(--ink); background: var(--card); border: 1px solid var(--hair); cursor: pointer; transition: transform .15s, border-color .15s }
.lpts-btn:hover { transform: translateY(-1px); border-color: var(--ink3) }
.lpts-count { font-family: var(--m); font-size: 11.5px; color: var(--ink3); letter-spacing: .06em }
/* the switcher */
.lpts-faces { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 28px; flex-wrap: wrap }
.lpts-facebtn { padding: 0; border: 0; background: none; cursor: pointer; border-radius: 50%; opacity: .5; transition: opacity .2s, transform .2s }
.lpts-facebtn .lpts-face { width: 46px; height: 46px; border: 2px solid transparent }
.lpts-facebtn.on { opacity: 1; transform: scale(1.08) } .lpts-facebtn.on .lpts-face { border-color: var(--accent) }
.lpts-facebtn:hover { opacity: 1 }
.lpts-faces .lpts-who { margin-left: 12px; text-align: left; font-size: 14px }
/* tweets */
.lpts-tweet { gap: 12px } .lpts-tweet figcaption { position: relative } .lpts-bird { margin-left: auto; color: var(--ink3) }
.lpts-tweetq { font-family: var(--f, inherit) !important; font-size: 15px !important; line-height: 1.5 !important } .lpts-tweetq::before, .lpts-tweetq::after { content: none !important }
.lpts-tweetq :deep(a), .lpts-tweetq :deep(em) { color: var(--accent2); font-style: normal }
/* bubbles */
.lpts-bubbles { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px 14px; max-width: 980px; margin: 0 auto }
.lpts-bubble { margin: 0; display: inline-flex; align-items: center; gap: 12px; padding: 8px 18px 8px 8px; border-radius: 999px; background: var(--card); border: 1px solid var(--hair); box-shadow: var(--sh); max-width: 100% }
.lpts-bubble .lpts-face { width: 34px; height: 34px }
.lpts-bubble blockquote { margin: 0; font-size: 14px; color: var(--ink) } .lpts-bubble figcaption { font-size: 13px; color: var(--ink3); white-space: nowrap } .lpts-bubble figcaption b { color: var(--ink2); font-weight: 500 }
/* the photo */
.lpts-photo { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 48px; align-items: center; max-width: 980px; margin: 0 auto; animation: lpts-in .45s cubic-bezier(.2,.8,.2,1) }
.lpts-photofig { margin: 0; overflow: hidden; position: relative; padding: 0; aspect-ratio: 4 / 5 } .lpts-photofig img { width: 100%; height: 100%; object-fit: cover; display: block }
.lpts-photofig figcaption { position: absolute; left: 0; right: 0; bottom: 0; padding: 40px 18px 16px; background: linear-gradient(180deg, transparent, #000000b0); color: #fff; display: flex; flex-direction: column; gap: 2px } .lpts-photofig figcaption b { color: #fff }
.lpts-photow { display: flex; flex-direction: column; align-items: flex-start; gap: 18px; text-align: left }
.lpts-photow blockquote { margin: 0; font-family: var(--fd); font-size: clamp(22px, 2.6vw, 30px); line-height: 1.35; letter-spacing: -.01em; color: var(--ink) } .lpts-photow blockquote::before { content: '“'; color: var(--accent2) } .lpts-photow blockquote::after { content: '”'; color: var(--accent2) }
.lpts-photow .lpts-nav { margin-top: 8px }
/* faces */
.lpts-faces-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; position: relative }
.lpts-facecard { position: relative; margin: 0; aspect-ratio: 1; overflow: hidden; border-radius: 12px; background: var(--wash); outline: none }
.lpts-facecard img, .lpts-facefill { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: grid; place-items: center }
.lpts-facefill i { font: 600 28px var(--fd); font-style: normal; color: var(--accent2) }
.lpts-facecard figcaption { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; gap: 2px; padding: 12px; color: #fff; background: linear-gradient(180deg, transparent 40%, #000000c0); font-size: 12.5px; opacity: 0; transition: opacity .25s }
.lpts-facecard figcaption b { color: #fff; font-size: 14px } .lpts-facecard q { font-family: var(--fd); font-size: 13px; opacity: .9; margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden }
.lpts-facecard:hover figcaption, .lpts-facecard:focus-visible figcaption, .lpts-facecard:nth-child(3n) figcaption { opacity: 1 }
.lpts-play { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 44px; height: 44px; border-radius: 50%; border: 0; background: #fff; color: #111; display: grid; place-items: center; cursor: pointer; box-shadow: 0 10px 30px -6px #0008; z-index: 2 } .lpts-play svg { margin-left: 3px }
.lpts-dlg { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; background: #0a0a0acc; backdrop-filter: blur(8px); padding: 24px }
.lpts-dlgin { position: relative; width: min(960px, 100%); aspect-ratio: 16 / 9; background: #000; border-radius: 12px; overflow: hidden }
.lpts-dlgin video, .lpts-dlgin iframe { width: 100%; height: 100%; border: 0; display: block }
.lpts-dlgx { position: absolute; top: 10px; right: 10px; width: 36px; height: 36px; border-radius: 50%; border: 0; background: #ffffff33; color: #fff; font-size: 22px; cursor: pointer }
/* the stack */
.lpts-stack { display: flex; flex-direction: column; align-items: center; gap: 28px }
.lpts-deck { position: relative; width: min(100%, 520px); height: 300px }
.lpts-deckcard { position: absolute; inset: 0; transform: translateY(calc(var(--d) * 14px)) scale(calc(1 - var(--d) * .05)); opacity: calc(1 - var(--d) * .28); transition: transform .5s cubic-bezier(.2,.8,.2,1), opacity .4s; padding: 28px }
.lpts-deckcard:not(.on) { pointer-events: none }
/* the marquee */
.lpts-tk { margin: 0 -28px }
.lpts-tkcard { width: 360px; margin: 0 9px; flex: none }
@media (max-width: 980px) { .lpts-faces-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) } .lpts-photo { grid-template-columns: 1fr; gap: 24px } .lpts-photofig { aspect-ratio: 16 / 10 } .lpts-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) } .lptest-wall .lpts-grid { columns: 2 } .lpts-hasstats { grid-template-columns: 1fr; gap: 24px } .lpts-stats { flex-direction: row; padding-left: 0; border-left: 0; gap: 32px } }
@media (max-width: 600px) { .lpts-faces-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) } .lpts-deck { height: 340px } .lpts-grid { grid-template-columns: 1fr } .lptest-wall .lpts-grid { columns: 1 } .lpts-tkcard { width: 290px } }
</style>

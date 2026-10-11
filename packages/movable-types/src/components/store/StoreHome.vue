<script setup>
/*
 * The storefront: a hero, the collections, a featured rail, the shelves, the membership,
 * each collection's shelf, and what the store promises. What it says and shows
 * — and in what order — is arranged in content/store/storefront.md; the
 * section headings and the promise are chrome, in content/app/ui/store.md.
 * A draft of the settings from the admin's live preview arrives through inject.
 */
import { ref, computed, inject } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { tiers, arrange, products, bookHref } from '@platform-kit/kit/lib/storefront.js'
import { money, subscribe, openPortal } from '@platform-kit/kit/lib/commerce.js'
import { isSignedIn, userClass, checkoutResult, hasTier } from '@platform-kit/kit/lib/auth.js'
import { capture } from '@platform-kit/kit/lib/analytics.js'
import Carousel from './Carousel.vue'
import ProductCard from './ProductCard.vue'
import Book3D from '../Book3D.vue'
import SiteClose from '../SiteClose.vue'

const T = us('store')
const HD = T.page.head
const S = T.home.sections
const PR = T.home.promise
/* the strip at the foot: four lines, each its own word — a blank one leaves its slot out */
const ST = T.home.strip || {}
/* the band that says what an edition is: three short points */
const ED = T.home.editions || {}
/* the hero's books: three poses, the middle one fullest */
const POSES = [{ x: 0, y: -9 }, { x: 0, y: 0 }, { x: 0, y: 9 }]
const CU = T.collection.ui

const preview = inject('dl-preview', null)
const A = computed(() => arrange(preview ? preview.value : null))
const hero = computed(() => A.value.hero)
/* the title, with one *word* in italic: the markdown's asterisks, nothing else */
const esc = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const heroTitle = computed(() => esc(hero.value.title).replace(/\*([^*]+)\*/g, '<em>$1</em>'))
/* the row under the buttons: the price the shelf starts at, what comes with a copy, where it ships */
const HR = T.home.hero || {}
const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const fromPrice = computed(() => { const ps = products.value.filter((p) => p.kind === 'print' && p.available && p.unit_amount > 0); return ps.length ? money(Math.min(...ps.map((p) => p.unit_amount)), ps[0].currency).replace(/\.00$/, '') : '' })
const heroPoints = computed(() => [fromPrice.value ? fill(HR.from, { price: fromPrice.value }) : '', HR.files, HR.ships].filter(Boolean))

const isMember = computed(() => userClass.value === 'subscribed')
const busy = ref(false)
const error = ref('')
const errorCode = ref('')
async function run(fn, evt) {
  if (!isSignedIn.value) { if (window.DLauth) window.DLauth.open(); return }
  busy.value = true; error.value = ''; errorCode.value = ''
  if (evt) capture('click', evt)
  try { await fn() } catch (e) { error.value = (e && e.message) || HD['error-heading']; errorCode.value = (e && e.code) || '' } finally { busy.value = false }
}
const join = (m) => run(() => subscribe(m.sku), { kind: 'subscribe', product_id: m.sku })
const manage = () => run(() => openPortal())
const perText = (p) => (p.recurring ? ' ' + (S['per-' + (p.interval || 'month')] || '') : '')
const shelf = (c) => c.items.slice(0, 12)
</script>

<template>
  <div class="sf lproot lpfull">
    <!-- the landing's ground: dusk to light by day, the navy by night -->
    <div class="lpbg"></div>
    <div class="lpblobs"><span class="lpblob lpb1"></span><span class="lpblob lpb2"></span><span class="lpblob lpb3"></span></div>
    <div class="lpgrain"></div>
    <!-- back from Stripe -->
    <div v-if="checkoutResult === 'success' || checkoutResult === 'cancel'" class="wrapwide">
      <div v-if="checkoutResult === 'success'" class="sf-notice ok"><b>{{ HD['success-heading'] }}</b><p>{{ HD['success-subtitle'] }}</p></div>
      <div v-else class="sf-notice"><b>{{ HD['cancel-heading'] }}</b><p>{{ HD['cancel-subtitle'] }}</p></div>
    </div>

    <!-- hero: its own colour scheme, so the front of the store opens with a beat -->
    <section class="sf-hero">
      <div class="sf-hero-in wrapwide" :class="{ 'sf-hero-noart': !hero.image && !A.heroBooks.length }">
        <div class="sf-hero-copy">
          <span v-if="hero.eyebrow" class="lpeyebrow">{{ hero.eyebrow }}</span>
          <h1 class="sf-title" v-html="heroTitle"></h1>
          <p v-if="hero.subtitle" class="sf-subtitle">{{ hero.subtitle }}</p>
          <div v-if="hero.primary || hero.secondary" class="lpcta">
            <a v-if="hero.primary" class="lpbtn" :href="hero.primary.href"><span>{{ hero.primary.label }}</span><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5" /></svg></a>
            <a v-if="hero.secondary" class="sf-hero-more" :href="hero.secondary.href">{{ hero.secondary.label }} →</a>
          </div>
          <ul v-if="heroPoints.length" class="sf-hero-points">
            <li v-for="(pt, i) in heroPoints" :key="i">{{ pt }}</li>
          </ul>
        </div>
        <a v-if="hero.image" class="sf-hero-art" :href="(hero.primary && hero.primary.href) || '#collections'" aria-hidden="true" tabindex="-1">
          <img :src="hero.image" alt="" loading="eager" decoding="async" />
        </a>
        <!-- the books themselves, as they are printed -->
        <div v-else-if="A.heroBooks.length" class="sf-hero-books" :class="'n' + A.heroBooks.length" aria-hidden="true">
          <a v-for="(b, i) in A.heroBooks" :key="b.slug" class="sf-hero-book" :href="bookHref(b.slug)" tabindex="-1">
            <Book3D :art="b.art" :fallback-art="b.fallbackArt" :dims="b.dims" :binding="b.binding" :trim="b.trim" :pages="b.pages" :cloth="b.binding !== 'softcover' ? (b.cloth || 'black') : ''" :foil="b.binding === 'softcover' ? '' : (b.foil || 'gold')" :foil-layer="b.foilArt || ''" :jacket="b.jacket" :edges="b.edges" :sheets="b.sheets || []" :title="b.title" :author="b.author" mode="still" anchor="floor" :fill="i === 1 ? 0.92 : 0.8" :pose="POSES[i] || POSES[1]" />
          </a>
        </div>
      </div>
    </section>

    <!-- what an edition is -->
    <section v-if="A.showEditions && ED.title" class="sf-editions wrapwide">
      <div class="sf-editions-head">
        <span v-if="ED.eyebrow" class="sf-eyebrow">{{ ED.eyebrow }}</span>
        <h2>{{ ED.title }}</h2>
      </div>
      <div class="sf-editions-grid">
        <div v-for="k in ['one', 'two', 'three']" :key="k" class="sf-edition">
          <i class="sf-edition-n" aria-hidden="true">{{ ['I', 'II', 'III'][['one', 'two', 'three'].indexOf(k)] }}</i>
          <h3>{{ ED[k + '-title'] }}</h3>
          <p>{{ ED[k + '-line'] }}</p>
        </div>
      </div>
    </section>

    <!-- collections -->
    <section v-if="A.showCollections && A.tiles.length" id="collections" class="sf-sec wrapwide">
      <header class="sf-sechead row">
        <h2>{{ S.collections }}</h2>
        <a class="sf-more" href="/store/collections">{{ CU.all }} →</a>
      </header>
      <div class="sf-tiles" :class="'n' + Math.min(A.tiles.length, 3)">
        <a v-for="c in A.tiles" :key="c.id" class="sf-tile" :href="c.href">
          <div class="sf-tile-media">
            <img v-if="c.image" :src="c.image" alt="" loading="lazy" decoding="async" />
            <div v-else class="sf-tile-shelf">
              <img v-for="(im, i) in c.covers" :key="i" :src="im.src" alt="" loading="lazy" decoding="async"
                   :style="im.blur ? { backgroundImage: 'url(' + im.blur + ')', backgroundSize: 'cover' } : null" />
            </div>
          </div>
          <div class="sf-tile-body">
            <h3>{{ c.title }}</h3>
            <p v-if="c.subtitle">{{ c.subtitle }}</p>
            <span class="sf-tile-n">{{ c.items.length }} {{ c.items.length === 1 ? CU.piece : CU.pieces }} →</span>
          </div>
        </a>
      </div>
    </section>

    <!-- featured -->
    <section v-if="A.showFeatured && A.rail.length" class="sf-sec wrapwide">
      <header class="sf-sechead"><h2>{{ S.featured }}</h2><p>{{ S['featured-subtitle'] }}</p></header>
      <Carousel :items="A.rail" class="sf-rail">
        <template #item="{ item, index }"><ProductCard :product="item" :eager="index < 3" /></template>
      </Carousel>
    </section>

    <!-- a shelf per collection -->
    <section v-for="c in A.shelves" :id="'shelf-' + c.id" :key="'shelf-' + c.id" class="sf-sec wrapwide">
      <header class="sf-sechead row">
        <div><h2>{{ c.title }}</h2><p v-if="c.subtitle">{{ c.subtitle }}</p></div>
        <a class="sf-more" :href="c.href">{{ S['view-all'] }} →</a>
      </header>
      <div class="sf-grid">
        <ProductCard v-for="p in shelf(c)" :key="p.id" :product="p" />
      </div>
      <p v-if="!c.items.length" class="sf-empty">{{ CU.empty }}</p>
    </section>

    <!-- the note under the shelves: what a buyer wants to know before the membership band -->
    <section class="sf-promise wrapwide">
      <div class="sf-promise-in">        
        <div v-if="ST.secure"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M5 9V6.5a5 5 0 0 1 10 0V9" stroke-linecap="round" /><rect x="4" y="9" width="12" height="8" rx="2" /></svg>{{ ST.secure }}</div>
        <div v-if="ST.ships"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2.5 6h10v8h-10zM12.5 9h3l2 2.5V14h-5z" /><circle cx="6" cy="15" r="1.6" /><circle cx="14.5" cy="15" r="1.6" /></svg>{{ ST.ships }}</div>
        <div v-if="ST.final"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 10.5l4 4 8-9" stroke-linecap="round" /></svg>{{ ST.final }}</div>
      </div>
    </section>

    <!-- the memberships: the band's words, then a card per tier, lowest first -->
    <section v-if="tiers.length && A.showMembership" class="sf-member">
      <div class="sf-member-in wrapwide">
        <div class="sf-member-copy">
          <span class="sf-eyebrow light">{{ S['membership-eyebrow'] }}</span>
          <h2>{{ S['membership-title'] }}</h2>
          <p class="sf-member-subtitle">{{ S['membership-subtitle'] }}</p>
          <ul class="sf-member-points">
            <li>{{ S['membership-point-1'] }}</li><li>{{ S['membership-point-2'] }}</li><li>{{ S['membership-point-3'] }}</li>
          </ul>
          <p v-if="error" class="sf-err light">{{ errorCode === 'stripe_unconfigured' ? HD['unconfigured-heading'] : error }}</p>
        </div>
        <div class="sf-tiers">
          <!-- one card per tier; each way to pay for it (weekly, monthly) is its own offer and button -->
          <div v-for="t in tiers" :key="t.tier" class="sf-tier" :class="{ held: hasTier(t.tier) }">
            <a class="sf-tier-title" :href="t.href">{{ t.title }}</a>
            <span v-if="t.subtitle" class="sf-tier-sub">{{ t.subtitle }}</span>
            <template v-if="hasTier(t.tier)">
              <div class="sf-member-row">
                <span class="sf-member-active">{{ S['membership-active'] }}</span>
                <button type="button" class="sf-btn light ghost" :disabled="busy" @click="manage">{{ S['membership-manage'] }}</button>
              </div>
            </template>
            <div v-for="m in t.offers" v-else :key="m.id" class="sf-member-row sf-offer">
              <span v-if="m.available" class="sf-member-price">{{ money(m.unit_amount, m.currency) }}<small>{{ perText(m) }}</small></span>
              <button v-if="m.available" type="button" class="sf-btn light" :disabled="busy" @click="join(m)">{{ isMember ? S['membership-switch'] : S['membership-cta'] }}</button>
            </div>
          </div>
        </div>
      </div>
    </section>


    <!-- and the site's close: the landing's own last section, its light centred at the foot -->
    <SiteClose />
  </div>
</template>

<style scoped>
.sf { --sf-gap: clamp(56px, 8vw, 110px); padding-bottom: 0 }
.sf :deep(.siteclose) { margin-top: var(--sf-gap) }
.sf-eyebrow { display: block; font-family: var(--m); font-size: 10.5px; letter-spacing: .16em; text-transform: uppercase; color: var(--accent2); margin-bottom: 14px }
.sf-eyebrow.light { color: var(--accent) }
.sf-btn { display: inline-flex; align-items: center; justify-content: center; font: inherit; font-size: 15px; font-weight: 600; color: var(--paper); background: var(--ink);
  border: 1px solid var(--ink); border-radius: 999px; padding: 13px 24px; cursor: pointer; text-decoration: none; transition: transform .14s, box-shadow .14s }
.sf-btn:hover { transform: translateY(-1px); box-shadow: 0 12px 28px -14px #000a }
.sf-btn:disabled { opacity: .6; cursor: default; transform: none }
.sf-btn.ghost { color: var(--ink); background: transparent; border-color: var(--hair) }
.sf-btn.ghost:hover { border-color: var(--ink3) }
.sf-btn.light { color: #0a1220; background: #edf1f8; border-color: #edf1f8 }
.sf-btn.light.ghost { color: #edf1f8; background: transparent; border-color: #ffffff33 }

.sf-notice { margin-top: 26px; padding: 16px 20px; border: 1px solid var(--hair); border-radius: 14px; background: var(--card) }
.sf-notice.ok { border-color: color-mix(in srgb, var(--accent) 40%, transparent) }
.sf-notice b { font-family: var(--fd); font-weight: 600; font-size: 17px } .sf-notice p { margin: 4px 0 0; color: var(--ink2) }

/* hero — on the landing's ground, in the landing's type: the eyebrow's dot, the title with one
   word in the accent, the black pill, the fine print; the books beside, standing on a shelf of light */
.sf { position: relative; isolation: isolate; padding-top: var(--headh) }   /* the header sits over the ground, as on the landing */
.sf > :not(.lpbg):not(.lpblobs):not(.lpgrain) { position: relative; z-index: 1 }
.sf-hero { padding: clamp(40px, 6vw, 84px) 0 clamp(36px, 5vw, 64px); border: 0 }
.sf-hero-in { display: grid; grid-template-columns: minmax(0, 11fr) minmax(0, 13fr); gap: clamp(24px, 4vw, 56px); align-items: center }
.sf-title { font-family: var(--fd); font-weight: 600; font-size: clamp(38px, 4.8vw, 64px); line-height: 1.02; letter-spacing: -.03em; margin: 16px 0 22px; text-wrap: balance; color: var(--ink) }
.sf-title :deep(em) { font-style: italic; font-weight: 500; color: var(--accent2) }
.sf-subtitle { font-size: clamp(16px, 1.3vw, 19px); line-height: 1.5; color: var(--ink2); max-width: 46ch; margin: 0 0 28px }
.sf-hero-more { font-size: 15px; font-weight: 600; color: var(--ink); text-decoration: none }
.sf-hero-more:hover { color: var(--accent2) }
.sf-hero-points { list-style: none; margin: 28px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 22px; font-family: var(--m); font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink3) }
.sf-hero-points li { display: inline-flex; align-items: center; gap: 9px }
.sf-hero-points li::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); opacity: .9 }
/* no picture: the words take the width, the title larger, the subtitle to a measure */
.sf-hero-noart { grid-template-columns: minmax(0, 1fr) } .sf-hero-noart .sf-hero-copy { max-width: 760px } .sf-hero-noart .sf-subtitle { max-width: 52ch }
/* the hero's books: three printed books side by side, the middle one nearest, lit from above */
.sf-hero-books { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; gap: 5%; height: clamp(300px, 32vw, 480px); position: relative; margin: 0 }
.sf-hero-books.n1 { grid-template-columns: 1fr } .sf-hero-books.n2 { grid-template-columns: 1fr 1fr }
.sf-hero-book { display: block; height: 100%; transition: transform .6s cubic-bezier(.2, .8, .2, 1) }
.sf-hero-book :deep(.b3) { height: 100%; aspect-ratio: auto }
.sf-hero-book { transform-origin: 50% 92% }
.sf-hero-book:nth-child(2) { z-index: 1 }
.sf-hero-book:hover { transform: translateY(-1.5%) }

/* on a phone the row is sized by its width, never taller than three books fit — a fixed height made the
   books wider than their columns and the outer two ran off the screen */
@media (max-width: 760px) { .sf-hero-books { height: clamp(150px, 40vw, 270px); gap: 4%; margin: 8px 0 0 } }
.sf-hero-art { display: block; border-radius: 24px; overflow: hidden; aspect-ratio: 20 / 11; background: var(--wash); box-shadow: var(--shhi) }
.sf-hero-art img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 1.2s cubic-bezier(.2, .8, .2, 1) }
.sf-hero-art:hover img { transform: scale(1.03) }

/* sections */
/* the site's stylesheet rules a hairline under every section and header; the storefront has none */
.sf-sec { margin-top: var(--sf-gap); border: 0; padding-block: 0 }
.sf-sechead, .sf-editions { border: 0 }
/* what an edition is: an eyebrow and a line, then three numbered points on a ruled band */
.sf-editions { margin-top: calc(var(--sf-gap) * .8); padding-block: 0; border: 0 }
.sf-editions + .sf-sec { margin-top: calc(var(--sf-gap) * .7) }
.sf-editions-head { max-width: 640px; margin-bottom: 34px }
.sf-editions-head h2 { font-family: var(--fd); font-weight: 600; font-size: clamp(28px, 3.4vw, 44px); letter-spacing: -.025em; line-height: 1.05; margin: 0; text-wrap: balance }
.sf-editions-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; padding-top: 8px }
.sf-edition h3 { font-family: var(--fd); font-weight: 600; font-size: 19px; letter-spacing: -.01em; margin: 10px 0 8px }
.sf-edition p { margin: 0; color: var(--ink2); font-size: 15px; line-height: 1.55; max-width: 34ch }
.sf-edition-n { font-style: normal; font-family: var(--m); font-size: 11px; letter-spacing: .14em; color: var(--accent2) }
@media (max-width: 760px) { .sf-editions-grid { grid-template-columns: 1fr; gap: 22px } }
.sf-sechead { margin-bottom: 26px; padding-block: 0 }
.sf-sechead.row { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px }
.sf-sechead h2 { font-family: var(--fd); font-weight: 600; font-size: clamp(26px, 3vw, 36px); letter-spacing: -.025em; line-height: 1.05; margin: 0 }
.sf-sechead p { margin: 8px 0 0; color: var(--ink2); font-size: 15.5px; max-width: 56ch }
.sf-more { font: inherit; font-size: 14px; color: var(--ink2); text-decoration: none; white-space: nowrap; padding-bottom: 4px; border-bottom: 1px solid var(--hair) }
.sf-more:hover { color: var(--ink); border-color: var(--ink3) }

/* collection tiles */
.sf-tiles { display: grid; gap: 20px; grid-template-columns: repeat(2, minmax(0, 1fr)) }
.sf-tiles.n3 { grid-template-columns: repeat(3, minmax(0, 1fr)) }
.sf-tile { display: block; color: inherit; text-decoration: none; border-radius: 20px; overflow: hidden; background: var(--card); border: 0px solid var(--hair);
  transition: transform .25s cubic-bezier(.2, .8, .2, 1), box-shadow .25s }
.sf-tile:hover { transform: translateY(-3px); box-shadow: 0 30px 60px -40px #000b }
.sf-tile-media { aspect-ratio: 16 / 9; overflow: hidden; background: color-mix(in srgb, var(--ink) 6%, var(--paper)) }
.sf-tile-media > img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .9s cubic-bezier(.2, .8, .2, 1) }
.sf-tile:hover .sf-tile-media > img { transform: scale(1.04) }
.sf-tile-shelf { height: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 0; padding: 8% 10% 0 }
.sf-tile-shelf img { width: 30%; aspect-ratio: 4 / 5; object-fit: cover; border-radius: 6px 6px 0 0; box-shadow: 0 16px 30px -12px #0009; transition: transform .6s cubic-bezier(.2, .8, .2, 1) }
.sf-tile-shelf img:nth-child(1) { transform: translate(6%, 6%) rotate(-3deg) }
.sf-tile-shelf img:nth-child(2) { z-index: 1; transform: translateY(-2%) }
.sf-tile-shelf img:nth-child(3) { transform: translate(-6%, 6%) rotate(3deg) }
.sf-tile:hover .sf-tile-shelf img:nth-child(1) { transform: translate(2%, 4%) rotate(-5deg) }
.sf-tile:hover .sf-tile-shelf img:nth-child(3) { transform: translate(-2%, 4%) rotate(5deg) }
.sf-tile-body { padding: 18px 20px 20px }
.sf-tile-body h3 { font-family: var(--fd); font-weight: 600; font-size: 22px; letter-spacing: -.02em; margin: 0 0 4px }
.sf-tile-body p { margin: 0 0 10px; color: var(--ink2); font-size: 14.5px }
.sf-tile-n { font-family: var(--m); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3) }

/* featured rail */
.sf-rail { --rail-item: 290px; --rail-arrow-y: 36% }
@media (max-width: 720px) { .sf-rail { --rail-item: 72vw } }

/* membership band */
.sf-member { margin-top: var(--sf-gap); background: linear-gradient(160deg, #0d1a2c, #071019); color: #edf1f8; overflow: hidden }
.sf-member-in { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: clamp(24px, 4vw, 64px); align-items: center; padding-block: clamp(40px, 6vw, 80px) }   /* padding-block only: the shorthand once zeroed the gutter .wrapwide gives a phone */
.sf-member h2 { font-family: var(--fd); font-weight: 600; font-size: clamp(30px, 4.2vw, 54px); letter-spacing: -.03em; line-height: 1.02; margin: 0 0 16px; text-wrap: balance }
.sf-member-subtitle { font-size: 17px; line-height: 1.55; color: #b7c1d2; max-width: 52ch; margin: 0 0 20px }
.sf-member-points { list-style: none; margin: 0 0 26px; padding: 0; display: flex; flex-direction: column; gap: 8px; color: #dbe3ef; font-size: 15px }
.sf-member-points li::before { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); margin-right: 12px; vertical-align: 2px }
.sf-member-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap }
.sf-member-price { font-family: var(--fd); font-weight: 600; font-size: 34px; letter-spacing: -.02em; font-variant-numeric: tabular-nums }
.sf-member-price small { font-family: var(--m); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #8cf0ec; margin-left: 4px }
.sf-member-active { font-family: var(--m); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #8cf0ec }
.sf-member-art { display: block; border-radius: 24px; overflow: hidden; aspect-ratio: 4 / 5; max-height: 520px; margin-left: auto; border: 1px solid #ffffff1f;
  box-shadow: 0 0 0 1px #4fe3df22, 0 40px 90px -40px #000, 0 0 120px -30px #4fe3df44 }
.sf-member-art img { width: 100%; height: 100%; object-fit: cover; display: block }
.sf-err { margin: 12px 0 0; font-size: 13.5px; color: #b45309 } .sf-err.light { color: #fbbf24 }

/* shelves */
.sf-grid { display: grid; gap: 22px 20px; grid-template-columns: repeat(4, minmax(0, 1fr)) }
.sf-empty { color: var(--ink3) }

/* the promise */
.sf-promise { margin-top: 0; border: none; padding-top: 34px; padding-bottom: 34px; text-align: center }
.sf-promise-in { display: inline-block }
.sf-promise-in div { display: inline-block; margin:0px 15px; gap: 12px; align-items: flex-start; font-size: 14px; color: var(--ink2); line-height: 1.45 }
.sf-promise-in svg { flex: none; color: var(--accent2); top: 4px; position:relative;margin-right:5px; }

@media (max-width: 1000px) {
  .sf-hero-in { grid-template-columns: 1fr }
  .sf-hero-art { order: -1 }
  .sf-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) }
  .sf-member-in { grid-template-columns: 1fr }
  .sf-member-art { max-height: 360px; aspect-ratio: 16 / 10; margin: 0 }
}
@media (max-width: 640px) {
  .sf-tiles, .sf-tiles.n3 { grid-template-columns: 1fr }
  .sf-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 12px }
}
/* the tiers, side by side on the band */
.sf-tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; align-self: center }
.sf-tier { display: flex; flex-direction: column; gap: 6px; padding: 22px 22px 20px; border: 1px solid #ffffff1f; border-radius: 16px; background: #ffffff0a }
.sf-tier.held { border-color: #4fe3df66; box-shadow: 0 0 0 1px #4fe3df33 inset }
.sf-tier-title { font-family: var(--fd); font-weight: 600; font-size: 20px; color: #edf1f8; text-decoration: none }
.sf-tier-sub { font-size: 14px; color: #b7c1d2; line-height: 1.45 }
.sf-tier .sf-member-price { margin-top: 8px }
.sf-tier .sf-member-row { margin-top: 10px }
.sf-tier .sf-offer { justify-content: space-between; gap: 12px }
.sf-tier .sf-offer .sf-member-price { font-size: 26px; margin-top: 0 }
.sf-tier .sf-offer + .sf-offer { margin-top: 6px; padding-top: 10px; border-top: 1px solid #ffffff14 }
</style>

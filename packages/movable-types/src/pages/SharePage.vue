<script setup>
import SiteMark from '../components/SiteMark.vue'
/*
 * The share cards, at /__share/<kind>[/<id>]: what a link to a page looks like
 * on a social network, a chat, or a search result. Each is a fixed 1200 × 675
 * frame (16:9) with no site chrome, drawn with the site's own components and
 * tokens, and build/share-images.mjs screenshots every one into dist/share/ at
 * build time; src/lib/seo.js points a page's og:image at its file.
 *
 *   default          the first section of the default landing page, as it is — or, on a site with no
 *                    landing page (a docs site), the site's name and tagline on the paper
 *   articles/<id>    the article's title over its cover image, or a gradient
 *   books/<slug>     the book as its title page draws it: the cover (or the
 *                    generated one), the author and the title beside it
 *   icon?size=N      the favicon: the mark on a quiet light-mode gradient, a
 *                    square of N pixels (default 512) — photographed at every
 *                    size the platforms want
 *
 * Never linked from anywhere and marked noindex; it exists for the camera.
 */
import { computed, onMounted } from 'vue'
import { route } from '../router.js'
import { pages as PAGES, articles as ARTICLES, wiki as WIKI, docs as DOCS, products as PRODUCTS, collections as COLLECTIONS, site as SITE_RAW } from '#content'
import { SECTIONS } from '../components/landing/index.js'
import { bookShelf, coverTint } from '@platform-kit/kit/lib/content.js'
import { setHead } from '@platform-kit/kit/lib/seo.js'
import { fitCard } from '@platform-kit/kit/lib/share-card.js'

const SITE = (Array.isArray(SITE_RAW) ? SITE_RAW[0] : SITE_RAW) || { name: 'Site' }
const parts = computed(() => route.value.replace(/^\/__share\/?/, '').split('/').filter(Boolean))
const kind = computed(() => parts.value[0] || 'default')
const id = computed(() => parts.value.slice(1).join('/'))
/* the icon's edge, from ?size=; everything inside scales with it */
const size = computed(() => { const n = Number(new URLSearchParams(location.search).get('size')); return n > 0 ? n : 512 })
const frame = computed(() => (kind.value === 'icon' ? { width: size.value + 'px', height: size.value + 'px' } : null))

/* the default landing page's first section, exactly as the page draws it */
const hero = computed(() => {
  const page = (PAGES || []).find((p) => (p.route || '/') === '/')
  const s = page && page.sections && page.sections[0]
  const comp = s && SECTIONS[s.component]
  return comp ? { comp, props: s.props || {} } : null
})
/*
 * ONE CARD FOR EVERY RECORD THAT IS A TITLE, A LINE AND MAYBE A PICTURE.
 *
 * It was the article's card alone, and everything else — a wiki entry, a doc, a product, a
 * collection, a landing page — fell through to the site's default, so a link to a product showed
 * the site's name. They are all the same card: seo.js now points each of them at
 * /share/<kind>/<id>.png, and this is what answers.
 */
const RECORDS = { articles: () => ARTICLES, wiki: () => WIKI, docs: () => DOCS, products: () => PRODUCTS, collections: () => COLLECTIONS }
const record = computed(() => {
  if (kind.value === 'pages') {
    const route = '/' + String(id.value || '').replace(/-/g, '/')
    const p = (PAGES || []).find((x) => (x.route || '/') === route)
    return p ? { title: p.seoTitle || p.title, description: p.description, image: p.image } : null
  }
  const list = (RECORDS[kind.value] || (() => []))()
  const e = (list || []).find((x) => (x.id || x.slug) === id.value)
  if (!e) return null
  return { title: e.title, description: e.description || e.subtitle || strip(e.excerpt), image: e.image || imageOf(e.cover) }
})
const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const imageOf = (c) => (c && typeof c === 'object' ? c.src : c) || null

const article = computed(() => (ARTICLES || []).find((a) => a.id === id.value) || null)

/*
 * A LONG TITLE USED TO PUSH THE CARD APART. The text block is anchored to the bottom, which is
 * right for two lines and wrong for eight: it grows upward, clears the top of the frame, and the
 * title ends up set over the bright part of the picture where the scrim has nothing left to do. A
 * 130-character title reached the top edge.
 *
 * The rule that steps the type down is shared with the share-image function — one card, two things
 * that draw it, and a card that fits in one and not the other is worse than one a little small in
 * both (lib/share-card.js).
 */
const fitArt = computed(() => fitCard({ title: (record.value && record.value.title) || '', sub: (record.value && record.value.description) || '', variant: 'picture' }))
const fitPlain = computed(() => fitCard({ title: SITE.tagline || '', sub: SITE.description || '', variant: 'paper' }))
const book = computed(() => bookShelf().find((b) => b.slug === id.value) || null)

/* the camera wants the light theme and decoded artwork, whatever the machine prefers */
onMounted(async () => {
  document.documentElement.setAttribute('data-theme', 'light')
  setHead({ title: 'share card', path: null, noindex: true })
  const images = [...document.querySelectorAll('[data-share] img')]
  await Promise.all(images.map(async (image) => {
    image.loading = 'eager'
    try {
      await image.decode()
    } catch (error) {
      console.error(`Share card image could not be decoded: ${image.currentSrc || image.src}`, error)
    }
  }))
})
</script>

<template>
  <div class="sh-frame" :class="'sh-' + kind" :style="frame" data-share>
    <!-- the favicon: the mark, on the landing page's light ground -->
    <div v-if="kind === 'icon'" class="sh-icon">
      <SiteMark class="sh-icon-mark" :size="26" stroke="#0e8c8c" />
    </div>

    <!-- the landing page's opening, on its own ground -->
    <div v-else-if="kind === 'default' && hero" class="lproot sh-landing">
      <div class="lpbg"></div>
      <div class="lpblobs"><span class="lpblob lpb1"></span><span class="lpblob lpb2"></span><span class="lpblob lpb3"></span></div>
      <div class="lpgrain"></div>
      <div class="sh-landing-in"><component :is="hero.comp" v-bind="hero.props" /></div>
    </div>

    <!-- no landing page: the site's own words on the paper -->
    <div v-else-if="kind === 'default'" class="sh-plain">
      <div class="sh-plain-in">
        <div class="sh-brand sh-plain-brand"><SiteMark class="sh-mark" :size="30" />{{ SITE.name }}</div>
        <h1 v-if="SITE.tagline" :style="{ fontSize: fitPlain.titleSize + 'px', letterSpacing: (-0.018 * fitPlain.titleSize) + 'px', maxWidth: fitPlain.titleMax + 'px' }">{{ SITE.tagline }}</h1>
        <p v-if="fitPlain.sub" class="sh-subtitle" :style="{ fontSize: fitPlain.subSize + 'px', maxWidth: fitPlain.subMax + 'px' }">{{ fitPlain.sub }}</p>
      </div>
    </div>

    <!-- ANY RECORD that is a title, a line and maybe a picture: an article, a wiki entry, a doc,
         a product, a collection, a landing page. One card, because they are one card. -->
    <div v-else-if="record" class="sh-art" :class="{ 'has-img': record.image }">
      <img v-if="record.image" class="sh-art-img" :src="record.image" alt="" />
      <div v-if="record.image" class="sh-art-scrim" />
      <div class="sh-art-in">
        <div class="sh-brand"><SiteMark class="sh-mark" :size="22" />{{ SITE.name }}</div>
        <h1 :style="{ fontSize: fitArt.titleSize + 'px', letterSpacing: (-0.018 * fitArt.titleSize) + 'px', maxWidth: fitArt.titleMax + 'px' }">{{ record.title }}</h1>
        <p v-if="fitArt.sub" class="sh-subtitle" :style="{ fontSize: fitArt.subSize + 'px', maxWidth: fitArt.subMax + 'px' }">{{ fitArt.sub }}</p>
      </div>
    </div>

    <!-- a book: the cover as the title page draws it, the author and the title beside it -->
    <div v-else-if="kind === 'books' && book" class="lproot sh-book">
      <div class="lpbg"></div>
      <div class="sh-book-in">
        <div class="sh-covart">
          <span class="sh-covart-glow" aria-hidden="true"
                :style="{ backgroundImage: book.cover ? 'url(' + book.cover.blurDataURL + ')' : coverTint(book.slug) }" />
          <img v-if="book.cover" class="sh-coverimg" :src="book.cover.src" :alt="book.title + ' cover'" />
          <span v-else class="sh-coversim" :style="{ backgroundImage: coverTint(book.slug) }">
            <span class="sh-coversim-title">{{ book.title }}</span>
            <span v-if="book.author" class="sh-coversim-author">{{ book.author }}</span>
          </span>
        </div>
        <div class="sh-bookinfo">
          <div class="sh-brand"><SiteMark class="sh-mark" :size="22" />{{ SITE.name }}</div>
          <p v-if="book.author" class="sh-covauthor">{{ book.author }}</p>
          <h1>{{ book.title }}</h1>
        </div>
      </div>
    </div>

    <div v-else class="sh-missing">{{ kind }}<template v-if="id"> / {{ id }}</template></div>
  </div>
</template>

<style scoped>
/* the frame is the picture: 1200 × 675, nothing outside it */
.sh-frame { position: relative; width: 1200px; height: 675px; overflow: hidden; background: var(--paper); color: var(--ink);
  font-family: var(--f); isolation: isolate }
.sh-frame > * { position: absolute; inset: 0 }

/* --- the landing opening: the page's own ground, the hero at the page's own width --- */
.sh-landing { overflow: hidden; border-radius: 0; height: 675px; min-height: 0; margin: 0 }
.sh-landing-in { position: relative; z-index: 1; width: 1280px; height: 100%; margin-left: -40px;
  display: flex; flex-direction: column; justify-content: center }
.sh-landing-in :deep(section), .sh-landing-in :deep(.lpsection) { padding-top: 0; padding-bottom: 0; margin: 0 }

/* --- an article --- */
.sh-art { display: flex; align-items: flex-end;
  background: linear-gradient(160deg, var(--accentbg), transparent 70%), var(--paper) }
.sh-art-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover }
.sh-art-scrim { position: absolute; inset: 0;
  background: linear-gradient(180deg, #0a0d0b40 0%, #0a0d0b40 28%, #0a0d0bb3 58%, #0a0d0bf2 100%) }
.sh-art-in { position: relative; z-index: 1; padding: 0 84px 76px; max-width: 1000px }
.sh-art h1 { font-family: var(--fd); font-optical-sizing: auto; font-weight: 600; font-size: 66px; line-height: 1.04;
  letter-spacing: -.018em; margin: 0; max-width: 16ch; text-wrap: balance }
.has-img .sh-art-in { color: #eef2ec }
.has-img h1 { color: #fff; text-shadow: 0 2px 34px #00000073 }
.sh-subtitle { font-size: 24px; line-height: 1.45; color: var(--ink2); margin: 22px 0 0; max-width: 48ch }
.has-img .sh-subtitle { color: #dfe4dc }

/* --- a site with no landing page --- */
.sh-plain { display: flex; align-items: flex-end; height: 675px; min-height: 0; margin: 0; background: var(--paper);
  background-image: radial-gradient(60% 70% at 85% 10%, var(--accentbg) 0%, transparent 70%) }
.sh-plain-in { padding: 0 84px 76px; max-width: 1000px }
.sh-plain-brand { font-size: 22px; margin-bottom: 26px }
.sh-plain h1 { font-family: var(--fd); font-optical-sizing: auto; font-weight: 600; font-size: 60px; line-height: 1.06;
  letter-spacing: -.018em; margin: 0; max-width: 18ch; text-wrap: balance; color: var(--ink) }

/* --- a book --- */
.sh-book { overflow: hidden; border-radius: 0; height: 675px; min-height: 0; margin: 0 }
.sh-book-in { position: relative; z-index: 1; height: 100%; display: grid; grid-template-columns: 300px minmax(0, 1fr);
  gap: 76px; align-items: center; padding: 0 96px }
.sh-covart { position: relative; isolation: isolate }
.sh-covart-glow { position: absolute; display: block; inset: -12% -12% -22%; z-index: 0; border-radius: 40px;
  background-position: center; background-size: cover; filter: blur(52px) saturate(1.4); opacity: .5 }
.sh-coverimg, .sh-coversim { position: relative; z-index: 1; display: block; width: 100%; aspect-ratio: 2 / 3;
  border-radius: 5px 12px 12px 5px; box-shadow: 0 2px 5px #0000001f, 0 34px 64px -26px #000000a6 }
.sh-coverimg { object-fit: cover }
.sh-coversim { display: flex; flex-direction: column; justify-content: space-between; padding: 26px 24px;
  box-sizing: border-box; color: #F6FBF6; box-shadow: inset 6px 0 0 #00000022, 0 34px 64px -26px #000000a6 }
.sh-coversim-title { font-family: var(--fd); font-size: 24px; font-weight: 600; line-height: 1.2; letter-spacing: -.01em }
.sh-coversim-author { font-family: var(--m); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; opacity: .8 }
.sh-covauthor { font-family: var(--m); font-size: 13px; letter-spacing: .18em; text-transform: uppercase; color: var(--ink2); margin: 0 0 14px }
.sh-bookinfo h1 { font-family: var(--fd); font-optical-sizing: auto; font-weight: 600; font-size: 64px; line-height: 1.05;
  letter-spacing: -.016em; margin: 0; max-width: 14ch; text-wrap: balance }

/* --- the favicon: the mark at two thirds of the edge, on the landing's light gradient (fixed hex —
   the icon is one picture for every theme, so it never reads a token) --- */
.sh-icon { display: grid; place-items: center;
  background: radial-gradient(90% 70% at 18% 10%, #fff3a8 0%, #fff3a800 62%), linear-gradient(152deg, #ffe58a 0%, #fbf5e6 58%, #f7efd8 100%) }
.sh-icon-mark { width: 68%; height: 68%; display: block }

/* the site's name, small, where the card came from */
.sh-brand { display: flex; align-items: center; gap: 10px; font-family: var(--m); font-size: 13px; letter-spacing: .18em;
  text-transform: uppercase; color: var(--ink3); margin: 0 0 26px }
.has-img .sh-brand { color: #c4ccc0 }
.sh-mark { flex: none }

.sh-missing { display: grid; place-items: center; font-family: var(--m); color: var(--ink3) }
</style>

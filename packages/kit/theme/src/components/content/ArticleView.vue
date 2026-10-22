<script setup>
import { computed, watch, inject } from 'vue'
import { articleView } from 'platformkit/lib/content.js'
import { article } from 'platformkit/lib/content.js'
import { contentView } from 'platformkit/lib/analytics.js'
import MarkdownDoc from '../MarkdownDoc.vue'
import MediaBlock from './MediaBlock.vue'
import Gate from '../Gate.vue'
import ArticleCta from '../ArticleCta.vue'
import { can, entrySubject } from 'platformkit/lib/auth.js'
import SiteClose from '../SiteClose.vue'
import CommentThread from './CommentThread.vue'
/* the date as a person would say it: September 14th, 2024 */
function longDate(d) {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return d
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])),
    n = dt.getUTCDate()
  const suf =
    n % 10 === 1 && n !== 11
      ? 'st'
      : n % 10 === 2 && n !== 12
        ? 'nd'
        : n % 10 === 3 && n !== 13
          ? 'rd'
          : 'th'
  return (
    dt.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }) +
    ' ' +
    n +
    suf +
    ', ' +
    dt.getUTCFullYear()
  )
}
import { allowedBy, requiredBy } from 'platformkit/lib/access.js'
import { useGatedPage } from 'platformkit/lib/gated.js'
import { us } from 'platformkit/lib/content.js'

const props = defineProps({ id: { type: String, required: true } })
/* the admin's live preview provides a draft entry in place of the compiled one */
const preview = inject('dl-preview', null)
const a = computed(() =>
  preview ? (preview.value ? articleView(preview.value) : null) : article(props.id),
)
/* a canAccess bar in the frontmatter closes the body (hero stays) until the reader clears it */
/* ASKED, NOT DECIDED: the entry carries its own bar and the ability answers (lib/permissions.js).
   The answer is the ladder's — permissions.test.mjs pins the two together — and a site that narrows
   what may be read narrows this with it. */
const allowed = computed(() => can('read', entrySubject({ kind: 'articles', slug: a.value && a.value.slug, canAccess: a.value && a.value.data.canAccess })))
/* a gated article ships without its body (_shared/gate.js); a reader who may read it is sent it by reader-content */
const GW = us('library').reader.gated || {}
const body = useGatedPage('articles', () => !preview && a.value && { id: a.value.id, html: a.value.html, gated: a.value.data.gated }, () => allowed.value)
watch(
  a,
  (v) => {
    if (v && !preview)
      contentView({ kind: 'article', id: props.id, title: v.title, tags: v.data.tags })
  },
  { immediate: true },
)
const img = computed(
  () =>
    a.value &&
    (a.value.data.image ||
      (Array.isArray(a.value.data.media)
        ? a.value.data.media.find((m) => m.poster)?.poster
        : a.value.data.media?.poster) ||
      null),
)
const badge = computed(() => {
  const m = a.value && a.value.data.media
  if (!m) return null
  return Array.isArray(m) ? 'Playlist' : m.type === 'audio' ? 'Audio' : 'Video'
})
</script>

<template>
  <template v-if="a">
    <!-- full-bleed image hero when the piece has one; a soft gradient otherwise -->
    <div class="art-hero" :class="{ 'has-img': img }">
      <img v-if="img" class="art-img" :src="img" alt="" />
      <div class="art-scrim" v-if="img" />
      <div class="wrapwide art-hero-in">
        <a class="art-crumb" href="/content/articles"
          ><span aria-hidden="true">&larr;</span> Articles</a
        >
        <h1>{{ a.title }}</h1>
        <p v-if="a.description" class="art-subtitle">{{ a.description }}</p>
        <div class="art-meta">
          <span v-if="badge" class="art-badge">{{ badge }}</span>
          <!-- the date in words; no byline — everything here is the site's -->
          <template v-if="a.date"
            ><span v-if="badge" class="sep" aria-hidden="true" /><span>{{
              longDate(a.date)
            }}</span></template
          >
          <template v-if="a.readingTime"
            ><span class="sep" aria-hidden="true" /><span
              >{{ a.readingTime }} min read</span
            ></template
          >
        </div>
      </div>
    </div>

    <div class="art-body">
      <div v-if="a.data.media && allowed" class="art-media">
        <MediaBlock :media="a.data.media" />
      </div>
      <div class="art-col">
        <div v-if="allowed && body.waiting.value" class="art-prose art-wait" role="status">
          <p class="art-wait-line">{{ body.state.value === 'error' ? GW['page-error'] : GW['page-loading'] }}</p>
          <button v-if="body.state.value === 'error'" type="button" class="art-wait-retry" @click="body.retry">{{ GW.retry }}</button>
        </div>
        <div v-else-if="allowed" class="art-prose"><MarkdownDoc :html="preview ? a.html : body.html.value" /></div>
        <Gate v-else kind="doc" :required="requiredBy(a.data.canAccess)" />
        <!-- the targeted call to action, as the organic end of the piece -->
        <ArticleCta v-if="allowed" :key="a.id" :topics="a.data.tags || []" />
      </div>
    </div>
    <!-- what people say about it, where the file says it takes comments. The component asks the
         database whether this thing has a conversation at all, so a page whose file says nothing
         draws nothing and no page has to check. -->
    <div class="art-comments"><CommentThread kind="article" :subject="id" rule /></div>

    <!-- and the site's close: the landing's own section, worded by the footer ad (SiteClose.vue) -->
    <SiteClose :topics="a.data.tags || []" />
  </template>

  <div v-else class="wrap">
    <header>
      <h1>Not on this shelf.</h1>
      <p class="subtitle">
        That piece is not here &mdash; <a href="/content/articles">the index</a> has everything that
        is.
      </p>
    </header>
  </div>
</template>

<style scoped>
/* ===================== hero ===================== */
.art-hero {
  position: relative;
  overflow: hidden;
  border-bottom: 1px solid var(--hair);
  background: linear-gradient(160deg, var(--accentbg), transparent 70%);
  padding: 72px 0 54px;
}
/* immersive: the cover runs to the very top of the viewport, behind the floating
   header; the copy clears the header and the foot is roomy so the media below can
   lift away from the metadata without crowding it */
.art-hero.has-img {
  padding: 190px 0 160px;
  min-height: min(660px, 82vh);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  border-bottom: 0;
}
.art-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* the scrim over the cover, the same in both themes, three layers: the page's paper
   fading in over the bottom edge (on top), the dark deepening toward the foot where the
   words sit, and a flat 15% of black over the whole picture so white type reads on a
   light image */
.art-scrim {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, transparent 80%, var(--paper) 100%),
    linear-gradient(180deg, #0a0d0b1f 0%, #0a0d0b66 0%, #050505c4 60%),
    #00000026;
}
/* the hero's column is the media's: the same measure and inset as .art-media, so the
   title, subtitle and meta line up on the player's edges */
.art-hero-in {
  position: relative;
  z-index: 1;
  width: 100%;              /* a flex item in the hero: fill to the measure, do not shrink to the words */
  max-width: 912px;
  padding: 0 24px;
}
.has-img .art-hero-in {
  color: #eef2ec;
}

.art-crumb {
  display: inline-block;
  font-family: var(--m);
  font-size: 10.5px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink3);
  text-decoration: none;
  margin-bottom: 20px;
}
.art-crumb span {
  display: inline-block;
  transition: transform 0.16s;
}
.art-crumb:hover {
  color: inherit;
}
.art-crumb:hover span {
  transform: translateX(-3px);
}
.has-img .art-crumb {
  color: #c6cdc1;
}

.art-hero h1 {
  font-family: var(--fd);
  font-optical-sizing: auto;
  font-weight: 600;
  font-size: clamp(38px, 5.2vw, 62px);
  max-width: 18ch;
  letter-spacing: -0.016em;
  line-height: 1.03;
  color: var(--ink);
}
.art-hero.has-img h1 {
  color: #fff;
  text-shadow: 0 2px 34px #00000073;
}
.art-subtitle {
  font-size: clamp(17px, 2vw, 21px);
  color: var(--ink2);
  max-width: 56ch;
  line-height: 1.5;
  margin-top: 18px;
}
.has-img .art-subtitle {
  color: #dfe4dc;
}

.art-meta {  
  align-items: center;
  gap: 11px;
  margin-top: 24px;
  font-size: 13.5px;
  color: var(--ink3);
  padding: 10px;
  width: auto;
  display: inline-block;
  border-radius: 50px;
  background: linear-gradient(-90deg, #222 0%, #444 100%);
  text-align: center;
}
.art-meta > * {
  margin:5px;
}
.has-img .art-meta {
  color: #e6ebe4;
  font-size: 14px;
  text-shadow: 0 1px 12px #00000080;
}
.art-badge {
  font-family: var(--m);
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent2);
  border: 1px solid var(--hair);
  border-radius: 999px;
  padding: 4px 10px;
}
.has-img .art-badge {
  color: #fff;
  border-color: #ffffff44;
  background: #ffffff1a;
}
.sep {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.45;
}

/* ===================== body ===================== */
/* a gated body on its way from reader-content, or one that could not be fetched */
.art-wait-line { color: var(--ink3); margin: 0 }
.art-wait-retry { margin-top: 14px; font: inherit; font-size: 14px; font-weight: 600; color: var(--ink); background: none; border: 1.5px solid var(--ink); border-radius: 999px; padding: 8px 18px; cursor: pointer }
.art-wait-retry:hover { background: var(--ink); color: var(--paper) }
.art-body {
  position: relative;
  z-index: 2;
}
.art-col {
  max-width: var(--readw);
  margin: 0 auto;
  padding: 0 var(--readpad) 120px;
}
/* the conversation continues the reading column and draws the join (CommentThread's `rule`), so
   the column's own generous foot is taken back where one follows: 120px of nothing above a
   hairline reads as the page having ended twice */
.art-body:has(+ .art-comments) .art-col {
  padding-bottom: 64px;
}
/* the thread is placed at the page's root here, so this is where its gutter comes from — the same
   one the reading column has, so the two line up at every width */
.art-comments {
  padding: 0 var(--readpad);
}
/* with no media the reading column leads, so it earns its own gap off the hero */
.art-body > .art-col:first-child {
  padding-top: 58px;
}
/* the media breaks out wider than the reading measure and lifts over the foot of
   the hero, reading as a lit card floating off the dark cover */
.art-media {
  position: relative;
  z-index: 2;
  max-width: 912px;
  margin: -66px auto 54px;
  padding: 0 24px;
}
.art-media :deep(media-player) {
  box-shadow:
    0 0 0 1px #ffffff2b,
    0 34px 74px -26px #00000099,
    0 0 68px -10px #ffffff30,
    0 3px 10px -4px #0000005c;
}
.art-media :deep(.playlist) {
  box-shadow:
    0 0 0 1px #ffffff1f,
    0 20px 44px -24px #00000082;
}
.art-prose {
  margin-top: 0;
}
.art-prose :deep(.purpose > :first-child) {
  margin-top: 0;
}
/* an editorial lead on the opening paragraph, then a roomy serif body */
.art-prose :deep(.purpose > p:first-child) {
  font-size: clamp(19px, 2.2vw, 21px);
  line-height: 1.6;
  color: var(--ink);
}
.art-prose :deep(.purpose p) {
  font-size: 17.5px;
  line-height: 1.8;
  color: var(--ink2);
  margin: 0 0 20px;
}
.art-prose :deep(.purpose h2) {
  font-family: var(--fd);
  font-optical-sizing: auto;
  font-weight: 700;
  font-size: clamp(24px, 3vw, 30px);
  letter-spacing: -0.02em;
  color: var(--ink);
  margin: 46px 0 14px;
  border: 0;
  padding: 0;
}
.art-prose :deep(.purpose h3) {
  font-family: var(--fd);
  font-weight: 700;
  font-size: clamp(19px, 2.2vw, 22px);
  color: var(--ink);
  margin: 34px 0 8px;
}
.art-prose :deep(.purpose blockquote) {
  font-family: var(--fd);
  font-style: italic;
  font-size: 20px;
  color: var(--ink2);
  border-left: 3px solid var(--accent);
  margin: 26px 0;
  padding: 4px 0 4px 22px;
}

@media (max-width: 640px) {
  .art-hero.has-img {
    padding: 128px 0 84px;
    min-height: min(520px, 74vh);
  }
  .art-media {
    margin-top: -44px;
    margin-bottom: 40px;
    padding: 0 20px;
  }
  .art-col {
    padding: 0 20px 96px;
  }
}
</style>

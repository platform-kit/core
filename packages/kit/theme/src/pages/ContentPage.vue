<script setup>
import { computed, watch } from 'vue'
import SiteLayout from '../layouts/SiteLayout.vue'
import { ROUTES, route, DOCS_ONLY, KINDS_ON } from '../router.js'
import { article } from 'platformkit/lib/content.js'
import ContentHub from '../components/content/ContentHub.vue'
import ArticleIndex from '../components/content/ArticleIndex.vue'
import ArticleView from '../components/content/ArticleView.vue'
import TreeSection from '../components/content/TreeSection.vue'
import BookShelf from '../components/content/BookShelf.vue'
import BookReader from '../components/content/BookReader.vue'

/*
 * /content and everything under it. The path decides the surface:
 *
 *   /content                     the hub — the kinds that are on, kept distinct
 *   /content/articles[/slug]     the magazine
 *   /content/wiki[/slug..]       the wiki
 *   /content/docs[/slug..]       the docs, with search
 *   /content/books[/slug]        the shelf and the reader
 *
 * A docs-only site (router.js DOCS_ONLY) has no hub: the docs are at /docs[/slug..] and at / when no
 * landing page claims the root, in the plain shell.
 */
import { headForContent } from 'platformkit/lib/seo.js'
const parsed = computed(() => {
  if (DOCS_ONLY) { const rest = route.value === ROUTES.docs || route.value.startsWith(ROUTES.docs + '/') ? route.value.slice(ROUTES.docs.length).replace(/^\//, '') : ''; return { kind: 'docs', id: rest } }
  const rest = route.value.slice(ROUTES.content.length).replace(/^\//, '')
  const [kind, ...restParts] = rest.split('/')
  return { kind: kind && KINDS_ON[kind] ? kind : 'hub', id: restParts.join('/') }
})
watch(parsed, (p) => headForContent(p.kind, p.id), { immediate: true })

/* An article with a cover image gets the immersive treatment: the image runs to
   the very top of the viewport and the header floats over it, translucent. */
const immersive = computed(() => {
  const p = parsed.value
  if (p.kind !== 'articles' || !p.id) return false
  const a = article(p.id)
  if (!a) return false
  const m = a.data.media
  return !!(a.data.image || (Array.isArray(m) ? m.find((x) => x.poster)?.poster : m?.poster))
})
</script>

<template>
  <!-- the header sits on the content ground (transparent) everywhere but the reader,
       which brings its own page; an article with a cover runs that cover to the top -->
  <SiteLayout :current="DOCS_ONLY ? ROUTES.docs : ROUTES.content" :transparent="!DOCS_ONLY && (immersive || !(parsed.kind === 'books' && parsed.id))" :hero-dark="immersive">
    <!-- the reader brings its own page; every other view stands on the content ground
         (a look may paint it, as classic does by day, to match the landing) -->
    <BookReader v-if="parsed.kind === 'books' && parsed.id" :slug="parsed.id" />
    <div v-else class="contentground" :class="{ under: !immersive && !DOCS_ONLY, article: parsed.kind === 'articles' && !!parsed.id, plain: DOCS_ONLY }">
    <ContentHub v-if="parsed.kind === 'hub'" />

    <ArticleView v-else-if="parsed.kind === 'articles' && parsed.id" :id="parsed.id" />
    <ArticleIndex v-else-if="parsed.kind === 'articles'" />

    <TreeSection v-else-if="parsed.kind === 'wiki'" collection="wiki" :id="parsed.id" />
    <TreeSection v-else-if="parsed.kind === 'docs'" collection="docs" :id="parsed.id" :searchable="true" :plain="DOCS_ONLY" />

    <BookShelf v-else-if="parsed.kind === 'books'" />

    <ContentHub v-else />
    </div>
  </SiteLayout>
</template>

<style scoped>
/* under a transparent header the ground starts at the top of the page and the content below the header */
.contentground.under { padding-top: var(--headh, 74px) }
</style>

<script setup>
/*
 * /store and everything beneath it: the storefront, a collection, a product.
 * Products and collections are written in content/store and priced live from
 * the catalog (src/lib/storefront.js); the bag is a drawer on every page; the
 * checkout is Stripe's. A book's paywall sends people to /store?book=<slug>,
 * which lands on that book's own page.
 */
import { computed, watch, onMounted } from 'vue'
import SiteLayout from '../layouts/SiteLayout.vue'
import { route, ROUTES, navigate } from '../router.js'
import StoreHome from '../components/store/StoreHome.vue'
import CollectionPage from '../components/store/CollectionPage.vue'
import CollectionsIndex from '../components/store/CollectionsIndex.vue'
import ProductPage from '../components/store/ProductPage.vue'
import { load, byBook } from '@platform-kit/kit/lib/storefront.js'
import { headForStore } from '@platform-kit/kit/lib/seo.js'

const parsed = computed(() => {
  const rest = route.value.slice(ROUTES.store.length).replace(/^\//, '')
  const [kind, ...more] = rest.split('/')
  return { kind: kind || 'home', id: more.join('/') }
})
watch(parsed, (p) => headForStore(p.kind, p.id), { immediate: true })
onMounted(() => {
  load()
  const slug = new URLSearchParams(window.location.search).get('book')
  if (slug) {
    const p = byBook(slug)
    window.history.replaceState({}, '', window.location.pathname)
    if (p) navigate(p.href)
  }
})
</script>

<template>
  <SiteLayout :transparent="parsed.kind === 'home'" :current="ROUTES.store">
    <ProductPage v-if="parsed.kind === 'products' && parsed.id" :key="parsed.id" :id="parsed.id" />
    <CollectionPage v-else-if="parsed.kind === 'collections' && parsed.id" :key="parsed.id" :id="parsed.id" />
    <CollectionsIndex v-else-if="parsed.kind === 'collections'" />
    <StoreHome v-else />
  </SiteLayout>
</template>

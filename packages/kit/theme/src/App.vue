<script setup lang="ts">
import { moduleOn } from 'platformkit/lib/modules.js'
import { mayInterrupt } from 'platformkit/lib/interrupt.js'
import { watch, computed } from 'vue'
import { route, ROUTES, INTERRUPT_ROUTES, DEV, CMS, STORE_ON, siteRouteOf } from './router.js'
import { warmSpeech } from 'platformkit/modules/tts/index.js'
import AuthModal from './components/AuthModal.vue'
import CtaHost from './components/CtaHost.vue'
import CartDrawer from './components/store/CartDrawer.vue'
import SiteToast from './components/SiteToast.vue'
import UsagePaymentAlert from './components/UsagePaymentAlert.vue'
import SupportWidget from './components/support/SupportWidget.vue'
import { pageview } from 'platformkit/lib/analytics.js'
import { pageAt, propsOf } from 'platformkit/lib/pages.js'
/* every page this site shows: core's and each enabled module's, in the order they are tried (openspec: modules-as-packages).
   A page whose module is off is not in the table, so its chunk is never fetched. */
import { PAGES } from '#site/pages'

/* the page this address shows, what it is given, and when it is mounted afresh: a page keyed by the route at every
   address, any other once per place in the table, as each branch of a v-if chain was */
const shown = computed(() => {
  const p = pageAt(PAGES, route.value, { CMS, DEV })
  if (!p) return null
  if (p.name === 'site-route') { const r = siteRouteOf(route.value); return { component: r.component, props: propsOf(p, route.value), key: r.path } }
  return { component: p.component, props: propsOf(p, route.value), key: p.keyBy === 'route' ? route.value : 'p' + p.order }
})

import { site as SITE_RAW } from '#content'
const SITE_NAME = ((Array.isArray(SITE_RAW) ? SITE_RAW[0] : SITE_RAW) || {}).name || 'Site'
const TITLES = {
  [ROUTES.home]: SITE_NAME,
  [ROUTES.diagnostics]: SITE_NAME + ' — the app',
  [ROUTES.content]: SITE_NAME + ' — content',
  [ROUTES.admin]: SITE_NAME + ' — admin',
  [ROUTES.store]: SITE_NAME + ' — store',
}

/* the public pages set their own title and meta (src/lib/seo.js); only the
   dev-only admin, which has no page of its own to do it, is titled here */
function applyRouteMeta(path: string) {
  if (path === ROUTES.admin || path.startsWith(ROUTES.admin + '/')) document.title = TITLES[ROUTES.admin]
}

/* every route change is a page view */
/* the in-browser voice's weights start downloading, quietly, the first time a
   reader is somewhere they might read from (the tts module decides) */
watch(route, (path) => { applyRouteMeta(path); if (path !== ROUTES.preview) pageview(path); warmSpeech(path) }, { immediate: true })
</script>

<template>
  <!-- a usage payment that needs the customer, said above every page until it is settled -->
  <UsagePaymentAlert />
  <component :is="shown.component" v-if="shown" :key="shown.key" v-bind="shown.props" />
  <!-- global overlays, independent of which page rendered -->
  <AuthModal />
  <CtaHost />
  <CartDrawer v-if="STORE_ON" />
  <SiteToast />
  <!-- the support chat's launcher, on every public page (it hides itself on the admin and for the staff) -->
  <!-- the launcher appears only where something may: a place of work is not a place to be sold to,
       and that rule is one rule (lib/interrupt.js), asked by the chat and by the ad alike -->
  <SupportWidget v-if="moduleOn('support') && mayInterrupt(route, INTERRUPT_ROUTES)" />
</template>

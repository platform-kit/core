<script setup>
import { moduleOn } from '@platform-kit/kit/lib/modules.js'
import { mayInterrupt } from '@platform-kit/kit/lib/interrupt.js'
import { watch, defineAsyncComponent } from 'vue'
import { route, ROUTES, INTERRUPT_ROUTES, DEV, CMS, STORE_ON, DOCS_ONLY, FORMS_ON, API_ON, SESSIONS_ON, MODELS_ON, ENTRY_KEYS, isPageRoute, siteRouteOf } from './router.js'
import { warmSpeech } from '@platform-kit/kit/lib/tts/support.js'
import LandingPage from './pages/LandingPage.vue'
import AuthModal from './components/AuthModal.vue'
import CtaHost from './components/CtaHost.vue'
import CartDrawer from './components/store/CartDrawer.vue'
import SiteToast from './components/SiteToast.vue'
import UsagePaymentAlert from './components/UsagePaymentAlert.vue'
import SupportWidget from './components/support/SupportWidget.vue'
import { pageview } from '@platform-kit/kit/lib/analytics.js'
import siteConfig, { modules } from '#site'   /* the module switches (platformkit.config.js) */


/* The instrument is 200kB of corpora and engine. Keeping it behind a dynamic
   import means / never pays for it. */
const DiagnosticsPage = defineAsyncComponent(() => import('./pages/DiagnosticsPage.vue'))
/* a booking's video room on the site: its own page, no sheet around it (the sessions module) */
const CallPage = moduleOn('sessions') ? defineAsyncComponent(() => import('./pages/CallPage.vue')) : null
/* speaking to an assistant: its own page, no sheet around it (the bots module) */
const VoicePage = moduleOn('bots') ? defineAsyncComponent(() => import('./pages/VoicePage.vue')) : null
const ContentPage = defineAsyncComponent(() => import('./pages/ContentPage.vue'))
/* Local-dev only: the working document (no password gate on localhost) and the
   content admin. Guarded on DEV so a production build tree-shakes the imports
   entirely — the code never ships, not just never renders. */
const AdminPage = defineAsyncComponent(() => import('./pages/AdminPage.vue'))   /* one shell for every desk: the CMS with the content pipe, or in production the live views alone */
const PreviewPage = CMS ? defineAsyncComponent(() => import('./pages/PreviewPage.vue')) : null
const SharePage = defineAsyncComponent(() => import('./pages/SharePage.vue'))
/* In production /admin is the analytics & KPI dashboard: a small lazy chunk with
   no chart/grid deps, and its data is refused server-side to anyone but an admin. */
/* off by VITE_STORE=false: the chunk is never fetched and the route falls to / */
const StorePage = STORE_ON ? defineAsyncComponent(() => import('./pages/StorePage.vue')) : null
/* a form on its own page (the forms module): its chunk carries the runner and the logic, fetched only there */
const FormPage = FORMS_ON ? defineAsyncComponent(() => import('./pages/FormPage.vue')) : null
const ApiReferencePage = API_ON ? defineAsyncComponent(() => import('./pages/ApiReferencePage.vue')) : null
const BookPage = SESSIONS_ON ? defineAsyncComponent(() => import('./pages/BookPage.vue')) : null
/* a cart from the Store API followed to its checkout (store-api): the bag filled, the buyer sent on */
const CartHandoffPage = STORE_ON ? defineAsyncComponent(() => import('./pages/CartHandoffPage.vue')) : null
const HyperswitchCheckoutPage = defineAsyncComponent(() => import('./pages/HyperswitchCheckoutPage.vue'))
const BillingPortalPage = defineAsyncComponent(() => import('./pages/BillingPortalPage.vue'))
/* the support panel on a page of its own ($chatwidget.popoutChatWindow; support-api) */
const SupportPage = moduleOn('support') ? defineAsyncComponent(() => import('./pages/SupportPage.vue')) : null
/* the comment thread in somebody else's frame — a chunk of its own, since the site itself never draws it */
const CommentsEmbedPage = defineAsyncComponent(() => import('./pages/CommentsEmbedPage.vue'))
const SpacesPage = moduleOn('spaces') ? defineAsyncComponent(() => import('./pages/SpacesPage.vue')) : null
/* the social network: the timeline, the notifications and a thread (the network module) */
const FeedPage = moduleOn('network') ? defineAsyncComponent(() => import('./pages/FeedPage.vue')) : null
/* WHERE THE SPACES AND THE NETWORK ARE BOTH ON, /feed opens on the spaces page in either layout
   (community.layout): one page answers both and stays mounted as somebody moves between them, and the
   layout decides only the frame it wears. The network on its own keeps FeedPage. */
const COMMUNITY = !!(SpacesPage && FeedPage)
/* a person's own page, and the reader's own settings at /p */
const PersonPage = defineAsyncComponent(() => import('./pages/PersonPage.vue'))
/* an achievement's own page */
const AwardPage = defineAsyncComponent(() => import('./pages/AwardPage.vue'))
/* a content model's pages (the models module; only a model with pages on has any) */
const EntriesPage = MODELS_ON && ENTRY_KEYS.size ? defineAsyncComponent(() => import('./pages/EntriesPage.vue')) : null

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
function applyRouteMeta(path) {
  if (path === ROUTES.admin || path.startsWith(ROUTES.admin + '/')) document.title = TITLES[ROUTES.admin]
}

/* every route change is a page view */
/* the in-browser voice's weights start downloading, quietly, the first time a
   reader is somewhere they might read from (src/lib/tts/support.js decides) */
watch(route, (path) => { applyRouteMeta(path); if (path !== ROUTES.preview) pageview(path); warmSpeech(path) }, { immediate: true })
</script>

<template>
  <!-- a usage payment that needs the customer, said above every page until it is settled -->
  <UsagePaymentAlert />
  <!-- a docs-only site whose root no landing page claims opens on the docs -->
  <ContentPage v-if="DOCS_ONLY && route === ROUTES.home && !isPageRoute(ROUTES.home)" />
  <LandingPage v-else-if="route === ROUTES.home" />
  <CallPage v-else-if="CallPage && route.startsWith(ROUTES.diagnostics + '/call/')" :key="route" />
  <VoicePage v-else-if="VoicePage && route.startsWith(ROUTES.diagnostics + '/voice/')" :key="route" />
  <DiagnosticsPage v-else-if="route === ROUTES.diagnostics || route.startsWith(ROUTES.diagnostics + '/')" />
  <ContentPage v-else-if="route === ROUTES.content || route.startsWith(ROUTES.content + '/')" />
  <ContentPage v-else-if="DOCS_ONLY && (route === ROUTES.docs || route.startsWith(ROUTES.docs + '/'))" />
  <PreviewPage v-else-if="CMS && route === ROUTES.preview" />
  <SharePage v-else-if="route === ROUTES.share || route.startsWith(ROUTES.share + '/')" />
  <AdminPage v-else-if="route === ROUTES.admin || route.startsWith(ROUTES.admin + '/')" />
  <StorePage v-else-if="STORE_ON && (route === ROUTES.store || route.startsWith(ROUTES.store + '/'))" />
  <FormPage v-else-if="FORMS_ON && (route.startsWith(ROUTES.form + '/') || route.startsWith(ROUTES.to + '/'))" :key="route" :path="route" />
  <ApiReferencePage v-else-if="ApiReferencePage && route === ROUTES.api" />
  <BookPage v-else-if="BookPage && route.startsWith(ROUTES.book + '/')" :key="route" :path="route" />
  <CartHandoffPage v-else-if="CartHandoffPage && route.startsWith(ROUTES.cart + '/c/')" :key="route" :path="route" />
  <HyperswitchCheckoutPage v-else-if="route === ROUTES.hyperswitchCheckout" :key="route" />
  <BillingPortalPage v-else-if="route === ROUTES.billing" :key="route" />
  <SupportPage v-else-if="SupportPage && route === ROUTES.support" />
  <!-- the comment thread in somebody else's frame: our page, so our session and our sign-in -->
  <CommentsEmbedPage v-else-if="route.startsWith(ROUTES.embed + '/comments')" :key="route" :path="route" />
  <SpacesPage v-else-if="SpacesPage && (route === ROUTES.spaces || route.startsWith(ROUTES.spaces + '/') || (COMMUNITY && (route === ROUTES.feed || route.startsWith(ROUTES.feed + '/'))))" />
  <FeedPage v-else-if="FeedPage && (route === ROUTES.feed || route.startsWith(ROUTES.feed + '/'))" />
  <AwardPage v-else-if="route.startsWith(ROUTES.awards + '/')" :key="route" />
  <!-- a coach's own page is a landing page claiming this exact address, and it wins: the profile
       page is what stands there for somebody who has not built one -->
  <PersonPage v-else-if="(route === ROUTES.account || route.startsWith(ROUTES.people + '/')) && !isPageRoute(route)" :key="route" />
  <EntriesPage v-else-if="EntriesPage && route.startsWith(ROUTES.entries + '/')" :key="route" :path="route" />
  <LandingPage v-else-if="isPageRoute(route)" :key="route" :path="route" />
  <!-- a page the site registered (platformkit.config.js routes) -->
  <component :is="siteRouteOf(route).component" v-else-if="siteRouteOf(route)" :key="siteRouteOf(route).path" :path="route" />
  <LandingPage v-else path="/" />
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

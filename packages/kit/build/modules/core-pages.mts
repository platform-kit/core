/*
 * The pages every site has (openspec: modules-as-packages): core's contribution to the page table, beside the
 * modules' own. Orders keep the place each page had in App.vue's chain, ten apart.
 */
import type { PageContribution } from './manifest.mjs'

const T = (name: string) => 'platformkit/lib/page-routes.js#' + name

export const CORE_PAGES: PageContribution[] = [
  { name: 'ContentPage', order: 10, page: 'theme:pages/ContentPage.vue', test: T('docsRoot') },
  { name: 'LandingPage', order: 20, page: 'theme:pages/LandingPage.vue', test: T('home'), eager: true },
  { name: 'DiagnosticsPage', order: 50, page: 'theme:pages/DiagnosticsPage.vue', test: T('app') },
  { name: 'ContentPage', order: 60, page: 'theme:pages/ContentPage.vue', test: T('content') },
  { name: 'ContentPage', order: 70, page: 'theme:pages/ContentPage.vue', test: T('docs') },
  { name: 'PreviewPage', order: 80, page: 'theme:pages/PreviewPage.vue', test: T('preview'), cmsOnly: true },
  { name: 'SharePage', order: 90, page: 'theme:pages/SharePage.vue', test: T('share') },
  { name: 'AdminPage', order: 100, page: 'theme:pages/AdminPage.vue', test: T('admin') },
  { name: 'HyperswitchCheckoutPage', order: 160, page: 'theme:pages/HyperswitchCheckoutPage.vue', test: T('hyperswitchCheckout'), keyBy: 'route' },
  { name: 'BillingPortalPage', order: 170, page: 'theme:pages/BillingPortalPage.vue', test: T('billing'), keyBy: 'route' },
  /* an offer's own checkout, the store or no store (openspec: offer-checkout-page) */
  { name: 'ApplyPage', order: 174, page: 'theme:pages/ApplyPage.vue', test: T('apply'), keyBy: 'route', props: { path: 'route' } },
  { name: 'CheckoutPage', order: 175, page: 'theme:pages/CheckoutPage.vue', test: T('offerCheckout'), keyBy: 'route', props: { path: 'route' } },
  { name: 'CommentsEmbedPage', order: 190, page: 'theme:pages/CommentsEmbedPage.vue', test: T('commentsEmbed'), keyBy: 'route', props: { path: 'route' } },
  { name: 'AwardPage', order: 220, page: 'theme:pages/AwardPage.vue', test: T('award'), keyBy: 'route' },
  { name: 'PersonPage', order: 240, page: 'theme:pages/PersonPage.vue', test: T('person'), keyBy: 'route' },
  { name: 'LandingPage', order: 260, page: 'theme:pages/LandingPage.vue', test: T('landing'), keyBy: 'route', props: { path: 'route' }, eager: true },
  /* a page the site registered (platformkit.config.js routes): the page table shows the registered component */
  { name: 'site-route', order: 270, page: 'theme:site-route', test: T('siteRoute'), props: { path: 'route' } },
  { name: 'LandingPage', order: 1000, page: 'theme:pages/LandingPage.vue', test: T('anywhere'), props: { path: '/' }, eager: true },
]

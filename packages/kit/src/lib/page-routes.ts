/*
 * Which address each page answers (openspec: modules-as-packages).
 *
 * Every page a module contributes names one of these tests in its manifest's `pages`; the kit's page table
 * (src/lib/pages.ts) tries the enabled modules' pages in their order and shows the first whose test holds.
 * Each test is exactly the condition the page had in App.vue's chain, so every address shows the page it did
 * (build/module-routes.test.mts). `ctx` carries what differs between the dev server and a built site.
 *
 * A module's tests move into its own folder with the module; until then they are here.
 */
import { ROUTES, DOCS_ONLY, ENTRY_KEYS, MODELS_ON, isPageRoute, siteRouteOf } from './router.js'

export type PageContext = { CMS: boolean, DEV: boolean }
export type PageTest = (route: string, ctx: PageContext) => boolean

const at = (route: string, base: string) => route === base || route.startsWith(base + '/')

/* core */
export const docsRoot: PageTest = (r) => !!DOCS_ONLY && r === ROUTES.home && !isPageRoute(ROUTES.home)
export const home: PageTest = (r) => r === ROUTES.home
export const app: PageTest = (r) => at(r, ROUTES.diagnostics)
export const content: PageTest = (r) => at(r, ROUTES.content)
export const docs: PageTest = (r) => !!DOCS_ONLY && at(r, ROUTES.docs)
export const preview: PageTest = (r, ctx) => ctx.CMS && r === ROUTES.preview
export const share: PageTest = (r) => at(r, ROUTES.share)
export const admin: PageTest = (r) => at(r, ROUTES.admin)
export const hyperswitchCheckout: PageTest = (r) => r === ROUTES.hyperswitchCheckout
export const billing: PageTest = (r) => r === ROUTES.billing
export const commentsEmbed: PageTest = (r) => r.startsWith(ROUTES.embed + '/comments')
export const award: PageTest = (r) => r.startsWith(ROUTES.awards + '/')
export const person: PageTest = (r) => (r === ROUTES.account || r.startsWith(ROUTES.people + '/')) && !isPageRoute(r)
export const landing: PageTest = (r) => isPageRoute(r)
export const siteRoute: PageTest = (r) => !!siteRouteOf(r)
export const anywhere: PageTest = () => true

/* sessions */
export const call: PageTest = (r) => r.startsWith(ROUTES.diagnostics + '/call/')
export const book: PageTest = (r) => r.startsWith(ROUTES.book + '/')
/* bots */
export const voice: PageTest = (r) => r.startsWith(ROUTES.diagnostics + '/voice/')
/* store */
export const store: PageTest = (r) => at(r, ROUTES.store)
export const cartHandoff: PageTest = (r) => r.startsWith(ROUTES.cart + '/c/')
/* forms */
export const form: PageTest = (r) => r.startsWith(ROUTES.form + '/') || r.startsWith(ROUTES.to + '/')
/* api */
export const apiReference: PageTest = (r) => r === ROUTES.api
/* support */
export const support: PageTest = (r) => r === ROUTES.support
/* spaces, and the feed it answers where the network is on too */
export const spaces: PageTest = (r) => at(r, ROUTES.spaces)
export const feed: PageTest = (r) => at(r, ROUTES.feed)
/* models: a content model's own pages, where any model has pages on */
export const entries: PageTest = (r) => !!MODELS_ON && ENTRY_KEYS.size > 0 && r.startsWith(ROUTES.entries + '/')

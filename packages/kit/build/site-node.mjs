/* #site under Node (tests, scripts): the same shape the Vite plugin gives the browser, read from the site in cwd */
import { loadSite, publicSite } from './site.mjs'
const c = await loadSite()
export default publicSite(c)
export const modules = c.modules
/* the declared set, so lib/modules.js refuses a mistyped name under Node exactly as it does in the browser */
export const moduleKeys = c.moduleKeys
export const api = publicSite(c).api
export const site = c
/* the community's registered places; under Node there is no page to load */
export const places = (publicSite(c).community.places || []).map((x) => ({ ...x, load: null }))

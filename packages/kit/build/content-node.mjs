/*
 * Node-only view of the compiled content (#content).
 *
 * The generated .velite/index.js re-exports the JSON with `with { type: 'json' }`
 * import attributes, which the Node the test suite runs on cannot parse. Vite uses
 * its own alias for #content and never touches this file; Node resolves #content
 * here (via the "node" condition in package.json `imports`) and loads the JSON with
 * fs instead, so the engine's data modules work under plain `node build/*.test.mjs`.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dir = process.cwd() + '/.velite/'   /* the site's compiled content: the kit's scripts run in the site's root */
/* a collection the site has not (a site's own is absent from another site) reads as empty */
const load = (f, empty = []) => { try { return JSON.parse(readFileSync(dir + f, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return empty; throw e } }

export const articles = load('articles.json')
export const wiki = load('wiki.json')
export const docs = load('docs.json')
export const books = load('books.json')
export const ads = load('ads.json')
export const products = load('products.json')
export const collections = load('collections.json')
export const sessions = load('sessions.json')
export const storefront = load('storefront.json', {})
export const pages = load('pages.json')
export const experiments = load('experiments.json')
export const companions = load('companions.json')
export const forms = load('forms.json')
/* the content models (the parsed records) and each one's entries by key — models_<key>.json, as velite names them */
export const models = load('models.json')
export const entriesOf = (key) => load('models_' + String(key).replace(/-/g, '_') + '.json')
export const site = load('site.json', {})
/* the community surface's own settings — a singleton like the site's, and empty where a site has
   written none, which is how every field falls through to the kit's own */
export const community = load('community.json', {})
/* the instrument's collections are a site's own (velite.site.js): a site without them gets nothing here */
export const personality = load('personality.json')
export const blockages = load('blockages.json')
export const diagnostics = load('diagnostics.json')
export const results = load('results.json')
export const ui = load('ui.json')

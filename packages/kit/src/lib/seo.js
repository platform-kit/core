/*
 * The document head, per route: title, description, canonical, Open Graph and
 * Twitter cards. The site's own name, default description, share image and
 * public address come from content/site.md (edited under Site in the admin);
 * each kind of page supplies what it has — an article its title, subtitle and
 * cover, a product its subtitle and photo, a landing page its own SEO fields.
 * build/prerender.mjs bakes whatever this sets into the static HTML.
 *
 * Every page has a share image. The build photographs a card for the site, for
 * each article and for each book (build/share-images.mjs → /share/*.png, drawn
 * by src/pages/SharePage.vue); a page, article or book that sets `share` in its
 * frontmatter uses that instead, and the site's own `image` in content/site.md
 * replaces the generated default for everything else.
 */
import { DOCS_BASE, DOCS_ONLY } from './router.js'
import { site as SITE_RAW, articles, wiki, docs, books, products, collections, storefront } from '#content'
import { us } from './content.js'
import { resolveHead } from './seo-head.js'

const SITE = Array.isArray(SITE_RAW) ? SITE_RAW[0] : SITE_RAW
const site = () => SITE || { name: 'Site' }
const one = (x) => (Array.isArray(x) ? x[0] : x)
const imageOf = (c) => (typeof c === 'string' ? c : c && c.src) || ''
const strip = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
/*
 * THE SHARE PICTURE OF ANY RECORD, at one address shape: /share/<kind>/<id>.png.
 *
 * EVERY PAGE POINTS AT ONE, not just an article and a book. Before this a product, a wiki entry, a
 * doc or a landing page with no picture of its own fell through to the site's default card — so a
 * link to a product showed the site's name where it could have shown the product. The address is
 * the same shape for all of them, and what answers it is the server's business: the file the build
 * photographed, the prerender sidecar's photograph of the app's own card, or the share-image
 * function drawing one. A record naming its own share picture still wins.
 */
export const SHARE = {
  default: '/share/default.png',
  of: (kind, id) => (id ? '/share/' + kind + '/' + id + '.png' : '/share/default.png'),
  article: (id) => SHARE.of('articles', id),
  book: (slug) => SHARE.of('books', slug),
  page: (route) => (route && route !== '/' ? SHARE.of('pages', String(route).replace(/^\/+|\/+$/g, '').replace(/\//g, '-')) : '/share/default.png'),
}

/* upsert one head element, or remove it when it has nothing to say */
function tag(selector, make, content) {
  let el = document.head.querySelector(selector)
  if (!content) { if (el) el.remove(); return }
  if (!el) { el = make(); document.head.appendChild(el) }
  if (el.tagName === 'LINK') el.setAttribute('href', content); else el.setAttribute('content', content)
}
const metaN = (name) => () => { const m = document.createElement('meta'); m.setAttribute('name', name); return m }
const metaP = (prop) => () => { const m = document.createElement('meta'); m.setAttribute('property', prop); return m }
const link = (rel) => () => { const l = document.createElement('link'); l.setAttribute('rel', rel); return l }

export function setHead({ title = '', description = '', image = '', path = null, type = 'website', noindex = false } = {}) {
  const s = site()
  const { title: full, description: desc, url, image: img } = resolveHead({ title, description, image, path }, s, SHARE.default)
  if (typeof document === 'undefined') return { title: full, description: desc, url, image: img }
  document.title = full
  tag('meta[name="description"]', metaN('description'), desc)
  tag('link[rel="canonical"]', link('canonical'), url)
  tag('meta[property="og:site_name"]', metaP('og:site_name'), s.name)
  tag('meta[property="og:title"]', metaP('og:title'), full)
  tag('meta[property="og:description"]', metaP('og:description'), desc)
  tag('meta[property="og:type"]', metaP('og:type'), type)
  tag('meta[property="og:url"]', metaP('og:url'), url)
  tag('meta[property="og:image"]', metaP('og:image'), img)
  tag('meta[name="twitter:card"]', metaN('twitter:card'), img ? 'summary_large_image' : 'summary')
  tag('meta[name="twitter:site"]', metaN('twitter:site'), s.twitter || '')
  tag('meta[name="twitter:title"]', metaN('twitter:title'), full)
  tag('meta[name="twitter:description"]', metaN('twitter:description'), desc)
  tag('meta[name="twitter:image"]', metaN('twitter:image'), img)
  tag('meta[name="robots"]', metaN('robots'), noindex ? 'noindex, nofollow' : '')
  return { title: full, description: desc, url, image: img }
}

/* a landing page: its own SEO fields, else the site's */
export function headForPage(p) {
  if (!p) return setHead({ path: '/' })
  return setHead({ title: p.seoTitle || (p.route === '/' ? '' : p.title), description: p.description, image: p.image || SHARE.page(p.route), path: p.route || '/' })
}

/* the library: the hub and indexes from the strings, an entry from itself */
export function headForContent(kind, id) {
  const S = us('pages').seo || {}
  const idx = { hub: '/content', articles: '/content/articles', wiki: '/content/wiki', docs: DOCS_BASE, books: '/content/books' }
  if (!id || !idx[kind]) { const k = idx[kind] ? kind : (DOCS_ONLY ? 'docs' : 'hub'); return setHead({ title: (S[k] || {}).title, description: (S[k] || {}).description, path: idx[k] }) }
  const path = idx[kind] + '/' + id
  const find = (col) => (col || []).find((e) => e.id === id)
  if (kind === 'articles') { const a = find(articles); return setHead({ title: a && a.title, description: a && (a.description || strip(a.excerpt)), image: a && (a.share || SHARE.article(a.id)), path, type: 'article' }) }
  if (kind === 'books') { const b = (books || []).find((e) => (e.slug || e.id) === id); return setHead({ title: b && (b.author ? `${b.title} by ${b.author}` : b.title), description: b && b.description, image: b && (b.share || SHARE.book(b.slug || b.id)), path, type: 'book' }) }
  const e = find(kind === 'wiki' ? wiki : docs)
  setHead({ title: e && e.title, description: e && (e.description || strip(e.excerpt)), image: e && (e.share || imageOf(e.cover) || SHARE.of(kind, id)), path, type: 'article' })
}

/* the store: the storefront file for the front, a product or collection from itself */
export function headForStore(kind, id) {
  const S = us('pages').seo || {}
  const sf = one(storefront) || {}
  if (kind === 'products' && id) { const p = (products || []).find((x) => x.id === id); return setHead({ title: p && p.title, description: p && (p.subtitle || strip(p.excerpt)), image: p && (p.share || p.image || SHARE.of('products', id)), path: '/store/products/' + id, type: 'product' }) }
  if (kind === 'collections' && id) { const c = (collections || []).find((x) => x.id === id); return setHead({ title: c && c.title, description: c && (c.subtitle || c.description), image: c && (c.share || c.image || SHARE.of('collections', id)), path: '/store/collections/' + id }) }
  if (kind === 'collections') return setHead({ title: (S.collections || {}).title, description: (S.collections || {}).description, path: '/store/collections' })
  setHead({ title: sf.heroTitle || (S.store || {}).title, description: sf.heroSubtitle || (S.store || {}).description, image: sf.heroImage, path: '/store' })
}

export function headForKey(key, path, noindex = false) {
  const S = (us('pages').seo || {})[key] || {}
  setHead({ title: S.title, description: S.description, path, noindex })
}

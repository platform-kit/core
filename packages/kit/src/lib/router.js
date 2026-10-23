/*
 * A handful of routes, so a router library would be most of a dependency for none
 * of its features. / is the product page, /app is the instrument, /content the
 * library. Anything else lands on /.
 *
 * Deploying this needs the server to serve index.html for every route, not just /
 * — see deploy/ and the README. Vite's dev server already does.
 */
import { ref, readonly } from 'vue'
import { pages as PAGES } from '#content'
import { routes as SITE_ROUTES } from '#site/routes'   /* the site's own pages (platformkit.config.js routes) */

/* the community's base address, the site's (community.path), /feed when it says nothing */
const COMMUNITY_PATH = (site && site.community && site.community.path) || '/feed'
export const ROUTES = {
  home: '/',
  diagnostics: '/app',
  content: '/content',
  admin: '/admin',
  preview: '/__preview',   /* dev only: the page inside the admin's live-preview frame */
  share: '/__share',       /* the share cards the build photographs (build/share-images.mjs); never linked */
  store: '/store',
  billing: '/billing',
  hyperswitchCheckout: '/checkout/hyperswitch',
  docs: '/docs',           /* a docs-only site: the docs at the root of the address space (see DOCS_ONLY) */
  form: '/form',           /* a form on its own page, no chrome: /form/<slug> (the forms module) */
  to: '/to',               /* the same page under Typeform's address shape, /to/<slug> — where Typeform's embed looks (forms-api) */
  api: '/api',             /* the API reference: Scalar over the content API's OpenAPI document (the api module) */
  /* THE COMMENT THREAD IN A FRAME: /embed/comments?kind=&subject=&title=&url= — a page of OURS, so
     the reader's session is ours to read and a guest may sign in. A script drawn into somebody
     else's page runs on their origin, where the session is not, and could only ever read. */
  embed: '/embed',
  support: '/support',     /* the support panel on a page of its own — $chatwidget.popoutChatWindow (support-api) */
  cart: '/cart',           /* a cart from the Store API followed to its checkout: /cart/c/<token> fills the bag (store-api) */
  book: '/book',           /* a booking type on its own page, no chrome: /book/<slug> — where cal.com's embed looks (the sessions module; scheduling-api) */
  /* The spaces surface: /spaces/<space>/<channel> — the word the rest of the product uses for the
     thing (content/spaces, the spaces tables, the admin's Spaces, the spaces module), so a reader
     is not told a different one. It was /channels, after Discord's /channels/<server>/<channel>,
     because the content API answered Contentful's own Spaces API at /spaces/<id>/entries; that
     API now answers under /api, which a client reaches with Contentful's own basePath. */
  spaces: '/spaces',
  /* SOMEBODY'S OWN PAGE: /p/<username>. One letter, because it sits in front of a name somebody
     will say out loud and write on a card — and it is a PUBLIC address, which is the whole reason
     it is short. The reader's own settings are not that and are not under it: `/p` with nothing
     after it read as a profile with no name, and the one page on the site that is nobody's but
     yours sat at the front of the one prefix that is for showing people. */
  people: '/p',
  /* …and the reader's own account: what they are called, the face they wear, and whether they
     have a page at all. Said in full, because it is a place somebody goes deliberately. */
  account: '/account',
  /* an achievement's own page: /a/<slug>. It is a page anybody may read, earned or not — one
     nobody can read before they have earned it is one nobody knows to try for. */
  awards: '/a',
  /* COURSES: /courses the list, /courses/<slug> a course, /courses/<slug>/<lesson> a lesson (the courses module) — and a
     certificate at /certificates/<id>, a public address anyone given it can check */
  courses: '/courses',
  certificates: '/certificates',
  /* THE SOCIAL NETWORK: /feed the timeline, /feed/notifications what happened to the reader,
     /feed/post/<id> a thread (the network module). Not /home: the root is home, and a site's own
     landing page may already claim the word. The base is the site's to name (community.path) —
     /feed fits an activity feed, not a community with a coach, a diagnostic and a desk in it — and
     an old /feed address forwards to it. */
  feed: COMMUNITY_PATH,
  entries: '/c',           /* a content model's pages: /c/<key> the index, /c/<key>/<slug> an entry (the models module) — one prefix, so no key can meet a fixed route */
}
export const INTERRUPT_ROUTES = [ROUTES.feed, ROUTES.spaces, ROUTES.people]
const LEGACY_USAGE_PATH = ROUTES.diagnostics + '/usage'
const isLegacyUsagePath = (pathname) =>
  (pathname || '').replace(/\/+$/, '') === LEGACY_USAGE_PATH

/* The working document is local-dev only — never part of a production build, its
   route resolves to / off localhost. /admin is the content CMS in dev and the
   admin-only analytics dashboard in production (gated server-side by role). */
export const DEV = import.meta.env.DEV
/* cloud mode (CONTENT_STORE=cloud at build time): the content is rows, the admin's backend the `admin` function, and the CMS ships */
export const CLOUD = import.meta.env.CONTENT_STORE === 'cloud'
/* the CMS is on the dev server, and on a cloud-mode site for an administrator */
export const CMS = DEV || CLOUD
/* The store is a module (platformkit.config.js modules.store): off, its route resolves to /
   like any unknown path, the nav link, the bag and the cart drawer go, ads that point at it
   are never picked, a gate stops offering it, and the prerender leaves it out of the sitemap. */
import site, { modules, places as SITE_PLACES } from '#site'
import { forwardOf, socialSpacesHome } from './community/places.js'
import { libraryOf } from './courses-paths.js'
/* the one reading of a switch (lib/modules.js): it refuses a name no manifest declares, because
   `modules.stor !== false` is TRUE and would switch a module on rather than off */
import { moduleOn, anyModuleOn } from './modules.js'
export const STORE_ON = moduleOn('store')
/* The library's four kinds are modules too (modules.articles, books, wiki, docs; on by default): a kind off has
   no route, no lane, no admin view, no place in the prerender. */
/* the forms module: /form/<slug> exists only with it on */
export const FORMS_ON = moduleOn('forms')
export const API_ON = moduleOn('api')
export const SESSIONS_ON = moduleOn('sessions')
/* the content models (on unless a site says models: false): /c/<key> exists only for a model with pages on */
import { models as MODELS } from '#content'
export const MODELS_ON = moduleOn('models')
export const ENTRY_KEYS = new Set(MODELS_ON ? (MODELS || []).filter((m) => m.deliver && m.deliver.pages).map((m) => m.key) : [])
const entryRoute = (p) => { if (!MODELS_ON || !p.startsWith(ROUTES.entries + '/')) return false; const key = p.slice(ROUTES.entries.length + 1).split('/')[0]; return ENTRY_KEYS.has(key) }
export const KINDS_ON = { articles: moduleOn('articles'), books: moduleOn('books'), wiki: moduleOn('wiki'), docs: moduleOn('docs') }
/* Accounts matter only where a module reads them — buying, membership, sessions, the chats, the desk, a
   reading. With none of those on, the header offers no sign-in and no call to action of its own. */
export const ACCOUNTS_ON = anyModuleOn(['store', 'memberships', 'sessions', 'coaching', 'support', 'instrument', 'recommendations', 'network', 'courses'])
/* the social network: a page per person, follows, a timeline (lib/network) */
export const NETWORK_ON = moduleOn('network')
/* A site configured down to the docs alone — no other kind of content, nothing that needs an account — is a
   standalone documentation site: the docs live at /docs (and at / when no landing page claims the root), the
   hub is gone, and the docs shell is the plain one (a sidebar, the page, an on-this-page rail; no hero). */
export const DOCS_ONLY = KINDS_ON.docs && !KINDS_ON.articles && !KINDS_ON.books && !KINDS_ON.wiki && !ACCOUNTS_ON
/* where the docs are addressed: /docs on a docs-only site, /content/docs in a library */
export const DOCS_BASE = DOCS_ONLY ? ROUTES.docs : ROUTES.content + '/docs'
/* the routes the landing pages in content/pages claim (the root is one of them) */
export const PAGE_ROUTES = new Set(PAGES.map((p) => p.route || '/'))
export const isPageRoute = (p) => PAGE_ROUTES.has(p)
/* the site's route a path belongs to: exact, or the path and everything under it when the route says prefix */
export const siteRouteOf = (p) => SITE_ROUTES.find((r) => p === r.path || (r.prefix && p.startsWith(r.path + '/'))) || null
/* THE ADDRESSES COMMUNITY PLACES HAVE CLAIMED: the kit's Coaching (where coaching lives in the
   community, /app/coaching) and every place a site registered (community.places claims) */
const CLAIMS = [
  ...(((site && site.coaching) || {}).where === 'spaces' ? [{ key: 'coaching', claims: [ROUTES.diagnostics + '/coaching'] }] : []),
  ...(SITE_PLACES || []),
]
/* THE COURSES: their own pages at /courses always (the library, a course, a lesson, a certificate), and the same in the
   community's Courses place at <community>/courses where the site has one (openspec: courses) */
export const COURSES_PLACE_BASE = COMMUNITY_PATH + '/courses'
export const coursesRoute = (p) => moduleOn('courses') && (p === ROUTES.courses || p.startsWith(ROUTES.courses + '/') || p.startsWith(ROUTES.certificates + '/'))
/* the app area once carried the reader's courses; that address is the library now, ahead of any place claiming /app */
const appCourses = (p) => (moduleOn('courses') ? libraryOf(p, ROUTES.diagnostics, ROUTES.courses) : null)
const KNOWN = [ROUTES.home, ROUTES.diagnostics, ROUTES.admin]
  .concat(DOCS_ONLY ? [ROUTES.docs] : [ROUTES.content])
  .concat([ROUTES.hyperswitchCheckout, ROUTES.billing])
  .concat(STORE_ON ? [ROUTES.store] : [])
  .concat(CMS ? [ROUTES.preview] : [])

/* /content carries nested paths — /content/articles/some-piece — so it matches
   by prefix and keeps the whole path; everything else matches exactly. */
function normalise(pathname) {
  let p = (pathname || '/').replace(/\/+$/, '') || '/'
  /* the community's old base forwards to the one the site names */
  if (ROUTES.feed !== '/feed' && (p === '/feed' || p.startsWith('/feed/'))) p = ROUTES.feed + p.slice(5)
  p = socialSpacesHome(p, site && site.community && site.community.layout, ROUTES.spaces, ROUTES.feed)
  /* /app/courses is the library */
  const library = appCourses(p)
  if (library) return library
  /* an address a community place has claimed lives there now (community.places claims) */
  const moved = NETWORK_ON ? forwardOf(p, CLAIMS, ROUTES.feed) : null
  if (moved) p = moved
  if (p === '/diagnostics') p = ROUTES.diagnostics /* the old address still works */
  if (p === LEGACY_USAGE_PATH) p = ROUTES.billing
  if (p === ROUTES.diagnostics + '/billing') p = ROUTES.billing
  if (DOCS_ONLY) {
    /* the library's address for the docs still works, as an alias; the hub and the other kinds go to the docs */
    if (p === ROUTES.content + '/docs' || p.startsWith(ROUTES.content + '/docs/')) p = ROUTES.docs + p.slice((ROUTES.content + '/docs').length)
    if (p === ROUTES.content || p.startsWith(ROUTES.content + '/')) return ROUTES.docs
    if (p === ROUTES.docs || p.startsWith(ROUTES.docs + '/')) return p
  } else if (p === ROUTES.content || p.startsWith(ROUTES.content + '/')) {
    /* a kind switched off has no address: its path goes to the hub */
    const kind = p.split('/')[2]
    return kind && kind in KINDS_ON && !KINDS_ON[kind] ? ROUTES.content : p
  }
  /* the app carries the open page of the results sheet (/app/diagnostics) */
  if (p === ROUTES.diagnostics || p.startsWith(ROUTES.diagnostics + '/')) return p
  if (p === ROUTES.hyperswitchCheckout) return p
  if (p === ROUTES.billing) return p
  /* a share card names its kind and id (/__share/books/the-kybalion) */
  if (p === ROUTES.share || p.startsWith(ROUTES.share + '/')) return p
  /* the admin carries its place in the path (/admin/books/slug) so a refresh keeps it */
  if (p === ROUTES.admin || p.startsWith(ROUTES.admin + '/')) return p
  /* the store has collection and product pages beneath it */
  if (STORE_ON && (p === ROUTES.store || p.startsWith(ROUTES.store + '/'))) return p
  /* a form's own page carries its slug */
  if (FORMS_ON && (p.startsWith(ROUTES.form + '/') || p.startsWith(ROUTES.to + '/'))) return p
  if (API_ON && p === ROUTES.api) return p
  if (SESSIONS_ON && p.startsWith(ROUTES.book + '/')) return p
  if (STORE_ON && p.startsWith(ROUTES.cart + '/c/')) return p
  if (moduleOn('support') && p === ROUTES.support) return p
  /* the embed's own page, no chrome, framed by somebody else's site */
  if (p.startsWith(ROUTES.embed + '/')) return p
  if (moduleOn('spaces') && (p === ROUTES.spaces || p.startsWith(ROUTES.spaces + '/'))) return p
  if (NETWORK_ON && (p === ROUTES.feed || p.startsWith(ROUTES.feed + '/'))) return p
  /* an achievement's page carries its slug */
  if (p.startsWith(ROUTES.awards + '/')) return p
  if (coursesRoute(p)) return p
  /* a person's own page carries their username; /p alone is the reader's own settings */
  if (p === ROUTES.account || p.startsWith(ROUTES.people + '/')) return p
  if (entryRoute(p)) return p
  /* a landing page written in content/pages owns its route */
  if (PAGE_ROUTES.has(p)) return p
  /* a page the site registered */
  if (siteRouteOf(p)) return p
  return KNOWN.indexOf(p) >= 0 ? p : ROUTES.home
}

const initialPath = typeof location === 'undefined' ? '/' : location.pathname
const current = ref(normalise(initialPath))
if (typeof window !== 'undefined' && isLegacyUsagePath(initialPath)) {
  history.replaceState(null, '', `${ROUTES.billing}${location.search}#usage`)
} else if (typeof window !== 'undefined' && site && site.community && site.community.layout === 'social'
  && initialPath.replace(/\/+$/, '') === ROUTES.spaces && current.value !== initialPath) {
  history.replaceState(null, '', `${current.value}${location.search}${location.hash}`)
}

export const route = readonly(current)

export function navigate(path) {
  const url = new URL(path, location.origin)
  const legacyUsage = isLegacyUsagePath(url.pathname)
  const next = normalise(url.pathname)
  const hash = legacyUsage ? '#usage' : url.hash
  const destination = `${next}${url.search}${hash}`
  if (destination !== location.pathname + location.search + location.hash) {
    history.pushState(null, '', destination)
  }
  current.value = next
  window.dispatchEvent(new Event('platformkit:navigate'))
  if (hash === '#usage') {
    window.scrollTo(0, 0)
  } else if (hash) {
    requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView())
  } else {
    window.scrollTo(0, 0)
  }
}
/* the same without a history entry: for making an address canonical in place */
export function replace(path) {
  const next = normalise(path)
  if (next !== location.pathname) history.replaceState(null, '', next)
  current.value = next
}

/* The results sheet's pages, by their structural key, as they appear in the
   address: /app/<slug>. These are addresses, not labels — the words a reader
   sees on the tabs live in content/app/results.md. */
export const APP_PAGES = { sum: 'overview', pairs: 'personality', areas: 'results', words: 'blockages', books: 'recommendations', trophies: 'accomplishments', coaching: 'coaching', chat: 'chat' }
/* WHERE THE APP'S PAGES LIVE: /app, unless a community place has claimed it — then the place's own
   address, so the sheet, a round and its tabs read and write addresses there and the instrument
   needs to know nothing about it. A video call and a voice
   session stay at /app (ROUTES.diagnostics) whatever claims the rest. */
export const APP_BASE = (NETWORK_ON && forwardOf(ROUTES.diagnostics, CLAIMS, ROUTES.feed)) || ROUTES.diagnostics
/* a page's former slug, still read so a link made before the rename lands on it */
const APP_PAGES_FORMER = { diagnostics: 'areas' }
export const appPath = (key) => APP_BASE + '/' + (APP_PAGES[key] || '')
/* the address that means "start a round": the instrument begins one on arrival
   (the header's Take the quiz), and the sheet makes the address its first page's */
export const QUIZ_PATH = APP_BASE + '/quiz'
/* the page key an /app address names, or null for a bare /app or an unknown slug;
   a page may carry more after its slug (/app/chat/<conversation id>) */
export function appPageOf(path) {
  const m = new RegExp('^' + APP_BASE + '/([a-z-]+)(?:/.*)?$').exec(path || '')
  if (!m) return null
  return Object.keys(APP_PAGES).find((k) => APP_PAGES[k] === m[1]) || APP_PAGES_FORMER[m[1]] || null
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const path = location.pathname
    current.value = normalise(path)
    if (isLegacyUsagePath(path)) {
      history.replaceState(null, '', `${current.value}${location.search}#usage`)
      window.scrollTo(0, 0)
    } else if (site && site.community && site.community.layout === 'social'
      && path.replace(/\/+$/, '') === ROUTES.spaces && current.value !== path) {
      history.replaceState(null, '', `${current.value}${location.search}${location.hash}`)
    }
  })

  /* Internal links stay plain <a href="/...">, so they still work without JS and
     read correctly to a crawler. This turns them into route changes instead of
     reloads. Modified clicks, new tabs and external links are left alone. */
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = e.target.closest && e.target.closest('a')
    if (!a) return
    if (a.target && a.target !== '_self') return
    if (a.hasAttribute('download')) return
    const href = a.getAttribute('href')
    if (!href || href[0] !== '/') return          /* anchors and absolute urls pass through */
    if (a.origin !== location.origin) return
    const target = normalise(a.pathname)
    if (KNOWN.indexOf(target) < 0 && !target.startsWith(ROUTES.content) && !coursesRoute(target) && !target.startsWith(ROUTES.diagnostics + '/') && !(NETWORK_ON && (target === ROUTES.feed || target.startsWith(ROUTES.feed + '/'))) &&
        !target.startsWith(ROUTES.admin) && !(STORE_ON && target.startsWith(ROUTES.store)) && !(FORMS_ON && (target.startsWith(ROUTES.form + '/') || target.startsWith(ROUTES.to + '/'))) && !(SESSIONS_ON && target.startsWith(ROUTES.book + '/')) && !(STORE_ON && target.startsWith(ROUTES.cart + '/c/')) && !(moduleOn('support') && target === ROUTES.support) && !entryRoute(target) && !PAGE_ROUTES.has(target) && !siteRouteOf(target)) return
    e.preventDefault()
    navigate(href)
  })

  /* a bookmarked trailing slash or an unknown path becomes / without a reload */
  if (location.pathname !== current.value && !location.pathname.startsWith(current.value)) {
    history.replaceState(null, '', current.value + location.search + location.hash)
  }
}

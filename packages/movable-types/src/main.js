import { get as stored } from '@platform-kit/kit/lib/store.js'

{
  /* WHERE THE HOST HAS NO REWRITE, the site's shell answers the path (it answers every path) and
     forwards it before anything loads — the same rooms as deploy/_redirects, in one list. Each room
     is stripped exactly as the host's rule strips it, so the function sees the product's own path
     and knows nothing of the prefix. A pixel cannot come back through here, so it is written
     against the function's own address. */
  const at = window.location.pathname, q = window.location.search
  const fns = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
  const ROOMS = [
    ['/api/content', 'content'],
    ['/api/media', 'images'],
    ['/api/desk', 'support-api'],
    ['/api/scheduling', 'scheduling-api'],
    ['/api/forms', 'forms-api'],
    ['/api/events', 'ingest'],
    ['/api/store', 'storefront-api'],

    /* the app's own backend, which has no room: the whole function name follows */
    ['/v1', ''],
  ]
  /* the store's alias: Shopify's client discards a path on its storeDomain and asks at the top of
     /api whatever it is given, so those paths reach the same door as the room does */
  const SHOP = /^\/api\/[^/]+\/graphql(\.json)?$|^\/api\/carts\/[a-f0-9]+$/
  if (fns) {
    /* the widget's script is a file of the build, at a second address where a snippet's baseUrl looks */
    if (at === '/api/desk/packs/js/sdk.js') window.location.replace('/packs/js/sdk.js' + q)
    else if (SHOP.test(at)) window.location.replace(`${fns}/functions/v1/storefront-api${at}${q}`)
    else for (const [room, fn] of ROOMS) {
      if (at !== room && !at.startsWith(room + '/')) continue
      const rest = at.slice(room.length)
      window.location.replace(`${fns}/functions/v1/${fn}${fn ? rest : rest.replace(/^\//, '')}${q}`)
      break
    }
  }
}
/* the stored choice wins; nothing stored means follow the system. Read straight
   from the store (Loro) so the theme is set before first paint, no flash */
try {
  const saved = stored('dl.theme')
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved
} catch (e) { /* private mode */ }
/* cloud mode (CONTENT_STORE=cloud): the rows of public.content are loaded into the bundled collections
   BEFORE the app's modules are evaluated, so a list a module makes of a collection at import time is of the
   live content; in git mode load() returns at once. The app is the module after this one. */
import { load as loadContent } from '@platform-kit/kit/lib/content-live.js'
await loadContent()
await import('./app.js')

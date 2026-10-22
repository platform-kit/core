/*
 * Chatwoot's website snippet, answered by this site (support-api): the site's support widget — the launcher, the
 * panel, the prompts, a guest's token in the page's own localStorage — mounted on another site's page by the snippet
 * Chatwoot's docs give, with the base changed:
 *
 *   <script>
 *     (function(d,t){ var BASE_URL="https://the-site"; var g=d.createElement(t),s=d.getElementsByTagName(t)[0];
 *       g.src=BASE_URL+"/packs/js/sdk.js"; g.defer=true; g.async=true; s.parentNode.insertBefore(g,s);
 *       g.onload=function(){ window.chatwootSDK.run({ websiteToken: "<the site's inbox identifier>", baseUrl: BASE_URL }) }
 *     })(document,"script");
 *   </script>
 *
 * Built by build/support-sdk.mjs into dist/packs/js/sdk.js (IIFE, Vue and the widget inside, the design tokens with
 * it — the light store, as the form embed). `websiteToken` must be the site's inbox identifier (its space id, what the
 * Client API's inbox is): anything else refuses to run with a line in the console. `window.$chatwidget` is installed as
 * the widget mounts (lib/support/chat-widget.js), with `window.$chatwoot` as an alias of the same object, and
 * `chatwidget:ready` fires once it has booted — `chatwoot:ready` beside it. A guest on another
 * origin is a guest here: the site's sign-in is not on that page, so the panel offers none.
 */
import { createApp, h } from 'vue'
import { api as API } from '#site'
import SupportWidget from './components/support/SupportWidget.vue'
import { look, applyLook } from 'platformkit/lib/look.js'
import { setSiteBase } from 'platformkit/lib/support/api.js'
import './tokens.css'   /* the design's tokens: without them the widget wears the host page's, and loses its hairlines and its ink */
import './looks/design.css'
import '#site/looks'

let app = null
const me = document.currentScript
function run({ websiteToken, baseUrl } = {}) {
  if (String(websiteToken || '') !== String(API.space)) { console.error(`chatwootSDK: websiteToken "${websiteToken}" is not this site's inbox identifier ("${API.space}") — see Settings → API`); return }
  if (app) return
  /* the site, seen from this page: what the snippet was given, else where this script came from — so a prompt's
     picture and any other path of ours is fetched from the site and not from the page carrying the widget */
  setSiteBase(baseUrl || (me && me.src ? new URL(me.src).origin : ''))
  if (!document.documentElement.dataset.look) applyLook(look.value)
  const host = document.createElement('div'); host.setAttribute('data-platformkit-support', ''); document.body.appendChild(host)
  window.chatwootSettings = { ...(window.chatwootSettings || {}), baseUrl: baseUrl || '' }
  app = createApp({ render: () => h(SupportWidget) })
  app.mount(host)
}
window.chatwootSDK = { run }
window.PlatformKitSupport = { run }

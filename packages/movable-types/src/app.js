/* the app itself, imported by main.js once the content is in place: the css, the look, the session, the mount */
import { createApp } from 'vue'
import App from './App.vue'
import { initAuth } from '@platform-kit/kit/lib/auth.js'
import { initLockdown } from '@platform-kit/kit/lib/lockdown.js'
import { initAuthNotices } from '@platform-kit/kit/lib/auth-notices.js'
import { init as initAnalytics } from '@platform-kit/kit/lib/analytics.js'
import './tailwind.css'
import './tokens.css'   /* the design's tokens, shared with the embeds */
import './atlas.css'
import './looks/design.css'
import '#site/looks'   /* every palette the site declares */
import { look, applyLook } from '@platform-kit/kit/lib/look.js'

/* the site's look (content/site.md, or ?look= for this visit) goes on the root
   before the app mounts, so the first paint is already in it */
applyLook(look.value)

/* a prerendered page (build/prerender.mjs) ships its route's markup for crawlers
   and re-renders on mount; any other route was served the fallback shell, whose
   baked markup belongs to another page — clear it rather than flash it */
try {
  const pre = document.documentElement.dataset.prerendered
  const here = location.pathname.replace(/\/+$/, '') || '/'
  if (pre && pre !== here) document.getElementById('app').innerHTML = ''
} catch (e) { /* no document */ }

const app = createApp(App)

/* restore any signed-in session and follow later changes; not awaited, so
   first paint never waits on the network (it degrades to the guest app) */
initAuth()
/* LOCKDOWN_MODE=1: everyone but the admins is signed out and told the app is closed */
initLockdown()
/* what an email link left in the address — an expired one, or a confirmation — is said in a toast */
initAuthNotices()
/* the event batcher + unload flush (and PostHog, only if a key is configured) */
initAnalytics()

/* PrimeVue powers the dev-only content admin (/admin). Loaded behind the DEV
   guard and via dynamic import, so none of it reaches a production build. Its
   primary palette is tuned to the app's teal accent, and dark mode follows the
   site's data-theme. */
if (import.meta.env.DEV) {
  const [{ default: PrimeVue }, { definePreset }, { default: Aura }] = await Promise.all([
    import('primevue/config'),
    import('@primevue/themes'),
    import('@primevue/themes/aura'),
  ])
  const preset = definePreset(Aura, {
    semantic: {
      primary: {
        50: '#effcf7', 100: '#d6f7ea', 200: '#aeeed6', 300: '#78e0bd', 400: '#42cca1',
        500: '#1cb287', 600: '#0f926e', 700: '#0d7457', 800: '#0e5c47', 900: '#0d4b3b', 950: '#052e25',
      },
    },
  })
  app.use(PrimeVue, { theme: { preset, options: { darkModeSelector: '[data-theme="dark"]', cssLayer: false } } })
}

app.mount('#app')

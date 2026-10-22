<script setup>
/* The API reference at /api: Scalar's reference (MIT) over the OpenAPI document the content function generates from the
   index — every route of the content API and the analytics door, one schema per content type — so the page always
   says what this site serves. Full-bleed under the header, in the site's light or dark as the root's data-theme says
   (Scalar's own toggle hidden), its colours mapped from the site's tokens. Behind the `api` module; not prerendered
   (the document is fetched live); noindex. Words: `api.md` `## reference`. */
import { ref, shallowRef, onMounted, onBeforeUnmount } from 'vue'
import { us } from 'platformkit/lib/strings.js'
import { setHead } from 'platformkit/lib/seo.js'
import { ROUTES } from '../router.js'
import { site as SITE } from '#content'
import SiteMark from '../components/SiteMark.vue'

const W = (us('api').reference || {}).head || {}
const S = Array.isArray(SITE) ? SITE[0] : SITE
setHead({ title: W.title, description: W.description, path: ROUTES.api, noindex: true })
const Scalar = shallowRef(null), failed = ref('')
const fns = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const url = fns + '/functions/v1/content/openapi.json'
const dark = ref(document.documentElement.dataset.theme === 'dark')
let mo = null
onMounted(async () => {
  mo = new MutationObserver(() => { dark.value = document.documentElement.dataset.theme === 'dark' })
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  try {
    const [mod] = await Promise.all([import('@scalar/api-reference'), import('@scalar/api-reference/style.css')])
    Scalar.value = mod.ApiReference
  } catch (e) { failed.value = e && e.message ? e.message : String(e) }
})
onBeforeUnmount(() => { if (mo) mo.disconnect() })
</script>

<template>
  <div class="apiref" :data-dark="dark ? 'true' : 'false'">
    <header class="apiref-bar"><a :href="ROUTES.home" class="apiref-home"><SiteMark class="apiref-mark" /><b>{{ S && S.name }}</b></a><span class="apiref-title">{{ W.title }}</span><a :href="ROUTES.home" class="apiref-back">{{ W.back }}</a></header>
    <component :is="Scalar" v-if="Scalar" :key="dark ? 'd' : 'l'" :configuration="{ url, theme: 'none', darkMode: dark, forceDarkModeState: dark ? 'dark' : 'light', hideDarkModeToggle: true, showToolbar: 'never', withDefaultFonts: false }" />
    <p v-else-if="failed" class="apiref-note">{{ failed }}</p>
    <p v-else class="apiref-note">{{ W.loading }}</p>
  </div>
</template>

<style>
/* Scalar's tokens from the site's: the page reads as the site does in either theme (unscoped: Scalar's markup is its own) */
.apiref { min-height: 60vh; --scalar-custom-header-height: 48px }
.apiref-bar { position: sticky; top: 0; z-index: 20; height: 48px; display: flex; align-items: center; gap: 14px; padding: 0 16px; background: var(--paper); border-bottom: 1px solid var(--hair); font-size: 14px }
.apiref-bar > * { white-space: nowrap } .apiref-home { display: inline-flex; align-items: center; gap: 8px; min-width: 0; color: var(--ink); text-decoration: none } .apiref-home b { overflow: hidden; text-overflow: ellipsis } .apiref-mark { flex: none; width: 22px; height: 22px } .apiref-title { color: var(--ink3) } .apiref-back { margin-left: auto; flex: none; color: var(--ink2); text-decoration: none } .apiref-back:hover { color: var(--ink) }
@media (max-width: 599px) { .apiref-title { display: none } }
.apiref-note { padding: 48px 24px; text-align: center; color: var(--ink3) }
/* the site's element rules (a header's padding, a paragraph's and a title's measure) stop at Scalar's markup */
.apiref .scalar-app header { padding-top: 0; padding-bottom: 0 } .apiref .scalar-app p, .apiref .scalar-app h1 { max-width: none }
.apiref .scalar-app, .apiref .light-mode, .apiref .dark-mode {
  --scalar-font: inherit; --scalar-font-code: var(--m);
  --scalar-background-1: var(--paper); --scalar-background-2: var(--card); --scalar-background-3: color-mix(in srgb, var(--ink) 5%, var(--paper));
  --scalar-background-accent: color-mix(in srgb, var(--accent2) 12%, transparent);
  --scalar-color-1: var(--ink); --scalar-color-2: var(--ink2); --scalar-color-3: var(--ink3); --scalar-color-accent: var(--accent2);
  --scalar-border-color: var(--hair); --scalar-sidebar-background-1: var(--paper); --scalar-sidebar-color-1: var(--ink); --scalar-sidebar-color-2: var(--ink2);
  --scalar-sidebar-border-color: var(--hair); --scalar-sidebar-item-hover-background: color-mix(in srgb, var(--ink) 5%, transparent); --scalar-sidebar-item-active-background: color-mix(in srgb, var(--accent2) 12%, transparent);
  --scalar-sidebar-search-background: var(--card); --scalar-sidebar-search-border-color: var(--hair); --scalar-sidebar-color-active: var(--ink);
  --scalar-button-1: var(--ink); --scalar-button-1-color: var(--paper); --scalar-button-1-hover: var(--ink2);
  --scalar-radius: 8px; --scalar-radius-lg: 12px; --scalar-radius-xl: 14px;
}
</style>

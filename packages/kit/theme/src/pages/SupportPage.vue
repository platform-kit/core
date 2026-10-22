<script setup>
/* The support panel on a page of its own — /support: what $chatwidget.popoutChatWindow opens in a new tab (support-api),
   and a plain way in for a reader whose page has no room for the widget. The panel as the widget mounts it, on the
   site's ground, no launcher (the page is the panel); the same threads, the same token. Words: support.md `widget.page`. */
import { onMounted, onBeforeUnmount } from 'vue'
import { ROUTES, navigate } from '../router.js'
import { setHead } from 'platformkit/lib/seo.js'
import { us } from 'platformkit/lib/strings.js'
import { boot, open, close } from 'platformkit/lib/support/api.js'
import { resolveDefault, fallback } from 'platformkit/lib/support/prompts.js'
import SupportPanel from '../components/support/SupportPanel.vue'
import SiteMark from '../components/SiteMark.vue'

const W = (us('support').widget || {}).page || {}
setHead({ title: W.title || '', description: W.lead || '', path: ROUTES.support, noindex: true })
onMounted(async () => { resolveDefault(); await boot(); open() })
onBeforeUnmount(close)
</script>

<template>
  <div class="suppage lproot">
    <header class="suppage-bar"><a :href="ROUTES.home" class="suppage-home" @click.prevent="navigate(ROUTES.home)"><SiteMark class="suppage-mark" /></a><span class="suppage-title">{{ W.title }}</span></header>
    <main class="suppage-main"><SupportPanel class="suppage-panel" :fallback="fallback" @close="navigate(ROUTES.home)" /></main>
  </div>
</template>

<style scoped>
.suppage { min-height: 100vh; background: var(--paper); color: var(--ink); display: flex; flex-direction: column }
.suppage-bar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--hair); font-size: 14px }
.suppage-home { display: inline-flex; color: var(--ink); text-decoration: none } .suppage-mark { width: 22px; height: 22px } .suppage-title { color: var(--ink3) }
.suppage-main { flex: 1; display: flex; justify-content: center; padding: 16px }
.suppage-main :deep(.sp) { width: min(560px, 100%); height: min(760px, calc(100vh - 100px)); border: 1px solid var(--hair); border-radius: 16px; overflow: hidden }
@media (max-width: 640px) { .suppage-main { padding: 0 } .suppage-main :deep(.sp) { width: 100%; height: calc(100vh - 50px); border: 0; border-radius: 0 } }
</style>

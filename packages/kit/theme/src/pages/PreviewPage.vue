<script setup>
/*
 * The page inside the admin's live-preview frame (dev only, at /__preview).
 * It renders a draft entry with the SAME components the site uses — the
 * article page, the wiki/docs page, the book reader, the ad card and modal —
 * fed through provide/inject in place of the compiled collection. Living in
 * its own frame, it gets a real viewport: the site's breakpoints, sticky bars
 * and fixed chrome all behave exactly as they do live, at whatever width the
 * admin gives the frame.
 *
 * The admin drives it over postMessage: { type: 'dl-preview', col, entry }.
 * This page says { type: 'dl-preview-ready' } when it can take one, and
 * { type: 'dl-preview-close' } when Escape is pressed inside it.
 */
import { ref, computed, provide, onMounted, onBeforeUnmount } from 'vue'
import ArticleView from '../components/content/ArticleView.vue'
import TreeSection from '../components/content/TreeSection.vue'
import BookReader from '../components/content/BookReader.vue'
import AdCard from '../components/AdCard.vue'
import AdModal from '../components/AdModal.vue'
import ProductPage from '../components/store/ProductPage.vue'
import CollectionPage from '../components/store/CollectionPage.vue'
import StoreHome from '../components/store/StoreHome.vue'
import LandingPage from './LandingPage.vue'
import { load as loadStorefront } from 'platformkit/lib/storefront.js'
import { applyLook } from 'platformkit/lib/look.js'
loadStorefront()   /* live prices for a product draft */

const col = ref('')
const entry = ref(null)
provide('dl-preview', entry)

/* the view remounts when the document changes, not on every keystroke */
const key = computed(() => col.value + ':' + (entry.value ? (entry.value.id || entry.value.slug || '') : ''))
/* the tree views take the same landing title + subtitle the site gives them */
const TREE = { wiki: { title: 'Wiki', subtitle: 'The canon, page by page.' }, docs: { title: 'Docs', subtitle: 'How everything works, in order.' } }

const say = (msg) => { if (window.parent !== window) window.parent.postMessage(msg, window.location.origin) }
function onMessage(e) {
  if (e.origin !== window.location.origin || !e.data) return
  /* the admin's look switch: the frame wears the look it names, unsaved */
  if (e.data.type === 'dl-look') { applyLook(e.data.look); return }
  /* the builder's open block: scroll its section into view and light it for a moment */
  if (e.data.type === 'dl-focus') { const el = document.querySelector(`[data-section="${e.data.index}"]`); if (el) { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); el.classList.add('pv-lit'); setTimeout(() => el.classList.remove('pv-lit'), 1400) } return }
  if (e.data.type !== 'dl-preview') return
  col.value = e.data.col || ''
  entry.value = e.data.entry || null
}
function onKey(e) { if (e.key === 'Escape' && !e.defaultPrevented) say({ type: 'dl-preview-close' }) }
/* a click on a page section opens its block in the builder (a link inside still goes nowhere: the preview is not the site) */
function onClick(e) { const el = e.target.closest && e.target.closest('[data-section]'); if (!el) return; e.preventDefault(); say({ type: 'dl-preview-pick', index: Number(el.dataset.section) }) }
onMounted(() => {
  window.addEventListener('message', onMessage)
  document.addEventListener('keydown', onKey)
  document.addEventListener('click', onClick)
  say({ type: 'dl-preview-ready' })
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('click', onClick)
})
</script>

<template>
  <div class="pv" :class="'pv-' + col">
    <div v-if="!entry" class="pv-empty">
      <p>{{ col === 'pages' ? 'Nothing to preview yet. Give the page a title and add a section.' : 'Nothing to preview yet. Give it a title and some text.' }}</p>
    </div>
    <div v-else class="pv-page" :key="key">
      <ArticleView v-if="col === 'articles'" :id="entry.id" />
      <TreeSection v-else-if="col === 'wiki' || col === 'docs'" :collection="col" :id="entry.id"
                   :title="TREE[col].title" :subtitle="TREE[col].subtitle" />
      <BookReader v-else-if="col === 'books'" :slug="entry.slug || 'preview'" />
      <div v-else-if="col === 'ads'" class="pv-ads">
        <div class="pv-adlabel">As the corner card</div>
        <AdCard :ad="entry" inline />
        <div class="pv-adlabel">As the modal</div>
        <AdModal :ad="entry" inline />
      </div>
      <ProductPage v-else-if="col === 'products'" :id="entry.id" />
      <CollectionPage v-else-if="col === 'collections'" :id="entry.id" />
      <StoreHome v-else-if="col === 'storefront'" />
      <LandingPage v-else-if="col === 'pages'" :path="entry.route || '/'" />
      <p v-else class="pv-empty">No preview for this type.</p>
    </div>
  </div>
</template>

<style scoped>
.pv { min-height: 100vh; background: var(--paper); color: var(--ink) }
.pv-empty { min-height: 100vh; display: flex; align-items: center; justify-content: center; color: var(--ink3); font-size: 14.5px; padding: 40px; text-align: center }
.pv-ads { padding: 28px; display: flex; flex-direction: column; gap: 14px; align-items: flex-start }
.pv-adlabel { font-family: var(--m); font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); margin-top: 10px }
/* a page's sections answer the builder: a hand under the pointer, a light on the one being edited */
.pv-pages :deep([data-section]) { cursor: pointer; scroll-margin-top: 12px; transition: box-shadow .3s, outline-color .3s; outline: 2px solid transparent; outline-offset: -2px; border-radius: 4px }
.pv-pages :deep([data-section]:hover) { outline-color: color-mix(in srgb, var(--accent2) 45%, transparent) }
.pv-pages :deep([data-section].pv-lit) { outline-color: var(--accent2); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent2) 30%, transparent), 0 0 0 6px color-mix(in srgb, var(--accent2) 12%, transparent) }
</style>

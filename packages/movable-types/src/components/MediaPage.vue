<script setup>
/*
 * Content → Media: the library — VueFinder over the site's two file roots (Uploads: content/uploads, Site files:
 * public) through the kit's driver (lib/admin/media-driver.js), which speaks to the content pipe, so the checkout and
 * the bucket are one library. Browse (grid or list), preview, upload (Uppy), new folder, rename, move, copy, delete,
 * search, and every file's address to copy; no archives, no text editor, no new empty file — the pipe does not serve
 * them. The chrome is ours through VueFinder's slots (components/admin/media/: the roots, the bar, the toolbar, the
 * breadcrumb's actions, the status bar, the item glyph), and its explorer and modals are skinned to the admin's
 * tokens by vuefinder-skin.css over its class hooks — VueFinder itself is never patched. The page fills the admin's
 * main like the grids do. As a picker (`pick`), the same in a modal: one file, pictures only where the field wants
 * one, Use this file or Cancel. Words are content/app/ui/media.md.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, shallowRef, provide } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { isSignedIn, mayEditContent, roleKnown } from '@platform-kit/kit/lib/auth.js'
import { VueFinder } from 'vuefinder'
/* the manager's stylesheet, injected as it is: it is Tailwind 4's output (`@layer base`), which the site's Tailwind 3
   pipeline would refuse; the browser reads cascade layers natively. Once, for the page and the pickers alike. Ours
   (the skin) is a plain stylesheet and loads after it. */
import vuefinderCss from 'vuefinder/dist/style.css?raw'
if (typeof document !== 'undefined' && !document.getElementById('vuefinder-css')) { const st = document.createElement('style'); st.id = 'vuefinder-css'; st.textContent = vuefinderCss; document.head.prepend(st) }   /* first in the head, so the skin's rules win on equal specificity */
import './admin/media/vuefinder-skin.css'
import { MediaDriver, toStore } from '../lib/admin/media-driver.js'
import { SELECTION, USAGE } from './admin/media/use-media.js'
import MediaRoots from './admin/media/MediaRoots.vue'
import MediaBar from './admin/media/MediaBar.vue'
import MediaToolbar from './admin/media/MediaToolbar.vue'
import MediaCrumbActions from './admin/media/MediaCrumbActions.vue'
import MediaStatus from './admin/media/MediaStatus.vue'
import MediaIcon from './admin/media/MediaIcon.vue'
import AdminHead from './admin/AdminHead.vue'

const props = defineProps({ pick: { type: Boolean, default: false }, pictures: { type: Boolean, default: false } })
const emit = defineEmits(['pick', 'cancel'])
const W = us('media').page
const H = W.head, P = W.pick, F = W.file

/* what its plugin would have provided app-wide: given here, so the manager rides with this page alone */
provide('VueFinderOptions', { i18n: {}, locale: 'en' })
const driver = new MediaDriver()
/* how many entries the open folder holds — the driver's listing, watched here for the empty state */
const count = ref(-1)
const listed = driver.result.bind(driver)
driver.result = async (d) => { const r = await listed(d); count.value = r.files.length; return r }
const state = ref('idle')          /* idle | denied | ok */
function load() {
  if (!isSignedIn.value) { state.value = 'idle'; return }
  if (roleKnown.value && !mayEditContent.value) { state.value = 'denied'; return }
  state.value = 'ok'
}
onMounted(load)
watch([isSignedIn, roleKnown, mayEditContent], load)

/* VueFinder's own theme follows the site's (what the skin does not reach still switches with it) */
const dark = ref(document.documentElement.dataset.theme === 'dark')
let mo = null
onMounted(() => { mo = new MutationObserver(() => { dark.value = document.documentElement.dataset.theme === 'dark' }); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }) })
onBeforeUnmount(() => { if (mo) mo.disconnect() })
/* the tiles: a card the size of a small cover, the list a comfortable row */
const config = computed(() => ({ theme: dark.value ? 'midnight' : 'silver', persist: !props.pick, initialPath: 'uploads://', showThumbnails: true, notificationPosition: 'bottom-right', gridItemWidth: 148, gridItemHeight: 150, gridItemGap: 10, gridIconSize: 56, listItemHeight: 40, listItemGap: 0, listIconSize: 18 }))
/* what the pipe serves: no archives, no editor, no new empty file, no theme or language switch (the site's own) */
const features = { edit: false, newfile: false, newfolder: true, preview: true, archive: false, unarchive: false, search: true, rename: true, upload: true, delete: true, fullscreen: false, download: true, language: false, move: true, copy: true, history: true, theme: false, pinned: !props.pick }

/* the selection, shared with the slot components (the toolbar's actions, the status bar's address) */
const selection = shallowRef([])
const withUrl = (it) => ({ ...it, url: it.url || driver.urlOf(toStore(it.path)) })
function onSelect(items) { selection.value = (items || []).map(withUrl); askUsage() }
provide(SELECTION, selection)
/* a file in use: the records that name each chosen entry, asked of the pipe a beat after the selection settles */
const usage = shallowRef({})
let usageTimer = null
function askUsage() {
  clearTimeout(usageTimer)
  const paths = selection.value.map((i) => toStore(i.path))
  if (!paths.length) { usage.value = {}; return }
  usageTimer = setTimeout(async () => { try { const u = await driver.usage(paths); if (selection.value.map((i) => toStore(i.path)).join() === paths.join()) usage.value = u } catch (e) { usage.value = {} } }, 120)
}
provide(USAGE, usage)

/* the picker: one file at a time; the chosen entry's address is what the field takes */
const chosen = computed(() => (selection.value.length ? selection.value[selection.value.length - 1] : null))
function use() { const c = chosen.value; if (c && c.type !== 'dir') emit('pick', { path: toStore(c.path), url: c.url, name: c.basename, mime: c.mime_type }) }
function onDclick(e) { if (props.pick && e && e.item && e.item.type === 'file') { selection.value = [withUrl(e.item)]; use() } }
const mimes = computed(() => (props.pictures ? ['image/'] : []))
function openAuth() { if (window.DLauth) window.DLauth.open() }
</script>

<template>
  <div class="md" :class="{ 'md-pick': pick }">
    <AdminHead v-if="!pick" :title="H.title" :sub="H.subtitle" />

    <div v-if="state === 'idle'" class="md-note"><h2>{{ H['signin-heading'] }}</h2><p>{{ H['signin-subtitle'] }}</p><button type="button" class="ui-btn ui-primary" @click="openAuth">{{ H['signin-cta'] }}</button></div>
    <div v-else-if="state === 'denied'" class="md-note"><h2>{{ H['denied-heading'] }}</h2><p>{{ H['denied-subtitle'] }}</p></div>

    <template v-else>
      <div class="md-frame" :class="{ dark }">
        <div v-if="count === 0" class="md-empty">{{ F.empty }}</div>
        <VueFinder :id="pick ? 'media-picker' : 'media'" :driver="driver" :config="config" :features="features" locale="en"
                   :selection-mode="pick ? 'single' : 'multiple'" :selection-filter-type="pick ? 'files' : 'both'" :selection-filter-mime-includes="mimes"
                   @select="onSelect" @file-dclick="onDclick">
          <template #menubar-start><MediaRoots /></template>
          <template #menu-items><span class="mr-none" /></template>   <!-- something, or VueFinder falls back to its own menubar -->
          <template #menubar-end><MediaBar /></template>
          <template #toolbar-items><MediaToolbar /></template>
          <template #breadcrumb-actions><MediaCrumbActions /></template>
          <template #status-bar><MediaStatus /></template>
          <template #icon="p"><MediaIcon v-bind="p" /></template>
        </VueFinder>
      </div>
      <div v-if="pick" class="md-foot">
        <span class="md-chosen">
          <template v-if="chosen && chosen.type !== 'dir'">{{ chosen.basename }} <i>{{ chosen.url }}</i></template>
          <template v-else>{{ pictures ? P.none + ' ' + P['only-pictures'] : P.none }}</template>
        </span>
        <button type="button" class="ui-btn" @click="emit('cancel')">{{ P.cancel }}</button>
        <button type="button" class="ui-btn ui-primary" :disabled="!chosen || chosen.type === 'dir'" @click="use">{{ P.use }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* the page fills the admin's main as the grids do: the head, then the frame taking the rest */
.md { flex: 1; min-height: 0; display: flex; flex-direction: column; color: var(--ink) }
.md-pick { height: 100% }
/* the same head as the grids' (AdminPage's .ad-head is scoped to it) */
.md-head { flex: none; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin: 0 0 20px; padding: 0; border: 0 }   /* the site's global header rule reset */
.md-note { max-width: 520px; margin: 40px auto; text-align: center; padding: 34px 28px; border: 1px solid var(--hair); border-radius: 18px; background: var(--card) }
.md-note h2 { font-family: var(--fd); font-weight: 600; font-size: 24px; margin: 0 0 8px } .md-note p { color: var(--ink2); margin: 0 0 16px }
.md-frame { position: relative; flex: 1; min-height: 0; border: 1px solid var(--hair); border-radius: 14px; overflow: hidden; background: var(--paper); display: flex; flex-direction: column }
.md-pick .md-frame { border-radius: 12px }
.md-pick :deep(.mr-status) { display: none }   /* the foot says it, with Use and Cancel */
.md-frame :deep(.vuefinder) { flex: 1; min-height: 0; display: flex; flex-direction: column; font-family: inherit }
.md-frame :deep(.vuefinder__main) { flex: 1; min-height: 0; height: auto; border: 0; border-radius: 0 }
.md-foot { display: flex; align-items: center; gap: 10px; padding: 12px 2px 0; min-height: 44px }
.md-chosen { flex: 1; min-width: 0; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap } .md-chosen i { font-style: normal; color: var(--ink3); font-family: var(--m); font-size: 12px; margin-left: 8px }
</style>

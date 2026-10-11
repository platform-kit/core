<script setup>
import { ref, computed, watch, inject, unref } from 'vue'
import { route, navigate, replace, appPath, appPageOf, ROUTES, APP_BASE } from '../../../router.js'
import { resolveTabs } from './tabs.js'   /* the shell's tabs: the kit's modules' and the site's, less the modules off */
import { answered as siteAnswered } from '#site/app'
import Gate from '../../../components/Gate.vue'
import { isSignedIn, emailVerified, roleKnown } from '@platform-kit/kit/lib/auth.js'

const emit = defineEmits(['start'])
/* the tabs on now; a page starts a round through its tab's start(); a tab's props are built once per sheet
   (the site's readings share one model through ctx) */
/* a host that gives some of these pages homes of their own (a community place: Accomplishments, Coaching)
   leaves them out by key */
const leaveOut = unref(inject('pk.sheet.hide', [])) || []
const tabs = resolveTabs().filter((t) => !leaveOut.includes(t.key))
const pages = tabs
const ctx = {}
const current = computed(() => tabs.find((t) => t.key === tab.value) || tabs[0])
const pageProps = computed(() => (current.value && current.value.props ? current.value.props(ctx) : {}))
function onStart(k) { const t = current.value; if (t && t.start) emit('start', t.start(k)) }
/* Each page has its own address, /app/<slug> (APP_PAGES in router.js). The sheet
   opens on the page the address names when that page is on, else on the first
   page that is on, and makes the address say so. Choosing a tab is a navigation,
   so the back button returns to the previous page. */
const has = (k) => pages.some((p) => p.key === k)
const wanted = appPageOf(route.value)
const tab = ref(wanted && has(wanted) ? wanted : pages[0].key)
/* an address that already names the page keeps what follows it (a conversation id) */
/* …and an address made with a page's former slug (/app/diagnostics) is put in its present one */
const here = appPath(tab.value)
if (appPageOf(route.value) !== tab.value || !(route.value === here || route.value.startsWith(here + '/'))) replace(here)
watch(tab, (k) => { if (appPageOf(route.value) !== k) navigate(appPath(k)) })
watch(route, (p) => {
  const k = appPageOf(p)
  if (k && k !== tab.value && has(k)) tab.value = k
  /* the bare address — the header's button — is the sheet's first page */
  else if (p === APP_BASE) { tab.value = pages[0].key; replace(appPath(tab.value)) }
})
/* The empty start page is open to everyone; seeing RESULTS asks for a (free)
   sign-in and a confirmed address — the moment the reader has something to
   look at. Until the flag has been read for a fresh session, nobody is called
   unconfirmed. */
const answered = !!(siteAnswered && siteAnswered())
const gated = computed(() => answered && (!isSignedIn.value || (roleKnown.value && !emailVerified.value)))
const need = computed(() => (isSignedIn.value ? 'verified' : 'authenticated'))
/* on a phone the tabs wrap; a dropdown reads better there */
const tabMenu = ref(false)
const tabLabel = () => (pages.find((p) => p.key === tab.value) || pages[0]).label
function pickTab(k) { tab.value = k; tabMenu.value = false }

</script>

<template>
  <div v-if="gated" class="results-sheet">
    <Gate kind="results" :required="need" />
  </div>
  <div v-else class="results-sheet">
    <!-- one page is no choice: no tab row (and no picker on a phone) for it -->
    <nav v-if="pages.length > 1" class="tab-bar">
      <button v-for="p in pages" :key="p.key" class="tab" :class="{ on: tab === p.key }"
              type="button" @click="tab = p.key">{{ p.label }}</button>
    </nav>

    <div v-if="pages.length > 1" class="tab-select">
      <button type="button" class="tsel-btn" :aria-expanded="tabMenu"
              @click="tabMenu = !tabMenu">
        {{ tabLabel() }}
        <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"
             :style="{ transform: tabMenu ? 'rotate(180deg)' : '' }">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </button>
      <div v-if="tabMenu" class="tsel-menu">
        <button v-for="p in pages" :key="p.key" type="button" class="tsel-item"
                :class="{ on: tab === p.key }" @click="pickTab(p.key)">
          {{ p.label }}
          <svg v-if="tab === p.key" viewBox="0 0 12 10" width="11" height="9" aria-hidden="true">
            <path d="M1 5.5 4.4 8.5 11 1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="tab-panel">
      <!-- the page the tab names, from the registry, with the props its tab builds; a start goes through its tab's start() -->
      <component :is="current.component" :key="current.key" v-bind="pageProps" @go="(k) => (tab = k)" @start="onStart" />
    </div>

  </div>
</template>

<style scoped>
/* the phone-sized dropdown that replaces the tab row */
/* z-index: the page-in animation leaves every child of the stage in a stacking context of its own, so
   without one the panel after this would paint over the open menu */
.tab-select { display: none; position: relative; z-index: 5; margin: 0 0 var(--s4) }
.tsel-btn {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%;
  font: inherit; font-size: 16px; font-weight: 700; color: var(--qink);
  background: var(--qcard); border: 1px solid var(--qhair); border-radius: 12px;
  padding: 13px 16px; cursor: pointer;
}
.tsel-btn svg { transition: transform .15s ease; color: var(--qink3) }
.tsel-menu {
  position: absolute; z-index: 40; top: calc(100% + 6px); left: 0; right: 0;
  background: var(--qcard, #fff); backdrop-filter: blur(14px);
  border: 1px solid var(--qhair); border-radius: 12px; padding: 6px;
  box-shadow: 0 18px 40px -14px #0c0d0b55;
}
.tsel-item {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%;
  text-align: left; font: inherit; font-size: 15px; color: var(--qink2);
  background: none; border: 0; border-radius: 8px; padding: 11px 12px; cursor: pointer;
}
.tsel-item:hover { background: #0c0d0b0a; color: var(--qink) }
.tsel-item.on { color: var(--qink); font-weight: 700 }

/* the sheet's prose runs the full width of the sheet: the site's own paragraph
   measure (p { max-width } in atlas.css) does not apply in here */
.results-sheet :deep(p) { max-width: none }
.results-sheet {
  /* wide enough that all six tabs sit on one row */
  width: 100%; margin: 0 auto; display: flex; flex-direction: column;
  animation: sheet-in .42s cubic-bezier(.2, .85, .25, 1);
}
@keyframes sheet-in { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }


/* the tabs. No backing — sticky needed one to hide content sliding under it, so
   the tabs sit still instead. */
.tab-bar {
  display: flex; background: none; padding: 0; gap: var(--s3); margin: 0 0 var(--s4);
  border-bottom: 1px solid var(--qhair); width: 100%; border-radius: 0; flex-wrap: nowrap;
}
.tab {
  background: none; border: 0; border-radius: 0; padding: 0 0 14px; font: inherit;
  font-size: 15px; font-weight: 400; color: var(--qink3); cursor: pointer;
  border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap;
}
.tab:hover { color: var(--qink) }
.tab.on { color: var(--qink); font-weight: 600; border-bottom-color: var(--qink) }

.headline {
  font-size: clamp(31px, 4.6vw, 45px); line-height: 1.1; letter-spacing: -.03em;
  font-weight: 700;  text-wrap: balance; margin: 0 0 var(--s3); color: var(--qink);
}
.eyebrow {
  display: block; font-family: var(--m, ui-monospace, Menlo, monospace); font-size: 10.5px;
  font-weight: 500; letter-spacing: .17em; text-transform: uppercase;
  color: var(--qink3); margin-bottom: var(--s2);
}
.lede { font-size: 16.5px; line-height: 1.65; color: var(--qink2); max-width:100%; margin: 0 }

/* the panel holds one height across the tabs, set from JS once every page has
   been measured, so switching swaps content and moves nothing else */
.tab-panel { width: 100% }

.aside {
  font-size: 14px; font-weight: 400; line-height: 1.65; color: var(--qink3);
  margin: var(--s2) 0 0;
}

@media (max-width: 560px) {
  .tab-bar { gap: var(--s2) }
  .tab { font-size: 13.5px }
}
@media (max-width: 640px) {
  .tab-bar { display: none }
  .tab-select { display: block }
}
</style>

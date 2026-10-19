<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, inject } from 'vue'
import { docTree, loadDoc, us } from '@platform-kit/kit/lib/content.js'
import MarkdownDoc from '../MarkdownDoc.vue'
import MediaBlock from './MediaBlock.vue'
import Gate from '../Gate.vue'
import { navigate, DOCS_BASE, ROUTES } from '../../router.js'
import { can, entrySubject } from '@platform-kit/kit/lib/auth.js'
import { allowedBy, requiredBy } from '@platform-kit/kit/lib/access.js'
import { contentView } from '@platform-kit/kit/lib/analytics.js'
import { useGatedPage } from '@platform-kit/kit/lib/gated.js'

/* Wiki and docs share this layout — an editorial article page: a full-bleed
   hero (optional cover), a floating reading panel, a navigation tree and an
   on-this-page rail, related pages, and the whole thing on a faint star ground.
   Wiki leans editorial; docs the same shell with denser content. A docs-only
   site (router.js DOCS_ONLY) wears the PLAIN shell instead: no hero and no
   ground — a sidebar, the page with its title at its head, the rail — the
   shape of a standalone documentation site, and the landing is the same shell
   with the sections as cards where the page would be.
   Words: library.md `tree` (`docs` / `wiki` for the eyebrow, title and search; `shell` for the rest). */
const props = defineProps({
  collection: { type: String, required: true },
  id: { type: String, default: '' },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  searchable: { type: Boolean, default: false },
  plain: { type: Boolean, default: false },
})
const T = us('library').tree || {}
const W = T[props.collection === 'wiki' ? 'wiki' : 'docs'] || {}
const SH = T.shell || {}
const title = props.title || W.title || ''
const subtitle = props.subtitle || W.subtitle || ''
/* where a page of this collection is addressed: the docs at their own root on a docs-only site */
const base = props.collection === 'docs' ? DOCS_BASE : ROUTES.content + '/' + props.collection
const fill = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m))

const tree = docTree(props.collection)
/* the tree flattened: every page carries the section (the nearest heading above it) it sits in, so the
   sidebar can fold sections — only the open page's section stands open by default, the rest fold to
   their headings, and any heading toggles; a page with no heading above it is always shown */
const flat = []
const walk = (node, depth, sec) => {
  node.docs.forEach((d) => flat.push({ ...d, depth, sec }))
  node.dirs.forEach((dir) => { const key = (sec ? sec + '/' : '') + dir.slug; flat.push({ heading: dir.title, depth, key, sec }); walk(dir, depth + 1, key) })
}
walk(tree, 0, '')
const openSecs = ref(new Set())
/* a section and every section above it */
const chain = (key) => { const out = []; let k = key; while (k) { out.push(k); k = k.includes('/') ? k.slice(0, k.lastIndexOf('/')) : '' } return out }
const toggleSec = (key) => { const n = new Set(openSecs.value); n.has(key) ? n.delete(key) : n.add(key); openSecs.value = n }
const secOpen = (key) => !key || chain(key).every((k) => openSecs.value.has(k))

const doc = ref(null)
const missing = ref(false)
const docEl = ref(null)
/* the root (no id) is a landing, not the first article */
const isLanding = computed(() => !props.id)
const currentId = computed(() => props.id)
/* the plain shell at phone width folds the tree behind a toggle naming the open page, so a long tree does
   not stand between the reader and the page; it closes again when a page is opened */
const navOpen = ref(false)
const currentTitle = computed(() => { const e = flat.find((x) => x.id === currentId.value); return e ? e.title : '' })

/* landing cards: pages grouped by their section (loose top-level pages first) */
const landingSections = computed(() => {
  const secs = [{ title: '', docs: [] }]
  let cur = secs[0]
  for (const e of flat) {
    if (e.heading) { cur = { title: e.heading, docs: [] }; secs.push(cur) }
    else cur.docs.push(e)
  }
  return secs.filter((s) => s.docs.length)
})
const fm = computed(() => (doc.value && doc.value.data) || {})
/* a canAccess bar in the frontmatter closes the page body until the reader clears it */
/* asked of the ability, as the article's is */
const allowed = computed(() => can('read', entrySubject({ kind: props.kind, slug: fm.value && fm.value.slug, canAccess: fm.value.canAccess })))

/* the admin's live preview provides a draft entry in place of the compiled one */
const preview = inject('dl-preview', null)
/* a gated page ships without its body (_shared/gate.js); a reader who may read it is sent it by reader-content */
const GW = us('library').reader.gated || {}
const page = useGatedPage(props.collection, () => !preview && doc.value && { id: currentId.value, html: doc.value.html, gated: fm.value.gated }, () => allowed.value)
watch(() => page.state.value, (st) => { if (st === 'done') nextTick(() => setupSpy()) })
async function show(id) {
  missing.value = false; doc.value = null
  if (preview) {
    const p = preview.value
    if (!p) return
    doc.value = { data: p, html: p.body, toc: p.toc }
    await nextTick(); setupSpy()
    return
  }
  if (!id) return
  const d = await loadDoc(props.collection, id)
  if (!d) { missing.value = true; return }
  doc.value = d
  contentView({ kind: props.collection, id, title: d.data && d.data.title, tags: d.data && d.data.tags })
  const entry = flat.find((e) => e.id === id)
  if (entry && d.data.title) entry.title = d.data.title
  await nextTick(); setupSpy(); window.scrollTo(0, 0)
}
watch(currentId, show, { immediate: true })
/* the open page's section unfolds as the page is opened; what the reader unfolded by hand stays */
watch(currentId, (id) => { const e = flat.find((x) => x.id === id); if (e && e.sec) openSecs.value = new Set([...openSecs.value, ...chain(e.sec)]) }, { immediate: true })
if (preview) watch(preview, () => show(currentId.value))
/* inside the preview the tree is for looking at, not leaving the editor by */
const open = (id) => { navOpen.value = false; if (!preview) navigate(base + '/' + id) }
/* the in-page search opens the full-site palette, pre-narrowed to this collection */
const openSearch = () => { if (window.DLsearch) window.DLsearch({ kind: props.collection === 'wiki' ? 'wiki' : 'doc' }) }

/* ---- hero + metadata ---- */
const eyebrow = W.eyebrow || ''
const heroStyle = computed(() => {
  const c = fm.value.cover
  return c && c.src ? { backgroundImage: `url("${c.src}")` } : {}
})
function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
function agoText(iso) {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days < 1) return SH.today
  if (days < 30) return days > 1 ? fill(SH.days, { n: days }) : SH.day
  const mo = Math.floor(days / 30)
  if (mo < 12) return mo > 1 ? fill(SH.months, { n: mo }) : SH.month
  const yr = Math.floor(mo / 12)
  return yr > 1 ? fill(SH.years, { n: yr }) : SH.year
}
/* the plain shell's meta line: only what the page has, a separator between each */
const metaBits = computed(() => [
  fm.value.author && { text: fm.value.author, cls: 'wk-author' },
  fm.value.date && { text: fmtDate(fm.value.date) },
  readMins.value && { text: fill(SH.read, { n: readMins.value }) },
  fm.value.updated && { text: fill(SH.updated, { ago: agoText(fm.value.updated) }), cls: 'wk-upd' },
].filter(Boolean))
/* the section a page sits in, for the plain shell's breadcrumb */
const crumb = computed(() => { const i = flat.findIndex((e) => e.id === currentId.value); for (let j = i; j >= 0; j--) if (flat[j].heading) return flat[j].heading; return '' })
const readMins = computed(() => (fm.value.metadata && fm.value.metadata.readingTime) || 0)

/* ---- related ---- */
const related = computed(() =>
  (fm.value.related || []).map((id) => flat.find((e) => e.id === id)).filter(Boolean))

/* ---- prev / next through the tree ---- */
const pages = flat.filter((e) => e.id)
const curIndex = computed(() => pages.findIndex((e) => e.id === currentId.value))
const prev = computed(() => (curIndex.value > 0 ? pages[curIndex.value - 1] : null))
const next = computed(() => (curIndex.value >= 0 && curIndex.value < pages.length - 1 ? pages[curIndex.value + 1] : null))

/* ---- on this page ---- */
const tocFlat = computed(() => {
  const out = []
  const wk = (items, lvl) => (items || []).forEach((it) => { out.push({ title: it.title, url: it.url, lvl }); wk(it.items, lvl + 1) })
  wk(doc.value && doc.value.toc, 0)
  return out
})
const activeHash = ref('')
let io = null
function setupSpy() {
  if (io) { io.disconnect(); io = null }
  const root = docEl.value
  if (!root) return
  const heads = [...root.querySelectorAll('h1[id],h2[id],h3[id]')]
  if (!heads.length) { activeHash.value = ''; return }
  activeHash.value = '#' + heads[0].id
  io = new IntersectionObserver((entries) => {
    const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
    if (vis[0]) activeHash.value = '#' + vis[0].target.id
  }, { rootMargin: '-96px 0px -68% 0px', threshold: 0 })
  heads.forEach((h) => io.observe(h))
}
onMounted(() => nextTick(setupSpy))
onBeforeUnmount(() => io && io.disconnect())
</script>

<template>
  <div class="wk" :class="{ plain }">
    <!-- ===================== LANDING ===================== -->
    <template v-if="isLanding && !plain">
      <header class="wk-hero wk-hero-land">
        <span class="wk-stars" aria-hidden="true" />
        <span class="wk-rays" aria-hidden="true" />
        <span class="wk-glow" aria-hidden="true" />
        <span class="wk-scrim" aria-hidden="true" />
        <div class="wk-hero-in">
          <span class="wk-eyebrow">
            <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true"><path d="M3 4.5A1.5 1.5 0 0 1 4.5 3H9v13H4.5A1.5 1.5 0 0 0 3 17.5V4.5Zm14 0A1.5 1.5 0 0 0 15.5 3H11v13h4.5A1.5 1.5 0 0 1 17 17.5V4.5Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
            {{ eyebrow }}
          </span>
          <h1 class="wk-title">{{ title }}</h1>
          <p class="wk-herosubtitle">{{ subtitle }}</p>
        </div>
      </header>
      <div class="wk-land">
        <span class="wk-ground" aria-hidden="true" />
        <div class="wk-land-in">
          <button type="button" class="wk-search wk-land-search" @click="openSearch">
            <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M13.5 13.5 L17.5 17.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            <span>{{ W.search }}</span><kbd>&#8984;K</kbd>
          </button>
          <section v-for="(s, si) in landingSections" :key="si" class="land-sec">
            <h2 v-if="s.title" class="land-sec-h">{{ s.title }}</h2>
            <div class="land-grid">
              <a v-for="d in s.docs" :key="d.id" class="land-card"
                 :href="base + '/' + d.id" @click.prevent="open(d.id)">
                <span class="land-card-main">
                  <h3 class="land-card-t">{{ d.title }}</h3>
                  <p v-if="d.description" class="land-card-d">{{ d.description }}</p>
                </span>
                <span class="land-card-side">
                  <span class="land-card-m">{{ fill(SH.mins, { n: d.readingTime || 1 }) }}</span>
                  <span class="land-card-arr" aria-hidden="true">&rarr;</span>
                </span>
              </a>
            </div>
          </section>
        </div>
      </div>
    </template>

    <!-- ===================== ARTICLE ===================== -->
    <template v-else>
    <header v-if="!plain" class="wk-hero" :class="{ 'has-cover': !!(fm.cover && fm.cover.src) }" :style="heroStyle">
      <span class="wk-stars" aria-hidden="true" />
      <span class="wk-rays" aria-hidden="true" />
      <span class="wk-glow" aria-hidden="true" />
      <span class="wk-scrim" aria-hidden="true" />
      <div class="wk-hero-in">
        <span class="wk-eyebrow">
          <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
            <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3H9v13H4.5A1.5 1.5 0 0 0 3 17.5V4.5Zm14 0A1.5 1.5 0 0 0 15.5 3H11v13h4.5A1.5 1.5 0 0 1 17 17.5V4.5Z"
                  fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          </svg>
          {{ eyebrow }}
        </span>
        <h1 class="wk-title">{{ fm.title || title }}</h1>
        <div class="wk-metarow" v-if="doc">
          <span class="wk-crumb">{{ title }}</span>
          <template v-if="fm.author"><span class="wk-sep" /><span class="wk-author">
            <span class="wk-avatar" aria-hidden="true">{{ (fm.author[0] || 'D').toUpperCase() }}</span>{{ fm.author }}
          </span></template>
          <template v-if="fm.date"><span class="wk-sep" /><span>{{ fmtDate(fm.date) }}</span></template>
          <template v-if="readMins"><span class="wk-sep" /><span>{{ fill(SH.read, { n: readMins }) }}</span></template>
          <template v-if="fm.updated"><span class="wk-sep" /><span class="wk-upd">{{ fill(SH.updated, { ago: agoText(fm.updated) }) }}</span></template>
        </div>
      </div>
    </header>

    <!-- ===================== BODY ===================== -->
    <div class="wk-body" :class="{ 'no-toc': tocFlat.length <= 1 || (plain && isLanding) }">
      <span v-if="!plain" class="wk-ground" aria-hidden="true" />

      <!-- left: navigation tree -->
      <aside class="wk-nav" :class="{ open: navOpen }" :aria-label="title + ' contents'">
        <button v-if="plain" type="button" class="wk-nav-toggle" :aria-expanded="navOpen" @click="navOpen = !navOpen">
          <span class="wk-nav-toggle-l">{{ SH.menu }}</span>
          <span class="wk-nav-toggle-t">{{ currentTitle || title }}</span>
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" class="wk-search wk-nav-search" @click="openSearch">
          <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M13.5 13.5 L17.5 17.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          <span>{{ W.search }}</span>
        </button>
        <div class="wk-nav-label">{{ W.label || title }}</div>
        <nav class="wk-tree">
          <template v-for="(e, i) in flat" :key="i">
            <button v-if="e.heading && secOpen(e.sec)" type="button" class="tree-head" :class="{ open: openSecs.has(e.key) }" :style="{ paddingLeft: e.depth * 12 + 'px' }"
                    :aria-expanded="openSecs.has(e.key)" @click="toggleSec(e.key)">
              <span>{{ e.heading }}</span>
              <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true"><path d="M7 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button v-else-if="!e.heading && secOpen(e.sec)" type="button" class="tree-item" :class="{ on: currentId === e.id }"
                    :style="{ paddingLeft: 12 + e.depth * 12 + 'px' }" @click="open(e.id)">{{ e.title }}</button>
          </template>
        </nav>
      </aside>

      <!-- middle: the article -->
      <main class="wk-main">
        <!-- the plain landing: the collection's title and line, then its sections as cards -->
        <template v-if="plain && isLanding">
          <header class="wk-plainhead">
            <h1 class="wk-plaintitle">{{ title }}</h1>
            <p v-if="subtitle" class="wk-lead">{{ subtitle }}</p>
          </header>
          <section v-for="(s, si) in landingSections" :key="si" class="land-sec">
            <h2 v-if="s.title" class="land-sec-h">{{ s.title }}</h2>
            <div class="land-grid">
              <a v-for="d in s.docs" :key="d.id" class="land-card" :href="base + '/' + d.id" @click.prevent="open(d.id)">
                <span class="land-card-main">
                  <h3 class="land-card-t">{{ d.title }}</h3>
                  <p v-if="d.description" class="land-card-d">{{ d.description }}</p>
                </span>
                <span class="land-card-side">
                  <span class="land-card-m">{{ fill(SH.mins, { n: d.readingTime || 1 }) }}</span>
                  <span class="land-card-arr" aria-hidden="true">&rarr;</span>
                </span>
              </a>
            </div>
          </section>
        </template>
        <p v-else-if="missing" class="wk-missing">{{ SH.missing }}</p>
        <template v-else-if="doc">
          <article class="wk-panel">
            <!-- the plain shell carries the page's head here, where the hero would have said it -->
            <header v-if="plain" class="wk-plainhead">
              <nav v-if="crumb" class="wk-crumbs" aria-label="Section"><span>{{ W.label || title }}</span><span class="wk-crumbsep" aria-hidden="true">/</span><span>{{ crumb }}</span></nav>
              <h1 class="wk-plaintitle">{{ fm.title || title }}</h1>
              <div class="wk-metarow wk-plainmeta" v-if="metaBits.length">
                <template v-for="(m, i) in metaBits" :key="i"><span v-if="i" class="wk-sep" /><span :class="m.cls">{{ m.text }}</span></template>
              </div>
            </header>
            <p v-if="fm.description" class="wk-lead">{{ fm.description }}</p>
            <div v-if="fm.media && allowed" class="wk-media"><MediaBlock :media="fm.media" /></div>
            <div v-if="allowed && page.waiting.value" class="wk-prose wk-wait" role="status">
              <p class="wk-wait-line">{{ page.state.value === 'error' ? GW['page-error'] : GW['page-loading'] }}</p>
              <button v-if="page.state.value === 'error'" type="button" class="wk-wait-retry" @click="page.retry">{{ GW.retry }}</button>
            </div>
            <div v-else-if="allowed" ref="docEl" class="wk-prose"><MarkdownDoc :html="preview ? doc.html : page.html.value" /></div>
            <Gate v-else kind="doc" :required="requiredBy(fm.canAccess)" />

            <footer v-if="related.length" class="wk-related">
              <span class="wk-related-h">{{ SH.related }}</span>
              <div class="wk-related-list">
                <a v-for="r in related" :key="r.id" class="wk-related-card"
                   :href="base + '/' + r.id" @click.prevent="open(r.id)">
                  <span class="wk-related-title">{{ r.title }}</span>
                  <span class="wk-related-arr" aria-hidden="true">&rarr;</span>
                </a>
              </div>
            </footer>
          </article>

          <nav class="wk-pager" v-if="prev || next" aria-label="More pages">
            <a v-if="prev" class="pager-card prev" :href="base + '/' + prev.id" @click.prevent="open(prev.id)">
              <span class="pager-dir">&larr; {{ SH.prev }}</span><span class="pager-title">{{ prev.title }}</span>
            </a><span v-else />
            <a v-if="next" class="pager-card next" :href="base + '/' + next.id" @click.prevent="open(next.id)">
              <span class="pager-dir">{{ SH.next }} &rarr;</span><span class="pager-title">{{ next.title }}</span>
            </a>
          </nav>
        </template>
      </main>

      <!-- right: on this page -->
      <aside class="wk-toc" v-if="tocFlat.length > 1 && allowed && !(plain && isLanding)">
        <span class="onpage-label">{{ SH.onpage }}</span>
        <a v-for="t in tocFlat" :key="t.url" class="onpage-link"
           :class="{ on: activeHash === t.url, sub: t.lvl > 0 }" :href="t.url">{{ t.title }}</a>
      </aside>
    </div>
    </template>
  </div>
</template>

<style scoped>
.wk { position: relative }

/* ===================== the plain shell (a docs-only site) ===================== */
/* no hero, no ground, no floating card: the page sits on the paper, the sidebar and the rail beside it —
   the shape of a standalone documentation site */
.wk.plain .wk-body { padding-top: 34px }
.wk.plain .wk-panel { background: none; border: 0; border-radius: 0; padding: 4px 0 0; margin-top: 0; box-shadow: none }
.wk.plain .wk-main { margin: 0 34px }
.wk.plain .wk-nav { border-right: 1px solid var(--hair) }
/* the global stylesheet pads every section and header (atlas.css) — the shell's own are flush */
.wk-plainhead { margin: 0 0 22px; padding: 0; border: 0 }
.wk.plain .land-sec { padding: 0; border: 0 }
.wk-crumbs { display: flex; gap: 8px; align-items: center; font-family: var(--m); font-size: 11px; letter-spacing: .12em;
  text-transform: uppercase; color: var(--ink3); margin: 0 0 14px }
.wk-crumbsep { opacity: .5 }
.wk-plaintitle { font-family: var(--fd); font-weight: 600; font-size: clamp(30px, 3.6vw, 42px); line-height: 1.08;
  letter-spacing: -.02em; color: var(--ink); margin: 0 0 12px }
.wk-plainmeta { justify-content: flex-start; color: var(--ink3); margin: 14px 0 0 }
.wk.plain .wk-lead { margin-top: 0 }
.wk.plain .land-sec { margin-top: 30px }
.wk.plain .land-sec-h { margin: 0 0 12px }
.wk-nav-toggle { display: none }
@media (max-width: 760px) {
  .wk.plain .wk-main { margin: 0 }
  .wk.plain .wk-nav { border-right: 0; border-bottom: 1px solid var(--hair); padding-bottom: 0; margin-bottom: 18px }
  .wk.plain .wk-panel { padding: 0 }
  /* the tree folded behind its toggle */
  .wk-nav-toggle { display: flex; align-items: center; gap: 10px; width: 100%; background: var(--card); border: 1px solid var(--hair);
    border-radius: 12px; padding: 11px 14px; margin: 0 0 14px; font: inherit; color: var(--ink); cursor: pointer; text-align: left }
  .wk-nav-toggle-l { font-family: var(--m); font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3); flex: none }
  .wk-nav-toggle-t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600 }
  .wk-nav-toggle svg { flex: none; color: var(--ink3); transition: transform .15s }
  .wk-nav.open .wk-nav-toggle svg { transform: rotate(180deg) }
  .wk.plain .wk-nav:not(.open) .wk-nav-search, .wk.plain .wk-nav:not(.open) .wk-nav-label, .wk.plain .wk-nav:not(.open) .wk-tree { display: none }
  .wk.plain .wk-nav.open { padding-bottom: 14px }
}

/* ===================== hero ===================== */
.wk-hero {
  position: relative; isolation: isolate; overflow: hidden;
  padding: clamp(74px, 9vw, 116px) 24px clamp(64px, 7vw, 92px); text-align: center;
  color: #eef2f8; background: #060d1a center / cover no-repeat;
  background-image:
    radial-gradient(80% 100% at 50% 6%, #2a4a76 0%, transparent 58%),
    radial-gradient(130% 150% at 50% -32%, #16294b 0%, #0a1830 44%, #060d1a 100%);
}
.wk-hero.has-cover { background-image: none } /* cover comes from inline style */
.wk-hero.has-cover .wk-rays, .wk-hero.has-cover .wk-glow { display: none }
.wk-hero.has-cover .wk-scrim { background: linear-gradient(180deg, #060d1a55 0%, #060d1aaa 55%, #060d1a 100%) }
/* a soft central light source behind the title */
.wk-glow { position: absolute; left: 50%; top: 30%; width: 720px; height: 720px; z-index: 0;
  transform: translate(-50%, -50%); pointer-events: none;
  background: radial-gradient(closest-side, #6fb0e055 0%, #3a6ea022 34%, transparent 70%) }
/* a faint sunburst radiating from behind the title — the reference's radiant centre */
.wk-rays { position: absolute; inset: 0; z-index: 0; pointer-events: none; opacity: .13;
  background: repeating-conic-gradient(from 0deg at 50% 34%, #a9cdf0 0deg .3deg, transparent .3deg 6.4deg);
  -webkit-mask-image: radial-gradient(56% 78% at 50% 34%, #000 4%, transparent 74%);
  mask-image: radial-gradient(56% 78% at 50% 34%, #000 4%, transparent 74%) }
.wk-scrim { position: absolute; inset: 0; z-index: 0;
  background: radial-gradient(115% 130% at 50% 34%, #0000 34%, #060d1acc 100%),
    linear-gradient(180deg, #060d1a00 0%, #060d1a55 66%, #060d1a 100%) }
.wk-stars { position: absolute; inset: 0; z-index: 0; opacity: .72; pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='320'%3E%3Cg fill='%23ffffff'%3E%3Ccircle cx='24' cy='40' r='1.1' opacity='.9'/%3E%3Ccircle cx='80' cy='16' r='.7' opacity='.5'/%3E%3Ccircle cx='140' cy='60' r='1' opacity='.7'/%3E%3Ccircle cx='210' cy='28' r='.6' opacity='.5'/%3E%3Ccircle cx='268' cy='72' r='1.2' opacity='.85'/%3E%3Ccircle cx='300' cy='24' r='.7' opacity='.5'/%3E%3Ccircle cx='40' cy='120' r='.8' opacity='.6'/%3E%3Ccircle cx='110' cy='150' r='1' opacity='.7'/%3E%3Ccircle cx='180' cy='128' r='.6' opacity='.45'/%3E%3Ccircle cx='250' cy='168' r='1.1' opacity='.8'/%3E%3Ccircle cx='300' cy='140' r='.7' opacity='.5'/%3E%3Ccircle cx='20' cy='210' r='1' opacity='.7'/%3E%3Ccircle cx='90' cy='250' r='.7' opacity='.5'/%3E%3Ccircle cx='150' cy='224' r='1.2' opacity='.85'/%3E%3Ccircle cx='224' cy='260' r='.7' opacity='.5'/%3E%3Ccircle cx='286' cy='236' r='.9' opacity='.65'/%3E%3Ccircle cx='56' cy='300' r='.8' opacity='.55'/%3E%3Ccircle cx='190' cy='300' r='.7' opacity='.5'/%3E%3C/g%3E%3C/svg%3E");
}
.wk-hero-in { position: relative; z-index: 1; max-width: 840px; margin: 0 auto }
.wk-eyebrow { display: inline-flex; align-items: center; gap: 8px; font-family: var(--m);
  font-size: 10.5px; letter-spacing: .22em; text-transform: uppercase; color: #b9c6da; opacity: .92 }
.wk-eyebrow svg { opacity: .85 }
.wk-title { font-family: var(--fd); font-optical-sizing: auto; font-weight: 600; letter-spacing: -.016em;
  font-size: clamp(44px, 6.6vw, 80px); line-height: 1; margin: 20px 0 22px; color: #fff;
  text-shadow: 0 2px 44px #0000006b }
.wk-metarow { display: inline-flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 12px;
  font-size: 13.5px; color: #c3cede }
.wk-crumb { font-family: var(--m); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #93a3bd }
.wk-sep { width: 3px; height: 3px; border-radius: 50%; background: currentColor; opacity: .4 }
.wk-author { display: inline-flex; align-items: center; gap: 7px }
.wk-avatar { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px;
  border-radius: 50%; background: linear-gradient(150deg, var(--accent2), var(--accent)); color: #071018;
  font-family: var(--m); font-size: 10px; font-weight: 700 }
.wk-upd { color: #8fa0ba }

/* ===================== body ===================== */
.wk-body { position: relative; display: grid; grid-template-columns: 246px minmax(0, 1fr) 214px;
  gap: 0; align-items: start; max-width: 1280px; margin: 0 auto; padding: 40px 34px 110px }
.wk-body.no-toc { grid-template-columns: 246px minmax(0, 1fr) }
/* faint constellation ground behind the whole article */
.wk-ground { position: absolute; inset: 0; z-index: 0; pointer-events: none; opacity: .5;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='360' height='360'%3E%3Cg fill='%23808aa0'%3E%3Ccircle cx='40' cy='60' r='1' opacity='.5'/%3E%3Ccircle cx='150' cy='30' r='.8' opacity='.35'/%3E%3Ccircle cx='300' cy='90' r='1.1' opacity='.5'/%3E%3Ccircle cx='90' cy='180' r='.7' opacity='.3'/%3E%3Ccircle cx='260' cy='220' r='1' opacity='.45'/%3E%3Ccircle cx='330' cy='300' r='.8' opacity='.35'/%3E%3Ccircle cx='30' cy='320' r='1' opacity='.4'/%3E%3Ccircle cx='180' cy='280' r='.7' opacity='.3'/%3E%3C/g%3E%3C/svg%3E") }
.wk-body > *:not(.wk-ground) { position: relative; z-index: 1 }
/* the two rails stay sticky under that stacking rule (its specificity would otherwise make them relative and
   push them down by their top offset) */
.wk-body > .wk-nav, .wk-body > .wk-toc { position: sticky }

/* left nav */
.wk-nav { position: sticky; top: 18px; align-self: start; padding-right: 26px;
  max-height: calc(100vh - 36px); overflow-y: auto }
.wk-nav-label { font-family: var(--m); font-size: 10px; letter-spacing: .16em; text-transform: uppercase;
  color: var(--ink3); margin: 10px 0 8px }
.wk-tree { display: flex; flex-direction: column; gap: 1px }
.tree-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; background: none; border: 0;
  cursor: pointer; text-align: left; font-family: var(--m); font-size: 10px; letter-spacing: .13em; text-transform: uppercase;
  color: var(--ink3); margin: 18px 0 6px; padding-top: 0; padding-bottom: 0; padding-right: 8px }
.tree-head:hover { color: var(--ink2) }
.tree-head svg { flex: none; opacity: .7; transition: transform .15s }
.tree-head.open svg { transform: rotate(90deg) }
.tree-item { position: relative; display: block; width: 100%; text-align: left; background: none; border: 0;
  font: inherit; font-size: 14px; color: var(--ink3); padding: 7px 12px; border-radius: 8px; cursor: pointer;
  line-height: 1.35; transition: color .12s, background .12s }
.tree-item:hover { background: var(--wash); color: var(--ink2) }
.tree-item.on { color: var(--accent2); font-weight: 600; background: var(--accentbg) }
.tree-item.on::before { content: ""; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2.5px; border-radius: 2px; background: var(--accent) }

/* middle: the floating reading panel */
.wk-main { min-width: 0; margin: 0 22px }
.wk-panel { background: var(--card2, var(--paper)); border: 1px solid var(--hair); border-radius: 22px;
  box-shadow: 0 1px 2px #0000000d, 0 30px 60px -34px #0009; padding: clamp(30px, 4vw, 56px) clamp(26px, 4vw, 60px) 40px;
  /* lift the reading card up over the foot of the hero */
  margin-top: -66px }
.wk-lead { font-family: var(--fd); font-size: clamp(19px, 2.3vw, 22px); line-height: 1.5; font-style: italic;
  color: var(--ink2); margin: 0 0 22px; padding-left: 20px; border-left: 3px solid var(--accent); max-width: 60ch }
.wk-missing { color: var(--ink3); font-size: 15px; padding: 30px 0 }

/* related */
.wk-related { margin-top: 48px; padding-top: 26px; border-top: 1px solid var(--hair) }
.wk-related-h { display: block; font-family: var(--fd); font-weight: 700; font-size: 18px; color: var(--ink); margin-bottom: 14px }
.wk-related-list { display: grid; gap: 10px }
.wk-related-card { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 15px 18px; border: 1px solid var(--hair); border-radius: 13px; background: var(--wash);
  text-decoration: none; transition: border-color .16s, transform .16s, background .16s }
.wk-related-card:hover { border-color: var(--accent); transform: translateX(3px); background: var(--accentbg) }
.wk-related-title { font-size: 15.5px; font-weight: 600; color: var(--ink) }
.wk-related-arr { color: var(--accent2); flex: none }

/* prev / next */
.wk-pager { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 22px 22px 0 }
.pager-card { display: flex; flex-direction: column; gap: 6px; padding: 16px 18px; border: 1px solid var(--hair);
  border-radius: 14px; text-decoration: none; background: var(--card); transition: border-color .16s, transform .16s, box-shadow .16s }
.pager-card:hover { border-color: var(--ink3); transform: translateY(-2px); box-shadow: var(--sh) }
.pager-card.next { text-align: right; align-items: flex-end }
.pager-dir { font-family: var(--m); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent2) }
.pager-title { font-size: 15.5px; font-weight: 600; color: var(--ink); letter-spacing: -.01em }

/* right: on this page */
.wk-toc { position: sticky; top: 18px; align-self: start; padding-left: 24px; display: flex; flex-direction: column; gap: 2px }
.onpage-label { font-family: var(--m); font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: var(--ink3); margin-bottom: 10px }
/* A HEADING IS NOT ALWAYS PROSE. A reference page's headings carry paths — "Promotions —
   content/store/promotions/*.md" — and a path has no spaces to wrap at, so the rail's widest
   entry pushed the whole document sideways by the amount it could not fit. It was 27px on
   /docs/reference/frontmatter: nothing looked wrong, and the page scrolled horizontally.
   `anywhere` rather than `break-word` because the latter leaves the unbreakable run intact when
   the line already has a break opportunity earlier in it. */
.onpage-link { font-size: 13px; line-height: 1.4; color: var(--ink3); text-decoration: none;
  padding: 5px 0 5px 13px; border-left: 2px solid var(--hair); transition: color .12s, border-color .12s;
  overflow-wrap: anywhere; min-width: 0 }
.onpage-link.sub { padding-left: 25px }
.onpage-link:hover { color: var(--ink2) }
.onpage-link.on { color: var(--accent2); border-left-color: var(--accent); font-weight: 500 }

/* editorial typography inside the panel — larger serif headings, roomy body */
/* a gated page on its way from reader-content, or one that could not be fetched */
.wk-wait-line { color: var(--ink3); margin: 0 }
.wk-wait-retry { margin-top: 14px; font: inherit; font-size: 14px; font-weight: 600; color: var(--ink); background: none; border: 1.5px solid var(--ink); border-radius: 999px; padding: 8px 18px; cursor: pointer }
.wk-wait-retry:hover { background: var(--ink); color: var(--paper) }
.wk-prose :deep(.purpose) { padding: 0; margin: 0 }
.wk-prose :deep(.purpose > :first-child) { margin-top: 0; padding-top: 0 }
.wk-prose :deep(.purpose p) { font-size: 17.5px; line-height: 1.8; color: var(--ink2); max-width: 66ch; margin: 0 0 20px }
.wk-prose :deep(.purpose h2) { font-family: var(--fd); font-optical-sizing: auto; font-weight: 700; letter-spacing: -.022em;
  font-size: clamp(25px, 3vw, 32px); line-height: 1.15; color: var(--ink); margin: 48px 0 16px; border: 0; padding: 0 }
.wk-prose :deep(.purpose h3) { font-family: var(--fd); font-weight: 700; font-size: clamp(19px, 2.2vw, 22px);
  color: var(--ink); margin: 34px 0 10px }
.wk-prose :deep(.purpose strong) { color: var(--ink); font-weight: 700 }
.wk-prose :deep(.purpose em) { font-style: italic }
.wk-prose :deep(.purpose blockquote) { font-size: 18px; font-style: italic; color: var(--ink2);
  border-left: 3px solid var(--accent); margin: 24px 0; padding: 4px 0 4px 20px }

/* ===================== landing ===================== */
.wk-hero-land { padding-bottom: clamp(54px, 6vw, 78px) }
.wk-herosubtitle { font-size: clamp(16px, 2vw, 19px); color: #c3cede; line-height: 1.55; margin: 16px auto 0; max-width: 52ch }
.wk-land { position: relative; max-width: 800px; margin: 0 auto; padding: 56px 32px 112px }
.wk-land-in { position: relative; z-index: 1 }
/* the in-page search field — a button that opens the scoped site palette */
.wk-search { display: flex; align-items: center; gap: 10px; width: 100%; font: inherit; font-size: 13.5px;
  color: var(--ink3); background: var(--card); border: 1px solid var(--hair); border-radius: 12px;
  padding: 11px 14px; cursor: pointer; text-align: left; transition: border-color .14s, color .14s }
.wk-search:hover { border-color: var(--ink3); color: var(--ink2) }
.wk-search svg { flex: none; opacity: .8 }
.wk-search span { flex: 1 }
.wk-search kbd { font-family: var(--m); font-size: 10px; border: 1px solid var(--hair); border-radius: 5px; padding: 2px 6px; color: var(--ink3) }
.wk-nav-search { margin-bottom: 16px; padding: 9px 12px; font-size: 13px; border-radius: 10px }
.wk-land-search { margin: 0 0 32px; padding: 13px 16px; border-radius: 14px; font-size: 14.5px }
.land-sec { margin-bottom: 30px }
.land-sec-h { font-family: var(--m); font-weight: 500; font-size: 11px; letter-spacing: .15em;
  text-transform: uppercase; color: var(--ink3); margin: 0 0 12px; padding-bottom: 10px; border-bottom: 1px solid var(--hair) }
.land-grid { display: flex; flex-direction: column; gap: 10px }
.land-card { display: flex; align-items: center; justify-content: space-between; gap: 24px;
  padding: 19px 24px; border: 1px solid var(--hair); border-radius: 14px; background: var(--card);
  text-decoration: none; transition: border-color .16s, transform .16s, box-shadow .16s, background .16s }
.land-card:hover { border-color: var(--accent); background: var(--accentbg); transform: translateX(3px); box-shadow: var(--sh) }
.land-card-main { min-width: 0 }
.land-card-t { font-family: var(--fd); font-optical-sizing: auto; font-size: 19.5px; font-weight: 600;
  letter-spacing: -.012em; color: var(--ink); margin: 0 0 3px }
.land-card-d { font-size: 14px; line-height: 1.5; color: var(--ink3); margin: 0 }
.land-card-side { display: flex; align-items: center; gap: 15px; flex: none }
.land-card-m { font-family: var(--m); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); white-space: nowrap }
.land-card-arr { font-size: 17px; color: var(--accent2); transition: transform .16s }
.land-card:hover .land-card-arr { transform: translateX(4px) }

@media (max-width: 1080px) {
  .wk-body, .wk-body.no-toc { grid-template-columns: 232px minmax(0, 1fr) }
  .wk-toc { display: none }
}
@media (max-width: 760px) {
  .wk-body, .wk-body.no-toc { grid-template-columns: 1fr; padding: 22px 16px 80px }
  .wk-nav { position: static; max-height: none; padding-right: 0; border-bottom: 1px solid var(--hair); padding-bottom: 14px; margin-bottom: 4px }
  .wk-main { margin: 0 }
  .wk-panel { margin-top: 0; padding: 26px 20px 32px }
  .wk-pager { grid-template-columns: 1fr; margin: 20px 0 0 }
}
</style>

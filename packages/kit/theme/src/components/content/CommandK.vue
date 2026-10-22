<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { contentCorpus, searchContent, semanticSearch, allTags, KIND_LABEL, parseQuery, embedText, warmEmbedder } from 'platformkit/lib/content.js'
import { navigate } from '../../router.js'
import { moduleOn } from 'platformkit/lib/modules.js'
import { us } from 'platformkit/lib/content.js'
import { isSignedIn } from 'platformkit/lib/auth.js'
import { ROUTES } from 'platformkit/lib/router.js'

/* PEOPLE, where the network is on: the people with a page the reader may see, by name — the search
   the social layout's sidebar used to hold, kept where search already is */
const PEOPLE = moduleOn('network')
const esc = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
async function peopleHits(text) {
  if (!PEOPLE || !isSignedIn.value || !text.trim() || kind.value) return []
  const { findPeople, net } = await import('platformkit/lib/network/api.js')
  const ids = await findPeople(text.trim()).catch(() => [])
  return ids.map((id) => net.people[id]).filter((p) => p && p.username && p.page).slice(0, 5)
    .map((p) => ({ kind: 'person', href: ROUTES.people + '/' + p.username, titleHtml: esc(p.name || p.username), excerpt: '@' + esc(p.handle || p.username) }))
}

/* The command palette: cmd-K anywhere, search everything, arrow, enter. */
const open = ref(false)
const q = ref('')
const kind = ref('')          /* '' = everything; chips narrow it */
const hits = ref([])
const sel = ref(0)
const input = ref(null)
let corpus = null

/* the date filter is buttons and pickers, never typed syntax */
const RANGES = [
  { v: '', label: 'Any time' },
  { v: 'week', label: 'Past week' },
  { v: 'month', label: 'Past month' },
  { v: 'year', label: 'Past year' },
  { v: 'custom', label: 'Custom\u2026' },
]
const range = ref('')
const from = ref('')
const to = ref('')
const iso = (d) => d.toISOString().slice(0, 10)
function rangeBounds() {
  if (range.value === 'custom') return { after: from.value || null, before: to.value || null }
  if (!range.value) return { after: null, before: null }
  const days = { week: 7, month: 31, year: 366 }[range.value]
  return { after: iso(new Date(Date.now() - days * 86400000)), before: null }
}

const KINDS = [
  { v: '', label: 'All types' },
  { v: 'article', label: 'Articles' },
  { v: 'wiki', label: 'Wiki' },
  { v: 'doc', label: 'Docs' },
  { v: 'book', label: 'Books' },
  { v: 'product', label: 'Store' },
]
const dd = ref('') /* which dropdown is open: '', 'kind', 'date', 'tags' */
const tags = ref([])          /* the selected ones */
const tagOptions = ref([])    /* what the shelf actually carries; empty = no Tags UI */
const kindLabel = computed(() => KINDS.find((k) => k.v === kind.value)?.label || 'All types')
/* the kinds the shelf actually holds; an empty kind is not offered */
const kindsHere = ref(KINDS)
const rangeLabel = computed(() => RANGES.find((r) => r.v === range.value)?.label || 'Any time')
function closeMenus(e) { if (!e.target.closest || !e.target.closest('.ck-dd')) dd.value = '' }

async function ensure() {
  if (!corpus) {
    corpus = await contentCorpus()
    tagOptions.value = allTags(corpus.filter((r) => r.kind !== 'product'))
    const have = new Set(corpus.map((r) => r.kind))
    kindsHere.value = KINDS.filter((k) => !k.v || have.has(k.v))
  }
}

let semTimer = null
async function run() {
  await ensure()
  const { after, before } = rangeBounds()
  const opts = { kind: kind.value || null, after, before, tags: tags.value.map((t) => t.toLowerCase()) }
  const kw = searchContent(corpus, q.value, opts)
  hits.value = kw
  sel.value = 0
  /* people come back from the database, a beat after the shelf's own results */
  const asked = q.value
  peopleHits(asked).then((ppl) => { if (ppl.length && q.value === asked) hits.value = ppl.concat(hits.value.filter((h) => h.kind !== 'person')) })

  /* the semantic pass only runs when there are real words to mean something */
  const words = parseQuery(q.value).toks
  clearTimeout(semTimer)
  if (!words.length) return
  const snapshot = q.value
  semTimer = setTimeout(async () => {
    let qvec
    try { qvec = await embedText(snapshot) } catch (e) { return }
    if (q.value !== snapshot) return                     /* the query moved on */
    const sem = semanticSearch(corpus, qvec, { ...opts, query: snapshot, min: 0.2, topK: 8 })
    const have = new Set(kw.map((h) => h.href))
    const extra = sem.filter((s) => !have.has(s.href)).map((s) => ({ ...s, semantic: true }))
    hits.value = kw.concat(extra)
  }, 180)
}
watch([q, kind, range, from, to, tags], run, { deep: true })
function toggleTag(t) {
  const i = tags.value.indexOf(t)
  if (i >= 0) tags.value.splice(i, 1); else tags.value.push(t)
}

const grouped = computed(() => {
  const g = []
  for (const h of hits.value) {
    let grp = g.find((x) => x.kind === h.kind)
    if (!grp) { grp = { kind: h.kind, label: h.kind === 'person' ? us('network').shell.main['explore-people'] : KIND_LABEL[h.kind], rows: [] }; g.push(grp) }
    grp.rows.push(h)
  }
  return g
})

async function show(preset) {
  open.value = true
  /* opened with a scope (e.g. from the wiki/docs search field): reset to a clean
     search narrowed to that kind */
  if (preset && typeof preset === 'object') {
    q.value = ''; tags.value = []; range.value = ''; from.value = ''; to.value = ''
    kind.value = preset.kind || ''
  }
  warmEmbedder()          /* the model loads while they are still typing */
  ensure()
  await nextTick()
  input.value && input.value.focus()
}
function hide() { open.value = false; q.value = '' }
function go(h) { hide(); navigate(h.href) }

function onKey(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open.value ? hide() : show(); return }
  if (!open.value) return
  if (e.key === 'Escape') { hide() }
  else if (e.key === 'ArrowDown') { e.preventDefault(); sel.value = Math.min(hits.value.length - 1, sel.value + 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sel.value = Math.max(0, sel.value - 1) }
  else if (e.key === 'Enter' && hits.value[sel.value]) { go(hits.value[sel.value]) }
}
onMounted(() => {
  document.addEventListener('keydown', onKey)
  /* let any component open the palette (optionally scoped) without a ref chain */
  window.DLsearch = show
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  if (window.DLsearch === show) delete window.DLsearch
})

defineExpose({ show })
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ck-veil" @click.self="hide">
      <div class="ck" role="dialog" aria-label="Search everything" @click="closeMenus">
        <div class="ck-bar">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/>
            <path d="M13.5 13.5 L17.5 17.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <input ref="input" v-model="q" type="search" placeholder="Search articles, wiki, docs, books…" />
          <kbd>esc</kbd>
        </div>

        <div class="ck-filters">
          <div class="ck-dd" v-if="kindsHere.length > 2">
            <button type="button" class="ck-ddbtn" :class="{ set: kind }"
                    @click.stop="dd = dd === 'kind' ? '' : 'kind'">
              <span class="ck-ddlab">Type</span> {{ kindLabel }}
              <svg viewBox="0 0 10 6" width="9" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
            <div v-if="dd === 'kind'" class="ck-menu">
              <button v-for="k in kindsHere" :key="k.v" type="button" class="ck-mi"
                      :class="{ on: kind === k.v }" @click="kind = k.v; dd = ''; input && input.focus()">
                <span>{{ k.label }}</span>
                <svg v-if="kind === k.v" viewBox="0 0 12 10" width="11" height="9" aria-hidden="true"><path d="M1 5.5 4.4 8.5 11 1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          </div>

          <div class="ck-dd">
            <button type="button" class="ck-ddbtn" :class="{ set: range }"
                    @click.stop="dd = dd === 'date' ? '' : 'date'">
              <span class="ck-ddlab">Date</span> {{ rangeLabel }}
              <svg viewBox="0 0 10 6" width="9" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
            <div v-if="dd === 'date'" class="ck-menu">
              <button v-for="r in RANGES.filter((x) => x.v !== 'custom')" :key="r.v" type="button" class="ck-mi"
                      :class="{ on: range === r.v }" @click="range = r.v; dd = ''; input && input.focus()">
                <span>{{ r.label }}</span>
                <svg v-if="range === r.v" viewBox="0 0 12 10" width="11" height="9" aria-hidden="true"><path d="M1 5.5 4.4 8.5 11 1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <div class="ck-custom" @click.stop>
                <div class="ck-mih">Custom range</div>
                <label>From <input v-model="from" type="date" @input="range = 'custom'" /></label>
                <label>To <input v-model="to" type="date" @input="range = 'custom'" /></label>
              </div>
            </div>
          </div>

          <div v-if="tagOptions.length" class="ck-dd">
            <button type="button" class="ck-ddbtn" :class="{ set: tags.length }"
                    @click.stop="dd = dd === 'tags' ? '' : 'tags'">
              <span class="ck-ddlab">Tags</span>
              {{ tags.length ? tags.length + ' selected' : 'Any' }}
              <svg viewBox="0 0 10 6" width="9" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
            <div v-if="dd === 'tags'" class="ck-menu">
              <button v-for="o in tagOptions" :key="o.tag" type="button" class="ck-mi"
                      :class="{ on: tags.includes(o.tag) }" @click.stop="toggleTag(o.tag)">
                <span>{{ o.tag }} <i class="ck-count">{{ o.n }}</i></span>
                <svg v-if="tags.includes(o.tag)" viewBox="0 0 12 10" width="11" height="9" aria-hidden="true"><path d="M1 5.5 4.4 8.5 11 1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          </div>

          <button v-if="kind || range || tags.length" type="button" class="ck-clear"
                  @click="kind = ''; range = ''; from = ''; to = ''; tags = []; input && input.focus()">Clear filters</button>
        </div>

        <div v-if="(q || kind || range || tags.length) && grouped.length" class="ck-body">
          <template v-for="g in grouped" :key="g.kind">
            <div class="ck-group">{{ g.label }}</div>
            <button v-for="h in g.rows" :key="h.href" type="button" class="ck-hit"
                    :class="{ on: hits[sel] === h }" @click="go(h)" @mousemove="sel = hits.indexOf(h)">
              <span class="ck-line">
                <span class="ck-title" v-html="h.titleHtml" />
                <span v-if="h.semantic" class="ck-rel" title="Related by meaning">related</span>
                <span v-if="h.date" class="ck-date">{{ h.date }}</span>
              </span>
              <span class="ck-x" v-html="h.excerpt" />
            </button>
          </template>
        </div>
        <p v-else-if="q || kind || range || tags.length" class="ck-none">Nothing matches that — yet.</p>
        <p v-else class="ck-hint">Type to search everything on the shelf &mdash; the filters narrow it.
          <b>&uarr;&darr;</b> to move, <b>&crarr;</b> to open.</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ck-veil { position: fixed; inset: 0; z-index: 200; background: #0a0d0b66;
  backdrop-filter: blur(6px); display: flex; align-items: flex-start; justify-content: center;
  padding: 12vh 18px 0 }
/* overflow stays visible so the facet menus can hang below the panel edge;
   the corners are rounded per-section instead of clipped */
.ck { width: 640px; max-width: 100%; background: var(--paper); color: var(--ink);
  border: 1px solid var(--hair); border-radius: 16px;
  box-shadow: 0 30px 90px -20px #00000088 }
.ck-bar { border-radius: 16px 16px 0 0 }
.ck-body, .ck-none, .ck-hint { border-radius: 0 0 16px 16px }
.ck-bar { display: flex; align-items: center; gap: 12px; padding: 15px 18px;
  border-bottom: 1px solid var(--hair); color: var(--ink3) }
.ck-bar input { flex: 1; font: inherit; font-size: 16.5px; color: var(--ink);
  background: none; border: 0; outline: none }
.ck-bar kbd { font-family: var(--m); font-size: 10px; color: var(--ink3);
  border: 1px solid var(--hair); border-radius: 5px; padding: 3px 6px }
.ck-filters { display: flex; align-items: center; gap: 8px; padding: 10px 16px 6px; flex-wrap: wrap }
.ck-dd { position: relative }
.ck-ddbtn { display: inline-flex; align-items: center; gap: 8px; font: inherit; font-size: 13px;
  color: var(--ink2); background: var(--wash); border: 1px solid var(--hair); border-radius: 9px;
  padding: 7px 12px; cursor: pointer }
.ck-ddbtn:hover { border-color: var(--ink3) }
.ck-ddbtn.set { color: var(--ink); border-color: var(--accent2) }
.ck-ddlab { font-family: var(--m); font-size: 9.5px; letter-spacing: .12em; text-transform: uppercase;
  color: var(--ink3) }
.ck-menu { position: absolute; z-index: 10; top: calc(100% + 6px); left: 0; min-width: 210px;
  background: var(--paper); border: 1px solid var(--hair); border-radius: 12px; padding: 6px;
  box-shadow: 0 18px 44px -14px #00000055 }
.ck-mi { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  width: 100%; text-align: left; font: inherit; font-size: 13.5px; color: var(--ink2);
  background: none; border: 0; border-radius: 8px; padding: 8px 10px; cursor: pointer }
.ck-mi:hover { background: var(--wash); color: var(--ink) }
.ck-mi.on { color: var(--ink); font-weight: 700 }
.ck-mi svg { color: var(--accent2) }
.ck-custom { border-top: 1px solid var(--hair); margin-top: 6px; padding: 10px 10px 6px }
.ck-mih { font-family: var(--m); font-size: 9.5px; letter-spacing: .13em; text-transform: uppercase;
  color: var(--ink3); margin-bottom: 8px }
.ck-custom label { display: flex; align-items: center; justify-content: space-between; gap: 10px;
  font-family: var(--m); font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
  color: var(--ink3); margin-bottom: 8px }
.ck-custom input { font: inherit; font-size: 13px; color: var(--ink); background: var(--wash);
  border: 1px solid var(--hair); border-radius: 8px; padding: 5px 9px; color-scheme: inherit }
.ck-count { font-style: normal; font-family: var(--m); font-size: 10px; color: var(--ink3); margin-left: 6px }
.ck-clear { font: inherit; font-size: 12px; color: var(--ink3); background: none; border: 0;
  cursor: pointer; text-decoration: underline; text-underline-offset: 3px }
.ck-clear:hover { color: var(--ink) }
.ck-chip { font-family: var(--m); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase;
  color: var(--ink3); background: none; border: 1px solid var(--hair); border-radius: 999px;
  padding: 5px 12px; cursor: pointer }
.ck-chip.on { color: var(--paper); background: var(--ink); border-color: var(--ink) }
.ck-line { display: flex; align-items: baseline; justify-content: space-between; gap: 12px }
.ck-date { font-family: var(--m); font-size: 10px; color: var(--ink3); white-space: nowrap }
.ck-rel { font-family: var(--m); font-size: 9px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--accent2); border: 1px solid var(--hair); border-radius: 999px; padding: 1px 7px; white-space: nowrap }
.ck-body { max-height: 56vh; overflow-y: auto; padding: 6px }
.ck-group { font-family: var(--m); font-size: 10px; letter-spacing: .15em; text-transform: uppercase;
  color: var(--accent2); padding: 12px 14px 5px }
.ck-hit { display: block; width: 100%; text-align: left; background: none; border: 0;
  font: inherit; padding: 10px 14px; border-radius: 10px; cursor: pointer }
.ck-hit.on { background: var(--wash) }
.ck-title { display: block; font-size: 15px; font-weight: 700; color: var(--ink) }
.ck-x { display: block; font-size: 12.5px; color: var(--ink3); line-height: 1.5; margin-top: 2px }
.ck :deep(mark) { background: var(--accentbg); color: var(--accent2); border-radius: 2px; padding: 0 1px }
.ck-none, .ck-hint { font-size: 13.5px; color: var(--ink3); padding: 18px; margin: 0 }
@media (max-width: 560px) {
  .ck-veil { padding: 5vh 10px 0 }
  .ck-bar { padding: 12px 14px }
  .ck-bar input { font-size: 15.5px }
  .ck-body { max-height: 62vh }
}
.ck-hint b { font-family: var(--m); font-weight: 500 }
</style>

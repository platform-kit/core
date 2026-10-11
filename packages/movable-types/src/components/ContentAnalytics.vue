<script setup>
/*
 * Content analytics — what gets read, how long it holds people and how far they go: piece by piece (views, readers,
 * engaged minutes, time, depth, recirculation, the change on the window before), by kind, by author, by topic and tag,
 * where the reading came from (channels) — from the content_view and content_read events through
 * admin_content(days, audience, published); a piece opens its own page (ContentPiece.vue); the audience filter — everyone,
 * guests, signed in, members — narrows every number; a Reading now strip from admin_now. Then the features, one at a time: Find your
 * book (admin_find); the forms have a page of their own (FormAnalytics.vue), and so do the funnels with their chat prompts
 * (FunnelAnalytics.vue). Wears the analytics idiom (analytics.css) so it reads as one with the dashboard. Words: `## content`, `## find`
 * in content/app/ui/analytics.md.
 */
import { moduleOn } from '@platform-kit/kit/lib/modules.js'
import { ref, computed, onMounted, onBeforeUnmount, watch, reactive } from 'vue'
import VChart from 'vue-echarts'
import { base, tokens, PALETTE, chartKind, timeSeries, timeAxis } from '../lib/charts-theme.js'
import ChartKind from './ChartKind.vue'
import FilterChips from './FilterChips.vue'
import { useFilters } from '../lib/analytics-filters.js'
import './analytics.css'
import { us } from '@platform-kit/kit/lib/content.js'
import { supabase, configured } from '@platform-kit/kit/lib/supabase.js'
import { isSignedIn } from '@platform-kit/kit/lib/auth.js'
import { books as BOOKS, articles as ARTICLES, wiki as WIKI, docs as DOCS } from '#content'
import { modules } from '#site'

const T = us('analytics')
const H = T.page.head
const C = T.content ? T.content.head : {}
const KP = T.content ? T.content.kpi || {} : {}
const CS = T.content ? T.content.sections || {} : {}
const KN = T.content ? T.content.kinds || {} : {}
const CO = T.content ? T.content.columns || {} : {}
const FD = T.find ? T.find.ui : {}
const S = T.sections.heads
import { panels as SITE_PANELS } from '#site/analytics'
import AdminHead from './admin/AdminHead.vue'
const MN = T.metrics.names

const emit = defineEmits(['open'])
const finderOn = moduleOn('books')   /* the finder is the library's */
const days = ref(30)
const AUD = ['all', 'guest', 'user', 'member']
const audience = ref('all')
const { forRead: filtersForRead } = useFilters(T.page.filters || {})
const now = ref(null)
/* the collections the events point at, by the kind a view carries: for an author and a publish date the events do not hold */
const COLL = { article: ARTICLES || [], book: BOOKS || [], wiki: WIKI || [], docs: DOCS || [] }
const recordOf = (kind, id) => (COLL[kind] || []).find((x) => x.slug === id || (x.path || '').split('/').pop() === id) || null
const authorOf = (r) => { const x = recordOf(r.kind, r.id); return x && x.author ? x.author : '' }
const PUBLISHED = Object.fromEntries(Object.entries(COLL).flatMap(([kind, list]) => list.filter((x) => x.date).map((x) => [kind + ':' + (x.slug || (x.path || '').split('/').pop()), String(x.date).slice(0, 10)])))
const state = ref('idle')      /* idle | loading | ok | denied | error */
const content = ref(null)
const find = ref(null)
const series = ref([])
const hasAuthors = computed(() => ((content.value && content.value.items) || []).some((r) => authorOf(r)))

async function load() {
  if (!configured || !isSignedIn.value) { state.value = 'idle'; content.value = null; find.value = null; return }
  state.value = 'loading'
  const [c, f, s] = await Promise.all([
    supabase.rpc('admin_content', { days: days.value, audience: audience.value, published: PUBLISHED, filters: filtersForRead.value }),
    supabase.rpc('admin_find', { days: days.value }),
    supabase.rpc('admin_series', { days: days.value, audience: audience.value, filters: filtersForRead.value }),
  ])
  const err = c.error || f.error || s.error
  if (err) { state.value = (err.code === '42501' || /admin only|permission/i.test(err.message || '')) ? 'denied' : 'error'; return }
  content.value = c.data || null
  find.value = f.data || null
  series.value = s.data || []
  state.value = 'ok'
  loadNow()
}
async function loadNow() { if (!configured || !isSignedIn.value) return; const { data: n } = await supabase.rpc('admin_now'); if (n) now.value = n }
let nowTimer = null
onMounted(() => { nowTimer = setInterval(() => { if (document.visibilityState !== 'hidden' && state.value === 'ok') loadNow() }, 60000) })
onBeforeUnmount(() => clearInterval(nowTimer))
/* the tabs: overview · pieces · topics · readers, then the features the site has, then the site's own panels */
const TB = T.content ? T.content.tabs || {} : {}
const TAB_KEY = 'dl.content-analytics.tab'
const tab = ref((() => { try { return localStorage.getItem(TAB_KEY) || 'overview' } catch (e) { return 'overview' } })())
watch(tab, (v) => { try { localStorage.setItem(TAB_KEY, v) } catch (e) { /* private mode */ } })
const tabs = computed(() => [
  { key: 'overview', label: TB.overview }, { key: 'conversions', label: TB.conversions }, { key: 'pieces', label: TB.pieces },
  ...(hasAuthors.value ? [{ key: 'authors', label: TB.authors }] : []),
  { key: 'topics', label: TB.topics }, { key: 'readers', label: TB.readers },
  ...(finderOn && find.value ? [{ key: 'find', label: TB.find }] : []),
  ...(SITE_PANELS.length ? [{ key: 'site', label: TB.site }] : []),
])
watch(tabs, (list) => { if (!list.some((t) => t.key === tab.value)) tab.value = 'overview' })

onMounted(load)
watch([isSignedIn, days, audience, () => JSON.stringify(filtersForRead.value)], load)
/* the pieces table as a CSV: every row in hand, every column */
function exportCsv() {
  const cols = ['kind', 'id', 'title', 'author', 'views', 'readers', 'minutes', 'avg_seconds', 'depth', 'recirculation', 'prev_views', 'signups', 'subscriptions', 'purchases', 'revenue']
  const esc = (v) => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t }
  const csv = [cols.join(',')].concat(items.value.map((r) => cols.map((c) => esc(r[c])).join(','))).join('\n')
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'content-' + days.value + 'd.csv'; a.click()
}

/* ---- helpers ---- */
const num = (n) => new Intl.NumberFormat().format(Math.round(n || 0))
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const money = (n, c) => new Intl.NumberFormat(undefined, { style: 'currency', currency: (c || 'usd').toUpperCase(), maximumFractionDigits: 0 }).format((n || 0) / 100)
const secs = (s) => (!s ? '—' : s >= 60 ? Math.floor(s / 60) + 'm ' + String(Math.round(s % 60)).padStart(2, '0') + 's' : Math.round(s) + 's')
const dayKey = (d) => String(d || '').slice(0, 10)
const day = (d) => { const t = new Date(dayKey(d) + 'T00:00:00'); return isNaN(t) ? '' : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
const bars = (list, key) => { const rows = list || []; const max = Math.max(1, ...rows.map((x) => x[key] || 0)); return rows.map((x) => ({ ...x, w: ((x[key] || 0) / max) * 100 })) }
const open = reactive({})
function L(name, arr, key, cap = 8) { const all = bars(arr || [], key); return { rows: open[name] ? all : all.slice(0, cap), more: all.length > cap, open: !!open[name], total: all.length } }
const toggle = (name) => { open[name] = !open[name] }
function openAuth() { if (window.DLauth) window.DLauth.open() }
const delta = (now, before) => { if (!before) return null; const d = Math.round(((now - before) / before) * 100); return { dir: d > 0 ? 'up' : d < 0 ? 'down' : 'flat', text: (d > 0 ? '+' : '') + d + '%' } }
const kindName = (k) => KN[k] || k
const rangeLabel = computed(() => H.range.replace('{days}', days.value))
const chartKey = ref(0)
onMounted(() => { const mo = new MutationObserver(() => chartKey.value++); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }) })

/* ---- the content ---- */
const totals = computed(() => (content.value && content.value.totals) || {})
const prev = computed(() => (content.value && content.value.prev) || {})
const reading = computed(() => (content.value && content.value.reading) || {})
const hasContent = computed(() => (totals.value.views || 0) > 0)
const finishRate = (r) => (r.reads ? Math.round((r.finished / r.reads) * 100) : 0)
const tiles = computed(() => [
  { label: KP.views, value: num(totals.value.views), d: delta(totals.value.views, prev.value.views), spark: 'views' },
  { label: KP.readers, value: num(totals.value.readers), d: delta(totals.value.readers, prev.value.readers), spark: 'readers' },
  { label: KP.engaged, value: num(totals.value.minutes), d: delta(totals.value.minutes, prev.value.minutes) },
  { label: KP.time, value: secs(reading.value.avg_seconds), d: delta(reading.value.avg_seconds, reading.value.prev_avg_seconds) },
  { label: KP.finish, value: finishRate(reading.value) + '%', d: delta(finishRate(reading.value), reading.value.prev_reads ? Math.round((reading.value.prev_finished / reading.value.prev_reads) * 100) : 0) },
  { label: KP.recirculation, value: (totals.value.recirculation || 0) + '%', d: delta(totals.value.recirculation, prev.value.recirculation), help: KP['recirculation-help'] },
  { label: KP.items, value: num(totals.value.items), d: delta(totals.value.items, prev.value.items) },
  { label: KP['signed-in'], value: num(totals.value.signed_in), d: delta(totals.value.signed_in, prev.value.signed_in) },
])
const sparkOn = (key) => win.value.now.some((r) => (r[key] || 0) > 0)
/* the window's days and the same days before them */
const win = computed(() => { const all = (content.value && content.value.series) || []; return { now: all.slice(-days.value), before: all.slice(0, Math.max(0, all.length - days.value)) } })
const sparkPath = (key) => { const rows = win.value.now; if (rows.length < 2) return ''; const max = Math.max(1, ...rows.map((r) => r[key] || 0)); return rows.map((r, i) => `${(i / (rows.length - 1)) * 100},${30 - ((r[key] || 0) / max) * 26 - 2}`).join(' ') }
const overTimeOption = computed(() => {
  void chartKey.value; void chartKind.value
  const b = base(), t = tokens()
  const now = win.value.now, before = win.value.before
  return { ...b, xAxis: timeAxis({ ...b.xAxis, data: now.map((r) => day(r.day)) }), series: [
    timeSeries({ name: KP.views, color: t.accent, area: true, data: now.map((r) => r.views) }),
    timeSeries({ name: KP.readers, color: PALETTE[1], data: now.map((r) => r.readers) }),
    timeSeries({ name: CS['prev-series'], color: t.ink3, reference: true, data: now.map((_, i) => (before[i] ? before[i].views : null)) }),
  ] }
})
/* what the content led to: a sign-up, a subscription, a purchase attributed to the last piece read in the week before */
const CV = T.content ? T.content.conversions || {} : {}
const conv = computed(() => (content.value && content.value.conversions) || {})
const convTiles = computed(() => { const c = conv.value; const cur = (content.value && content.value.currency) || 'usd'; return [
  { label: CV.signups, value: num(c.signups_content), of: num(c.signups) },
  { label: CV.subscriptions, value: num(c.subscriptions_content), of: num(c.subscriptions) },
  { label: CV.purchases, value: num(c.purchases_content), of: num(c.purchases) },
  { label: CV.revenue, value: money(c.revenue_content, cur), of: money(c.revenue, cur) },
] })
const convSort = ref('all')
const convRows = computed(() => {
  const rows = ((conv.value.items) || []).map((r) => ({ ...r, all: (r.signups || 0) + (r.subscriptions || 0) + (r.purchases || 0) }))
  const k = convSort.value
  const sorted = rows.slice().sort((a, b) => (b[k] || 0) - (a[k] || 0) || (b.all || 0) - (a.all || 0))
  const max = Math.max(1, ...sorted.map((r) => r.all))
  return sorted.map((r) => ({ ...r, w: (r.all / max) * 100, rate: r.readers ? Math.round((r.all / r.readers) * 1000) / 10 : 0 }))
})

/* what people read: every piece, filtered by kind and by a search, sorted by a column */
const kind = ref('all'), q = ref(''), sortBy = ref('views')
const kinds = computed(() => ((content.value && content.value.kinds) || []).map((k) => k.kind))
const items = computed(() => {
  const all = (content.value && content.value.items) || []
  const needle = q.value.trim().toLowerCase()
  const rows = all.filter((r) => (kind.value === 'all' || r.kind === kind.value) && (!needle || String(r.title || '').toLowerCase().includes(needle) || String(r.id || '').toLowerCase().includes(needle)))
  const k = sortBy.value
  const sorted = rows.slice().sort((a, b) => (b[k] || 0) - (a[k] || 0) || (b.views || 0) - (a.views || 0))
  const max = Math.max(1, ...sorted.map((r) => r.views || 0))
  return sorted.map((r) => ({ ...r, author: authorOf(r), w: ((r.views || 0) / max) * 100, d: delta(r.views, r.prev_views) }))
})
/* by author: every piece with one, added up — views, readers, engaged minutes, what it led to */
const authors = computed(() => {
  const by = {}
  for (const r of (content.value && content.value.items) || []) { const a = authorOf(r); if (!a) continue; const x = by[a] || (by[a] = { author: a, pieces: 0, views: 0, readers: 0, minutes: 0, conversions: 0, revenue: 0 }); x.pieces++; x.views += r.views || 0; x.readers += r.readers || 0; x.minutes += r.minutes || 0; x.conversions += (r.signups || 0) + (r.subscriptions || 0) + (r.purchases || 0); x.revenue += r.revenue || 0 }
  const rows = Object.values(by).sort((a, b) => b.views - a.views); const max = Math.max(1, ...rows.map((r) => r.views))
  return rows.map((r) => ({ ...r, w: (r.views / max) * 100 }))
})
const channelName = (c) => ((T.acquisition && T.acquisition.ui) || {})['channel-' + c] || c
const audienceLine = computed(() => (audience.value === 'all' ? '' : String(H['audience-line'] || '').replace('{audience}', H['audience-' + audience.value] || audience.value)))
const shownItems = computed(() => (open.items ? items.value : items.value.slice(0, 12)))
const depthQ = computed(() => { const d = (content.value && content.value.depth) || {}; const n = (d.q1 || 0) + (d.q2 || 0) + (d.q3 || 0) + (d.q4 || 0); return ['q1', 'q2', 'q3', 'q4'].map((k) => ({ k, n: d[k] || 0, p: n ? Math.round(((d[k] || 0) / n) * 100) : 0 })) })

/* ---- the features (as before) ---- */
const bookTitle = (slug) => { const b = BOOKS.find((x) => x.slug === slug); return b ? b.title : slug }
const lookingLabel = (c) => (c ? (FD['choice-' + c] || c) : FD['choice-none'] || '—')
const paceLabel = (c) => (c ? (FD['pace-' + c] || c) : FD['choice-none'] || '—')

/* the round, day by day: started and finished */
const roundOption = computed(() => {
  void chartKey.value; void chartKind.value
  const b = base(), t = tokens()
  const line = (name, key, color) => timeSeries({ name, color, area: true, data: series.value.map((r) => r[key] || 0) })
  return { ...b, xAxis: timeAxis({ ...b.xAxis, data: series.value.map((r) => day(r.day)) }), series: [line(MN['find-starts'], 'find_starts', t.accent), line(MN['find-results'], 'find_results', PALETTE[1])] }
})

</script>

<template>
  <div class="ui-page an">
    <AdminHead :title="C.title" :sub="C.subtitle">
      <template #actions>
        <div v-if="state === 'ok'" class="an-controls">
          <div class="an-seg an-audience" role="group">
            <button v-for="a in AUD" :key="a" type="button" :class="{ on: audience === a }" @click="audience = a">{{ H['audience-' + a] }}</button>
          </div>
          <ChartKind />
          <div class="an-seg">
            <button v-for="d in [7, 30, 90, 365]" :key="d" type="button" :class="{ on: days === d }" @click="days = d">{{ d }}d</button>
            <button type="button" class="an-refresh" @click="load">{{ H.refresh }}</button>
          </div>
        </div>
      </template>
    </AdminHead>

    <div v-if="state === 'idle'" class="an-note">
      <h2>{{ H['signin-heading'] }}</h2><p>{{ H['signin-subtitle'] }}</p>
      <button type="button" class="an-cta" @click="openAuth">{{ H['signin-cta'] }}</button>
    </div>
    <div v-else-if="state === 'denied'" class="an-note"><h2>{{ H['denied-heading'] }}</h2><p>{{ H['denied-subtitle'] }}</p></div>
    <div v-else-if="state === 'error'" class="an-note"><h2>{{ H['error-heading'] }}</h2><p>{{ H['error-subtitle'] }}</p></div>
    <p v-else-if="state === 'loading'" class="an-loading">{{ H.loading }}</p>

    <template v-else-if="state === 'ok' && content">
      <!-- the tabs: one view at a time -->
      <div class="an-tabs" role="tablist">
        <button v-for="t in tabs" :key="t.key" type="button" role="tab" :class="{ on: tab === t.key }" :aria-selected="tab === t.key" @click="tab = t.key">{{ t.label }}</button>
      </div>
      <div class="an-range"><span class="an-rangelabel">{{ rangeLabel }}</span><span class="an-vs">{{ H['vs-previous'].replace('{days}', days) }}<template v-if="audienceLine"> · <b class="an-audline">{{ audienceLine }}</b></template></span></div>
      <FilterChips />

      <!-- overview: the numbers, the line, what moves -->
      <template v-if="tab === 'overview'">
      <!-- the six numbers, as one panel -->
      <div class="an-panel" :data-n="tiles.length">
        <div v-for="t in tiles" :key="t.label" class="an-cell" :title="t.help || ''">
          <span class="an-k">{{ t.label }}</span>
          <div class="an-cellrow">
            <b>{{ t.value }}</b>
            <svg v-if="t.spark && sparkOn(t.spark) && sparkPath(t.spark)" class="an-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline :points="sparkPath(t.spark)" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" /></svg>
          </div>
          <span class="an-delta" :class="t.d ? t.d.dir : 'none'">{{ t.d ? t.d.text + ' ' + CS.vs : H['no-previous'] }}</span>
        </div>
      </div>

        <p v-if="!hasContent" class="an-empty">{{ C.empty }}</p>
        <template v-else>
        <!-- reading now -->
        <section v-if="now" class="an-card an-nowcard">
          <div class="an-ch an-ch-row"><div><h2><i class="an-livedot" :class="{ some: (now.pieces || []).length }" />{{ CS['reading-now'] }}</h2><p>{{ CS['reading-now-subtitle'] }}</p></div></div>
          <ol v-if="(now.pieces || []).length" class="an-nowlist">
            <li v-for="r in now.pieces" :key="r.kind + r.id"><button type="button" class="an-nowpiece" @click="emit('open', { kind: r.kind, id: r.id })"><b>{{ num(r.n) }}</b><span>{{ r.title || r.id }}</span><small>{{ kindName(r.kind) }}</small></button></li>
          </ol>
          <p v-else class="an-none">{{ CS['reading-now-none'] }}</p>
        </section>

        <!-- reading over time -->
        <section class="an-card">
          <div class="an-ch"><h2>{{ CS['over-time'] }}</h2><p>{{ CS['over-time-subtitle'] }}</p></div>
          <VChart :key="'ct' + chartKey" class="an-chart" :option="overTimeOption" autoresize />
        </section>

        <!-- rising · fading · evergreen · by kind -->
        <div class="an-grid4">
          <section class="an-card">
            <div class="an-ch"><h2>{{ CS.rising }}</h2><p>{{ CS['rising-subtitle'] }}</p></div>
            <ol class="an-list an-list-titles">
              <li v-for="r in bars(content.rising, 'views')" :key="r.kind + r.id"><div class="an-rowtxt stack"><code>{{ r.title }}</code><b>{{ num(r.views) }} <i>{{ CS.views }} · {{ num(r.prev_views) }} {{ CS.prev }}</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            <p v-if="!(content.rising || []).length" class="an-none">{{ CS.none }}</p>
          </section>
          <section class="an-card">
            <div class="an-ch"><h2>{{ CS.fading }}</h2><p>{{ CS['fading-subtitle'] }}</p></div>
            <ol class="an-list an-list-titles">
              <li v-for="r in bars(content.fading, 'prev_views')" :key="r.kind + r.id"><div class="an-rowtxt stack"><code>{{ r.title }}</code><b>{{ num(r.views) }} <i>{{ CS.views }} · {{ num(r.prev_views) }} {{ CS.prev }}</i></b></div><span class="an-track"><span class="an-fill an-fill-quiet" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            <p v-if="!(content.fading || []).length" class="an-none">{{ CS.none }}</p>
          </section>
          <section class="an-card">
            <div class="an-ch"><h2>{{ CS.evergreen }}</h2><p>{{ CS['evergreen-subtitle'] }}</p></div>
            <ol class="an-list an-list-titles">
              <li v-for="r in bars(content.evergreen, 'views')" :key="r.kind + r.id"><div class="an-rowtxt stack"><code>{{ r.title }}</code><b>{{ num(r.views) }} <i>{{ CS.views }}</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            <p v-if="!(content.evergreen || []).length" class="an-none">{{ CS.none }}</p>
          </section>
          <section class="an-card">
            <div class="an-ch"><h2>{{ CS.kinds }}</h2></div>
            <ol class="an-list an-list-titles">
              <li v-for="k in bars(content.kinds, 'views')" :key="k.kind"><div class="an-rowtxt stack"><code>{{ kindName(k.kind) }}</code><b>{{ num(k.views) }} <i>{{ CS.views }} · {{ num(k.readers) }} {{ CS.readers }} · {{ secs(k.avg_seconds) }} {{ CS['time-short'] }}</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: k.w + '%' }" /></span></li>
            </ol>
            <p v-if="!(content.kinds || []).length" class="an-none">{{ CS.none }}</p>
          </section>
        </div>

        </template>
      </template>

      <!-- conversions: what the content led to -->
      <template v-else-if="tab === 'conversions'">
        <div class="an-panel an-panel4">
          <div v-for="t in convTiles" :key="t.label" class="an-cell">
            <span class="an-k">{{ t.label }}</span>
            <div class="an-cellrow"><b>{{ t.value }}</b></div>
            <span class="an-delta none">{{ CV.of.replace('{n}', t.of) }}</span>
          </div>
        </div>
        <p class="an-quiet an-quiet-under">{{ CV.how }}</p>
        <section class="an-card">
          <div class="an-ch"><h2>{{ CV.title }}</h2><p>{{ CV.subtitle }}</p></div>
          <table class="an-table an-ctable">
            <thead><tr>
              <th class="an-th-piece">{{ CO.piece }}</th>
              <th class="an-th-num">{{ CO.readers }}</th>
              <th v-for="c in [['signups', CV.signups], ['subscriptions', CV.subscriptions], ['purchases', CV.purchases], ['revenue', CV.revenue], ['all', CV.all]]" :key="c[0]" class="an-th-num"><button type="button" class="an-sort" :class="{ on: convSort === c[0] }" @click="convSort = c[0]">{{ c[1] }}</button></th>
              <th class="an-th-num">{{ CV.rate }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="r in convRows" :key="r.kind + ':' + r.id">
                <td class="an-td-piece">
                  <a v-if="r.path" :href="r.path" class="an-piece" target="_blank" rel="noopener">{{ r.title }}</a><span v-else class="an-piece">{{ r.title }}</span>
                  <span class="an-kind">{{ kindName(r.kind) }}</span>
                  <span class="an-track an-track-row"><span class="an-fill" :style="{ width: r.w + '%' }" /></span>
                </td>
                <td class="an-td-num">{{ num(r.readers) }}</td>
                <td class="an-td-num">{{ r.signups ? num(r.signups) : '—' }}</td>
                <td class="an-td-num">{{ r.subscriptions ? num(r.subscriptions) : '—' }}</td>
                <td class="an-td-num">{{ r.purchases ? num(r.purchases) : '—' }}</td>
                <td class="an-td-num">{{ r.revenue ? money(r.revenue, content.currency) : '—' }}</td>
                <td class="an-td-num"><b>{{ num(r.all) }}</b></td>
                <td class="an-td-num">{{ r.rate }}%</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!convRows.length" class="an-none">{{ CV.none }}</p>
        </section>
      </template>

      <!-- pieces: every piece read -->
      <template v-else-if="tab === 'pieces'">
        <p v-if="!hasContent" class="an-empty">{{ C.empty }}</p>
        <!-- what people read: the table -->
        <section class="an-card">
          <div class="an-ch an-ch-row">
            <div><h2>{{ CS.what }}</h2><p>{{ CS['what-subtitle'] }}</p></div>
            <div class="an-tools">
              <div class="an-seg an-kinds">
                <button type="button" :class="{ on: kind === 'all' }" @click="kind = 'all'">{{ CS['all-kinds'] }}</button>
                <button v-for="k in kinds" :key="k" type="button" :class="{ on: kind === k }" @click="kind = k">{{ kindName(k) }}</button>
              </div>
              <input v-model="q" class="an-search" type="search" :placeholder="CS.search" :aria-label="CS.search" />
              <button type="button" class="an-ghost" @click="exportCsv">{{ CO.export }}</button>
            </div>
          </div>
          <table class="an-table an-ctable">
            <thead><tr>
              <th class="an-th-piece">{{ CO.piece }}</th>
              <th v-if="hasAuthors" class="an-th-author">{{ CO.author }}</th>
              <th v-for="c in [['views', CO.views], ['readers', CO.readers], ['minutes', CO.engaged], ['avg_seconds', CO.time], ['depth', CO.depth], ['recirculation', CO.recirculation]]" :key="c[0]" class="an-th-num" :class="'an-col-' + c[0]"><button type="button" class="an-sort" :class="{ on: sortBy === c[0] }" @click="sortBy = c[0]">{{ c[1] }}</button></th>
              <th class="an-th-num">{{ CO.change }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="r in shownItems" :key="r.kind + ':' + r.id">
                <td class="an-td-piece">
                  <button type="button" class="an-piece an-piecebtn" @click="emit('open', { kind: r.kind, id: r.id })">{{ r.title }}</button>
                  <span class="an-kind">{{ kindName(r.kind) }}</span>
                  <span class="an-track an-track-row"><span class="an-fill" :style="{ width: r.w + '%' }" /></span>
                </td>
                <td v-if="hasAuthors" class="an-td-author">{{ r.author || '—' }}</td>
                <td class="an-td-num an-col-views"><b>{{ num(r.views) }}</b></td>
                <td class="an-td-num an-col-readers">{{ num(r.readers) }}</td>
                <td class="an-td-num an-col-minutes">{{ num(r.minutes) }} <i class="an-muted">{{ CO['engaged-unit'] }}</i></td>
                <td class="an-td-num an-col-avg_seconds">{{ secs(r.avg_seconds) }}</td>
                <td class="an-td-num an-col-depth"><span class="an-depth" :title="r.depth + '%'"><span class="an-depth-fill" :style="{ width: (r.depth || 0) + '%' }" /></span><i>{{ r.depth ? r.depth + '%' : '—' }}</i></td>
                <td class="an-td-num an-col-recirculation">{{ r.recirculation || 0 }}%</td>
                <td class="an-td-num"><span class="an-delta" :class="r.d ? r.d.dir : ''">{{ r.d ? r.d.text : '—' }}</span></td>
              </tr>
            </tbody>
          </table>
          <p v-if="!items.length" class="an-none">{{ CS.none }}</p>
          <button v-if="items.length > 12" type="button" class="an-more" @click="toggle('items')">{{ open.items ? CS['show-less'] : CS['show-all'] + ' ' + items.length }}</button>
        </section>

      </template>

      <!-- by author -->
      <template v-else-if="tab === 'authors'">
        <section class="an-card">
          <div class="an-ch"><h2>{{ CS.authors }}</h2><p>{{ CS['authors-subtitle'] }}</p></div>
          <table class="an-table an-ctable">
            <thead><tr><th class="an-th-piece">{{ CO.author }}</th><th class="an-th-num">{{ CO.piece }}</th><th class="an-th-num">{{ CO.views }}</th><th class="an-th-num">{{ CO.readers }}</th><th class="an-th-num">{{ CO.engaged }}</th><th class="an-th-num">{{ CV.all }}</th><th class="an-th-num">{{ CV.revenue }}</th></tr></thead>
            <tbody><tr v-for="a in authors" :key="a.author"><td class="an-td-piece"><span class="an-piece">{{ a.author }}</span><span class="an-track an-track-row"><span class="an-fill" :style="{ width: a.w + '%' }" /></span></td><td class="an-td-num">{{ num(a.pieces) }}</td><td class="an-td-num"><b>{{ num(a.views) }}</b></td><td class="an-td-num">{{ num(a.readers) }}</td><td class="an-td-num">{{ num(a.minutes) }} <i class="an-muted">{{ CO['engaged-unit'] }}</i></td><td class="an-td-num">{{ num(a.conversions) }}</td><td class="an-td-num">{{ money(a.revenue, content.currency) }}</td></tr></tbody>
          </table>
          <p v-if="!authors.length" class="an-none">{{ CS.none }}</p>
        </section>
      </template>

      <!-- topics and tags -->
      <template v-else-if="tab === 'topics'">
        <div class="an-two">
          <section class="an-card">
            <div class="an-ch"><h2>{{ CS.topics }}</h2><p>{{ CS['topics-subtitle'] }}</p></div>
            <ol class="an-list">
              <li v-for="r in L('topics', content.topics, 'views', 12).rows" :key="r.topic"><div class="an-rowtxt"><code>{{ r.topic }}</code><b>{{ num(r.views) }} <i>{{ CS.views }}</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            <p v-if="!(content.topics || []).length" class="an-none">{{ CS.none }}</p>
            <button v-if="L('topics', content.topics, 'views', 12).more" type="button" class="an-more" @click="toggle('topics')">{{ open.topics ? CS['show-less'] : CS['show-all'] + ' ' + (content.topics || []).length }}</button>
          </section>
          <section class="an-card">
            <div class="an-ch"><h2>{{ CS.tags }}</h2><p>{{ CS['tags-subtitle'] }}</p></div>
            <ol class="an-list">
              <li v-for="r in L('tags', content.tags, 'views', 12).rows" :key="r.tag"><div class="an-rowtxt"><code>{{ r.tag }}</code><b>{{ num(r.views) }} <i>{{ CS.views }}</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            <p v-if="!(content.tags || []).length" class="an-none">{{ CS.none }}</p>
            <button v-if="L('tags', content.tags, 'views', 12).more" type="button" class="an-more" @click="toggle('tags')">{{ open.tags ? CS['show-less'] : CS['show-all'] + ' ' + (content.tags || []).length }}</button>
          </section>
        </div>
      </template>

      <!-- readers: how far, and from where -->
      <template v-else-if="tab === 'readers'">
        <div class="an-grid3">
          <section class="an-card">
            <div class="an-ch"><h2>{{ CS.depth }}</h2><p>{{ CS['depth-subtitle'] }}</p></div>
            <div class="an-depthbar" aria-hidden="true"><span v-for="s in depthQ" :key="s.k" :class="'an-' + s.k" :style="{ width: s.p + '%' }" /></div>
            <ol class="an-list an-list-tight">
              <li v-for="s in depthQ" :key="s.k"><div class="an-rowtxt"><code><i :class="'an-dot an-' + s.k" />{{ CS[s.k] }}</code><b>{{ s.p }}% <i>{{ num(s.n) }}</i></b></div></li>
            </ol>
          </section>
          <section class="an-card">
            <div class="an-ch"><h2>{{ CS.channels }}</h2><p>{{ CS['channels-subtitle'] }}</p></div>
            <ol class="an-list">
              <li v-for="r in bars(content.channels, 'views')" :key="r.channel"><div class="an-rowtxt"><span><i class="an-chdot" :data-channel="r.channel" />{{ channelName(r.channel) }}</span><b>{{ num(r.views) }} <i>{{ CS.views }} · {{ num(r.readers) }} {{ CS.readers }}</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            <p v-if="!(content.channels || []).length" class="an-none">{{ CS.none }}</p>
          </section>
          <section class="an-card">
            <div class="an-ch"><h2>{{ CS.referrers }}</h2><p>{{ CS['referrers-subtitle'] }}</p></div>
            <ol class="an-list">
              <li v-for="r in bars(content.referrers, 'views')" :key="r.ref"><div class="an-rowtxt"><code>{{ r.ref }}</code><b>{{ num(r.views) }} <i>{{ CS.views }}</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            <p v-if="!(content.referrers || []).length" class="an-none">{{ CS.none }}</p>
          </section>
        </div>
      </template>

      <!-- the finder -->
      <template v-else-if="tab === 'find' && find">
      <!-- ============ find your book ============ -->
      <template v-if="find.starts">
      <section class="an-card">
        <div class="an-ch"><p>{{ FD.subtitle }}</p></div>
        <div class="an-stats">
          <div><span class="an-k">{{ FD.starts }}</span><b>{{ num(find.starts) }}</b></div>
          <div><span class="an-k">{{ FD.results }}</span><b>{{ num(find.results) }}</b></div>
          <div><span class="an-k">{{ FD.completion }}</span><b>{{ pct(find.results, find.starts) }}%</b></div>
          <div><span class="an-k">{{ FD.opened }}</span><b>{{ pct(find.opened_sessions, find.results) }}% <i class="an-muted">· {{ num(find.opens) }}</i></b></div>
        </div>
        <VChart :key="'round' + chartKey" class="an-chart sm" :option="roundOption" autoresize />
      </section>

      <div class="an-grid2">
        <section class="an-card">
          <div class="an-ch"><h2>{{ FD.books }}</h2></div>
          <ol class="an-list">
            <li v-for="r in L('fbooks', find.books, 'recommended', 10).rows" :key="r.book"><div class="an-rowtxt stack"><span>{{ bookTitle(r.book) }}</span>
              <b>{{ num(r.recommended) }} <i>{{ FD.recommended }}</i> · {{ num(r.first) }} <i>{{ FD.first }}</i> · {{ num(r.opened) }} <i>{{ FD['opened-short'] }}</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
          </ol>
          <p v-if="!(find.books || []).length" class="an-none">{{ S['no-rows'] }}</p>
        </section>
        <section class="an-card">
          <div class="an-ch"><h2>{{ FD.looking }}</h2></div>
          <ol class="an-list">
            <li v-for="r in L('flook', find.looking, 'n', 6).rows" :key="r.choice"><div class="an-rowtxt"><span>{{ lookingLabel(r.choice) }}</span><b>{{ num(r.n) }} · {{ pct(r.n, find.results) }}%</b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
          </ol>
          <p v-if="!(find.looking || []).length" class="an-none">{{ S['no-rows'] }}</p>
          <h3 class="an-sub">{{ FD.pace }}</h3>
          <ol class="an-list">
            <li v-for="r in L('fpace', find.pace, 'n', 4).rows" :key="r.choice"><div class="an-rowtxt"><span>{{ paceLabel(r.choice) }}</span><b>{{ num(r.n) }} · {{ pct(r.n, find.results) }}%</b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
          </ol>
          <p v-if="!(find.pace || []).length" class="an-none">{{ S['no-rows'] }}</p>
        </section>
      </div>

      <section class="an-card">
        <div class="an-ch"><h2>{{ FD.answers }}</h2><p>{{ FD['answers-subtitle'] }}</p></div>
        <div class="an-grid2 tight">
          <div v-for="k in ['problem', 'frustration']" :key="k">
            <h3 class="an-sub">{{ FD[k] }}</h3>
            <ol class="an-list">
              <li v-for="r in L('w' + k, (find.words || {})[k], 'n', 5).rows" :key="r.word"><div class="an-rowtxt"><span class="an-word">{{ r.word }}</span><b>{{ num(r.n) }}</b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            <p v-if="!((find.words || {})[k] || []).length" class="an-none">{{ FD['no-answers'] }}</p>
          </div>
        </div>
      </section>
      </template>
      <p v-else class="an-quiet">{{ FD.subtitle }} {{ CS.quiet }}</p>
      </template>

      <!-- the site's own panels -->
      <template v-else-if="tab === 'site'">
        <component :is="p.component" v-for="p in SITE_PANELS" :key="p.key" :days="days" />
      </template>
    </template>
  </div>
</template>

<style>
/* the content page's own pieces, on the shared idiom */
.an-panel6 { grid-template-columns: repeat(6, minmax(0, 1fr)) } .an-panel6 .an-cell:nth-child(4n) { border-right: 1px solid var(--hair) } .an-panel6 .an-cell:nth-child(6n) { border-right: 0 } .an-panel6 .an-cell:nth-child(n+5) { border-bottom: 1px solid var(--hair) } .an-panel6 .an-cell { border-bottom: 0 }
.an-ch-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap }
.an-tools { display: flex; align-items: center; gap: 10px; flex-wrap: wrap }
.an-search { font: inherit; font-size: 13px; color: var(--ink); background: var(--paper); border: 1px solid var(--hair); border-radius: 999px; padding: 7px 14px; width: 200px }
.an-table { width: 100%; min-width: 0; border-collapse: collapse; font-size: 13px }   /* a flex item: never wider than its card */
.an-piecebtn { font: inherit; background: none; border: 0; padding: 0; color: var(--ink); text-align: left; cursor: pointer; font-weight: 600 } .an-piecebtn:hover { color: var(--accent2); text-decoration: underline }
.an-td-author { font-size: 12.5px; color: var(--ink2); white-space: nowrap; max-width: 140px; overflow: hidden; text-overflow: ellipsis } .an-td-piece { min-width: 160px } .an-th-author { text-align: left }
.an-livedot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--ink3); opacity: .5; margin-right: 8px; vertical-align: middle } .an-livedot.some { background: #059669; opacity: 1; box-shadow: 0 0 0 3px color-mix(in srgb, #059669 20%, transparent) }
.an-nowlist { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px } .an-nowpiece { display: inline-flex; align-items: baseline; gap: 8px; font: inherit; font-size: 13px; color: var(--ink); background: color-mix(in srgb, var(--ink) 4%, transparent); border: 1px solid var(--hair); border-radius: 999px; padding: 6px 12px 6px 10px; cursor: pointer; max-width: 100% } .an-nowpiece:hover { border-color: var(--ink3) } .an-nowpiece b { font-family: var(--fd); font-weight: 600; font-size: 15px } .an-nowpiece span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap } .an-nowpiece small { font-family: var(--m); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3) }
.an-kinds { flex-wrap: wrap; max-width: 100% }
.an-table th { text-align: left; font-family: var(--m); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); font-weight: 500; padding: 6px 8px 8px; border-bottom: 1px solid var(--hair) }
.an-th-num, .an-td-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums }
.an-th-num { width: 86px } .an-th-piece { width: auto }
.an-sort { font: inherit; font-family: var(--m); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); background: none; border: 0; padding: 0; cursor: pointer } .an-sort.on { color: var(--ink) } .an-sort.on::after { content: ' ↓' }
.an-table td { padding: 9px 8px; border-bottom: 1px solid color-mix(in srgb, var(--hair) 60%, transparent); vertical-align: middle } .an-table tr:last-child td { border-bottom: 0 }
.an-td-piece { min-width: 0 } .an-piece { font-weight: 600; color: var(--ink); text-decoration: none } a.an-piece:hover { text-decoration: underline; text-underline-offset: 3px }
.an-kind { display: inline-block; margin-left: 8px; font-family: var(--m); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); border: 1px solid var(--hair); border-radius: 999px; padding: 1px 7px; vertical-align: 1px }
.an-track-row { margin-top: 6px; max-width: min(360px, 100%) }
.an-td-num b { font-weight: 600 } .an-td-num i { font-style: normal; color: var(--ink3); font-size: 11.5px; margin-left: 6px }
.an-depth { display: inline-block; width: 46px; height: 5px; border-radius: 3px; background: color-mix(in srgb, var(--ink) 8%, transparent); vertical-align: middle; overflow: hidden } .an-depth-fill { display: block; height: 100%; background: var(--accent2) }
.an-fill-quiet { background: var(--ink3) !important; opacity: .6 }
.an-list-tight li { padding: 5px 0 6px }
.an-depthbar { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: color-mix(in srgb, var(--ink) 6%, transparent); margin: 4px 0 12px } .an-depthbar span { display: block; height: 100% }
.an-q1 { background: color-mix(in srgb, var(--ink3) 45%, transparent) } .an-q2 { background: color-mix(in srgb, var(--accent2) 45%, var(--paper)) } .an-q3 { background: color-mix(in srgb, var(--accent2) 75%, var(--paper)) } .an-q4 { background: var(--accent2) }
.an-quiet { color: var(--ink3); font-size: 13.5px; margin: -6px 0 22px; max-width: 720px } .an-quiet-under { margin: 14px 0 0; max-width: none }
.an-list-titles code { font-family: inherit; font-size: 13px; letter-spacing: 0 }
.an-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; vertical-align: 0 }
@media (max-width: 1100px) { .an-panel6 { grid-template-columns: repeat(3, minmax(0, 1fr)) } .an-panel6 .an-cell:nth-child(6n) { border-right: 1px solid var(--hair) } .an-panel6 .an-cell:nth-child(3n) { border-right: 0 } .an-panel6 .an-cell:nth-child(-n+3) { border-bottom: 1px solid var(--hair) } }
@media (max-width: 720px) { .an-panel6 { grid-template-columns: repeat(2, minmax(0, 1fr)) } .an-panel6 .an-cell:nth-child(3n) { border-right: 1px solid var(--hair) } .an-panel6 .an-cell:nth-child(2n) { border-right: 0 } .an-panel6 .an-cell:nth-child(-n+4) { border-bottom: 1px solid var(--hair) } .an-ctable { table-layout: fixed } .an-ctable .an-th-num, .an-ctable .an-td-num { width: 54px; padding-left: 4px; padding-right: 4px } .an-ctable .an-td-num i { display: none } .an-col-readers, .an-col-minutes, .an-col-avg_seconds, .an-col-recirculation, .an-col-depth, .an-th-author, .an-td-author { display: none } .an-td-piece { overflow: hidden } .an-piece { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap } .an-kind { margin: 4px 0 0 } .an-search { width: 100% } }
</style>

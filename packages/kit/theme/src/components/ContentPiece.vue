<script setup lang="ts">
/*
 * One piece's page — as Parse.ly's post details and Ghost's post analytics read one: views, visitors, engaged minutes,
 * time, read to the end and recirculation against the window before; views a day since it was published; where the
 * reading came from (channels, then referrers); devices; new against returning readers; where reads ended, in tenths;
 * what they read next; and what it led to — the sign-ups, memberships and purchases credited to it (last touch), by
 * the channel the person arrived by. Read through admin_piece(kind, id, days, audience, tz); the piece's own record
 * (its title, author, date, path) from the collections. Wears the analytics idiom (analytics.css). Words: `## content /
 * ### piece` in content/app/ui/analytics.md, the audience and states `## page`.
 */
import { ref, computed, onMounted, watch } from 'vue'
import VChart from 'vue-echarts'
import { base, tokens, PALETTE, chartKind, timeSeries, timeAxis } from '../lib/charts-theme.js'
import ChartKind from './ChartKind.vue'
import FilterChips from './FilterChips.vue'
import { useFilters } from '../lib/analytics-filters.js'
import './analytics.css'
import { us } from 'platformkit/lib/content.js'
import { supabase, configured } from 'platformkit/lib/supabase.js'
import { isSignedIn } from 'platformkit/lib/auth.js'
import { books as BOOKS, articles as ARTICLES, wiki as WIKI, docs as DOCS } from '#content'

const props = defineProps({ kind: { type: String, default: '' }, id: { type: String, default: '' } })
const emit = defineEmits(['back', 'open'])
const T = us('analytics')
const H = T.page.head
const PW = T.content ? T.content.piece || {} : {}
const KP = T.content ? T.content.kpi || {} : {}
const KN = T.content ? T.content.kinds || {} : {}
const AQ = T.acquisition ? T.acquisition.ui : {}
const AU = T.audience ? T.audience.ui : {}
const AUD = ['all', 'guest', 'user', 'member']
const { forRead: filtersForRead } = useFilters(T.page.filters || {})
const days = ref(30)
const audience = ref('all')
const state = ref('idle')
const data = ref<any>(null)
const COLL: any = { article: ARTICLES || [], book: BOOKS || [], wiki: WIKI || [], docs: DOCS || [] }
const record = computed(() => (COLL[props.kind] || []).find((x: any) => x.slug === props.id || (x.path || '').split('/').pop() === props.id) || null)
const title = computed(() => (record.value && record.value.title) || props.id)
const tzHere = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch (e) { return 'UTC' } })()

async function load() {
  if (!configured || !isSignedIn.value || !props.id) { state.value = 'idle'; data.value = null; return }
  state.value = 'loading'
  const { data: d, error } = await (supabase as any).rpc('admin_piece', { kind: props.kind, id: props.id, days: days.value, audience: audience.value, tz: tzHere, filters: filtersForRead.value })
  if (error) { state.value = (error.code === '42501' || /admin only|permission/i.test(error.message || '')) ? 'denied' : 'error'; return }
  data.value = d || null
  state.value = 'ok'
}
onMounted(load)
watch([isSignedIn, days, audience, () => props.kind, () => props.id, () => JSON.stringify(filtersForRead.value)], load)
const chartKey = ref(0)
onMounted(() => { const mo = new MutationObserver(() => chartKey.value++); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }) })

/* ---- helpers ---- */
const num = (n: any) => new Intl.NumberFormat().format(Math.round(n || 0))
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
const money = (n: any, c: any) => new Intl.NumberFormat(undefined, { style: 'currency', currency: (c || 'usd').toUpperCase(), maximumFractionDigits: 0 }).format((n || 0) / 100)
const secs = (s: number) => (!s ? '—' : s >= 60 ? Math.floor(s / 60) + 'm ' + String(Math.round(s % 60)).padStart(2, '0') + 's' : Math.round(s) + 's')
const delta = (now: number, before: number) => { if (!before) return null; const d = Math.round(((now - before) / before) * 100); return { dir: d > 0 ? 'up' : d < 0 ? 'down' : 'flat', text: (d > 0 ? '+' : '') + d + '%' } }
const dayKey = (d: any) => String(d || '').slice(0, 10)
const day = (d: any) => { const t = new Date(dayKey(d) + 'T00:00:00'); return isNaN(t.getTime()) ? '' : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
const dateOnly = (d: string|number|Date) => { if (!d) return ''; const t = new Date(d); return isNaN(t.getTime()) ? '' : t.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
const rangeLabel = computed(() => H.range.replace('{days}', days.value))
const audienceLine = computed(() => (audience.value === 'all' ? '' : String(H['audience-line'] || '').replace('{audience}', H['audience-' + audience.value] || audience.value)))
const kindName = (k: string|number) => KN[k] || k
const channelName = (c: string) => AQ['channel-' + c] || c
const bars = (list: any, key: string|number) => { const rows = list || []; const max = Math.max(1, ...rows.map((x: any) => x[key] || 0)); return rows.map((x: any) => ({ ...x, w: ((x[key] || 0) / max) * 100 })) }
function openAuth() { if ((window as any).DLauth) (window as any).DLauth.open() }

const now = computed(() => (data.value && data.value.now) || {})
const prev = computed(() => (data.value && data.value.prev) || {})
const hasReads = computed(() => ((now.value as any).views || 0) > 0 || ((prev.value as any).views || 0) > 0)
const tiles = computed(() => [
  { label: KP.views, value: num((now.value as any).views), d: delta((now.value as any).views, (prev.value as any).views) },
  { label: PW.visitors, value: num((now.value as any).visitors), d: delta((now.value as any).visitors, (prev.value as any).visitors) },
  { label: KP.engaged, value: num((now.value as any).minutes), d: delta((now.value as any).minutes, (prev.value as any).minutes) },
  { label: KP.time, value: secs((now.value as any).avg_seconds), d: delta((now.value as any).avg_seconds, (prev.value as any).avg_seconds) },
  { label: KP.finish, value: ((now.value as any).finished || 0) + '%', d: delta((now.value as any).finished, (prev.value as any).finished) },
  { label: KP.recirculation, value: ((now.value as any).recirculation || 0) + '%', d: delta((now.value as any).recirculation, (prev.value as any).recirculation), help: KP['recirculation-help'] },
])
/* the series: every day of both windows, from the publish date (or the first view on record) on */
const series = computed(() => {
  const rows = (data.value && data.value.series) || []
  const from = dayKey((record.value && record.value.date) || (data.value && data.value.first_seen) || '')
  return from ? rows.filter((r: any) => dayKey((r as any).day) >= from) : rows
})
const seriesOption = computed(() => {
  void chartKey.value; void chartKind.value
  const b = base(), t = tokens(), rows = series.value
  return { ...b, xAxis: timeAxis({ ...b.xAxis, data: rows.map((r: any) => day((r as any).day)) }), yAxis: { ...b.yAxis, minInterval: 1 }, series: [
    timeSeries({ name: KP.views, color: t.accent, area: true, data: rows.map((r: any) => (r as any).views) }),
    timeSeries({ name: KP.readers, color: PALETTE[1], data: rows.map((r: any) => (r as any).readers) }),
  ] }
})
const newShare = computed(() => pct(data.value && data.value.new, ((data.value && data.value.new) || 0) + ((data.value && data.value.returning) || 0)))
/* where reads ended: ten bands, 0–9% to 90–100% */
const depth = computed(() => { const by: any = {}; for (const b of (data.value && data.value.depth) || []) by[(b as any).band] = (b as any).n; const rows = Array.from({ length: 10 }, (_, i) => ({ band: i, n: by[i] || 0 })); const max = Math.max(1, ...rows.map((r) => r.n)); const total = rows.reduce((s, r) => s + r.n, 0); return rows.map((r) => ({ ...r, w: (r.n / max) * 100, p: pct(r.n, total), label: i10(r.band) })) })
const i10 = (b: number) => (b === 9 ? '90–100%' : b * 10 + '–' + (b * 10 + 9) + '%')
const led = computed(() => (data.value && data.value.conversions) || {})
const ledTotal = computed(() => ((led.value as any).signups || 0) + ((led.value as any).subscriptions || 0) + ((led.value as any).purchases || 0))
</script>

<template>
  <div class="an">
    <div class="an-head">
      <div>
        <button type="button" class="an-crumb" @click="emit('back')">← {{ PW.back }}</button>
        <h1 class="an-title">{{ title }} <span class="an-kindpill">{{ kindName(kind) }}</span></h1>
        <p class="an-subtitle">{{ PW.subtitle }}<template v-if="record && record.author"> · {{ record.author }}</template><template v-if="record && record.date"> · {{ PW.published.replace('{date}', dateOnly(record.date)) }}</template><template v-else-if="data && data.first_seen"> · {{ PW['first-seen'].replace('{date}', dateOnly(data.first_seen)) }}</template></p>
      </div>
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
    </div>
    <div v-if="state === 'idle'" class="an-note"><h2>{{ H['signin-heading'] }}</h2><p>{{ H['signin-subtitle'] }}</p><button type="button" class="an-cta" @click="openAuth">{{ H['signin-cta'] }}</button></div>
    <div v-else-if="state === 'denied'" class="an-note"><h2>{{ H['denied-heading'] }}</h2><p>{{ H['denied-subtitle'] }}</p></div>
    <div v-else-if="state === 'error'" class="an-note"><h2>{{ H['error-heading'] }}</h2><p>{{ H['error-subtitle'] }}</p></div>
    <p v-else-if="state === 'loading'" class="an-loading">{{ H.loading }}</p>
    <template v-else-if="state === 'ok' && data">
      <div class="an-range"><span class="an-rangelabel">{{ rangeLabel }}</span><span class="an-vs">{{ H['vs-previous'].replace('{days}', days) }}<template v-if="audienceLine"> · <b class="an-audline">{{ audienceLine }}</b></template></span></div>
      <FilterChips />
      <p v-if="!hasReads" class="an-empty">{{ PW.none }}</p>
      <template v-else>
        <div class="an-panel" :data-n="tiles.length">
          <div v-for="t in tiles" :key="t.label" class="an-cell" :title="t.help || ''">
            <span class="an-k">{{ t.label }}</span>
            <div class="an-cellrow"><b>{{ t.value }}</b></div>
            <span class="an-delta" :class="t.d ? t.d.dir : 'none'">{{ t.d ? t.d.text + ' ' + H['vs-short'] : H['no-previous'] }}</span>
          </div>
        </div>

        <section class="an-card">
          <div class="an-ch"><h2>{{ PW.series }}</h2><p>{{ PW['since-published'] }}</p></div>
          <VChart :key="'piece' + chartKey" class="an-chart sm" :option="seriesOption" autoresize />
        </section>

        <div class="an-grid3">
          <!-- where they came from -->
          <section class="an-card">
            <div class="an-ch"><h2>{{ PW.from }}</h2><p>{{ PW['from-subtitle'] }}</p></div>
            <ol class="an-list">
              <li v-for="r in bars(data.channels, 'n')" :key="r.channel"><div class="an-rowtxt"><span><i class="an-chdot" :data-channel="r.channel" />{{ channelName(r.channel) }}</span><b>{{ num(r.n) }} <i>· {{ pct(r.n, now.views) }}%</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            <h3 class="an-sub">{{ PW.referrers }}</h3>
            <ol class="an-list an-list-tight">
              <li v-for="r in bars(data.referrers, 'n')" :key="r.ref"><div class="an-rowtxt"><code>{{ r.ref }}</code><b>{{ num(r.n) }}</b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            <p v-if="!(data.referrers || []).length" class="an-none">{{ H['no-previous'] }}</p>
          </section>
          <!-- devices, new and returning -->
          <section class="an-card">
            <div class="an-ch"><h2>{{ PW.devices }}</h2></div>
            <ol class="an-list">
              <li v-for="r in bars(data.devices, 'n')" :key="r.device"><div class="an-rowtxt"><span>{{ AU['device-' + r.device] || r.device }}</span><b>{{ num(r.n) }} <i>· {{ pct(r.n, now.views) }}%</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            <h3 class="an-sub">{{ PW['new-returning'] }}</h3>
            <div class="an-split"><span class="an-splitfill" :style="{ width: newShare + '%' }" /></div>
            <div class="an-splitlegend"><span><i class="an-dot a" />{{ PW.new }} <b>{{ num(data.new) }}</b> · {{ newShare }}%</span><span><i class="an-dot b" />{{ PW.returning }} <b>{{ num(data.returning) }}</b> · {{ 100 - newShare }}%</span></div>
          </section>
          <!-- where reads ended -->
          <section class="an-card">
            <div class="an-ch"><h2>{{ PW.ended }}</h2><p>{{ PW['ended-subtitle'] }}</p></div>
            <ol class="an-list an-list-tight an-bands">
              <li v-for="b in depth" :key="b.band"><div class="an-rowtxt"><code>{{ b.label }}</code><b>{{ num(b.n) }} <i>· {{ b.p }}%</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: b.w + '%' }" /></span></li>
            </ol>
          </section>
        </div>

        <div class="an-two">
          <!-- what they read next -->
          <section class="an-card">
            <div class="an-ch"><h2>{{ PW.next }}</h2><p>{{ PW['next-subtitle'] }}</p></div>
            <ol class="an-list an-list-titles">
              <li v-for="r in bars(data.next, 'n')" :key="r.kind + r.id"><div class="an-rowtxt"><button type="button" class="an-piecebtn" @click="emit('open', { kind: r.kind, id: r.id })">{{ r.title || r.id }}</button><b>{{ num(r.n) }} <i>· {{ pct(r.n, now.views) }}%</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            <p v-if="!(data.next || []).length" class="an-none">{{ PW['none-next'] }}</p>
          </section>
          <!-- what it led to -->
          <section class="an-card">
            <div class="an-ch"><h2>{{ PW['led-to'] }}</h2><p>{{ PW['led-to-subtitle'] }}</p></div>
            <div class="an-stats">
              <div><span class="an-k">{{ PW.signups }}</span><b>{{ num(led.signups) }}</b></div>
              <div><span class="an-k">{{ PW.subscriptions }}</span><b>{{ num(led.subscriptions) }}</b></div>
              <div><span class="an-k">{{ PW.purchases }}</span><b>{{ num(led.purchases) }}</b></div>
              <div><span class="an-k">{{ PW.revenue }}</span><b>{{ money(led.revenue, data.currency) }}</b></div>
            </div>
            <template v-if="ledTotal">
              <h3 class="an-sub">{{ PW['by-channel'] }}</h3>
              <ol class="an-list an-list-tight">
                <li v-for="r in bars(led.by_channel, 'n')" :key="r.channel"><div class="an-rowtxt"><span><i class="an-chdot" :data-channel="r.channel" />{{ channelName(r.channel) }}</span><b>{{ num(r.n) }}</b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
              </ol>
            </template>
            <p v-else class="an-none">{{ PW['none-led'] }}</p>
          </section>
        </div>
      </template>
    </template>
  </div>
</template>

<style>
.an-bands li .an-rowtxt code { font-size: 11.5px }
</style>

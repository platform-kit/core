<script setup>
/*
 * The Analytics & KPI dashboard — the one admin surface that ships to
 * production (a lazy chunk; echarts loads only here). Two views over the same
 * window, as tabs — Overview (visitors, views, sessions, bounce, length; the goals with their rates; the traffic),
 * Acquisition (the channels and the referrers under them, campaigns, where they land and leave), Audience (new and
 * returning, devices, browsers, systems, time zones, languages, who, the hours), Content (and the diagnostic),
 * Commerce (the store, the membership as a business, the ads), Experiments, Explore — one at a time, remembered per
 * browser; an audience filter — everyone, guests, signed in, members — on every number; right now in the head;
 * every number with the previous window beside it for the delta, and the explore tab putting any metrics
 * on one chart over time. Reads admin_kpis() and admin_series(), both of which
 * refuse anyone who isn't an admin. Copy lives in content/app/ui/analytics.md.
 */
import { moduleOn } from 'platformkit/lib/modules.js'
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import VChart from 'vue-echarts'
import { base, tokens, PALETTE, chartKind, timeSeries, timeAxis } from '../lib/charts-theme.js'
import ChartKind from './ChartKind.vue'
import FilterChips from './FilterChips.vue'
import { useFilters } from '../lib/analytics-filters.js'
import { events as SITE_EVENTS, sources as SITE_SOURCES } from '#site/analytics'
import './analytics.css'
import { us } from 'platformkit/lib/content.js'
import { supabase, configured } from 'platformkit/lib/supabase.js'
import { isSignedIn } from 'platformkit/lib/auth.js'
import { experiments as EXPERIMENTS, products as PRODUCTS } from '#content'
import { statusOf, endsAt } from 'platformkit/lib/experiments.js'
import { TYPEN } from '#site/instrument'   /* the site's vocabulary for a reading, or the kit's empty default */
import { modules } from '#site'
import AdminHead from './admin/AdminHead.vue'
import UsageAdmin from './UsageAdmin.vue'
/* what the site has on decides what the dashboard reports: no store, no store card; no instrument, no diagnostic */
const STORE_ON = moduleOn('store'), MEMBERS_ON = moduleOn('memberships'), INSTRUMENT_ON = moduleOn('instrument')

const T = us('analytics')
const H = T.page.head
const K = T.cards.kpi
const S = T.sections.heads
const EX = T.experiments.ui
const XP = T.explore.ui
const TN = T.tests.names
/* metric ids carry underscores; the strings file keys them with hyphens */
const MN = new Proxy(T.metrics.names, { get: (o, k) => { const key = String(k); const reg = (SITE_EVENTS || []).find((e) => e.key === key); return reg ? reg.label : o[key.replace(/_/g, '-')] } })
const METRICS = [...(SITE_EVENTS || []).map((e) => e.key), 'visitors', 'pageviews', 'sessions', 'users', 'content_views', 'cta_impressions', 'cta_clicks', 'add_to_cart', 'checkouts', 'exposures', 'signups', 'purchases', 'revenue', 'rounds', 'answers', 'new_members']

/* ---- state ---- */
const days = ref(30)
/* the audience filter: everyone, guests, signed in, members — on every number of the page */
const AUD = ['all', 'guest', 'user', 'member']
const audience = ref('all')
/* the chips and the source (analytics-filters.js — in the address, shared by the three pages); the site's own events */
const FW = T.page.filters || {}
const { filters, toggle: toggleFilter, set: setFilter, has, forRead } = useFilters(FW)
const GOALS = (SITE_EVENTS || []).filter((e) => e.goal)
const EVENT_LABEL = Object.fromEntries((SITE_EVENTS || []).map((e) => [e.key, e.label]))
const eventLabel = (k) => EVENT_LABEL[k] || k
const EV = T.events ? T.events.ui : {}
const events = ref(null)
const openEvent = ref('')
const retention = ref(null)
/* the tabs: overview · acquisition · audience · content · commerce · experiments · explore, one at a time, remembered per browser */
const TB = T.page.tabs || {}
const AQ = T.acquisition ? T.acquisition.ui : {}
const AU = T.audience ? T.audience.ui : {}
const TAB_KEY = 'dl.analytics.tab'
const tab = ref((() => { try { return localStorage.getItem(TAB_KEY) || 'overview' } catch (e) { return 'overview' } })())
watch(tab, (v) => { try { localStorage.setItem(TAB_KEY, v) } catch (e) { /* private mode */ } })
const tabs = computed(() => [
  { key: 'overview', label: TB.overview }, { key: 'acquisition', label: TB.acquisition }, { key: 'audience', label: TB.audience }, { key: 'content', label: INSTRUMENT_ON ? TB.content : TB['content-only'] },
  { key: 'commerce', label: TB.commerce }, { key: 'usage', label: TB.usage }, { key: 'events', label: TB.events }, { key: 'experiments', label: TB.experiments }, { key: 'explore', label: TB.explore },
])
watch(tabs, (list) => { if (!list.some((t) => t.key === tab.value)) tab.value = 'overview' })
const state = ref('idle')      /* idle | loading | ok | denied | error */
const data = ref(null)
const members = ref(null)
const now = ref(null)
const series = ref([])         /* the window, one row per day */
const seriesPrev = ref([])     /* the window before it, same length */
const tzHere = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch (e) { return 'UTC' } })()

async function load() {
  if (!configured || !isSignedIn.value) { state.value = 'idle'; data.value = null; return }
  state.value = 'loading'
  const goals = GOALS.map((g) => ({ key: g.key, label: g.label, value: g.value || null }))
  const [k, s, m, r, e] = await Promise.all([
    supabase.rpc('admin_kpis', { days: days.value, audience: audience.value, tz: tzHere, filters: forRead.value, goals }),
    supabase.rpc('admin_series', { days: days.value * 2, audience: audience.value, filters: forRead.value, goals: (SITE_EVENTS || []).map((g) => ({ key: g.key })) }),
    MEMBERS_ON ? supabase.rpc('admin_members', { days: days.value }) : Promise.resolve({ data: null, error: null }),
    supabase.rpc('admin_retention', { weeks: 8, audience: audience.value, filters: forRead.value }),
    supabase.rpc('admin_events', { days: days.value, audience: audience.value, filters: forRead.value, event: openEvent.value || null }),
  ])
  const err = k.error || s.error || m.error || r.error || e.error
  if (err) { state.value = (err.code === '42501' || /admin only|permission/i.test(err.message || '')) ? 'denied' : 'error'; return }
  data.value = k.data
  members.value = m.data
  retention.value = r.data || []
  events.value = e.data || null
  const all = s.data || []
  series.value = all.slice(-days.value)
  seriesPrev.value = all.slice(0, all.length - days.value)
  state.value = 'ok'
  loadNow()
}
/* right now: asked on load and every minute while the tab is visible */
async function loadNow() { if (!configured || !isSignedIn.value) return; const { data: n } = await supabase.rpc('admin_now'); if (n) now.value = n }
let nowTimer = null
onMounted(() => { nowTimer = setInterval(() => { if (document.visibilityState !== 'hidden' && state.value === 'ok') loadNow() }, 60000) })
onBeforeUnmount(() => clearInterval(nowTimer))
onMounted(load)
watch([isSignedIn, days, audience, () => JSON.stringify(forRead.value)], load)
/* one event opened on the Events tab: its series, channels and values */
async function openTheEvent(type) { openEvent.value = openEvent.value === type ? '' : type; if (!openEvent.value) return; const { data: e } = await supabase.rpc('admin_events', { days: days.value, audience: audience.value, filters: forRead.value, event: openEvent.value }); if (e) events.value = e }

/* ---- helpers ---- */
const num = (n) => new Intl.NumberFormat().format(Math.round(n || 0))
const money = (n, cur) => new Intl.NumberFormat(undefined, { style: 'currency', currency: (cur || 'usd').toUpperCase(), maximumFractionDigits: 0 }).format((n || 0) / 100)
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const pct1 = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0)
const per100 = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0)
const secs = (s) => (s >= 60 ? Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's' : Math.round(s || 0) + 's')
/* a top product arrives as its sku — the offer's own slug; the product file names it */
const offerName = (sku) => { const o = PRODUCTS.find((x) => x.sku === sku); return o ? o.title : sku }
/* a day arrives as a date, or a timestamp at midnight: the first ten characters are the date either way */
const dayKey = (d) => String(d || '').slice(0, 10)
const day = (d) => { const t = new Date(dayKey(d) + 'T00:00:00'); return isNaN(t) ? '' : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
const rangeLabel = computed(() => H.range.replace('{days}', days.value))
const audienceLine = computed(() => (audience.value === 'all' ? '' : String(H['audience-line'] || '').replace('{audience}', H['audience-' + audience.value] || audience.value)))
const totals = computed(() => (data.value && data.value.totals) || {})
const prev = computed(() => (data.value && data.value.prev) || {})
const goals = computed(() => (data.value && data.value.goals) || {})
const rev = computed(() => (data.value && data.value.revenue) || { purchases: 0, total: 0, currency: 'usd', aov: 0 })
const mem = computed(() => (data.value && data.value.membership) || { active: 0, mrr: 0, new: 0, churned: 0, ending: 0 })
const diag = computed(() => (data.value && data.value.diagnostic) || { rounds: 0, answers: 0, readers: 0 })
const aud = computed(() => (data.value && data.value.audience) || {})
const cur = computed(() => rev.value.currency)
const delta = (now, before) => {
  if (!before) return null   /* nothing to compare with yet */
  const d = Math.round(((now - before) / before) * 100)
  return { dir: d > 0 ? 'up' : d < 0 ? 'down' : 'flat', text: (d > 0 ? '+' : '') + d + '%' }
}
/* a delta where lower is better (bounce): the colour follows the meaning */
const deltaDown = (now, before) => { const d = delta(now, before); return d ? { ...d, dir: d.dir === 'up' ? 'down' : d.dir === 'down' ? 'up' : 'flat' } : null }
const hasAny = computed(() => (totals.value.pageviews || 0) + (totals.value.content_views || 0) + (diag.value.answers || 0) + (rev.value.purchases || 0) > 0)
const channelName = (c) => AQ['channel-' + c] || c
const wordOf = (prefix, k) => AU[prefix + '-' + k] || k

/* the headline: visitors, views, sessions, views per visit, bounce, session length — each against the window before */
const bounceNow = computed(() => pct(totals.value.bounce_sessions, totals.value.sessions))
const bouncePrev = computed(() => pct(prev.value.bounce_sessions, prev.value.sessions))
const tiles = computed(() => [
  { label: K.visitors, value: num(totals.value.visitors), d: delta(totals.value.visitors, prev.value.visitors), spark: 'visitors' },
  { label: K.pageviews, value: num(totals.value.pageviews), d: delta(totals.value.pageviews, prev.value.pageviews), spark: 'pageviews' },
  { label: K.sessions, value: num(totals.value.sessions), d: delta(totals.value.sessions, prev.value.sessions), spark: 'sessions' },
  { label: K['views-per-visit'], value: String(totals.value.views_per_visit || 0), d: delta(totals.value.views_per_visit, prev.value.views_per_visit) },
  { label: K.bounce, value: bounceNow.value + '%', d: deltaDown(bounceNow.value, bouncePrev.value) },
  { label: K['session-length'], value: secs(totals.value.avg_session_seconds), d: delta(totals.value.avg_session_seconds, prev.value.avg_session_seconds) },
])
/* the goals: a count, its rate per hundred visitors, against the window before; only the goals the site can have */
const goalRows = computed(() => {
  const g = goals.value, v = totals.value.visitors || 0, pv = prev.value.visitors || 0
  const row = (key, label, spark) => { const x = g[key] || { n: 0, prev: 0, credited: 0 }; return { key, label, n: x.n, prev: x.prev, credited: x.credited, rate: per100(x.n, v), prevRate: per100(x.prev, pv), d: delta(x.n, x.prev), spark } }
  const custom = (g.custom || []).map((c) => { const reg = GOALS.find((x) => x.key === c.key); return { key: c.key, label: reg ? reg.label : c.key, n: c.n, prev: c.prev, credited: c.n, rate: per100(c.n, v), prevRate: per100(c.prev, pv), d: delta(c.n, c.prev), spark: c.key, value: reg && reg.value ? c.value : null } })
  return [row('signups', K['goal-signups'], 'signups'), ...(STORE_ON ? [row('purchases', K['goal-purchases'], 'purchases')] : []), ...(MEMBERS_ON ? [row('subscriptions', K['goal-subscriptions'], 'new_members')] : []), ...custom]
})
/* a spark only when the days have a shape; a flat line at zero says nothing */
const sparkOn = (key) => series.value.some((r) => (r[key] || 0) > 0)
const sparkPath = (key) => {
  const rows = series.value
  if (rows.length < 2) return ''
  const max = Math.max(1, ...rows.map((r) => r[key] || 0))
  return rows.map((r, i) => `${(i / (rows.length - 1)) * 100},${30 - ((r[key] || 0) / max) * 26 - 2}`).join(' ')
}

/* bars for the lists */
const bars = (list, key) => {
  const rows = list || []
  const max = Math.max(1, ...rows.map((x) => x[key] || 0))
  return rows.map((x) => ({ ...x, w: ((x[key] || 0) / max) * 100 }))
}
const typeName = (n) => TYPEN[n] || String(n)
const sum = (rows, k) => rows.reduce((n, r) => n + (r[k] || 0), 0)

/* ---- acquisition ---- */
const channels = computed(() => bars((data.value && data.value.channels) || [], 'visitors').map((c) => ({ ...c, bounce: pct(c.bounces, c.sessions), rate: per100(c.signups, c.visitors), d: delta(c.visitors, c.prev_visitors) })))
const openChannel = ref('')
const refsOf = (channel) => bars(((data.value && data.value.referrers) || []).filter((r) => r.channel === channel), 'sessions')
const campaigns = computed(() => bars((data.value && data.value.campaigns) || [], 'visitors'))
const entryRows = computed(() => bars(pub(data.value && data.value.entry_pages), 'sessions').map((r) => ({ ...r, bounce: pct(r.bounces, r.sessions) })))
const exitRows = computed(() => bars(pub(data.value && data.value.exit_pages), 'sessions'))

/* ---- audience ---- */
const facet = (key, prefix) => bars(((aud.value[key]) || []).map((r) => ({ ...r, label: prefix ? wordOf(prefix, r.key) : r.key })), 'n')
const who = computed(() => { const w = aud.value.who || {}; return bars([{ key: 'guest', label: AU['who-guest'], n: w.guest || 0 }, { key: 'user', label: AU['who-user'], n: w.user || 0 }, { key: 'member', label: AU['who-member'], n: w.member || 0 }], 'n') })
const newShare = computed(() => pct(aud.value.new, (aud.value.new || 0) + (aud.value.returning || 0)))
const countryName = (() => { try { const dn = new Intl.DisplayNames(undefined, { type: 'region' }); return (c) => (c === 'unknown' ? AU['os-unknown'] || 'Unknown' : (() => { try { return dn.of(c) } catch (e) { return c } })()) } catch (e) { return (c) => c } })()
const countries = computed(() => bars(((aud.value.countries) || []).map((r) => ({ ...r, label: countryName(r.key) })), 'n'))
/* the retention grid: a row per week, the cohort's size, then the share back in each later week */
const cohorts = computed(() => (retention.value || []).map((r) => ({ ...r, label: new Date(r.week + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) })))
const cohortWeeks = computed(() => Math.max(0, ...cohorts.value.map((r) => (r.back || []).length)))
/* the events tab: every name sent, the registered ones by their label and first */
const eventRows = computed(() => { const list = ((events.value && events.value.events) || []).map((e) => ({ ...e, label: eventLabel(e.type), registered: !!EVENT_LABEL[e.type], goal: GOALS.some((g) => g.key === e.type), perSession: events.value.sessions ? Math.round((e.n / events.value.sessions) * 100) / 100 : 0, d: delta(e.n, e.prev) })); const max = Math.max(1, ...list.map((e) => e.n)); return list.sort((a, b) => (b.registered - a.registered) || (b.n - a.n)).map((e) => ({ ...e, w: (e.n / max) * 100 })) })
const one = computed(() => (events.value && events.value.one) || null)
const oneOption = computed(() => { void chartKey.value; void chartKind.value; const b = base(), t = tokens(), rows = (one.value && one.value.series) || []; return { ...b, xAxis: timeAxis({ ...b.xAxis, data: rows.map((r) => day(r.day)) }), yAxis: { ...b.yAxis, minInterval: 1 }, series: [timeSeries({ name: EV.count, color: t.accent, area: true, data: rows.map((r) => r.n) }), timeSeries({ name: EV.people, color: PALETTE[1], data: rows.map((r) => r.people) })] } })
/* the hours: a 7 × 24 grid, the rows the days of the week from Monday, each cell its share of the busiest hour */
const DOW = (() => { const b = new Date(2024, 0, 1); return [1, 2, 3, 4, 5, 6, 0].map((d) => { const t = new Date(b); t.setDate(b.getDate() + ((d - 1 + 7) % 7)); return { d, label: t.toLocaleDateString(undefined, { weekday: 'short' }) } }) })()
const hours = computed(() => {
  const cells = {}; let max = 0
  for (const [dow, hr, n] of aud.value.hours || []) { cells[dow + ':' + hr] = n; max = Math.max(max, n) }
  return { max, rows: DOW.map((w) => ({ ...w, cells: Array.from({ length: 24 }, (_, h) => ({ h, n: cells[w.d + ':' + h] || 0, a: max ? (cells[w.d + ':' + h] || 0) / max : 0 })) })) }
})
const hourLabel = (h) => (h % 6 === 0 ? String(h).padStart(2, '0') : '')

/* ---- the membership as a business ---- */
const mm = computed(() => members.value || null)
const membersSeries = computed(() => { const rows = (mm.value && mm.value.series) || []; let acc = (mm.value && mm.value.members) || 0; const back = rows.slice().reverse().map((r) => { const at = acc; acc -= (r.joined || 0) - (r.lapsed || 0); return { day: r.day, members: at, joined: r.joined, lapsed: r.lapsed } }); return back.reverse() })
const membersOption = computed(() => {
  void chartKey.value; void chartKind.value
  const b = base(), t = tokens(), rows = membersSeries.value
  return { ...b, xAxis: timeAxis({ ...b.xAxis, data: rows.map((r) => day(r.day)) }), yAxis: { ...b.yAxis, minInterval: 1 }, series: [
    timeSeries({ name: K.members, color: t.accent, area: true, data: rows.map((r) => r.members) }),
    timeSeries({ name: K.joined, color: PALETTE[3], data: rows.map((r) => r.joined) }),
    timeSeries({ name: K.lapsed, color: PALETTE[4], data: rows.map((r) => r.lapsed) }),
  ] }
})

/* ---- charts ---- */
const chartKey = ref(0)
onMounted(() => { const mo = new MutationObserver(() => chartKey.value++); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }) })
const trafficOption = computed(() => {
  void chartKey.value; void chartKind.value   /* re-read the theme's tokens when it flips, redraw when the kind does */
  const b = base(), t = tokens()
  const x = series.value.map((r) => day(r.day))
  const line = (name, key, color, area) => timeSeries({ name, color, area, data: series.value.map((r) => r[key] || 0) })
  return { ...b, xAxis: timeAxis({ ...b.xAxis, data: x }), series: [line(MN.visitors, 'visitors', t.accent, true), line(MN.pageviews, 'pageviews', PALETTE[1]), line(MN.sessions, 'sessions', PALETTE[2])] }
})
const typesOption = computed(() => {
  void chartKey.value
  const b = base(), t = tokens()
  const rows = ((data.value && data.value.types) || []).slice().reverse()
  return { ...b, grid: { left: 8, right: 30, top: 8, bottom: 8, containLabel: true }, tooltip: { ...b.tooltip, trigger: 'item' }, legend: { show: false },
    xAxis: { ...b.yAxis, type: 'value', minInterval: 1 }, yAxis: { ...b.xAxis, type: 'category', data: rows.map((r) => typeName(r.type)), boundaryGap: true },
    series: [{ type: 'bar', data: rows.map((r) => r.readers), barMaxWidth: 16, itemStyle: { color: t.accent, borderRadius: [0, 6, 6, 0] }, label: { show: true, position: 'right', color: t.ink2, fontFamily: t.mono, fontSize: 11 } }] }
})

/* experiments: rate, leader, lift — and status, dates and the declared winner
   from the experiment's own record (content/experiments) when it still exists */
const experiments = computed(() => ((data.value && data.value.experiments) || []).map((e) => {
  const rec = (EXPERIMENTS || []).find((x) => x.id === e.experiment) || null
  const vs = (e.variants || []).map((v) => ({ ...v, rate: v.exposures ? v.conversions / v.exposures : 0 }))
  const leader = vs.slice().sort((a, b) => b.rate - a.rate)[0] || null
  const others = vs.filter((v) => v !== leader)
  const baseRate = others.length ? Math.max(...others.map((v) => v.rate)) : 0
  const lift = leader && baseRate ? Math.round(((leader.rate - baseRate) / baseRate) * 100) : null
  const started = e.started_at ? new Date(e.started_at) : null
  const endsMs = rec ? endsAt(rec, e) : (started ? started.getTime() + 14 * 86400000 : null)
  const ends = endsMs ? new Date(endsMs) : null
  const status = rec ? statusOf(rec, e) : (ends && Date.now() > ends.getTime() ? 'ended' : 'running')
  const winner = rec && rec.winner ? rec.winner : (status === 'ended' && leader ? leader.variant : '')
  return { ...e, title: rec ? rec.title : e.experiment, kind: rec ? rec.kind : 'page', variants: vs, leader, lift, started, ends,
    status, ended: status === 'ended', winner, maxRate: Math.max(0.0001, ...vs.map((v) => v.rate)) }
}))
const fmtDate = (d) => (d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—')

/* ---- explore ---- */
const picked = ref(['pageviews', 'sessions'])
const gran = ref('day')
const smooth = ref(true)
const cumulative = ref(false)
const compare = ref(false)
function toggleMetric(k) { picked.value = picked.value.includes(k) ? picked.value.filter((x) => x !== k) : picked.value.concat(k) }
/* by week: sum each metric over Monday-to-Sunday buckets */
function bucket(rows) {
  if (gran.value === 'day') return rows
  const out = [], byKey = {}
  for (const r of rows) {
    const d = new Date(dayKey(r.day) + 'T00:00:00'); if (isNaN(d)) continue
    const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    const k = mon.toISOString().slice(0, 10)
    if (!byKey[k]) { byKey[k] = { day: k }; out.push(byKey[k]) }
    for (const m of METRICS) byKey[k][m] = (byKey[k][m] || 0) + (r[m] || 0)
  }
  return out
}
const shaped = computed(() => bucket(series.value))
const shapedPrev = computed(() => bucket(seriesPrev.value))
const values = (rows, k) => {
  let acc = 0
  return rows.map((r) => { const v = k === 'revenue' ? (r[k] || 0) / 100 : (r[k] || 0); acc += v; return cumulative.value ? acc : v })
}
const exploreOption = computed(() => {
  void chartKey.value; void chartKind.value
  const b = base(), t = tokens()
  const rows = shaped.value
  const x = rows.map((r) => day(r.day))
  const out = []
  picked.value.forEach((k, i) => {
    const color = PALETTE[i % PALETTE.length]
    out.push(timeSeries({ name: MN[k], color, smooth: smooth.value, symbol: rows.length > 60 ? 'none' : 'circle', area: picked.value.length === 1, data: values(rows, k) }))
    if (compare.value) out.push(timeSeries({ name: MN[k] + ' · ' + XP.previous, color, smooth: smooth.value, reference: true, data: values(shapedPrev.value, k) }))
  })
  return { ...b, grid: { left: 8, right: 16, top: 34, bottom: 56, containLabel: true }, xAxis: timeAxis({ ...b.xAxis, data: x }),
    yAxis: { ...b.yAxis, minInterval: picked.value.includes('revenue') ? undefined : 1 },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8, borderColor: t.hair, backgroundColor: 'transparent', fillerColor: t.hair, handleStyle: { color: t.paper, borderColor: t.ink3 }, textStyle: { color: t.ink3 } }],
    series: out }
})
function exportCsv() {
  const rows = shaped.value
  const cols = ['day'].concat(picked.value)
  const csv = [cols.join(',')].concat(rows.map((r) => cols.map((c) => (c === 'day' ? dayKey(r.day) : c === 'revenue' ? (r[c] || 0) / 100 : r[c] || 0)).join(','))).join('\n')
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `the site-${days.value}d.csv`; a.click()
}
/* lists: the admin's own routes are never audience; long lists show eight rows
   and open on request */
const open = reactive({})
const PRIVATE = /^\/(admin|__preview)(\/|$)/
const pub = (rows, key = 'path') => (rows || []).filter((r) => !PRIVATE.test(r[key] || ''))
function L(name, arr, key, cap = 8) { const all = bars(arr || [], key); return { rows: open[name] ? all : all.slice(0, cap), more: all.length > cap, open: !!open[name], total: all.length } }
const toggle = (name) => { open[name] = !open[name] }
function openAuth() { if (window.DLauth) window.DLauth.open() }
</script>

<template>
  <div class="ui-page an">
    <AdminHead :title="H.title" :sub="H.subtitle">
      <template #afterTitle><span v-if="state === 'ok' && now" class="an-now" :class="{ some: now.visitors }"><i />{{ now.visitors ? H.now.replace('{n}', num(now.visitors)) : H['now-none'] }}</span></template>
      <template #actions>
        <div v-if="state === 'ok'" class="an-controls">
          <div class="an-seg an-audience" role="group">
            <button v-for="a in AUD" :key="a" type="button" :class="{ on: audience === a }" @click="audience = a">{{ H['audience-' + a] }}</button>
          </div>
          <label v-if="SITE_SOURCES.length" class="an-source"><span>{{ FW.source }}</span><select :value="filters.source || ''" @change="setFilter('source', $event.target.value || null)"><option value="">{{ FW['this-site'] }}</option><option v-for="src in SITE_SOURCES" :key="src.name" :value="src.name">{{ src.name }}</option></select></label>
          <ChartKind />
          <div class="an-seg">
            <button v-for="d in [7, 30, 90, 365]" :key="d" type="button" :class="{ on: days === d }" @click="days = d">{{ d }}d</button>
            <button type="button" class="an-refresh" @click="load">{{ H.refresh }}</button>
          </div>
        </div>
      </template>
    </AdminHead>

    <!-- states -->
    <div v-if="state === 'idle'" class="an-note">
      <h2>{{ H['signin-heading'] }}</h2><p>{{ H['signin-subtitle'] }}</p>
      <button type="button" class="an-cta" @click="openAuth">{{ H['signin-cta'] }}</button>
    </div>
    <div v-else-if="state === 'denied'" class="an-note"><h2>{{ H['denied-heading'] }}</h2><p>{{ H['denied-subtitle'] }}</p></div>
    <div v-else-if="state === 'error'" class="an-note"><h2>{{ H['error-heading'] }}</h2><p>{{ H['error-subtitle'] }}</p></div>
    <p v-else-if="state === 'loading'" class="an-loading">{{ H.loading }}</p>

    <!-- ============================== THE TABS: one view at a time ============================== -->
    <template v-else-if="state === 'ok'">
      <div class="an-tabs" role="tablist">
        <button v-for="t in tabs" :key="t.key" type="button" role="tab" :class="{ on: tab === t.key }" :aria-selected="tab === t.key" @click="tab = t.key">{{ t.label }}</button>
      </div>
      <div v-if="tab !== 'explore'" class="an-range"><span class="an-rangelabel">{{ rangeLabel }}</span><span class="an-vs">{{ H['vs-previous'].replace('{days}', days) }}<template v-if="audienceLine"> · <b class="an-audline">{{ audienceLine }}</b></template><template v-if="filters.source"> · <b class="an-audline">{{ filters.source }}</b></template></span></div>
      <FilterChips />

      <!-- ============ overview: the headline, the goals, the traffic ============ -->
      <template v-if="tab === 'overview'">
        <div class="an-panel" :data-n="tiles.length">
          <div v-for="t in tiles" :key="t.label" class="an-cell">
            <span class="an-k">{{ t.label }}</span>
            <div class="an-cellrow">
              <b>{{ t.value }}</b>
              <svg v-if="t.spark && sparkOn(t.spark)" class="an-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
                <polyline :points="sparkPath(t.spark)" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
              </svg>
            </div>
            <span class="an-delta" :class="t.d ? t.d.dir : 'none'">{{ t.d ? t.d.text + ' ' + H['vs-short'] : H['no-previous'] }}</span>
          </div>
        </div>

        <p v-if="!hasAny" class="an-empty">{{ H.empty }}</p>
        <template v-else>
          <!-- the goals -->
          <section class="an-card">
            <div class="an-ch"><h2>{{ K.goals }}</h2><p>{{ K['goals-subtitle'] }}</p></div>
            <div class="an-goals" :data-n="goalRows.length">
              <div v-for="g in goalRows" :key="g.key" class="an-goal">
                <span class="an-k">{{ g.label }}</span>
                <div class="an-goalrow"><b>{{ num(g.n) }}</b><span class="an-goalrate"><b>{{ g.rate }}</b><i>{{ K['goal-rate'] }}</i></span>
                  <svg v-if="g.spark && sparkOn(g.spark)" class="an-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline :points="sparkPath(g.spark)" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" /></svg></div>
                <span class="an-delta" :class="g.d ? g.d.dir : 'none'">{{ g.d ? g.d.text + ' ' + H['vs-short'] : H['no-previous'] }}<template v-if="g.credited < g.n"> · {{ K['goal-credited'].replace('{n}', num(g.credited)) }}</template><template v-if="g.value != null"> · {{ K['goal-value'] }} {{ num(g.value) }}</template></span>
              </div>
            </div>
          </section>

          <!-- traffic -->
          <section class="an-card">
            <div class="an-ch"><h2>{{ S.traffic }}</h2><p>{{ S['traffic-subtitle'] }}</p></div>
            <VChart :key="'traffic' + chartKey" class="an-chart" :option="trafficOption" autoresize />
            <div class="an-quality">
              <div><span class="an-k">{{ K['pages-per-session'] }}</span><b>{{ totals.pages_per_session || 0 }}</b></div>
              <div><span class="an-k">{{ K.users }}</span><b>{{ num(totals.users) }}</b></div>
              <div><span class="an-k">{{ K.content }}</span><b>{{ num(totals.content_views) }}</b></div>
              <div><span class="an-k">{{ K['new-visitors'] }}</span><b>{{ num(totals.new_sessions) }}</b></div>
              <div><span class="an-k">{{ K.returning }}</span><b>{{ num(totals.returning_sessions) }}</b></div>
            </div>
          </section>
        </template>
      </template>

      <!-- ============ acquisition: the channels, the referrers under them, campaigns, entry and exit ============ -->
      <template v-else-if="tab === 'acquisition'">
        <section class="an-card">
          <div class="an-ch"><h2>{{ AQ.channels }}</h2><p>{{ AQ.subtitle }} · {{ FW['click-help'] }}</p></div>
          <p v-if="!channels.length" class="an-none">{{ AQ['no-rows'] }}</p>
          <table v-else class="an-table an-channels">
            <thead><tr><th>{{ AQ.channel }}</th><th class="an-td-num">{{ AQ.visitors }}</th><th class="an-td-num">{{ AQ.sessions }}</th><th class="an-td-num">{{ AQ.bounce }}</th><th class="an-td-num">{{ AQ.length }}</th><th class="an-td-num">{{ AQ.signups }}</th><th class="an-td-num" :title="AQ['rate-help']">{{ AQ.rate }}</th><th v-if="STORE_ON" class="an-td-num">{{ AQ.revenue }}</th><th v-for="g in GOALS" :key="g.key" class="an-td-num an-td-goal">{{ g.label }}</th><th></th></tr></thead>
            <tbody>
              <template v-for="c in channels" :key="c.channel">
                <tr class="an-chrow" :class="{ open: openChannel === c.channel, on: has('channel', c.channel) }" @click="openChannel = openChannel === c.channel ? '' : c.channel">
                  <td class="an-td-title"><button type="button" class="an-chname an-rowbtn" :aria-pressed="has('channel', c.channel)" @click.stop="toggleFilter('channel', c.channel)"><i class="an-chdot" :data-channel="c.channel" />{{ channelName(c.channel) }}</button><span class="an-track"><span class="an-fill" :style="{ width: c.w + '%' }" /></span></td>
                  <td class="an-td-num"><b>{{ num(c.visitors) }}</b><span v-if="c.d" class="an-delta" :class="c.d.dir">{{ c.d.text }}</span></td>
                  <td class="an-td-num">{{ num(c.sessions) }}</td><td class="an-td-num">{{ c.bounce }}%</td><td class="an-td-num">{{ secs(c.avg_seconds) }}</td>
                  <td class="an-td-num">{{ num(c.signups) }}</td><td class="an-td-num"><b>{{ c.rate }}</b></td><td v-if="STORE_ON" class="an-td-num">{{ money(c.revenue, cur) }}</td><td v-for="g in GOALS" :key="g.key" class="an-td-num an-td-goal">{{ num((c.custom || {})[g.key] || 0) }}</td>
                  <td class="an-td-open">{{ openChannel === c.channel ? '−' : '+' }}</td>
                </tr>
                <tr v-if="openChannel === c.channel" class="an-chrefs"><td :colspan="(STORE_ON ? 9 : 8) + GOALS.length">
                  <ol class="an-list an-list-tight">
                    <li v-for="r in refsOf(c.channel)" :key="r.ref" :class="{ on: has('ref', r.ref) }"><div class="an-rowtxt"><button type="button" class="an-rowbtn" :aria-pressed="has('ref', r.ref)" @click="toggleFilter('ref', r.ref === '(direct)' ? '' : r.ref)"><code>{{ r.ref }}</code></button><b>{{ num(r.visitors) }} <i>{{ AQ.visitors.toLowerCase() }}</i> · {{ num(r.sessions) }} <i>{{ AQ.sessions.toLowerCase() }}</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
                  </ol>
                  <p v-if="!refsOf(c.channel).length" class="an-none">{{ AQ['no-rows'] }}</p>
                </td></tr>
              </template>
            </tbody>
          </table>
        </section>

        <div class="an-grid3">
          <section class="an-card">
            <div class="an-ch"><h2>{{ AQ.campaigns }}</h2><p>{{ AQ['campaigns-subtitle'] }}</p></div>
            <ol v-if="campaigns.length" class="an-list">
              <li v-for="c in campaigns" :key="c.source + c.medium + c.campaign" :class="{ on: has('campaign', c.campaign) }"><div class="an-rowtxt stack"><span><button type="button" class="an-rowbtn" :aria-pressed="has('campaign', c.campaign)" @click="toggleFilter('campaign', c.campaign)"><b>{{ c.campaign || '—' }}</b></button> <small class="an-muted">{{ c.source }} · {{ c.medium }}</small></span><b>{{ num(c.visitors) }} <i>{{ AQ.visitors.toLowerCase() }}</i> · {{ num(c.signups) }} <i>{{ AQ.signups.toLowerCase() }}</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: c.w + '%' }" /></span></li>
            </ol>
            <p v-else class="an-none">{{ AQ['no-campaigns'] }}</p>
          </section>
          <section class="an-card">
            <div class="an-ch"><h2>{{ AQ.entry }}</h2><p>{{ AQ['entry-subtitle'] }}</p></div>
            <ol class="an-list">
              <li v-for="r in L('entry', entryRows, 'sessions', 8).rows" :key="r.path" :class="{ on: has('entry', r.path) }"><div class="an-rowtxt stack"><button type="button" class="an-rowbtn" :aria-pressed="has('entry', r.path)" @click="toggleFilter('entry', r.path)"><code>{{ r.path }}</code></button><b>{{ num(r.sessions) }} <i>· {{ r.bounce }}% {{ AQ.bounces }} · {{ num(r.signups) }} {{ AQ.signups.toLowerCase() }}</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            <p v-if="!entryRows.length" class="an-none">{{ AQ['no-rows'] }}</p>
            <button v-if="L('entry', entryRows, 'sessions', 8).more" type="button" class="an-more" @click="toggle('entry')">{{ open.entry ? S['show-less'] : S['show-all'] + ' ' + entryRows.length }}</button>
          </section>
          <section class="an-card">
            <div class="an-ch"><h2>{{ AQ.exit }}</h2><p>{{ AQ['exit-subtitle'] }}</p></div>
            <ol class="an-list">
              <li v-for="r in L('exit', exitRows, 'sessions', 8).rows" :key="r.path"><div class="an-rowtxt stack"><code>{{ r.path }}</code><b>{{ num(r.sessions) }} <i>· {{ r.share }}% {{ AQ.share }}</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            <p v-if="!exitRows.length" class="an-none">{{ AQ['no-rows'] }}</p>
            <button v-if="L('exit', exitRows, 'sessions', 8).more" type="button" class="an-more" @click="toggle('exit')">{{ open.exit ? S['show-less'] : S['show-all'] + ' ' + exitRows.length }}</button>
          </section>
        </div>
      </template>

      <!-- ============ audience: who they are, as their browsers say it ============ -->
      <template v-else-if="tab === 'audience'">
        <section class="an-card">
          <div class="an-ch"><h2>{{ AU['new-returning'] }}</h2><p>{{ AU['new-help'] }}</p></div>
          <div class="an-split"><span class="an-splitfill" :style="{ width: newShare + '%' }" /></div>
          <div class="an-splitlegend"><span><i class="an-dot a" />{{ AU.new }} <b>{{ num(aud.new) }}</b> · {{ newShare }}%</span><span><i class="an-dot b" />{{ AU.returning }} <b>{{ num(aud.returning) }}</b> · {{ 100 - newShare }}%</span></div>
        </section>
        <div class="an-grid3">
          <section v-for="f in [{ key: 'devices', prefix: 'device', title: AU.devices }, { key: 'browsers', prefix: 'browser', title: AU.browsers }, { key: 'os', prefix: 'os', title: AU.systems }]" :key="f.key" class="an-card">
            <div class="an-ch"><h2>{{ f.title }}</h2></div>
            <ol class="an-list"><li v-for="r in facet(f.key, f.prefix)" :key="r.key" :class="{ on: has(f.prefix, r.key) }"><div class="an-rowtxt"><button type="button" class="an-rowbtn" :aria-pressed="has(f.prefix, r.key)" @click="toggleFilter(f.prefix, r.key)">{{ r.label }}</button><b>{{ num(r.n) }} <i>· {{ pct(r.n, totals.visitors) }}%</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li></ol>
            <p v-if="!facet(f.key, f.prefix).length" class="an-none">{{ AU['no-rows'] }}</p>
          </section>
          <section class="an-card">
            <div class="an-ch"><h2>{{ AU.countries }}</h2><p>{{ AU['countries-note'] }}</p></div>
            <ol class="an-list"><li v-for="r in countries" :key="r.key" :class="{ on: has('country', r.key) }"><div class="an-rowtxt"><button type="button" class="an-rowbtn" :aria-pressed="has('country', r.key)" @click="toggleFilter('country', r.key)">{{ r.label }}</button><b>{{ num(r.n) }} <i>· {{ pct(r.n, totals.visitors) }}%</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li></ol>
            <p v-if="!countries.length" class="an-none">{{ AU['no-rows'] }}</p>
          </section>
          <section class="an-card">
            <div class="an-ch"><h2>{{ AU.zones }}</h2><p>{{ AU['zones-note'] }}</p></div>
            <ol class="an-list"><li v-for="r in facet('zones')" :key="r.key"><div class="an-rowtxt"><code>{{ r.key }}</code><b>{{ num(r.n) }}</b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li></ol>
            <p v-if="!facet('zones').length" class="an-none">{{ AU['no-rows'] }}</p>
          </section>
          <section class="an-card">
            <div class="an-ch"><h2>{{ AU.languages }}</h2></div>
            <ol class="an-list"><li v-for="r in facet('langs')" :key="r.key" :class="{ on: has('lang', r.key) }"><div class="an-rowtxt"><button type="button" class="an-rowbtn" :aria-pressed="has('lang', r.key)" @click="toggleFilter('lang', r.key)"><code>{{ r.key }}</code></button><b>{{ num(r.n) }}</b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li></ol>
            <p v-if="!facet('langs').length" class="an-none">{{ AU['no-rows'] }}</p>
          </section>
          <section class="an-card">
            <div class="an-ch"><h2>{{ AU.who }}</h2></div>
            <ol class="an-list"><li v-for="r in who" :key="r.key"><div class="an-rowtxt"><span>{{ r.label }}</span><b>{{ num(r.n) }}</b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li></ol>
          </section>
        </div>
        <section class="an-card">
          <div class="an-ch"><h2>{{ AU.retention }}</h2><p>{{ AU['retention-subtitle'] }}</p></div>
          <p v-if="!cohorts.length" class="an-none">{{ AU['no-retention'] }}</p>
          <div v-else class="an-cohorts">
            <table class="an-table an-cohorttable"><thead><tr><th>{{ AU.cohort }}</th><th class="an-td-num">{{ AU.size }}</th><th v-for="n in cohortWeeks" :key="n" class="an-td-num">{{ AU.week.replace('{n}', n) }}</th></tr></thead>
              <tbody><tr v-for="r in cohorts" :key="r.week"><td class="an-td-title">{{ r.label }}</td><td class="an-td-num"><b>{{ num(r.size) }}</b></td><td v-for="n in cohortWeeks" :key="n" class="an-td-num an-cohortcell"><span v-if="(r.back || [])[n - 1] != null" class="an-cohortval" :class="{ hot: (r.back[n - 1] || 0) >= 55 }" :style="{ '--a': (r.back[n - 1] || 0) / 100 }">{{ r.back[n - 1] }}%</span></td></tr></tbody></table>
          </div>
        </section>
        <section class="an-card">
          <div class="an-ch"><h2>{{ AU.hours }}</h2><p>{{ AU['hours-subtitle'] }}</p></div>
          <div class="an-hours">
            <div class="an-heat">
              <div v-for="r in hours.rows" :key="r.d" class="an-heatrow"><span class="an-heatday">{{ r.label }}</span><span v-for="c in r.cells" :key="c.h" class="an-heatcell" :style="{ '--a': c.a }" :title="r.label + ' ' + String(c.h).padStart(2, '0') + ':00 · ' + num(c.n)" /></div>
              <div class="an-heatrow an-heataxis"><span class="an-heatday" /><span v-for="h in 24" :key="h" class="an-heath">{{ hourLabel(h - 1) }}</span></div>
            </div>
          </div>
        </section>
      </template>

      <!-- ============ content: the pages, the topics, and the diagnostic with the instrument on ============ -->
      <template v-else-if="tab === 'content'">
        <div class="an-grid3">
          <section class="an-card">
            <div class="an-ch"><h2>{{ S.top }}</h2></div>
            <ol class="an-list">
              <li v-for="r in L('top', pub(data.top_pages), 'views').rows" :key="r.path"><div class="an-rowtxt"><code>{{ r.path }}</code><b>{{ num(r.views) }} <i>{{ S.views }}</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            <p v-if="!pub(data.top_pages).length" class="an-none">{{ S['no-rows'] }}</p>
            <button v-if="L('top', pub(data.top_pages), 'views').more" type="button" class="an-more" @click="toggle('top')">{{ open.top ? S['show-less'] : S['show-all'] + ' ' + pub(data.top_pages).length }}</button>
          </section>
          <section class="an-card">
            <div class="an-ch"><h2>{{ S.engagement }}</h2></div>
            <ol class="an-list">
              <li v-for="r in L('eng', pub(data.engagement), 'avg_seconds').rows" :key="r.path"><div class="an-rowtxt"><code>{{ r.path }}</code><b>{{ secs(r.avg_seconds) }} <i>{{ S.seconds }}</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            <p v-if="!pub(data.engagement).length" class="an-none">{{ S['no-rows'] }}</p>
            <button v-if="L('eng', pub(data.engagement), 'avg_seconds').more" type="button" class="an-more" @click="toggle('eng')">{{ open.eng ? S['show-less'] : S['show-all'] + ' ' + pub(data.engagement).length }}</button>
          </section>
          <section class="an-card">
            <div class="an-ch"><h2>{{ S.topics }}</h2></div>
            <ol class="an-list">
              <li v-for="r in L('topics', data.topics, 'views').rows" :key="r.topic"><div class="an-rowtxt"><code>{{ r.topic }}</code><b>{{ num(r.views) }} <i>{{ S.views }}</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            <p v-if="!(data.topics || []).length" class="an-none">{{ S['no-rows'] }}</p>
            <button v-if="L('topics', data.topics, 'views').more" type="button" class="an-more" @click="toggle('topics')">{{ open.topics ? S['show-less'] : S['show-all'] + ' ' + (data.topics || []).length }}</button>
          </section>
        </div>
        <div v-if="INSTRUMENT_ON">
          <section class="an-card">
            <div class="an-ch"><h2>{{ S.diagnostic }}</h2></div>
            <div class="an-stats three">
              <div><span class="an-k">{{ K.rounds }}</span><b>{{ num(diag.rounds) }}</b></div>
              <div><span class="an-k">{{ K.answers }}</span><b>{{ num(diag.answers) }}</b></div>
              <div><span class="an-k">{{ S.readers }}</span><b>{{ num(diag.readers) }}</b></div>
            </div>
            <div class="an-two">
              <div>
                <h3 class="an-sub">{{ S.tests }}</h3>
                <ol class="an-list">
                  <li v-for="r in bars(data.tests, 'answers')" :key="r.test"><div class="an-rowtxt"><code>{{ TN[r.test] || r.test }}</code>
                    <b>{{ num(r.answers) }} <i>{{ S.answers }}</i> · {{ num(r.rounds) }} <i>{{ S.rounds }}</i> · {{ num(r.readers) }} <i>{{ S.readers }}</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
                </ol>
              </div>
              <div>
                <h3 class="an-sub">{{ S.types }}</h3>
                <VChart v-if="(data.types || []).length" :key="'types' + chartKey" class="an-chart sm" :option="typesOption" autoresize />
                <p v-else class="an-none">{{ S['no-rows'] }}</p>
              </div>
            </div>
          </section>
        </div>
      </template>

      <!-- ============ commerce: the store, the membership as a business, the ads ============ -->
      <template v-else-if="tab === 'commerce'">
        <div class="an-grid4">
          <section v-if="STORE_ON" class="an-card an-span2">
            <div class="an-ch"><h2>{{ S.commerce }}</h2></div>
            <p v-if="!rev.purchases && !totals.add_to_cart && !totals.checkouts" class="an-none">{{ S['no-sales'] }}</p>
            <template v-else>
            <div class="an-stats">
              <div><span class="an-k">{{ K.revenue }}</span><b>{{ money(rev.total, cur) }}</b></div>
              <div><span class="an-k">{{ K.purchases }}</span><b>{{ num(rev.purchases) }}</b></div>
              <div><span class="an-k">{{ K.aov }}</span><b>{{ money(rev.aov, cur) }}</b></div>
              <div><span class="an-k">{{ K['store-conversion'] }}</span><b>{{ pct1(rev.purchases, totals.sessions) }}%</b></div>
            </div>
            <div class="an-two">
              <div>
                <h3 class="an-sub">{{ S.funnel }}</h3>
                <div class="an-funnel">
                  <div v-for="(f, i) in [{ l: K['add-to-cart'], v: totals.add_to_cart }, { l: K.checkouts, v: totals.checkouts }, { l: K.purchases, v: rev.purchases }]" :key="i" class="an-fstep">
                    <span class="an-fbar" :style="{ width: (totals.add_to_cart ? Math.max(4, (f.v / totals.add_to_cart) * 100) : 4) + '%' }" />
                    <span class="an-fl">{{ f.l }}</span><b>{{ num(f.v) }}</b>
                  </div>
                </div>
              </div>
              <div>
                <h3 class="an-sub">{{ S.products }}</h3>
                <ol class="an-list">
                  <li v-for="r in L('prod', data.top_products, 'revenue', 6).rows" :key="r.name"><div class="an-rowtxt"><span>{{ offerName(r.name) }}</span><b>{{ num(r.purchases) }} · {{ money(r.revenue, cur) }}</b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
                </ol>
                <p v-if="!(data.top_products || []).length" class="an-none">{{ S['no-rows'] }}</p>
                <template v-if="pub(data.converting_pages).length">
                  <h3 class="an-sub">{{ S.converting }}</h3>
                  <ol class="an-list">
                    <li v-for="r in L('conv', pub(data.converting_pages), 'purchases', 5).rows" :key="r.path"><div class="an-rowtxt"><code>{{ r.path }}</code><b>{{ num(r.purchases) }}</b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
                  </ol>
                </template>
              </div>
            </div>
            </template>
          </section>
          <section v-if="MEMBERS_ON" class="an-card an-span2">
            <div class="an-ch"><h2>{{ S.membership }}</h2></div>
            <p v-if="!mm || (!mm.members && !mm.now.joined && !mm.now.lapsed)" class="an-none">{{ S['no-members'] }}</p>
            <template v-else>
              <div class="an-stats">
                <div><span class="an-k">{{ K.members }}</span><b>{{ num(mm.members) }}</b></div>
                <div><span class="an-k">{{ K.mrr }}</span><b>{{ money(mm.mrr, mm.currency) }}</b></div>
                <div><span class="an-k">{{ K.joined }}</span><b>{{ num(mm.now.joined) }} <i class="an-muted">{{ delta(mm.now.joined, mm.prev.joined) ? delta(mm.now.joined, mm.prev.joined).text : '' }}</i></b></div>
                <div><span class="an-k">{{ K.lapsed }}</span><b>{{ num(mm.now.lapsed) }} <i class="an-muted">{{ delta(mm.now.lapsed, mm.prev.lapsed) ? delta(mm.now.lapsed, mm.prev.lapsed).text : '' }}</i></b></div>
                <div><span class="an-k">{{ K.free }}</span><b>{{ num(mm.free) }}</b></div>
                <div><span class="an-k">{{ K.ending }}</span><b>{{ num(mm.ending) }}</b></div>
              </div>
              <h3 class="an-sub">{{ K['members-line'] }}</h3>
              <VChart :key="'members' + chartKey" class="an-chart sm" :option="membersOption" autoresize />
              <div class="an-two">
                <div>
                  <h3 class="an-sub">{{ K['brought-by-content'] }}</h3>
                  <ol class="an-list"><li v-for="r in bars(mm.by_content, 'n')" :key="r.kind + r.id"><div class="an-rowtxt"><span>{{ r.title }}</span><b>{{ num(r.n) }}</b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li></ol>
                  <p v-if="!(mm.by_content || []).length" class="an-none">{{ S['no-rows'] }}</p>
                </div>
                <div>
                  <h3 class="an-sub">{{ K['brought-by-channel'] }}</h3>
                  <ol class="an-list"><li v-for="r in bars(mm.by_channel, 'n')" :key="r.channel"><div class="an-rowtxt"><span><i class="an-chdot" :data-channel="r.channel" />{{ channelName(r.channel) }}</span><b>{{ num(r.n) }}</b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li></ol>
                  <p v-if="!(mm.by_channel || []).length" class="an-none">{{ S['no-rows'] }}</p>
                  <h3 class="an-sub">{{ K['by-plan'] }}</h3>
                  <ol class="an-list"><li v-for="r in bars(mm.by_plan, 'n')" :key="r.sku"><div class="an-rowtxt"><span>{{ offerName(r.sku) }}</span><b>{{ num(r.n) }}</b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li></ol>
                </div>
              </div>
            </template>
          </section>
          <section class="an-card">
            <div class="an-ch"><h2>{{ S.ctas }}</h2></div>
            <p v-if="!totals.cta_impressions" class="an-none">{{ S['no-rows'] }}</p>
            <div v-else class="an-stats two">
              <div><span class="an-k">{{ S.impressions }}</span><b>{{ num(totals.cta_impressions) }}</b></div>
              <div><span class="an-k">{{ K.ctr }}</span><b>{{ pct1(totals.cta_clicks, totals.cta_impressions) }}%</b></div>
            </div>
            <ol class="an-list">
              <li v-for="r in L('ads', data.ctas, 'impressions', 6).rows" :key="r.ad"><div class="an-rowtxt stack"><code>{{ r.ad }}</code>
                <b>{{ num(r.impressions) }} <i>{{ S.impressions }}</i> · {{ num(r.clicks) }} <i>{{ S.clicks }}</i> · {{ pct(r.clicks, r.impressions) }}%</b></div><span class="an-track"><span class="an-fill" :style="{ width: r.w + '%' }" /></span></li>
            </ol>
            
          </section>
        </div>
      </template>

      <template v-else-if="tab === 'usage'">
        <UsageAdmin />
      </template>

      <!-- ============ events: every name sent, the site's own by their label ============ -->
      <template v-else-if="tab === 'events'">
        <section class="an-card">
          <div class="an-ch"><h2>{{ EV.title }}</h2><p>{{ EV.subtitle }}</p></div>
          <p v-if="!eventRows.length" class="an-none">{{ EV.none }}</p>
          <table v-else class="an-table an-events">
            <thead><tr><th>{{ EV.event }}</th><th class="an-td-num">{{ EV.count }}</th><th class="an-td-num">{{ EV.people }}</th><th class="an-td-num">{{ EV.sessions }}</th><th class="an-td-num">{{ EV['per-session'] }}</th><th class="an-td-num">{{ EV.change }}</th><th></th></tr></thead>
            <tbody>
              <template v-for="e in eventRows" :key="e.type">
                <tr class="an-chrow" :class="{ open: openEvent === e.type }" @click="openTheEvent(e.type)">
                  <td class="an-td-title"><span class="an-evname"><b>{{ e.label }}</b><small v-if="e.registered && e.label !== e.type" class="an-muted"><code>{{ e.type }}</code></small><span v-if="e.goal" class="an-pill on">{{ EV.goal }}</span></span><span class="an-track"><span class="an-fill" :style="{ width: e.w + '%' }" /></span></td>
                  <td class="an-td-num"><b>{{ num(e.n) }}</b></td><td class="an-td-num">{{ num(e.people) }}</td><td class="an-td-num">{{ num(e.sessions) }}</td><td class="an-td-num">{{ e.perSession }}</td>
                  <td class="an-td-num"><span class="an-delta" :class="e.d ? e.d.dir : ''">{{ e.d ? e.d.text : '—' }}</span></td><td class="an-td-open">{{ openEvent === e.type ? '−' : '+' }}</td>
                </tr>
                <tr v-if="openEvent === e.type && one && one.type === e.type" class="an-chrefs"><td colspan="7">
                  <div class="an-evdetail">
                    <div><h3 class="an-sub">{{ EV.series }} <small class="an-muted">· {{ EV['series-subtitle'] }}</small></h3><VChart :key="'ev' + chartKey + e.type" class="an-chart sm" :option="oneOption" autoresize /></div>
                    <div class="an-two">
                      <div><h3 class="an-sub">{{ EV.channels }}</h3><ol class="an-list an-list-tight"><li v-for="c in bars(one.channels, 'n')" :key="c.channel"><div class="an-rowtxt"><span><i class="an-chdot" :data-channel="c.channel" />{{ channelName(c.channel) }}</span><b>{{ num(c.n) }}</b></div><span class="an-track"><span class="an-fill" :style="{ width: c.w + '%' }" /></span></li></ol></div>
                      <div><h3 class="an-sub">{{ EV.properties }} <small class="an-muted">· {{ EV['properties-subtitle'] }}</small></h3>
                        <p v-if="!(one.properties || []).length" class="an-none">{{ EV['no-properties'] }}</p>
                        <div v-for="pr in one.properties" :key="pr.key" class="an-evprop"><code>{{ pr.key }}</code><ol class="an-list an-list-tight"><li v-for="v in bars(pr.values, 'n')" :key="v.value"><div class="an-rowtxt"><span>{{ v.value }}</span><b>{{ num(v.n) }}</b></div><span class="an-track"><span class="an-fill" :style="{ width: v.w + '%' }" /></span></li></ol></div>
                      </div>
                    </div>
                  </div>
                </td></tr>
              </template>
            </tbody>
          </table>
        </section>
      </template>

      <!-- experiments -->
      <template v-else-if="tab === 'experiments'">
        <section class="an-card">
          <p v-if="!experiments.length" class="an-none">{{ EX.none }}</p>
          <div v-for="e in experiments" :key="e.experiment" class="an-exp">
            <div class="an-exph">
              <b>{{ e.title }}</b>
              <span class="an-pill kind">{{ e.kind === 'ad' ? EX['kind-ad'] : EX['kind-page'] }}</span>
              <span class="an-pill" :class="e.status === 'ended' ? 'ended' : e.status === 'paused' ? 'paused' : 'live'">{{ EX['status-' + e.status] }}</span>
              <span class="an-muted">{{ EX.started }} {{ fmtDate(e.started) }} · {{ EX.ends }} {{ fmtDate(e.ends) }}</span>
              <span v-if="e.lift != null" class="an-lift" :class="{ up: e.lift > 0 }">{{ EX.lift }} {{ e.lift > 0 ? '+' : '' }}{{ e.lift }}%</span>
            </div>
            <table class="an-table">
              <thead><tr><th>{{ EX.variant }}</th><th class="n">{{ EX.exposures }}</th><th class="n">{{ EX.conversions }}</th><th class="n">{{ EX.rate }}</th><th></th></tr></thead>
              <tbody>
                <tr v-for="v in e.variants" :key="v.variant" :class="{ 'is-lead': e.leader && v.variant === e.leader.variant }">
                  <td><code>{{ v.variant }}</code>
                    <span v-if="e.winner && v.variant === e.winner" class="an-lead">{{ EX.winner }}</span>
                    <span v-else-if="!e.ended && e.leader && v.variant === e.leader.variant" class="an-lead">{{ EX.leader }}</span></td>
                  <td class="n">{{ num(v.exposures) }}</td><td class="n">{{ num(v.conversions) }}</td><td class="n">{{ (v.rate * 100).toFixed(1) }}%</td>
                  <td class="an-ratecell"><span class="an-rate" :style="{ width: (v.rate / e.maxRate) * 100 + '%' }" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <!-- explore: any metric on one chart -->
      <template v-else-if="tab === 'explore'">
      <div class="an-explore">
        <div class="an-xside">
          <h2 class="an-xtitle">{{ XP.title }}</h2>
          <p class="an-subtitle">{{ XP.subtitle }}</p>
          <h3 class="an-sub">{{ XP.metrics }}</h3>
          <div class="an-chips">
            <button v-for="k in METRICS" :key="k" type="button" class="an-chip" :class="{ on: picked.includes(k) }" :style="picked.includes(k) ? { '--c': PALETTE[picked.indexOf(k) % PALETTE.length] } : null" @click="toggleMetric(k)">
              <i /> {{ MN[k] }}
            </button>
          </div>
          <h3 class="an-sub">{{ XP.channel }}</h3>
          <select class="an-select" :value="filters.channel || ''" @change="setFilter('channel', $event.target.value || null)"><option value="">{{ XP['any-channel'] }}</option><option v-for="c in ['direct', 'search', 'social', 'email', 'ai', 'referral', 'paid']" :key="c" :value="c">{{ channelName(c) }}</option></select>
          <template v-if="SITE_SOURCES.length"><h3 class="an-sub">{{ XP.source }}</h3>
          <select class="an-select" :value="filters.source || ''" @change="setFilter('source', $event.target.value || null)"><option value="">{{ FW['this-site'] }}</option><option v-for="src in SITE_SOURCES" :key="src.name" :value="src.name">{{ src.name }}</option></select></template>
          <h3 class="an-sub">{{ XP.granularity }}</h3>
          <div class="an-seg">
            <button type="button" :class="{ on: gran === 'day' }" @click="gran = 'day'">{{ XP.day }}</button>
            <button type="button" :class="{ on: gran === 'week' }" @click="gran = 'week'">{{ XP.week }}</button>
          </div>
          <h3 class="an-sub">{{ XP.range }}</h3>
          <div class="an-seg">
            <button v-for="d in [7, 30, 90, 365]" :key="d" type="button" :class="{ on: days === d }" @click="days = d">{{ d }}d</button>
          </div>
          <label class="an-check"><input v-model="smooth" type="checkbox" /> {{ XP.smooth }}</label>
          <label class="an-check"><input v-model="cumulative" type="checkbox" /> {{ XP.cumulative }}</label>
          <label class="an-check"><input v-model="compare" type="checkbox" /> {{ XP.compare }}</label>
          <button type="button" class="an-ghost" @click="exportCsv">{{ H.export }}</button>
        </div>
        <div class="an-xmain an-card">
          <p v-if="!picked.length" class="an-empty">{{ XP.empty }}</p>
          <VChart v-else :key="'explore' + chartKey" class="an-chart xl" :option="exploreOption" autoresize />
          <div class="an-xsum">
            <div v-for="(k, i) in picked" :key="k"><i :style="{ background: PALETTE[i % PALETTE.length] }" /><span class="an-k">{{ MN[k] }}</span>
              <b>{{ k === 'revenue' ? money(sum(series, k), cur) : num(sum(series, k)) }}</b>
              <span v-if="compare" class="an-delta" :class="(delta(sum(series, k), sum(seriesPrev, k)) || {}).dir">{{ (delta(sum(series, k), sum(seriesPrev, k)) || {}).text }}</span>
            </div>
          </div>
        </div>
      </div>
      </template>
    </template>

  </div>
</template>

<style>
/* the shared idiom lives in analytics.css; nothing of this page's own is left here */
</style>

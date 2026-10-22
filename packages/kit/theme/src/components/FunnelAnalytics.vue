<script setup>
/*
 * Funnel analytics — what the funnels and the blasts did, as Forms → Analytics is: an index, then one funnel or blast
 * at a time. The index: the window's sent · open rate · click rate · unsubscribed · conversions · revenue against the
 * window before, sent / opened / clicked a day, a card per funnel and per blast (from the compiled index, so a funnel
 * that never sent still has a card), who is reachable. One funnel: its tiles and series, then the journey — each email
 * step's sent · opened · clicked · goal · unsubscribed against the step before, and between steps who is waiting,
 * held or has left the audience (states now, not the window's) — a chat step's prompt numbers, and a step opened into
 * its links, its hours, the median time to open, the share on a phone, its versions. A blast is one step on the same
 * page. Read through admin_funnels(days, goals) and admin_funnel(kind, name, days, steps, rules, goal, tz); the funnels'
 * shape from .velite/funnels-index.json (build/funnels.mjs). Wears the analytics idiom (analytics.css). Words:
 * `## funnels` in content/app/ui/analytics.md, the states `## page`.
 */
import { ref, computed, onMounted, watch } from 'vue'
import VChart from 'vue-echarts'
import { base, tokens, PALETTE, chartKind, timeSeries, timeAxis } from '../lib/charts-theme.js'
import ChartKind from './ChartKind.vue'
import './analytics.css'
import { us } from 'platformkit/lib/content.js'
import { supabase, configured } from 'platformkit/lib/supabase.js'
import { isSignedIn } from 'platformkit/lib/auth.js'
import AdminHead from './admin/AdminHead.vue'

const props = defineProps({ name: { type: String, default: '' }, kind: { type: String, default: 'funnel' } })
const emit = defineEmits(['open', 'back', 'edit'])
const T = us('analytics')
const H = T.page.head
const FW = T.funnels ? T.funnels.ui : {}
const wn = (key, n, m) => String(FW[key] || '').replace('{n}', n).replace('{m}', m == null ? '' : m)
/* the funnels' shape: names, steps, goals, audiences — the database knows the log alone */
const INDEX = Object.values(import.meta.glob('#content/funnels-index.json', { eager: true, import: 'default' }))[0] || { funnels: [], blasts: [] }
const FUNNELS = INDEX.funnels || [], BLASTS = INDEX.blasts || []
const days = ref(30)
const state = ref('idle')      /* idle | loading | ok | denied | error */
const index = ref(null)
const one = ref(null)
const openStep = ref('')

const def = computed(() => (props.kind === 'blast' ? BLASTS.find((b) => b.name === props.name) : FUNNELS.find((f) => f.name === props.name)) || null)
/* a blast is one step: its own id, sent once */
const stepDefs = computed(() => { const d = def.value; if (!d) return []; return props.kind === 'blast' ? [{ id: d.id, title: d.title, channel: 'email', after: 0, subject: d.subject }] : d.steps || [] })
const goalsMap = () => Object.fromEntries([...FUNNELS.map((f) => ['funnel:' + f.name, f.goal]), ...BLASTS.map((b) => ['blast:' + b.name, b.goal])].filter(([, g]) => g))

async function load() {
  if (!configured || !isSignedIn.value) { state.value = 'idle'; index.value = null; one.value = null; return }
  state.value = 'loading'
  const fail = (error) => { state.value = (error.code === '42501' || /admin only|permission/i.test(error.message || '')) ? 'denied' : 'error' }
  if (props.name) {
    const d = def.value
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch (e) { return 'UTC' } })()
    const { data, error } = await supabase.rpc('admin_funnel', { kind: props.kind, name: props.name, days: days.value, steps: stepDefs.value.map((s) => ({ id: s.id, after: s.after || 0, channel: s.channel })), rules: d && d.rules && Object.keys(d.rules).length ? d.rules : null, goal: d ? d.goal || null : null, tz })
    if (error) return fail(error)
    one.value = data || null
  } else {
    const { data, error } = await supabase.rpc('admin_funnels', { days: days.value, goals: goalsMap() })
    if (error) return fail(error)
    index.value = data || null
  }
  state.value = 'ok'
}
onMounted(load)
watch([isSignedIn, days, () => props.name, () => props.kind], load)
watch(() => props.name, () => { openStep.value = '' })
const chartKey = ref(0)
onMounted(() => { const mo = new MutationObserver(() => chartKey.value++); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }) })

/* ---- helpers ---- */
const num = (n) => new Intl.NumberFormat().format(Math.round(n || 0))
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const money = (n, c) => new Intl.NumberFormat(undefined, { style: 'currency', currency: (c || 'usd').toUpperCase(), maximumFractionDigits: 0 }).format((n || 0) / 100)
const delta = (now, before) => { if (!before) return null; const d = Math.round(((now - before) / before) * 100); return { dir: d > 0 ? 'up' : d < 0 ? 'down' : 'flat', text: (d > 0 ? '+' : '') + d + '%' } }
const dayKey = (d) => String(d || '').slice(0, 10)
const day = (d) => { const t = new Date(dayKey(d) + 'T00:00:00'); return isNaN(t) ? '' : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
const when = (d) => { if (!d) return FW['last-none']; const t = new Date(d); return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }
const dateOnly = (d) => { if (!d) return ''; const t = new Date(d); return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
const rangeLabel = computed(() => H.range.replace('{days}', days.value))
function openAuth() { if (window.DLauth) window.DLauth.open() }
const pathOf = (u) => { try { const x = new URL(u); return x.pathname + x.search } catch (e) { return u } }
const choiceWords = (c) => c.text || String(c.choice || '').split('/').pop().replace(/-/g, ' ')
const stepsWord = (n) => (n === 1 ? FW['steps-one'] : wn('steps', n))

/* ---- the index ---- */
const inow = computed(() => (index.value && index.value.now) || {})
const iprev = computed(() => (index.value && index.value.prev) || {})
const rate = (o, k) => (o.sent ? Math.round(((o[k] || 0) / o.sent) * 100) : 0)
const indexTiles = computed(() => { const n = inow.value, p = iprev.value; if (!index.value) return []; return [
  { label: FW.sent, value: num(n.sent), d: delta(n.sent, p.sent), spark: 'sent' },
  { label: FW.opened, value: rate(n, 'opened') + '%', d: delta(rate(n, 'opened'), rate(p, 'opened')), spark: 'opened' },
  { label: FW.clicked, value: rate(n, 'clicked') + '%', d: delta(rate(n, 'clicked'), rate(p, 'clicked')), spark: 'clicked' },
  { label: FW.unsubscribed, value: num(n.unsubscribed), note: n.sent ? (Math.round(((n.unsubscribed || 0) / n.sent) * 1000) / 10) + '% ' + FW['of-sent'] : '', d: delta(n.unsubscribed, p.unsubscribed) },
  { label: FW.conversions, value: num(n.conversions), d: delta(n.conversions, p.conversions) },
  { label: FW.revenue, value: money(n.revenue, index.value.currency), d: delta(n.revenue, p.revenue) },
] })
/* every funnel and blast the files know, with the window's numbers laid over; then anything the log knows that the files no longer do */
const cards = computed(() => {
  const items = (index.value && index.value.items) || []
  const find = (k, n) => items.find((x) => x.kind === k && x.name === n) || { sent: 0, opened: 0, clicked: 0, unsubscribed: 0, conversions: 0, revenue: 0, active: 0, done: 0, last: null }
  const pr = (index.value && index.value.prompts) || {}
  const fs = FUNNELS.map((f) => ({ kind: 'funnel', name: f.name, title: f.title, published: f.published, steps: (f.steps || []).length, chat: (f.steps || []).filter((s) => s.channel === 'chat').length, emails: (f.steps || []).filter((s) => s.channel !== 'chat').length, prompt: pr[f.name] || null, ...find('funnel', f.name) }))
  const bs = BLASTS.map((b) => ({ kind: 'blast', name: b.name, title: b.title, published: b.status === 'sent', steps: 1, chat: 0, ...find('blast', b.name) }))
  const gone = items.filter((x) => !(x.kind === 'funnel' ? FUNNELS.some((f) => f.name === x.name) : BLASTS.some((b) => b.name === x.name))).map((x) => ({ ...x, title: x.name, published: false, steps: 0, chat: 0 }))
  return { funnels: fs, blasts: [...bs, ...gone.filter((x) => x.kind === 'blast')], gone: gone.filter((x) => x.kind === 'funnel') }
})
const seriesOf = (rows, keys) => {
  const by = Object.fromEntries((rows || []).map((r) => [dayKey(r.day), r]))
  const out = []; const t = new Date(); t.setHours(0, 0, 0, 0)
  for (let i = days.value - 1; i >= 0; i--) { const d = new Date(t); d.setDate(d.getDate() - i); const k = d.toISOString().slice(0, 10); const o = { day: k }; for (const key of keys) o[key] = (by[k] || {})[key] || 0; out.push(o) }
  return out
}
const indexSeries = computed(() => seriesOf(index.value && index.value.series, ['sent', 'opened', 'clicked']))
const sparkPath = (rows, key) => { if (rows.length < 2 || !rows.some((r) => r[key] > 0)) return ''; const max = Math.max(1, ...rows.map((r) => r[key] || 0)); return rows.map((r, i) => `${(i / (rows.length - 1)) * 100},${30 - ((r[key] || 0) / max) * 26 - 2}`).join(' ') }
const indexChart = computed(() => {
  void chartKey.value; void chartKind.value
  const b = base(), t = tokens(), rows = indexSeries.value
  return { ...b, xAxis: timeAxis({ ...b.xAxis, data: rows.map((r) => day(r.day)) }), yAxis: { ...b.yAxis, minInterval: 1 }, series: [
    timeSeries({ name: FW.sent, color: t.accent, area: true, data: rows.map((r) => r.sent) }),
    timeSeries({ name: FW['opened-n'], color: PALETTE[1], data: rows.map((r) => r.opened) }),
    timeSeries({ name: FW['clicked-n'], color: PALETTE[2], data: rows.map((r) => r.clicked) }),
  ] }
})

/* ---- one funnel or blast ---- */
const now = computed(() => (one.value && one.value.now) || {})
const prev = computed(() => (one.value && one.value.prev) || {})
const isBlast = computed(() => props.kind === 'blast')
const hasGoal = computed(() => !!(def.value && def.value.goal))
const tiles = computed(() => { const n = now.value, p = prev.value; if (!one.value) return []; return [
  ...(isBlast.value ? [] : [
    { label: FW.entered, value: num(n.entered), d: delta(n.entered, p.entered), spark: 'entered' },
    { label: FW.active, value: num(n.active), sub: '' },
    { label: FW.completed, value: num(n.done_ever), note: pct(n.done_ever, n.entered_ever) + '%', sub: FW['of-entered'] },
  ]),
  { label: FW.sent, value: num(n.sent), d: delta(n.sent, p.sent), spark: 'sent' },
  { label: FW.opened, value: rate(n, 'opened') + '%', d: delta(rate(n, 'opened'), rate(p, 'opened')), spark: 'opened' },
  { label: FW.clicked, value: rate(n, 'clicked') + '%', d: delta(rate(n, 'clicked'), rate(p, 'clicked')), spark: 'clicked' },
  { label: FW.unsubscribed, value: num(n.unsubscribed), note: n.sent ? (Math.round(((n.unsubscribed || 0) / n.sent) * 1000) / 10) + '% ' + FW['of-sent'] : '', d: delta(n.unsubscribed, p.unsubscribed) },
  ...(hasGoal.value ? [{ label: FW.goal, value: num(n.goal), d: delta(n.goal, p.goal) }] : []),
  { label: FW.conversions, value: num(n.conversions), d: delta(n.conversions, p.conversions) },
  { label: FW.revenue, value: money(n.revenue, one.value.currency), d: delta(n.revenue, p.revenue) },
] })
const oneSeries = computed(() => seriesOf(one.value && one.value.series, ['entered', 'sent', 'opened', 'clicked']))
const oneChart = computed(() => {
  void chartKey.value; void chartKind.value
  const b = base(), t = tokens(), rows = oneSeries.value
  return { ...b, xAxis: timeAxis({ ...b.xAxis, data: rows.map((r) => day(r.day)) }), yAxis: { ...b.yAxis, minInterval: 1 }, series: [
    ...(isBlast.value ? [] : [timeSeries({ name: FW.entered, color: PALETTE[3], data: rows.map((r) => r.entered) })]),
    timeSeries({ name: FW.sent, color: t.accent, area: true, data: rows.map((r) => r.sent) }),
    timeSeries({ name: FW['opened-n'], color: PALETTE[1], data: rows.map((r) => r.opened) }),
    timeSeries({ name: FW['clicked-n'], color: PALETTE[2], data: rows.map((r) => r.clicked) }),
  ] }
})
/* the journey: the steps in file order joined to their numbers; an email step's counts as shares of the email step
   before it (the first of the first), and what stands between this step and the one before it */
const journey = computed(() => {
  const got = (one.value && one.value.steps) || []
  const first = got.find((g) => g.channel === 'email')
  let prevEmail = null, n = 0
  return stepDefs.value.map((s) => {
    const g = got.find((x) => x.id === s.id) || {}
    if (s.channel === 'chat') return { ...s, g, n: ++n, chat: true, choices: (g.choices || []).map((c) => ({ ...c, w: pct(c.n, Math.max(1, ...(g.choices || []).map((x) => x.n))) })) }
    const row = { ...s, g, n: ++n, chat: false,
      width: first && first.sent ? Math.max(3, pct(g.sent, first.sent)) : 0,
      ofPrev: prevEmail ? pct(g.sent, prevEmail.sent) : null,
      between: prevEmail ? { waiting: g.waiting || 0, held: g.held || 0, left: g.left || 0 } : null,
      marks: [
        { key: 'opened', label: FW['opened-n'], n: g.opened || 0, share: pct(g.opened, g.sent) },
        { key: 'clicked', label: FW['clicked-n'], n: g.clicked || 0, share: pct(g.clicked, g.sent) },
        ...(hasGoal.value ? [{ key: 'goal', label: FW['goal-n'], n: g.goal || 0, share: pct(g.goal, g.sent) }] : []),
        { key: 'unsub', label: FW['unsub-n'], n: g.unsubscribed || 0, share: pct(g.unsubscribed, g.sent), bad: true },
      ],
    }
    prevEmail = g; return row
  })
})
const hasSends = computed(() => (now.value.sent || 0) > 0 || (prev.value.sent || 0) > 0)
/* a funnel of chat prompts alone has no emails to count: its journey is the prompts, and the tiles stay away */
const hasEmails = computed(() => stepDefs.value.some((s) => s.channel !== 'chat'))
const hasPrompts = computed(() => ((one.value && one.value.steps) || []).some((g) => g.channel === 'chat' && (g.shown || 0) > 0))
const hasAny = computed(() => hasSends.value || hasPrompts.value)
const stepLabel = (s) => (s.chat ? s.title : s.subject || s.title)
const toggleStep = (id) => { openStep.value = openStep.value === id ? '' : id }
/* a step's detail: the 7 × 24 grid of opens (rows the days of the week, from Monday), the links, the versions */
const DOW = (() => { const b = new Date(2024, 0, 1); return [1, 2, 3, 4, 5, 6, 0].map((d) => { const t = new Date(b); t.setDate(b.getDate() + ((d - 1 + 7) % 7)); return { d, label: t.toLocaleDateString(undefined, { weekday: 'short' }) } }) })()
const hoursOf = (g) => {
  const cells = {}; let max = 0
  for (const [dow, hr, n] of g.hours || []) { cells[dow + ':' + hr] = n; max = Math.max(max, n) }
  return { max, rows: DOW.map((w) => ({ ...w, cells: Array.from({ length: 24 }, (_, h) => ({ h, n: cells[w.d + ':' + h] || 0, a: max ? (cells[w.d + ':' + h] || 0) / max : 0 })) })) }
}
const toOpen = (g) => (g.to_open == null ? '—' : g.to_open < 1 ? Math.round(g.to_open * 60) + 'm' : g.to_open < 48 ? Math.round(g.to_open * 10) / 10 + 'h' : Math.round(g.to_open / 24) + 'd')
const hourLabel = (h) => (h % 6 === 0 ? String(h).padStart(2, '0') : '')
</script>

<template>
  <div class="ui-page an">
    <!-- ============ one funnel or blast ============ -->
    <template v-if="name">
      <div class="an-head">
        <div>
          <button type="button" class="an-crumb" @click="emit('back')">← {{ FW.back }}</button>
          <h1 class="an-title">{{ def ? def.title : name }} <span class="an-kindpill">{{ isBlast ? FW['kind-blast'] : FW['kind-funnel'] }}</span></h1>
          <p class="an-subtitle">{{ isBlast ? FW['subtitle-blast'] : hasEmails ? FW['subtitle-one'] : FW['subtitle-chat'] }}</p>
        </div>
        <div v-if="state === 'ok'" class="an-controls">
          <button v-if="def" type="button" class="an-refresh" @click="emit('edit', { kind, name })">{{ FW.edit }}</button>
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
      <template v-else-if="state === 'ok' && one">
        <div class="an-range"><span class="an-rangelabel">{{ rangeLabel }}</span><span class="an-vs">{{ def && def.goal ? FW.goal + ': ' + def.goal : FW['no-goal'] }}</span></div>
        <p v-if="!hasAny" class="an-empty">{{ isBlast ? FW['none-blast'] : hasEmails ? FW['none-funnel'] : FW['none-chat'] }}</p>
        <template v-else>
          <div v-if="hasEmails" class="an-panel" :data-n="tiles.length">
            <div v-for="t in tiles" :key="t.label" class="an-cell">
              <span class="an-k">{{ t.label }}</span>
              <div class="an-cellrow">
                <b>{{ t.value }}</b><small v-if="t.note" class="an-cellnote">{{ t.note }}</small>
                <svg v-if="t.spark && sparkPath(oneSeries, t.spark)" class="an-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline :points="sparkPath(oneSeries, t.spark)" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" /></svg>
              </div>
              <span v-if="t.sub !== undefined" class="an-delta none">{{ t.sub }}</span>
              <span v-else class="an-delta" :class="t.d ? t.d.dir : 'none'">{{ t.d ? t.d.text + ' ' + H['vs-short'] : H['no-previous'] }}</span>
            </div>
          </div>

          <section v-if="hasEmails" class="an-card">
            <div class="an-ch"><h2>{{ FW['over-time'] }}</h2><p>{{ isBlast ? FW['over-time-subtitle'] : FW['over-time-subtitle-one'] }}</p></div>
            <VChart :key="'fn' + chartKey" class="an-chart sm" :option="oneChart" autoresize />
          </section>

          <!-- the journey -->
          <section class="an-card">
            <div class="an-ch"><h2>{{ FW.journey }}</h2><p>{{ isBlast ? FW['journey-subtitle-blast'] : hasEmails ? FW['journey-subtitle'] : FW['journey-subtitle-chat'] }}</p></div>
            <ol class="an-journey">
              <li v-for="s in journey" :key="s.id" :class="{ 'is-chat': s.chat, 'is-open': openStep === s.id }">
                <!-- between this step and the one before: who waits, is held, has left -->
                <div v-if="s.between" class="an-between">
                  <span><i>{{ FW.waiting }}</i><b>{{ num(s.between.waiting) }}</b></span>
                  <span :title="FW['held-help']"><i>{{ FW.held }}</i><b>{{ num(s.between.held) }}</b></span>
                  <span><i>{{ FW.left }}</i><b>{{ num(s.between.left) }}</b></span>
                  <em>{{ FW.now }}</em>
                </div>
                <template v-if="s.chat">
                  <div class="an-jstep an-jchat">
                    <div class="an-jhead">
                      <span class="an-stepn">{{ wn('step', s.n) }} · {{ FW.chat }}</span>
                      <span class="an-stepq">{{ s.title }}</span>
                      <span v-if="s.text" class="an-jtext">{{ s.text }}</span>
                    </div>
                    <div class="an-jnums">
                      <span><i>{{ FW.shown }}</i><b>{{ num(s.g.shown) }}</b></span>
                      <span><i>{{ FW.picked }}</i><b>{{ num(s.g.chosen) }}</b></span>
                      <span><i>{{ FW.begun }}</i><b>{{ num(s.g.started) }} <small>· {{ pct(s.g.started, s.g.shown) }}%</small></b></span>
                      <span><i>{{ FW.people }}</i><b>{{ num(s.g.people) }}</b></span>
                    </div>
                    <ol v-if="s.choices.length" class="an-list an-jchoices">
                      <li v-for="c in s.choices" :key="c.choice"><div class="an-rowtxt"><span>{{ choiceWords(c) }}</span><b>{{ num(c.n) }} · {{ pct(c.n, s.g.chosen) }}%</b></div><span class="an-track"><span class="an-fill" :style="{ width: c.w + '%' }" /></span></li>
                    </ol>
                    <p v-else class="an-none">{{ FW['no-choices'] }}</p>
                  </div>
                </template>
                <template v-else>
                  <div class="an-jstep">
                    <div class="an-jhead">
                      <span class="an-stepn">{{ wn('step', s.n) }} · {{ FW.email }}</span>
                      <span class="an-stepq">{{ stepLabel(s) }}</span>
                    </div>
                    <div class="an-jrow"><div class="an-jbar"><span class="an-jfill" :style="{ width: s.width + '%' }" /></div><span class="an-jsent"><b>{{ num(s.g.sent) }}</b> {{ FW.reached.toLowerCase() }}<i v-if="s.ofPrev !== null"> · {{ s.ofPrev }}% {{ FW['of-previous'] }}</i></span></div>
                    <div class="an-jmarks">
                      <span v-for="m in s.marks" :key="m.key" :class="['an-jmark', 'is-' + m.key, { some: m.n, bad: m.bad }]"><i>{{ m.label }}</i><b>{{ num(m.n) }}</b><small>{{ m.share }}%</small></span>
                      <span v-if="s.g.conversions || s.g.revenue" class="an-jmark is-conv some"><i>{{ FW.conversions }}</i><b>{{ num(s.g.conversions) }}</b><small>{{ money(s.g.revenue, one.currency) }}</small></span>
                      <button type="button" class="an-jopen" :aria-expanded="openStep === s.id" @click="toggleStep(s.id)">{{ openStep === s.id ? FW['detail-close'] : FW.detail }}</button>
                    </div>
                    <!-- the step's detail -->
                    <div v-if="openStep === s.id" class="an-jdetail">
                      <div class="an-jgrid">
                        <div class="an-jlinks">
                          <h3>{{ FW.links }} <small>· {{ FW['links-subtitle'] }}</small></h3>
                          <table v-if="(s.g.links || []).length" class="an-table an-linktable"><thead><tr><th>{{ FW.destination }}</th><th class="an-td-num">{{ FW.clicks }}</th><th class="an-td-num">{{ FW['people-col'] }}</th></tr></thead>
                            <tbody><tr v-for="l in s.g.links" :key="l.url"><td class="an-td-title" :title="l.url"><code>{{ pathOf(l.url) }}</code></td><td class="an-td-num">{{ num(l.clicks) }}</td><td class="an-td-num">{{ num(l.people) }}</td></tr></tbody></table>
                          <p v-else class="an-none">{{ FW['no-links'] }}</p>
                        </div>
                        <div class="an-jfigs">
                          <div class="an-jfig"><span class="an-k">{{ FW['to-open'] }}</span><b>{{ toOpen(s.g) }}</b><small>{{ FW['to-open-unit'] }}</small></div>
                          <div class="an-jfig"><span class="an-k">{{ FW.devices }}</span><b>{{ s.g.phone == null ? '—' : s.g.phone + '%' }}</b><small>{{ FW.phone }}<template v-if="s.g.phone != null"> · {{ 100 - s.g.phone }}% {{ FW.desktop }}</template></small></div>
                        </div>
                      </div>
                      <div class="an-jhours">
                        <h3>{{ FW.hours }} <small>· {{ FW['hours-subtitle'] }}</small></h3>
                        <div class="an-heat" :style="{ '--rows': 7 }">
                          <div v-for="r in hoursOf(s.g).rows" :key="r.d" class="an-heatrow"><span class="an-heatday">{{ r.label }}</span><span v-for="c in r.cells" :key="c.h" class="an-heatcell" :style="{ '--a': c.a }" :title="r.label + ' ' + String(c.h).padStart(2, '0') + ':00 · ' + num(c.n)" /></div>
                          <div class="an-heatrow an-heataxis"><span class="an-heatday" /><span v-for="h in 24" :key="h" class="an-heath">{{ hourLabel(h - 1) }}</span></div>
                        </div>
                      </div>
                      <div v-if="(s.g.versions || []).length > 1" class="an-jversions">
                        <h3>{{ FW.versions }} <small>· {{ FW['versions-subtitle'] }}</small></h3>
                        <table class="an-table"><thead><tr><th>{{ FW.version }}</th><th>{{ FW['first-sent'] }}</th><th class="an-td-num">{{ FW.sent }}</th><th class="an-td-num">{{ FW.opened }}</th><th class="an-td-num">{{ FW.clicked }}</th></tr></thead>
                          <tbody><tr v-for="(v, i) in s.g.versions" :key="v.version"><td><code>{{ i + 1 }}</code></td><td>{{ dateOnly(v.first) }}</td><td class="an-td-num">{{ num(v.sent) }}</td><td class="an-td-num">{{ pct(v.opened, v.sent) }}%</td><td class="an-td-num">{{ pct(v.clicked, v.sent) }}%</td></tr></tbody></table>
                      </div>
                    </div>
                  </div>
                </template>
              </li>
              <li v-if="!isBlast && hasEmails" class="an-jend"><span class="an-jdone"><i>{{ FW.done }}</i><b>{{ num(one.done) }}</b><small>· {{ pct(one.done, now.entered_ever) }}% {{ FW['of-entered'] }}</small></span></li>
            </ol>
            <p v-if="hasEmails" class="an-quiet an-opensnote">{{ FW['opens-note'] }}</p>
          </section>
        </template>
      </template>
    </template>

    <!-- ============ the index: every funnel and blast ============ -->
    <template v-else>
      <AdminHead :title="FW['page-title']" :sub="FW.subtitle">
        <template v-if="state === 'ok'" #actions>
          <div class="an-controls">
            <ChartKind />
            <div class="an-seg">
              <button v-for="d in [7, 30, 90, 365]" :key="d" type="button" :class="{ on: days === d }" @click="days = d">{{ d }}d</button>
              <button type="button" class="an-refresh" @click="load">{{ H.refresh }}</button>
            </div>
          </div>
        </template>
      </AdminHead>
      <div v-if="state === 'idle'" class="an-note"><h2>{{ H['signin-heading'] }}</h2><p>{{ H['signin-subtitle'] }}</p><button type="button" class="an-cta" @click="openAuth">{{ H['signin-cta'] }}</button></div>
      <div v-else-if="state === 'denied'" class="an-note"><h2>{{ H['denied-heading'] }}</h2><p>{{ H['denied-subtitle'] }}</p></div>
      <div v-else-if="state === 'error'" class="an-note"><h2>{{ H['error-heading'] }}</h2><p>{{ H['error-subtitle'] }}</p></div>
      <p v-else-if="state === 'loading'" class="an-loading">{{ H.loading }}</p>
      <template v-else-if="state === 'ok' && index">
        <div class="an-range"><span class="an-rangelabel">{{ rangeLabel }}</span><span class="an-vs">{{ wn('reachable', num(index.reachable), num(index.opted_out)) }}</span></div>
        <template v-if="inow.sent || iprev.sent">
          <div class="an-panel" :data-n="indexTiles.length">
            <div v-for="t in indexTiles" :key="t.label" class="an-cell">
              <span class="an-k">{{ t.label }}</span>
              <div class="an-cellrow">
                <b>{{ t.value }}</b><small v-if="t.note" class="an-cellnote">{{ t.note }}</small>
                <svg v-if="t.spark && sparkPath(indexSeries, t.spark)" class="an-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline :points="sparkPath(indexSeries, t.spark)" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" /></svg>
              </div>
              <span class="an-delta" :class="t.d ? t.d.dir : 'none'">{{ t.d ? t.d.text + ' ' + H['vs-short'] : H['no-previous'] }}</span>
            </div>
          </div>
          <section class="an-card">
            <div class="an-ch"><h2>{{ FW['over-time'] }}</h2><p>{{ FW['over-time-subtitle'] }}</p></div>
            <VChart :key="'fi' + chartKey" class="an-chart sm" :option="indexChart" autoresize />
          </section>
        </template>
        <p v-else class="an-empty">{{ FW.none }}</p>

        <h2 class="an-group">{{ FW.funnels }}</h2>
        <p v-if="!cards.funnels.length && !cards.gone.length" class="an-none">{{ FW['no-funnels'] }}</p>
        <div v-else class="an-grid2">
          <button v-for="f in [...cards.funnels, ...cards.gone]" :key="f.kind + f.name" type="button" class="an-card an-formcard an-fcard" @click="emit('open', { kind: f.kind, name: f.name })">
            <span class="an-formtitle">{{ f.title }} <span class="an-pill" :class="f.published ? 'on' : 'off'">{{ f.published ? FW['kind-funnel'] : FW['kind-funnel'] + ' · off' }}</span></span>
            <span class="an-fmeta">{{ stepsWord(f.steps) }}<template v-if="f.emails"> · {{ FW.active.toLowerCase() }} {{ num(f.active) }} · {{ FW.completed.toLowerCase() }} {{ num(f.done) }}</template><template v-if="f.chat"> · {{ FW.chat.toLowerCase() }}: {{ f.prompt ? wn('prompt-line', num(f.prompt.shown), num(f.prompt.started)) : wn('prompt-line', 0, 0) }}</template></span>
            <span v-if="f.emails" class="an-formnums an-fnums">
              <span><i>{{ FW.sent }}</i><b>{{ num(f.sent) }}</b></span>
              <span><i>{{ FW.opened }}</i><b>{{ rate(f, 'opened') }}%</b></span>
              <span><i>{{ FW.clicked }}</i><b>{{ rate(f, 'clicked') }}%</b></span>
              <span><i>{{ FW.unsubscribed }}</i><b>{{ num(f.unsubscribed) }}</b></span>
              <span><i>{{ FW.conversions }}</i><b>{{ num(f.conversions) }}</b></span>
              <span><i>{{ FW.revenue }}</i><b>{{ money(f.revenue, index.currency) }}</b></span>
            </span>
            <span class="an-formfoot"><span>{{ FW.last }}: {{ when(f.last) }}</span><span class="an-formopen">{{ FW.open }} →</span></span>
          </button>
        </div>

        <h2 class="an-group">{{ FW.blasts }}</h2>
        <p v-if="!cards.blasts.length" class="an-none">{{ FW['no-blasts'] }}</p>
        <div v-else class="an-grid2">
          <button v-for="b in cards.blasts" :key="b.kind + b.name" type="button" class="an-card an-formcard an-fcard" @click="emit('open', { kind: 'blast', name: b.name })">
            <span class="an-formtitle">{{ b.title }} <span class="an-pill" :class="b.published ? 'on' : 'off'">{{ FW['kind-blast'] }}</span></span>
            <span class="an-fmeta">{{ b.last ? wn('sent-on', '').replace('{when}', dateOnly(b.last)) : FW['none-blast'] }}</span>
            <span class="an-formnums an-fnums">
              <span><i>{{ FW.sent }}</i><b>{{ num(b.sent) }}</b></span>
              <span><i>{{ FW.opened }}</i><b>{{ rate(b, 'opened') }}%</b></span>
              <span><i>{{ FW.clicked }}</i><b>{{ rate(b, 'clicked') }}%</b></span>
              <span><i>{{ FW.unsubscribed }}</i><b>{{ num(b.unsubscribed) }}</b></span>
              <span><i>{{ FW.conversions }}</i><b>{{ num(b.conversions) }}</b></span>
              <span><i>{{ FW.revenue }}</i><b>{{ money(b.revenue, index.currency) }}</b></span>
            </span>
            <span class="an-formfoot"><span>{{ FW.last }}: {{ when(b.last) }}</span><span class="an-formopen">{{ FW.open }} →</span></span>
          </button>
        </div>
        <p class="an-quiet an-opensnote">{{ FW['opens-note'] }}</p>
      </template>
    </template>
  </div>
</template>

<style>
/* the funnel page's own pieces, on the shared idiom (FormAnalytics.vue lends the crumb, the cards, the funnel bars) */
.an-pill { display: inline-block; vertical-align: middle; margin-left: 6px; font-family: var(--m); font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; border-radius: 999px; padding: 2px 7px; color: var(--ink3); border: 1px solid var(--hair) } .an-pill.on { color: #059669; border-color: color-mix(in srgb, #059669 40%, transparent) }
.an-fcard { gap: 8px } .an-fmeta { font-size: 12.5px; color: var(--ink3) } .an-fnums { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 10px } .an-fnums b { font-size: 20px } .an-fnums i { white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.an-cellnote { font-size: 11.5px; color: var(--ink3); align-self: end; padding-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0 }
@media (min-width: 1001px) { .an-panel[data-n="9"], .an-panel[data-n="10"] { grid-template-columns: repeat(5, minmax(0, 1fr)) } .an-panel[data-n="9"] .an-cell:nth-child(4n), .an-panel[data-n="10"] .an-cell:nth-child(4n) { border-right: 1px solid var(--hair) } .an-panel[data-n="9"] .an-cell:nth-child(5n), .an-panel[data-n="10"] .an-cell:nth-child(5n) { border-right: 0 } .an-panel[data-n="9"] .an-cell:nth-child(n+5), .an-panel[data-n="10"] .an-cell:nth-child(n+5) { border-bottom: 1px solid var(--hair) } .an-panel[data-n="9"] .an-cell:nth-child(n+6), .an-panel[data-n="10"] .an-cell:nth-child(n+6) { border-bottom: 0 } .an-panel[data-n="9"] .an-cell:nth-child(9) { grid-column: span 2 } .an-panel[data-n="9"] .an-cell:nth-child(9) { border-right: 0 } }
.an-journey { list-style: none; margin: 0; padding: 0; display: grid; gap: 0 }
.an-journey > li { position: relative; padding: 0 0 0 22px } .an-journey > li::before { content: ''; position: absolute; left: 6px; top: 0; bottom: 0; width: 2px; background: color-mix(in srgb, var(--ink) 10%, transparent) } .an-journey > li:first-child::before { top: 14px } .an-journey > li:last-child::before { bottom: auto; height: 14px }
.an-jstep { position: relative; padding: 14px 0 18px } .an-jstep::before { content: ''; position: absolute; left: -20px; top: 18px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent2); box-shadow: 0 0 0 3px var(--card) } .an-jchat::before { background: var(--ink3) }
.an-jhead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin-bottom: 10px } .an-jtext { flex-basis: 100%; font-size: 13px; color: var(--ink2) }
.an-jbar { position: relative; height: 26px; border-radius: 9px; background: color-mix(in srgb, var(--ink) 6%, transparent); overflow: hidden } .an-jfill { position: absolute; inset: 0 auto 0 0; background: var(--accent2); border-radius: 9px; min-width: 3px }
.an-jrow { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: center }
.an-jsent { display: flex; align-items: baseline; gap: 5px; font-size: 13px; color: var(--ink3); white-space: nowrap; font-variant-numeric: tabular-nums } .an-jsent b { font-family: var(--fd); font-weight: 600; font-size: 20px; letter-spacing: -.01em; color: var(--ink) } .an-jsent i { font-style: normal }
.an-jmarks { display: flex; flex-wrap: wrap; align-items: stretch; gap: 8px; margin-top: 10px } .an-jmark { display: flex; flex-direction: column; gap: 1px; min-width: 96px; padding: 8px 11px; border: 1px solid var(--hair); border-radius: 10px; color: var(--ink3) } .an-jmark i { font-style: normal; font-family: var(--m); font-size: 10px; letter-spacing: .1em; text-transform: uppercase } .an-jmark b { font-family: var(--fd); font-weight: 600; font-size: 18px; letter-spacing: -.01em; color: var(--ink); font-variant-numeric: tabular-nums } .an-jmark small { font-size: 11.5px; font-variant-numeric: tabular-nums } .an-jmark.bad.some b { color: #e11d48 } .an-jmark.is-conv b { color: #059669 } .an-jmark:not(.some) b { color: var(--ink3) }
.an-jopen { align-self: center; margin-left: auto; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--accent2); background: none; border: 1px solid var(--hair); border-radius: 999px; padding: 6px 12px; cursor: pointer } .an-jopen:hover { border-color: var(--ink3) }
.an-between { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 18px; padding: 8px 0 8px 0; font-size: 12.5px; color: var(--ink3); border-top: 1px dashed color-mix(in srgb, var(--hair) 80%, transparent) } .an-between span { display: inline-flex; gap: 6px; align-items: baseline } .an-between i { font-style: normal } .an-between b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums } .an-between em { font-style: normal; font-family: var(--m); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; margin-left: auto }
.an-jend { padding-top: 12px !important; padding-bottom: 6px } .an-jend::after { content: ''; position: absolute; left: 3px; top: 16px; width: 8px; height: 8px; border-radius: 50%; background: var(--ink3); box-shadow: 0 0 0 3px var(--card) } .an-jdone { display: inline-flex; align-items: baseline; gap: 8px } .an-jdone i { font-style: normal; font-family: var(--m); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3) } .an-jdone b { font-family: var(--fd); font-weight: 600; font-size: 20px; letter-spacing: -.01em } .an-jdone small { font-size: 12px; color: var(--ink3) }
.an-jnums { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 10px } .an-jnums span { display: flex; flex-direction: column; gap: 2px } .an-jnums i { font-style: normal; font-family: var(--m); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3) } .an-jnums b { font-family: var(--fd); font-weight: 600; font-size: 20px; letter-spacing: -.01em } .an-jnums small { font-size: 12px; font-weight: 400; color: var(--ink3) }
.an-jchoices { max-width: 620px }
.an-jdetail { margin-top: 14px; padding: 14px 16px; border: 1px solid var(--hair); border-radius: 14px; background: color-mix(in srgb, var(--ink) 2.5%, transparent); display: grid; gap: 16px } .an-jdetail h3 { margin: 0 0 8px; font-size: 13.5px; font-weight: 600 } .an-jdetail h3 small { font-weight: 400; color: var(--ink3) }
.an-jgrid { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 16px } .an-linktable td.an-td-title { max-width: 0 } .an-linktable code { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block }
.an-jfigs { display: grid; gap: 10px; align-content: start } .an-jfig { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border: 1px solid var(--hair); border-radius: 12px; background: var(--card) } .an-jfig b { font-family: var(--fd); font-weight: 600; font-size: 24px; letter-spacing: -.02em; line-height: 1 } .an-jfig small { font-size: 11.5px; color: var(--ink3) }
.an-opensnote { margin-top: 14px; font-size: 12px }
@media (max-width: 760px) {
  .an-jgrid { grid-template-columns: 1fr } .an-jnums { grid-template-columns: repeat(2, minmax(0, 1fr)) } .an-fnums { grid-template-columns: repeat(2, minmax(0, 1fr)) }
  .an-jhours { overflow-x: auto } .an-jrow { grid-template-columns: 1fr } .an-jopen { margin-left: 0; flex-basis: 100% }
}
</style>

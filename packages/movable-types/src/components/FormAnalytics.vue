<script setup>
/*
 * Form analytics — one form at a time, as Typeform reports one. The index is every form with its numbers in the
 * window (started, finished, completion, the last response); a form opens to its own results: the numbers with
 * their sparks, started and finished a day, where people drop off (each step reached, and how many left at it), and
 * every question in the form's order — a choice's spread as bars, a scale's or rating's distribution with its
 * average, a written answer counted (read in Responses, never listed here). Read through admin_forms(days); the
 * questions and their kinds from the compiled form. Wears the analytics idiom (analytics.css). Words: `## forms` in
 * content/app/ui/analytics.md, the states `## page`.
 */
import { ref, computed, onMounted, watch } from 'vue'
import VChart from 'vue-echarts'
import { base, tokens, PALETTE, chartKind, timeSeries, timeAxis } from '../lib/charts-theme.js'
import ChartKind from './ChartKind.vue'
import './analytics.css'
import { us } from '@platform-kit/kit/lib/content.js'
import { supabase, configured } from '@platform-kit/kit/lib/supabase.js'
import { isSignedIn } from '@platform-kit/kit/lib/auth.js'
import { forms as FORMS } from '#content'

const props = defineProps({ name: { type: String, default: '' } })
const emit = defineEmits(['open', 'back', 'responses'])
const T = us('analytics')
const H = T.page.head
const FM = T.forms ? T.forms.ui : {}
/* a word with a number in it — never a throw on a word a stale build lacks */
const wn = (key, n) => String(FM[key] || '').replace('{n}', n)
const days = ref(30)
const state = ref('idle')      /* idle | loading | ok | denied | error */
const stats = ref(null)

async function load() {
  if (!configured || !isSignedIn.value) { state.value = 'idle'; stats.value = null; return }
  state.value = 'loading'
  const { data, error } = await supabase.rpc('admin_forms', { days: days.value })
  if (error) { state.value = (error.code === '42501' || /admin only|permission/i.test(error.message || '')) ? 'denied' : 'error'; return }
  stats.value = data || []
  state.value = 'ok'
}
onMounted(load)
watch([isSignedIn, days], load)
const chartKey = ref(0)
onMounted(() => { const mo = new MutationObserver(() => chartKey.value++); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }) })

/* ---- helpers ---- */
const num = (n) => new Intl.NumberFormat().format(Math.round(n || 0))
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const secs = (s) => (!s ? '—' : s >= 60 ? Math.floor(s / 60) + 'm ' + String(Math.round(s % 60)).padStart(2, '0') + 's' : Math.round(s) + 's')
const dayKey = (d) => String(d || '').slice(0, 10)
const day = (d) => { const t = new Date(dayKey(d) + 'T00:00:00'); return isNaN(t) ? '' : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
const when = (d) => { if (!d) return FM['last-none']; const t = new Date(d); return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }
const rangeLabel = computed(() => H.range.replace('{days}', days.value))
function openAuth() { if (window.DLauth) window.DLauth.open() }
const formOf = (slug) => (FORMS || []).find((x) => x.slug === slug)
const formTitle = (slug) => { const f = formOf(slug); return f ? f.title : slug }
const kindWord = (k) => FM['kind-' + ({ text: 'text', url: 'text', tel: 'text', password: 'text', email: 'email', number: 'number', select: 'choice', choice: 'choice', picture: 'choice', rating: 'scale', scale: 'scale', datetime: 'date', date: 'date', time: 'date', file: 'file' }[k] || 'text')] || k
/* a question as asked, a template's variable ({$ name $}) shown as an ellipsis */
const plainQ = (q) => (q.question && q.question !== '...' ? q.question : q.name).replace(/\{\$[^}]*\$\}/g, '…')
const isChoice = (k) => ['select', 'choice', 'picture'].includes(k)
const isScale = (k) => ['rating', 'scale', 'number'].includes(k)

/* ---- the index: every form the window saw, and every published form that saw nothing ---- */
const index = computed(() => {
  const seen = stats.value || []
  const rows = seen.map((s) => ({ ...s, title: formTitle(s.form) }))
  for (const f of FORMS || []) if (!seen.some((s) => s.form === f.slug)) rows.push({ form: f.slug, title: f.title, started: 0, finished: 0, completion: 0, last_at: null, series: [] })
  return rows
})

/* ---- one form ---- */
const cur = computed(() => (props.name ? (stats.value || []).find((s) => s.form === props.name) || null : null))
const curForm = computed(() => (props.name ? formOf(props.name) : null))
const tiles = computed(() => { const c = cur.value; if (!c) return []; return [
  { label: FM.started, value: num(c.started), spark: 'started' },
  { label: FM.finished, value: num(c.finished), spark: 'finished' },
  { label: FM.completion, value: c.completion + '%' },
  { label: FM.time, value: secs(c.avg_seconds) },
  ...(c.passed ? [{ label: FM.passed, value: num(c.passed) + ' · ' + pct(c.passed, c.finished) + '%' }] : []),
] })
/* the series over every day of the window, the days with nothing filled in */
const series = computed(() => {
  const c = cur.value; if (!c) return []
  const by = Object.fromEntries((c.series || []).map((r) => [dayKey(r.day), r]))
  const out = []; const t = new Date(); t.setHours(0, 0, 0, 0)
  for (let i = days.value - 1; i >= 0; i--) { const d = new Date(t); d.setDate(d.getDate() - i); const k = d.toISOString().slice(0, 10); out.push({ day: k, started: (by[k] || {}).started || 0, finished: (by[k] || {}).finished || 0 }) }
  return out
})
const sparkPath = (key) => { const rows = series.value; if (rows.length < 2) return ''; const max = Math.max(1, ...rows.map((r) => r[key] || 0)); return rows.map((r, i) => `${(i / (rows.length - 1)) * 100},${30 - ((r[key] || 0) / max) * 26 - 2}`).join(' ') }
const overTimeOption = computed(() => {
  void chartKey.value; void chartKind.value
  const b = base(), t = tokens()
  const line = (name, key, color, area) => timeSeries({ name, color, area, data: series.value.map((r) => r[key]) })
  return { ...b, xAxis: timeAxis({ ...b.xAxis, data: series.value.map((r) => day(r.day)) }), yAxis: { ...b.yAxis, minInterval: 1 }, series: [line(FM.started, 'started', t.accent, true), line(FM.finished, 'finished', PALETTE[1])] }
})
/* the steps: each body slide by its number, named by its questions; reached from the answers' slides, the first step
   is everyone who started */
const steps = computed(() => {
  const c = cur.value, f = curForm.value; if (!c) return []
  const fields = f ? f.model.fields : []
  const reached = Object.fromEntries((c.slides || []).map((s) => [Number(s.slide), Number(s.reached)]))
  const nums = [...new Set([...fields.map((x) => x.slide), ...Object.keys(reached).map(Number)])].filter((n) => n > 0).sort((a, b) => a - b)
  let prev = c.started
  return nums.map((n) => {
    const qs = fields.filter((x) => x.slide === n).map((x) => plainQ(x))
    const r = n === nums[0] ? Math.max(reached[n] || 0, c.started) : reached[n] || 0
    const row = { n, label: qs[0] || wn('slide', n), more: qs.length > 1 ? qs.length - 1 : 0, reached: r, share: pct(r, c.started), left: Math.max(0, prev - r), leftShare: pct(Math.max(0, prev - r), prev) }
    prev = r; return row
  })
})
/* the questions, in the form's order: what the compiled form says each is, joined to what was answered */
const questions = computed(() => {
  const c = cur.value, f = curForm.value; if (!c) return []
  const by = Object.fromEntries((c.fields || []).map((x) => [x.field, x]))
  const reachedOf = (n) => { const s = steps.value.find((x) => x.n === n); return s ? s.reached : c.started }
  const fields = f ? f.model.fields : (c.fields || []).map((x) => ({ name: x.field, kind: 'text', question: x.field, slide: null }))
  return fields.map((q) => {
    const a = by[q.name] || { answered: 0, values: [] }
    const vals = (a.values || []).filter((v) => v.value !== null && v.value !== '')
    const scale = isScale(q.kind) && vals.length && vals.every((v) => !isNaN(Number(v.value)))
    let rows = [], avg = null
    if (isChoice(q.kind) || scale) {
      rows = scale ? vals.slice().sort((x, y) => Number(x.value) - Number(y.value)) : vals
      const max = Math.max(1, ...rows.map((v) => v.n))
      rows = rows.map((v) => ({ ...v, w: (v.n / max) * 100, share: pct(v.n, a.answered) }))
      if (scale) { const tot = vals.reduce((s, v) => s + v.n, 0); avg = tot ? Math.round((vals.reduce((s, v) => s + Number(v.value) * v.n, 0) / tot) * 10) / 10 : null }
    }
    return { name: q.name, question: plainQ(q), kind: q.kind, kindWord: kindWord(q.kind), answered: a.answered, reached: reachedOf(q.slide), rows, avg, free: !(isChoice(q.kind) || scale) }
  })
})
</script>

<template>
  <div class="ui-page an">
    <!-- ============ one form ============ -->
    <template v-if="name">
      <div class="an-head">
        <div>
          <button type="button" class="an-crumb" @click="emit('back')">← {{ FM.back }}</button>
          <h1 class="an-title">{{ formTitle(name) }}</h1>
          <p class="an-subtitle">{{ FM['subtitle-one'] }}</p>
        </div>
        <div v-if="state === 'ok'" class="an-controls">
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
      <template v-else-if="state === 'ok'">
        <div class="an-range"><span class="an-rangelabel">{{ rangeLabel }}</span><span v-if="cur" class="an-vs">{{ FM.last }}: {{ when(cur.last_at) }}</span></div>
        <p v-if="!cur" class="an-empty">{{ FM['none-form'] }}</p>
        <template v-else>
          <div class="an-panel" :class="'an-panel' + tiles.length">
            <div v-for="t in tiles" :key="t.label" class="an-cell">
              <span class="an-k">{{ t.label }}</span>
              <div class="an-cellrow">
                <b>{{ t.value }}</b>
                <svg v-if="t.spark && sparkPath(t.spark)" class="an-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline :points="sparkPath(t.spark)" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" /></svg>
              </div>
            </div>
          </div>

          <section class="an-card">
            <div class="an-ch"><h2>{{ FM['over-time'] }}</h2><p>{{ FM['over-time-subtitle'] }}</p></div>
            <VChart :key="'ft' + chartKey" class="an-chart sm" :option="overTimeOption" autoresize />
          </section>

          <!-- where people drop off: the steps as a funnel -->
          <section class="an-card">
            <div class="an-ch"><h2>{{ FM.dropoff }}</h2><p>{{ FM['dropoff-subtitle'] }}</p></div>
            <ol class="an-funnel">
              <li v-for="s in steps" :key="s.n">
                <div class="an-step">
                  <span class="an-stepn">{{ wn('slide', s.n) }}</span>
                  <span class="an-stepq">{{ s.label }}<i v-if="s.more"> +{{ s.more }}</i></span>
                </div>
                <div class="an-funnelbar"><span class="an-funnelfill" :style="{ width: s.share + '%' }" /></div>
                <span class="an-reached"><b>{{ num(s.reached) }}</b><i>· {{ s.share }}% {{ FM.reached }}</i></span>
                <span class="an-left" :class="{ some: s.left }">{{ s.left ? '−' + num(s.left) + ' · ' + s.leftShare + '% ' + FM.left : ' ' }}</span>
              </li>
            </ol>
          </section>

          <!-- every question -->
          <h2 class="an-group">{{ FM.answers }}</h2>
          <p class="an-quiet">{{ FM['answers-subtitle'] }}</p>
          <div class="an-grid2">
            <section v-for="q in questions" :key="q.name" class="an-card an-q">
              <div class="an-ch an-qh">
                <div><h2 class="an-qtitle">{{ q.question }}</h2><p class="an-promptmeta">{{ q.kindWord }} · {{ wn('answered', num(q.answered)) }} · {{ wn('of-reached', num(q.reached)) }}</p></div>
                <span v-if="q.avg !== null" class="an-avg"><b>{{ q.avg }}</b><i>{{ FM.average }}</i></span>
              </div>
              <ol v-if="q.rows.length" class="an-list an-list-titles">
                <li v-for="v in q.rows" :key="String(v.value)"><div class="an-rowtxt"><code>{{ v.value }}</code><b>{{ num(v.n) }} <i>· {{ v.share }}%</i></b></div><span class="an-track"><span class="an-fill" :style="{ width: v.w + '%' }" /></span></li>
              </ol>
              <p v-else-if="q.free && q.answered" class="an-none">{{ FM.free }} <a class="an-link" href="#" @click.prevent="emit('responses')">{{ FM.responses }} →</a></p>
              <p v-else class="an-none">{{ FM.none }}</p>
            </section>
          </div>
        </template>
      </template>
    </template>

    <!-- ============ the index: every form ============ -->
    <template v-else>
      <div class="an-head">
        <div>
          <h1 class="an-title">{{ FM['page-title'] }}</h1>
          <p class="an-subtitle">{{ FM.subtitle }}</p>
        </div>
        <div v-if="state === 'ok'" class="an-controls">
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
      <template v-else-if="state === 'ok'">
        <div class="an-range"><span class="an-rangelabel">{{ rangeLabel }}</span></div>
        <p v-if="!index.length" class="an-empty">{{ FM.none }}</p>
        <div class="an-grid3">
          <button v-for="f in index" :key="f.form" type="button" class="an-card an-formcard" @click="emit('open', f.form)">
            <span class="an-formtitle">{{ f.title }}</span>
            <span class="an-formnums">
              <span><i>{{ FM.started }}</i><b>{{ num(f.started) }}</b></span>
              <span><i>{{ FM.finished }}</i><b>{{ num(f.finished) }}</b></span>
              <span><i>{{ FM.completion }}</i><b>{{ f.completion }}%</b></span>
            </span>
            <span class="an-track"><span class="an-fill" :style="{ width: f.completion + '%' }" /></span>
            <span class="an-formfoot"><span>{{ FM.last }}: {{ when(f.last_at) }}</span><span class="an-formopen">{{ FM.open }} →</span></span>
          </button>
        </div>
      </template>
    </template>
  </div>
</template>

<style>
/* the form page's own pieces, on the shared idiom */
.an-panel4 { grid-template-columns: repeat(4, minmax(0, 1fr)) } .an-panel5 { grid-template-columns: repeat(5, minmax(0, 1fr)) } .an-panel5 .an-cell:nth-child(4n) { border-right: 1px solid var(--hair) } .an-panel5 .an-cell:nth-child(5n) { border-right: 0 }
.an-formcard { text-align: left; font: inherit; color: var(--ink); cursor: pointer; gap: 10px; transition: border-color .15s, transform .15s } .an-formcard:hover { border-color: var(--ink3); transform: translateY(-1px) }
.an-formtitle { font-family: var(--fd); font-weight: 600; font-size: 18px; letter-spacing: -.01em }
.an-formnums { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px } .an-formnums span { display: flex; flex-direction: column; gap: 2px } .an-formnums i { font-style: normal; font-family: var(--m); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3) } .an-formnums b { font-family: var(--fd); font-weight: 600; font-size: 22px; letter-spacing: -.01em }
.an-formfoot { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-size: 12.5px; color: var(--ink3); margin-top: 2px; min-width: 0 } .an-formfoot > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap } .an-formopen { color: var(--accent2); font-weight: 600; white-space: nowrap; flex: none }
.an-funnel { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px }
.an-funnel li { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(0, 2fr) 150px 170px; gap: 14px; align-items: center; padding: 8px 0; border-bottom: 1px solid color-mix(in srgb, var(--hair) 60%, transparent) } .an-funnel li:last-child { border-bottom: 0 }
.an-step { display: flex; flex-direction: column; gap: 2px; min-width: 0 } .an-stepn { font-family: var(--m); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3) } .an-stepq { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap } .an-stepq i { font-style: normal; font-weight: 400; color: var(--ink3) }
.an-funnelbar { position: relative; height: 22px; border-radius: 7px; background: color-mix(in srgb, var(--ink) 6%, transparent); overflow: hidden } .an-funnelfill { position: absolute; inset: 0 auto 0 0; background: var(--accent2); border-radius: 7px; min-width: 3px }
.an-reached { white-space: nowrap; font-variant-numeric: tabular-nums } .an-reached b { font-weight: 600; font-size: 14px } .an-reached i { font-style: normal; font-size: 12px; color: var(--ink3); margin-left: 5px }
.an-left { font-family: var(--m); font-size: 11.5px; color: var(--ink3); text-align: right; white-space: nowrap } .an-left.some { color: #e11d48 }
.an-qh { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px } .an-qtitle { font-family: var(--fd) !important; font-size: 16px !important; font-weight: 600 !important; letter-spacing: -.01em !important; text-transform: none !important; margin: 0 0 4px !important }
.an-avg { display: flex; flex-direction: column; align-items: flex-end; flex: none } .an-avg b { font-family: var(--fd); font-weight: 600; font-size: 26px; letter-spacing: -.02em; line-height: 1 } .an-avg i { font-style: normal; font-family: var(--m); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3) }
.an-link { color: var(--accent2); font-weight: 600; text-decoration: none } .an-link:hover { text-decoration: underline; text-underline-offset: 3px }
.an-quiet + .an-grid2 { margin-top: 0 }
@media (max-width: 900px) { .an-panel5, .an-panel4 { grid-template-columns: repeat(2, minmax(0, 1fr)) } .an-panel5 .an-cell:nth-child(4n), .an-panel4 .an-cell:nth-child(4n) { border-right: 0 } .an-panel5 .an-cell:nth-child(odd), .an-panel4 .an-cell:nth-child(odd) { border-right: 1px solid var(--hair) } .an-panel5 .an-cell, .an-panel4 .an-cell { border-bottom: 1px solid var(--hair) } .an-funnel li { grid-template-columns: 1fr 1fr; gap: 6px 12px } .an-funnel li .an-step { grid-column: 1 / -1 } .an-funnel li .an-funnelbar { grid-column: 1 / -1 } .an-left { text-align: right } }
</style>

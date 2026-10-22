<script setup>
/*
 * The Experiments view: one card per experiment — what it tests, its status
 * and dates, and each variant's numbers (exposures, conversions, rate, lift
 * over the runner-up) from the experiment_results RPC — with the actions an
 * editor takes on a test: pause / resume, end now, extend, declare a winner,
 * add a variant, edit. Every action patches the experiment file through the
 * admin API; the record itself is edited in the drawer.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { ROUTES, navigate } from '../../router.js'
import { supabase, configured } from 'platformkit/lib/supabase.js'
import { statusOf, endsAt, TWO_WEEKS } from 'platformkit/lib/experiments.js'
import { listItems, nextKey, duplicateItem, patchExperiment, today, plusDays, colFor } from './experimentOps.js'

const props = defineProps({ items: { type: Array, default: () => [] } })
const emit = defineEmits(['changed'])

/* the numbers */
const results = ref([])
const resultsErr = ref('')
async function loadResults() {
  if (!configured) { resultsErr.value = 'Supabase is not configured — no numbers.'; return }
  try {
    const { data, error } = await supabase.rpc('experiment_results')
    if (error) throw error
    results.value = data || []; resultsErr.value = ''
  } catch (e) { resultsErr.value = e.message || String(e) }
}
/* titles for the things variants point at */
const names = ref({ page: {}, ad: {} })
async function loadNames() {
  for (const kind of ['page', 'ad']) {
    try { const m = {}; for (const i of await listItems(kind)) m[i.name] = i; names.value[kind] = m } catch (e) { /* none */ }
  }
}
onMounted(() => { loadResults(); loadNames() })
watch(() => props.items, loadNames)

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—')
const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString())

const cards = computed(() => props.items.map((it) => {
  const rec = { id: it.name, ...it.data, variants: it.data.variants || [] }
  const state = results.value.find((r) => r.experiment === it.name) || null
  const rows = (state && state.variants) || []
  const total = rec.variants.reduce((n, v) => n + (v.weight > 0 ? v.weight : 0), 0)
  const variants = rec.variants.map((v) => {
    const r = rows.find((x) => x.variant === v.key) || { exposures: 0, conversions: 0 }
    const it2 = (names.value[rec.kind === 'ad' ? 'ad' : 'page'] || {})[v.item]
    return { ...v, title: it2 ? it2.title : v.item, missing: !it2 && Object.keys(names.value.page).length > 0,
      exposures: r.exposures || 0, conversions: r.conversions || 0, rate: r.exposures ? r.conversions / r.exposures : 0,
      share: total ? Math.round(((v.weight > 0 ? v.weight : 0) / total) * 100) : 0 }
  })
  const seen = variants.filter((v) => v.exposures > 0)
  const leader = seen.slice().sort((a, b) => b.rate - a.rate)[0] || null
  const others = leader ? seen.filter((v) => v !== leader) : []
  const runnerUp = others.length ? Math.max(...others.map((v) => v.rate)) : 0
  const lift = leader && runnerUp ? Math.round(((leader.rate - runnerUp) / runnerUp) * 100) : null
  const status = statusOf(rec, state)
  const ends = endsAt(rec, state)
  const started = state && state.started_at ? Date.parse(state.started_at) : null
  const winnerKey = rec.winner || (status === 'ended' && leader ? leader.key : '')
  const goal = rec.kind === 'ad' && !rec.goal ? 'a click on the ad' : 'a visit to ' + (rec.goal || '/app')
  const route = rec.kind === 'page' ? (variants.map((v) => ((names.value.page || {})[v.item] || {}).route).find(Boolean) || '') : ''
  return { ...rec, variants, leader, lift, status, ends, started, winnerKey, goal, route,
    exposures: variants.reduce((n, v) => n + v.exposures, 0), maxRate: Math.max(0.0001, ...variants.map((v) => v.rate)),
    endsDefault: !rec.ends && !started }
}))

/* ---- actions ---- */
const busy = ref('')
async function act(name, label, change) {
  busy.value = name + ':' + label
  try { await patchExperiment(name, change); emit('changed'); await loadResults() }
  catch (e) { alert(e.message) }
  finally { busy.value = '' }
}
const toggleActive = (c) => act(c.id, 'active', (d) => { d.active = c.active === false })
const endNow = (c) => act(c.id, 'end', (d) => { d.ends = today() })
const extend = (c) => act(c.id, 'extend', (d) => { const from = d.ends && d.ends > today() ? d.ends : (c.ends ? new Date(Math.max(c.ends, Date.now())).toISOString().slice(0, 10) : today()); d.ends = plusDays(from, 14) })
const reopen = (c) => act(c.id, 'reopen', (d) => { delete d.winner; d.ends = plusDays(today(), 14); d.active = true })
function declare(c, key) {
  if (!confirm(`Declare ${key} the winner of "${c.title}"? Everyone will see it from now on.`)) return
  act(c.id, 'winner', (d) => { d.winner = key })
}
async function addVariant(c) {
  const src = c.variants[c.variants.length - 1]
  if (!src) return edit(c)
  busy.value = c.id + ':add'
  try {
    const key = nextKey(c.variants)
    const item = await duplicateItem(c.kind, src.item, key)
    await patchExperiment(c.id, (d) => { d.variants = [...(d.variants || []), { key, item, weight: src.weight == null ? 1 : src.weight }] })
    emit('changed')
    navigate(ROUTES.admin + '/' + colFor(c.kind) + '/' + item)
  } catch (e) { alert(e.message) }
  finally { busy.value = '' }
}
const edit = (c) => navigate(ROUTES.admin + '/experiments/' + c.id)
const openItem = (c, v) => navigate(ROUTES.admin + '/' + colFor(c.kind) + '/' + v.item)
const STATUS = { running: 'Running', paused: 'Paused', ended: 'Ended' }
</script>

<template>
  <div class="xa">
    <p v-if="resultsErr" class="xa-err">{{ resultsErr }}</p>
    <div v-if="!cards.length" class="xa-empty">
      <b>No experiments yet.</b>
      <span>An experiment compares two or more pages on one route, or two or more ads, and tells you which one moves people. Make one with the button above: pick the page or ad, duplicate it as B, change what you want to test.</span>
    </div>
    <div v-for="c in cards" :key="c.id" class="xa-card" :class="'is-' + c.status">
      <div class="xa-head">
        <div class="xa-title">
          <h2>{{ c.title }}</h2>
          <code class="xa-id">{{ c.id }}</code>
        </div>
        <div class="xa-pills">
          <span class="xa-pill kind">{{ c.kind === 'ad' ? 'Ads' : 'Pages' }}<template v-if="c.route"> · {{ c.route }}</template></span>
          <span class="xa-pill" :class="c.status">{{ STATUS[c.status] }}</span>
        </div>
      </div>
      <div class="xa-meta">
        <span><i>Goal</i> {{ c.goal }}</span>
        <span><i>Started</i> {{ c.started ? fmtDate(c.started) : 'no visitors yet' }}</span>
        <span><i>Ends</i> {{ c.ends ? fmtDate(c.ends) : 'two weeks after the first visitor' }}</span>
        <span v-if="c.winnerKey"><i>Winner</i> {{ c.winnerKey }}{{ c.winner ? '' : ' (best rate)' }}</span>
        <span v-if="c.lift != null" class="xa-lift" :class="{ up: c.lift > 0 }"><i>Lift</i> {{ c.lift > 0 ? '+' : '' }}{{ c.lift }}%</span>
      </div>
      <table class="xa-table">
        <thead><tr><th>Variant</th><th>Shows</th><th class="n">Share</th><th class="n">Visitors</th><th class="n">Conversions</th><th class="n">Rate</th><th></th><th></th></tr></thead>
        <tbody>
          <tr v-for="v in c.variants" :key="v.key" :class="{ 'is-lead': c.leader && v.key === c.leader.key, win: v.key === c.winnerKey }">
            <td><code class="xa-key">{{ v.key }}</code>
              <span v-if="v.key === c.winnerKey" class="xa-tag">winner</span>
              <span v-else-if="c.status !== 'ended' && c.leader && v.key === c.leader.key" class="xa-tag is-lead">leading</span>
            </td>
            <td><button type="button" class="xa-link" :class="{ missing: v.missing }" @click="openItem(c, v)">{{ v.title }}<template v-if="v.missing"> — missing</template> ↗</button></td>
            <td class="n">{{ v.share }}%</td>
            <td class="n">{{ fmtN(v.exposures) }}</td>
            <td class="n">{{ fmtN(v.conversions) }}</td>
            <td class="n">{{ (v.rate * 100).toFixed(1) }}%</td>
            <td class="xa-ratecell"><span class="xa-rate" :style="{ width: (v.rate / c.maxRate) * 100 + '%' }" /></td>
            <td class="xa-rowact"><button v-if="!c.winner" type="button" class="xa-btn small" :disabled="!!busy" @click="declare(c, v.key)">Declare winner</button></td>
          </tr>
          <tr v-if="!c.variants.length"><td colspan="8" class="xa-none">No variants — edit the experiment to add some.</td></tr>
        </tbody>
      </table>
      <div class="xa-acts">
        <button type="button" class="xa-btn" :disabled="!!busy" @click="edit(c)">Edit</button>
        <button type="button" class="xa-btn" :disabled="!!busy || !c.variants.length" @click="addVariant(c)">{{ busy === c.id + ':add' ? 'Copying…' : '+ Add variant' }}</button>
        <template v-if="c.status !== 'ended'">
          <button type="button" class="xa-btn" :disabled="!!busy" @click="toggleActive(c)">{{ c.status === 'paused' ? 'Resume' : 'Pause' }}</button>
          <button type="button" class="xa-btn" :disabled="!!busy" @click="extend(c)">Extend two weeks</button>
          <button type="button" class="xa-btn" :disabled="!!busy" @click="endNow(c)">End now</button>
        </template>
        <button v-else type="button" class="xa-btn" :disabled="!!busy" @click="reopen(c)">Reopen for two weeks</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.xa { display: flex; flex-direction: column; gap: 18px; padding: 4px 0 40px }
.xa-err { margin: 0; font-size: 13px; color: #b91c1c }
.xa-empty { display: flex; flex-direction: column; gap: 6px; max-width: 560px; padding: 26px 28px; border: 1px dashed var(--hair); border-radius: 14px; font-size: 14px; color: var(--ink2) }
.xa-empty b { color: var(--ink) }
.xa-card { border: 1px solid var(--hair); border-radius: 16px; background: var(--paper); padding: 18px 22px 16px }
.xa-card.is-ended { background: color-mix(in srgb, var(--wash) 60%, var(--paper)) }
.xa-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap }
.xa-title { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap }
.xa-title h2 { margin: 0; font-family: var(--fd); font-size: 21px; font-weight: 600; letter-spacing: -.01em; color: var(--ink) }
.xa-id { font-family: var(--m); font-size: 11.5px; color: var(--ink3) }
.xa-pills { display: flex; gap: 8px }
.xa-pill { font-family: var(--m); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; border-radius: 999px; padding: 4px 9px; border: 1px solid var(--hair); color: var(--ink3) }
.xa-pill.running { color: #059669; border-color: #05966955 }
.xa-pill.paused { color: #b45309; border-color: #b4530955 }
.xa-pill.ended { color: var(--ink3) }
.xa-meta { display: flex; gap: 22px; flex-wrap: wrap; margin: 10px 0 14px; font-size: 13px; color: var(--ink2) }
.xa-meta i { font-style: normal; font-family: var(--m); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); margin-right: 6px }
.xa-lift.up { color: #059669 }
.xa-table { width: 100%; border-collapse: collapse; font-size: 13.5px }
.xa-table th { text-align: left; font-family: var(--m); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); font-weight: 500; padding: 6px 10px 8px; border-bottom: 1px solid var(--hair) }
.xa-table td { padding: 10px 10px; border-bottom: 1px solid var(--hair); vertical-align: middle }
.xa-table tr:last-child td { border-bottom: 0 }
.xa-table .n { text-align: right; font-variant-numeric: tabular-nums }
.xa-table tr.win td { background: color-mix(in srgb, var(--accent) 6%, transparent) }
.xa-key { font-family: var(--m); font-weight: 600; font-size: 13px; color: var(--ink) }
.xa-tag { margin-left: 8px; font-family: var(--m); font-size: 9.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent2) }
.xa-tag.is-lead { color: #059669 }
.xa-link { font: inherit; color: var(--ink); background: none; border: 0; padding: 0; cursor: pointer; text-align: left }
.xa-link:hover { color: var(--accent2); text-decoration: underline }
.xa-link.missing { color: #b91c1c }
.xa-ratecell { width: 140px }
.xa-rate { display: block; height: 6px; border-radius: 3px; background: var(--accent); min-width: 2px }
.xa-rowact { text-align: right; white-space: nowrap }
.xa-none { color: var(--ink3); text-align: center; padding: 16px }
.xa-acts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--hair) }
.xa-btn { font: inherit; font-size: 13px; color: var(--ink2); background: var(--paper); border: 1px solid var(--hair); border-radius: 999px; padding: 7px 13px; cursor: pointer }
.xa-btn:hover:not(:disabled) { color: var(--ink); border-color: var(--ink3) }
.xa-btn:disabled { opacity: .5; cursor: default }
.xa-btn.small { font-size: 12px; padding: 4px 10px }
</style>

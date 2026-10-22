<script setup>
/*
 * Funnels: the drip emails, each a file under content/funnels — an audience (who), steps (what,
 * and how long after the last), a cooldown of its own — sent by the funnels-run function every
 * hour under the policy's counts (content/emails/policy.md). The list is the funnels, one line
 * each, with the sending rules (the policy, the reach) behind a button; the editor is one view
 * at a time — Audience (AudienceEditor: only the rules it has), Emails (the step in hand and
 * how it arrives — an email after a wait, or a chat prompt the site shows when its triggers
 * hold, edited as its parts in ChatPromptEditor, never as the file's grammar), Settings — with what the runner would send for THIS funnel behind "Preview a
 * run". Everything goes through the content pipe (the funnels model and the policy); a save compiles beside the functions.
 */
import { moduleOn } from 'platformkit/lib/modules.js'
import { ref, computed, watch, onMounted } from 'vue'
import { supabase, configured as supabaseOn } from 'platformkit/lib/supabase.js'
import { isSignedIn, session, onIdentity } from 'platformkit/lib/auth.js'
import AudienceEditor from './AudienceEditor.vue'
import ChatPromptEditor from './ChatPromptEditor.vue'
import SpanField from './SpanField.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import { parseWhen, describeWhen, splitChoices } from 'platformkit/lib/support/when.js'
import './admin-ui.css'

const props = defineProps({ name: { type: String, default: '' } })
const emit = defineEmits(['open', 'back', 'analytics'])
import pipe from '../../lib/admin/api.js'
import { us, ug } from 'platformkit/lib/strings.js'
import { modules } from '#site'
import AdminHead from './AdminHead.vue'
/* the page's own name and its one line, from the admin's words — the same two the shell reads
   when it draws a head, so a page is never named twice in two files */
const PAGE = { title: (ug('admin', 'rail').views || {})['funnels'] || '', lead: (ug('admin', 'leads').main || {})['funnels'] || '' }
/* the buttons in this page's head — words, like every other word in the product */
const A = ug('admin', 'actions')['funnels'] || {}
/* the view the editor holds: the funnels (each with its steps and its audience described), the blasts, the policy, the compiled designs */
async function loadView() {
  const [funnels, blasts, policy, designs] = await Promise.all([pipe.items('funnels'), pipe.items('blasts'), pipe.read('policy', 'policy'), pipe.options('designs')])
  return { funnels, blasts, policy: policy.data || {}, designs: designs.map((d) => d.value) }
}

const data = ref(null), stats = ref(null)
const loading = ref(true), msg = ref('')
async function load() { loading.value = true; try { data.value = await loadView(); await loadStats() } catch (e) { msg.value = e.message } finally { loading.value = false } }
async function loadStats() { if (!supabaseOn || !isSignedIn.value) return; try { const { data: s } = await supabase.rpc('email_stats'); stats.value = s } catch (e) { /* none */ } }
onMounted(load)
onIdentity((id) => { if (id) loadStats() })
const statOf = (id) => { const rows = stats.value && stats.value.sent ? stats.value.sent.filter((x) => x.email_id === id) : []; return { n: rows.reduce((a, x) => a + x.n, 0), opened: rows.reduce((a, x) => a + x.opened, 0), clicked: rows.reduce((a, x) => a + x.clicked, 0) } }
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—')
const totals = (steps) => steps.reduce((t, s) => { const x = statOf(s.id); return { n: t.n + x.n, opened: t.opened + x.opened, clicked: t.clicked + x.clicked } }, { n: 0, opened: 0, clicked: 0 })
const membersOf = (name) => (stats.value && stats.value.members && stats.value.members.find((m) => m.funnel === name)) || { n: 0, done: 0 }
/* one line saying what a funnel is: its numbers when it has any, else its shape */
const line = (f) => { const t = totals(f.steps), m = membersOf(f.name); const em = f.steps.filter((s) => s.channel !== 'chat').length, ch = f.steps.length - em; const n = em + (em === 1 ? ' email' : ' emails') + (ch ? ' · ' + ch + (ch === 1 ? ' chat prompt' : ' chat prompts') : ''); return t.n ? `${n} · ${m.n} in it · ${t.n} sent · ${pct(t.opened, t.n)} opened · ${pct(t.clicked, t.n)} clicked` : `${n} · nothing sent yet` }

/* ---- the sending rules: the policy, behind a button ---- */
const rulesOpen = ref(false)
const policy = ref({ daily: 1, weekly: 3, monthly: 8, 'blasts-respect-cooldown': true, 'recordings-keep': 0, 'session-reminders': [24, 1] })
/* the counts, and the one clock this panel edits — a call's recording's keep (session-recordings); the desk's clocks stay in the file */
const policyOf = (d) => ({ daily: d.policy.daily ?? 1, weekly: d.policy.weekly ?? 3, monthly: d.policy.monthly ?? 8, 'blasts-respect-cooldown': d.policy['blasts-respect-cooldown'] !== false, 'recordings-keep': d.policy['recordings-keep'] ?? 0, 'session-reminders': remindersOf(d.policy['session-reminders']) })
/* the reminders before a native session: hours, largest first — a list of number fields to add and remove, never a comma string (absent in the file = 24 and 1) */
const remindersOf = (v) => (v === undefined || v === null ? [24, 1] : (Array.isArray(v) ? v : String(v).split(/[,\s]+/)).map(Number).filter((x) => Number.isFinite(x) && x > 0))
const RW = (us('emails').policy || {}).reminders || {}
const GW = (us('emails').funnel || {}).editor || {}
function addReminder() { policy.value['session-reminders'] = [...policy.value['session-reminders'], 1] }
function dropReminder(i) { policy.value['session-reminders'] = policy.value['session-reminders'].filter((_, j) => j !== i) }
const PW = (us('emails').policy || {}).recordings || {}
watch(data, (d) => { if (d) policy.value = policyOf(d) }, { immediate: true })
const policyDirty = computed(() => data.value && JSON.stringify(policy.value) !== JSON.stringify(policyOf(data.value)))
const savingPolicy = ref(false)
async function savePolicy() { savingPolicy.value = true; try { await pipe.save('policy', 'policy', { data: policy.value }); data.value = await loadView(); msg.value = '' } catch (e) { msg.value = e.message } finally { savingPolicy.value = false } }

/* ---- the editor ---- */
const VIEWS = [['audience', 'Audience'], ['emails', 'Emails'], ['settings', 'Settings']]
const view = ref('emails')
const cur = computed(() => (data.value && props.name ? data.value.funnels.find((f) => f.name === props.name) || null : null))
const form = ref(null), saved = ref(''), creating = ref(false)
const goalOk = (g) => !String(g || '').trim() || /^\/[^\s]*$/.test(String(g).trim())
const dirty = computed(() => !!form.value && JSON.stringify(form.value) !== saved.value)
function begin() {
  const f = cur.value
  if (!f) { form.value = null; return }
  form.value = { name: f.name, title: f.data.title || f.name, published: f.data.published !== false, design: f.data.design || 'campaign', cooldown: f.data.cooldown || '3d', goal: f.data.goal || '', audience: { ...(f.data.audience || {}) }, steps: f.steps.map((s) => ({ ...s })) }
  saved.value = JSON.stringify(form.value); open.value = 0; report.value = null
}
watch([cur, data], () => { if (!creating.value) begin() }, { immediate: true })
watch(() => props.name, () => { view.value = 'emails' })
function startNew() {
  creating.value = true; view.value = 'emails'
  form.value = { name: '', title: '', published: false, design: 'campaign', cooldown: '3d', goal: '', audience: {}, steps: [{ title: 'The first note', after: '0d', subject: '', body: '' }] }
  saved.value = ''; open.value = 0
}
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
watch(() => form.value && form.value.title, (t) => { if (creating.value && form.value) form.value.name = slug(t) })
const saving = ref(false)
async function save() {
  if (!form.value) return
  saving.value = true; msg.value = ''
  try {
    const f = form.value
    const steps = f.steps.map((s) => ({ ...s, title: s.title && !/^(Step \d+|The first note)$/.test(s.title) ? s.title : (s.channel === 'chat' ? (s.body || 'Prompt').split('\n')[0].replace(/[#*_]/g, '').trim().slice(0, 40) : (s.subject || s.title || 'Step')) }))
    await pipe.save('funnels', f.name, { data: { title: f.title, published: f.published, design: f.design, cooldown: f.cooldown, goal: (f.goal || '').trim() || undefined, audience: f.audience }, parsed: { steps } }, { create: creating.value })
    data.value = await loadView()
    const was = creating.value; creating.value = false
    if (was) emit('open', f.name); else begin()
    msg.value = 'Saved'
  } catch (e) { msg.value = e.message } finally { saving.value = false }
}
async function remove() {
  if (!cur.value || !confirm(`Delete the funnel “${cur.value.data.title || cur.value.name}”? Its file goes; what was sent stays in the log.`)) return
  try { await pipe.remove('funnels', cur.value.name); data.value = await loadView(); emit('back') } catch (e) { msg.value = e.message }
}
function discard() { if (creating.value) { creating.value = false; form.value = null; emit('back') } else begin() }

/* the steps */
const open = ref(0)
const addStep = (channel = 'email') => { form.value.steps.push({ title: `Step ${form.value.steps.length + 1}`, channel, after: '3d', subject: '', when: channel === 'chat' ? 'on-site 30s' : '', teaser: '', image: '', body: '' }); open.value = form.value.steps.length - 1 }
/* an email's place among the emails (a chat prompt is outside the sequence) */
const emailIndex = (i) => form.value.steps.slice(0, i + 1).filter((s) => !isChat(s)).length
const dropStep = (i) => { if (form.value.steps.length <= 1) return; form.value.steps.splice(i, 1); open.value = Math.max(0, Math.min(open.value, form.value.steps.length - 1)) }
const move = (i, d) => { const s = form.value.steps; const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; open.value = j }
const spanOk = (v) => /^\s*\d+(\.\d+)?\s*[dwh]?\s*$/i.test(String(v || ''))
/* a chat step's triggers: the line as words, and what is wrong with it */
const whenOf = (s) => parseWhen(s.when)
const whenWords = (s) => { const { when, errors } = whenOf(s); return errors.length ? errors[0] : Object.keys(when).length ? describeWhen(when) : 'no trigger yet' }

const isChat = (s) => s && s.channel === 'chat'
const promptOf = (s) => splitChoices(s ? s.body : '')
const isDefault = (s) => !!whenOf(s).when.default
const NAME_TAG = '{{name}}'

/* the preview: the open step's markdown as html (the server), through the design (the function) */
const preview = ref(''), previewing = ref(false), previewErr = ref(''), showPreview = ref(true)
let timer = null
async function renderPreview() {
  const s = form.value && form.value.steps[open.value]
  if (s && s.channel === 'chat') return
  if (!s || !showPreview.value) return
  previewing.value = true; previewErr.value = ''
  try {
    const { html } = await pipe.action('funnels', 'preview', { body: s.body })
    if (!supabaseOn || !isSignedIn.value) { preview.value = html; return }
    const { data: r, error } = await supabase.functions.invoke('send-email', { body: { kind: form.value.design, sample: { subject: s.subject, body: html, name: 'Ada' }, subject: s.subject } })
    if (error) throw error
    if (r && r.error) throw new Error(r.error)
    preview.value = r.html
  } catch (e) { previewErr.value = e.message || 'Could not render' } finally { previewing.value = false }
}
watch([() => form.value && JSON.stringify(form.value.steps[open.value]), () => form.value && form.value.design, open, showPreview, view], () => { clearTimeout(timer); timer = setTimeout(renderPreview, 500) })
const me = computed(() => (session.value && session.value.user && session.value.user.email) || '')
const testing = ref(false)
async function sendTest() {
  const s = form.value && form.value.steps[open.value]; if (!s || !me.value) return
  testing.value = true; msg.value = ''
  try {
    const { html } = await pipe.action('funnels', 'preview', { body: s.body })
    const { data: r, error } = await supabase.functions.invoke('send-email', { body: { kind: form.value.design, to: me.value, sample: { subject: s.subject, body: html, name: 'Ada' }, subject: s.subject } })
    if (error) throw error
    if (r && r.error) throw new Error(r.error)
    msg.value = r.ok ? `Test sent to ${me.value}` : 'Not sent — the relay refused it'
  } catch (e) { msg.value = e.message } finally { testing.value = false }
}

/* what the runner would send for this funnel now */
const running = ref(false), report = ref(null)
async function previewRun() {
  if (!cur.value) return
  running.value = true; report.value = null
  try { const { data: r, error } = await supabase.functions.invoke('funnels-run', { body: { dry: true, funnel: cur.value.name } }); if (error) throw error; if (r && r.error) throw new Error(r.error); report.value = r.funnels[cur.value.name] || { off: true } }
  catch (e) { msg.value = e.message } finally { running.value = false }
}
</script>

<template>
  <div class="fn">
    <p v-if="loading" class="ui-muted">Loading…</p>

    <!-- ============ the list ============ -->
    <template v-else-if="data && !form">
      <AdminHead :title="PAGE.title"><template #sub><span v-html="PAGE.lead" /></template>
        <template #afterTitle><span class="ui-count">{{ data.funnels.length }}</span></template>
        <template #actions>
          <button type="button" class="ui-btn ui-ghost" :class="{ 'ui-on': rulesOpen }" @click="rulesOpen = !rulesOpen">{{ A.rules }}</button>
          <button type="button" class="ui-btn ui-primary" @click="startNew">{{ A.new }}</button>
        </template>
      </AdminHead>
      <div v-if="rulesOpen" class="ui-card fn-rules">
        <div class="ui-cardhead"><h3>Sending rules</h3><span>the most marketing emails one person gets — funnels and blasts together; an order's emails never count</span></div>
        <div class="fn-rules-row">
          <label class="ui-num"><input v-model.number="policy.daily" class="ui-input" type="number" min="0" /><span>a day</span></label>
          <label class="ui-num"><input v-model.number="policy.weekly" class="ui-input" type="number" min="0" /><span>a week</span></label>
          <label class="ui-num"><input v-model.number="policy.monthly" class="ui-input" type="number" min="0" /><span>in 30 days</span></label>
          <label class="ui-switch"><input v-model="policy['blasts-respect-cooldown']" type="checkbox" /><i /><span>Blasts respect it</span></label>
          <span class="ui-grow" />
          <template v-if="stats"><div class="ui-kpi"><b>{{ stats.reachable }}</b><span>reachable</span></div><div class="ui-kpi"><b>{{ stats.opted_out }}</b><span>opted out</span></div></template>
          <button v-if="policyDirty" type="button" class="ui-btn ui-primary ui-sm" :disabled="savingPolicy" @click="savePolicy">{{ savingPolicy ? 'Saving…' : 'Save' }}</button>
        </div>
        <div v-if="moduleOn('sessions')" class="fn-rules-row">
          <label class="ui-num fn-keep"><span>{{ PW.label }}</span><input v-model.number="policy['recordings-keep']" class="ui-input" type="number" min="0" /><span>{{ PW.unit }}</span></label>
        </div>
        <div v-if="moduleOn('sessions')" class="fn-rules-row fn-reminders">
          <span class="fn-rem-label">{{ RW.label }}</span>
          <span v-for="(h, i) in policy['session-reminders']" :key="i" class="fn-rem"><input v-model.number="policy['session-reminders'][i]" class="ui-input" type="number" min="1" max="720" /><span>{{ RW.unit }}</span><button type="button" class="ui-iconbtn" :title="RW.remove || '×'" @click="dropReminder(i)">×</button></span>
          <span v-if="!policy['session-reminders'].length" class="ui-hint">{{ RW.none }}</span>
          <button type="button" class="ui-btn ui-ghost ui-sm" @click="addReminder">{{ RW.add }}</button>
        </div>
        <p class="ui-hint">The runner goes every hour on its own. What it would send for a funnel is under that funnel, “Preview a run”.</p>
      </div>
      <p v-if="msg" class="ui-err">{{ msg }}</p>
      <div v-if="!data.funnels.length" class="ui-empty"><h3>No funnel yet</h3><p>A funnel is a few emails written once and sent on their own, days apart, to whoever matches its audience — a welcome, a nudge back, a word after a purchase.</p><button type="button" class="ui-btn ui-primary" @click="startNew">Write the first</button></div>
      <div v-else class="fn-list">
        <button v-for="f in data.funnels" :key="f.name" type="button" class="fn-item" @click="emit('open', f.name)">
          <span class="ui-pill" :class="f.data.published !== false ? 'ui-ok' : 'ui-off'">{{ f.data.published !== false ? 'On' : 'Off' }}</span>
          <span class="fn-item-main"><b>{{ f.data.title || f.name }}</b><small>{{ f.words.join(' · ') }}</small></span>
          <span class="fn-item-line">{{ line(f) }}</span>
          <span class="fn-item-go">›</span>
        </button>
      </div>
    </template>

    <!-- ============ the editor ============ -->
    <template v-else-if="form">
      <div class="ui-cardrow"><button type="button" class="ui-crumb" @click="discard">‹ Funnels</button><span class="ui-grow" /><button v-if="!creating" type="button" class="ui-btn ui-ghost ui-sm" @click="emit('analytics', form.name)">{{ GW.analytics }}</button></div>
      <div class="fn-head">
        <h2 class="fn-title">{{ form.title || 'New funnel' }}</h2>
        <span class="ui-grow" />
        <button v-if="!creating" type="button" class="ui-btn ui-ghost ui-sm" :disabled="running" title="What the hourly runner would send for this funnel now, without sending" @click="previewRun">{{ running ? 'Asking…' : 'Preview a run' }}</button>
        <label class="ui-switch"><input v-model="form.published" type="checkbox" /><i /><span>{{ form.published ? 'Sending' : 'Off' }}</span></label>
      </div>
      <div v-if="report" class="ui-card fn-report">
        <div class="ui-cardhead"><h3>What the runner would send now</h3><span>nothing was sent</span><span class="ui-grow" /><button type="button" class="ui-btn ui-ghost ui-sm" @click="report = null">Close</button></div>
        <p v-if="report.off" class="ui-muted">This funnel is off — turn it on and save, then ask again.</p>
        <template v-else>
          <p class="ui-muted">{{ report.audience }} match the audience · would send {{ report.sent }} · {{ report.held }} held by timing or the cooldown · {{ report.done }} through it</p>
          <ul v-if="report.would && report.would.length" class="fn-would"><li v-for="w in report.would.slice(0, 12)" :key="w">{{ w }}</li><li v-if="report.would.length > 12">… and {{ report.would.length - 12 }} more</li></ul>
        </template>
      </div>
      <div class="ui-seg" role="tablist">
        <button v-for="[k, label] in VIEWS" :key="k" type="button" role="tab" :aria-selected="view === k" :class="{ 'ui-on': view === k }" @click="view = k">{{ label }}<i v-if="k === 'audience'" class="fn-seg-n">{{ Object.keys(form.audience).length || '' }}</i><i v-else-if="k === 'emails'" class="fn-seg-n">{{ form.steps.length }}</i></button>
      </div>

      <!-- audience -->
      <div v-show="view === 'audience'" class="ui-card">
        <div class="ui-cardhead"><h3>Who it goes to</h3><span>every rule must hold; checked again before each email</span></div>
        <AudienceEditor v-model="form.audience" />
      </div>

      <!-- emails -->
      <div v-show="view === 'emails'" class="ui-card fn-stepcard">
        <div class="ui-steps">
          <button v-for="(s, i) in form.steps" :key="i" type="button" class="ui-step" :class="{ 'ui-on': open === i, 'fn-chatstep': isChat(s) }" @click="open = i"><i>{{ isChat(s) ? '💬' : emailIndex(i) }}</i><b>{{ isChat(s) ? (s.title && !/^Step \d+$/.test(s.title) ? s.title : (s.body || 'Untitled').split('\n')[0]) : (s.subject || s.title || 'Untitled') }}</b><small>{{ isChat(s) ? 'chat' : (emailIndex(i) === 1 ? 'on entering' : '+' + s.after) }}</small></button>
          <button type="button" class="ui-step ui-add" @click="addStep('email')">+ Add an email</button>
          <button type="button" class="ui-step ui-add" @click="addStep('chat')">+ Add a chat prompt</button>
        </div>
        <div v-if="form.steps[open]" class="fn-pane" :class="{ 'fn-wide': !showPreview }">
          <div class="fn-fields">
            <div class="ui-row">
              <label class="ui-field fn-channel"><span>Channel</span><select v-model="form.steps[open].channel" class="ui-select"><option value="email">Email</option><option value="chat">Chat prompt</option></select></label>
              <label v-if="isChat(form.steps[open])" class="ui-field fn-channel"><span>Name <small>· for this list</small></span><input v-model="form.steps[open].title" class="ui-input" placeholder="A word in the store" /></label>
              <label v-if="!isChat(form.steps[open])" class="ui-field"><span>Subject <small>· {{ NAME_TAG }} is the first name</small></span><input v-model="form.steps[open].subject" class="ui-input" placeholder="Where to begin, {{name}}" /></label>
              <label v-if="!isChat(form.steps[open])" class="ui-field fn-after" :class="{ 'pr-bad': !spanOk(form.steps[open].after) }"><span>{{ emailIndex(open) === 1 ? 'Sent' : 'After the last' }}</span>
                <div v-if="emailIndex(open) === 1" class="fn-static">on entering</div>
                <SpanField v-else v-model="form.steps[open].after" />
              </label>
            </div>
            <ChatPromptEditor v-if="isChat(form.steps[open])" :step="form.steps[open]" />
            <div v-else class="ui-field fn-grow"><span>The email</span><MarkdownEditor :key="'step' + open" v-model="form.steps[open].body" class="fn-md" /></div>
            <div class="ui-cardrow fn-stepacts">
              <button type="button" class="ui-btn ui-ghost ui-sm" :disabled="open === 0" @click="move(open, -1)">← Earlier</button>
              <button type="button" class="ui-btn ui-ghost ui-sm" :disabled="open >= form.steps.length - 1" @click="move(open, 1)">Later →</button>
              <span class="ui-grow" />
              <span v-if="form.steps[open].id && statOf(form.steps[open].id).n" class="ui-hint">sent to {{ statOf(form.steps[open].id).n }} · {{ pct(statOf(form.steps[open].id).opened, statOf(form.steps[open].id).n) }} opened · {{ pct(statOf(form.steps[open].id).clicked, statOf(form.steps[open].id).n) }} clicked</span>
              <button type="button" class="ui-btn ui-ghost ui-sm" @click="showPreview = !showPreview">{{ showPreview ? 'Hide preview' : 'Preview' }}</button>
              <button v-if="!isChat(form.steps[open])" type="button" class="ui-btn ui-ghost ui-sm" :disabled="testing || !me" @click="sendTest">{{ testing ? 'Sending…' : 'Send to me' }}</button>
              <button type="button" class="ui-btn ui-ghost ui-danger ui-sm" :disabled="form.steps.length <= 1" @click="dropStep(open)">Remove</button>
            </div>
          </div>
          <div v-if="showPreview" class="fn-previewcol">
            <div v-if="isChat(form.steps[open])" class="fn-teaserwrap"><div class="fn-teaser"><span class="fn-teaser-mark">D</span><div><small>the site</small><p>{{ promptOf(form.steps[open]).text || 'Hi there! Anything I can help you with?' }}</p><img v-if="form.steps[open].image" :src="form.steps[open].image" alt="" class="fn-teaser-img" /><div v-if="promptOf(form.steps[open]).choices.length" class="fn-teaser-choices"><span v-for="c in promptOf(form.steps[open]).choices" :key="c.key">{{ c.text }}</span></div><div class="fn-teaser-acts"><b>Reply</b><i v-if="!isDefault(form.steps[open])">Not now</i></div></div></div><p class="ui-hint">{{ isDefault(form.steps[open]) ? 'The panel rests on this whenever no other prompt is showing: the reader sees it every time they start a conversation, and may start as many as they like.' : 'How it appears above the chat launcher, once, when every trigger holds — ' + whenWords(form.steps[open]) + '. It becomes a conversation only if the reader replies.' }} Each choice picked is counted under Dashboard → Content analytics.</p></div>
            <p v-else-if="previewErr" class="ui-err">{{ previewErr }}</p>
            <iframe v-else class="ui-frame fn-preview" :srcdoc="preview" title="Preview" sandbox="" />
          </div>
        </div>
      </div>

      <!-- settings -->
      <div v-show="view === 'settings'" class="ui-card fn-settings">
        <label class="ui-field"><span>Title</span><input v-model="form.title" class="ui-input" placeholder="Welcome to the shelf" /></label>
        <label v-if="creating" class="ui-field"><span>File name <small>· given once</small></span><input v-model="form.name" class="ui-input ui-mono" placeholder="welcome" /></label>
        <code v-else class="ui-key">content/funnels/{{ form.name }}.md</code>
        <div class="ui-row">
          <label class="ui-field"><span>Design <small>· the frame the emails go through</small></span><select v-model="form.design" class="ui-select"><option v-for="d in data.designs" :key="d" :value="d">{{ d }}</option></select></label>
          <label class="ui-field" :class="{ 'pr-bad': !spanOk(form.cooldown) }"><span>Cooldown <small>· the least gap between two of its emails to one person</small></span><SpanField v-model="form.cooldown" /></label>
        </div>
        <label class="ui-field fn-goal" :class="{ 'pr-bad': !goalOk(form.goal) }"><span>{{ GW.goal }} <small>· {{ GW['goal-help'] }}</small></span><input v-model="form.goal" class="ui-input ui-mono" :placeholder="GW['goal-placeholder']" /></label>
        <div v-if="!creating" class="ui-cardrow fn-danger"><span class="ui-hint">Deleting removes the file; what was sent stays in the log, and no one gets a deleted email again.</span><span class="ui-grow" /><button type="button" class="ui-btn ui-ghost ui-danger ui-sm" @click="remove">Delete this funnel</button></div>
      </div>

      <div class="ui-savebar">
        <span class="ui-dirty" :class="{ 'ui-clean': !dirty }">{{ dirty ? 'Unsaved changes' : (msg || 'All changes saved') }}</span>
        <span v-if="dirty && msg" class="ui-err">{{ msg }}</span>
        <span class="ui-grow" />
        <button type="button" class="ui-btn ui-ghost" :disabled="!dirty && !creating" @click="discard">Discard</button>
        <button type="button" class="ui-btn ui-primary" :disabled="saving || !dirty || !form.name || !form.title" @click="save">{{ saving ? 'Saving…' : 'Save' }}</button>
      </div>
    </template>
    <p v-else class="ui-err">{{ msg }}</p>
  </div>
</template>

<style scoped>
.fn { display: flex; flex-direction: column; gap: 14px; width: 100%; flex: 1; min-height: 0; overflow-y: auto; margin: 0 -30px; padding: 2px 30px 20px }
.fn-rules { gap: 12px } .fn-rules-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap }
.fn-keep { gap: 10px } .fn-keep input { width: 80px }
.fn-reminders { gap: 10px } .fn-rem-label { font-size: 13px; color: var(--ink2) } .fn-rem { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink3) } .fn-rem input { width: 64px }
.fn-list { display: flex; flex-direction: column; gap: 8px }
.fn-item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 16px; padding: 14px 16px; border: 1px solid var(--hair); border-radius: 14px; background: var(--card); text-align: left; font: inherit; color: var(--ink); cursor: pointer; box-shadow: 0 1px 2px #0000000a; transition: border-color .15s, box-shadow .15s }
.fn-item:hover { border-color: var(--ink3); box-shadow: 0 1px 2px #0000000a, 0 14px 30px -22px #00000055 }
.fn-item-main { display: flex; flex-direction: column; gap: 3px; min-width: 0 } .fn-item-main b { font-family: var(--fd); font-weight: 600; font-size: 17px; letter-spacing: -.01em } .fn-item-main small { font-size: 12.5px; color: var(--ink3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.fn-item-line { font-size: 13px; color: var(--ink2); white-space: nowrap } .fn-item-go { color: var(--ink3); font-size: 18px }
.fn-head { display: flex; align-items: center; gap: 14px } .fn-title { font-family: var(--fd); font-weight: 600; font-size: 28px; letter-spacing: -.02em; margin: 0 }
.fn-would { margin: 4px 0 0; padding-left: 18px; font-family: var(--m); font-size: 11.5px; color: var(--ink3) }
.fn-seg-n { font-style: normal; font-family: var(--m); font-size: 10.5px; margin-left: 6px; color: var(--ink3) }
.fn-stepcard { gap: 14px }
.fn-pane { display: grid; grid-template-columns: minmax(340px, 1fr) minmax(360px, 560px); gap: 18px; align-items: stretch } .fn-pane.fn-wide { grid-template-columns: 1fr }
.fn-fields { display: flex; flex-direction: column; gap: 12px; min-width: 0 } .fn-grow { flex: 1 } .fn-after { max-width: 150px }
.fn-static { display: inline-flex; align-items: center; height: 34px; font-size: 13.5px; color: var(--ink2) }
.fn-md { min-height: 380px; flex: 1 } .fn-stepacts { gap: 6px }
.fn-previewcol { display: flex; flex-direction: column; min-width: 0 } .fn-channel { max-width: 170px }
.fn-teaserwrap { display: flex; flex-direction: column; gap: 14px; align-items: flex-end; padding: 24px; border: 1px dashed var(--hair); border-radius: 14px; background: color-mix(in srgb, var(--ink) 3%, var(--card)) }
.fn-teaser { display: flex; gap: 12px; width: 320px; padding: 14px; border-radius: 18px; background: var(--paper); border: 1px solid var(--hair); box-shadow: 0 26px 60px -28px #000c } .fn-teaser-mark { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; flex: none; border-radius: 50%; font-family: var(--fd); font-weight: 700; color: var(--paper); background: var(--ink) }
.fn-teaser small { display: block; font-family: var(--m); font-size: 9.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); margin: 2px 0 3px } .fn-teaser p { margin: 0; font-size: 14.5px; line-height: 1.45; white-space: pre-wrap } .fn-teaser-acts { display: flex; gap: 6px; margin-top: 10px } .fn-teaser-acts b, .fn-teaser-acts i { font-style: normal; font-size: 13px; font-weight: 600; border-radius: 999px; padding: 6px 13px } .fn-teaser-acts b { color: var(--paper); background: var(--ink) } .fn-teaser-acts i { color: var(--ink2); border: 1px solid var(--hair) }
.fn-chatstep i { font-size: 13px }
.fn-teaser-img { display: block; max-width: 100%; max-height: 160px; border-radius: 12px; margin-top: 8px }
.fn-teaser-choices { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px } .fn-teaser-choices span { font-size: 12.5px; color: var(--ink); border: 1px solid var(--ink); border-radius: 999px; padding: 5px 11px } .fn-preview { height: 100%; min-height: 520px }
.fn-settings { max-width: 720px } .fn-danger { padding-top: 10px; border-top: 1px solid var(--hair) }
@media (max-width: 1400px) { .fn-pane { grid-template-columns: 1fr } .fn-preview { min-height: 480px } }
</style>

<script setup>
/*
 * Blasts: one email, written once, sent once to everyone who matches — a file under
 * content/blasts with an audience, a subject and its markdown. The list is one line per blast;
 * the editor is one view at a time — Email (the words and how they arrive), Audience (only
 * the rules it has), Send (a count, a confirm, then the record). A sent blast is kept as the
 * record and never edited; a second press on one cut short finishes it (the function skips
 * whoever already had it). Everything goes through the content pipe (the blasts model, the policy, the funnels' preview action).
 */
import { ref, computed, watch, onMounted } from 'vue'
import { supabase, configured as supabaseOn } from 'platformkit/lib/supabase.js'
import { isSignedIn, session, onIdentity } from 'platformkit/lib/auth.js'
import AudienceEditor from './AudienceEditor.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import './admin-ui.css'

const props = defineProps({ name: { type: String, default: '' } })
const emit = defineEmits(['open', 'back', 'analytics'])
const GW = (us('emails').funnel || {}).editor || {}
const goalOk = (g) => !String(g || '').trim() || /^\/[^\s]*$/.test(String(g).trim())
import pipe from '../../lib/admin/api.js'
import { us, ug } from 'platformkit/lib/strings.js'
import AdminHead from './AdminHead.vue'
/* the page's own name and its one line, from the admin's words — the same two the shell reads
   when it draws a head, so a page is never named twice in two files */
const PAGE = { title: (ug('admin', 'rail').views || {})['blasts'] || '', lead: (ug('admin', 'leads').main || {})['blasts'] || '' }
/* the buttons in this page's head — words, like every other word in the product */
const A = ug('admin', 'actions')['blasts'] || {}
/* the view the editor holds: the funnels (each with its steps and its audience described), the blasts, the policy, the compiled designs */
async function loadView() {
  const [funnels, blasts, policy, designs] = await Promise.all([pipe.items('funnels'), pipe.items('blasts'), pipe.read('policy', 'policy'), pipe.options('designs')])
  return { funnels, blasts, policy: policy.data || {}, designs: designs.map((d) => d.value) }
}

const data = ref(null), stats = ref(null), loading = ref(true), msg = ref('')
async function load() { loading.value = true; try { data.value = await loadView(); await loadStats() } catch (e) { msg.value = e.message } finally { loading.value = false } }
async function loadStats() { if (!supabaseOn || !isSignedIn.value) return; try { const { data: s } = await supabase.rpc('email_stats'); stats.value = s } catch (e) { /* none */ } }
onMounted(load)
onIdentity((id) => { if (id) loadStats() })
const statOf = (id) => { const rows = stats.value && stats.value.sent ? stats.value.sent.filter((x) => x.email_id === id) : []; return { n: rows.reduce((a, x) => a + x.n, 0), opened: rows.reduce((a, x) => a + x.opened, 0), clicked: rows.reduce((a, x) => a + x.clicked, 0) } }
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—')
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '')
const line = (b) => { if (b.data.status !== 'sent') return 'draft'; const s = statOf(b.data.id); const n = s.n || b.data.sent || 0; return `sent to ${n} · ${pct(s.opened, n)} opened · ${pct(s.clicked, n)} clicked · ${when(b.data.sent_at)}` }

const VIEWS = [['email', 'Email'], ['audience', 'Audience'], ['send', 'Send']]
const view = ref('email')
const cur = computed(() => (data.value && props.name ? data.value.blasts.find((b) => b.name === props.name) || null : null))
const form = ref(null), saved = ref(''), creating = ref(false)
const dirty = computed(() => !!form.value && JSON.stringify(form.value) !== saved.value)
const sent = computed(() => !!cur.value && cur.value.data.status === 'sent' && !creating.value)
function begin() {
  const b = cur.value
  if (!b) { form.value = null; return }
  form.value = { name: b.name, title: b.data.title || b.name, subject: b.data.subject || '', design: b.data.design || 'campaign', respect: b.data['respect-cooldown'] !== false, goal: b.data.goal || '', audience: { ...(b.data.audience || {}) }, body: b.body }
  saved.value = JSON.stringify(form.value); result.value = null
}
watch([cur, data], () => { if (!creating.value) begin() }, { immediate: true })
watch(() => props.name, () => { view.value = sent.value ? 'send' : 'email' })
function startNew() { creating.value = true; view.value = 'email'; form.value = { name: '', title: '', subject: '', design: 'campaign', respect: true, goal: '', audience: {}, body: '' }; saved.value = '' }
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
watch(() => form.value && form.value.title, (t) => { if (creating.value && form.value) form.value.name = slug(t) })
const saving = ref(false)
async function save() {
  if (!form.value) return
  saving.value = true; msg.value = ''
  try {
    const f = form.value
    await pipe.save('blasts', f.name, { data: { title: f.title, subject: f.subject, design: f.design, audience: f.audience, 'respect-cooldown': f.respect, goal: (f.goal || '').trim() || undefined }, content: f.body }, { create: creating.value })
    data.value = await loadView()
    const was = creating.value; creating.value = false
    if (was) emit('open', f.name); else begin()
    msg.value = 'Saved'
  } catch (e) { msg.value = e.message } finally { saving.value = false }
}
async function remove() {
  if (!cur.value || !confirm(`Delete “${cur.value.data.title || cur.value.name}”?${sent.value ? ' It was sent; the log keeps what went.' : ''}`)) return
  try { await pipe.remove('blasts', cur.value.name); data.value = await loadView(); emit('back') } catch (e) { msg.value = e.message }
}
function discard() { if (creating.value) { creating.value = false; form.value = null; emit('back') } else begin() }
const NAME_TAG = '{{name}}'

/* the preview through the design */
const preview = ref(''), previewErr = ref(''), previewing = ref(false), showPreview = ref(true)
let timer = null
async function renderPreview() {
  if (!form.value || !showPreview.value) return
  previewing.value = true; previewErr.value = ''
  try {
    const { html } = await pipe.action('funnels', 'preview', { body: form.value.body })
    if (!supabaseOn || !isSignedIn.value) { preview.value = html; return }
    const { data: r, error } = await supabase.functions.invoke('send-email', { body: { kind: form.value.design, sample: { subject: form.value.subject, body: html, name: 'Ada' }, subject: form.value.subject } })
    if (error) throw error
    if (r && r.error) throw new Error(r.error)
    preview.value = r.html
  } catch (e) { previewErr.value = e.message || 'Could not render' } finally { previewing.value = false }
}
watch([() => form.value && [form.value.body, form.value.subject, form.value.design].join('|'), showPreview, view], () => { clearTimeout(timer); timer = setTimeout(renderPreview, 500) })
const me = computed(() => (session.value && session.value.user && session.value.user.email) || '')
const testing = ref(false)
async function sendTest() {
  if (!form.value || !me.value) return
  testing.value = true; msg.value = ''
  try {
    const { html } = await pipe.action('funnels', 'preview', { body: form.value.body })
    const { data: r, error } = await supabase.functions.invoke('send-email', { body: { kind: form.value.design, to: me.value, sample: { subject: form.value.subject, body: html, name: 'Ada' }, subject: form.value.subject } })
    if (error) throw error
    if (r && r.error) throw new Error(r.error)
    msg.value = r.ok ? `Test sent to ${me.value}` : 'Not sent — the relay refused it'
  } catch (e) { msg.value = e.message } finally { testing.value = false }
}

/* the send: a count, a confirm, the send, the file marked */
const sending = ref(false), result = ref(null)
async function count() {
  if (!cur.value) return
  sending.value = true; msg.value = ''
  try { const { data: d, error } = await supabase.functions.invoke('email-blast', { body: { name: cur.value.name, dry: true } }); if (error) throw error; if (d && d.error) throw new Error(d.error); result.value = d }
  catch (e) { msg.value = e.message } finally { sending.value = false }
}
async function sendBlast() {
  if (!cur.value || dirty.value || !result.value || !result.value.sent) return
  const n = result.value.sent
  if (!confirm(`Send “${form.value.subject}” to ${n} ${n === 1 ? 'person' : 'people'} now? This cannot be recalled.`)) return
  sending.value = true; msg.value = ''
  try {
    const { data: r, error } = await supabase.functions.invoke('email-blast', { body: { name: cur.value.name } })
    if (error) throw error
    if (r && r.error) throw new Error(r.error)
    result.value = r
    await pipe.action('blasts', 'sent', { name: cur.value.name, n: (cur.value.data.sent || 0) + r.sent }); data.value = await loadView(); await loadStats()
    msg.value = `Sent to ${r.sent}${r.failed ? ', ' + r.failed + ' failed' : ''}`
  } catch (e) { msg.value = e.message } finally { sending.value = false }
}
</script>

<template>
  <div class="bl">
    <p v-if="loading" class="ui-muted">Loading…</p>

    <template v-else-if="data && !form">
      <AdminHead :title="PAGE.title"><template #sub><span v-html="PAGE.lead" /></template>
        <template #afterTitle><span class="ui-count">{{ data.blasts.length }}</span></template>
        <template #actions><button type="button" class="ui-btn ui-primary" @click="startNew">{{ A.new }}</button></template>
      </AdminHead>
      <p v-if="msg" class="ui-err">{{ msg }}</p>
      <div v-if="!data.blasts.length" class="ui-empty"><h3>No blast yet</h3><p>A blast is one email, written once and sent once to everyone who matches its audience — a new edition on the shelf, a date to announce. It is kept afterwards as the record of what went.</p><button type="button" class="ui-btn ui-primary" @click="startNew">Write one</button></div>
      <div v-else class="bl-list">
        <button v-for="b in data.blasts" :key="b.name" type="button" class="bl-item" @click="emit('open', b.name)">
          <span class="ui-pill" :class="b.data.status === 'sent' ? 'ui-ok' : 'ui-warn'">{{ b.data.status === 'sent' ? 'Sent' : 'Draft' }}</span>
          <span class="bl-item-main"><b>{{ b.data.title || b.name }}</b><small>{{ b.data.subject }}</small></span>
          <span class="bl-item-line">{{ line(b) }}</span>
          <span class="bl-item-go">›</span>
        </button>
      </div>
    </template>

    <template v-else-if="form">
      <div class="ui-cardrow"><button type="button" class="ui-crumb" @click="discard">‹ Blasts</button></div>
      <div class="bl-head">
        <h2 class="bl-title">{{ form.title || 'New blast' }}</h2>
        <span class="ui-grow" />
        <span class="ui-pill" :class="sent ? 'ui-ok' : 'ui-warn'">{{ sent ? 'Sent' : 'Draft' }}</span>
      </div>
      <div class="ui-seg" role="tablist">
        <button v-for="[k, label] in VIEWS" :key="k" type="button" role="tab" :aria-selected="view === k" :class="{ 'ui-on': view === k }" :disabled="k === 'send' && creating" @click="view = k">{{ label }}<i v-if="k === 'audience'" class="bl-seg-n">{{ Object.keys(form.audience).length || '' }}</i></button>
      </div>

      <!-- email -->
      <div v-show="view === 'email'" class="ui-card bl-emailcard">
        <div class="bl-pane" :class="{ 'bl-wide': !showPreview }">
          <div class="bl-fields">
            <div class="ui-row">
              <label class="ui-field"><span>Title <small>· for this page</small></span><input v-model="form.title" class="ui-input" placeholder="A letter for spring" :disabled="sent" /></label>
              <label v-if="creating" class="ui-field bl-name"><span>File name</span><input v-model="form.name" class="ui-input ui-mono" /></label>
            </div>
            <label class="ui-field"><span>Subject <small>· {{ NAME_TAG }} is the first name</small></span><input v-model="form.subject" class="ui-input" placeholder="A quiet note from the shelf, {{name}}" :disabled="sent" /></label>
            <div class="ui-field bl-grow"><span>The email</span><div class="bl-md" :class="{ 'bl-sent': sent }"><MarkdownEditor v-model="form.body" /></div></div>
            <div class="ui-cardrow bl-acts">
              <label class="ui-field bl-design"><span>Design</span><select v-model="form.design" class="ui-select" :disabled="sent"><option v-for="d in data.designs" :key="d" :value="d">{{ d }}</option></select></label>
              <span class="ui-grow" />
              <button type="button" class="ui-btn ui-ghost ui-sm" @click="showPreview = !showPreview">{{ showPreview ? 'Hide preview' : 'Preview' }}</button>
              <button type="button" class="ui-btn ui-ghost ui-sm" :disabled="testing || !me" @click="sendTest">{{ testing ? 'Sending…' : 'Send to me' }}</button>
            </div>
          </div>
          <div v-if="showPreview" class="bl-previewcol">
            <p v-if="previewErr" class="ui-err">{{ previewErr }}</p>
            <iframe v-else class="ui-frame bl-preview" :srcdoc="preview" title="Preview" sandbox="" />
          </div>
        </div>
      </div>

      <!-- audience -->
      <div v-show="view === 'audience'" class="ui-card">
        <div class="ui-cardhead"><h3>Who it goes to</h3><span>as they are the moment it is sent</span></div>
        <AudienceEditor v-model="form.audience" />
        <label class="ui-switch bl-respect"><input v-model="form.respect" type="checkbox" :disabled="sent" /><i /><span>Respect the sending rules <small class="ui-hint">— skip anyone at their limit of marketing emails</small></span></label>
        <label class="ui-field bl-goal" :class="{ 'pr-bad': !goalOk(form.goal) }"><span>{{ GW.goal }} <small>· {{ GW['goal-help'] }}</small></span><input v-model="form.goal" class="ui-input ui-mono" :disabled="sent" :placeholder="GW['goal-placeholder']" /></label>
      </div>

      <!-- send -->
      <div v-show="view === 'send'" class="ui-card bl-sendcard">
        <template v-if="sent">
          <div class="ui-cardhead"><h3>Sent</h3><span>{{ when(cur.data.sent_at) }} — the record; a second press finishes a run that was cut short</span></div>
          <div class="ui-stats"><div class="ui-kpi"><b>{{ statOf(cur.data.id).n || cur.data.sent || 0 }}</b><span>sent</span></div><div class="ui-kpi"><b>{{ pct(statOf(cur.data.id).opened, statOf(cur.data.id).n) }}</b><span>opened</span></div><div class="ui-kpi"><b>{{ pct(statOf(cur.data.id).clicked, statOf(cur.data.id).n) }}</b><span>clicked</span></div></div>
          <div class="ui-cardrow"><button type="button" class="ui-btn ui-sm" @click="emit('analytics', cur.name)">{{ GW.analytics }}</button><button type="button" class="ui-btn ui-sm" :disabled="sending" @click="count">Anyone new?</button><span v-if="result" class="ui-muted">{{ result.sent }} would get it now · {{ result.skipped }} already had it · {{ result.held }} held</span><button v-if="result && result.sent && result.dry" type="button" class="ui-btn ui-primary ui-sm" :disabled="sending" @click="sendBlast">Send to {{ result.sent }}</button><span class="ui-grow" /><button type="button" class="ui-btn ui-ghost ui-danger ui-sm" @click="remove">Delete</button></div>
        </template>
        <template v-else>
          <div class="ui-cardhead"><h3>Send</h3><span>a count first, then a confirm — it cannot be recalled</span></div>
          <p v-if="dirty" class="ui-hint">Save first — the count and the send use what is saved.</p>
          <div v-else-if="!result" class="ui-cardrow"><button type="button" class="ui-btn" :disabled="sending" @click="count">{{ sending ? 'Counting…' : 'Count who would get it' }}</button></div>
          <template v-else>
            <div class="ui-stats"><div class="ui-kpi"><b>{{ result.audience }}</b><span>match</span></div><div class="ui-kpi"><b>{{ result.sent }}</b><span>would get it</span></div><div class="ui-kpi"><b>{{ result.held }}</b><span>held by the rules</span></div><div class="ui-kpi"><b>{{ result.skipped }}</b><span>already had it</span></div></div>
            <div class="ui-cardrow"><button type="button" class="ui-btn ui-primary" :disabled="sending || !result.sent" @click="sendBlast">{{ sending ? 'Sending…' : result.sent ? 'Send to ' + result.sent + ' now' : 'Nobody to send to' }}</button><button type="button" class="ui-btn ui-ghost ui-sm" :disabled="sending" @click="count">Count again</button></div>
          </template>
          <div class="ui-cardrow bl-danger"><span class="ui-grow" /><button type="button" class="ui-btn ui-ghost ui-danger ui-sm" @click="remove">Delete this draft</button></div>
        </template>
      </div>

      <div class="ui-savebar">
        <span class="ui-dirty" :class="{ 'ui-clean': !dirty }">{{ dirty ? 'Unsaved changes' : (msg || 'All changes saved') }}</span>
        <span v-if="dirty && msg" class="ui-err">{{ msg }}</span>
        <span class="ui-grow" />
        <button type="button" class="ui-btn ui-ghost" :disabled="!dirty && !creating" @click="discard">Discard</button>
        <button type="button" class="ui-btn ui-primary" :disabled="saving || !dirty || sent || !form.name || !form.title" @click="save">{{ saving ? 'Saving…' : 'Save' }}</button>
      </div>
    </template>
    <p v-else class="ui-err">{{ msg }}</p>
  </div>
</template>

<style scoped>
.bl { display: flex; flex-direction: column; gap: 14px; width: 100%; flex: 1; min-height: 0; overflow-y: auto; margin: 0 -30px; padding: 2px 30px 20px }
.bl-list { display: flex; flex-direction: column; gap: 8px }
.bl-item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 16px; padding: 14px 16px; border: 1px solid var(--hair); border-radius: 14px; background: var(--card); text-align: left; font: inherit; color: var(--ink); cursor: pointer; box-shadow: 0 1px 2px #0000000a; transition: border-color .15s, box-shadow .15s }
.bl-item:hover { border-color: var(--ink3); box-shadow: 0 1px 2px #0000000a, 0 14px 30px -22px #00000055 }
.bl-item-main { display: flex; flex-direction: column; gap: 3px; min-width: 0 } .bl-item-main b { font-family: var(--fd); font-weight: 600; font-size: 17px; letter-spacing: -.01em } .bl-item-main small { font-size: 12.5px; color: var(--ink3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.bl-item-line { font-size: 13px; color: var(--ink2); white-space: nowrap } .bl-item-go { color: var(--ink3); font-size: 18px }
.bl-head { display: flex; align-items: center; gap: 14px } .bl-title { font-family: var(--fd); font-weight: 600; font-size: 28px; letter-spacing: -.02em; margin: 0 }
.bl-seg-n { font-style: normal; font-family: var(--m); font-size: 10.5px; margin-left: 6px; color: var(--ink3) }
.bl-pane { display: grid; grid-template-columns: minmax(340px, 1fr) minmax(360px, 560px); gap: 18px; align-items: stretch } .bl-pane.bl-wide { grid-template-columns: 1fr }
.bl-fields { display: flex; flex-direction: column; gap: 12px; min-width: 0 } .bl-grow { flex: 1 } .bl-name { max-width: 220px } .bl-design { max-width: 200px }
.bl-md { min-height: 360px; flex: 1 } .bl-sent { pointer-events: none; opacity: .7 } .bl-acts { gap: 8px; align-items: end }
.bl-previewcol { display: flex; flex-direction: column; min-width: 0 } .bl-preview { height: 100%; min-height: 520px }
.bl-respect { margin-top: 4px } .bl-goal { margin-top: 14px; max-width: 520px } .bl-sendcard { max-width: 760px } .bl-danger { padding-top: 10px; border-top: 1px solid var(--hair) }
@media (max-width: 1400px) { .bl-pane { grid-template-columns: 1fr } .bl-preview { min-height: 480px } }
</style>

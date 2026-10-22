<script setup>
/*
 * The model builder: a content model (content/models/<key>.md) edited as what it is — fields as rows down the
 * page, the picked one's controls beside them (ModelField.vue); its options (the title field, the slug, a
 * singleton, a body, access, order); how it is delivered (data, pages, JSON, a section) — and never as its
 * grammar: the writer (build/model-io.mjs) puts it down as block YAML in one order. A field renamed is
 * carried into every entry on save; a kind or a rule changed under entries is checked first, and the bar says
 * how many entries would no longer pass, and which, before anything is written. A save goes through the content pipe (the models model).
 */
import { ref, computed, watch, onMounted } from 'vue'
import draggable from 'vuedraggable'
import ModelField from './ModelField.vue'
import Select from 'primevue/select'
import { us } from 'platformkit/lib/strings.js'
import './admin-ui.css'

const props = defineProps({ name: { type: String, default: '' } })
const emit = defineEmits(['back', 'saved', 'open'])
const M = us('models'), A = M.admin || {}
const W = A.builder || {}, WF = A.fields || {}, WO = A.options || {}, WD = A.delivery || {}, WP = A.page || {}, K = M.kinds || {}
import pipe from '../../lib/admin/api.js'

const model = ref(null), saved = ref(''), msg = ref(''), loading = ref(true), saving = ref(false), entries = ref(0), models = ref([])
const view = ref('fields'), picked = ref(0), failing = ref(null), renames = ref([])
const isNew = computed(() => !props.name)
const blank = () => ({ key: '', name: '', singular: '', published: true, title: '', slug: 'title', singleton: false, body: false, access: [], order: { by: '', dir: 'asc' }, deliver: { data: true, pages: false, json: false, section: false }, fields: [] })
const strip = (m) => JSON.parse(JSON.stringify(m, (k, v) => (k.startsWith('_') ? undefined : v)))
const snapshot = () => JSON.stringify(strip(model.value))
const dirty = computed(() => !!model.value && (snapshot() !== saved.value || renames.value.length > 0))
async function load() {
  loading.value = true; msg.value = ''; failing.value = null; renames.value = []
  try {
    models.value = (await pipe.items('models')).filter((m) => !m.errors.length)
    if (isNew.value) { model.value = blank(); entries.value = 0 }
    else { const r = await pipe.read('models', props.name); model.value = r.data || blank(); entries.value = r.entries; if (r.errors && r.errors.length) msg.value = r.errors.join('\n') }
    saved.value = snapshot(); picked.value = 0
  } catch (e) { msg.value = e.message } finally { loading.value = false }
}
onMounted(load)
watch(() => props.name, load)

/* ---- the fields ---- */
const fields = computed(() => (model.value ? model.value.fields : []))
const cur = computed(() => fields.value[picked.value] || null)
const keyOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
function setName(v) { model.value.name = v; if (isNew.value) model.value.key = keyOf(v) }
function addField() { let i = fields.value.length + 1; let key = 'field' + i; while (fields.value.some((f) => f.key === key)) key = 'field' + ++i; fields.value.push({ key, kind: 'text', label: '', _new: true }); picked.value = fields.value.length - 1; if (!model.value.title) model.value.title = key }
function removeField(i) { if (!window.confirm(WF['remove-confirm'].replace('{label}', fields.value[i].label || fields.value[i].key))) return; const k = fields.value[i].key; fields.value.splice(i, 1); if (model.value.title === k) model.value.title = (fields.value[0] && fields.value[0].key) || ''; if (model.value.order.by === k) model.value.order.by = ''; if (model.value.slug === k) model.value.slug = 'title'; picked.value = Math.max(0, i - 1) }
function rename({ from, to }) {
  const f = fields.value.find((x) => x.key === from); if (!f) return
  f.key = to
  if (model.value.title === from) model.value.title = to
  if (model.value.order.by === from) model.value.order.by = to
  if (model.value.slug === from) model.value.slug = to
  for (const x of fields.value) if (x.shown && x.shown.field === from) x.shown.field = to
  const prev = renames.value.find((r) => r.to === from)
  if (prev) prev.to = to; else renames.value.push({ from, to })
}
const kindChanged = computed(() => fields.value.some((f) => f._kindChanged && !f._new))
const canSave = computed(() => !!(model.value && model.value.name && fields.value.length))
const fieldOptions = computed(() => fields.value.map((f) => ({ value: f.key, label: f.label || f.key })))
const slugOptions = computed(() => [{ value: 'title', label: WO['slug-title'] }, ...fields.value.filter((f) => f.kind === 'text').map((f) => ({ value: f.key, label: f.label || f.key }))])

/* ---- save ---- */
async function save(force) {
  if (!model.value) return
  saving.value = true; msg.value = ''; failing.value = null
  try {
    const m = strip(model.value)
    /* a new field's key follows its label until saved, so what named it earlier may be stale */
    const keys = m.fields.map((f) => f.key)
    if (!keys.includes(m.title)) m.title = keys[0] || ''
    if (!keys.includes(m.order.by)) m.order.by = m.title
    if (m.slug !== 'title' && !keys.includes(m.slug)) m.slug = 'title'
    if (!m.singular) m.singular = m.name
    /* a field renamed under entries: the entries first, then the model that names it */
    for (const r of renames.value) if (!isNew.value) await pipe.action('models', 'rename-field', { key: props.name || m.key, from: r.from, to: r.to })
    renames.value = []
    const r = await pipe.save('models', m.key, { data: m }, { create: isNew.value, check: !force && kindChanged.value && entries.value > 0 })
    if (r.ok === false && r.failing) { failing.value = r.failing; return }
    for (const f of model.value.fields) { delete f._new; delete f._kindChanged; for (const g of f.fields || []) delete g._new }
    saved.value = snapshot()
    emit('saved')
    if (isNew.value) { try { sessionStorage.setItem('dl.admin.saved', 'models') } catch (e) { /* private */ } emit('open', m.key) }
  } catch (e) { msg.value = e.message } finally { saving.value = false }
}
function discard() { load() }
async function remove() {
  if (entries.value) { window.alert(WP['delete-refused'].replace('{name}', model.value.name).replace('{n}', entries.value)); return }
  if (!window.confirm(WP['delete-confirm'].replace('{name}', model.value.name))) return
  try { await pipe.remove('models', props.name); emit('saved'); emit('back') } catch (e) { msg.value = e.message }
}
const here = typeof location !== 'undefined' ? location.origin : ''
const ACCESS = ['guest', 'authenticated', 'paid', 'subscribed']
function toggleAccess(a) { const i = model.value.access.indexOf(a); if (i >= 0) model.value.access.splice(i, 1); else model.value.access.push(a) }
</script>

<template>
  <div class="mb">
    <div class="mb-head">
      <button type="button" class="ui-btn ui-ghost ui-sm" @click="emit('back')">← {{ W.back }}</button>
      <h2 class="mb-title">{{ model && model.name ? model.name : (isNew ? W.new : W.untitled) }}</h2>
      <span class="ui-grow" />
      <label v-if="model" class="ui-switch mb-pub"><input type="checkbox" :checked="model.published" @change="model.published = $event.target.checked" /><i /><span>{{ W.published }}</span></label>
      <span class="ui-seg"><button type="button" :class="{ 'ui-on': view === 'fields' }" @click="view = 'fields'">{{ W['tab-fields'] }}</button><button type="button" :class="{ 'ui-on': view === 'options' }" @click="view = 'options'">{{ W['tab-options'] }}</button><button type="button" :class="{ 'ui-on': view === 'delivery' }" @click="view = 'delivery'">{{ W['tab-delivery'] }}</button></span>
    </div>
    <p v-if="loading" class="ui-muted">…</p>
    <template v-else-if="model">
      <p v-if="isNew" class="ui-hint mb-lead">{{ W['new-lead'] }}</p>
      <div class="ui-card mb-top">
        <label class="ui-field"><span>{{ W.name }} <small>· {{ W['name-help'] }}</small></span><input class="ui-input" :value="model.name" @input="setName($event.target.value)" /></label>
        <label class="ui-field"><span>{{ W.singular }}</span><input class="ui-input" :value="model.singular" :placeholder="model.name" @input="model.singular = $event.target.value" /></label>
        <label class="ui-field"><span>{{ W.key }} <small>· {{ W['key-help'] }}</small></span><input class="ui-input ui-mono" :value="model.key" :readonly="!isNew" @input="isNew && (model.key = keyOf($event.target.value))" /></label>
      </div>

      <!-- ===== fields ===== -->
      <div v-show="view === 'fields'" class="mb-build">
        <div class="mb-list ui-card">
          <div class="ui-cardhead mb-listhead"><h3>{{ W['tab-fields'] }} <span class="ui-count">{{ fields.length }}</span></h3><button type="button" class="ui-btn ui-sm" :class="fields.length ? 'ui-ghost' : 'ui-primary'" @click="addField">+ {{ WF.add }}</button></div>
          <draggable v-model="model.fields" item-key="key" handle=".mb-grip" class="mb-rows" ghost-class="mb-ghost" :animation="150" @end="picked = $event.newIndex">
            <template #item="{ element: f, index: i }">
              <button type="button" class="mb-row" :class="{ 'mb-on': picked === i }" @click="picked = i">
                <span class="mb-grip" aria-hidden="true">⋮⋮</span>
                <span class="mb-main">
                  <span class="mb-sum">{{ f.label || f.key }}<i v-if="f.required" class="mb-req">*</i></span>
                  <span class="mb-meta">{{ (K[f.kind] || {}).name || f.kind }}<i v-if="f.key === model.title" class="mb-mark">{{ W['mark-title'] }}</i><i v-if="f.unique" class="mb-mark">{{ W['mark-unique'] }}</i><i v-if="f.shown" class="mb-mark">{{ W['mark-shown'] }}</i></span>
                </span>
                <span class="ui-iconbtn mb-x" role="button" :title="WF.remove" @click.stop="removeField(i)">×</span>
              </button>
            </template>
          </draggable>
          <div v-if="!fields.length" class="mb-none"><p class="ui-hint">{{ WF.empty }}</p></div>
        </div>
        <div class="mb-inspector ui-card">
          <template v-if="cur">
            <div class="ui-cardhead"><h3>{{ W.field }} <span class="mb-curname">{{ cur.label || cur.key }}</span></h3><span>{{ (K[cur.kind] || {}).line }}</span></div>
            <ModelField :key="picked + ':' + cur.key" :field="cur" :fields="fields" :models="models" :saved="!isNew" @remove="removeField(picked)" @rename="rename" />
          </template>
          <div v-else class="mb-none"><p class="ui-hint">{{ fields.length ? WF['none-selected'] : W['no-field'] }}</p></div>
        </div>
      </div>

      <!-- ===== options ===== -->
      <div v-show="view === 'options'" class="mb-panel">
        <div class="ui-card">
          <div class="mb-grid2">
            <label class="ui-field"><span>{{ WO['title-field'] }} <small>· {{ WO['title-help'] }}</small></span><Select :model-value="model.title" :options="fieldOptions" optionLabel="label" optionValue="value" fluid @update:model-value="(v) => { if (v) model.title = v }" /></label>
            <label class="ui-field"><span>{{ WO.slug }} <small>· {{ WO['slug-help'] }}</small></span><Select :model-value="model.slug" :options="slugOptions" optionLabel="label" optionValue="value" fluid @update:model-value="(v) => { if (v) model.slug = v }" /></label>
          </div>
          <div class="mb-optrow">
            <label class="ui-switch"><input type="checkbox" :checked="model.singleton" @change="model.singleton = $event.target.checked" /><i /><span>{{ WO.singleton }}</span></label>
            <span class="ui-hint">{{ WO['singleton-help'] }}</span>
          </div>
          <div class="mb-optrow">
            <label class="ui-switch"><input type="checkbox" :checked="!!model.body" @change="model.body = $event.target.checked ? 'Body' : false" /><i /><span>{{ WO.body }}</span></label>
            <span class="ui-hint">{{ WO['body-help'] }}</span>
            <input v-if="model.body" class="ui-input mb-bodylabel" :value="model.body" :aria-label="WO['body-label']" @input="model.body = $event.target.value || 'Body'" />
          </div>
        </div>
        <div class="ui-card">
          <div class="ui-field"><span>{{ WO.access }} <small>· {{ WO['access-help'] }}</small></span>
            <div class="mb-chips"><button v-for="a in ACCESS" :key="a" type="button" class="mb-chip" :class="{ 'mb-chipon': model.access.includes(a) }" @click="toggleAccess(a)">{{ a }}</button></div>
          </div>
          <div class="mb-grid2">
            <label class="ui-field"><span>{{ WO.order }} · {{ WO['order-by'] }}</span><Select :model-value="model.order.by || model.title" :options="fieldOptions" optionLabel="label" optionValue="value" fluid @update:model-value="(v) => { if (v) model.order.by = v }" /></label>
            <label class="ui-field"><span>{{ WO['order-dir'] }}</span><span class="ui-seg mb-seg"><button type="button" :class="{ 'ui-on': model.order.dir !== 'desc' }" @click="model.order.dir = 'asc'">{{ WO.asc }}</button><button type="button" :class="{ 'ui-on': model.order.dir === 'desc' }" @click="model.order.dir = 'desc'">{{ WO.desc }}</button></span></label>
          </div>
        </div>
        <div v-if="!isNew" class="ui-card ui-dangerzone"><div class="ui-cardhead"><h3>{{ WP.delete }}</h3><span>{{ entries ? (entries === 1 ? WP['delete-refused-one'] : WP['delete-refused']).replace('{name}', model.name).replace('{n}', entries) : WP['delete-hint'] }}</span></div><div class="ui-row"><span class="ui-grow" /><button type="button" class="ui-btn ui-ghost ui-danger ui-sm" :disabled="entries > 0" @click="remove">{{ WP.delete }}</button></div></div>
      </div>

      <!-- ===== delivery ===== -->
      <div v-show="view === 'delivery'" class="mb-panel">
        <div class="ui-card mb-delivery">
          <div class="mb-deliver"><label class="ui-switch"><input type="checkbox" checked disabled /><i /><span>{{ WD.data }}</span></label><div class="mb-delivertext"><span class="ui-hint">{{ WD['data-help'] }}</span><code class="ui-key">#content/models/{{ model.key || '…' }}</code></div></div>
          <div class="mb-deliver"><label class="ui-switch"><input type="checkbox" :checked="model.deliver.pages" @change="model.deliver.pages = $event.target.checked" /><i /><span>{{ WD.pages }}</span></label><div class="mb-delivertext"><span class="ui-hint">{{ WD['pages-help'] }}</span><code v-if="model.deliver.pages" class="ui-key">{{ here }}/c/{{ model.key || '…' }}</code></div></div>
          <div class="mb-deliver"><label class="ui-switch"><input type="checkbox" :checked="model.deliver.json" @change="model.deliver.json = $event.target.checked" /><i /><span>{{ WD.json }}</span></label><div class="mb-delivertext"><span class="ui-hint">{{ WD['json-help'] }}</span><code v-if="model.deliver.json" class="ui-key">{{ here }}/data/models/{{ model.key || '…' }}.json</code></div></div>
          <div class="mb-deliver"><label class="ui-switch"><input type="checkbox" :checked="model.deliver.section" @change="model.deliver.section = $event.target.checked" /><i /><span>{{ WD.section }}</span></label><div class="mb-delivertext"><span class="ui-hint">{{ WD['section-help'] }}</span></div></div>
        </div>
      </div>

      <div v-if="failing" class="ui-card mb-failing">
        <div class="ui-cardhead"><h3>{{ (failing.length === 1 ? W['would-fail-one'] : W['would-fail']).replace('{n}', failing.length) }}</h3></div>
        <ul><li v-for="f in failing" :key="f.slug"><code class="ui-key">{{ f.slug }}</code> {{ f.messages.join(' ') }}</li></ul>
        <div class="ui-row"><span class="ui-grow" /><button type="button" class="ui-btn ui-ghost ui-sm" @click="failing = null">{{ W['keep-editing'] }}</button><button type="button" class="ui-btn ui-primary ui-sm" @click="save(true)">{{ W['save-anyway'] }}</button></div>
      </div>
      <div class="ui-savebar">
        <span class="ui-dirty" :class="{ 'ui-clean': !dirty && !isNew }">{{ isNew && !dirty ? W.unsaved : dirty ? W.dirty : (msg ? '' : W.saved) }}</span>
        <span v-if="msg" class="ui-err mb-msg">{{ msg }}</span>
        <span v-else-if="kindChanged && entries" class="ui-hint">{{ W['kind-changed'] }}</span>
        <span v-else-if="dirty && !canSave" class="ui-hint">{{ W.needs }}</span>
        <span class="ui-grow" />
        <button type="button" class="ui-btn ui-ghost" :disabled="!dirty" @click="discard">{{ W.discard }}</button>
        <button type="button" class="ui-btn ui-primary" :disabled="saving || !dirty || !canSave" @click="save(false)">{{ saving ? W.saving : W.save }}</button>
      </div>
    </template>
    <p v-else class="ui-err">{{ msg }}</p>
  </div>
</template>

<style scoped>
.mb { display: flex; flex-direction: column; gap: 14px; width: 100%; flex: 1; min-height: 0 }
.mb-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap } .mb-title { font-family: var(--fd); font-weight: 600; font-size: 28px; letter-spacing: -.02em; margin: 0 }
.mb-pub { margin-right: 6px }
.mb-lead { margin: -4px 0 0 }
.mb-top { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr); gap: 14px }
.mb-top .ui-field > span, .mb-grid2 .ui-field > span, .mb-panel .ui-field > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.mb-build { display: grid; grid-template-columns: minmax(300px, 400px) minmax(0, 1fr); gap: 18px; align-items: start }
.mb-list { gap: 10px } .mb-rows { display: flex; flex-direction: column; gap: 2px }
.mb-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; font: inherit; text-align: left; background: none; border: 1px solid transparent; border-radius: 10px; padding: 8px 8px 8px 6px; cursor: pointer; color: var(--ink) }
.mb-row:hover { background: var(--wash) } .mb-row.mb-on { border-color: var(--ink); background: var(--card) }
.mb-grip { color: var(--ink3); font-size: 11px; letter-spacing: -2px; cursor: grab; padding: 0 2px }
.mb-main { display: flex; flex-direction: column; gap: 2px; min-width: 0 }
.mb-sum { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.mb-meta { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink3) }
.mb-req { font-style: normal; color: var(--accent2); margin-left: 3px } .mb-mark { font-style: normal; font-family: var(--m); font-size: 10px; letter-spacing: .04em; color: var(--ink2); background: var(--wash); border-radius: 4px; padding: 1px 5px }
.mb-x { opacity: 0; width: 24px; height: 24px; font-size: 14px } .mb-row:hover .mb-x, .mb-row.mb-on .mb-x { opacity: 1 }
.mb-ghost { opacity: .4 }
.mb-none { display: flex; align-items: center; justify-content: center; padding: 22px 12px; text-align: center }
.mb-listhead { align-items: center } .mb-listhead .ui-count { margin-left: 6px }
.mb-panel :deep(.p-select), .mb-top :deep(.p-select) { height: 34px; border-radius: 8px; font-size: 13.5px; align-items: center; border-color: var(--hair); background: var(--card) }
.mb-panel :deep(.p-select .p-select-label) { padding: 0 10px; font-size: 13.5px; line-height: 32px }
.mb-inspector { position: sticky; top: 12px; gap: 14px; max-height: calc(100vh - 140px); overflow-y: auto }
.mb-curname { font-weight: 400; color: var(--ink2); margin-left: 4px }
.mb-panel { display: flex; flex-direction: column; gap: 14px; max-width: 760px }
.mb-grid2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px }
.mb-optrow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap } .mb-optrow .ui-hint { flex: 1 } .mb-bodylabel { width: 200px }
.mb-chips { display: flex; flex-wrap: wrap; gap: 6px }
.mb-chip { font: inherit; font-size: 12.5px; font-weight: 500; color: var(--ink2); background: none; border: 1px solid var(--hair); border-radius: 999px; padding: 5px 12px; cursor: pointer }
.mb-chip:hover { border-color: var(--ink3); color: var(--ink) } .mb-chipon { color: var(--paper); background: var(--ink); border-color: var(--ink) } .mb-chipon:hover { color: var(--paper) }
.mb-seg { display: inline-flex; height: 34px; align-items: center; align-self: flex-start }
.mb-delivery { gap: 0; padding: 4px 16px }
.mb-deliver { display: grid; grid-template-columns: 150px 1fr; gap: 14px; align-items: start; padding: 14px 0; border-bottom: 1px solid var(--hair) } .mb-deliver:last-child { border-bottom: 0 }
.mb-delivertext { display: flex; flex-direction: column; gap: 4px } .mb-deliver .ui-switch { padding-top: 1px }
.mb-failing { border-color: var(--accent2) } .mb-failing ul { margin: 0; padding-left: 18px; font-size: 13px } .mb-failing li { margin: 3px 0 } .mb-failing li .ui-key { margin-right: 6px }
.mb-msg { white-space: pre-wrap }
@media (max-width: 1100px) { .mb-build { grid-template-columns: 1fr } .mb-inspector { position: static; max-height: none } .mb-top { grid-template-columns: 1fr } }
</style>

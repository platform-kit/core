<script setup>
/*
 * The form builder: a form's document (content/forms/<slug>.md, a forms.md document) edited as what
 * it is — slides as groups down the page, each holding its blocks in order (copy, a field, a div kept
 * as written), the picked block's controls beside them — and never as its grammar: the writer
 * (build/form-io.mjs) composes what was touched through forms.md's own Composer and keeps every
 * untouched part byte for byte. Three views: Build (the slides), Settings (what the document says
 * about itself: the page mode, the progress, the kit's own — published, one answer, who may answer,
 * the embed's origins, a webhook, a quiz's right answers), Share (its page, the embed snippet, the
 * landing section). A save goes through the content pipe (the forms model: its grammar parses the result again,
 * its hook compiles beside the functions).
 */
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import draggable from 'vuedraggable'
import FieldInspector from './FieldInspector.vue'
import ConditionEditor from './ConditionEditor.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import { describe } from 'platformkit/lib/forms/condition.js'
import { us } from 'platformkit/lib/strings.js'
import './admin-ui.css'

const props = defineProps({ name: { type: String, required: true } })
const emit = defineEmits(['back', 'saved'])
const A = us('forms').admin || {}
const W = { ...(A.slides || {}), ...(A.slide || {}) }, WS = A.settings || {}, WH = A.share || {}, WV = A.views || {}, WT = A.text || {}, K = A.kinds || {}, WSV = A.save || {}, WC = A.condition || {}
import pipe from '../../lib/admin/api.js'
import { supabase } from 'platformkit/lib/supabase.js'

const model = ref(null), raw = ref(''), saved = ref(''), msg = ref(''), loading = ref(true), saving = ref(false)
const view = ref('build')
const picked = ref(null)   /* { slide: i, block: j } or { slide: i } */
const snapshot = () => JSON.stringify(model.value)
const dirty = computed(() => !!model.value && snapshot() !== saved.value)
async function load() {
  loading.value = true; msg.value = ''
  try { const r = await pipe.read('forms', props.name); model.value = r.parsed; raw.value = r.content; saved.value = snapshot(); picked.value = model.value.slides.length ? { slide: 0 } : null }
  catch (e) { msg.value = e.message } finally { loading.value = false }
}
onMounted(load)
watch(() => props.name, load)

/* ---- the slides ---- */
const slides = computed(() => (model.value ? model.value.slides : []))
const allFields = computed(() => { const out = []; const walk = (bs) => { for (const b of bs) { if (b.type === 'field') out.push(b); if (b.blocks) walk(b.blocks) } }; for (const s of slides.value) walk(s.blocks); return out })
const fieldsBefore = (si) => { const out = []; const walk = (bs) => { for (const b of bs) { if (b.type === 'field') out.push(b); if (b.blocks) walk(b.blocks) } }; slides.value.slice(0, si + 1).forEach((s) => walk(s.blocks)); return out }
const slideLabel = (s, i) => (s.type === 'start' ? W.start : s.type === 'end' ? W.end : W.body.replace('{n}', String(slides.value.slice(0, i + 1).filter((x) => x.type === 'body').length)))
const summary = (b) => (b.type === 'field' ? (b.params.question === '...' ? b.name : b.params.question) : b.type === 'markdown' ? String(b.md || '').replace(/^#+\s*/gm, '').replace(/[*_`>]/g, '').split('\n').find((l) => l.trim()) || '…' : W.raw)
const cur = computed(() => { const p = picked.value; if (!p || !model.value) return null; const s = slides.value[p.slide]; if (!s) return null; return p.block == null ? { kind: 'slide', slide: s, i: p.slide } : { kind: 'block', block: s.blocks[p.block], slide: s, i: p.slide, j: p.block } })
function pick(si, bj) { picked.value = bj == null ? { slide: si } : { slide: si, block: bj } }
const touchSlide = (s) => { s.headDirty = true; model.value.slidesChanged = true }
function addSlide(after) {
  const s = { type: 'body', jump: '', progress: '', align: '', post: false, disablePrev: false, button: '', redirect: '', head: [], headDirty: true, blocks: [] }
  const at = after == null ? slides.value.length - (slides.value.some((x) => x.type === 'end') ? 1 : 0) : after + 1
  slides.value.splice(at, 0, s); model.value.slidesChanged = true; pick(at)
}
function removeSlide(i) { slides.value.splice(i, 1); model.value.slidesChanged = true; picked.value = slides.value.length ? { slide: Math.max(0, i - 1) } : null }
function setType(s, t) {
  const hasEnd = slides.value.some((x) => x !== s && x.type === 'end')
  if (t === 'end' && hasEnd) return
  s.type = t; touchSlide(s)
  /* the document keeps the starts first and the end last */
  const list = slides.value; const i = list.indexOf(s); list.splice(i, 1)
  if (t === 'start') list.splice(list.filter((x) => x.type === 'start').length, 0, s)
  else if (t === 'end') list.push(s)
  else list.splice(Math.max(list.filter((x) => x.type === 'start').length, Math.min(i, list.length - (list.some((x) => x.type === 'end') ? 1 : 0))), 0, s)
  picked.value = { slide: list.indexOf(s) }
}
function addField(si) { const s = slides.value[si]; const b = { type: 'field', name: uniqueName('field'), kind: 'text', required: false, params: { question: '' }, attrs: { deps: [], id: '', classes: [], other: [] }, deps: [], condition: '', dirty: true, autoname: true, line: 0 }; s.blocks.push(b); pick(si, s.blocks.length - 1); model.value.slidesChanged = true }
function addText(si) { const s = slides.value[si]; s.blocks.push({ type: 'markdown', md: '', raw: null, deps: [], condition: '', dirty: true, line: 0 }); pick(si, s.blocks.length - 1); model.value.slidesChanged = true }
function uniqueName(base) { let n = base, i = 2; while (allFields.value.some((f) => f.name === n)) n = base + i++; return n }
function removeBlock(si, bj) { slides.value[si].blocks.splice(bj, 1); pick(si); model.value.slidesChanged = true }
function moveBlock(si, bj, d) { const bs = slides.value[si].blocks; const k = bj + d; if (k < 0 || k >= bs.length) return; [bs[bj], bs[k]] = [bs[k], bs[bj]]; pick(si, k); model.value.slidesChanged = true }
function onDrag(si) { model.value.slidesChanged = true; pick(si) }
function setMd(b, v) { b.md = v; b.raw = null; b.dirty = true }
const progressOf = (s) => (s.progress ? String(parseFloat(s.progress)) : '')
const setProgress = (s, v) => { s.progress = v === '' ? '' : String(Math.max(0, Math.min(100, Number(v)))) + '%'; touchSlide(s) }

/* ---- the settings ---- */
const st = computed(() => (model.value ? model.value.settings : {}))
const kit = computed(() => (model.value ? model.value.kit : {}))
const changes = () => (model.value.settingsChanges = model.value.settingsChanges || {})
const setSetting = (k, v) => { st.value[k] = v; changes()[k] = v === '' || v == null ? null : String(v) }
const setKit = (k, v) => {
  kit.value[k] = v
  const c = changes()
  if (k === 'published') c.published = v === false ? 'false' : null
  else if (k === 'once') c.once = v ? 'true' : null
  else if (k === 'respond') c.respond = v && v !== 'anyone' ? v : null
  else if (k === 'embedOrigins') c['embed-origins'] = v.length ? v.join(', ') : null
  else if (k === 'webhook') c.webhook = v || null
  else if (k === 'pass') c.pass = v === '' || v == null ? null : String(v)
  else if (k === 'score') c.score = Object.keys(v).length ? Object.entries(v).map(([f, a]) => `${f}: ${a}`).join(', ') : null
}
const origins = computed(() => kit.value.embedOrigins || [])
function setOrigin(i, v) { const l = origins.value.slice(); l[i] = v; setKit('embedOrigins', l.filter((x) => x !== undefined)) }
function addOrigin() { setKit('embedOrigins', [...origins.value, '']) }
function removeOrigin(i) { const l = origins.value.slice(); l.splice(i, 1); setKit('embedOrigins', l) }
const scorable = computed(() => allFields.value.filter((f) => ['choice', 'select', 'picture', 'rating', 'scale'].includes(f.kind)))
const rightOf = (f) => (kit.value.score || {})[f.name] || ''
function setRight(f, v) { const s = { ...(kit.value.score || {}) }; if (v) s[f.name] = v; else delete s[f.name]; setKit('score', s) }
const choicesOf = (f) => (f.kind === 'select' ? f.params.options : f.kind === 'choice' || f.kind === 'picture' ? f.params.choices : Array.from({ length: Number(f.params.outof) || (f.kind === 'rating' ? 5 : 10) }, (_, i) => ({ value: String(i + (f.kind === 'scale' ? Number(f.params.startat ?? 0) : 1)), label: String(i + (f.kind === 'scale' ? Number(f.params.startat ?? 0) : 1)) }))) || []

/* ---- share ---- */
/* every address is the origin this admin is running on — nothing is written in */
const here = typeof location !== 'undefined' ? location.origin : ''
const pageUrl = computed(() => here + '/form/' + props.name)
const snippet = computed(() => `<div data-platformkit-form="${props.name}"></div>\n<script src="${here}/form.js" data-site="${here}" async><\/script>`)
/* Typeform's own embed pointed at this site (forms-api): the form's id and the site as the domain */
const hereHost = here.replace(/^https?:\/\//, '')
const tfSnippet = computed(() => `<div data-tf-widget="${props.name}" data-tf-domain="${hereHost}" style="width:100%;height:600px"></div>\n<script src="//embed.typeform.com/next/embed.js"><\/script>`)
/* the webhook subscriptions the Forms API keeps on this form — read here, written through the API alone */
const hooks = ref([])
async function loadHooks() { try { const { data } = await supabase.from('form_webhooks').select('tag, url, enabled, last_at, last_error').eq('form', props.name).order('created_at'); hooks.value = data || [] } catch (e) { hooks.value = [] } }
onMounted(loadHooks)
const when = (iso) => { try { return new Date(iso).toLocaleString() } catch (e) { return iso } }
const copied = ref('')
async function copy(text, k) { try { await navigator.clipboard.writeText(text); copied.value = k; setTimeout(() => (copied.value = ''), 1500) } catch (e) { /* no clipboard */ } }

/* ---- save ---- */
async function save() {
  if (!model.value) return
  saving.value = true; msg.value = ''
  try {
    await pipe.save('forms', props.name, { parsed: model.value })
    const r = await pipe.read('forms', props.name)
    r.model = r.parsed; r.raw = r.content
    model.value = r.model; raw.value = r.raw; saved.value = snapshot(); msg.value = WSV.saved
    if (!picked.value || !slides.value[picked.value.slide]) picked.value = slides.value.length ? { slide: 0 } : null
    emit('saved')
  } catch (e) { msg.value = e.message } finally { saving.value = false }
}
function discard() { load() }
async function remove() {
  if (!confirm(`${WS.delete}? ${WS['delete-hint']}`)) return
  try { await pipe.remove('forms', props.name); emit('back') } catch (e) { msg.value = e.message }
}
</script>

<template>
  <div class="fb">
    <p v-if="loading" class="ui-muted">…</p>
    <template v-else-if="model">
      <div class="fb-head">
        <h2 class="fb-title">{{ st.title || name }}</h2>
        <span class="ui-grow" />
        <label class="ui-switch"><input type="checkbox" :checked="kit.published !== false" @change="setKit('published', $event.target.checked)" /><i /><span>{{ WS.published }}</span></label>
      </div>
      <p v-if="model.warnings && model.warnings.length" class="ui-hint">{{ model.warnings.map((w) => (w.line ? w.line + ': ' : '') + w.message).join(' · ') }}</p>
      <div class="ui-seg" role="tablist">
        <button v-for="k in ['build', 'settings', 'share']" :key="k" type="button" role="tab" :aria-selected="view === k" :class="{ 'ui-on': view === k }" @click="view = k">{{ WV[k] }}</button>
      </div>

      <!-- ===== build ===== -->
      <div v-show="view === 'build'" class="fb-build">
        <div class="fb-slides">
          <div v-for="(s, si) in slides" :key="si" class="fb-slide" :class="{ 'fb-on': picked && picked.slide === si && picked.block == null }">
            <button type="button" class="fb-slidehead" @click="pick(si)">
              <b>{{ slideLabel(s, si) }}</b>
              <small v-if="s.jump">{{ W['shown-when'].replace('{cond}', describe(s.jump, fieldsBefore(si - 1), WC)) }}</small>
              <small v-else-if="s.progress">{{ W['progress-line'].replace('{p}', progressOf(s)) }}</small>
            </button>
            <draggable v-model="s.blocks" item-key="line" handle=".fb-grip" class="fb-blocks" ghost-class="fb-ghost" :animation="150" @end="onDrag(si)">
              <template #item="{ element: b, index: bj }">
                <button type="button" class="fb-block" :class="['fb-' + b.type, { 'fb-on': picked && picked.slide === si && picked.block === bj }]" @click="pick(si, bj)">
                  <span class="fb-grip" aria-hidden="true">⋮⋮</span>
                  <span class="fb-kind">{{ b.type === 'field' ? (K[b.kind] || b.kind) : b.type === 'markdown' ? WT.heading : W.raw }}</span>
                  <span class="fb-sum">{{ summary(b) }}<i v-if="b.condition" class="fb-cond" :title="describe(b.condition, fieldsBefore(si), WC)">?</i><i v-if="b.type === 'field' && b.required" class="fb-req">*</i></span>
                </button>
              </template>
            </draggable>
            <p v-if="!s.blocks.length" class="ui-hint fb-empty">{{ W.empty }}</p>
            <div class="fb-adds">
              <button type="button" class="ui-btn ui-ghost ui-sm" @click="addField(si)">{{ W['add-field'] }}</button>
              <button type="button" class="ui-btn ui-ghost ui-sm" @click="addText(si)">{{ W['add-text'] }}</button>
              <span class="ui-grow" />
              <button v-if="s.type !== 'end'" type="button" class="ui-btn ui-ghost ui-sm" @click="addSlide(si)">{{ W['add-slide'] }}</button>
            </div>
          </div>
          <button v-if="!slides.length" type="button" class="ui-btn ui-ghost" @click="addSlide()">{{ W['add-slide'] }}</button>
        </div>

        <div class="fb-inspector ui-card">
          <template v-if="cur && cur.kind === 'slide'">
            <div class="ui-cardhead"><h3>{{ W.heading }}</h3></div>
            <label class="ui-field"><span>{{ W.type }}</span><select class="ui-select" :value="cur.slide.type" @change="setType(cur.slide, $event.target.value)"><option value="start">{{ W['type-start'] }}</option><option value="body">{{ W['type-body'] }}</option><option value="end">{{ W['type-end'] }}</option></select></label>
            <label v-if="cur.slide.type === 'start'" class="ui-field"><span>{{ W.button }}</span><input class="ui-input" :value="cur.slide.button" @input="cur.slide.button = $event.target.value; touchSlide(cur.slide)" /></label>
            <label v-if="cur.slide.type === 'end'" class="ui-field"><span>{{ W.redirect }}</span><input class="ui-input" type="url" :value="cur.slide.redirect" @input="cur.slide.redirect = $event.target.value; touchSlide(cur.slide)" /></label>
            <template v-if="cur.slide.type === 'body'">
              <ConditionEditor v-if="cur.i > 0" :model-value="cur.slide.jump" :fields="fieldsBefore(cur.i - 1)" :label="W.jump" @update:model-value="(v) => { cur.slide.jump = v; touchSlide(cur.slide) }" />
              <div class="ui-row">
                <label class="ui-field fb-num"><span>{{ W.progress }} <small>· {{ W['progress-hint'] }}</small></span><input class="ui-input" type="number" min="0" max="100" :value="progressOf(cur.slide)" @input="setProgress(cur.slide, $event.target.value)" /></label>
                <label class="ui-field"><span>{{ W.align }}</span><select class="ui-select" :value="cur.slide.align" @change="cur.slide.align = $event.target.value; touchSlide(cur.slide)"><option value="">—</option><option value="start">{{ W['align-start'] }}</option><option value="center">{{ W['align-center'] }}</option><option value="end">{{ W['align-end'] }}</option><option value="stretch">{{ W['align-stretch'] }}</option></select></label>
              </div>
              <div class="ui-row ui-wrap">
                <label class="ui-switch"><input type="checkbox" :checked="cur.slide.disablePrev" @change="cur.slide.disablePrev = $event.target.checked; touchSlide(cur.slide)" /><i /><span>{{ W['disable-prev'] }}</span></label>
                <label class="ui-switch"><input type="checkbox" :checked="cur.slide.post" @change="cur.slide.post = $event.target.checked; touchSlide(cur.slide)" /><i /><span>{{ W.post }}</span></label>
              </div>
            </template>
            <div class="ui-cardrow fb-acts"><span class="ui-grow" /><button type="button" class="ui-btn ui-ghost ui-danger ui-sm" @click="removeSlide(cur.i)">{{ W.remove }}</button></div>
          </template>
          <template v-else-if="cur && cur.block && cur.block.type === 'field'">
            <div class="ui-cardhead"><h3>{{ (A.field || {}).heading }}</h3></div>
            <FieldInspector :key="cur.i + ':' + cur.j" :block="cur.block" :fields="fieldsBefore(cur.i)" @remove="removeBlock(cur.i, cur.j)" @move="(d) => moveBlock(cur.i, cur.j, d)" />
          </template>
          <template v-else-if="cur && cur.block && cur.block.type === 'markdown'">
            <div class="ui-cardhead"><h3>{{ WT.heading }}</h3><span>{{ WT.hint }}</span></div>
            <MarkdownEditor :key="cur.i + ':' + cur.j" :model-value="cur.block.md" class="fb-md" @update:model-value="(v) => setMd(cur.block, v)" />
            <label v-if="fieldsBefore(cur.i).length" class="ui-field"><span>{{ WT.bind }}</span><select class="ui-select" value="" @change="(e) => { if (e.target.value) { setMd(cur.block, (cur.block.md || '').replace(/\s+$/, '') + ' {$ ' + e.target.value + ' $}'); e.target.value = '' } }"><option value="">{{ WT['bind-pick'] }}</option><option v-for="f in fieldsBefore(cur.i)" :key="f.name" :value="f.name">{{ f.params.question === '...' || !f.params.question ? f.name : f.params.question }}</option></select></label>
            <ConditionEditor :model-value="cur.block.condition || ''" :fields="fieldsBefore(cur.i)" :label="(A.field || {}).condition" @update:model-value="(v) => { cur.block.condition = v; cur.block.deps = []; cur.block.dirty = true; if (cur.block.raw != null) { cur.block.raw = null } }" />
            <div class="ui-cardrow fb-acts"><button type="button" class="ui-btn ui-ghost ui-sm" @click="moveBlock(cur.i, cur.j, -1)">← {{ (A.field || {})['move-up'] }}</button><button type="button" class="ui-btn ui-ghost ui-sm" @click="moveBlock(cur.i, cur.j, 1)">{{ (A.field || {})['move-down'] }} →</button><span class="ui-grow" /><button type="button" class="ui-btn ui-ghost ui-danger ui-sm" @click="removeBlock(cur.i, cur.j)">{{ (A.field || {}).remove }}</button></div>
          </template>
          <template v-else-if="cur && cur.block">
            <div class="ui-cardhead"><h3>{{ W.raw }}</h3></div>
            <pre class="fb-raw">{{ cur.block.raw }}</pre>
            <div class="ui-cardrow fb-acts"><span class="ui-grow" /><button type="button" class="ui-btn ui-ghost ui-danger ui-sm" @click="removeBlock(cur.i, cur.j)">{{ (A.field || {}).remove }}</button></div>
          </template>
          <p v-else class="ui-hint">{{ W.empty }}</p>
        </div>
      </div>

      <!-- ===== settings ===== -->
      <div v-show="view === 'settings'" class="fb-settings">
        <div class="ui-card">
          <label class="ui-field"><span>{{ WS.title }}</span><input class="ui-input" :value="st.title || ''" @input="setSetting('title', $event.target.value)" /></label>
          <label class="ui-field"><span>{{ WS['meta-description'] }}</span><input class="ui-input" :value="st['meta-description'] || ''" @input="setSetting('meta-description', $event.target.value)" /></label>
          <code class="ui-key">content/forms/{{ name }}.md</code>
          <div class="ui-row">
            <label class="ui-field"><span>{{ WS.page }}</span><select class="ui-select" :value="st.page" @change="setSetting('page', $event.target.value)"><option value="form-slides">{{ WS['page-form-slides'] }}</option><option value="slides">{{ WS['page-slides'] }}</option><option value="single">{{ WS['page-single'] }}</option></select></label>
            <label class="ui-field"><span>{{ WS['page-progress'] }}</span><select class="ui-select" :value="st['page-progress'] || 'show'" @change="setSetting('page-progress', $event.target.value === 'show' ? '' : $event.target.value)"><option value="show">{{ WS['progress-show'] }}</option><option value="hide">{{ WS['progress-hide'] }}</option><option value="decorative">{{ WS['progress-decorative'] }}</option></select></label>
            <label class="ui-field"><span>{{ WS['slide-controls'] }}</span><select class="ui-select" :value="st['slide-controls'] || 'show'" @change="setSetting('slide-controls', $event.target.value === 'show' ? '' : $event.target.value)"><option value="show">{{ WS['controls-show'] }}</option><option value="hide">{{ WS['controls-hide'] }}</option></select></label>
          </div>
          <div class="ui-row">
            <label class="ui-field"><span>{{ WS['submit-text'] }}</span><input class="ui-input" :value="st['submit-button-text'] || ''" @input="setSetting('submit-button-text', $event.target.value)" /></label>
            <label class="ui-field"><span>{{ WS.align }}</span><select class="ui-select" :value="st['button-alignment'] || ''" @change="setSetting('button-alignment', $event.target.value)"><option value="">—</option><option value="center">{{ W['align-center'] }}</option><option value="end">{{ W['align-end'] }}</option><option value="stretch">{{ W['align-stretch'] }}</option></select></label>
          </div>
          <div class="ui-row ui-wrap">
            <label class="ui-switch"><input type="checkbox" :checked="st['restart-button'] === 'show'" @change="setSetting('restart-button', $event.target.checked ? 'show' : '')" /><i /><span>{{ WS.restart }}</span></label>
            <label class="ui-switch"><input type="checkbox" :checked="st.autofocus === 'all-slides'" @change="setSetting('autofocus', $event.target.checked ? 'all-slides' : '')" /><i /><span>{{ WS.autofocus }}</span></label>
          </div>
        </div>
        <div class="ui-card">
          <div class="ui-row ui-wrap">
            <label class="ui-switch"><input type="checkbox" :checked="kit.once" @change="setKit('once', $event.target.checked)" /><i /><span>{{ WS.once }}</span></label>
            <label class="ui-field"><span>{{ WS.respond }}</span><select class="ui-select" :value="kit.respond" @change="setKit('respond', $event.target.value)"><option value="anyone">{{ WS['respond-anyone'] }}</option><option value="authenticated">{{ WS['respond-authenticated'] }}</option></select></label>
          </div>
          <label class="ui-field"><span>{{ WS.webhook }}</span><input class="ui-input" type="url" :value="kit.webhook || ''" @input="setKit('webhook', $event.target.value)" /></label>
          <div class="ui-field"><span>{{ WS['webhooks-api'] }}</span>
            <p v-if="!hooks.length" class="ui-hint">{{ WS['webhooks-none'] }}</p>
            <ul v-else class="fb-hooks"><li v-for="h in hooks" :key="h.tag"><code class="ui-key">{{ h.tag }}</code><span class="ui-mono fb-hookurl">{{ h.url }}</span><span class="ui-badge" :class="{ 'ui-ok': h.enabled }">{{ h.enabled ? WS['webhooks-on'] : WS['webhooks-off'] }}</span><small v-if="h.last_error" class="ui-err">{{ h.last_error }}</small><small v-else-if="h.last_at">{{ WS['webhooks-last'].replace('{at}', when(h.last_at)) }}</small></li></ul>
          </div>
          <div class="ui-field"><span>{{ WS['embed-origins'] }}</span>
            <div class="fb-origins">
              <div v-for="(o, i) in origins" :key="i" class="fb-origin"><input class="ui-input ui-mono" type="url" :value="o" :placeholder="WS['embed-origin-placeholder']" @input="setOrigin(i, $event.target.value)" /><button type="button" class="ui-iconbtn" @click="removeOrigin(i)">×</button></div>
              <button type="button" class="ui-btn ui-ghost ui-sm" @click="addOrigin">+</button>
            </div>
          </div>
        </div>
        <div class="ui-card">
          <div class="ui-cardhead"><h3>{{ WS['quiz-heading'] }}</h3><span>{{ WS['quiz-lead'] }}</span></div>
          <div v-for="f in scorable" :key="f.name" class="ui-row fb-right">
            <span class="fb-rightq">{{ f.params.question === '...' ? f.name : f.params.question }}</span>
            <select class="ui-select" :value="rightOf(f)" @change="setRight(f, $event.target.value)"><option value="">{{ WS['right-none'] }}</option><option v-for="c in choicesOf(f)" :key="c.value" :value="c.value">{{ c.label }}</option></select>
          </div>
          <label v-if="Object.keys(kit.score || {}).length" class="ui-field fb-num"><span>{{ WS.pass }}</span><input class="ui-input" type="number" min="0" :max="Object.keys(kit.score).length" :value="kit.pass ?? ''" @input="setKit('pass', $event.target.value === '' ? null : Number($event.target.value))" /></label>
        </div>
        <div class="ui-cardrow fb-danger"><span class="ui-hint">{{ WS['delete-hint'] }}</span><span class="ui-grow" /><button type="button" class="ui-btn ui-ghost ui-danger ui-sm" @click="remove">{{ WS.delete }}</button></div>
      </div>

      <!-- ===== share ===== -->
      <div v-show="view === 'share'" class="fb-share">
        <div class="ui-card"><div class="ui-cardhead"><h3>{{ WH.page }}</h3><span>{{ WH['page-hint'] }}</span></div><div class="fb-copyrow"><code class="ui-key">{{ pageUrl }}</code><a class="ui-btn ui-ghost ui-sm" :href="'/form/' + name" target="_blank" rel="noopener">↗</a><button type="button" class="ui-btn ui-ghost ui-sm" @click="copy(pageUrl, 'page')">{{ copied === 'page' ? WH.copied : WH.copy }}</button></div></div>
        <div class="ui-card"><div class="ui-cardhead"><h3>{{ WH.embed }}</h3><span>{{ WH['embed-hint'] }}</span></div><div class="fb-copyrow"><pre class="fb-snippet">{{ snippet }}</pre><button type="button" class="ui-btn ui-ghost ui-sm" @click="copy(snippet, 'embed')">{{ copied === 'embed' ? WH.copied : WH.copy }}</button></div></div>
        <div class="ui-card"><div class="ui-cardhead"><h3>{{ WH.typeform }}</h3><span>{{ WH['typeform-hint'] }}</span></div><div class="fb-copyrow"><pre class="fb-snippet">{{ tfSnippet }}</pre><button type="button" class="ui-btn ui-ghost ui-sm" @click="copy(tfSnippet, 'tf')">{{ copied === 'tf' ? WH.copied : WH.copy }}</button></div></div>
        <div class="ui-card"><div class="ui-cardhead"><h3>{{ WH.section }}</h3><span>{{ WH['section-hint'] }}</span></div></div>
      </div>

      <div class="ui-savebar">
        <span class="ui-dirty" :class="{ 'ui-clean': !dirty }">{{ dirty ? WSV.dirty : (msg || WSV.clean) }}</span>
        <span v-if="dirty && msg" class="ui-err">{{ msg }}</span>
        <span class="ui-grow" />
        <button type="button" class="ui-btn ui-ghost" :disabled="!dirty" @click="discard">{{ WSV.discard }}</button>
        <button type="button" class="ui-btn ui-primary" :disabled="saving || !dirty" @click="save">{{ saving ? WSV.saving : WSV.save }}</button>
      </div>
    </template>
    <p v-else class="ui-err">{{ msg }}</p>
  </div>
</template>

<style scoped>
.fb { display: flex; flex-direction: column; gap: 14px; width: 100%; flex: 1; min-height: 0 }
.fb-head { display: flex; align-items: center; gap: 14px } .fb-title { font-family: var(--fd); font-weight: 600; font-size: 28px; letter-spacing: -.02em; margin: 0 }
.fb-build { display: grid; grid-template-columns: minmax(300px, 420px) minmax(0, 1fr); gap: 18px; align-items: start }
.fb-slides { display: flex; flex-direction: column; gap: 12px }
.fb-slide { border: 1px solid var(--hair); border-radius: 14px; background: var(--card); padding: 10px; display: flex; flex-direction: column; gap: 6px }
.fb-slide.fb-on { border-color: var(--ink3) }
.fb-slidehead { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; font: inherit; background: none; border: 0; padding: 4px 6px; cursor: pointer; color: var(--ink); text-align: left; border-radius: 8px }
.fb-slidehead:hover { background: color-mix(in srgb, var(--ink) 4%, transparent) }
.fb-slidehead b { font-family: var(--m); font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3) } .fb-slidehead small { font-size: 12px; color: var(--ink2) }
.fb-blocks { display: flex; flex-direction: column; gap: 4px }
.fb-block { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 8px; align-items: center; font: inherit; text-align: left; background: none; border: 1px solid transparent; border-radius: 10px; padding: 7px 8px; cursor: pointer; color: var(--ink) }
.fb-block:hover { background: color-mix(in srgb, var(--ink) 4%, transparent) } .fb-block.fb-on { border-color: var(--ink); background: color-mix(in srgb, var(--ink) 5%, transparent) }
.fb-grip { color: var(--ink3); font-size: 11px; letter-spacing: -2px; cursor: grab }
.fb-kind { font-family: var(--m); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); white-space: nowrap; min-width: 62px }
.fb-markdown .fb-kind { color: var(--accent2) }
.fb-sum { font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.fb-cond, .fb-req { font-style: normal; font-family: var(--m); font-size: 10px; margin-left: 6px; color: var(--ink3); border: 1px solid var(--hair); border-radius: 4px; padding: 0 4px }
.fb-req { border: 0; color: var(--accent2); font-size: 13px; padding: 0 }
.fb-ghost { opacity: .4 }
.fb-empty { margin: 0 6px }
.fb-adds { display: flex; gap: 6px; padding-top: 4px; border-top: 1px dashed var(--hair) }
.fb-inspector { position: sticky; top: 12px; gap: 12px; max-height: calc(100vh - 140px); overflow-y: auto }
.fb-num { max-width: 140px }
.fb-acts { padding-top: 10px; border-top: 1px solid var(--hair); gap: 6px }
.fb-md { min-height: 260px }
.fb-raw { font-family: var(--m); font-size: 12px; white-space: pre-wrap; background: color-mix(in srgb, var(--ink) 4%, transparent); border-radius: 10px; padding: 12px; margin: 0; color: var(--ink2) }
.fb-settings, .fb-share { display: flex; flex-direction: column; gap: 14px; max-width: 760px }
.fb-origins { display: flex; flex-direction: column; gap: 6px } .fb-origin { display: flex; gap: 6px }
.fb-right { align-items: center } .fb-rightq { flex: 1; font-size: 13.5px }
.fb-danger { padding-top: 10px; border-top: 1px solid var(--hair) }
.fb-hooks { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px } .fb-hooks li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px } .fb-hookurl { color: var(--ink2); overflow: hidden; text-overflow: ellipsis; max-width: 100% }
.fb-copyrow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap } .fb-snippet { flex: 1; min-width: 0; font-family: var(--m); font-size: 12px; white-space: pre-wrap; background: color-mix(in srgb, var(--ink) 4%, transparent); border-radius: 10px; padding: 12px; margin: 0 }
@media (max-width: 1100px) { .fb-build { grid-template-columns: 1fr } .fb-inspector { position: static; max-height: none } }
</style>

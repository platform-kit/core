<script setup>
/* One field of a content model, edited as controls: its kind from a grouped list, key, label, help, a default
   of its kind, Required · Unique · In the grid, Shown when as one condition row, Rules as rows (the rule from
   the list the kind takes, its parameters as the controls rules.js says), and the kind's own — options as rows,
   the referenced model and One / Several, a list's kind or a group's sub-fields (the same inspector, `nested`,
   one level down). Never a schema, never a string. */
import { computed } from 'vue'
import Select from 'primevue/select'
import { KINDS, KIND_KEYS, LEAF_KINDS, GROUPS, RULES, rulesFor } from '@platform-kit/kit/lib/models/rules.js'
import { us } from '@platform-kit/kit/lib/strings.js'
import './admin-ui.css'
const props = defineProps({ field: { type: Object, required: true }, fields: { type: Array, default: () => [] }, models: { type: Array, default: () => [] }, nested: { type: Boolean, default: false }, saved: { type: Boolean, default: false } })
const emit = defineEmits(['remove', 'rename'])
const M = us('models'), A = M.admin || {}
const W = A.fields || {}, WS = A.shown || {}, WR = A.rules || {}, K = M.kinds || {}, KG = M.groups || {}, R = M.rules || {}, WE = (M.pages || {}).entry || {}
const f = computed(() => props.field)
const kinds = computed(() => (props.nested ? LEAF_KINDS : KIND_KEYS))
/* the kinds grouped for the select: Text · Choices · Media · Structure */
const grouped = computed(() => GROUPS.map((g) => ({ group: (KG[g] || {}).name || g, items: kinds.value.filter((k) => KINDS[k].group === g).map((k) => ({ value: k, label: (K[k] || {}).name || k, line: (K[k] || {}).line || '' })) })).filter((g) => g.items.length))
const rowKinds = computed(() => grouped.value.map((g) => ({ ...g, items: g.items.filter((x) => x.value !== 'list') })))
const kindName = (k) => (K[k] || {}).name || k
const camel = (s) => String(s || '').trim().replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^[A-Z]/, (c) => c.toLowerCase()).replace(/^[^a-z]+/, '')
function setLabel(v) { f.value.label = v; if (f.value._new) f.value.key = camel(v) || 'field' }
function setKind(k) {
  const was = f.value.kind
  if (!k || was === k) return
  f.value.kind = k
  /* what the old kind carried and the new one does not is dropped; what the new one needs is started */
  if (k !== 'select' && k !== 'multi-select' && !(k === 'list' && f.value.of === 'select')) delete f.value.options
  if (k !== 'reference' && !(k === 'list' && f.value.of === 'reference')) { delete f.value.model; delete f.value.many }
  if (k !== 'group' && !(k === 'list' && f.value.of === 'group')) delete f.value.fields
  if (k !== 'list') delete f.value.of
  if (k === 'list' && !f.value.of) f.value.of = 'text'
  if ((k === 'select' || k === 'multi-select') && !f.value.options) f.value.options = [{ value: '', label: '' }]
  if (k === 'reference' && !f.value.model) f.value.model = (props.models[0] && props.models[0].key) || ''
  if (k === 'group' && !f.value.fields) f.value.fields = []
  if (f.value.unique && !(KINDS[k].base === 'string' && k !== 'markdown')) delete f.value.unique
  if (f.value.rules) f.value.rules = f.value.rules.filter((r) => rulesFor(k).includes(r.rule))
  if (!f.value.rules || !f.value.rules.length) delete f.value.rules
  delete f.value.default
  f.value._kindChanged = true
}
function setOf(of) {
  if (!of) return
  f.value.of = of
  if (of === 'select' && !f.value.options) f.value.options = [{ value: '', label: '' }]
  if (of !== 'select') delete f.value.options
  if (of === 'reference' && !f.value.model) f.value.model = (props.models[0] && props.models[0].key) || ''
  if (of !== 'reference') { delete f.value.model; delete f.value.many }
  if (of === 'group' && !f.value.fields) f.value.fields = []
  if (of !== 'group') delete f.value.fields
  f.value._kindChanged = true
}
const uniqueOk = computed(() => !props.nested && KINDS[f.value.kind] && KINDS[f.value.kind].base === 'string' && f.value.kind !== 'markdown')
const defaultKind = computed(() => ({ text: 'text', url: 'url', email: 'email', number: 'number', boolean: 'boolean', date: 'date', datetime: 'datetime-local', 'long-text': 'textarea', select: 'select' }[f.value.kind] || null))
function setDefault(v) { if (v === '' || v === undefined || v === null) delete f.value.default; else f.value.default = f.value.kind === 'number' ? Number(v) : v }
function setHelp(v) { if (v) f.value.help = v; else delete f.value.help }
function flag(k, on) { if (on) f.value[k] = true; else delete f.value[k]; if (k === 'required') f.value._kindChanged = true }
const yesNo = [{ value: 'true', label: WE.yes || 'Yes' }, { value: 'false', label: WE.no || 'No' }]

/* ---- shown when ---- */
const others = computed(() => props.fields.filter((x) => x !== f.value && x.key).map((x) => ({ value: x.key, label: x.label || x.key, field: x })))
const target = computed(() => (f.value.shown ? others.value.find((x) => x.value === f.value.shown.field) : null))
const comparisons = [{ value: 'is', label: WS.is }, { value: 'is-not', label: WS['is-not'] }, { value: 'empty', label: WS.empty }, { value: 'not-empty', label: WS['not-empty'] }]
function setShown(on) { if (!on) delete f.value.shown; else { f.value.shown = { field: (others.value[0] && others.value[0].value) || '', is: 'is', value: '' }; shownField(f.value.shown.field) } }
function shownField(k) { if (!k) return; f.value.shown.field = k; const t = others.value.find((x) => x.value === k); const tf = t && t.field; f.value.shown.value = tf && tf.kind === 'boolean' ? true : tf && tf.options && tf.options[0] ? tf.options[0].value : '' }
function shownIs(v) { if (!v) return; f.value.shown.is = v; if (v === 'empty' || v === 'not-empty') delete f.value.shown.value; else if (!('value' in f.value.shown)) f.value.shown.value = '' }
const targetOptions = computed(() => (target.value && target.value.field.options ? target.value.field.options.map((o) => ({ value: o.value, label: o.label || o.value })) : []))

/* ---- rules ---- */
const ruleKeys = computed(() => rulesFor(f.value.kind === 'list' ? 'list' : f.value.kind))
const ruleOptions = computed(() => ruleKeys.value.map((k) => ({ value: k, label: (R[k] || {}).name || k })))
const shape = (rule) => (RULES[rule] || {}).params
function addRule() { const rule = ruleKeys.value.find((r) => !(f.value.rules || []).some((x) => x.rule === r)) || ruleKeys.value[0]; if (!rule) return; f.value.rules = [...(f.value.rules || []), fresh(rule)]; f.value._kindChanged = true }
function fresh(rule) { const s = shape(rule); return s === 'none' ? { rule } : s === 'range' ? { rule, params: [0, 10] } : s === 'list' ? { rule, params: [''] } : s === 'n' ? { rule, params: 1 } : { rule, params: '' } }
function setRule(i, rule) { if (!rule) return; f.value.rules.splice(i, 1, fresh(rule)); f.value._kindChanged = true }
function setParam(i, v, j) { const r = f.value.rules[i]; const s = shape(r.rule); if (s === 'n') r.params = Number(v); else if (s === 'range') { r.params = [...r.params]; r.params[j] = Number(v) } else r.params = v; f.value._kindChanged = true }
function setListParam(i, j, v) { const r = f.value.rules[i]; r.params = [...r.params]; r.params[j] = v; f.value._kindChanged = true }
function addListParam(i) { f.value.rules[i].params = [...f.value.rules[i].params, '']; f.value._kindChanged = true }
function removeListParam(i, j) { const r = f.value.rules[i]; r.params = r.params.filter((_, k) => k !== j); if (!r.params.length) r.params = ['']; f.value._kindChanged = true }
function removeRule(i) { f.value.rules.splice(i, 1); if (!f.value.rules.length) delete f.value.rules; f.value._kindChanged = true }

/* ---- options, sub-fields ---- */
function addOption() { f.value.options = [...(f.value.options || []), { value: '', label: '' }] }
function setOption(i, k, v) { const o = { ...f.value.options[i], [k]: v }; if (k === 'label' && (!o.value || o.value === camel(f.value.options[i].label))) o.value = camel(v); f.value.options.splice(i, 1, o) }
function removeOption(i) { f.value.options.splice(i, 1) }
function addSub() { f.value.fields = [...(f.value.fields || []), { key: 'field' + ((f.value.fields || []).length + 1), kind: 'text', label: '', _new: true, _open: true }] }
function removeSub(i) { f.value.fields.splice(i, 1) }
function rename() { const to = window.prompt(W['rename-prompt'], f.value.key); if (!to || to === f.value.key) return; if (props.fields.some((x) => x !== f.value && x.key === to)) { window.alert(W['rename-refused']); return } emit('rename', { from: f.value.key, to }) }
const modelOptions = computed(() => props.models.map((m) => ({ value: m.key, label: m.name })))
</script>

<template>
  <div class="mf" :class="{ 'mf-nested': nested }">
    <!-- what it is -->
    <div class="mf-block">
      <div class="mf-grid2">
        <label class="ui-field"><span>{{ W.label }}</span><input class="ui-input" :value="f.label" @input="setLabel($event.target.value)" /></label>
        <label class="ui-field"><span>{{ W.kind }}</span>
          <Select :model-value="f.kind" :options="grouped" optionLabel="label" optionValue="value" optionGroupLabel="group" optionGroupChildren="items" fluid @update:model-value="setKind">
            <template #option="{ option }"><span class="mf-kopt"><b>{{ option.label }}</b><small>{{ option.line }}</small></span></template>
          </Select>
        </label>
      </div>
      <label class="ui-field"><span>{{ W.key }} <small>· {{ W['key-help'] }}</small></span>
        <span class="mf-keyrow"><input class="ui-input ui-mono" :value="f.key" :readonly="!f._new" @input="f._new && (f.key = $event.target.value)" /><button v-if="!f._new && !nested && saved" type="button" class="ui-btn ui-ghost ui-sm" @click="rename">{{ W.rename }}</button></span>
      </label>
      <label class="ui-field"><span>{{ W.help }} <small>· {{ W['help-help'] }}</small></span><input class="ui-input" :value="f.help || ''" @input="setHelp($event.target.value)" /></label>
    </div>

    <!-- the kind's own -->
    <div v-if="f.kind === 'select' || f.kind === 'multi-select' || (f.kind === 'list' && f.of === 'select') || f.kind === 'reference' || (f.kind === 'list' && f.of === 'reference') || f.kind === 'list' || f.kind === 'group'" class="mf-block">
      <label v-if="f.kind === 'list'" class="ui-field"><span>{{ W.of }}</span>
        <Select :model-value="f.of" :options="rowKinds" optionLabel="label" optionValue="value" optionGroupLabel="group" optionGroupChildren="items" fluid @update:model-value="setOf" />
      </label>
      <div v-if="f.kind === 'select' || f.kind === 'multi-select' || (f.kind === 'list' && f.of === 'select')" class="ui-field"><span>{{ W.options }}</span>
        <div class="mf-rows">
          <div v-for="(o, i) in f.options || []" :key="i" class="mf-row mf-opt"><input class="ui-input" :placeholder="W['option-label']" :value="o.label" @input="setOption(i, 'label', $event.target.value)" /><input class="ui-input ui-mono" :placeholder="W['option-value']" :value="o.value" @input="setOption(i, 'value', $event.target.value)" /><button type="button" class="ui-iconbtn" @click="removeOption(i)">×</button></div>
          <button type="button" class="ui-btn ui-ghost ui-sm" @click="addOption">+ {{ W['options-add'] }}</button>
        </div>
      </div>
      <div v-if="f.kind === 'reference' || (f.kind === 'list' && f.of === 'reference')" class="mf-grid2">
        <label class="ui-field"><span>{{ W.model }}</span><Select :model-value="f.model" :options="modelOptions" optionLabel="label" optionValue="value" fluid @update:model-value="(v) => { if (v) f.model = v }" /></label>
        <label v-if="f.kind === 'reference'" class="ui-field"><span>&nbsp;</span><span class="ui-seg mf-seg"><button type="button" :class="{ 'ui-on': !f.many }" @click="delete f.many">{{ W.one }}</button><button type="button" :class="{ 'ui-on': !!f.many }" @click="f.many = true">{{ W.many }}</button></span></label>
      </div>
      <div v-if="f.kind === 'group' || (f.kind === 'list' && f.of === 'group')" class="ui-field"><span>{{ W.subfields }}</span>
        <div class="mf-subs">
          <div v-for="(g, i) in f.fields || []" :key="i" class="mf-sub" :class="{ 'mf-subopen': g._open }">
            <button type="button" class="mf-subhead" @click="g._open = !g._open"><span class="mf-subchev" aria-hidden="true">›</span><span class="mf-subname">{{ g.label || g.key }}</span><span class="mf-subkind">{{ kindName(g.kind) }}</span><span class="ui-iconbtn mf-subx" role="button" @click.stop="removeSub(i)">×</span></button>
            <ModelField v-if="g._open" :field="g" :fields="f.fields" :models="models" nested />
          </div>
          <button type="button" class="ui-btn ui-ghost ui-sm" @click="addSub">+ {{ W['subfields-add'] }}</button>
        </div>
      </div>
    </div>

    <!-- the checks -->
    <div class="mf-block">
      <div class="mf-switches">
        <label class="ui-switch"><input type="checkbox" :checked="!!f.required" @change="flag('required', $event.target.checked)" /><i /><span>{{ W.required }}</span></label>
        <label v-if="uniqueOk" class="ui-switch"><input type="checkbox" :checked="!!f.unique" @change="flag('unique', $event.target.checked)" /><i /><span>{{ W.unique }}</span></label>
        <label v-if="!nested" class="ui-switch"><input type="checkbox" :checked="!!f.grid" @change="flag('grid', $event.target.checked)" /><i /><span>{{ W.grid }}</span></label>
      </div>
      <label v-if="defaultKind && defaultKind !== 'select' && defaultKind !== 'boolean' && defaultKind !== 'textarea'" class="ui-field"><span>{{ W.default }}</span><input class="ui-input" :type="defaultKind" :value="f.default ?? ''" @input="setDefault($event.target.value)" /></label>
      <label v-else-if="defaultKind === 'textarea'" class="ui-field"><span>{{ W.default }}</span><textarea class="ui-input mf-ta" rows="2" :value="f.default ?? ''" @input="setDefault($event.target.value)" /></label>
      <label v-else-if="defaultKind === 'select'" class="ui-field"><span>{{ W.default }}</span><Select :model-value="f.default ?? null" :options="(f.options || []).map((o) => ({ value: o.value, label: o.label || o.value }))" optionLabel="label" optionValue="value" showClear fluid @update:model-value="setDefault($event ?? '')" /></label>
      <label v-else-if="defaultKind === 'boolean'" class="ui-field"><span>{{ W.default }}</span><Select :model-value="f.default === undefined ? null : String(f.default)" :options="yesNo" optionLabel="label" optionValue="value" showClear fluid @update:model-value="(v) => (v == null ? delete f.default : (f.default = v === 'true'))" /></label>

      <div v-if="ruleKeys.length" class="ui-field"><span>{{ WR.label }}</span>
        <div class="mf-rows">
          <div v-for="(r, i) in f.rules || []" :key="i" class="mf-row mf-rule">
            <Select class="mf-rulesel" :model-value="r.rule" :options="ruleOptions" optionLabel="label" optionValue="value" @update:model-value="(v) => setRule(i, v)" />
            <input v-if="shape(r.rule) === 'n'" class="ui-input mf-num" type="number" :aria-label="(R[r.rule] || {}).param" :value="r.params" @input="setParam(i, $event.target.value)" />
            <template v-else-if="shape(r.rule) === 'range'"><input class="ui-input mf-num" type="number" :aria-label="(R[r.rule] || {})['param-min']" :value="r.params[0]" @input="setParam(i, $event.target.value, 0)" /><span class="mf-dash">–</span><input class="ui-input mf-num" type="number" :aria-label="(R[r.rule] || {})['param-max']" :value="r.params[1]" @input="setParam(i, $event.target.value, 1)" /></template>
            <input v-else-if="shape(r.rule) === 'date'" class="ui-input mf-date" type="date" :aria-label="(R[r.rule] || {}).param" :value="r.params" @input="setParam(i, $event.target.value)" />
            <input v-else-if="shape(r.rule) === 'text' || shape(r.rule) === 'pattern'" class="ui-input" :class="{ 'ui-mono': shape(r.rule) === 'pattern' }" :aria-label="(R[r.rule] || {}).param" :value="r.params" @input="setParam(i, $event.target.value)" />
            <span v-else-if="shape(r.rule) === 'list'" class="mf-list"><span v-for="(v, j) in r.params" :key="j" class="mf-listitem"><input class="ui-input" :value="v" :aria-label="(R[r.rule] || {}).param" @input="setListParam(i, j, $event.target.value)" /><button type="button" class="ui-iconbtn" @click="removeListParam(i, j)">×</button></span><button type="button" class="ui-btn ui-ghost ui-sm" @click="addListParam(i)">+</button></span>
            <span v-else class="ui-grow" />
            <button type="button" class="ui-iconbtn" :title="WR.remove" @click="removeRule(i)">×</button>
          </div>
          <button type="button" class="ui-btn ui-ghost ui-sm" @click="addRule">+ {{ WR.add }}</button>
        </div>
      </div>

      <div v-if="!nested && others.length" class="ui-field"><span>{{ WS.label }} <small>· {{ WS.help }}</small></span>
        <div v-if="!f.shown" class="mf-rows"><button type="button" class="ui-btn ui-ghost ui-sm" @click="setShown(true)">+ {{ WS.add }}</button></div>
        <div v-else class="mf-row mf-shown">
          <Select class="mf-shownsel" :model-value="f.shown.field" :options="others" optionLabel="label" optionValue="value" @update:model-value="shownField" />
          <Select class="mf-shownis" :model-value="f.shown.is" :options="comparisons" optionLabel="label" optionValue="value" @update:model-value="shownIs" />
          <template v-if="f.shown.is === 'is' || f.shown.is === 'is-not'">
            <Select v-if="target && target.field.kind === 'boolean'" class="mf-shownval" :model-value="String(f.shown.value)" :options="yesNo" optionLabel="label" optionValue="value" @update:model-value="(v) => { if (v != null) f.shown.value = v === 'true' }" />
            <Select v-else-if="targetOptions.length" class="mf-shownval" :model-value="f.shown.value" :options="targetOptions" optionLabel="label" optionValue="value" @update:model-value="(v) => { if (v != null) f.shown.value = v }" />
            <input v-else class="ui-input mf-shownval" :value="f.shown.value ?? ''" :aria-label="WS.value" @input="f.shown.value = $event.target.value" />
          </template>
          <button type="button" class="ui-iconbtn" :title="WS.clear" @click="setShown(false)">×</button>
        </div>
      </div>
    </div>

    <div v-if="!nested" class="mf-acts"><span class="ui-grow" /><button type="button" class="ui-btn ui-ghost ui-danger ui-sm" @click="emit('remove')">{{ W.remove }}</button></div>
  </div>
</template>

<style scoped>
.mf { display: flex; flex-direction: column; gap: 0 }
.mf-block { display: flex; flex-direction: column; gap: 14px; padding: 16px 0; border-top: 1px solid var(--hair) } .mf-block:first-child { border-top: 0; padding-top: 0 }
.mf-nested .mf-block { padding: 12px 0 }
.mf-grid2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px }
.mf-keyrow { display: flex; gap: 6px } .mf-keyrow input { flex: 1; min-width: 0 }
.mf-ta { resize: vertical; min-height: 56px }
.mf-switches { display: flex; flex-wrap: wrap; gap: 8px 22px }
.mf-rows { display: flex; flex-direction: column; gap: 8px; align-items: flex-start }
.mf-row { display: flex; gap: 8px; align-items: center; width: 100% }
.mf-opt .ui-input { flex: 1; min-width: 0 }
.mf-rulesel { flex: 0 0 200px } .mf-num { width: 84px; flex: none } .mf-dash { color: var(--ink3) } .mf-date { width: 160px; flex: none }
.mf-rule > .ui-input:not(.mf-num):not(.mf-date) { flex: 1; min-width: 0 }
.mf-list { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; align-items: center } .mf-listitem { display: inline-flex; gap: 2px } .mf-listitem .ui-input { width: 120px }
.mf-shownsel { flex: 1 1 0; min-width: 0 } .mf-shownis { flex: 0 0 150px } .mf-shownval { flex: 1 1 0; min-width: 0 }
.mf-seg { display: inline-flex; height: 36px; align-items: center }
.mf-kopt { display: flex; flex-direction: column; line-height: 1.25 } .mf-kopt b { font-weight: 600 } .mf-kopt small { font-size: 11.5px; color: var(--ink3) }
.mf-subs { display: flex; flex-direction: column; gap: 6px; width: 100%; align-items: flex-start }
.mf-sub { width: 100%; border: 1px solid var(--hair); border-radius: 10px; background: var(--card); overflow: hidden }
.mf-sub > .mf { padding: 0 12px 4px } .mf-subopen { border-color: var(--ink3) }
.mf-subhead { display: flex; align-items: center; gap: 8px; width: 100%; font: inherit; text-align: left; background: none; border: 0; padding: 8px 6px 8px 10px; cursor: pointer; color: var(--ink) }
.mf-subhead:hover { background: var(--wash) }
.mf-subchev { display: inline-block; color: var(--ink3); transition: transform .15s; width: 10px } .mf-subopen .mf-subchev { transform: rotate(90deg) }
.mf-subname { font-weight: 600; font-size: 13.5px; flex: 1 } .mf-subkind { font-family: var(--m); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3) }
.mf-subx { width: 24px; height: 24px; font-size: 14px }
.mf-acts { display: flex; padding-top: 12px; border-top: 1px solid var(--hair) }
/* PrimeVue's select at the admin inputs' size, so a row of controls sits on one line */
.mf :deep(.p-select) { height: 34px; border-radius: 8px; font-size: 13.5px; align-items: center; border-color: var(--hair); background: var(--card) }
.mf :deep(.p-select .p-select-label) { padding: 0 10px; font-size: 13.5px; line-height: 32px }
.mf :deep(.p-select .p-select-dropdown) { width: 30px }
</style>

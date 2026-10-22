<script setup>
/*
 * One field of a form, as controls: its kind from a list, its question, its description, whether it
 * is required, and then the controls that kind has — a placeholder, choices as rows, a scale's ends,
 * a rating's count, a file's limit — and the condition it is shown under, as rows. Every change marks
 * the block dirty, and the writer composes it afresh through forms.md's Composer; nothing here is the
 * grammar. The field's name is what its answer is filed under: set from the question the first time,
 * editable as an identifier after.
 */
import pipe from '../../lib/admin/api.js'
import { computed } from 'vue'
import ConditionEditor from './ConditionEditor.vue'
import { KINDS } from 'platformkit/lib/forms/parse.js'
import { placeholdersAndCallingCodes } from 'platformkit/vendor/formsmd/phone-numbers.js'
import { us } from 'platformkit/lib/strings.js'
import { useMediaPick } from '../../lib/admin/media-pick.js'
const props = defineProps({ block: { type: Object, required: true }, fields: { type: Array, default: () => [] } })
const emit = defineEmits(['remove', 'move'])
const A = us('forms').admin || {}
const W = A.field || {}, K = A.kinds || {}
const p = computed(() => props.block.params)
const kind = computed(() => props.block.kind)
const touch = () => { props.block.dirty = true; props.block.set = undefined }
/* a flag param is present (true) or absent */
const flag = (k) => p.value[k] !== undefined
const setFlag = (k, on) => { if (on) p.value[k] = true; else delete p.value[k]; touch() }
const setP = (k, v) => { if (v === '' || v == null) delete p.value[k]; else p.value[k] = v; touch() }
function setKind(k) {
  props.block.kind = k
  const keep = { question: p.value.question, description: p.value.description, labelstyle: p.value.labelstyle, fieldsize: p.value.fieldsize, placeholder: p.value.placeholder }
  for (const key of Object.keys(p.value)) delete p.value[key]
  for (const [key, v] of Object.entries(keep)) if (v !== undefined) p.value[key] = v
  if (k === 'choice' || k === 'picture') p.value.choices = []
  if (k === 'select') p.value.options = []
  if (k === 'picture') p.value.choices = []
  touch()
}
const slugName = (q) => String(q || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f$1').slice(0, 40) || 'field'
/* a new field is named from its question until the name is set by hand; a field read from the file keeps its name (the answers are filed under it) */
function setQuestion(v) { p.value.question = v; if (props.block.autoname) props.block.name = uniqueName(slugName(v)); touch() }
function uniqueName(base) { let n = base, i = 2; while (props.fields.some((f) => f !== props.block && f.name === n)) n = base + i++; return n }
function setName(v) { props.block.name = String(v).replace(/[^a-zA-Z0-9_$]/g, '_') || 'field'; props.block.autoname = false; touch() }
/* choices and options as rows: a label, and a value when it differs */
const rowsKey = computed(() => (kind.value === 'select' ? 'options' : 'choices'))
const rows = computed(() => p.value[rowsKey.value] || [])
function setRow(i, k, v) { const list = rows.value.map((r) => ({ ...r })); list[i][k] = v; if (k === 'label' && (list[i].value === undefined || list[i].value === '' || list[i].auto)) { list[i].value = v; list[i].auto = true } if (k === 'value') list[i].auto = false; p.value[rowsKey.value] = list; touch() }
function addRow() { p.value[rowsKey.value] = [...rows.value, kind.value === 'picture' ? { label: '', value: '', image: '', auto: true } : { label: '', value: '', auto: true }]; touch() }
function removeRow(i) { const list = rows.value.slice(); list.splice(i, 1); p.value[rowsKey.value] = list; touch() }
const countries = Object.keys(placeholdersAndCallingCodes)
const countryList = computed(() => (Array.isArray(p.value.availablecountries) ? p.value.availablecountries : String(p.value.availablecountries || '').split(',')).map((c) => c.trim().toUpperCase()).filter(Boolean))
function toggleCountry(c) { const list = countryList.value.includes(c) ? countryList.value.filter((x) => x !== c) : [...countryList.value, c]; if (list.length) p.value.availablecountries = list; else delete p.value.availablecountries; touch() }
const checked = computed(() => (Array.isArray(p.value.checked) ? p.value.checked : p.value.checked ? [p.value.checked] : []))
function setChecked(v) { if (flag('multiple')) { const list = checked.value.includes(v) ? checked.value.filter((x) => x !== v) : [...checked.value, v]; if (list.length) p.value.checked = list; else delete p.value.checked } else { if (checked.value[0] === v) delete p.value.checked; else p.value.checked = [v] } touch() }
async function upload(i, file) {
  if (!file) return
  try { const j = await pipe.uploadImage(file); if (j.path) setRow(i, 'image', j.path) } catch { /* the row keeps its picture */ }
}
/* or a picture chosen from the library */
const MF = us('media').page.field
const { choose } = useMediaPick()
async function fromLibrary(i) { const url = await choose('image'); if (url) setRow(i, 'image', url) }
const others = computed(() => props.fields.filter((f) => f !== props.block && f.name !== props.block.name))
const isText = computed(() => ['text', 'email', 'url', 'tel', 'password'].includes(kind.value))
const isDate = computed(() => ['date', 'time', 'datetime'].includes(kind.value))
</script>

<template>
  <div class="fi">
    <div class="ui-row">
      <label class="ui-field"><span>{{ W.kind }}</span><select class="ui-select" :value="kind" @change="setKind($event.target.value)"><option v-for="k in KINDS" :key="k" :value="k">{{ K[k] || k }}</option></select></label>
      <label class="ui-switch fi-req"><input type="checkbox" :checked="block.required" @change="block.required = $event.target.checked; touch()" /><i /><span>{{ W.required }}</span></label>
    </div>
    <div class="ui-row fi-qrow">
      <label class="ui-field"><span>{{ W.question }}</span><input class="ui-input" :value="p.question === '...' ? '' : p.question" @input="setQuestion($event.target.value)" /></label>
      <label v-if="others.length" class="ui-field fi-bind"><span>{{ W.bind }}</span><select class="ui-select" value="" @change="(e) => { if (e.target.value) { setQuestion((p.question === '...' ? '' : p.question || '').replace(/\s+$/, '') + ' {$ ' + e.target.value + ' $}'); e.target.value = '' } }"><option value="">—</option><option v-for="f in others" :key="f.name" :value="f.name">{{ f.params && f.params.question && f.params.question !== '...' ? f.params.question : f.name }}</option></select></label>
    </div>
    <label class="ui-field"><span>{{ W.description }}</span><input class="ui-input" :value="p.description || ''" @input="setP('description', $event.target.value)" /></label>
    <label class="ui-field"><span>{{ W.name }} <small>· {{ W['name-hint'] }}</small></span><input class="ui-input ui-mono" :value="block.name" @change="setName($event.target.value)" /></label>

    <!-- text-alikes -->
    <template v-if="isText || kind === 'number'">
      <div class="ui-row">
        <label class="ui-field"><span>{{ W.placeholder }}</span><input class="ui-input" :value="p.placeholder || ''" @input="setP('placeholder', $event.target.value)" /></label>
        <label class="ui-field"><span>{{ W.value }}</span><input class="ui-input" :value="p.value || ''" @input="setP('value', $event.target.value)" /></label>
      </div>
    </template>
    <template v-if="isText">
      <div class="ui-row">
        <label v-if="kind === 'text'" class="ui-switch"><input type="checkbox" :checked="flag('multiline')" @change="setFlag('multiline', $event.target.checked)" /><i /><span>{{ W.multiline }}</span></label>
        <label class="ui-field fi-num"><span>{{ W.maxlength }}</span><input class="ui-input" type="number" min="1" :value="p.maxlength || ''" @input="setP('maxlength', $event.target.value)" /></label>
        <label v-if="kind !== 'tel'" class="ui-field"><span>{{ W.pattern }}</span><input class="ui-input ui-mono" :value="p.pattern || ''" @input="setP('pattern', $event.target.value)" /></label>
      </div>
      <template v-if="kind === 'tel'">
        <label class="ui-field"><span>{{ W.country }}</span><select class="ui-select" :value="p.country || 'US'" @change="setP('country', $event.target.value)"><option v-for="c in countries" :key="c" :value="c">{{ c }} {{ placeholdersAndCallingCodes[c].callingCode }}</option></select></label>
        <div class="ui-field"><span>{{ W.countries }}</span>
          <div class="fi-chips"><button v-for="c in countries" :key="c" type="button" class="fi-chip" :class="{ on: countryList.includes(c) }" @click="toggleCountry(c)">{{ c }}</button></div>
        </div>
      </template>
    </template>
    <template v-if="kind === 'number'">
      <div class="ui-row">
        <label class="ui-field fi-num"><span>{{ W.min }}</span><input class="ui-input" type="number" :value="p.min ?? ''" @input="setP('min', $event.target.value)" /></label>
        <label class="ui-field fi-num"><span>{{ W.max }}</span><input class="ui-input" type="number" :value="p.max ?? ''" @input="setP('max', $event.target.value)" /></label>
        <label class="ui-field fi-num"><span>{{ W.step }}</span><input class="ui-input" type="number" :value="p.step ?? ''" @input="setP('step', $event.target.value)" /></label>
        <label class="ui-field"><span>{{ W.unit }}</span><input class="ui-input" :value="p.unit || ''" @input="setP('unit', $event.target.value)" /></label>
        <label class="ui-field"><span>{{ W.unitend }}</span><input class="ui-input" :value="p.unitend || ''" @input="setP('unitend', $event.target.value)" /></label>
      </div>
    </template>

    <!-- select, choice, picture -->
    <template v-if="kind === 'select' || kind === 'choice' || kind === 'picture'">
      <div class="ui-field"><span>{{ kind === 'select' ? W.options : W.choices }}</span>
        <div class="fi-rows">
          <div v-for="(r, i) in rows" :key="i" class="fi-rowline" :class="{ 'fi-pic': kind === 'picture' }">
            <input class="ui-input" :value="r.label" :placeholder="W['option-label']" @input="setRow(i, 'label', $event.target.value)" />
            <input class="ui-input ui-mono fi-val" :value="r.value === r.label ? '' : r.value" :placeholder="W['option-value']" @input="setRow(i, 'value', $event.target.value || r.label)" />
            <template v-if="kind === 'picture'">
              <input class="ui-input fi-img" :value="r.image || ''" :placeholder="W.image" @input="setRow(i, 'image', $event.target.value)" />
              <label class="ui-btn ui-ghost ui-sm fi-up">{{ W.upload }}<input type="file" accept="image/*" class="fi-file" @change="upload(i, $event.target.files[0])" /></label>
              <button type="button" class="ui-btn ui-ghost ui-sm" :title="MF.choose" @click="fromLibrary(i)">{{ MF.choose }}</button>
              <img v-if="r.image" :src="r.image" alt="" class="fi-thumb" />
            </template>
            <button v-if="kind !== 'select'" type="button" class="fi-right" :class="{ on: checked.includes(r.value) }" :title="W.checked" @click="setChecked(r.value)">✓</button>
            <button type="button" class="ui-iconbtn" title="Remove" @click="removeRow(i)">×</button>
          </div>
          <button type="button" class="ui-btn ui-ghost ui-sm" @click="addRow">{{ kind === 'select' ? W['add-option'] : W['add-choice'] }}</button>
        </div>
      </div>
      <div v-if="kind === 'select'" class="ui-row">
        <label class="ui-field"><span>{{ W.placeholder }}</span><input class="ui-input" :value="p.placeholder || ''" @input="setP('placeholder', $event.target.value)" /></label>
        <label class="ui-field"><span>{{ W.selected }}</span><select class="ui-select" :value="p.selected || ''" @change="setP('selected', $event.target.value)"><option value="">—</option><option v-for="r in rows" :key="r.value" :value="r.value">{{ r.label }}</option></select></label>
      </div>
      <div v-else class="ui-row ui-wrap">
        <label class="ui-switch"><input type="checkbox" :checked="flag('multiple')" @change="setFlag('multiple', $event.target.checked)" /><i /><span>{{ W.multiple }}</span></label>
        <label class="ui-switch"><input type="checkbox" :checked="flag('horizontal')" @change="setFlag('horizontal', $event.target.checked)" /><i /><span>{{ W.horizontal }}</span></label>
        <label class="ui-switch"><input type="checkbox" :checked="flag('supersize')" @change="setFlag('supersize', $event.target.checked)" /><i /><span>{{ W.supersize }}</span></label>
        <label v-if="kind === 'picture'" class="ui-switch"><input type="checkbox" :checked="flag('hidelabels')" @change="setFlag('hidelabels', $event.target.checked)" /><i /><span>{{ W.hidelabels }}</span></label>
        <label v-if="flag('multiple')" class="ui-switch"><input type="checkbox" :checked="flag('hideformtext')" @change="setFlag('hideformtext', $event.target.checked)" /><i /><span>{{ W.hideformtext }}</span></label>
      </div>
    </template>

    <!-- rating, scale -->
    <div v-if="kind === 'rating'" class="ui-row">
      <label class="ui-field fi-num"><span>{{ W.outof }}</span><input class="ui-input" type="number" min="1" max="10" :value="p.outof || 5" @input="setP('outof', Number($event.target.value) || 5)" /></label>
      <label class="ui-field"><span>{{ W.icon }}</span><select class="ui-select" :value="p.icon || 'star'" @change="setP('icon', $event.target.value === 'star' ? '' : $event.target.value)"><option value="star">{{ W['icon-star'] }}</option><option value="heart">{{ W['icon-heart'] }}</option></select></label>
      <label class="ui-switch"><input type="checkbox" :checked="flag('hidelabels')" @change="setFlag('hidelabels', $event.target.checked)" /><i /><span>{{ W.hidelabels }}</span></label>
    </div>
    <div v-if="kind === 'scale'" class="ui-row ui-wrap">
      <label class="ui-field fi-num"><span>{{ W.startat }}</span><select class="ui-select" :value="String(p.startat ?? 0)" @change="setP('startat', Number($event.target.value))"><option value="0">0</option><option value="1">1</option></select></label>
      <label class="ui-field fi-num"><span>{{ W.outof }}</span><input class="ui-input" type="number" min="5" max="10" :value="p.outof || 10" @input="setP('outof', Number($event.target.value) || 10)" /></label>
      <label class="ui-field"><span>{{ W.labelstart }}</span><input class="ui-input" :value="p.labelstart ?? ''" @input="setP('labelstart', $event.target.value)" /></label>
      <label class="ui-field"><span>{{ W.labelend }}</span><input class="ui-input" :value="p.labelend ?? ''" @input="setP('labelend', $event.target.value)" /></label>
    </div>

    <!-- dates, files -->
    <div v-if="isDate" class="ui-row">
      <label class="ui-field"><span>{{ W.min }}</span><input class="ui-input" :type="kind === 'datetime' ? 'datetime-local' : kind" :value="p.min || ''" @input="setP('min', $event.target.value)" /></label>
      <label class="ui-field"><span>{{ W.max }}</span><input class="ui-input" :type="kind === 'datetime' ? 'datetime-local' : kind" :value="p.max || ''" @input="setP('max', $event.target.value)" /></label>
    </div>
    <!-- a recording: how long it may run, and how big it may get. An unbounded one is a file
         nobody meant to upload. -->
    <div v-if="kind === 'voice' || kind === 'video'" class="ui-row">
      <label class="ui-field fi-num"><span>{{ W['record-length'] }}</span><input class="ui-input" type="number" min="5" :value="p.maxlength || 60" @input="setP('maxlength', Number($event.target.value) || 60)" /></label>
      <label class="ui-field fi-num"><span>{{ W.sizelimit }}</span><input class="ui-input" type="number" min="1" :value="p.sizelimit || 25" @input="setP('sizelimit', Number($event.target.value) || 25)" /></label>
    </div>
    <div v-if="kind === 'file'" class="ui-row">
      <label class="ui-field fi-num"><span>{{ W.sizelimit }}</span><input class="ui-input" type="number" min="1" :value="p.sizelimit || 10" @input="setP('sizelimit', Number($event.target.value) || 10)" /></label>
      <label class="ui-switch"><input type="checkbox" :checked="flag('imageonly')" @change="setFlag('imageonly', $event.target.checked)" /><i /><span>{{ W.imageonly }}</span></label>
    </div>

    <div class="ui-row ui-wrap">
      <label class="ui-switch"><input type="checkbox" :checked="p.labelstyle === 'classic'" @change="setP('labelstyle', $event.target.checked ? 'classic' : '')" /><i /><span>{{ W['label-classic'] }}</span></label>
      <label class="ui-switch"><input type="checkbox" :checked="p.fieldsize === 'sm'" @change="setP('fieldsize', $event.target.checked ? 'sm' : '')" /><i /><span>{{ W['size-small'] }}</span></label>
    </div>
    <ConditionEditor :model-value="block.condition || ''" :fields="others" :label="W.condition" @update:model-value="(v) => { block.condition = v; block.deps = []; touch() }" />
    <div class="ui-cardrow fi-acts">
      <button type="button" class="ui-btn ui-ghost ui-sm" @click="emit('move', -1)">← {{ W['move-up'] }}</button>
      <button type="button" class="ui-btn ui-ghost ui-sm" @click="emit('move', 1)">{{ W['move-down'] }} →</button>
      <span class="ui-grow" />
      <button type="button" class="ui-btn ui-ghost ui-danger ui-sm" @click="emit('remove')">{{ W.remove }}</button>
    </div>
  </div>
</template>

<style scoped>
.fi { display: flex; flex-direction: column; gap: 12px }
.fi-req { align-self: flex-end; margin-bottom: 6px }
.fi-num { max-width: 120px }
.fi-qrow { align-items: flex-end } .fi-bind { max-width: 220px }
.fi-rows { display: flex; flex-direction: column; gap: 6px }
.fi-rowline { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto auto; gap: 6px; align-items: center }
.fi-rowline.fi-pic { grid-template-columns: minmax(0, 1.2fr) minmax(0, .8fr) minmax(0, 1.2fr) auto auto auto auto }
.fi-val { font-size: 12px }
.fi-up { position: relative; overflow: hidden; cursor: pointer } .fi-file { position: absolute; inset: 0; opacity: 0; cursor: pointer }
.fi-thumb { width: 34px; height: 34px; object-fit: cover; border-radius: 6px; border: 1px solid var(--hair) }
.fi-right { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--hair); background: none; color: var(--ink3); cursor: pointer; font: inherit; font-size: 13px }
.fi-right.on { background: var(--ink); color: var(--paper); border-color: var(--ink) }
.fi-chips { display: flex; flex-wrap: wrap; gap: 4px; max-height: 120px; overflow-y: auto; padding: 4px; border: 1px solid var(--hair); border-radius: 8px }
.fi-chip { font: inherit; font-family: var(--m); font-size: 10.5px; padding: 3px 6px; border-radius: 6px; border: 1px solid var(--hair); background: none; color: var(--ink3); cursor: pointer }
.fi-chip.on { background: var(--ink); color: var(--paper); border-color: var(--ink) }
.fi-acts { padding-top: 10px; border-top: 1px solid var(--hair); gap: 6px }
</style>

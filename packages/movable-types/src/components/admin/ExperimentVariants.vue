<script setup>
/*
 * An experiment's variants, edited as a list: for each, its key (A, B, C …),
 * the page or ad it shows (chosen from the collection, never typed), and its
 * weight — with the share of visitors each weight works out to. "Add variant"
 * opens a blank row; "Duplicate" copies a variant's page or ad into a new
 * file and points the new row at it, which is how a B is made from an A.
 */
import { ref, computed, watch, onMounted } from 'vue'
import Select from 'primevue/select'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import { ROUTES, navigate } from '../../router.js'
import { listItems, nextKey, duplicateItem, colFor } from './experimentOps.js'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  kind: { type: String, default: 'page' },
  winner: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'valid'])

const rows = ref([])
let lastEmitted = ''
const clone = (v) => JSON.parse(JSON.stringify(v || []))
function hydrate(v) {
  const json = JSON.stringify(v || [])
  if (json === lastEmitted) return
  rows.value = clone(v).map((r) => ({ key: r.key || '', item: r.item || '', weight: typeof r.weight === 'number' ? r.weight : 1 }))
}
watch(() => props.modelValue, hydrate, { immediate: true, deep: true })
function emitAll() {
  const out = rows.value.map((r) => ({ key: String(r.key || '').trim(), item: r.item || '', weight: r.weight == null ? 1 : Number(r.weight) }))
  lastEmitted = JSON.stringify(out)
  emit('update:modelValue', out)
  emit('valid', problems.value.length === 0)
}

/* the pages or ads a variant can show */
const items = ref([])
const loadingItems = ref(false)
async function load() {
  loadingItems.value = true
  try { items.value = await listItems(props.kind) } catch (e) { items.value = [] }
  finally { loadingItems.value = false }
}
onMounted(load)
watch(() => props.kind, load)
const itemOf = (name) => items.value.find((i) => i.name === name) || null
const options = computed(() => items.value.map((i) => ({ value: i.name, label: i.title + (props.kind === 'page' ? '  ·  ' + i.route : '') })))

/* the share each weight works out to */
const total = computed(() => rows.value.reduce((n, r) => n + (r.weight > 0 ? r.weight : 0), 0))
const share = (r) => (total.value ? Math.round(((r.weight > 0 ? r.weight : 0) / total.value) * 100) : 0)

/* what is wrong, if anything — the same checks the server makes on save */
const problems = computed(() => {
  const out = [], keys = new Set(), routes = new Set()
  rows.value.forEach((r, i) => {
    const k = String(r.key || '').trim().toUpperCase()
    if (!k) out.push({ i, msg: 'needs a key' })
    else if (keys.has(k)) out.push({ i, msg: 'key "' + k + '" is used twice' })
    keys.add(k)
    if (!r.item) out.push({ i, msg: 'choose what it shows' })
    else { const it = itemOf(r.item); if (it && props.kind === 'page') routes.add(it.route) }
  })
  if (routes.size > 1) out.push({ i: -1, msg: 'these pages are on different routes (' + [...routes].join(', ') + ') — an experiment compares pages on one route' })
  if (rows.value.length === 1) out.push({ i: -1, msg: 'one variant is not a test yet — add a second' })
  return out
})
const rowProblem = (i) => (problems.value.find((p) => p.i === i) || {}).msg || ''
watch(problems, () => emit('valid', problems.value.length === 0), { immediate: true })

function add() { rows.value.push({ key: nextKey(rows.value), item: '', weight: 1 }); emitAll() }
function remove(i) { rows.value.splice(i, 1); emitAll() }
const busy = ref(-1)
async function duplicate(i) {
  const src = rows.value[i]
  if (!src.item || busy.value >= 0) return
  busy.value = i
  try {
    const key = nextKey(rows.value)
    const name = await duplicateItem(props.kind, src.item, key)
    await load()
    rows.value.push({ key, item: name, weight: src.weight == null ? 1 : src.weight })
    emitAll()
  } catch (e) { alert(e.message) }
  finally { busy.value = -1 }
}
const openItem = (name) => navigate(ROUTES.admin + '/' + colFor(props.kind) + '/' + name)
</script>

<template>
  <div class="xv">
    <div v-if="!rows.length" class="xv-empty">No variants yet. Add one and choose the {{ kind === 'ad' ? 'ad' : 'page' }} it shows, then duplicate it to make the alternative.</div>
    <div v-for="(r, i) in rows" :key="i" class="xv-row" :class="{ bad: rowProblem(i), win: winner && r.key === winner }">
      <div class="xv-key">
        <InputText v-model="r.key" class="xv-keyin" maxlength="3" @update:modelValue="emitAll" />
        <span v-if="winner && r.key === winner" class="xv-winner">winner</span>
      </div>
      <div class="xv-item">
        <Select v-model="r.item" :options="options" optionLabel="label" optionValue="value" filter :loading="loadingItems"
                :placeholder="'Choose a' + (kind === 'ad' ? 'n ad' : ' page')" fluid @update:modelValue="emitAll" />
        <button v-if="r.item" type="button" class="xv-open" :title="'Open this ' + (kind === 'ad' ? 'ad' : 'page')" @click="openItem(r.item)">open ↗</button>
      </div>
      <div class="xv-weight">
        <InputNumber v-model="r.weight" :min="0" :useGrouping="false" showButtons fluid @update:modelValue="emitAll" />
        <span class="xv-share">{{ share(r) }}%</span>
      </div>
      <div class="xv-acts">
        <button type="button" class="xv-btn" :disabled="!r.item || busy >= 0" title="Copy this one into a new file as the next variant" @click="duplicate(i)">{{ busy === i ? 'Copying…' : 'Duplicate' }}</button>
        <button type="button" class="xv-btn rm" title="Remove this variant" @click="remove(i)">×</button>
      </div>
      <em v-if="rowProblem(i)" class="xv-err">{{ rowProblem(i) }}</em>
    </div>
    <div class="xv-foot">
      <button type="button" class="xv-add" @click="add">+ Add variant</button>
      <span v-if="rows.length" class="xv-hint">{{ rows.length }} variant{{ rows.length === 1 ? '' : 's' }} · weights are relative: 1 and 1 is an even split</span>
    </div>
    <ul v-if="problems.some((p) => p.i < 0)" class="xv-problems">
      <li v-for="(p, n) in problems.filter((x) => x.i < 0)" :key="n">{{ p.msg }}</li>
    </ul>
  </div>
</template>

<style scoped>
.xv { display: flex; flex-direction: column; gap: 10px }
.xv-empty { font-size: 13.5px; color: var(--ink3); padding: 18px; border: 1px dashed var(--hair); border-radius: 12px; text-align: center }
.xv-row { display: grid; grid-template-columns: 96px minmax(0, 1fr) 150px auto; gap: 12px; align-items: center;
  padding: 12px 14px; border: 1px solid var(--hair); border-radius: 12px; background: var(--paper) }
.xv-row.bad { border-color: color-mix(in srgb, #dc2626 45%, var(--hair)) }
.xv-row.win { border-color: color-mix(in srgb, var(--accent) 55%, var(--hair)); background: color-mix(in srgb, var(--accent) 5%, var(--paper)) }
.xv-key { display: flex; align-items: center; gap: 8px }
.xv-keyin { width: 52px; text-align: center; font-family: var(--m); font-weight: 600; text-transform: uppercase }
.xv-winner { font-family: var(--m); font-size: 9.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent2) }
.xv-item { display: flex; align-items: center; gap: 10px; min-width: 0 }
.xv-open { flex: 0 0 auto; font: inherit; font-size: 12px; color: var(--accent2); background: none; border: 0; cursor: pointer; padding: 4px 2px; white-space: nowrap }
.xv-open:hover { text-decoration: underline }
.xv-weight { display: flex; align-items: center; gap: 10px }
.xv-share { font-family: var(--m); font-size: 12px; color: var(--ink3); min-width: 34px; text-align: right }
.xv-acts { display: flex; align-items: center; gap: 6px }
.xv-btn { font: inherit; font-size: 12.5px; color: var(--ink2); background: var(--wash); border: 1px solid var(--hair); border-radius: 8px; padding: 6px 10px; cursor: pointer }
.xv-btn:hover:not(:disabled) { color: var(--ink); border-color: var(--ink3) }
.xv-btn:disabled { opacity: .5; cursor: default }
.xv-btn.rm { width: 30px; padding: 6px 0; font-size: 15px; line-height: 1 }
.xv-btn.rm:hover { color: #dc2626; border-color: #dc262666 }
.xv-err { grid-column: 1 / -1; font-style: normal; font-size: 12px; color: #dc2626 }
.xv-foot { display: flex; align-items: center; gap: 14px }
.xv-add { font: inherit; font-size: 13px; font-weight: 600; color: var(--ink); background: var(--paper); border: 1px solid var(--ink); border-radius: 999px; padding: 7px 14px; cursor: pointer }
.xv-add:hover { background: var(--ink); color: var(--paper) }
.xv-hint { font-size: 12.5px; color: var(--ink3) }
.xv-problems { margin: 0; padding: 10px 14px 10px 30px; border-radius: 10px; background: color-mix(in srgb, #dc2626 8%, var(--paper)); color: #b91c1c; font-size: 13px }
</style>

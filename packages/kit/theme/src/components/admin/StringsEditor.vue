<script setup>
/*
 * The `## group / ### key / field: value` files — the UI strings (dir=ui) and
 * the results copy (dir=results) — a file picked from a dropdown, every string
 * an input, and a search box that narrows the page to the strings whose key,
 * field or text match, with a count beside each file in the dropdown so a
 * string in another file is found without opening it. Saves the active file; the frontmatter goes back as it
 * was written.
 */
import { ref, computed, shallowRef, watch, onMounted } from 'vue'
import Select from 'primevue/select'
const props = defineProps({ dir: { type: String, default: 'ui' } })
import pipe from '../../lib/admin/api.js'
/* the two families of files are two models: the UI strings (`strings`) and a site's results copy (`results`) */
const MODEL = { ui: 'strings', results: 'results' }
const files = shallowRef([])
const active = ref('')
const q = ref('')
const saving = ref(false)
const msg = ref('')
const err = ref('')
const current = computed(() => files.value.find((f) => f.file === active.value) || null)
const label = (f) => f.scope || f.title || f.file
async function load() {
  err.value = ''
  try {
    files.value = (await pipe.items(MODEL[props.dir] || props.dir)).map((f) => ({ ...f, name: f.name }))
    if (!active.value || !files.value.find((f) => f.file === active.value)) active.value = files.value[0]?.file || ''
  } catch (e) { err.value = e.message }
}
onMounted(load)
watch(() => props.dir, load)

/* the search: a key, a field name, a group name or the text itself */
const needle = computed(() => q.value.trim().toLowerCase())
const hit = (s) => String(s ?? '').toLowerCase().includes(needle.value)
function matches(file) {
  const out = {}
  for (const [g, keys] of Object.entries(file.groups || {})) {
    for (const [k, fields] of Object.entries(keys)) {
      if (!needle.value || hit(g) || hit(k) || Object.entries(fields).some(([fn, v]) => hit(fn) || hit(v))) (out[g] = out[g] || {})[k] = fields
    }
  }
  return out
}
const visible = computed(() => (current.value ? matches(current.value) : {}))
const visibleCount = (groups) => Object.values(groups).reduce((n, keys) => n + Object.keys(keys).length, 0)
const countFor = (f) => (needle.value ? visibleCount(matches(f)) : null)
/* the dropdown: each file, with how many of its strings match while searching */
const fileOptions = computed(() => files.value.map((f) => ({ value: f.file, label: label(f), count: countFor(f), total: visibleCount(f.groups || {}) })))
const total = computed(() => (current.value ? visibleCount(current.value.groups || {}) : 0))
/* only show the fields that matched when the text itself is what matched */
function fieldShown(g, k, fn, v) {
  if (!needle.value || hit(g) || hit(k)) return true
  return hit(fn) || hit(v)
}
async function save() {
  const f = current.value; if (!f) return
  saving.value = true; msg.value = ''; err.value = ''
  try { await pipe.save(MODEL[props.dir] || props.dir, f.name, { data: { scope: f.scope, title: f.title }, parsed: { fmRaw: f.fmRaw, spaced: f.spaced, groups: f.groups } }); msg.value = 'Saved.' }
  catch (e) { err.value = e.message }
  finally { saving.value = false; setTimeout(() => { msg.value = '' }, 2500) }
}
</script>

<template>
  <div class="se">
    <div class="se-bar">
      <label class="se-pick">
        <span>File</span>
        <Select v-model="active" :options="fileOptions" optionLabel="label" optionValue="value" class="se-select" :placeholder="'Choose a file'">
          <template #value="{ value }">
            <span v-if="value" class="se-opt"><b>{{ (fileOptions.find((o) => o.value === value) || {}).label }}</b><em v-if="needle" class="se-count">{{ (fileOptions.find((o) => o.value === value) || {}).count }}</em></span>
          </template>
          <template #option="{ option }">
            <span class="se-opt" :class="{ dim: needle && option.count === 0 }"><b>{{ option.label }}</b><em class="se-count">{{ needle ? option.count + ' of ' + option.total : option.total }}</em></span>
          </template>
        </Select>
      </label>
      <label class="se-search">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" /></svg>
        <input v-model="q" type="search" placeholder="Search keys and text…" />
        <button v-if="q" type="button" class="se-clear" aria-label="Clear search" @click="q = ''">×</button>
      </label>
    </div>
    <p v-if="err" class="se-err">{{ err }}</p>
    <div v-if="current" class="se-body">
      <p v-if="needle" class="se-hint">{{ visibleCount(visible) }} of {{ total }} strings in {{ label(current) }} match “{{ q }}”</p>
      <p v-if="needle && !visibleCount(visible)" class="se-none">Nothing here matches. The tabs show where it is.</p>
      <section v-for="(keys, gname) in visible" :key="gname" class="se-group">
        <h3>{{ gname }}</h3>
        <div v-for="(fields, kkey) in keys" :key="kkey" class="se-key">
          <div class="se-key-h"><code>{{ kkey }}</code><span v-if="fields.name" class="se-name">{{ fields.name }}</span></div>
          <template v-for="(val, fname) in fields" :key="fname">
            <label v-if="fname !== 'name' && fieldShown(gname, kkey, fname, val)" class="se-field">
              <span>{{ fname }}</span>
              <input v-model="fields[fname]" type="text" />
            </label>
          </template>
        </div>
      </section>
      <div class="se-save">
        <button type="button" class="ad-save" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save ' + label(current) }}</button>
        <span v-if="msg" class="se-msg">{{ msg }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.se { display: flex; flex-direction: column; min-height: 0; flex: 1 }
.se-bar { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin: 0 0 18px; flex-wrap: wrap }
.se-pick { display: flex; align-items: center; gap: 10px }
.se-pick > span { font-family: var(--m); font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3) }
.se-select { min-width: 260px }
.se-opt { display: inline-flex; align-items: center; gap: 8px } .se-opt.dim { opacity: .45 }
.se-opt b { font-weight: 500 }
.se-count { font-family: var(--m); font-style: normal; font-size: 10.5px; color: var(--ink3); background: color-mix(in srgb, currentColor 12%, transparent); border-radius: 999px; padding: 1px 7px }
.se-search { display: flex; align-items: center; gap: 8px; min-width: 280px; color: var(--ink3); background: var(--card); border: 1px solid var(--hair); border-radius: 999px; padding: 6px 12px }
.se-search:focus-within { border-color: var(--accent2); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent2) 25%, transparent) }
.se-search input { flex: 1; font: inherit; font-size: 13.5px; color: var(--ink); background: none; border: 0; outline: none; min-width: 0 }
.se-search input::-webkit-search-cancel-button { display: none }
.se-clear { font: inherit; font-size: 15px; line-height: 1; color: var(--ink3); background: none; border: 0; cursor: pointer; padding: 0 2px }
.se-err { margin: 0 0 12px; font-size: 13px; color: #b91c1c }
.se-body { flex: 1; min-height: 0; overflow-y: auto }
.se-hint { margin: 0 0 14px; font-size: 12.5px; color: var(--ink3) }
.se-none { margin: 20px 0; font-size: 14px; color: var(--ink2) }
.se-group { margin: 0 0 26px }
.se-group h3 { font-family: var(--fd); font-weight: 600; font-size: 18px; margin: 0 0 10px; border-bottom: 1px solid var(--hair); padding-bottom: 6px }
.se-key { margin: 0 0 14px; padding-left: 12px; border-left: 2px solid var(--hair) }
.se-key-h { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px }
.se-key-h code { font-family: var(--m); font-size: 12px; color: var(--ink2) }
.se-name { font-size: 12.5px; color: var(--ink3) }
.se-field { display: grid; grid-template-columns: 150px 1fr; gap: 10px; align-items: center; margin: 0 0 6px }
.se-field > span { font-family: var(--m); font-size: 11px; color: var(--ink3); word-break: break-all }
.se-field input { font: inherit; font-size: 13.5px; color: var(--ink); background: var(--card); border: 1px solid var(--hair); border-radius: 8px; padding: 7px 10px }
.se-field input:focus { outline: 2px solid var(--accent2); border-color: transparent }
.se-save { position: sticky; bottom: 0; display: flex; align-items: center; gap: 12px; padding: 14px 0; background: linear-gradient(transparent, var(--paper) 30%) }
.se-msg { font-size: 13px; color: var(--ink3) }
.ad-save { font: inherit; font-weight: 600; font-size: 13.5px; color: var(--paper); background: var(--ink); border: 0; border-radius: 999px; padding: 9px 18px; cursor: pointer }
.ad-save:disabled { opacity: .6 }
</style>

<script setup lang="ts">
/*
 * The `## group / ### key / field: value` files: the UI strings (dir=ui) and the results copy (dir=results), a file
 * picked from a dropdown, every string an input, and a search box that narrows the page to the strings whose key,
 * field or text match, with a count beside each file in the dropdown so a string in another file is found without
 * opening it. Saves the active file; the frontmatter goes back as it was written.
 *
 * THE UI STRINGS ARE SHOWN WHOLE AND SAVED AS DIFFERENCES (openspec: site-strings-hold-only-their-changes). A site's
 * file holds only the words it changes or adds; the theme's default is the rest. So every scope the theme has is
 * listed, every default field is an input with the default as its placeholder, and a save writes only the fields
 * whose text differs from the default. Clearing a field, or Reset, puts it back to the default and takes it out of
 * the site's file. The results copy has no defaults and is edited as it is written.
 */
import { ref, computed, shallowRef, watch, onMounted } from 'vue'
import Select from 'primevue/select'
import { groups as THEME } from '#site/strings-default'
const props = defineProps({ dir: { type: String, default: 'ui' } })
import pipe from '../../lib/admin/api.js'
/* the two families of files are two models: the UI strings (`strings`) and a site's results copy (`results`) */
const MODEL: any = { ui: 'strings', results: 'results' }
const files = shallowRef<any>([])
const active = ref('')
const q = ref('')
const saving = ref(false)
const msg = ref('')
const err = ref('')
const rev = ref(0)
const current = computed(() => files.value.find((f: { file: string }) => f.file === active.value) || null)
const label = (f: { scope: any; title: any; file: any }) => f.scope || f.title || f.file
const hasDefaults = computed(() => props.dir === 'ui')
const defaultsOf = (f: any) => (hasDefaults.value && f && (THEME as any) && (THEME as any)[f.scope]) || {}
const clone = (x: any) => JSON.parse(JSON.stringify(x || {}))
async function load() {
  err.value = ''
  try {
    const got = (await pipe.items(MODEL[props.dir] || props.dir)).map((f: any) => ({ ...f, name: f.name, groups: clone(f.groups) }))
    /* a scope the theme has and the site has never changed is still editable: saving it creates the site's file */
    if (hasDefaults.value) {
      const have = new Set(got.map((f: any) => f.scope))
      for (const scope of Object.keys((THEME as any) || {}).sort()) if (!have.has(scope)) got.push({ file: scope + '.md', name: scope, scope, title: '', fmRaw: 'scope: ' + scope, spaced: false, groups: {}, fresh: true })
      got.sort((a: any, b: any) => String(label(a)).localeCompare(String(label(b))))
    }
    files.value = got
    /* the file open last in this tab, so a reload (a dev server's, after a save adds a file) keeps the place */
    if (!active.value) { try { active.value = sessionStorage.getItem(KEPT()) || '' } catch { /* storage refused: start at the first */ } }
    if (!active.value || !files.value.find((f: { file: string }) => f.file === active.value)) active.value = files.value[0]?.file || ''
  } catch (e) { err.value = (e as any).message }
}
const KEPT = () => 'pk-strings-file-' + props.dir
watch(active, (v) => { try { if (v) sessionStorage.setItem(KEPT(), v) } catch { /* storage refused: nothing to keep */ } })
onMounted(load)
watch(() => props.dir, load)

/* what the page shows: the theme's groups with the site's over them, each field { value, def } */
function shown(f: any) {
  void rev.value
  const d = defaultsOf(f), s = f.groups || {}
  const out: any = {}
  for (const g of new Set([...Object.keys(d), ...Object.keys(s)])) {
    for (const k of new Set([...Object.keys(d[g] || {}), ...Object.keys(s[g] || {})])) {
      const dk = (d[g] || {})[k] || {}, sk = (s[g] || {})[k] || {}
      const fields: any = {}
      for (const fn of new Set([...Object.keys(dk), ...Object.keys(sk)])) {
        if (fn === 'name') continue
        fields[fn] = { value: sk[fn] ?? '', def: dk[fn] ?? '' }
      }
      ;(out[g] = out[g] || {})[k] = { name: sk.name ?? dk.name ?? '', fields }
    }
  }
  return out
}
const valueOf = (g: string, k: string, fn: string) => (((current.value?.groups || {})[g] || {})[k] || {})[fn] ?? ''
function setValue(g: string, k: string, fn: string, v: string) {
  const f = current.value; if (!f) return
  const gs = f.groups
  if (v === '' && hasDefaults.value) { if (gs[g] && gs[g][k]) delete gs[g][k][fn] }
  else { ((gs[g] = gs[g] || {})[k] = gs[g][k] || {})[fn] = v }
  rev.value++
}
const changed = (field: any) => hasDefaults.value && field.value !== '' && field.value !== field.def

/* the search: a key, a field name, a group name or the text itself (the default's text included) */
const needle = computed(() => q.value.trim().toLowerCase())
const hit = (s: unknown) => String(s ?? '').toLowerCase().includes(needle.value)
const fieldHit = (fn: string, x: any) => hit(fn) || hit(x.value) || hit(x.def)
function matches(f: any) {
  const all = shown(f), out: any = {}
  for (const [g, keys] of Object.entries<any>(all)) for (const [k, key] of Object.entries<any>(keys)) {
    if (!needle.value || hit(g) || hit(k) || Object.entries<any>(key.fields).some(([fn, x]) => fieldHit(fn, x))) (out[g] = out[g] || {})[k] = key
  }
  return out
}
const visible = computed(() => (current.value ? matches(current.value) : {}))
const visibleCount = (groups: any) => Object.values<any>(groups).reduce((n: number, keys) => n + Object.keys(keys).length, 0)
const countFor = (f: any) => (needle.value ? visibleCount(matches(f)) : null)
const changedCount = (f: any) => { let n = 0; for (const keys of Object.values<any>(shown(f))) for (const key of Object.values<any>(keys)) for (const x of Object.values<any>(key.fields)) if (changed(x)) n++; return n }
/* the dropdown: each file, with how many of its strings match while searching, and how many the site has changed */
const fileOptions = computed(() => { void rev.value; return files.value.map((f: any) => ({ value: f.file, label: label(f), count: countFor(f), total: visibleCount(shown(f)), changed: hasDefaults.value ? changedCount(f) : null })) })
const total = computed(() => (current.value ? visibleCount(shown(current.value)) : 0))
function fieldShown(g: any, k: any, fn: any, x: any) {
  if (!needle.value || hit(g) || hit(k)) return true
  return fieldHit(fn, x)
}
/* only the differences go to the file: a field equal to its default, or empty, is left out, and so is a key or a
   group left with nothing (a key's name is kept only where it differs from the theme's) */
function differences(f: any) {
  if (!hasDefaults.value) return f.groups
  const d = defaultsOf(f), out: any = {}
  for (const [g, keys] of Object.entries<any>(f.groups || {})) for (const [k, fields] of Object.entries<any>(keys)) {
    const dk = (d[g] || {})[k] || {}
    const keep: any = {}
    for (const [fn, v] of Object.entries<any>(fields)) if (v !== '' && v !== dk[fn]) keep[fn] = v
    const named = Object.keys(keep).filter((x) => x !== 'name')
    if (!named.length && !(keep.name && !dk.name && !Object.keys(dk).length)) continue
    ;(out[g] = out[g] || {})[k] = keep
  }
  return out
}
async function save() {
  const f = current.value; if (!f) return
  saving.value = true; msg.value = ''; err.value = ''
  try {
    const groups = differences(f)
    await pipe.save(MODEL[props.dir] || props.dir, f.name, { data: { scope: f.scope, title: f.title }, parsed: { fmRaw: f.fmRaw, spaced: f.spaced, groups } })
    f.groups = clone(groups); f.fresh = false; rev.value++
    msg.value = 'Saved.'
  }
  catch (e) { err.value = (e as any).message }
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
            <span v-if="value" class="se-opt"><b>{{ (fileOptions.find((o: any) => o.value === value) || {}).label }}</b><em v-if="needle" class="se-count">{{ (fileOptions.find((o: any) => o.value === value) || {}).count }}</em></span>
          </template>
          <template #option="{ option }">
            <span class="se-opt" :class="{ dim: needle && option.count === 0 }"><b>{{ option.label }}</b><em class="se-count">{{ needle ? option.count + ' of ' + option.total : option.total }}</em><em v-if="option.changed" class="se-count se-count-ch">{{ option.changed }} changed</em></span>
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
      <p v-if="hasDefaults" class="se-hint">An empty field shows the default. Type to change it; only what you change is saved to the site.</p>
      <p v-if="needle" class="se-hint">{{ visibleCount(visible) }} of {{ total }} strings in {{ label(current) }} match “{{ q }}”</p>
      <p v-if="needle && !visibleCount(visible)" class="se-none">Nothing here matches. The counts in the file menu show where it is.</p>
      <section v-for="(keys, gname) in visible" :key="gname" class="se-group">
        <h3>{{ gname }}</h3>
        <div v-for="(key, kkey) in keys" :key="kkey" class="se-key">
          <div class="se-key-h"><code>{{ kkey }}</code><span v-if="key.name" class="se-name">{{ key.name }}</span></div>
          <template v-for="(x, fname) in key.fields" :key="fname">
            <label v-if="fieldShown(gname, kkey, fname, x)" class="se-field" :class="{ changed: changed(x) }">
              <span>{{ fname }}</span>
              <input :value="valueOf(String(gname), String(kkey), String(fname))" type="text" :placeholder="x.def" @input="setValue(String(gname), String(kkey), String(fname), ($event.target as HTMLInputElement).value)" />
              <button v-if="changed(x) && x.def" type="button" class="se-reset" :title="'Default: ' + x.def" @click.prevent="setValue(String(gname), String(kkey), String(fname), '')">Reset</button>
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
.se-field { display: grid; grid-template-columns: 150px minmax(0, 1fr) auto; gap: 10px; align-items: center; margin: 0 0 6px }
.se-field input { min-width: 0 }
@media (max-width: 560px) { .se-field { grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; margin-bottom: 10px } .se-field > span { grid-column: 1 / -1 } }
.se-field input::placeholder { color: color-mix(in srgb, var(--ink3) 62%, transparent) }
.se-field.changed > span { color: var(--ink); font-weight: 600 }
.se-field.changed input { border-color: var(--ink2) }
.se-reset { font: inherit; font-size: 12px; color: var(--ink2); background: none; border: 0; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; padding: 0 }
.se-count-ch { color: var(--ink) }
.se-field > span { font-family: var(--m); font-size: 11px; color: var(--ink3); word-break: break-all }
.se-field input { font: inherit; font-size: 13.5px; color: var(--ink); background: var(--card); border: 1px solid var(--hair); border-radius: 8px; padding: 7px 10px }
.se-field input:focus { outline: 2px solid var(--accent2); border-color: transparent }
.se-save { position: sticky; bottom: 0; display: flex; align-items: center; gap: 12px; padding: 14px 0; background: linear-gradient(transparent, var(--paper) 30%) }
.se-msg { font-size: 13px; color: var(--ink3) }
.ad-save { font: inherit; font-weight: 600; font-size: 13.5px; color: var(--paper); background: var(--ink); border: 0; border-radius: 999px; padding: 9px 18px; cursor: pointer }
.ad-save:disabled { opacity: .6 }
</style>

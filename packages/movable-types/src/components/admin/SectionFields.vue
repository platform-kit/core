<script setup>
/*
 * A section's fields, drawn from its zod schema (components/landing/schemas.js): one control per
 * field by its type — a line, a paragraph, a number, a switch, a choice (segmented when few, a select
 * when many), a picture (a url, or an upload beside it), a list of lines, a list of records (rows that
 * open, drag and duplicate), a nested record (an inset panel) — labelled by the schema's `.describe()`
 * and shaped by the section's fieldConfig ({ component, description, placeholder, half, item, summary }).
 * Recursive: a record inside a record is this component again. It holds no validation of its own —
 * the builder parses the whole section and hands the issues down by path.
 */
import { ref, computed } from 'vue'
import draggable from 'vuedraggable'
import pipe from '../../lib/admin/api.js'
import MarkdownEditor from './MarkdownEditor.vue'
import GlyphPicker from './GlyphPicker.vue'
import { forms as FORMS } from '#content'
const FORM_SLUGS = (FORMS || []).map((f) => ({ slug: f.slug, title: (f.model && f.model.title) || f.slug }))
import { GripVerticalIcon, ChevronDownIcon, CopyIcon, TrashIcon, PlusIcon, UploadIcon, FolderOpenIcon, XIcon } from 'lucide-vue-next'
import { us } from '@platform-kit/kit/lib/strings.js'
import { useMediaPick } from '../../lib/admin/media-pick.js'

const props = defineProps({
  shape: { type: null, required: true },        /* a zod object schema */
  config: { type: Object, default: () => ({}) },
  modelValue: { type: Object, default: () => ({}) },
  errors: { type: Object, default: () => ({}) }, /* dotted path → message */
  base: { type: String, default: '' },           /* this record's path, for the errors */
})
const emit = defineEmits(['update:modelValue'])

const unwrap = (z) => { while (z && z._def && 'innerType' in z._def) z = z._def.innerType; return z }
const beautify = (k) => String(k).replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
/* a field shown only while another says so: `when: (values) => boolean` in its config */
const shown = (f) => !f.cfg.when || f.cfg.when(props.modelValue || {})
/* the section's look — tone, glow, ground, spacing, width, reveal, anchor — folded away at the foot */
const lookOpen = ref(false)
const main = computed(() => fields.value.filter((f) => f.cfg.group !== 'look'))
const look = computed(() => fields.value.filter((f) => f.cfg.group === 'look'))
const fields = computed(() => {
  const s = unwrap(props.shape)
  const shape = (s && s.shape) || {}
  return Object.keys(shape).map((key) => {
    const z = shape[key], b = unwrap(z), cfg = (props.config || {})[key] || {}
    const t = b._def.typeName
    let kind = cfg.component || ({ ZodString: 'text', ZodNumber: 'number', ZodBoolean: 'boolean', ZodEnum: 'enum', ZodArray: 'list', ZodObject: 'group' })[t] || 'text'
    let of = null, values = null
    if (t === 'ZodEnum') values = b._def.values
    if (t === 'ZodArray') { of = unwrap(b._def.type); kind = of._def.typeName === 'ZodObject' ? 'rows' : 'lines' }
    const wide = !(cfg.half && ['text', 'number', 'enum', 'boolean', 'image', 'form', 'glyph'].includes(kind))
    /* a field the page leaves out shows its schema's default (the look's Paper, None, Normal), never a blank */
    const fallback = z._def.typeName === 'ZodDefault' ? z._def.defaultValue() : undefined
    return { key, kind, of, values, wide, fallback, required: !['ZodOptional', 'ZodDefault', 'ZodNullable'].includes(z._def.typeName), label: cfg.label || z.description || b.description || beautify(key), cfg, schema: b, min: b._def.minValue, max: b._def.maxValue }
  })
})
const val = (key) => (props.modelValue || {})[key]
const cur = (f) => { const v = val(f.key); return v === undefined || v === null || v === '' ? f.fallback : v }
/* the look's own shape and config, cut from the section's for the nested renderer */
const lookShape = computed(() => { const s = unwrap(props.shape); const shape = {}; for (const f of look.value) shape[f.key] = s.shape[f.key]; return { _def: { typeName: 'ZodObject' }, shape } })
const lookCfg = computed(() => Object.fromEntries(look.value.map((f) => [f.key, { ...f.cfg, group: undefined }])))
function set(key, v) { emit('update:modelValue', { ...(props.modelValue || {}), [key]: v }) }
const at = (key) => (props.base ? props.base + '.' + key : key)
const err = (key) => props.errors[at(key)] || ''
const clone = (v) => JSON.parse(JSON.stringify(v == null ? null : v))

/* a record's blank, from its shape */
function blank(z) {
  const s = unwrap(z); if (!s || !s.shape) return {}
  const o = {}
  for (const k of Object.keys(s.shape)) { const b = unwrap(s.shape[k]), t = b._def.typeName; o[k] = t === 'ZodNumber' ? 0 : t === 'ZodBoolean' ? false : t === 'ZodArray' ? [] : t === 'ZodObject' ? blank(b) : t === 'ZodEnum' ? b._def.values[0] : '' }
  return o
}
/* lists: lines and rows */
const listOf = (key) => (Array.isArray(val(key)) ? val(key) : [])
function addLine(key) { set(key, listOf(key).concat('')) }
function setLine(key, i, v) { const a = listOf(key).slice(); a[i] = v; set(key, a) }
function removeAt(key, i) { const a = listOf(key).slice(); a.splice(i, 1); set(key, a) }
function move(key, e) { if (e.oldIndex === e.newIndex) return; const a = listOf(key).slice(); const [m] = a.splice(e.oldIndex, 1); a.splice(e.newIndex, 0, m); set(key, a) }
const open = ref({})   /* which rows are open, by "key.i" */
function addRow(f) { const a = listOf(f.key); set(f.key, a.concat([blank(f.of)])); open.value[f.key + '.' + a.length] = true }
function dupRow(f, i) { const a = listOf(f.key).slice(); a.splice(i + 1, 0, clone(a[i])); set(f.key, a) }
function setRow(key, i, v) { const a = listOf(key).slice(); a[i] = v; set(key, a) }
function rowTitle(f, row, i) {
  if (f.cfg.summary) { try { const s = f.cfg.summary(row); if (s) return String(s) } catch (e) { /* the row is half-made */ } }
  const shape = (unwrap(f.of) || {}).shape || {}
  const isText = (k) => shape[k] && unwrap(shape[k])._def.typeName === 'ZodString' && typeof row[k] === 'string' && row[k].trim()
  const first = ['title', 'name', 'label', 'question', 'heading', 'quote', 'value', 'date', 'text', 'caption'].find(isText) || Object.keys(shape).find(isText)
  return first ? row[first] : (f.cfg.item || 'Item') + ' ' + (i + 1)
}
const rowsWithErr = (f, i) => Object.keys(props.errors).some((p) => p.startsWith(at(f.key) + '.' + i + '.'))
/* pictures: an address written, a file uploaded into content/uploads, or one chosen from the library */
const MF = us('media').page.field
const { choose } = useMediaPick()
async function fromLibrary(key) { const url = await choose('image'); if (url) set(key, url) }
const uploading = ref({})
async function upload(key, e) {
  const file = e.target.files && e.target.files[0]; e.target.value = ''
  if (!file) return
  uploading.value[key] = true
  try { const j = await pipe.uploadImage(file); set(key, j.path) } catch (x) { alert(x.message) } finally { uploading.value[key] = false }
}
const fit = (el) => { el.style.height = 'auto'; el.style.height = Math.max(el.scrollHeight, 40) + 'px' }
const vAutosize = { mounted: fit, updated: fit }
</script>

<template>
  <div class="sfd">
    <template v-for="f in main.filter(shown)" :key="f.key">
    <div class="sfd-f" :class="{ wide: f.wide, bad: !!err(f.key), ['k-' + f.kind]: true }">
      <!-- a switch carries its own label, on the same line -->
      <label v-if="f.kind === 'boolean'" class="sfd-switch">
        <input type="checkbox" :checked="!!cur(f)" @change="set(f.key, $event.target.checked)" /><i></i>
        <span class="sfd-lab">{{ f.label }}</span>
        <small v-if="f.cfg.description" class="sfd-desc">{{ f.cfg.description }}</small>
      </label>
      <template v-else>
        <div class="sfd-head">
          <span class="sfd-lab">{{ f.label }}<b v-if="f.required" class="sfd-req" title="Required">·</b></span>
          <span v-if="f.kind === 'lines' || f.kind === 'rows'" class="sfd-n">{{ listOf(f.key).length || '' }}</span>
        </div>

        <input v-if="f.kind === 'text'" type="text" class="sfd-in" :value="val(f.key) ?? ''" :placeholder="f.cfg.placeholder || ''" @input="set(f.key, $event.target.value)" />
        <textarea v-else-if="f.kind === 'textarea'" v-autosize class="sfd-in sfd-ta" :value="val(f.key) ?? ''" rows="2" :placeholder="f.cfg.placeholder || ''" @input="fit($event.target); set(f.key, $event.target.value)" />
        <MarkdownEditor v-else-if="f.kind === 'markdown'" :model-value="val(f.key) ?? ''" prose class="sfd-md" @update:model-value="set(f.key, $event)" />
        <div v-else-if="f.kind === 'number'" class="sfd-num">
          <input type="number" class="sfd-in" :value="cur(f) ?? ''" :min="f.min" :max="f.max" step="1" @input="set(f.key, $event.target.value === '' ? undefined : Number($event.target.value))" />
        </div>
        <div v-else-if="f.kind === 'form'" class="sfd-sel">
          <select class="sfd-in" :value="cur(f) ?? ''" @change="set(f.key, $event.target.value)">
            <option value="">—</option>
            <option v-for="o in FORM_SLUGS" :key="o.slug" :value="o.slug">{{ o.title }}</option>
          </select><ChevronDownIcon :size="14" class="sfd-selchev" />
        </div>
        <GlyphPicker v-else-if="f.kind === 'glyph'" :model-value="val(f.key) ?? ''" @update:model-value="set(f.key, $event)" />
        <div v-else-if="f.kind === 'enum' && f.values.length <= 5" class="sfd-seg" role="radiogroup" :aria-label="f.label">
          <button v-for="v in f.values" :key="v" type="button" :class="{ on: cur(f) === v }" :aria-pressed="cur(f) === v" @click="set(f.key, v)">{{ (f.cfg.labels && f.cfg.labels[v]) || beautify(v) }}</button>
        </div>
        <div v-else-if="f.kind === 'enum'" class="sfd-sel">
          <select class="sfd-in" :value="cur(f) ?? ''" @change="set(f.key, $event.target.value)">
            <option v-for="v in f.values" :key="v" :value="v">{{ (f.cfg.labels && f.cfg.labels[v]) || beautify(v) }}</option>
          </select><ChevronDownIcon :size="14" class="sfd-selchev" />
        </div>
        <div v-else-if="f.kind === 'image'" class="sfd-img" :class="{ has: !!val(f.key) }">
          <span class="sfd-thumb"><img v-if="val(f.key)" :src="val(f.key)" alt="" /><UploadIcon v-else :size="16" /></span>
          <input type="text" class="sfd-in" :value="val(f.key) ?? ''" :placeholder="f.cfg.placeholder || MF.paste" @input="set(f.key, $event.target.value)" />
          <label class="sfd-up" :class="{ busy: uploading[f.key] }" :title="MF['upload-image']"><input type="file" accept="image/*" hidden @change="upload(f.key, $event)" /><UploadIcon :size="14" /><span>{{ uploading[f.key] ? MF.uploading : MF.upload }}</span></label>
          <button type="button" class="sfd-up" :title="MF.choose" @click="fromLibrary(f.key)"><FolderOpenIcon :size="14" /></button>
          <button v-if="val(f.key)" type="button" class="sfd-x" title="Clear" @click="set(f.key, '')"><XIcon :size="13" /></button>
        </div>

        <div v-else-if="f.kind === 'lines'" class="sfd-lines">
          <draggable :model-value="listOf(f.key).map((text, i) => ({ text, i }))" item-key="i" handle=".sfd-grip" class="sfd-list" ghost-class="sfd-ghost" :animation="150" :force-fallback="true" :fallback-tolerance="4" @end="move(f.key, $event)">
            <template #item="{ element, index }">
              <div class="sfd-line" :class="{ bad: !!errors[at(f.key) + '.' + index] }">
                <button type="button" class="sfd-grip" tabindex="-1" aria-label="Drag to reorder"><GripVerticalIcon :size="13" /></button>
                <input type="text" class="sfd-in" :value="element.text" :placeholder="f.cfg.placeholder || ''" @input="setLine(f.key, index, $event.target.value)" />
                <button type="button" class="sfd-rm" title="Remove" @click="removeAt(f.key, index)"><XIcon :size="13" /></button>
              </div>
            </template>
          </draggable>
          <button type="button" class="sfd-add" @click="addLine(f.key)"><PlusIcon :size="13" /> Add {{ (f.cfg.item || 'line').toLowerCase() }}</button>
        </div>

        <div v-else-if="f.kind === 'rows'" class="sfd-rows">
          <draggable :model-value="listOf(f.key).map((row, i) => ({ row, i }))" item-key="i" handle=".sfd-grip" class="sfd-list" ghost-class="sfd-ghost" :animation="150" :force-fallback="true" :fallback-tolerance="4" @end="move(f.key, $event)">
            <template #item="{ element, index }">
              <div class="sfd-row" :class="{ open: open[f.key + '.' + index], bad: rowsWithErr(f, index) }">
                <div class="sfd-rowhead">
                  <button type="button" class="sfd-grip" tabindex="-1" aria-label="Drag to reorder"><GripVerticalIcon :size="13" /></button>
                  <button type="button" class="sfd-rowtitle" :aria-expanded="!!open[f.key + '.' + index]" @click="open[f.key + '.' + index] = !open[f.key + '.' + index]">
                    <span class="sfd-rown">{{ index + 1 }}</span><span class="sfd-rowt">{{ rowTitle(f, element.row, index) }}</span><ChevronDownIcon :size="13" class="sfd-chev" />
                  </button>
                  <button type="button" class="sfd-ib" title="Duplicate" @click="dupRow(f, index)"><CopyIcon :size="13" /></button>
                  <button type="button" class="sfd-ib danger" title="Remove" @click="removeAt(f.key, index)"><TrashIcon :size="13" /></button>
                </div>
                <div v-if="open[f.key + '.' + index]" class="sfd-rowbody">
                  <SectionFields :shape="f.of" :config="f.cfg.fields || {}" :model-value="element.row" :errors="errors" :base="at(f.key) + '.' + index" @update:model-value="setRow(f.key, index, $event)" />
                </div>
              </div>
            </template>
          </draggable>
          <button type="button" class="sfd-add" @click="addRow(f)"><PlusIcon :size="13" /> Add {{ (f.cfg.item || 'item').toLowerCase() }}</button>
        </div>

        <div v-else-if="f.kind === 'group'" class="sfd-group">
          <SectionFields :shape="f.schema" :config="f.cfg.fields || {}" :model-value="val(f.key) || {}" :errors="errors" :base="at(f.key)" @update:model-value="set(f.key, $event)" />
        </div>

        <small v-if="err(f.key)" class="sfd-err">{{ err(f.key) }}</small>
        <small v-else-if="f.cfg.description" class="sfd-desc">{{ f.cfg.description }}</small>
      </template>
    </div>
    </template>
    <!-- the look: folded, the same controls -->
    <div v-if="look.length" class="sfd-look" :class="{ open: lookOpen }">
      <button type="button" class="sfd-lookbtn" :aria-expanded="lookOpen" @click="lookOpen = !lookOpen"><span>Section look</span><em>{{ look.filter((f) => val(f.key) && !['paper', 'none', 'normal'].includes(val(f.key))).map((f) => f.label.toLowerCase() + ': ' + val(f.key)).join(' · ') || 'tone, glow, ground, spacing, width, reveal, anchor' }}</em><ChevronDownIcon :size="14" /></button>
      <div v-if="lookOpen" class="sfd-lookbody">
        <SectionFields :shape="lookShape" :config="lookCfg" :model-value="modelValue" :errors="errors" :base="base" @update:model-value="$emit('update:modelValue', $event)" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.sfd { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 12px; align-items: start }
.sfd-f { display: flex; flex-direction: column; gap: 6px; min-width: 0 }
.sfd-f.wide { grid-column: 1 / -1 }
.sfd-look { grid-column: 1 / -1; border: 1px solid var(--hair); border-radius: 12px; overflow: hidden; margin-top: 4px }
.sfd-lookbtn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; font: inherit; color: var(--ink); background: var(--wash); border: 0; cursor: pointer; text-align: left }
.sfd-lookbtn span { font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); white-space: nowrap }
.sfd-lookbtn em { flex: 1; min-width: 0; font-style: normal; font-size: 12.5px; color: var(--ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sfd-lookbtn svg { color: var(--ink3); transition: transform .15s } .sfd-look.open .sfd-lookbtn svg { transform: rotate(180deg) }
.sfd-lookbody { padding: 12px 14px 14px; border-top: 1px solid var(--hair) }
.sfd-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px }
.sfd-lab { font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); font-weight: 500 }
.sfd-req { color: var(--accent2); font-size: 16px; line-height: 0; margin-left: 3px }
.sfd-n { font-family: var(--m); font-size: 10.5px; color: var(--ink3) }
.sfd-in { font: inherit; font-size: 13.5px; color: var(--ink); background: var(--paper); border: 1px solid var(--hair); border-radius: 9px; padding: 0 11px; height: 38px; width: 100%; box-sizing: border-box; transition: border-color .12s, box-shadow .12s }
.sfd-in::placeholder { color: color-mix(in srgb, var(--ink3) 70%, transparent) }
.sfd-in:focus { outline: none; border-color: var(--accent2); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent2) 16%, transparent) }
.sfd-f.bad > .sfd-in, .sfd-line.bad .sfd-in { border-color: #e11d4888 }
.sfd-ta { height: auto; min-height: 40px; padding: 9px 11px; line-height: 1.45; resize: none; overflow: hidden }
.sfd-md { min-height: 140px }
.sfd-num .sfd-in { max-width: 140px }
.sfd-err { font-size: 12px; color: #e11d48 }
.sfd-desc { font-size: 12px; color: var(--ink3); line-height: 1.4 }
/* the switch */
.sfd-switch { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; align-items: center; cursor: pointer; user-select: none; padding: 8px 0 }
.sfd-switch input { position: absolute; opacity: 0; width: 0; height: 0 }
.sfd-switch i { grid-row: 1 / 3; position: relative; flex: none; width: 34px; height: 20px; border-radius: 999px; background: color-mix(in srgb, var(--ink3) 40%, var(--paper)); transition: background .15s }
.sfd-switch i::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px #00000033; transition: transform .15s }
.sfd-switch input:checked + i { background: var(--accent2) }
.sfd-switch input:checked + i::after { transform: translateX(14px) }
.sfd-switch input:focus-visible + i { outline: 2px solid var(--accent2); outline-offset: 2px }
.sfd-switch .sfd-lab { color: var(--ink) }
/* the glyphs */
.sfd-glyphs { display: flex; flex-wrap: wrap; gap: 4px }
.sfd-glyphs button { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; color: var(--ink3); background: var(--paper); border: 1px solid var(--hair); cursor: pointer; transition: color .12s, border-color .12s, background .12s }
.sfd-glyphs button :deep(svg) { width: 17px; height: 17px }
.sfd-glyphs button:hover { color: var(--ink); border-color: var(--ink3) }
.sfd-glyphs button.on { color: var(--accent2); background: var(--accentbg, color-mix(in srgb, var(--accent2) 10%, transparent)); border-color: var(--accent2) }
/* segmented choices */
.sfd-seg { display: inline-flex; flex-wrap: wrap; padding: 3px; gap: 2px; background: var(--wash); border: 1px solid var(--hair); border-radius: 10px; align-self: flex-start }
.sfd-seg button { font: inherit; font-size: 13px; font-weight: 500; color: var(--ink3); background: none; border: 0; border-radius: 7px; padding: 6px 12px; cursor: pointer; white-space: nowrap; transition: color .12s, background .12s }
.sfd-seg button:hover { color: var(--ink) }
.sfd-seg button.on { color: var(--ink); background: var(--paper); box-shadow: 0 1px 2px #0000001a, 0 0 0 1px var(--hair) }
.sfd-sel { position: relative } .sfd-sel select { appearance: none; padding-right: 32px; cursor: pointer } .sfd-selchev { position: absolute; right: 11px; top: 12px; color: var(--ink3); pointer-events: none }
/* a picture */
.sfd-img { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 8px; align-items: center }
.sfd-img.has { grid-template-columns: 44px minmax(0, 1fr) auto auto }
.sfd-thumb { display: grid; place-items: center; width: 44px; height: 38px; border-radius: 8px; border: 1px solid var(--hair); background: var(--wash); color: var(--ink3); overflow: hidden }
.sfd-thumb img { width: 100%; height: 100%; object-fit: cover; display: block }
.sfd-up { display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 12px; font-size: 12.5px; font-weight: 600; color: var(--ink2); background: var(--paper); border: 1px solid var(--hair); border-radius: 9px; cursor: pointer; white-space: nowrap }
.sfd-up:hover { color: var(--ink); border-color: var(--ink3) } .sfd-up.busy { opacity: .6 }
.sfd-x { width: 30px; height: 38px; display: inline-flex; align-items: center; justify-content: center; color: var(--ink3); background: none; border: 0; cursor: pointer; border-radius: 8px } .sfd-x:hover { color: #e11d48; background: var(--wash) }
/* lists */
.sfd-list { display: flex; flex-direction: column; gap: 6px }
.sfd-ghost { opacity: .35 }
.sfd-line { display: grid; grid-template-columns: 22px minmax(0, 1fr) 28px; gap: 4px; align-items: center }
.sfd-grip { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 30px; color: var(--ink3); background: none; border: 0; cursor: grab; border-radius: 6px; padding: 0 } .sfd-grip:hover { color: var(--ink) } .sfd-grip:active { cursor: grabbing }
.sfd-rm, .sfd-ib { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; color: var(--ink3); background: none; border: 0; border-radius: 7px; cursor: pointer }
.sfd-rm:hover, .sfd-ib:hover { color: var(--ink); background: var(--wash) } .sfd-rm:hover, .sfd-ib.danger:hover { color: #e11d48 }
.sfd-add { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink2); background: var(--wash); border: 1px dashed color-mix(in srgb, var(--ink3) 60%, transparent); border-radius: 999px; padding: 7px 13px 7px 10px; cursor: pointer }
.sfd-add:hover { color: var(--ink); border-color: var(--ink3); border-style: solid }
.sfd-lines, .sfd-rows { display: flex; flex-direction: column }
/* rows: records that open */
.sfd-row { border: 1px solid var(--hair); border-radius: 12px; background: var(--paper); overflow: hidden; transition: box-shadow .15s }
.sfd-row.open { box-shadow: 0 10px 30px -22px #000a }
.sfd-row.bad { border-color: #e11d4866 }
.sfd-rowhead { display: grid; grid-template-columns: 22px minmax(0, 1fr) 28px 28px; gap: 2px; align-items: center; padding: 4px 6px 4px 4px }
.sfd-rowtitle { display: flex; align-items: center; gap: 10px; min-width: 0; font: inherit; color: var(--ink); background: none; border: 0; padding: 6px 6px; cursor: pointer; text-align: left; border-radius: 8px }
.sfd-rowtitle:hover { background: var(--wash) }
.sfd-rown { flex: none; font-family: var(--m); font-size: 10.5px; color: var(--ink3); width: 16px }
.sfd-rowt { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sfd-chev { color: var(--ink3); transition: transform .15s; flex: none } .sfd-row.open .sfd-chev { transform: rotate(180deg) }
.sfd-rowbody { padding: 10px 14px 16px 14px; border-top: 1px solid var(--hair); background: color-mix(in srgb, var(--wash) 45%, transparent) }
/* a nested record */
.sfd-group { padding: 12px 14px 14px; border: 1px solid var(--hair); border-radius: 12px; background: color-mix(in srgb, var(--wash) 45%, transparent) }
</style>

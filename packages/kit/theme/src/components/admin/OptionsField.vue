<script setup>
/*
 * THE SHAPES A THING IS SOLD IN, EDITED AS WHAT THEY ARE.
 *
 * An option is a name and a list of values; the variants are every combination, and they are
 * DERIVED — never typed, never stored as a list somebody has to keep in step. What an editor
 * may set on a variant is the few things that differ: a price, a sku of its own, a weight, and
 * whether it is sold at all. Everything else about it follows from the options.
 *
 * Three things this refuses to do, each because it has gone wrong somewhere before:
 *
 *   NOBODY TYPES A VARIANT KEY. "linen.lined" is the grammar the cart, the purchase and the
 *   fulfilment all carry, and it is for them. Here a variant is a row in a table with its values
 *   already in it.
 *
 *   REORDERING OPTIONS IS NOT THE SAME AS REORDERING VALUES. A variant's key is positional, so
 *   moving Colour above Size rewrites every key and orphans every cart line already placed.
 *   Values reorder freely (they only change what a buyer sees first); options are moved behind a
 *   confirmation that says what it costs.
 *
 *   A VALUE IS NOT DELETED QUIETLY while a variant of it carries a price or is marked unsold —
 *   that would drop the price and the exclusion with no trace. It says what will go.
 *
 *   A SUPPLIED AXIS IS NOT TYPED. Where the product names a supplier that publishes a catalogue,
 *   the colours and sizes are that supplier's to say: the rows are shown with the name they came
 *   under and Refresh reads them again, rather than inviting somebody to keep a list in step with
 *   a catalogue by hand — which is how a shop comes to sell a colour nobody makes any more. A
 *   value the catalogue has dropped is shown struck through and marked, never silently removed,
 *   because a basket or an unfulfilled order names that variant.
 */
import { ref, computed } from 'vue'
import { action } from '../../lib/admin/api.js'
import draggable from 'vuedraggable'
import { us } from 'platformkit/lib/content.js'
import { normaliseOptions, variantsOf, slug, remapKeys } from 'platformkit/lib/variants.js'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  /* the whole record, for the offer's sku and key and for the variants map the table edits */
  form: { type: Object, default: () => ({}) },
  /* the record's file name, which the catalogue refresh reads and writes by */
  name: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'patch'])
/* the record's own name, which the refresh reads and writes the file by */
const name = computed(() => String(props.name || ''))

const W = computed(() => (us('models').options || {}).main || {})
const opts = computed({ get: () => props.modelValue || [], set: (v) => emit('update:modelValue', v) })

/* the sizes field is one Size option; shown here so the two are never edited in two places */
const effective = computed(() => normaliseOptions([
  ...(props.modelValue || []),
  ...((props.form.sizes || []).length && !(props.modelValue || []).some((o) => slug(o.name) === 'size') ? [{ name: 'Size', values: props.form.sizes }] : []),
]))
const rows = computed(() => variantsOf(
  { sku: props.form.sku || 'sku', key: props.form.key || '00000000' },
  effective.value,
  { sold: { not: props.form.unsold || [] } },
))

const variants = computed(() => props.form.variants || {})
const unsold = computed(() => props.form.unsold || [])
const setVariant = (key, field, raw) => {
  const next = { ...variants.value }
  const v = { ...(next[key] || {}) }
  const value = field === 'price' || field === 'weight' ? (raw === '' ? undefined : Number(raw)) : (raw || undefined)
  if (value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value))) delete v[field]
  else v[field] = value
  if (Object.keys(v).length) next[key] = v; else delete next[key]
  emit('patch', { variants: next })
}
const setSold = (key, on) => {
  const next = on ? unsold.value.filter((k) => k !== key) : [...new Set([...unsold.value, key])]
  emit('patch', { unsold: next })
}

/* ---- the options themselves ---- */
const addOption = () => { opts.value = [...opts.value, { name: '', values: [] }] }
const dropOption = (i) => {
  const o = opts.value[i]
  const hurt = rows.value.filter((r) => (variants.value[r.variant] || unsold.value.includes(r.variant)) && r.chosen.some((c) => c.option === o.name))
  if (hurt.length && !confirm(fill(W['drop-option'], { name: o.name || '?', n: hurt.length }))) return
  opts.value = opts.value.filter((_, j) => j !== i)
}
/*
 * MOVING AN OPTION REWRITES EVERY KEY, so the settings hanging off them are rewritten with it.
 *
 * The key is positional — "leather.lined" is Cover then Ruling because that is the order they
 * are written in. This used to reorder the options and leave `variants` and `unsold` alone, so
 * the editor saved a file whose keys no combination could produce and the build then refused
 * it. Loud, but the editor should not be able to write it.
 *
 * The confirmation stays, because anything in somebody’s basket under the old key stops being
 * recognised, and that is worth asking about. What it must not do is damage the file as well.
 */
const moveOption = (i, by) => {
  const j = i + by
  if (j < 0 || j >= opts.value.length) return
  const placed = rows.value.filter((r) => variants.value[r.variant] || unsold.value.includes(r.variant)).length
  if (placed && !confirm(fill(W['move-option'], { n: placed }))) return
  const before = effective.value
  const next = [...opts.value]; const [x] = next.splice(i, 1); next.splice(j, 0, x)
  opts.value = next
  /* and carry the settings across, by name rather than by position */
  const after = normaliseOptions([...next, ...((props.form.sizes || []).length && !next.some((o) => slug(o.name) === 'size') ? [{ name: 'Size', values: props.form.sizes }] : [])])
  const moved = remapKeys([...Object.keys(variants.value), ...unsold.value], before, after)
  const vs = {}
  for (const [was, now] of Object.entries(moved)) if (now && variants.value[was]) vs[now] = variants.value[was]
  const un = [...new Set(unsold.value.map((k) => moved[k]).filter(Boolean))]
  emit('patch', { variants: vs, unsold: un })
}
const valuesOf = (o) => (o.values || []).map((v) => (v && typeof v === 'object' ? String(v.label ?? v.value) : String(v)))
const setValues = (i, list) => {
  const next = [...opts.value]
  next[i] = { ...next[i], values: list.map((label) => ({ value: slug(label), label: String(label) })) }
  opts.value = next
}
const typed = ref({})
const addValue = (i) => {
  const label = String(typed.value[i] || '').trim()
  if (!label) return
  const list = valuesOf(opts.value[i])
  /* the slug is the identity, so the same value twice is the same value */
  if (!list.some((x) => slug(x) === slug(label))) setValues(i, [...list, label])
  typed.value = { ...typed.value, [i]: '' }
}
const dropValue = (i, j) => {
  const list = valuesOf(opts.value[i])
  const gone = slug(list[j])
  const hurt = rows.value.filter((r) => (variants.value[r.variant] || unsold.value.includes(r.variant)) && r.chosen.some((c) => c.value === gone)).length
  if (hurt && !confirm(fill(W['drop-value'], { name: list[j], n: hurt }))) return
  setValues(i, list.filter((_, k) => k !== j))
}
const setName = (i, name) => { const next = [...opts.value]; next[i] = { ...next[i], name }; opts.value = next }

/*
 * ---- THE SUPPLIER'S CATALOGUE ----
 *
 * An axis carrying `from` belongs to that supplier: its name and its values are read from the
 * catalogue and written by the refresh, so nothing here edits them. What the editor may do is ask
 * for them again, and be told what changed — because a dropped colour is a thing that has to be
 * SAID, not noticed.
 */
const supplied = (o) => !!(o && o.from)
const goneOf = (o) => new Set((o.values || []).filter((v) => v && typeof v === 'object' && v.gone).map((v) => String(v.label ?? v.value)))
const busy = ref(false)
const said = ref(null)
const refresh = async () => {
  if (busy.value || !name.value) return
  busy.value = true
  said.value = null
  try {
    const r = await action('products', 'refresh', { name: name.value })
    /* the file has been rewritten, so the form takes the rows as they now are */
    emit('update:modelValue', r.options || [])
    said.value = r.changed
      ? { ok: true, text: [r.added.length ? fill(W.value['added'], { n: r.added.length }) : '', r.gone.length ? fill(W.value['dropped'], { n: r.gone.length, names: r.gone.map((g) => g.label).join(', ') }) : ''].filter(Boolean).join(' ') }
      : { ok: true, text: W.value['no-change'] }
  } catch (e) {
    said.value = { ok: false, text: String((e && e.message) || e) }
  } finally { busy.value = false }
}

const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const money = (n) => (n == null ? '' : String(n))
</script>

<template>
  <div class="ui-opts">
    <div class="ui-optlist">
      <template v-for="(o, i) in opts" :key="i">
        <div class="ui-optrow" :class="{ 'ui-optsup': supplied(o) }">
          <div class="ui-optmove">
            <button type="button" :disabled="i === 0" :aria-label="W.up" @click="moveOption(i, -1)">↑</button>
            <button type="button" :disabled="i === opts.length - 1" :aria-label="W.down" @click="moveOption(i, 1)">↓</button>
          </div>
          <div class="ui-optcell">
            <span class="ui-optlabel">{{ W.name }}</span>
            <!-- a supplied axis is the catalogue's: its name is read, not typed -->
            <p v-if="supplied(o)" class="ui-optname">{{ o.name }}</p>
            <input v-else :value="o.name" type="text" class="ui-input" @input="setName(i, $event.target.value)" />
          </div>
          <div class="ui-optcell ui-optwide">
            <span class="ui-optlabel">{{ W.values }}</span>
            <!-- SUPPLIED: shown as they came, a dropped one struck through and named -->
            <div v-if="supplied(o)" class="ui-vals">
              <span v-for="v in valuesOf(o)" :key="v" class="ui-val ui-valsup" :class="{ gone: goneOf(o).has(v) }" :title="goneOf(o).has(v) ? W['value-gone'] : ''">{{ v }}</span>
            </div>
            <div v-else class="ui-vals">
              <draggable :model-value="valuesOf(o)" :item-key="(v) => v" class="ui-valrow" :animation="150" @update:model-value="setValues(i, $event)">
                <template #item="{ element: v, index: j }">
                  <span class="ui-val">{{ v }}<button type="button" :aria-label="W['remove-value']" @click="dropValue(i, j)">×</button></span>
                </template>
              </draggable>
              <input
                :value="typed[i] || ''" type="text" class="ui-input ui-valadd" :placeholder="W['add-value']"
                @input="typed = { ...typed, [i]: $event.target.value }"
                @keydown.enter.prevent="addValue(i)" @blur="addValue(i)"
              />
            </div>
          </div>
          <p v-if="supplied(o)" class="ui-optfrom">{{ fill(W['from'], { name: o.from }) }}</p>
          <button v-else type="button" class="ui-optx" :aria-label="W.remove" @click="dropOption(i)">×</button>
        </div>
      </template>
    </div>
    <div class="ui-optbar">
      <button type="button" class="ui-btn" @click="addOption">{{ W.add }}</button>
      <!-- READ THE CATALOGUE AGAIN, where the product names a supplier that publishes one -->
      <button v-if="form.supplier" type="button" class="ui-btn" :disabled="busy" @click="refresh">{{ busy ? W.reading : W.refresh }}</button>
      <p v-if="said" class="ui-optsaid" :class="{ warn: !said.ok }">{{ said.text }}</p>
    </div>

    <!-- THE SHAPES, DERIVED. Not a <table>: the admin's global stylesheet owns bare element
         names and sized this one past its own column. A grid is ours. -->
    <div v-if="rows.length > 1" class="ui-vartable">
      <p class="ui-varsay">{{ fill(W.derived, { n: rows.length }) }}</p>
      <div class="ui-vargrid">
        <div class="ui-varitem ui-varhead">
          <span>{{ W['v-shape'] }}</span><span>{{ W['v-price'] }}</span><span>{{ W['v-sku'] }}</span><span class="ui-varmid">{{ W['v-sold'] }}</span>
        </div>
        <div v-for="r in rows" :key="r.variant" class="ui-varitem">
          <span class="ui-varshape" :class="{ off: !r.sold, gone: r.gone }" :title="r.gone ? W['variant-gone'] : ''">{{ r.label }}</span>
          <input type="number" step="0.01" min="0" class="ui-input ui-varin" :aria-label="W['v-price']" :placeholder="money(form.price)" :value="money((variants[r.variant] || {}).price)" @change="setVariant(r.variant, 'price', $event.target.value)" />
          <input type="text" class="ui-input ui-varin" :aria-label="W['v-sku']" :placeholder="r.sku" :value="(variants[r.variant] || {}).sku || ''" @change="setVariant(r.variant, 'sku', $event.target.value)" />
          <label class="ui-varmid ui-varsold">
            <!-- a variant the CATALOGUE dropped is not the shop's to put back on sale, so the
                 switch is disabled rather than appearing to work and being overruled by the next
                 refresh. The two facts stay distinct: `unsold` is a decision, `gone` is news. -->
            <input type="checkbox" :checked="r.sold" :disabled="r.gone" @change="setSold(r.variant, $event.target.checked)" />
            <span>{{ W['v-sold'] }}</span>
          </label>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.ui-opts { display: flex; flex-direction: column; gap: 10px }
.ui-optlist { display: flex; flex-direction: column; gap: 8px }
.ui-optrow { display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--hair); border-radius: 12px; background: var(--wash) }
.ui-optmove { display: flex; flex-direction: column; gap: 2px; padding-top: 18px }
.ui-optmove button { border: 0; background: none; color: var(--ink3); cursor: pointer; font-size: 13px; line-height: 1; padding: 2px 4px }
.ui-optmove button[disabled] { opacity: .3; cursor: default }
.ui-optcell { display: flex; flex-direction: column; gap: 4px; flex: 0 0 150px }
.ui-optwide { flex: 1; min-width: 0 }
.ui-optlabel { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); line-height: 16px }
.ui-optx { border: 0; background: none; color: var(--ink3); font-size: 20px; line-height: 1; cursor: pointer; padding: 18px 2px 0 }
.ui-optx:hover { color: var(--ink) }
.ui-optbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px }
.ui-optsaid { margin: 0; font-size: 12px; color: var(--ink3) }
.ui-optsaid.warn { color: var(--warn, var(--ink)) }
/* a supplied axis reads as read-only rather than as a disabled form: no input chrome at all */
.ui-optsup { background: var(--paper) }
.ui-optname { margin: 0; padding: 7px 0; font-size: 14px; line-height: 20px }
.ui-optfrom { margin: 18px 0 0; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--ink3); white-space: nowrap }
.ui-valsup { cursor: default; padding-right: 10px }
.ui-valsup.gone { opacity: .55; text-decoration: line-through }
.ui-varshape.gone { opacity: .5; text-decoration: line-through }
.ui-vals { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 34px }
.ui-valrow { display: contents }
.ui-val { display: inline-flex; align-items: center; gap: 2px; padding: 3px 4px 3px 10px; border: 1px solid var(--hair); border-radius: 999px; background: var(--paper); font-size: 13px; cursor: grab; white-space: nowrap }
.ui-val button { border: 0; background: none; color: var(--ink3); cursor: pointer; font-size: 15px; line-height: 1; padding: 0 3px }
.ui-val button:hover { color: var(--ink) }
.ui-valadd { flex: 1 1 110px; min-width: 90px }
.ui-vartable { border: 1px solid var(--hair); border-radius: 12px; padding: 12px; overflow-x: auto }
.ui-varsay { margin: 0 0 10px; font-size: 12px; color: var(--ink3) }
.ui-vargrid { display: flex; flex-direction: column; gap: 4px; font-size: 14px }
.ui-varitem { display: grid; grid-template-columns: minmax(0, 1fr) 88px minmax(0, 1fr) 40px; align-items: center; gap: 8px }
.ui-varhead { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); padding-bottom: 2px }
.ui-varmid { text-align: center }
.ui-varsold { display: block }
.ui-varsold span { display: none }
.ui-varshape { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ui-varshape.off { opacity: .5; text-decoration: line-through }
/* at a phone's width the shape is the thing to read, so it takes a line of its own and the
   three settings sit under it; the heading row goes, since each control then says what it is */
@media (max-width: 560px) {
  .ui-vargrid { gap: 10px }
  .ui-varhead { display: none }
  .ui-varitem { grid-template-columns: 88px minmax(0, 1fr) auto; gap: 4px 8px; padding-bottom: 10px; border-bottom: 1px solid var(--hair) }
  .ui-varitem:last-child { border-bottom: 0; padding-bottom: 0 }
  .ui-varshape { grid-column: 1 / -1; white-space: normal }
  .ui-varsold { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--ink3); white-space: nowrap }
  .ui-varsold span { display: inline }
}
.ui-varin { width: 100% }
@media (max-width: 560px) {
  .ui-optrow { flex-wrap: wrap }
  .ui-optcell { flex: 1 1 100% }
  .ui-optmove { flex-direction: row; padding-top: 0; order: 3 }
  .ui-optx { padding-top: 0; order: 4; margin-left: auto }
}
</style>

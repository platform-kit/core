<script setup>
/* One control for one leaf kind of a content model's field — the same controls the drawer draws at the top
   level, so a group's sub-field and a list's row are edited exactly as a field is: text, long text, markdown,
   number, a switch, a date, a date and time, a select, a multi-select, tags, a reference (the other model's
   entries by title), an image or a file uploaded to the library or chosen from it. */
import pipe from '../../lib/admin/api.js'
import { ref, computed, onMounted } from 'vue'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import InputNumber from 'primevue/inputnumber'
import ToggleSwitch from 'primevue/toggleswitch'
import MultiSelect from 'primevue/multiselect'
import Select from 'primevue/select'
import AutoComplete from 'primevue/autocomplete'
import DatePicker from 'primevue/datepicker'
import MarkdownEditor from './MarkdownEditor.vue'
import { us } from 'platformkit/lib/strings.js'
import { useMediaPick } from '../../lib/admin/media-pick.js'
const props = defineProps({ field: { type: Object, required: true }, modelValue: { default: undefined }, col: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue'])
const W = (us('models').drawer || {}).entry || {}
const MF = us('media').page.field
const { choose } = useMediaPick()
async function fromLibrary() { const url = await choose(kind.value === 'image' ? 'image' : 'file'); if (url) set(url) }
const set = (v) => emit('update:modelValue', v)
const kind = computed(() => props.field.kind)
/* a reference's choices: the other model's entries, fetched once per model per page */
const cache = (window.__dlModelOptions = window.__dlModelOptions || {})
const refOptions = ref([])
async function loadRef() { const key = props.field.options; if (!key) return; if (!cache[key]) cache[key] = pipe.options(key); refOptions.value = await cache[key] }
/* a tags field offers a list too — the site's own tags — so it loads the same way */
onMounted(() => { if (kind.value === 'reference' || (kind.value === 'tags' && props.field.options)) loadRef() })
const choices = computed(() => (kind.value === 'reference' || kind.value === 'tags' ? refOptions.value : props.field.choices || []))
/*
 * WHETHER A WRITER MAY INVENT ONE. The list carries the answer with it — the options endpoint
 * answers a `free` entry beside the tags — so this is the vocabulary's own switch read at
 * render time, not a second setting on the field that could disagree with it.
 *
 * Off, the field is a picker and nothing else: a subject not on the list cannot be entered, which
 * is what stops one subject becoming two spellings of itself. On, it suggests from the list and
 * takes what is typed.
 */
const freeTags = computed(() => choices.value.some((o) => o && o.value === '__free__'))
const tagChoices = computed(() => choices.value.filter((o) => o && o.value !== '__free__'))
const suggestions = ref([])
const suggest = (e) => {
  const q = String((e && e.query) || '').trim().toLowerCase()
  const have = new Set((props.modelValue || []).map((v) => String(v).toLowerCase()))
  suggestions.value = tagChoices.value.filter((o) => !have.has(String(o.value).toLowerCase()) && (!q || o.label.toLowerCase().includes(q))).map((o) => o.value)
}
/* dates: the file holds YYYY-MM-DD, or YYYY-MM-DDTHH:mm for a date and time */
const toDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null }
const p2 = (n) => String(n).padStart(2, '0')
const toYMD = (d) => (d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : '')
const toYMDHM = (d) => (d ? toYMD(d) + `T${p2(d.getHours())}:${p2(d.getMinutes())}` : '')
/* uploads go under the model's folder of the library, through the collection's asset store; the field holds the address */
const uploading = ref(false), err = ref('')
async function upload(e) {
  const file = e.target.files && e.target.files[0]; e.target.value = ''
  if (!file) return
  uploading.value = true; err.value = ''
  try {
    const j = await pipe.upload(props.col, file)
    set(j.path)
  } catch (x) { err.value = x.message } finally { uploading.value = false }
}
const previewSrc = (v) => (!v ? '' : /^(https?:)?\/\//.test(v) || v.startsWith('/') ? v : pipe.assetUrl(props.col, v))
</script>

<template>
  <InputText v-if="kind === 'text' || kind === 'url' || kind === 'email'" :model-value="modelValue ?? ''" :type="kind === 'url' ? 'url' : kind === 'email' ? 'email' : 'text'" fluid @update:model-value="set($event)" />
  <Textarea v-else-if="kind === 'long-text'" :model-value="modelValue ?? ''" rows="3" autoResize fluid @update:model-value="set($event)" />
  <MarkdownEditor v-else-if="kind === 'markdown'" :model-value="modelValue ?? ''" prose class="ml-md" @update:model-value="set($event)" />
  <InputNumber v-else-if="kind === 'number'" :model-value="modelValue ?? null" :useGrouping="false" :maxFractionDigits="6" fluid showButtons @update:model-value="set($event === null ? undefined : $event)" />
  <ToggleSwitch v-else-if="kind === 'boolean'" :model-value="!!modelValue" @update:model-value="set($event)" />
  <DatePicker v-else-if="kind === 'date'" :model-value="toDate(modelValue)" dateFormat="yy-mm-dd" showIcon showButtonBar iconDisplay="input" fluid @update:model-value="set(toYMD($event))" />
  <DatePicker v-else-if="kind === 'datetime'" :model-value="toDate(modelValue)" dateFormat="yy-mm-dd" showTime hourFormat="24" showIcon showButtonBar iconDisplay="input" fluid @update:model-value="set(toYMDHM($event))" />
  <Select v-else-if="kind === 'select' || (kind === 'reference' && !field.many)" :model-value="modelValue ?? null" :options="choices" optionLabel="label" optionValue="value" :filter="kind === 'reference'" :placeholder="W.pick" showClear fluid @update:model-value="set($event ?? undefined)" />
  <MultiSelect v-else-if="kind === 'multi-select' || kind === 'reference'" :model-value="modelValue || []" :options="choices" optionLabel="label" optionValue="value" filter :maxSelectedLabels="3" :showToggleAll="false" :placeholder="W.pick" fluid @update:model-value="set($event)" />
  <!-- a subject is chosen from the site's list; typing a new one is the vocabulary's own switch -->
  <MultiSelect v-else-if="kind === 'tags' && field.options && !freeTags" :model-value="modelValue || []" :options="tagChoices" optionLabel="label" optionValue="value" filter :maxSelectedLabels="4" :showToggleAll="false" :placeholder="W.pick" fluid @update:model-value="set($event)" />
  <AutoComplete v-else-if="kind === 'tags'" :model-value="modelValue || []" multiple :suggestions="suggestions" :typeahead="false" fluid @complete="suggest" @update:model-value="set($event)" />
  <div v-else-if="kind === 'image' || kind === 'file'" class="ml-up">
    <span v-if="kind === 'image' && modelValue" class="ml-prev"><img :src="previewSrc(modelValue)" alt="" /></span>
    <code v-else-if="modelValue" class="ml-path">{{ modelValue }}</code>
    <label class="ui-btn ui-ghost ui-sm ml-btn"><input type="file" :accept="kind === 'image' ? 'image/*' : undefined" hidden @change="upload" />{{ uploading ? '…' : modelValue ? W.replace : W.upload }}</label>
    <button type="button" class="ui-btn ui-ghost ui-sm" @click="fromLibrary">{{ MF.choose }}</button>
    <button v-if="modelValue" type="button" class="ui-btn ui-ghost ui-sm" @click="set(undefined)">{{ W.remove }}</button>
    <em v-if="err" class="ui-err">{{ err }}</em>
  </div>
</template>

<style scoped>
.ml-up { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.ml-prev { display: block; width: 96px; aspect-ratio: 1; border-radius: 8px; overflow: hidden; border: 1px solid var(--hair); background: var(--wash) } .ml-prev img { width: 100%; height: 100%; object-fit: cover; display: block }
.ml-path { font-family: var(--m); font-size: 12px; color: var(--ink2) }
.ml-btn { cursor: pointer }
.ml-md { min-height: 160px }
</style>

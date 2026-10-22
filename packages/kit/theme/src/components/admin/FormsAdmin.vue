<script setup>
/* The forms: the collections' grid (AG Grid, the shared theme) — a row each with its title, its address,
   whether it is on, its slides and fields, a quiz, one answer per person, what is wrong with it — opening
   into the builder (FormBuilder.vue); New form writes a starter document and opens it. Everything goes
   through the content pipe (the forms model). */
import { ref, computed, onMounted, watch } from 'vue'
import { AgGridVue } from 'ag-grid-vue3'
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community'
import { useAgGridTheme } from '../../lib/agGridTheme.js'
import FormBuilder from './FormBuilder.vue'
ModuleRegistry.registerModules([AllCommunityModule])
const theme = useAgGridTheme()
import { us, ug } from 'platformkit/lib/strings.js'
import './admin-ui.css'
const props = defineProps({ name: { type: String, default: '' } })
const emit = defineEmits(['open', 'back'])
const W = (us('forms').admin || {}).list || {}
import pipe from '../../lib/admin/api.js'
import AdminHead from './AdminHead.vue'
/* the page's own name and its one line, from the admin's words — the same two the shell reads
   when it draws a head, so a page is never named twice in two files */
const PAGE = { title: (ug('admin', 'rail').views || {})['forms'] || '', lead: (ug('admin', 'leads').main || {})['forms'] || '' }
const forms = ref([]), loading = ref(true), msg = ref('')
async function load() { loading.value = true; try { forms.value = await pipe.items('forms') } catch (e) { msg.value = e.message } finally { loading.value = false } }
onMounted(load)
watch(() => props.name, (n) => { if (!n) load() })
const defaultColDef = { sortable: true, filter: true, resizable: true, floatingFilter: true }
const getRowId = (q) => q.data.name
const yes = (v) => (v ? '✓' : '—')
const columnDefs = computed(() => [
  { headerName: W['col-title'], field: 'title', pinned: 'left', flex: 1.6, minWidth: 220, cellRenderer: (q) => `<span class="fa-gtitle">${q.value}</span><span class="fa-gaddr">/form/${q.data.name}</span>` },
  { headerName: W['col-on'], width: 100, valueGetter: (q) => (q.data.published ? W.on : W.off), cellRenderer: (q) => `<span class="ui-pill ${q.data.published ? 'ui-ok' : 'ui-off'}">${q.value}</span>` },
  { headerName: W['col-slides'], field: 'slides', width: 100, type: 'numericColumn' },
  { headerName: W['col-fields'], field: 'fields', width: 100, type: 'numericColumn' },
  { headerName: W.quiz, width: 90, valueGetter: (q) => yes(q.data.quiz), cellClass: 'fa-gc' },
  { headerName: W.once, width: 90, valueGetter: (q) => yes(q.data.once), cellClass: 'fa-gc' },
  { headerName: W['col-state'], flex: 1, minWidth: 160, valueGetter: (q) => (q.data.errors && q.data.errors.length ? W.errors : q.data.warnings && q.data.warnings.length ? W.warnings.replace('{n}', q.data.warnings.length) : ''), cellRenderer: (q) => (q.data.errors && q.data.errors.length ? `<span class="ui-err">${q.value}</span>` : q.value) },
])
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
async function startNew() {
  const title = prompt(W.new + ' — ' + (us('forms').admin.settings || {}).title)
  if (!title) return
  const name = slug(title)
  try { await pipe.action('forms', 'create', { name, title }); try { sessionStorage.setItem('dl.admin.saved', 'forms') } catch (e) { /* private */ } emit('open', name) } catch (e) { msg.value = e.message }
}
</script>

<template>
  <div class="fa">
    <FormBuilder v-if="name" :name="name" @back="emit('back')" @saved="load" />
    <template v-else>
      <AdminHead :title="PAGE.title"><template #sub><span v-html="PAGE.lead" /></template>
        <template #afterTitle><span class="ui-count">{{ forms.length }}</span></template>
        <template #actions><button type="button" class="ui-btn ui-primary" @click="startNew">{{ W.new }}</button></template>
      </AdminHead>
      <p v-if="msg" class="ui-err">{{ msg }}</p>
      <p v-if="loading" class="ui-muted">…</p>
      <div v-else-if="!forms.length" class="ui-empty"><h3>{{ W['empty-title'] }}</h3><p>{{ W['empty-body'] }}</p><button type="button" class="ui-btn ui-primary" @click="startNew">{{ W['empty-cta'] }}</button></div>
      <div v-else class="fa-grid">
        <AgGridVue class="fa-aggrid" :theme="theme" :row-data="forms" :column-defs="columnDefs" :default-col-def="defaultColDef" :get-row-id="getRowId"
                   :row-height="54" :suppress-cell-focus="true" @row-clicked="emit('open', $event.data.name)" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.fa { display: flex; flex-direction: column; gap: 14px; width: 100%; flex: 1; min-height: 0; overflow-y: auto; margin: 0 -30px; padding: 2px 30px 20px }
.fa-grid { flex: 1; min-height: 520px; display: flex }
.fa-aggrid { flex: 1; min-height: 0; width: 100% }
.fa-grid :deep(.ag-row) { cursor: pointer }
.fa-grid :deep(.fa-gtitle) { display: block; font-family: var(--fd); font-weight: 600; font-size: 14.5px; line-height: 1.25; padding-top: 7px }
.fa-grid :deep(.fa-gaddr) { display: block; font-family: var(--m); font-size: 11px; color: var(--ink3); line-height: 1.2 }
.fa-grid :deep(.fa-gc) { text-align: center }
</style>

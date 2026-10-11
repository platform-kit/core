<script setup>
/* The content models: the collections' grid (AG Grid, the shared theme) — a row each with its name, its key,
   its fields, its entries, how it is delivered, whether it is on, what is wrong with it — opening into the
   builder (ModelBuilder.vue); New model opens the builder on a blank one. Everything goes through
   the content pipe (the models model). */
import { ref, computed, onMounted, watch } from 'vue'
import { AgGridVue } from 'ag-grid-vue3'
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community'
import { useAgGridTheme } from '../../lib/agGridTheme.js'
import ModelBuilder from './ModelBuilder.vue'
ModuleRegistry.registerModules([AllCommunityModule])
const theme = useAgGridTheme()
import { us, ug } from '@platform-kit/kit/lib/strings.js'
import './admin-ui.css'
const props = defineProps({ name: { type: String, default: '' } })
const emit = defineEmits(['open', 'back'])
const A = us('models').admin || {}
const W = A.page || {}, G = A.grid || {}, D = A.delivery || {}
import pipe from '../../lib/admin/api.js'
import AdminHead from './AdminHead.vue'
/* the page's own name and its one line, from the admin's words — the same two the shell reads
   when it draws a head, so a page is never named twice in two files */
const PAGE = { title: (ug('admin', 'rail').views || {})['models'] || '', lead: (ug('admin', 'leads').main || {})['models'] || '' }
const models = ref([]), loading = ref(true), msg = ref('')
/* the custom models from their records, and the core models of the registry — the kit's and the site's — read-only beside them */
async function load() {
  loading.value = true
  try {
    const [custom, cols] = await Promise.all([pipe.items('models'), pipe.collections()])
    const core = Object.values(cols).filter((c) => c.core && !c.custom && c.fields.length).map((c) => ({ key: c.key, name: c.label, published: true, fields: c.fields.length, entries: c.count, deliver: [], errors: [], core: true, dir: c.dir, describe: c }))
    models.value = [...custom.map((m) => ({ ...m, core: false })), ...core]
  } catch (e) { msg.value = e.message } finally { loading.value = false }
}
const coreOf = (key) => models.value.find((m) => m.core && m.key === key) || null
const kindOf = (f) => (f.kind ? ((us('models').kinds || {})[f.kind] || {}).name || f.kind : f.widget || f.type)
onMounted(load)
watch(() => props.name, (n) => { if (!n) load() })
const defaultColDef = { sortable: true, filter: true, resizable: true, floatingFilter: true }
const getRowId = (q) => q.data.key
const columnDefs = computed(() => [
  { headerName: G['col-name'], field: 'name', pinned: 'left', flex: 1.4, minWidth: 200, cellRenderer: (q) => `<span class="ma-gtitle">${q.value}</span><span class="ma-gaddr">${q.data.core ? q.data.dir : 'content/models/' + q.data.key}</span>` },
  { headerName: G['col-kind'], width: 110, valueGetter: (q) => (q.data.core ? G.core : G.custom), cellRenderer: (q) => `<span class="ui-pill ${q.data.core ? 'ui-off' : 'ui-ok'}">${q.value}</span>` },
  { headerName: G['col-on'], width: 110, valueGetter: (q) => (q.data.errors && q.data.errors.length ? '!' : q.data.published ? '✓' : '—'), cellRenderer: (q) => (q.data.errors && q.data.errors.length ? `<span class="ui-pill ui-warn" title="${q.data.errors.join('\n').replace(/"/g, '&quot;')}">!</span>` : `<span class="ui-pill ${q.data.published ? 'ui-ok' : 'ui-off'}">${q.value}</span>`) },
  { headerName: G['col-fields'], field: 'fields', width: 100, type: 'numericColumn' },
  { headerName: G['col-entries'], field: 'entries', width: 100, type: 'numericColumn' },
  { headerName: G['col-deliver'], flex: 1, minWidth: 180, valueGetter: (q) => (q.data.deliver || []).map((k) => D[k] || k).join(' · ') },
])
</script>

<template>
  <div class="ma">
    <!-- a core model: its fields shown, read-only — the kit's or the site's declaration, never the builder's -->
    <div v-if="name && coreOf(name)" class="ma-core">
      <div class="ma-corehead"><button type="button" class="ui-btn ui-ghost ui-sm" @click="emit('back')">← {{ W.title }}</button><h2 class="ma-coretitle">{{ coreOf(name).name }}</h2><span class="ui-pill ui-off">{{ G.core }}</span></div>
      <p class="ui-hint">{{ G['core-lead'] }} <code class="ui-key">{{ coreOf(name).dir }}</code></p>
      <div class="ui-card ma-corefields">
        <div v-for="f in coreOf(name).describe.fields" :key="f.name" class="ma-corefield">
          <span class="ma-cf-label">{{ f.label }}<i v-if="f.required" class="ma-cf-req">*</i></span>
          <span class="ma-cf-kind">{{ kindOf(f) }}</span>
          <code class="ui-key">{{ f.name }}</code>
          <span v-if="f.help" class="ma-cf-help">{{ f.help }}</span>
        </div>
      </div>
    </div>
    <ModelBuilder v-else-if="name" :name="name === '__new' ? '' : name" @back="emit('back')" @saved="load" @open="emit('open', $event)" />
    <template v-else>
      <AdminHead :title="PAGE.title"><template #sub><span v-html="PAGE.lead" /></template>
        <template #afterTitle><span class="ui-count">{{ models.length }}</span></template>
        <template #actions><button type="button" class="ui-btn ui-primary" @click="emit('open', '__new')">{{ W.new }}</button></template>
      </AdminHead>
      <p v-if="msg" class="ui-err">{{ msg }}</p>
      <p v-if="loading" class="ui-muted">…</p>
      <div v-else-if="!models.length" class="ui-empty"><p>{{ W.empty }}</p><button type="button" class="ui-btn ui-primary" @click="emit('open', '__new')">{{ W.new }}</button></div>
      <div v-else class="ma-grid">
        <AgGridVue class="ma-aggrid" :theme="theme" :row-data="models" :column-defs="columnDefs" :default-col-def="defaultColDef" :get-row-id="getRowId"
                   :row-height="54" :suppress-cell-focus="true" @row-clicked="emit('open', $event.data.key)" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.ma { display: flex; flex-direction: column; gap: 14px; width: 100%; flex: 1; min-height: 0; overflow-y: auto; margin: 0 -30px; padding: 2px 30px 20px }
.ma-grid { flex: 1; min-height: 520px; display: flex }
.ma-aggrid { flex: 1; min-height: 0; width: 100% }
.ma-grid :deep(.ag-row) { cursor: pointer }
.ma-grid :deep(.ma-gtitle) { display: block; font-family: var(--fd); font-weight: 600; font-size: 14.5px; line-height: 1.25; padding-top: 7px }
.ma-grid :deep(.ma-gaddr) { display: block; font-family: var(--m); font-size: 11px; color: var(--ink3); line-height: 1.2 }
.ma-core { display: flex; flex-direction: column; gap: 14px }
.ma-corehead { display: flex; align-items: center; gap: 14px } .ma-coretitle { font-family: var(--fd); font-weight: 600; font-size: 28px; letter-spacing: -.02em; margin: 0 }
.ma-corefields { gap: 0; padding: 4px 16px }
.ma-corefield { display: grid; grid-template-columns: minmax(160px, 1fr) 120px 160px minmax(0, 2fr); gap: 14px; align-items: baseline; padding: 10px 0; border-bottom: 1px solid var(--hair) } .ma-corefield:last-child { border-bottom: 0 }
.ma-cf-label { font-weight: 600; font-size: 14px } .ma-cf-req { font-style: normal; color: var(--accent2); margin-left: 3px }
.ma-cf-kind { font-family: var(--m); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3) }
.ma-cf-help { font-size: 12.5px; color: var(--ink2) }
</style>

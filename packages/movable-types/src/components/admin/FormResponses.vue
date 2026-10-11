<script setup>
/*
 * Every response to every form, as it came in: a row each (the form, who — a reader's name or Guest —
 * started, finished, a quiz's score), filtered by form, by finished or not, and exported as CSV from the
 * rows in hand; a row opens to its answers in the form's order with their times, the files as links
 * signed for an hour (the staff read the bucket under RLS). Read from the tables under RLS, so the
 * staff alone; nothing is written here but a delete.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { AgGridVue } from 'ag-grid-vue3'
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community'
import { useAgGridTheme } from '../../lib/agGridTheme.js'
import { supabase, configured as supabaseOn } from '@platform-kit/kit/lib/supabase.js'
ModuleRegistry.registerModules([AllCommunityModule])
const theme = useAgGridTheme()
import { isSignedIn, onIdentity } from '@platform-kit/kit/lib/auth.js'
import { forms as FORMS } from '#content'
import { us, ug } from '@platform-kit/kit/lib/strings.js'
import './admin-ui.css'
import AdminHead from './AdminHead.vue'
/* the page's own name and its one line, from the admin's words — the same two the shell reads
   when it draws a head, so a page is never named twice in two files */
const PAGE = { title: (ug('admin', 'rail').views || {})['form-responses'] || '', lead: (ug('admin', 'leads').main || {})['form-responses'] || '' }
const props = defineProps({ name: { type: String, default: '' } })
const emit = defineEmits(['open', 'back'])
const R = us('forms').responses || {}
const W = R.list || {}, W1 = R.one || {}
const rows = ref([]), loading = ref(true), msg = ref('')
const form = ref(''), status = ref('all')
const names = ref({})
async function load() {
  if (!supabaseOn || !isSignedIn.value) return
  loading.value = true; msg.value = ''
  try {
    const { data, error } = await supabase.from('form_responses').select('id, form, user_id, anon_id, started_at, completed_at, score, total, passed, webhook_at, webhook_error').order('started_at', { ascending: false }).limit(500)
    if (error) throw error
    rows.value = data || []
    const ids = [...new Set(rows.value.map((r) => r.user_id).filter(Boolean))]
    if (ids.length) { const { data: p } = await supabase.from('profiles').select('id, display_name, email').in('id', ids); for (const x of p || []) names.value[x.id] = x.display_name || x.email || x.id.slice(0, 8) }
  } catch (e) { msg.value = e.message } finally { loading.value = false }
}
onMounted(load)
onIdentity((id) => { if (id) load() })
const formsList = computed(() => [...new Set([...(FORMS || []).map((f) => f.slug), ...rows.value.map((r) => r.form)])])
const shown = computed(() => rows.value.filter((r) => (!form.value || r.form === form.value) && (status.value === 'all' || (status.value === 'done' ? !!r.completed_at : !r.completed_at))))
const who = (r) => (r.user_id ? names.value[r.user_id] || r.user_id.slice(0, 8) : W.guest)
const when = (s) => (s ? new Date(s).toLocaleString() : '')
/* the grid: every response a row; a click opens it */
const defaultColDef = { sortable: true, filter: true, resizable: true, floatingFilter: true }
const getRowId = (q) => q.data.id
const columnDefs = computed(() => {
  void names.value
  return [
    { headerName: W.form, field: 'form', pinned: 'left', flex: 1.2, minWidth: 160, cellClass: 'fr-gform' },
    { headerName: W.who, flex: 1, minWidth: 140, valueGetter: (q) => who(q.data) },
    { headerName: W.started, flex: 1, minWidth: 170, valueGetter: (q) => q.data.started_at, valueFormatter: (q) => when(q.value), sort: 'desc' },
    { headerName: W.finished, flex: 1, minWidth: 170, valueGetter: (q) => q.data.completed_at || '', valueFormatter: (q) => (q.value ? when(q.value) : W.unfinished), cellClass: (q) => (q.value ? '' : 'fr-gopen') },
    { headerName: W.score, width: 96, type: 'numericColumn', valueGetter: (q) => (q.data.total ? q.data.score + '/' + q.data.total : '') },
  ]
})
const fieldsOf = (slug) => { const f = (FORMS || []).find((x) => x.slug === slug); return f ? f.model.fields : [] }

/* one response */
const cur = computed(() => rows.value.find((r) => r.id === props.name) || null)
const answers = ref([]), files = ref({})
async function loadOne() {
  answers.value = []; files.value = {}
  if (!cur.value) return
  const { data } = await supabase.from('form_answers').select('field, value, file_path, file_name, file_type, file_size, slide, answered_at').eq('response_id', cur.value.id)
  const order = fieldsOf(cur.value.form).map((f) => f.name)
  answers.value = (data || []).sort((a, b) => (order.indexOf(a.field) - order.indexOf(b.field)) || a.answered_at.localeCompare(b.answered_at))
  const paths = answers.value.filter((a) => a.file_path).map((a) => a.file_path)
  if (paths.length) { const { data: s } = await supabase.storage.from('forms').createSignedUrls(paths, 3600); for (const x of s || []) if (x.signedUrl) files.value[x.path] = x.signedUrl }
}
watch([cur, rows], loadOne, { immediate: true })
const question = (slug, name) => { const f = fieldsOf(slug).find((x) => x.name === name); return f && f.question && f.question !== '...' ? f.question : name }
const show = (a) => (a.file_path ? a.file_name : Array.isArray(a.value) ? a.value.join(', ') : a.value == null ? '' : typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value))
async function remove() { if (!cur.value || !confirm(W1.delete + '?')) return; await supabase.from('form_responses').delete().eq('id', cur.value.id); rows.value = rows.value.filter((r) => r.id !== cur.value.id); emit('back') }

/* CSV: the rows shown, every answer of each as a column */
async function exportCsv() {
  const list = shown.value
  const ids = list.map((r) => r.id)
  const all = []
  for (let i = 0; i < ids.length; i += 200) { const { data } = await supabase.from('form_answers').select('response_id, field, value, file_name').in('response_id', ids.slice(i, i + 200)); all.push(...(data || [])) }
  const byResp = {}
  for (const a of all) (byResp[a.response_id] = byResp[a.response_id] || {})[a.field] = a.file_name || (Array.isArray(a.value) ? a.value.join('; ') : a.value == null ? '' : String(a.value))
  const fields = [...new Set(all.map((a) => a.field))]
  const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'
  const head = ['id', 'form', 'who', 'started', 'finished', 'score', 'total', 'passed', ...fields]
  const lines = [head.map(esc).join(',')]
  for (const r of list) lines.push([r.id, r.form, who(r), r.started_at, r.completed_at || '', r.score ?? '', r.total ?? '', r.passed == null ? '' : r.passed, ...fields.map((f) => (byResp[r.id] || {})[f] ?? '')].map(esc).join(','))
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (form.value || 'responses') + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
</script>

<template>
  <div class="fr">
    <template v-if="cur">
      <div class="ui-cardrow"><button type="button" class="ui-crumb" @click="emit('back')">{{ W1.back }}</button></div>
      <div class="ui-card">
        <div class="ui-cardhead"><h3>{{ W1.heading }} · {{ cur.form }}</h3><span>{{ who(cur) }} · {{ W1.meta.replace('{started}', when(cur.started_at)).replace('{finished}', cur.completed_at ? when(cur.completed_at) : W1['not-finished']) }}</span></div>
        <p v-if="cur.total" class="fr-score"><b>{{ cur.score }} / {{ cur.total }}</b><span v-if="cur.passed != null" class="ui-pill" :class="cur.passed ? 'ui-ok' : 'ui-off'">{{ cur.passed ? 'passed' : 'not passed' }}</span></p>
        <table class="fr-table"><tbody>
          <tr v-for="a in answers" :key="a.field"><th>{{ question(cur.form, a.field) }}</th><td><a v-if="a.file_path && files[a.file_path]" :href="files[a.file_path]" target="_blank" rel="noopener">{{ a.file_name }}</a><span v-else>{{ show(a) }}</span></td><td class="fr-when">{{ when(a.answered_at) }}</td></tr>
        </tbody></table>
        <p v-if="cur.webhook_at || cur.webhook_error" class="ui-hint">{{ W1.webhook }}: {{ cur.webhook_at ? W1['webhook-sent'].replace('{at}', when(cur.webhook_at)) : W1['webhook-failed'].replace('{error}', cur.webhook_error) }}</p>
        <div class="ui-cardrow"><span class="ui-grow" /><button type="button" class="ui-btn ui-ghost ui-danger ui-sm" @click="remove">{{ W1.delete }}</button></div>
      </div>
    </template>
    <template v-else>
      <AdminHead :title="PAGE.title"><template #sub><span v-html="PAGE.lead" /></template>
        <template #afterTitle><span class="ui-count">{{ shown.length }}</span></template>
        <template #actions>
          <select v-model="form" class="ui-select fr-sel"><option value="">{{ W['all-forms'] }}</option><option v-for="f in formsList" :key="f" :value="f">{{ f }}</option></select>
          <select v-model="status" class="ui-select fr-sel"><option value="all">{{ W['status-all'] }}</option><option value="done">{{ W['status-done'] }}</option><option value="open">{{ W['status-open'] }}</option></select>
          <button type="button" class="ui-btn ui-ghost" :disabled="!shown.length" @click="exportCsv">{{ W.export }}</button>
        </template>
      </AdminHead>
      <p v-if="msg" class="ui-err">{{ msg }}</p>
      <p v-if="loading" class="ui-muted">…</p>
      <p v-else-if="!shown.length" class="ui-muted">{{ W.empty }}</p>
      <div v-else class="fr-grid">
        <AgGridVue class="fr-aggrid" :theme="theme" :row-data="shown" :column-defs="columnDefs" :default-col-def="defaultColDef" :get-row-id="getRowId"
                   :suppress-cell-focus="true" @row-clicked="emit('open', $event.data.id)" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.fr { display: flex; flex-direction: column; gap: 14px; width: 100%; flex: 1; min-height: 0 }
.fr-sel { max-width: 200px }
.fr-grid { flex: 1; min-height: 520px; display: flex }
.fr-aggrid { flex: 1; min-height: 0; width: 100% }
.fr-grid :deep(.ag-row) { cursor: pointer }
.fr-grid :deep(.fr-gform) { font-family: var(--m); font-size: 12.5px; color: var(--accent2) }
.fr-grid :deep(.fr-gopen) { color: var(--ink3) }
.fr-table { border-collapse: collapse; width: 100%; font-size: 13.5px } .fr-table th { text-align: left; font-weight: 600; padding: 8px 12px 8px 0; vertical-align: top; width: 34%; color: var(--ink2) } .fr-table td { padding: 8px 0; vertical-align: top; border-top: 1px solid var(--hair); white-space: pre-wrap } .fr-table th { border-top: 1px solid var(--hair) } .fr-when { font-family: var(--m); font-size: 11px; color: var(--ink3); white-space: nowrap; padding-left: 12px }
.fr-score { display: flex; align-items: center; gap: 10px; margin: 0 } .fr-score b { font-size: 22px }
</style>

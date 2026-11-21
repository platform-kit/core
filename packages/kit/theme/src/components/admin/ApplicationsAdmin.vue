<script setup lang="ts">
/*
 * SALES → APPLICATIONS (openspec: applications-and-intro-calls): the applications to the offers that ask for one,
 * newest first, each with who applied, what they answered and the call if they booked one. Approve opens checkout for
 * them (or lets them book a required call), Decline tells them, Close takes an open checkout back, Reopen gives a
 * closed or declined one another go; each can carry a note, which goes in the email. Words: checkout.md `## review`.
 */
import { ref, computed, onMounted } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { listApplications, decideApplication } from 'platformkit/lib/admissions.js'
import AdminHead from './AdminHead.vue'
import { products as PRODUCTS, forms as FORMS } from '#content'

const W = computed(() => ((us('checkout').review || {}).main || {}))
const fill = (s: string, v: Record<string, string>) => Object.entries(v).reduce((a, [k, x]) => a.split(`{${k}}`).join(x), s || '')
const items = ref<any[]>([])
const state = ref<'loading' | 'ok' | 'error'>('loading')
const fault = ref('')
const tab = ref<'waiting' | 'decided' | 'all'>('waiting')
const notes = ref<Record<string, string>>({})
const busy = ref('')
const WAITING = ['applied', 'booked']
async function load() {
  state.value = 'loading'
  try { items.value = await listApplications(); state.value = 'ok' } catch (e: any) { fault.value = e?.message || ''; state.value = 'error' }
}
onMounted(load)
const shown = computed(() => items.value.filter((x) => tab.value === 'all' || (tab.value === 'waiting' ? WAITING.includes(x.status) : !WAITING.includes(x.status))))
const counts = computed(() => ({ waiting: items.value.filter((x) => WAITING.includes(x.status)).length, decided: items.value.filter((x) => !WAITING.includes(x.status)).length, all: items.value.length }))
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const when = (iso: string) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
/* the answers as the form asked them: each question in its own words, in the form's order */
function answered(x: any) {
  const p = (PRODUCTS || []).find((o: any) => o.sku === x.sku)
  const form = p && p.before && p.before.apply ? (FORMS || []).find((o: any) => o.slug === p.before.apply) : null
  const fields: any[] = (form && form.model && form.model.fields) || []
  const at = (k: string) => { const i = fields.findIndex((f) => f.name === k); return i < 0 ? 999 : i }
  return [...x.answers].sort((a, b) => at(a.field) - at(b.field)).map((a) => ({ ...a, label: (fields.find((f) => f.name === a.field) || {}).question || a.field }))
}
const value = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v))
/* what may be done from each status (the paths in 47-admissions.sql) */
const acts = (s: string) => (s === 'applied' ? ['approve', 'decline'] : s === 'approved' || s === 'booked' ? ['approve', 'decline'] : s === 'open' ? ['close'] : s === 'declined' || s === 'closed' || s === 'expired' ? ['reopen'] : [])
async function act(x: any, a: any) {
  busy.value = x.id
  try { await decideApplication(x.id, a, notes.value[x.id] || ''); notes.value[x.id] = ''; await load() } catch (e: any) { fault.value = e?.message || '' } finally { busy.value = '' }
}
</script>

<template>
  <section class="apl">
    <AdminHead :title="W.title" :sub="W.subtitle">
      <template #actions>
        <div v-if="state === 'ok'" class="apl-seg">
          <button v-for="f in ['waiting', 'decided', 'all']" :key="f" type="button" :class="{ on: tab === f }" @click="tab = (f as any)">{{ W[f] }} <i>{{ (counts as any)[f] }}</i></button>
        </div>
      </template>
    </AdminHead>
    <p v-if="fault" class="apl-fault" role="alert">{{ fault }}</p>
    <p v-if="state === 'ok' && !shown.length" class="apl-empty">{{ W.empty }}</p>
    <ol v-if="state === 'ok' && shown.length" class="apl-list">
      <li v-for="x in shown" :key="x.id" class="apl-item">
        <header class="apl-head">
          <div>
            <h3 class="apl-who">{{ x.person.display_name || x.person.email }}</h3>
            <p class="apl-meta">{{ x.person.email }} · {{ x.offer }} · {{ fill(W.applied, { date: day(x.created_at) }) }}</p>
          </div>
          <span class="apl-status" :class="'is-' + x.status">{{ W['status-' + x.status] || x.status }}</span>
        </header>
        <dl v-if="x.answers.length" class="apl-answers">
          <template v-for="a in answered(x)" :key="a.field"><dt>{{ a.label }}</dt><dd>{{ value(a.value) }}</dd></template>
        </dl>
        <p class="apl-call">{{ W.call }}: {{ x.call ? when(x.call.start_at) : W['no-call'] }}</p>
        <p v-if="x.note" class="apl-note-was">“{{ x.note }}”</p>
        <div v-if="acts(x.status).length" class="apl-acts">
          <input v-model="notes[x.id]" class="apl-note" type="text" :placeholder="W.note" />
          <button v-for="a in acts(x.status)" :key="a" type="button" class="apl-btn" :class="'is-' + a" :disabled="busy === x.id" @click="act(x, a)">{{ W[a] }}</button>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.apl-fault { color: var(--danger, #b42318); font-size: 14px }
.apl-empty { color: var(--ink2); font-size: 14.5px }
.apl-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px }
.apl-item { padding: 18px 20px; border: 1px solid var(--hair); border-radius: 14px; background: var(--card, var(--paper)) }
.apl-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; position: static; padding: 0; margin: 0; background: none; border: 0; box-shadow: none; min-height: 0 }
.apl-seg { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--hair); border-radius: 999px; background: var(--paper) }
.apl-seg button { border: 0; background: transparent; color: var(--ink2); font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 999px; cursor: pointer }
.apl-seg button i { font-style: normal; color: var(--ink3); font-size: 11.5px; margin-left: 2px }
.apl-seg button.on { background: var(--ink); color: var(--paper) }
.apl-seg button.on i { color: var(--paper); opacity: .7 }
.apl-who { margin: 0; font-size: 16px; font-weight: 600 }
.apl-meta { margin: 3px 0 0; font-size: 13px; color: var(--ink2) }
.apl-status { flex: none; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink) }
.apl-status.is-open, .apl-status.is-used { background: color-mix(in srgb, #12807a 16%, transparent) }
.apl-status.is-declined, .apl-status.is-closed, .apl-status.is-expired { background: color-mix(in srgb, #b42318 12%, transparent) }
.apl-answers { margin: 14px 0 0; display: grid; grid-template-columns: minmax(160px, 260px) minmax(0, 1fr); gap: 8px 18px; font-size: 14px }
.apl-answers dt { color: var(--ink2); font-size: 13px; line-height: 1.4; padding-top: 1px }
.apl-answers dd { margin: 0; line-height: 1.45; white-space: pre-wrap }
.apl-call { margin: 12px 0 0; font-size: 13.5px; color: var(--ink2) }
.apl-note-was { margin: 8px 0 0; font-size: 13.5px; color: var(--ink2); font-style: italic }
.apl-acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px }
.apl-note { flex: 1 1 260px; min-width: 0; font: inherit; font-size: 13.5px; padding: 8px 12px; border: 1px solid var(--hair); border-radius: 8px; background: var(--paper); color: var(--ink) }
.apl-btn { font: inherit; font-size: 13.5px; font-weight: 600; padding: 8px 16px; border-radius: 999px; border: 1px solid var(--hair); background: transparent; color: var(--ink); cursor: pointer }
.apl-btn.is-approve, .apl-btn.is-reopen { background: var(--ink); color: var(--paper); border-color: var(--ink) }
.apl-btn:disabled { opacity: .55 }
@media (max-width: 620px) { .apl-answers { grid-template-columns: minmax(0, 1fr) } .apl-answers dd { margin-bottom: 6px } }
</style>

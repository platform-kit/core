<script setup>
/*
 * WHAT YOU OFFER — a provider's own surface for their own offerings, on the Coaching tab beside
 * their hours. Deliberately NOT the admin: what somebody sells of their own time is theirs to write,
 * and an administrator's page is for answering for the site, not for doing a provider's work.
 *
 * Every state is shown as what it means rather than as its word — a draft is theirs alone, one
 * waiting is being read, one live can be booked, a retired one cannot be booked again and every
 * booking already made still stands. The one thing they cannot do here is put something live where
 * the site reads new ones first; then the button asks for it to be read instead.
 *
 * Words: library.md coaching.offerings. Rows are their own under RLS; the standing (whether the site
 * allows this at all, and whether they are on terms they have agreed to) is one read, because none
 * of it is a browser's to work out.
 */
import { ref, computed, onMounted } from 'vue'
import { us } from '../strings.js'
import { supabase, configured } from '@platform-kit/kit/lib/supabase.js'
import { user } from '@platform-kit/kit/lib/auth.js'

const emit = defineEmits(['terms'])
const O = us('library').coaching.offerings || {}
/* the booker's word for a session that costs nothing, so the two surfaces never disagree about it */
const FREE = (us('library').coaching.booker || {}).free
const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))

const open = ref(false), loading = ref(true), error = ref(''), saving = ref(false), saved = ref(false)
const rows = ref([]), standing = ref(null), editing = ref(null), draft = ref(null)

const WHERES = computed(() => [
  ['none', O['where-none']], ['video', O['where-video']], ['link', O['where-link']],
  ['place', O['where-place']], ['phone', O['where-phone']],
])
const placeLabel = computed(() => (draft.value?.where === 'link' ? O['place-link'] : draft.value?.where === 'phone' ? O['place-phone'] : O.place))
const STATE = computed(() => ({ draft: O['state-draft'], waiting: O['state-waiting'], live: O['state-live'], retired: O['state-retired'] }))
const LINE = computed(() => ({ draft: O['draft-line'], waiting: O['waiting-line'], live: O['live-line'], retired: O['retired-line'] }))
/* the fold's one line: each state that is actually there, counted and named — never two of them
   rolled into one word, which read '2 draft' over one draft and one waiting */
const summary = computed(() => {
  if (loading.value) return ''
  if (!rows.value.length) return O.empty
  const order = ['live', 'waiting', 'draft', 'retired']
  return order
    .map((k) => [rows.value.filter((r) => r.state === k).length, STATE.value[k]])
    .filter(([n]) => n > 0)
    .map(([n, name]) => n + ' ' + String(name || '').toLowerCase())
    .join(' · ')
})
const money = (c, cur) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format((Number(c) || 0) / 100) } catch (e) { return '' } }

async function load() {
  if (!configured || !user.value) { loading.value = false; return }
  loading.value = true
  try {
    const [{ data: st }, { data }] = await Promise.all([
      supabase.rpc('provider_standing'),
      supabase.from('provider_offerings').select('*').order('created_at', { ascending: true }),
    ])
    standing.value = st || null
    rows.value = data || []
  } catch (e) { error.value = e.message } finally { loading.value = false }
}
onMounted(load)
/* the page reloads this after a signature, since what they may do has just changed */
defineExpose({ reload: load })

const blank = () => ({ id: null, title: '', sub: '', about: '', minutes: 60, price_cents: 0, currency: 'usd', where: 'none', place: '', state: 'draft' })
function add() { draft.value = blank(); editing.value = 'new'; open.value = true }
function edit(r) { draft.value = { ...r }; editing.value = r.id }
function cancel() { draft.value = null; editing.value = null }

/* a slug is made from the title and never typed: it is an address, not a thing to write */
const slugOf = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'session'

async function save() {
  if (!draft.value || !draft.value.title.trim()) return
  saving.value = true; error.value = ''
  const d = draft.value
  const row = {
    title: d.title.trim(), sub: d.sub || null, about: d.about || null,
    minutes: Math.max(5, Math.min(600, Number(d.minutes) || 60)),
    price_cents: Math.max(0, Math.round(Number(d.price_cents) || 0)),
    currency: d.currency || 'usd', where: d.where || 'none',
    place: ['link', 'place', 'phone'].includes(d.where) ? (d.place || null) : null,
  }
  try {
    if (d.id) { const { error: e } = await supabase.from('provider_offerings').update(row).eq('id', d.id); if (e) throw e }
    else { const { error: e } = await supabase.from('provider_offerings').insert({ ...row, provider_id: user.value.id, slug: slugOf(row.title) + '-' + Math.random().toString(36).slice(2, 6) }); if (e) throw e }
    saved.value = true; setTimeout(() => { saved.value = false }, 1800)
    cancel(); await load()
  } catch (e) { error.value = e.message || O.error } finally { saving.value = false }
}

async function move(r, state) {
  if (state === 'retired' && !window.confirm(O['retire-ask'])) return
  error.value = ''
  try { const { error: e } = await supabase.from('provider_offerings').update({ state }).eq('id', r.id); if (e) throw e; await load() }
  catch (e) { error.value = e.message || O.error }
}
/* what putting one out means here: on sale where the site takes their word for it, sent to be read
   where it does not */
const goLive = computed(() => (standing.value && standing.value.approve ? 'waiting' : 'live'))
const goLabel = computed(() => (standing.value && standing.value.approve ? O.submit : O.publish))
const maySell = computed(() => !standing.value || standing.value.may_sell !== false)
</script>

<template>
  <section v-if="standing && standing.provider && standing.offerings" class="po" :class="{ open }">
    <button type="button" class="po-head" :aria-expanded="open" @click="open = !open">
      <span class="po-title">{{ O.title }}</span>
      <span class="po-sum">{{ summary }}</span>
      <span class="po-btn">{{ open ? O.close : O.open }}</span>
    </button>
    <div v-if="open" class="po-body">
      <p class="po-lead">{{ O.lead }}</p>

      <!-- the one thing failing to sign stops, said where it bites and with the way out beside it -->
      <p v-if="!maySell" class="po-blocked">
        {{ O.blocked }}
        <button type="button" class="po-link" @click="emit('terms')">{{ O['blocked-read'] }}</button>
      </p>

      <ul v-if="rows.length" class="po-list">
        <li v-for="r in rows" :key="r.id" class="po-row" :class="['is-' + r.state, { editing: editing === r.id }]">
          <template v-if="editing !== r.id">
            <span class="po-chip" :class="'chip-' + r.state">{{ STATE[r.state] }}</span>
            <b class="po-name">{{ r.title }}</b>
            <span class="po-facts">{{ r.minutes }} {{ O['minutes-unit'] }} · {{ r.price_cents > 0 ? money(r.price_cents, r.currency) : FREE }}</span>
            <span class="po-line">{{ LINE[r.state] }}</span>
            <span class="po-acts">
              <button type="button" class="po-act" @click="edit(r)">{{ O.edit }}</button>
              <button v-if="r.state === 'draft'" type="button" class="po-act po-go" :disabled="!maySell && goLive === 'live'" @click="move(r, goLive)">{{ goLabel }}</button>
              <button v-if="r.state === 'live' || r.state === 'waiting'" type="button" class="po-act" @click="move(r, 'retired')">{{ O.retire }}</button>
              <button v-if="r.state === 'retired'" type="button" class="po-act" @click="move(r, 'draft')">{{ O.unretire }}</button>
            </span>
          </template>

          <form v-else class="po-form" @submit.prevent="save">
            <label class="po-field po-wide"><span>{{ O.name }}</span><input v-model="draft.title" type="text" maxlength="120" required /></label>
            <label class="po-field po-wide"><span>{{ O.sub }}</span><input v-model="draft.sub" type="text" maxlength="160" /></label>
            <label class="po-field po-wide"><span>{{ O.about }}</span><textarea v-model="draft.about" rows="3" :placeholder="O['about-hint']"></textarea></label>
            <label class="po-field"><span>{{ O.minutes }}</span><span class="po-num"><input v-model.number="draft.minutes" type="number" min="5" max="600" step="5" /><small>{{ O['minutes-unit'] }}</small></span></label>
            <label class="po-field"><span>{{ O.price }}</span><span class="po-num"><input :value="(draft.price_cents / 100).toFixed(2)" type="number" min="0" step="1" @input="draft.price_cents = Math.round(Number($event.target.value || 0) * 100)" /><small>{{ (draft.currency || 'usd').toUpperCase() }}</small></span></label>
            <label class="po-field"><span>{{ O.where }}</span><select v-model="draft.where"><option v-for="[k, label] in WHERES" :key="k" :value="k">{{ label }}</option></select></label>
            <label v-if="['link', 'place', 'phone'].includes(draft.where)" class="po-field po-wide"><span>{{ placeLabel }}</span><input v-model="draft.place" type="text" maxlength="200" /></label>
            <div class="po-save">
              <button type="submit" class="po-primary" :disabled="saving">{{ saving ? O.saving : O.save }}</button>
              <button type="button" class="po-act" @click="cancel">{{ O.cancel }}</button>
            </div>
          </form>
        </li>
      </ul>

      <form v-if="editing === 'new'" class="po-form po-new" @submit.prevent="save">
        <label class="po-field po-wide"><span>{{ O.name }}</span><input v-model="draft.title" type="text" maxlength="120" required autofocus /></label>
        <label class="po-field po-wide"><span>{{ O.sub }}</span><input v-model="draft.sub" type="text" maxlength="160" /></label>
        <label class="po-field po-wide"><span>{{ O.about }}</span><textarea v-model="draft.about" rows="3" :placeholder="O['about-hint']"></textarea></label>
        <label class="po-field"><span>{{ O.minutes }}</span><span class="po-num"><input v-model.number="draft.minutes" type="number" min="5" max="600" step="5" /><small>{{ O['minutes-unit'] }}</small></span></label>
        <label class="po-field"><span>{{ O.price }}</span><span class="po-num"><input :value="(draft.price_cents / 100).toFixed(2)" type="number" min="0" step="1" @input="draft.price_cents = Math.round(Number($event.target.value || 0) * 100)" /><small>{{ (draft.currency || 'usd').toUpperCase() }}</small></span></label>
        <label class="po-field"><span>{{ O.where }}</span><select v-model="draft.where"><option v-for="[k, label] in WHERES" :key="k" :value="k">{{ label }}</option></select></label>
        <label v-if="['link', 'place', 'phone'].includes(draft.where)" class="po-field po-wide"><span>{{ placeLabel }}</span><input v-model="draft.place" type="text" maxlength="200" /></label>
        <div class="po-save">
          <button type="submit" class="po-primary" :disabled="saving">{{ saving ? O.saving : O.save }}</button>
          <button type="button" class="po-act" @click="cancel">{{ O.cancel }}</button>
        </div>
      </form>

      <p v-else-if="!rows.length && !loading" class="po-empty">{{ O.empty }}</p>
      <button v-if="editing !== 'new'" type="button" class="po-add" @click="add">{{ O.new }}</button>
      <transition name="po-fade"><i v-if="saved" class="po-saved">{{ O.saved }}</i></transition>
      <em v-if="error" class="po-err">{{ error }}</em>
    </div>
  </section>
</template>

<style scoped>
.po { border: 1px solid var(--qhair); border-radius: 14px; background: var(--qcard); margin: 0 0 var(--s3); padding: 0; overflow: hidden }   /* padding 0: the global stylesheet gives a section its own */
.po-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; width: 100%; font: inherit; text-align: left; padding: 14px 16px; background: none; border: 0; color: var(--qink); cursor: pointer }
.po-title { font-weight: 700; font-size: 15px }
.po-sum { font-size: 13px; color: var(--qink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.po-btn { font-size: 13px; color: var(--qink2); padding: 6px 12px; border: 1px solid var(--qhair); border-radius: 999px; white-space: nowrap }
.po-body { padding: 4px 16px 16px; border-top: 1px dashed var(--qhair) }
.po-lead { font-size: 13.5px; color: var(--qink3); margin: 10px 0 14px }
.po-blocked { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; font-size: 13.5px; color: var(--qink2); margin: 0 0 14px; padding: 10px 12px; border: 1px dashed var(--qhair); border-radius: 10px }
.po-link { font: inherit; background: none; border: 0; padding: 0; color: var(--qink); text-decoration: underline; cursor: pointer }
.po-list { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 8px }
/* a row says its state, its name, its facts and what that state MEANS — the last is the part a word
   alone leaves somebody guessing at */
.po-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: 'chip name acts' 'line facts facts'; gap: 4px 10px; align-items: center;
  padding: 12px 14px; border: 1px solid var(--qhair); border-radius: 12px; background: var(--qcard) }
.po-row.is-retired { opacity: .6 }
.po-row.editing { display: block }
.po-chip { grid-area: chip; font-family: var(--m); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; background: color-mix(in srgb, var(--qink) 8%, transparent); color: var(--qink2); white-space: nowrap }
.chip-live { background: color-mix(in srgb, var(--c1, #ffe852) 45%, transparent); color: var(--qink) }
.chip-waiting { background: color-mix(in srgb, var(--c2, #ffb347) 30%, transparent); color: var(--qink) }
.po-name { grid-area: name; font-size: 15px; font-weight: 600; color: var(--qink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.po-facts { grid-area: facts; font-family: var(--m); font-size: 11.5px; color: var(--qink3); justify-self: end }
.po-line { grid-area: line; font-size: 12.5px; color: var(--qink3); grid-column: 1 / 3 }
.po-acts { grid-area: acts; display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end }
.po-act { font: inherit; font-size: 12.5px; padding: 5px 11px; border: 1px solid var(--qhair); border-radius: 999px; background: none; color: var(--qink2); cursor: pointer }
.po-act:hover { border-color: var(--qink3); color: var(--qink) }
.po-act[disabled] { opacity: .45; cursor: default }
.po-go { border-color: color-mix(in srgb, var(--qink) 40%, transparent); color: var(--qink) }
.po-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px 12px; padding: 12px 0 }
.po-new { border-top: 1px dashed var(--qhair); margin-top: 4px }
.po-wide { grid-column: 1 / -1 }
.po-field { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--qink3) }
.po-field input, .po-field select, .po-field textarea { font: inherit; font-size: 14px; color: var(--qink); padding: 9px 11px; border: 1px solid var(--qhair); border-radius: 9px; background: var(--qbg, transparent); width: 100% }
.po-field textarea { resize: vertical; line-height: 1.5 }
.po-num { display: flex; align-items: center; gap: 8px }
.po-num small { font-family: var(--m); font-size: 11px; color: var(--qink3); white-space: nowrap }
.po-save { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; margin-top: 2px }
.po-primary { font: inherit; font-size: 13.5px; padding: 9px 18px; border: 0; border-radius: 999px; background: var(--qink); color: var(--qcard); cursor: pointer }
.po-primary[disabled] { opacity: .5; cursor: default }
.po-add { font: inherit; font-size: 13px; padding: 8px 15px; border: 1px dashed var(--qhair); border-radius: 999px; background: none; color: var(--qink2); cursor: pointer }
.po-add:hover { border-style: solid; color: var(--qink) }
.po-empty { font-size: 13.5px; color: var(--qink3); margin: 0 0 12px }
.po-saved { font-style: normal; font-size: 12.5px; color: var(--qink3); margin-left: 10px }
.po-err { display: block; font-style: normal; font-size: 12.5px; color: var(--c3, #fc5151); margin-top: 8px }
.po-fade-enter-active, .po-fade-leave-active { transition: opacity .25s }
.po-fade-enter-from, .po-fade-leave-to { opacity: 0 }
@media (max-width: 560px) { .po-row { grid-template-columns: 1fr; grid-template-areas: 'chip' 'name' 'facts' 'line' 'acts' } .po-facts { justify-self: start } .po-acts { justify-content: flex-start } }
@media (max-width: 640px) { .po-head { grid-template-columns: minmax(0, 1fr) auto } .po-title { grid-row: 1 } .po-btn { grid-row: 1; grid-column: 2; justify-self: end } .po-sum { grid-column: 1 / -1; grid-row: 2; white-space: normal } }
</style>

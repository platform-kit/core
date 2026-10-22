<script setup>
/*
 * Bookings — every session cal.com mirrored into bookings (the webhook's projection: the attendee,
 * the coach, the time, what became of it), upcoming first and then the past, read with the admin's
 * own session (RLS: an administrator sees every booking) and moving as cal.com sends (the table is
 * in the realtime publication). Who is who comes from the row's addresses and, for an account, its
 * profile through admin_people. The type is the session record whose cal.com url ends in the row's
 * event slug, else the row's title. Words are content/app/ui/orders.md, the `bookings` group.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { supabase, configured } from 'platformkit/lib/supabase.js'
import { isSignedIn, onIdentity } from 'platformkit/lib/auth.js'
import { sessions as SESSIONS, forms as FORMS } from '#content'
import { recordingFor, fetchAgain } from 'platformkit/lib/recordings.js'
import { placeOf, eventOfType, schedulerOf } from 'platformkit/lib/booking.js'
import SessionBooker from '../instrument/ui/results/SessionBooker.vue'
import AdminHead from './admin/AdminHead.vue'

const T = us('orders')
/* where a native session happens, worded by the booker's lines (the library scope) */
const BW = (us('library').coaching || {}).booker || {}
const placeLine = (r) => placeOf(r.where, BW)
/* the other addresses on a booking a host made for several */
const others = (r) => (r.attendee_emails || []).filter((e) => e && e.toLowerCase() !== String(r.email || '').toLowerCase())
/* a host books for people from the desk too: the booker in its host mode over every published type */
const booking = ref(false)
const hostOptions = computed(() => (SESSIONS || []).filter((s) => s.published !== false).sort((a, b) => (a.order || 99) - (b.order || 99)).map((s) => ({ ...s, event: eventOfType(s), scheduler: schedulerOf(s), blocked: false, paid: false, credits: 0 })))
const fillW = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const H = T.bookings.head, ST = T.bookings.status, RF = T.bookings.refused, R = T.bookings.row
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))

/* a call's recording on the desk: watched or downloaded from a signed url (session-files), fetched again when a pull failed */
const media = ref({}), mediaBusy = ref(''), watching = ref(null)
async function open(r, what) {
  mediaBusy.value = r.uid
  try {
    const m = media.value[r.uid] || (await recordingFor(r.uid)); media.value = { ...media.value, [r.uid]: m }
    if (what === 'watch') watching.value = watching.value === r.uid ? null : r.uid
    else if (what === 'download' && m.recording) window.open(m.recording, '_blank', 'noopener')
    else if (what === 'transcript' && m.transcript) window.open(m.transcript, '_blank', 'noopener')
  } catch (e) { media.value = { ...media.value, [r.uid]: { error: e.message } } } finally { mediaBusy.value = '' }
}
async function retry(r) { mediaBusy.value = r.uid; try { const out = await fetchAgain(r.uid); const i = rows.value.findIndex((x) => x.uid === r.uid); if (i >= 0) rows.value[i] = { ...rows.value[i], recording_state: out.state === 'pulled' ? null : out.state, recording_error: out.error || null, recording_path: out.state === 'pulled' ? r.uid + '/recording.mp4' : rows.value[i].recording_path } } catch (e) { /* the row says */ } finally { mediaBusy.value = '' } }
const state = ref('idle')      /* idle | loading | ok | denied | error */
const rows = ref([])
const people = ref({})
const tab = ref('upcoming')
let channel = null

async function load() {
  if (!configured || !isSignedIn.value) { state.value = 'idle'; rows.value = []; return }
  state.value = 'loading'
  const { data, error } = await supabase.from('bookings').select('*').order('start_at', { ascending: false }).limit(500)
  if (error) { state.value = (error.code === '42501' || /permission/i.test(error.message || '')) ? 'denied' : 'error'; return }
  rows.value = data || []
  loadAnswers(rows.value)
  await names(rows.value)
  state.value = 'ok'
  listen()
}
async function names(list) {
  const ids = [...new Set(list.flatMap((r) => [r.user_id, r.provider_id]).filter((id) => id && !people.value[id]))]
  if (!ids.length) return
  const { data } = await supabase.rpc('admin_people', { ids })
  for (const p of data || []) people.value[p.id] = p
}
function listen() {
  if (channel || !supabase) return
  channel = supabase.channel('bookings').on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, async (p) => {
    if (p.eventType === 'DELETE') { rows.value = rows.value.filter((r) => r.uid !== p.old.uid); return }
    const i = rows.value.findIndex((r) => r.uid === p.new.uid)
    if (i >= 0) rows.value.splice(i, 1, p.new); else rows.value.unshift(p.new)
    await names([p.new])
  }).subscribe()
}
onMounted(load)
onIdentity(load)
onBeforeUnmount(() => { if (channel) supabase.removeChannel(channel); channel = null })

/* what became of it: refused and no-show first (they say more than the status), then the status, an accepted one ahead as upcoming */
const now = () => Date.now()
const isUpcoming = (r) => r.status === 'accepted' && r.start_at && new Date(r.start_at).getTime() > now()
const stateOf = (r) => (r.refused ? 'refused' : r.no_show ? 'no-show' : isUpcoming(r) ? 'upcoming' : r.status === 'accepted' ? 'ended' : r.status)
const stateWord = (r) => { const k = stateOf(r); const w = ST[k] || k; return k === 'refused' && RF[r.refused] ? `${w} · ${RF[r.refused]}` : w }

const upcoming = computed(() => rows.value.filter(isUpcoming).sort((a, b) => new Date(a.start_at) - new Date(b.start_at)))
const past = computed(() => rows.value.filter((r) => !isUpcoming(r)))
const shown = computed(() => (tab.value === 'upcoming' ? upcoming.value : tab.value === 'past' ? past.value : [...upcoming.value, ...past.value]))
const counts = computed(() => ({ upcoming: upcoming.value.length, past: past.value.length, all: rows.value.length }))

/* the booking type: the session record whose cal.com link ends in the event slug the webhook recorded */
const typeOf = (r) => { const s = (SESSIONS || []).find((x) => (r.type && x.slug === r.type) || (x.url && r.event && String(x.url).split('?')[0].replace(/\/+$/, '').endsWith('/' + r.event))); return (s && s.title) || r.title || r.event || '—' }
const who = (id) => (id && people.value[id]) || null
const attendee = (r) => { const p = who(r.user_id); return p ? { name: p.name, email: p.email, account: true } : { name: r.name || '', email: r.email || (r.attendee_emails || [])[0] || '', account: false } }
const coach = (r) => { const p = who(r.provider_id); return p ? p.name + (p.email ? ' · ' + p.email : '') : r.provider_email || '—' }
const when = (d) => { const t = new Date(d); return isNaN(t) ? '' : t.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
/*
 * WHAT THEY ANSWERED ON THE WAY IN. A type may ask a form's questions before the booking is made,
 * and the host needs them where they are looking at the booking rather than in the forms section
 * under a name they would have to match up themselves. Fetched for the rows that have one only —
 * most bookings ask nothing, and a join would cost every row for the few that do.
 */
const answers = ref({})
/* THE QUESTION AS IT WAS ASKED. An answer is stored against the field's key, and a key is not a
   question: the form document has the words, so the desk shows those and falls back to the key
   only for a field that has since been renamed away. */
function labelOf(slug, field) {
  const doc = (FORMS || []).find((x) => x.slug === slug)
  const found = ((doc && doc.model && doc.model.fields) || []).find((x) => x.name === field)
  const q = found && (found.question || (found.params && found.params.question))
  return q && q !== '...' ? q : field
}
/* and in the order the form asks them, not the order the rows came back */
function orderOf(slug) {
  const doc = (FORMS || []).find((x) => x.slug === slug)
  return ((doc && doc.model && doc.model.fields) || []).map((x) => x.name)
}
async function loadAnswers(rows) {
  const ids = [...new Set((rows || []).map((r) => r.response_id).filter(Boolean))]
  if (!ids.length) { answers.value = {}; return }
  const { data: resp } = await supabase.from('form_responses').select('id, form').in('id', ids)
  const formOf = Object.fromEntries((resp || []).map((r) => [r.id, r.form]))
  const { data } = await supabase.from('form_answers').select('response_id, field, value, file_name').in('response_id', ids)
  const by = {}
  for (const a of data || []) {
    const v = a.file_name ? a.file_name : Array.isArray(a.value) ? a.value.join(', ') : a.value && typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value ?? '')
    ;(by[a.response_id] ||= []).push({ key: a.field, label: labelOf(formOf[a.response_id], a.field), value: v })
  }
  for (const [id, list] of Object.entries(by)) { const o = orderOf(formOf[id]); list.sort((x, y) => (o.indexOf(x.key) + 1 || 99) - (o.indexOf(y.key) + 1 || 99)) }
  answers.value = by
}
const answersOf = (r) => (r.response_id && answers.value[r.response_id]) || []
const minutes = (r) => { const a = new Date(r.start_at), b = new Date(r.end_at); const n = Math.round((b - a) / 60000); return n > 0 ? fill(R.minutes, { n }) : '' }
function openAuth() { if (window.DLauth) window.DLauth.open() }
</script>

<template>
  <div class="ui-page po">
    <AdminHead :title="H.title" :sub="H.subtitle">
      <template #actions>
        <div v-if="state === 'ok'" class="po-seg">
          <button v-for="f in ['upcoming', 'past', 'all']" :key="f" type="button" :class="{ on: tab === f }" @click="tab = f">{{ H['tab-' + f] }} <i>{{ counts[f] }}</i></button>
          <button type="button" class="po-refresh" @click="load">{{ H.refresh }}</button>
          <button type="button" class="po-refresh po-new" @click="booking = !booking">{{ booking ? R['new-close'] : R.new }}</button>
        </div>
      </template>
    </AdminHead>

    <div v-if="state === 'idle'" class="po-note">
      <h2>{{ T.page.head['signin-heading'] }}</h2><p>{{ T.page.head['signin-subtitle'] }}</p>
      <button type="button" class="po-cta" @click="openAuth">{{ T.page.head['signin-cta'] }}</button>
    </div>
    <div v-else-if="state === 'denied'" class="po-note"><h2>{{ T.page.head['denied-heading'] }}</h2><p>{{ T.page.head['denied-subtitle'] }}</p></div>
    <div v-else-if="state === 'error'" class="po-note"><h2>{{ T.page.head['error-heading'] }}</h2><p>{{ T.page.head['error-subtitle'] }}</p></div>
    <p v-else-if="state === 'loading'" class="po-loading">{{ H.loading }}</p>

    <template v-else-if="state === 'ok'">
      <div v-if="booking" class="po-booker"><SessionBooker key="desk-host" host :options="hostOptions" @booked="load" /></div>
      <p v-if="!shown.length" class="po-empty">{{ H['empty-' + tab] }}</p>
      <ul v-else class="po-list">
        <li v-for="r in shown" :key="r.uid" class="po-row" :class="'st-' + stateOf(r)">
          <div class="po-main">
            <div class="po-top">
              <span class="po-status" :class="'st-' + stateOf(r)">{{ stateWord(r) }}</span>
              <b class="po-book">{{ typeOf(r) }}</b>
              <span v-if="minutes(r)" class="po-qty">{{ minutes(r) }}</span>
              <span v-if="r.credit_id" class="po-credit">{{ R.credit }}</span>
              <span v-if="r.made_by_name" class="po-tag">{{ fillW(R['by-host'], { name: r.made_by_name }) }}</span>
              <span v-if="r.provider === 'native'" class="po-tag">{{ R['scheduled-here'] }}</span>
              <span class="po-when">{{ when(r.start_at) }}</span>
            </div>
            <dl class="po-facts">
              <div><dt>{{ R.attendee }}</dt><dd>{{ attendee(r).name || attendee(r).email || '—' }}<i v-if="attendee(r).name && attendee(r).email"> · {{ attendee(r).email }}</i><i v-if="!attendee(r).account"> · {{ R['no-account'] }}</i><template v-for="e in others(r)" :key="e"><br /><span>{{ e }}</span></template></dd></div>
              <div><dt>{{ R.provider }}</dt><dd>{{ coach(r) }}</dd></div>
              <div v-if="placeLine(r)"><dt>{{ R.where }}</dt><dd>{{ placeLine(r) }}</dd></div>
              <div v-if="isUpcoming(r) && r.join_url"><dt>{{ R.join }}</dt><dd><a :href="r.join_url" target="_blank" rel="noopener">{{ r.join_url }}</a></dd></div>
              <div v-if="r.recording_path || r.recording_state"><dt>{{ R.recording }}</dt><dd class="po-rec">
                <template v-if="r.recording_path"><button type="button" class="po-link" :disabled="mediaBusy === r.uid" @click="open(r, 'watch')">{{ R['recording-watch'] }}</button> · <button type="button" class="po-link" :disabled="mediaBusy === r.uid" @click="open(r, 'download')">{{ R['recording-download'] }}</button><template v-if="r.transcript_path"> · <button type="button" class="po-link" :disabled="mediaBusy === r.uid" @click="open(r, 'transcript')">{{ R.transcript }}</button></template></template>
                <template v-else-if="r.recording_state === 'pending'">{{ R['recording-pending'] }}<i v-if="r.recording_error"> · {{ r.recording_error }}</i></template>
                <template v-else-if="r.recording_state === 'failed'"><b class="po-bad">{{ R['recording-failed'] }}</b><i v-if="r.recording_error"> · {{ r.recording_error }}</i> · <button type="button" class="po-link" :disabled="mediaBusy === r.uid" @click="retry(r)">{{ R['recording-retry'] }}</button></template>
                <template v-else-if="r.recording_state === 'removed'">{{ fill(R['recording-kept'], { n: r.recording_error }) }}</template>
              </dd></div>
            </dl>
            <!-- THE ANSWERS THEY GAVE ON THE WAY IN, where the host is already looking rather than
                 in the forms section under a name they would have to match up themselves -->
            <dl v-if="answersOf(r).length" class="po-facts po-answers">
              <div v-for="(a, i) in answersOf(r)" :key="i"><dt>{{ a.label }}</dt><dd>{{ a.value || '—' }}</dd></div>
            </dl>
            <div v-if="watching === r.uid && media[r.uid]" class="po-player"><video v-if="media[r.uid].recording" controls preload="metadata" :src="media[r.uid].play || media[r.uid].recording" /><i v-else>{{ media[r.uid].error }}</i></div>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.po { color: var(--ink) }
.po-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 22px }
.po-title { font-family: var(--fd); font-weight: 600; font-size: 34px; letter-spacing: -.02em; margin: 0 0 6px }
.po-subtitle { margin: 0; color: var(--ink2); font-size: 15px }
.po-seg { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--hair); border-radius: 999px; background: var(--card); flex-wrap: wrap }
.po-seg button { border: 0; background: transparent; color: var(--ink2); font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 999px; cursor: pointer }
.po-seg button i { font-style: normal; color: var(--ink3); font-size: 11.5px; margin-left: 2px }
.po-seg button.on { background: var(--ink); color: var(--paper) } .po-seg button.on i { color: var(--paper); opacity: .7 }
.po-refresh { color: var(--accent2) !important }
.po-note { max-width: 520px; margin: 40px auto; text-align: center; padding: 34px 28px; border: 1px solid var(--hair); border-radius: 18px; background: var(--card) }
.po-note h2 { font-family: var(--fd); font-weight: 600; font-size: 24px; margin: 0 0 8px } .po-note p { color: var(--ink2); margin: 0 0 16px }
.po-cta { border: 0; background: var(--ink); color: var(--paper); font: inherit; padding: 10px 18px; border-radius: 999px; cursor: pointer }
.po-loading, .po-empty { color: var(--ink3); text-align: center; padding: 40px 0 }
.po-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px }
.po-row { display: flex; gap: 20px; align-items: flex-start; padding: 18px 20px; border: 1px solid var(--hair); border-radius: 14px; background: var(--card) }
.po-main { flex: 1; min-width: 0 }
.po-top { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 10px }
.po-book { font-family: var(--fd); font-size: 17px; font-weight: 600 }
.po-qty { color: var(--ink2); font-size: 13px } .po-when { color: var(--ink3); font-size: 12.5px; margin-left: auto }
.po-credit { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--accent2); color: var(--accent2) }
.po-booker { margin: 0 0 18px; --qink: var(--ink); --qink2: var(--ink2); --qink3: var(--ink3); --qhair: var(--hair); --qcard: var(--card); --qpaper: var(--paper); --qflip: var(--paper); --qaccent: var(--accent2) }   /* the booker wears the instrument's tokens; on the desk they are the admin's */
.po-tag { font-family: var(--m); font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--hair); color: var(--ink3) }
.po-status { font-family: var(--m); font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--hair); color: var(--ink2) }
.po-status.st-upcoming { border-color: var(--accent2); color: var(--accent2) }
.po-status.st-ended { border-color: #3a8f5c; color: #3a8f5c }
.po-status.st-cancelled, .po-status.st-rejected, .po-status.st-refused, .po-status.st-no-show { border-color: #b45309; color: #b45309 }
.po-link { font: inherit; font-size: 13px; color: var(--accent2); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px } .po-link:disabled { opacity: .5 }
.po-rec i { color: var(--ink3); font-style: normal; font-size: 12.5px } .po-bad { color: #b3261e; font-weight: 600 }
.po-player { margin-top: 12px } .po-player video { display: block; width: 100%; max-width: 720px; max-height: 60vh; border-radius: 10px; background: #000 }
.po-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px 22px; margin: 0 }
.po-answers { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--hair) }
.po-facts div { min-width: 0 } .po-facts dt { font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); margin-bottom: 3px }
.po-facts dd { margin: 0; font-size: 13.5px; line-height: 1.45; overflow-wrap: anywhere } .po-facts dd i { font-style: normal; color: var(--ink3) }
.po-facts dd a { color: var(--accent2) }
</style>

<script setup>
/*
 * Booking a session in the app, in two questions: WHAT (a splash of the ways to
 * book, when there is more than one — the call, what it includes or costs, a
 * used-up one saying when it is back) and then WHEN (the chosen call's facts on
 * the left with a way back, a month of open days, the day's times), then one
 * confirm step (a note, the cost line) and the booked screen. No coach is named
 * here — the call is with whoever cal.com assigns, and a team page is for that.
 *
 * Underneath it is ours: open times through session-slots, the booking through
 * book-session (which checks the tier and the allowance before anything exists);
 * a paid session goes to checkout with the chosen time and is booked when the
 * payment lands, or — holding a credit — is booked here directly. `moving` is the
 * uid of a session being rescheduled: straight to WHEN on its option, and the
 * same call with `reschedule`. Words: content/app/ui/library.md, coaching.booker.
 */
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import FormRun from '../../../components/forms/FormRun.vue'
import { forms as FORMS } from '#content'
import { us } from '../strings.js'
import { openTimes, bookSession, bookForOthers, placeOf } from '@platform-kit/kit/lib/booking.js'
import { shows, lengthsOf } from '@platform-kit/kit/supabase/functions/_shared/sessions/page.js'
import { payAndBook, money } from '@platform-kit/kit/lib/commerce.js'
import { refreshEntitlements, isSignedIn } from '@platform-kit/kit/lib/auth.js'

/* host: a host booking for people — every option offered, the invitees named, no judge and nothing paid */
const props = defineProps({ options: { type: Array, default: () => [] }, moving: { type: Object, default: null }, host: { type: Boolean, default: false }, requireAuthToBook: { type: Boolean, default: true } })
const emit = defineEmits(['booked', 'moved', 'back'])
const B = us('library').coaching.booker || {}
const C = us('library').coaching.page || {}
const HW = us('library').coaching.host || {}
/* the invitees, a host's rows of addresses */
const invitees = ref([''])
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim())
const cleanInvitees = computed(() => invitees.value.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))
function addInvitee() { invitees.value = [...invitees.value, ''] }
function dropInvitee(i) { invitees.value = invitees.value.filter((_, j) => j !== i); if (!invitees.value.length) invitees.value = [''] }

/* what: the chosen option; a single option, or a move, skips the splash */
const picked = ref(props.moving ? (props.options.find((o) => o.event === props.moving.event) || null) : props.options.length === 1 ? props.options[0] : null)
const option = computed(() => picked.value)
const many = computed(() => props.options.length > 1 && !props.moving)
const step = ref(picked.value ? 'when' : 'what')   /* what | when | questions | confirm | busy | done */

/* the reader's zone, changeable; every time shown is in it */
const zones = (() => { try { return Intl.supportedValuesOf('timeZone') } catch (e) { return [] } })()
const zone = ref((() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch (e) { return 'UTC' } })())

/* when: the month in view and what is open in it */
const first = new Date(); first.setDate(1); first.setHours(0, 0, 0, 0)
const month = ref(new Date(first))
const open = ref({})
const minutes = ref(0)
const loading = ref(false)
const day = ref('')
const slot = ref('')
const pendingAuth = ref(false)
const notes = ref('')
const guestEmail = ref('')
const phone = ref('')   /* a session by phone with no number of its own asks the reader's */
const error = ref('')
const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
/* where the session happens, from the type — a video call, a link, a place, a phone, or nothing said */
const whereFact = computed(() => (option.value ? placeOf(option.value, B) : ''))
const asksPhone = computed(() => !!option.value && option.value.where === 'phone' && !option.value.phone && !props.moving)
const done = ref(null)

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monthName = computed(() => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(month.value))
const weekdays = computed(() => { const base = new Date(2024, 0, 7); return [...Array(7)].map((_, i) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(base.getTime() + i * 864e5))) })
const cells = computed(() => {
  const m = month.value, n = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate(), lead = m.getDay(), today = ymd(new Date())
  return [...Array(lead).fill(null), ...[...Array(n)].map((_, i) => { const k = ymd(new Date(m.getFullYear(), m.getMonth(), i + 1)); return { k, n: i + 1, open: !!(open.value[k] && open.value[k].length), today: k === today } })]
})
const times = computed(() => (day.value && open.value[day.value]) || [])
const canBack = computed(() => month.value > first)
/* WHAT THIS TYPE'S PAGE SHOWS, and where a booking sends them — the type's own switches, read
   through the same pure module the functions read them through (_shared/sessions/page.js), so the
   page and the refusal cannot disagree. */
const page = computed(() => (option.value && option.value.page) || {})
const showNotes = computed(() => shows(option.value, 'notes'))
const showOrganiser = computed(() => shows(option.value, 'organiser'))
const showDetails = computed(() => shows(option.value, 'details'))
const showZone = computed(() => shows(option.value, 'zone'))
/* WHERE A BOOKING SENDS THEM, when the type names somewhere other than its own confirmation — a
   path on this site or a url of their own (a thank-you page, a questionnaire, a course). The
   confirmation is drawn first either way, so a redirect that fails leaves them somewhere sensible
   rather than on a blank page. */
function sendOn() {
  const to = String(page.value.redirect || '')
  if (!to) return
  if (to.startsWith('/')) window.location.assign(to)
  else window.location.href = to
}
/* HOW MANY SEATS ARE LEFT at each time, where the type says to show it. It is a nudge and a
   warning at once — "2 left" moves somebody, "Last seat" moves them more — and it is the
   scheduler's count rather than one made here, so the number on the button is the number the
   booking will be checked against. */
/* HOW LONG, where the type offers a choice. It sits in the side panel beside the length rather
   than as a step of its own: it is one tap, it changes which times are open, and a step for it
   would put a page between somebody and the calendar they came for. */
const lengths = computed(() => lengthsOf(option.value))
const chosen = ref(0)
watch(option, (o) => { const l = lengthsOf(o); chosen.value = l.length ? l[0].minutes : 0 }, { immediate: true })
watch(chosen, () => { if (step.value !== 'what') { day.value = ''; slot.value = ''; load() } })
/* A RUN, where the type offers one: how many, one tap, beside How long. The calendar answers for
   the run as a whole — a start is only offered where every session of it is free — so changing the
   number changes which days are open, and the number shown is the number that will be booked. */
const runs = computed(() => { const r = option.value && option.value.repeat; if (!r) return []; const most = r.most || r.count; const out = []; for (let i = 1; i <= most; i++) if (i === 1 || i >= r.count) out.push(i); return out })
const runCount = ref(0)
watch(option, (o) => { runCount.value = (o && o.repeat) ? o.repeat.count : 0 }, { immediate: true })
watch(runCount, () => { if (step.value !== 'what') { day.value = ''; slot.value = ''; load() } })
const runEvery = computed(() => { const e = (option.value && option.value.repeat && option.value.repeat.every) || 'week'; return B['run-every-' + e] || '' })
const seatsLeft = ref({})
const leftAt = (iso) => seatsLeft.value[iso]
const anyOpen = computed(() => Object.values(open.value).some((l) => l.length))
/* WHY A MONTH IS EMPTY. An empty calendar with no word looks broken, and the reader's next move
   depends entirely on which of these it is: turn the page, come back later, or write and ask. The
   scheduler says which; this says it in the site's own words, and falls back to the plain line for
   anything it has no word for. */
const why = ref(null)
const whyNone = computed(() => {
  const w = why.value
  if (!w) return B['none-month']
  const said = B['none-' + w.kind]
  if (!said) return B['none-month']
  const when = w.from || w.to
  return when ? said.replace('{date}', dayOf(when)) : said
})
const at = (iso, opts) => { try { return new Intl.DateTimeFormat(undefined, { timeZone: zone.value, ...opts }).format(new Date(iso)) } catch (e) { return iso } }
const timeOf = (iso) => at(iso, { hour: 'numeric', minute: '2-digit' })
const whenOf = (iso) => at(iso, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const dayOf = (k) => at(k + 'T12:00:00', { weekday: 'long', day: 'numeric', month: 'long' })
const soon = (iso) => { try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(iso)) } catch (e) { return '' } }

async function load() {
  if (!option.value) return
  loading.value = true; error.value = ''
  const m = month.value
  const from = ymd(new Date(Math.max(m.getTime(), first.getTime()))), to = ymd(new Date(m.getFullYear(), m.getMonth() + 1, 0))
  try { const r = await openTimes(option.value.event, from, to, zone.value, chosen.value, runCount.value); open.value = r.slots || {}; minutes.value = r.minutes || 0; why.value = r.why || null; seatsLeft.value = r.left || {} }
  catch (e) {
    open.value = {}; why.value = null; seatsLeft.value = {}
    error.value = B['cal-error']
    console.error('Could not load session availability.', e)
  }
  finally { loading.value = false }
  if (day.value && !(open.value[day.value] || []).length) day.value = ''
  if (!day.value) { const k = Object.keys(open.value).sort().find((x) => open.value[x].length); if (k) day.value = k }
}
onMounted(async () => {
  await restorePending()
  if (pendingAuth.value && isSignedIn.value) resumeAfterAuth()
  else if (step.value === 'when') load()
})
watch(isSignedIn, (signed) => { if (signed) resumeAfterAuth() })
watch([month, zone], () => { if (step.value !== 'what') load() })

function choose(o) { if (o.blocked) return; picked.value = o; day.value = ''; slot.value = ''; month.value = new Date(first); step.value = 'when'; load() }
function change() { step.value = 'what'; picked.value = null; open.value = {}; day.value = ''; slot.value = ''; error.value = '' }
function shift(n) { const m = new Date(month.value); m.setMonth(m.getMonth() + n); month.value = m }
/*
 * QUESTIONS ON THE WAY IN. A type may ask a form's questions between choosing a time and confirming
 * — and they are asked AFTER the time rather than before, because somebody who cannot find an hour
 * that suits should not have answered anything first.
 *
 * What they answer is a form response like any other, so the desk reads it where it reads every
 * other response and the booking simply remembers which one. A form that is gone or unpublished
 * asks nothing and the type books as it always did: a booking page that refuses because somebody
 * unpublished a questionnaire is worse than one that skips it.
 */
const asked = computed(() => {
  const slug = option.value && option.value.form
  if (!slug) return null
  return (FORMS || []).find((x) => x.slug === slug && x.published !== false) || null
})
const response = ref(null)
function answered(e) { response.value = (e && e.response) || null; step.value = 'confirm'; error.value = '' }
function pick(iso) { slot.value = iso; response.value = null; step.value = asked.value ? 'questions' : 'confirm'; error.value = '' }

const price = computed(() => option.value && option.value.paid ? money(option.value.unit_amount || 0, 'usd') : '')
const paying = computed(() => !props.host && !!option.value && option.value.paid && !(option.value.credits > 0) && !props.moving)
const guestBooking = computed(() => !isSignedIn.value && !props.host && !props.moving && !props.requireAuthToBook)
const askGuestEmail = computed(() => guestBooking.value && !paying.value)
const pendingKey = 'dl.booking.pending'
function clearPending() { if (typeof window !== 'undefined') window.sessionStorage.removeItem(pendingKey) }
function resumeAfterAuth() {
  if (!pendingAuth.value || !isSignedIn.value) return
  pendingAuth.value = false
  void confirm(true)
}
async function restorePending() {
  if (typeof window === 'undefined' || props.host) return
  const raw = window.sessionStorage.getItem(pendingKey)
  if (!raw) return
  let saved
  try { saved = JSON.parse(raw) } catch { clearPending(); return }
  const selected = props.options.find((o) => o.event === saved?.event)
  if (!selected || typeof saved?.start !== 'string' || !Number.isFinite(Date.parse(saved.start))) { clearPending(); return }
  picked.value = selected
  await nextTick()
  const availableLengths = lengthsOf(selected).map((l) => l.minutes)
  if (availableLengths.includes(saved.minutes)) chosen.value = saved.minutes
  if (runs.value.includes(saved.count)) runCount.value = saved.count
  if (typeof saved.zone === 'string') {
    try { new Intl.DateTimeFormat(undefined, { timeZone: saved.zone }); zone.value = saved.zone } catch { /* retain the browser's zone */ }
  }
  slot.value = saved.start
  day.value = saved.start.slice(0, 10)
  step.value = 'confirm'
  pendingAuth.value = true
}
/* WHAT IT COSTS, and the three different kinds of nothing are not the same sentence: one of the
   site's own types costs nothing because a membership covers it, a provider's own may simply be
   free, and a paid one already bought is waiting to be used. */
const costOf = (o) => (o.paid ? (o.credits > 0 ? B['credit-line'] : money(o.unit_amount || 0, o.currency || 'usd')) : o.offering ? B.free : B.included)
/* WHOSE AN OPTION IS, in words — nothing at all for one of the site's own types, which are the
   business's and belong to nobody in particular */
const fillWords = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const byOf = (o) => {
  const by = o && o.by
  if (!by || !by.name) return ''
  return fillWords(by.title ? B['by-titled'] : B.by, { name: by.name, title: by.title })
}

async function confirm(afterAuth = false) {
  if (!slot.value || !option.value) return
  if (!isSignedIn.value && !guestBooking.value) {
    if (!window.DLauth) { error.value = B['cal-error']; return }
    try {
      window.sessionStorage.setItem(pendingKey, JSON.stringify({ event: option.value.event, start: slot.value, zone: zone.value, minutes: chosen.value, count: runCount.value }))
    } catch (e) { error.value = e.message || B['cal-error']; return }
    pendingAuth.value = true
    window.DLauth.open({ intent: 'booking', returnTo: window.location.href, onAuthenticated: resumeAfterAuth })
    return
  }
  if (askGuestEmail.value && !emailOk(guestEmail.value)) { error.value = B['email-invalid']; return }
  if (afterAuth) clearPending()
  step.value = 'busy'; error.value = ''
  try {
    if (afterAuth) {
      await refreshEntitlements()
      await nextTick()
      const selected = props.options.find((o) => o.event === option.value.event)
      if (!selected || selected.blocked) {
        picked.value = null; slot.value = ''; step.value = 'what'; error.value = ''
        return
      }
      picked.value = selected
      const selectedDay = day.value || slot.value.slice(0, 10)
      const fresh = await openTimes(selected.event, selectedDay, selectedDay, zone.value, chosen.value, runCount.value)
      open.value = fresh.slots || {}
      minutes.value = fresh.minutes || 0
      seatsLeft.value = fresh.left || {}
      if (!(open.value[selectedDay] || []).includes(slot.value)) {
        const line = B.taken
        slot.value = ''; step.value = 'when'
        await load()
        error.value = line
        return
      }
      day.value = selectedDay
    }
    if (asksPhone.value && !phone.value.trim()) { step.value = 'confirm'; error.value = B['phone-need']; return }
    if (paying.value) { await payAndBook(option.value.sku, { event: option.value.event, start: slot.value, timeZone: zone.value, notes: notes.value, phone: asksPhone.value ? phone.value.trim() : '' }); return }
    if (props.host) {
      const list = cleanInvitees.value
      if (!list.length) { step.value = 'confirm'; error.value = HW['need-invitee']; return }
      if (list.some((e) => !emailOk(e))) { step.value = 'confirm'; error.value = HW['bad-email']; return }
      if (option.value.seats > 0 && list.length > option.value.seats) { step.value = 'confirm'; error.value = fill(HW['seats-full'], { n: option.value.seats }); return }
      const r = await bookForOthers(option.value.event, slot.value, zone.value, notes.value, list)
      done.value = r.booking; step.value = 'done'; emit('booked', r.booking); sendOn(); return
    }
    const r = await bookSession(option.value.event, slot.value, zone.value, notes.value, props.moving ? props.moving.uid : '', asksPhone.value ? phone.value.trim() : '', response.value, chosen.value, runCount.value, askGuestEmail.value ? guestEmail.value.trim().toLowerCase() : '')
    done.value = r.booking; step.value = 'done'
    await refreshEntitlements().catch(() => {})
    emit(props.moving ? 'moved' : 'booked', r.booking)
  } catch (e) {
    step.value = 'confirm'
    error.value = e.code === 'taken' ? B.taken : e.code === 'too-soon' ? fill(B['too-soon'], { n: e.hours }) : e.code === 'no-host' ? B['no-host'] : e.code === 'phone' ? B['phone-need'] : e.code === 'unpaid' ? B.unpaid : e.code === 'over' ? (C['booked-' + (e.allowance && /month/.test(e.allowance) ? 'month' : 'week')] || e.message) : e.message || B['cal-error']
    /* the time went: back to the times, refreshed, the line kept over the refresh (load clears it first) */
    if (e.code === 'taken') { const line = error.value; slot.value = ''; step.value = 'when'; load().then(() => { error.value = line }) }
  }
}
</script>

<template>
  <div class="bk" :class="'bk-step-' + step">
    <Transition name="bk-swap" mode="out-in">
      <!-- WHAT: the ways to book -->
      <div v-if="step === 'what'" key="what" class="bk-what">
        <span class="bk-eyebrow">{{ B['what-eyebrow'] }}</span>
        <h3 class="bk-h">{{ B['what-heading'] }}</h3>
        <div class="bk-choices">
          <button v-for="(o, i) in options" :key="o.event" type="button" class="bk-choice" :class="{ blocked: o.blocked, paid: o.paid && !(o.credits > 0) }" :style="{ '--i': i }" :disabled="o.blocked" @click="choose(o)">
            <span v-if="!host" class="bk-choice-tag">{{ o.blocked ? (o.span === 'month' ? C['booked-month'] : C['booked-week']) + ' ' + soon(o.next) : costOf(o) }}</span>
            <b>{{ o.title }}</b>
            <span class="bk-choice-sub">{{ o.sub }}</span>
            <!-- WHOSE IT IS. An offering is a person's time, and a reader booking it is booking that
                 person's time: the site's own types say nothing here, a provider's always does. -->
            <span v-if="byOf(o)" class="bk-choice-by">{{ byOf(o) }}</span>
            <i class="bk-choice-go" aria-hidden="true">→</i>
          </button>
        </div>
      </div>

      <!-- WHEN, then the confirm and the booked screen, all beside the call's facts -->
      <div v-else key="when" class="bk-main">
        <aside class="bk-side">
          <div class="bk-side-info">
            <button v-if="many && step !== 'done'" type="button" class="bk-change" :disabled="step === 'busy'" @click="change">‹ {{ B.change }}</button>
            <span class="bk-eyebrow">{{ moving ? B.move : B['what-eyebrow'] }}</span>
            <h3 class="bk-title">{{ option.title }}</h3>
            <p v-if="showOrganiser && byOf(option)" class="bk-by">{{ byOf(option) }}</p>
            <ul class="bk-facts">
              <li v-if="showDetails && minutes"><i>◷</i>{{ minutes }} {{ B.minutes }}</li>
              <li v-if="showDetails && whereFact"><i>▣</i>{{ whereFact }}</li>
              <li v-if="showDetails && !host"><i>{{ paying ? '◈' : '✓' }}</i>{{ paying ? price + ' · ' + B['paid-line'] : costOf(option) }}</li>
              <Transition name="bk-fade"><li v-if="slot" class="bk-fact-when"><i>★</i>{{ whenOf(slot) }}</li></Transition>
            </ul>
            <!-- HOW LONG, where the type offers a choice -->
            <div v-if="lengths.length > 1" class="bk-lengths">
              <span class="bk-lengths-label">{{ B['how-long'] }}</span>
              <span class="bk-lengths-row">
                <button v-for="l in lengths" :key="l.minutes" type="button" class="bk-length" :class="{ on: chosen === l.minutes }" :disabled="step === 'busy'" @click="chosen = l.minutes">{{ l.minutes }} {{ B.minutes }}<i v-if="l.price && lengths.some((x) => x.price !== lengths[0].price)">{{ l.price }}</i></button>
              </span>
            </div>
            <!-- HOW MANY, where the type offers a run -->
            <div v-if="runs.length > 1" class="bk-lengths">
              <span class="bk-lengths-label">{{ B['run-label'] }}</span>
              <span class="bk-lengths-row">
                <button v-for="n in runs" :key="n" type="button" class="bk-length" :class="{ on: runCount === n }" :disabled="step === 'busy'" @click="runCount = n">{{ n === 1 ? B['run-one'] : fill(B['run-many'], { n }) }}</button>
              </span>
              <small v-if="runCount > 1" class="bk-run-note">{{ runEvery }} · {{ B['run-note'] }}</small>
            </div>
            <!-- a host's invitees: rows of addresses, added and removed -->
            <div v-if="host && step !== 'done'" class="bk-who">
              <span class="bk-eyebrow">{{ HW.invitees }}</span>
              <div v-for="(e, i) in invitees" :key="i" class="bk-who-row"><input v-model="invitees[i]" type="email" :placeholder="HW['invitee-placeholder']" :disabled="step === 'busy'" /><button v-if="invitees.length > 1" type="button" class="bk-who-x" :title="HW.remove" @click="dropInvitee(i)">×</button></div>
              <button v-if="!(option.seats > 0) || invitees.length < option.seats" type="button" class="bk-who-add" :disabled="step === 'busy'" @click="addInvitee">{{ HW['add-invitee'] }}</button>
            </div>
          </div>
          <label v-if="showZone" class="bk-zone"><span>{{ B.zone }}</span>
            <select v-model="zone"><option v-if="!zones.includes(zone)" :value="zone">{{ zone }}</option><option v-for="z in zones" :key="z" :value="z">{{ z.replace(/_/g, ' ') }}</option></select>
          </label>
        </aside>

        <Transition name="bk-swap" mode="out-in">
          <div v-if="step === 'when'" key="pick" class="bk-pick">
            <div class="bk-cal">
              <div class="bk-calhead">
                <b>{{ monthName }}</b>
                <span><button type="button" :disabled="!canBack" aria-label="previous month" @click="shift(-1)">‹</button><button type="button" aria-label="next month" @click="shift(1)">›</button></span>
              </div>
              <div class="bk-grid" :class="{ loading }">
                <span v-for="w in weekdays" :key="w" class="bk-wd">{{ w }}</span>
                <template v-for="(c, i) in cells" :key="i">
                  <span v-if="!c" />
                  <button v-else type="button" class="bk-day" :class="{ open: c.open, on: day === c.k, today: c.today }" :disabled="!c.open" @click="day = c.k">{{ c.n }}</button>
                </template>
              </div>
              <p v-if="loading" class="bk-note">{{ B.loading }}</p>
              <p v-else-if="!anyOpen && !error" class="bk-note">{{ whyNone }}</p>
              <p v-if="error" class="bk-err">
                {{ error }}
                <button type="button" :disabled="loading" @click="load">{{ B['cal-retry'] }}</button>
              </p>
            </div>
            <div class="bk-times">
              <b>{{ day ? dayOf(day) : B['pick-day'] }}</b>
              <TransitionGroup name="bk-list" tag="div" class="bk-timelist">
                <button v-for="(t, i) in times" :key="t" type="button" class="bk-time" :style="{ '--i': i }" @click="pick(t)">{{ timeOf(t) }}<i v-if="leftAt(t)" class="bk-left">{{ leftAt(t) === 1 ? B['seats-last'] : fill(B['seats-left'], { n: leftAt(t) }) }}</i></button>
              </TransitionGroup>
              <p v-if="day && !times.length && !loading" class="bk-note">{{ B['none-day'] }}</p>
            </div>
          </div>

          <div v-else-if="step === 'questions'" key="questions" class="bk-questions">
            <FormRun :form="asked" @complete="answered" />
          </div>
          <div v-else-if="step === 'confirm' || step === 'busy'" key="confirm" class="bk-confirm">
            <div class="bk-summary">
              <span class="bk-eyebrow">{{ dayOf(slot.slice(0, 10)) }}</span>
              <b>{{ timeOf(slot) }}<small v-if="minutes"> · {{ minutes }} {{ B.minutes }}</small></b>
            </div>
            <p v-if="guestBooking && paying" class="bk-note">{{ B['credit-recovery'] }}</p>
            <label v-if="askGuestEmail" class="bk-notes"><span>{{ B['guest-email'] }}</span><input v-model="guestEmail" type="email" autocomplete="email" :disabled="step === 'busy'" /><small>{{ B['guest-email-help'] }}</small></label>
            <label v-if="asksPhone" class="bk-notes bk-phone"><span>{{ B.phone }}</span><input v-model="phone" type="tel" :placeholder="B['phone-placeholder']" :disabled="step === 'busy'" /></label>
            <label v-if="showNotes" class="bk-notes"><span>{{ B.notes }}</span><textarea v-model="notes" rows="3" :placeholder="B['notes-placeholder']" :disabled="step === 'busy'" /></label>
            <p v-if="error" class="bk-err">{{ error }}</p>
            <div class="bk-acts">
              <button type="button" class="bk-btn ghost" :disabled="step === 'busy'" @click="step = 'when'; slot = ''">{{ B.back }}</button>
              <button type="button" class="bk-btn" :class="{ busy: step === 'busy' }" :disabled="step === 'busy'" @click="confirm">{{ step === 'busy' ? (moving ? B.moving : B.booking) : host ? HW.confirm : paying ? B['pay-confirm'] + ' · ' + price : B.confirm }}</button>
            </div>
          </div>

          <div v-else key="done" class="bk-doneview">
            <i class="bk-check" aria-hidden="true">✓</i>
            <h3>{{ host ? HW['done-heading'] : moving ? B['moved-heading'] : B['done-heading'] }}</h3>
            <p>{{ host ? HW['done-body'] : moving ? B['moved-body'] : guestBooking ? B['guest-done-body'] : B['done-body'] }}</p>
            <p class="bk-when">{{ whenOf(done ? done.start : slot) }}</p>
          </div>
        </Transition>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* the frame: a card with a warm wash and the look's ramp along its top */
.bk { position: relative; border: 1px solid var(--qhair); border-radius: 18px; background: var(--qcard); overflow: hidden; min-height: 440px;
  box-shadow: 0 1px 2px #0000000a, 0 18px 40px -28px #00000066 }
.bk::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 3px; background: linear-gradient(90deg, var(--c1, #ffe852), var(--c2, #ffb347), var(--c3, #fc5151)); opacity: .9 }
.bk.bk-step-what { min-height: 0 }
/* THE CALENDAR WANTS A TALL PANE; THE CONFIRMATION WANTS THE HEIGHT OF WHAT IT ASKS. A type that
   asks nothing — no notes, no phone, no invitees — was left with a third of a screen of nothing
   under the time it had just chosen. */
.bk.bk-step-confirm, .bk.bk-step-busy { min-height: 0 }
.bk.bk-step-confirm .bk-main, .bk.bk-step-busy .bk-main { min-height: 0 }
.bk-eyebrow { display: block; font-family: var(--m); font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--qink3); margin-bottom: 8px }
/* a host's invitees */
.bk-who { margin: 14px 0 6px } .bk-who-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px }
.bk-who-row input { flex: 1; min-width: 0; font: inherit; font-size: 13.5px; color: var(--qink); background: var(--qpaper, var(--qcard)); border: 1px solid var(--qhair); border-radius: 8px; padding: 7px 10px }
.bk-who-x { font: inherit; font-size: 15px; line-height: 1; color: var(--qink3); background: none; border: 0; padding: 4px 6px; cursor: pointer; border-radius: 6px } .bk-who-x:hover { color: var(--qink) }
.bk-who-add { font: inherit; font-size: 12.5px; color: var(--qink2); background: transparent; border: 1px dashed var(--qhair); border-radius: 999px; padding: 5px 11px; cursor: pointer }

/* WHAT */
.bk-what { padding: 36px 32px 34px }
.bk-h { font-family: var(--fd); font-weight: 600; font-size: clamp(24px, 3vw, 32px); letter-spacing: -.02em; color: var(--qink); margin: 0 0 22px }
.bk-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px }
.bk-choice { position: relative; font: inherit; text-align: left; display: flex; flex-direction: column; gap: 6px; padding: 20px 20px 18px; min-height: 150px;
  border: 1px solid var(--qhair); border-radius: 14px; background: var(--qcard); color: var(--qink2); cursor: pointer; overflow: hidden;
  transition: transform .22s cubic-bezier(.2,.8,.3,1), box-shadow .22s, border-color .22s;
  animation: bk-rise .5s cubic-bezier(.2,.8,.3,1) both; animation-delay: calc(var(--i) * 70ms) }
.bk-choice::before { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, color-mix(in srgb, var(--c1, #ffe852) 22%, transparent), color-mix(in srgb, var(--c3, #fc5151) 10%, transparent) 60%, transparent); opacity: 0; transition: opacity .25s }
.bk-choice:hover:not(:disabled), .bk-choice:focus-visible { transform: translateY(-3px); border-color: color-mix(in srgb, var(--c3, #fc5151) 45%, var(--qhair)); box-shadow: 0 14px 30px -18px color-mix(in srgb, var(--c3, #fc5151) 55%, transparent) }
.bk-choice:hover:not(:disabled)::before { opacity: 1 }
.bk-choice > * { position: relative }
.bk-choice b { font-family: var(--fd); font-weight: 600; font-size: 20px; color: var(--qink); line-height: 1.15 }
.bk-choice-sub { font-size: 13.5px; line-height: 1.45; color: var(--qink3); flex: 1 }
/* whose it is: quieter than the line, and set apart from it — it is a fact about the offering, not
   more of its description */
.bk-choice-by { font-family: var(--m); font-size: 11px; letter-spacing: .01em; color: var(--qink3); opacity: .85 }
.bk-choice-tag { align-self: flex-start; font-family: var(--m); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; padding: 4px 9px; border-radius: 999px;
  color: var(--qink); background: color-mix(in srgb, var(--c1, #ffe852) 45%, transparent) }
.bk-choice.paid .bk-choice-tag { background: color-mix(in srgb, var(--c3, #fc5151) 22%, transparent) }
.bk-choice.blocked { opacity: .55; cursor: default; animation: none }
.bk-choice.blocked .bk-choice-tag { background: color-mix(in srgb, var(--qink) 10%, transparent) }
.bk-choice-go { font-style: normal; align-self: flex-end; font-size: 18px; color: var(--qink3); transition: transform .22s, color .22s }
.bk-choice:hover:not(:disabled) .bk-choice-go { transform: translateX(4px); color: var(--c3, #fc5151) }
@keyframes bk-rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }

/* WHEN */
.bk-main { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 440px }
.bk-side { padding: 24px 22px; border-right: 1px solid var(--qhair); display: flex; flex-direction: column; gap: 6px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--c1, #ffe852) 10%, transparent), transparent 40%) }
.bk-side-info { display: flex; flex: 1; flex-direction: column; gap: 6px; min-width: 0 }
.bk-change { align-self: flex-start; font: inherit; font-size: 13px; color: var(--qink3); background: transparent; border: 0; padding: 0 0 10px; cursor: pointer; transition: color .2s }
.bk-change:hover { color: var(--qink) }
.bk-title { font-family: var(--fd); font-weight: 600; font-size: 22px; line-height: 1.15; color: var(--qink); margin: 0 0 10px }
.bk-by { font-family: var(--m); font-size: 11.5px; color: var(--qink3); margin: -6px 0 12px }
.bk-facts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 13.5px; color: var(--qink2) }
.bk-lengths { margin-top: 14px; display: flex; flex-direction: column; gap: 6px }
.bk-lengths-label { font-family: var(--m); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--qink3) }
.bk-lengths-row { display: flex; flex-wrap: wrap; gap: 6px }
.bk-run-note { font-size: 12px; color: var(--qink3); line-height: 1.4 }
.bk-length { font: inherit; font-size: 13px; color: var(--qink2); background: transparent; border: 1px solid var(--qhair); border-radius: 999px; padding: 5px 11px; cursor: pointer; display: inline-flex; gap: 6px; align-items: baseline }
.bk-length i { font-style: normal; font-size: 12px; color: var(--qink3) }
.bk-length.on { color: var(--qink); border-color: currentColor }
.bk-facts li { display: flex; gap: 9px; align-items: flex-start; line-height: 1.4 }
.bk-facts i { font-style: normal; width: 16px; text-align: center; color: var(--c3, #fc5151); flex: none }
.bk-fact-when { font-weight: 600; color: var(--qink) }
.bk-zone { margin-top: auto; padding-top: 18px; display: flex; flex-direction: column; gap: 4px; font-family: var(--m); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--qink3) }
.bk-zone select { font: inherit; font-family: var(--f); font-size: 13px; text-transform: none; letter-spacing: 0; color: var(--qink); background: transparent; border: 1px solid var(--qhair); border-radius: 8px; padding: 6px 8px; max-width: 100% }
.bk-pick { display: grid; grid-template-columns: minmax(0, 1fr) 210px }
.bk-cal { padding: 22px; border-right: 1px solid var(--qhair) }
.bk-calhead { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px }
.bk-calhead b { font-size: 15px; color: var(--qink) }
.bk-calhead button { font: inherit; font-size: 18px; line-height: 1; width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--qhair); background: transparent; color: var(--qink); cursor: pointer; margin-left: 4px; transition: background .2s }
.bk-calhead button:hover:not(:disabled) { background: color-mix(in srgb, var(--qink) 8%, transparent) }
.bk-calhead button:disabled { opacity: .3; cursor: default }
.bk-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; transition: opacity .2s }
.bk-grid.loading { opacity: .5 }
.bk-wd { font-family: var(--m); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--qink3); text-align: center; padding: 4px 0 8px }
.bk-day { font: inherit; font-size: 14px; aspect-ratio: 1; border-radius: 10px; border: 0; background: transparent; color: var(--qink3); cursor: default; transition: transform .18s, background .18s, color .18s }
.bk-day.open { background: color-mix(in srgb, var(--c1, #ffe852) 28%, transparent); color: var(--qink); font-weight: 600; cursor: pointer }
.bk-day.open:hover { transform: scale(1.06); background: color-mix(in srgb, var(--c2, #ffb347) 40%, transparent) }
.bk-day.on { background: linear-gradient(135deg, var(--c2, #ffb347), var(--c3, #fc5151)); color: #fff; box-shadow: 0 8px 18px -10px var(--c3, #fc5151) }
.bk-day.today { text-decoration: underline; text-underline-offset: 3px }
.bk-note { font-size: 13px; color: var(--qink3); margin: 12px 0 0 }
.bk-err { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13.5px; color: var(--lvcatch, #dd3b3b); margin: 12px 0 0 }
.bk-err button { font: inherit; font-size: 12.5px; font-weight: 650; color: var(--qink); background: transparent;
  border: 1px solid var(--qhair); border-radius: 999px; padding: 4px 11px; cursor: pointer }
.bk-err button:disabled { opacity: .5; cursor: default }
.bk-times { padding: 22px 18px; display: flex; flex-direction: column; gap: 10px; min-width: 0 }
.bk-times > b { font-size: 14px; color: var(--qink) }
.bk-timelist { display: flex; flex-direction: column; gap: 8px; max-height: 360px; overflow-y: auto; padding: 2px }
.bk-time { font: inherit; font-size: 14px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--qhair); background: transparent; color: var(--qink); cursor: pointer; text-align: center;
  transition: border-color .18s, background .18s, transform .18s; animation: bk-rise .35s cubic-bezier(.2,.8,.3,1) both; animation-delay: calc(var(--i) * 40ms) }
/* how many seats are left, under the time rather than beside it: a number that runs into the hour
   reads as part of it ("12:0030 left"), which is worse than not saying */
.bk-time i.bk-left { display: block; font-style: normal; font-size: 11.5px; color: var(--qink3); margin-top: 3px }
.bk-time:hover { border-color: var(--c3, #fc5151); background: color-mix(in srgb, var(--c3, #fc5151) 8%, transparent); transform: translateX(2px) }

/* confirm and done */
.bk-confirm { padding: 24px; display: flex; flex-direction: column; gap: 16px }
/* A FORM IS SIZED FOR A PAGE OF ITS OWN. Inside the booker it shares the pane with the type, the
   price and the time already chosen, so its title comes down to the size of a step rather than the
   size of a page — the questions themselves stay as they are, because they are still questions. */
.bk-questions { padding: 22px 24px; container-type: inline-size }
.bk-questions :deep(.fcopy h1) { font-size: clamp(22px, 2.4cqi + 16px, 28px) }
.bk-questions :deep(.fcopy h2) { font-size: clamp(19px, 1.6cqi + 15px, 23px) }
.bk-questions :deep(.fcopy) { font-size: 15.5px; margin-bottom: 16px }
.bk-questions :deep(.fq) { font-size: clamp(18px, 1.8cqi + 14px, 22px) }
.bk-summary { padding: 16px 18px; border-radius: 12px; background: linear-gradient(135deg, color-mix(in srgb, var(--c1, #ffe852) 30%, transparent), color-mix(in srgb, var(--c3, #fc5151) 12%, transparent)) }
.bk-summary .bk-eyebrow { margin-bottom: 4px }
.bk-summary b { font-family: var(--fd); font-weight: 600; font-size: 26px; color: var(--qink) }
.bk-summary small { font-family: var(--m); font-size: 12px; color: var(--qink3); font-weight: 400 }
.bk-notes { display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; color: var(--qink2) }
.bk-notes textarea { font: inherit; font-size: 14px; padding: 10px 12px; border: 1px solid var(--qhair); border-radius: 10px; background: transparent; color: var(--qink); resize: vertical; transition: border-color .2s }
.bk-notes textarea:focus { outline: none; border-color: var(--c3, #fc5151) }
.bk-acts { display: flex; gap: 10px; justify-content: flex-end; margin-top: auto }
.bk-btn { font: inherit; font-size: 14px; font-weight: 600; padding: 11px 20px; border-radius: 999px; border: 1px solid transparent; color: #fff; cursor: pointer;
  background: linear-gradient(135deg, var(--c2, #ffb347), var(--c3, #fc5151)); box-shadow: 0 10px 22px -12px var(--c3, #fc5151); transition: transform .18s, box-shadow .18s, opacity .18s }
.bk-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 14px 26px -12px var(--c3, #fc5151) }
.bk-btn.ghost { background: transparent; color: var(--qink); border-color: var(--qhair); box-shadow: none }
.bk-btn:disabled { opacity: .6; cursor: default }
.bk-btn.busy { animation: bk-pulse 1.1s ease-in-out infinite }
@keyframes bk-pulse { 0%, 100% { opacity: .6 } 50% { opacity: 1 } }
.bk-doneview { padding: 36px 28px; display: flex; flex-direction: column; justify-content: center; gap: 8px }
.bk-check { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 50%; font-style: normal; font-size: 24px; color: #fff; margin-bottom: 8px;
  background: linear-gradient(135deg, var(--c2, #ffb347), var(--c3, #fc5151)); animation: bk-pop .5s cubic-bezier(.2,.9,.3,1.3) both }
@keyframes bk-pop { from { transform: scale(.4); opacity: 0 } to { transform: none; opacity: 1 } }
.bk-doneview h3 { font-family: var(--fd); font-size: 26px; margin: 0; color: var(--qink) }
.bk-doneview p { margin: 0; font-size: 15px; color: var(--qink2); max-width: 46ch; line-height: 1.5 }
.bk-when { font-family: var(--m); font-size: 12.5px; color: var(--qink3); margin-top: 6px }

/* the steps swap with a short slide */
.bk-swap-enter-active, .bk-swap-leave-active { transition: opacity .22s ease, transform .22s cubic-bezier(.2,.8,.3,1) }
.bk-swap-enter-from { opacity: 0; transform: translateX(14px) }
.bk-swap-leave-to { opacity: 0; transform: translateX(-10px) }
.bk-fade-enter-active, .bk-fade-leave-active { transition: opacity .25s }
.bk-fade-enter-from, .bk-fade-leave-to { opacity: 0 }
.bk-list-move { transition: transform .25s }
@media (max-width: 900px) {
  .bk-main { grid-template-columns: minmax(0, 1fr) }
  .bk-side { display: grid; grid-template-columns: minmax(0, 1fr) minmax(180px, 30%); align-items: center;
    gap: 6px 16px; padding: 8px 14px; border-right: 0; border-bottom: 1px solid var(--qhair) }
  .bk-side-info { gap: 3px }
  .bk-side .bk-eyebrow { margin-bottom: 2px }
  .bk-change { padding-bottom: 2px }
  .bk-title { font-size: 19px; margin: 0 0 2px }
  .bk-facts { gap: 3px; font-size: 12.5px }
  .bk-zone { grid-column: 2; margin-top: 0; padding-top: 0; gap: 3px }
  .bk-zone select { width: 100% }
  .bk-pick { grid-template-columns: minmax(0, 1fr) }
  .bk-cal { border-right: 0; border-bottom: 1px solid var(--qhair) }
  .bk-day { aspect-ratio: auto; width: min(100%, 52px); height: 40px; justify-self: center }
}
@media (max-width: 820px) {
  .bk-main { grid-template-columns: 1fr }
  .bk-side { display: flex; flex-direction: column; align-items: stretch; gap: 3px;
    padding: 12px 14px; border-right: 0; border-bottom: 1px solid var(--qhair) }
  .bk-zone { grid-column: auto; margin-top: 0; padding-top: 0; gap: 3px }
  .bk-cal { padding: 10px 14px }
  .bk-calhead { margin-bottom: 7px }
  .bk-grid { gap: 2px }
  .bk-wd { padding: 2px 0 4px }
  .bk-day { aspect-ratio: auto; height: 40px; border-radius: 8px }
  .bk-timelist { flex-direction: row; flex-wrap: wrap; max-height: none }
  .bk-time { flex: 1 1 90px }
  .bk-what { padding: 26px 20px }
}
@media (prefers-reduced-motion: reduce) { .bk *, .bk *::before { animation: none !important; transition: none !important } }
</style>

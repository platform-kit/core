<script setup>
/*
 * THE TICKETS SIDE OF THE WIDGET.
 *
 * A conversation is something you are having; a ticket is something somebody owes you. That is the
 * whole distinction, and it is why this is a tab rather than a kind of message: a chat goes quiet
 * and that is fine, a ticket going quiet is the thing a customer is anxious about. So the list is
 * ordered by what happened last, every row wears its state in words, and the one view shows the
 * timeline as it is — what was written to them and what changed, never the desk's own notes (that
 * filter lives in the query, in the function, not in this file).
 *
 * Three views, one at a time: the list, one ticket, and reporting a new one. Words are the
 * `tickets` record of the support scope; everything it reads and writes is support/api.js, which
 * goes through the `support` function, because a contact has no row-level identity of their own.
 */
import { ref, computed, onMounted } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { tickets, ticket, loadTickets, openTicket, closeTicket, sayOnTicket, raiseTicket } from '@platform-kit/kit/lib/support/api.js'
import { whenOf } from '@platform-kit/kit/lib/chat/model.js'
import SupportMark from './SupportMark.vue'

const T = us('support').widget.tickets
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))

/* list | one | new */
const view = ref('list')
const busy = ref(false)
const failed = ref('')
const said = ref('')
const title = ref('')
const body = ref('')

const statusWord = (s) => T[`status-${s}`] || s
const at = (iso) => whenOf(iso)

onMounted(() => loadTickets())

async function show(id) { view.value = 'one'; said.value = ''; await openTicket(id) }
function back() { view.value = 'list'; closeTicket(); failed.value = '' }
function goNew() { view.value = 'new'; title.value = ''; body.value = ''; failed.value = '' }

async function reply() {
  const s = said.value.trim()
  if (!s || busy.value) return
  busy.value = true
  const ok = await sayOnTicket(s)
  busy.value = false
  if (ok) said.value = ''
  else failed.value = T.failed
}

async function report() {
  const t = title.value.trim()
  if (!t || busy.value) return
  busy.value = true
  failed.value = ''
  const out = await raiseTicket({ title: t, body: body.value.trim() })
  busy.value = false
  if (out && out.error) { failed.value = out.error === 'too many open' ? T['too-many'] : T.failed; return }
  view.value = 'one'
}

/* what a timeline entry says. A state change is a sentence, not a row of fields. */
const lineOf = (e) => (e.kind === 'status' ? fill(T.changed, { what: statusWord((e.data || {}).to) }) : e.body || '')
const shown = computed(() => (ticket.timeline || []).filter((e) => lineOf(e)))
</script>

<template>
  <div class="st">
    <!-- every ticket of theirs -->
    <div v-if="view === 'list'" class="st-body">
      <p class="sp-eyebrow">{{ T.eyebrow }}</p>
      <p v-if="!tickets.length" class="st-none">{{ T.none }}</p>
      <button v-for="t in tickets" :key="t.id" type="button" class="st-row" :class="{ done: ['resolved', 'closed'].includes(t.status) }" @click="show(t.id)">
        <span class="st-rowtext">
          <b>{{ t.title }}</b>
          <small>{{ fill(T.ref, { n: t.ref }) }} · {{ statusWord(t.status) }}</small>
        </span>
        <time>{{ at(t.last_at) }}</time>
      </button>
      <button type="button" class="sp-btn st-new" @click="goNew">{{ T.open }}</button>
    </div>

    <!-- one of them, as it stands -->
    <div v-else-if="view === 'one'" class="st-one">
      <div class="st-scroll">
      <button type="button" class="st-back" @click="back">{{ T['tab-tickets'] }}</button>
      <p v-if="ticket.loading && !ticket.row" class="st-none">{{ T.loading }}</p>
      <template v-if="ticket.row">
        <h3 class="st-title">{{ ticket.row.title }}</h3>
        <p class="st-meta"><i class="st-pill" :class="ticket.row.status">{{ statusWord(ticket.row.status) }}</i>{{ fill(T.ref, { n: ticket.row.ref }) }} · {{ fill(T.opened, { when: at(ticket.row.created_at) }) }}</p>
        <div class="st-line" v-for="e in shown" :key="e.id" :class="{ own: e.by_contact, note: e.kind === 'status' }">
          <SupportMark v-if="!e.by_contact && e.kind !== 'status'" :name="e.agent_name || ''" :size="26" />
          <div class="st-said">
            <small v-if="e.kind !== 'status'">{{ e.by_contact ? T['raised-by-you'] : (e.agent_name || T['raised-by-us']) }}</small>
            <p>{{ lineOf(e) }}</p>
            <time>{{ at(e.created_at) }}</time>
          </div>
        </div>
      </template>
      <p v-if="failed" class="st-failed">{{ failed }}</p>
      </div>
      <form v-if="ticket.row" class="st-reply" @submit.prevent="reply">
        <textarea v-model="said" :placeholder="T.reply" rows="1" @keydown.enter.exact.prevent="reply"></textarea>
        <button type="submit" class="st-send" :disabled="!said.trim() || busy" :aria-label="T.send" :title="T.send">
          <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10 16.5 4l-4 12-2.8-5.2z"/></svg>
        </button>
      </form>
    </div>

    <!-- reporting one -->
    <form v-else class="st-body st-make" @submit.prevent="report">
      <button type="button" class="st-back" @click="back">{{ T.cancel }}</button>
      <label>{{ T['new-title'] }}<input v-model="title" type="text" :placeholder="T['new-title-hint']" maxlength="200" /></label>
      <label>{{ T['new-body'] }}<textarea v-model="body" :placeholder="T['new-body-hint']" rows="4" maxlength="4000"></textarea></label>
      <p class="st-note">{{ T['new-note'] }}</p>
      <p v-if="failed" class="st-failed">{{ failed }}</p>
      <button type="submit" class="sp-btn" :disabled="!title.trim() || busy">{{ T['new-go'] }}</button>
    </form>
  </div>
</template>

<style scoped>
.st, .st-body { display: flex; flex-direction: column; min-height: 0; flex: 1 }
.st-body { gap: 8px; padding: 14px 16px 16px; overflow-y: auto }
.st-none { margin: 0; padding: 18px 2px; font-size: 13.5px; line-height: 1.5; color: var(--ink3) }

.st-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 12px; font: inherit; text-align: left;
  color: inherit; background: var(--card); border: 1px solid var(--line, var(--hair)); border-radius: 12px; cursor: pointer }
.st-row:hover { border-color: color-mix(in srgb, var(--ink) 22%, transparent) }
.st-row.done { opacity: .62 }
.st-rowtext { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 }
.st-rowtext b { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.st-rowtext small { font-size: 11.5px; color: var(--ink3) }
.st-row time { flex: none; font-size: 11px; color: var(--ink3) }
.st-new { margin-top: 4px; padding: 10px 14px; font-size: 13px; font-weight: 600; color: var(--paper, #fff);
  background: var(--ink); border: 0; border-radius: 11px; cursor: pointer }
.st-new:hover { opacity: .9 }

.st-back { align-self: flex-start; font: inherit; font-size: 12px; font-weight: 600; color: var(--ink3);
  background: none; border: 0; padding: 0 0 2px; cursor: pointer }
.st-back:hover { color: var(--ink) }
.st-back::before { content: '‹'; margin-right: 5px }
.st-title { margin: 2px 0 0; font-size: 15.5px; font-weight: 650; line-height: 1.35 }
.st-meta { display: flex; align-items: center; gap: 7px; margin: 0 0 6px; font-size: 11.5px; color: var(--ink3) }
.st-pill { font-style: normal; font-size: 10.5px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase;
  padding: 3px 7px; border-radius: 999px; background: color-mix(in srgb, var(--ink) 9%, transparent); color: var(--ink2) }
.st-pill.resolved, .st-pill.closed { background: color-mix(in srgb, var(--ok, #2e7d54) 16%, transparent); color: var(--ok, #2e7d54) }

.st-line { display: flex; gap: 8px; align-items: flex-start }
.st-line.own { flex-direction: row-reverse }
.st-line.note { justify-content: center }
.st-said { display: flex; flex-direction: column; gap: 2px; max-width: 84%; padding: 8px 11px;
  background: var(--card); border: 1px solid var(--line, var(--hair)); border-radius: 13px }
.st-line.own .st-said { background: color-mix(in srgb, var(--ink) 7%, transparent); align-items: flex-end }
.st-line.note .st-said { max-width: 100%; padding: 2px 0; background: none; border: 0; align-items: center }
.st-said small { font-size: 11px; font-weight: 600; color: var(--ink3) }
.st-said p { margin: 0; font-size: 13.5px; line-height: 1.5; white-space: pre-wrap }
.st-line.note .st-said p { font-size: 11.5px; color: var(--ink3) }
.st-said time { font-size: 10.5px; color: var(--ink3) }
.st-line.note .st-said time { display: none }

.st-one { display: flex; flex-direction: column; min-height: 0; flex: 1 }
.st-scroll { display: flex; flex-direction: column; gap: 8px; min-height: 0; flex: 1; padding: 14px 16px 12px; overflow-y: auto }
/* the reply sits at the foot, where a composer sits, and never in the middle of the history */
.st-reply { display: flex; gap: 8px; align-items: flex-end; padding: 10px 12px 12px; border-top: 1px solid var(--line, var(--hair)) }
.st-reply textarea { flex: 1; max-height: 120px; resize: none }
.st-send { flex: none; display: grid; place-items: center; width: 34px; height: 34px; color: var(--paper, #fff);
  background: var(--ink); border: 0; border-radius: 50%; cursor: pointer }
.st-send:disabled { opacity: .35; cursor: default }
.st-make { gap: 12px }
.st-make button[type=submit] { align-self: flex-start; padding: 10px 16px; font-size: 13px; font-weight: 600;
  color: var(--paper, #fff); background: var(--ink); border: 0; border-radius: 11px; cursor: pointer }
.st-make button[type=submit]:disabled { opacity: .4; cursor: default }
.st-make label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 600; color: var(--ink2) }
.st-make input, .st-make textarea, .st-reply textarea { font: inherit; font-size: 13.5px; font-weight: 400; color: var(--ink);
  padding: 9px 11px; background: var(--card); border: 1px solid var(--line, var(--hair)); border-radius: 11px; resize: vertical }
.st-reply textarea { resize: none }
.st-make input:focus, .st-make textarea:focus, .st-reply textarea:focus { outline: none; border-color: color-mix(in srgb, var(--ink) 34%, transparent) }
.st-note { margin: 0; font-size: 11.5px; line-height: 1.5; color: var(--ink3) }
.st-failed { margin: 0; font-size: 12px; color: var(--ink2) }
</style>

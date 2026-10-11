<script setup>
/*
 * THE DESK'S TICKETS. A chat is a conversation; a ticket is a piece of work. This is the second
 * side of the support surface: a list of what is open, ordered by what is most urgent rather than
 * by what moved last, and a pane that shows one whole — who it is about, who is on it, everything
 * that has happened to it, and the conversations it came out of.
 *
 * Three things are deliberate:
 *
 *   the list is narrowed by CHOSEN chips and never by a syntax, as everywhere else here;
 *   a reply and a note are the same box with a switch, because they are the same act with a
 *     different audience, and two boxes would be one to get wrong;
 *   every control writes through the database's own function, so a state change and the line on
 *     the timeline that explains it can never come apart.
 *
 * Words from spaces.md (## tickets).
 */
import { computed, ref, onMounted, watch, nextTick } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import {
  tickets, loadTickets, openTicket, closeTicket, raise, setTicket, assignTicket, answerValues,
  sayOnTicket, linkTicket, sortTickets, owedOn, ageOf, narrow, STATES, PRIORITIES, isLive,
  statusOfTicket, priorityOf,
} from '@platform-kit/kit/lib/desk/tickets.js'
import { stampOf } from '@platform-kit/kit/lib/spaces/model.js'
import { messageBlocks } from '@platform-kit/kit/lib/chat/markup.js'
import './work-ui.css'   /* the frame every Work queue wears */
import SpaceAvatar from './SpaceAvatar.vue'
import SpaceComposer from './SpaceComposer.vue'
import SpaceIcon from './SpaceIcon.vue'
import MessageText from '../chat/MessageText.vue'

const props = defineProps({
  me: { type: String, default: '' },
  /* who a ticket may be put on: the staff, as the desk already knows them */
  agents: { type: Array, default: () => [] },
})
const W = computed(() => us('spaces').tickets.main)

const order = ref('busy')
const status = ref('open')
const assignee = ref(null)
const q = ref('')
/* WHAT THEY WERE RAISED WITH. A site that asks a form before a ticket is raised has told the desk
   something in every answer, and this is where that pays: the desk offers whatever the site asked —
   "the urgent ones", "the ones about the reader" — for fields this kit has never heard of. */
const answer = ref(null)
const values = ref([])
const fields = computed(() => {
  const by = {}
  for (const v of values.value) (by[v.field] = by[v.field] || []).push(v)
  return Object.entries(by).map(([field, vs]) => ({ field, values: vs }))
})
const now = ref(Date.now())
let tick = null

onMounted(async () => { await loadTickets(); values.value = await answerValues(true).catch(() => []); tick = setInterval(() => { now.value = Date.now() }, 60000) })

const shown = computed(() => sortTickets(narrow(tickets.list, {
  status: status.value, assignee: assignee.value, q: q.value, answer: answer.value,
}, props.me), order.value))

const open = computed(() => tickets.open && tickets.open.ticket)
const timeline = computed(() => (tickets.open && tickets.open.timeline) || [])
const assignees = computed(() => (tickets.open && tickets.open.assignees) || [])
const chats = computed(() => (tickets.open && tickets.open.chats) || [])

const owed = (t) => owedOn(t, W.value, now.value)
const stateWord = (s) => W.value['state-' + s] || s
const priorityWord = (p) => W.value['priority-' + p] || p
/* a ticket written before the shape was two states still reads: shape.js carries what each old
   word means now, and every surface asks it rather than comparing a string of its own */
const stateOf = (t) => statusOfTicket(t)
const urgencyOf = (t) => priorityOf(t)
const viaWord = (v) => W.value['via-' + v] || ''
const nameOf = (id) => (props.agents.find((a) => a.id === id) || {}).name || W.value.someone
const said = (e) => {
  const d = e.data || {}
  if (e.kind === 'opened') return W.value['said-opened']
  if (e.kind === 'status') return (W.value['said-status'] || '').replace('{from}', stateWord(d.from)).replace('{to}', stateWord(d.to))
  if (e.kind === 'priority') return (W.value['said-priority'] || '').replace('{to}', priorityWord(d.to))
  if (e.kind === 'assigned') return (W.value['said-assigned'] || '').replace('{who}', nameOf(d.who))
  if (e.kind === 'unassigned') return (W.value['said-unassigned'] || '').replace('{who}', nameOf(d.who))
  if (e.kind === 'linked') return W.value['said-linked']
  if (e.kind === 'unlinked') return W.value['said-unlinked']
  if (e.kind === 'due') return d.at ? (W.value['said-due'] || '').replace('{when}', new Date(d.at).toLocaleDateString()) : W.value['said-due-clear']
  return ''
}
/* what was SAID is drawn as a message; what HAPPENED is a quiet line */
const isSaid = (e) => e.kind === 'reply' || e.kind === 'note' || (e.kind === 'opened' && e.body) || e.kind === 'file'

async function pick(t) { await openTicket(t.id) ; await nextTick(); foot.value && foot.value.scrollIntoView({ block: 'end' }) }
const foot = ref(null)

/* --- answering --- */
const text = ref('')
const internal = ref(false)
const busy = ref(false)
async function say() {
  const body = text.value.trim()
  if (!body || busy.value || !open.value) return
  busy.value = true
  await sayOnTicket(open.value.id, body, internal.value)
  text.value = ''
  busy.value = false
  await nextTick(); foot.value && foot.value.scrollIntoView({ block: 'end' })
}

/* --- raising one --- */
const making = ref(false)
const draft = ref({ title: '', body: '', priority: 'normal', assign: [] })
async function make() {
  if (!draft.value.title.trim()) return
  busy.value = true
  const r = await raise({ title: draft.value.title, body: draft.value.body, priority: draft.value.priority, assign: draft.value.assign.length ? draft.value.assign : null })
  busy.value = false
  making.value = false
  draft.value = { title: '', body: '', priority: 'normal', assign: [] }
  if (r && r.id) await openTicket(r.id)
}
const onIt = (id) => assignees.value.some((a) => a.id === id)
</script>

<template>
  <section class="st wq">
    <div class="st-list wq-list">
      <header class="st-head wq-head">
        <h2>{{ W.title }}</h2>
        <button type="button" class="wq-btn primary" @click="making = true"><SpaceIcon name="plus" :size="13" />{{ W.new }}</button>
      </header>
      <p class="wq-line">{{ W.line }}</p>

      <!-- every narrowing is chosen, never typed (but the search) -->
      <div class="wq-controls">
        <!-- OPEN, RESOLVED, and the one derived narrowing that is true of every kind of desk: who is
             waiting on a reply. The tabs this replaces — "In hand", "With them" — were a guess about
             how one business works, and a ticket here may be a SaaS bug or a coaching question. -->
        <!-- the state as one segmented control; whose and the order on the line under it -->
        <div class="wq-seg" role="tablist" :aria-label="W.state">
          <button v-for="o in [['open', W['state-open']], ['owed', W['state-owed']], ['resolved', W['state-resolved']], ['all', W['filter-all']]]" :key="o[0]"
            type="button" role="tab" :aria-selected="status === o[0]" :class="{ on: status === o[0] }" @click="status = o[0]">{{ o[1] }}</button>
        </div>
        <div class="wq-find">
          <SpaceIcon name="search" :size="14" />
          <input v-model="q" type="search" :placeholder="W.find" :aria-label="W.find" />
        </div>
        <div class="st-more">
          <button type="button" class="st-toggle" :class="{ on: assignee === 'mine' }" :aria-pressed="assignee === 'mine'" @click="assignee = assignee === 'mine' ? null : 'mine'">{{ W['filter-mine'] }}</button>
          <button type="button" class="st-toggle" :class="{ on: assignee === 'nobody' }" :aria-pressed="assignee === 'nobody'" @click="assignee = assignee === 'nobody' ? null : 'nobody'">{{ W['filter-nobody'] }}</button>
          <label class="st-order-wrap">
            <span class="st-sr">{{ W.sort }}</span>
            <select v-model="order" class="st-order" :aria-label="W.sort">
              <option v-for="o in ['busy', 'new', 'waiting', 'due']" :key="o" :value="o">{{ W['sort-' + o] }}</option>
            </select>
          </label>
        </div>
        <!-- and by what they were raised with, where a form raised them: a select per field, offering
             the values the site's own questions actually got back -->
        <div v-if="fields.length" class="st-answers">
          <label v-for="f in fields" :key="f.field" class="st-answer">
            <span>{{ f.field }}</span>
            <select
              :value="answer && answer.field === f.field ? answer.value : ''"
              @change="answer = $event.target.value ? { field: f.field, value: $event.target.value } : null">
              <option value="">{{ W['filter-any'] }}</option>
              <option v-for="v in f.values" :key="v.value" :value="v.value">{{ v.value }} ({{ v.tickets }})</option>
            </select>
          </label>
        </div>
      </div>

      <div class="st-rows wq-rows">
        <p v-if="tickets.loading && !tickets.list.length" class="st-empty">{{ W.loading }}</p>
        <template v-else-if="shown.length">
          <button
            v-for="t in shown" :key="t.id" type="button" class="st-row wq-row"
            :class="{ on: open && open.id === t.id, done: !isLive(t) }" @click="pick(t)">
            <span class="st-ref">{{ (W.ref || '#{n}').replace('{n}', t.ref) }}</span>
            <span class="st-mid wq-mid">
              <span class="wq-top"><b class="wq-title">{{ t.title }}</b><u class="wq-time">{{ ageOf(t, now) }}</u></span>
              <span class="st-facts wq-meta">
                <i class="st-state" :class="stateOf(t)">{{ stateWord(stateOf(t)) }}</i>
                <i v-if="urgencyOf(t) !== 'normal'" class="st-pri" :class="urgencyOf(t)">{{ priorityWord(urgencyOf(t)) }}</i>
                <i v-if="t.contact">{{ t.contact.name }}</i>
                <i v-if="Number(t.chats)"><SpaceIcon name="dm" :size="11" />{{ t.chats }}</i>
              </span>
              <span v-if="owed(t)" class="wq-due" :class="{ over: owed(t).over, soft: owed(t).soft }">{{ owed(t).text }}</span>
            </span>
            <span class="st-faces">
              <SpaceAvatar v-for="a in t.assignees.slice(0, 3)" :key="a.id" :name="a.name" :size="22" />
            </span>
          </button>
        </template>
        <!-- an empty list is said once, in the pane beside it, as the desk says it -->
        <p v-else-if="open" class="wq-quiet">{{ q || assignee || status !== 'open' ? W['empty-filtered'] : W.empty }}</p>
      </div>
    </div>

    <div class="st-pane wq-pane">
      <template v-if="open">
        <header class="st-thead wq-thead">
          <div class="wq-who">
            <h3><span class="st-ref">{{ (W.ref || '#{n}').replace('{n}', open.ref) }}</span>{{ open.title }}</h3>
            <p>
              {{ (W.opened || '').replace('{span}', ageOf(open, now)) }}
              <template v-if="viaWord(open.opened_via)"> · {{ viaWord(open.opened_via) }}</template>
            </p>
          </div>
          <span v-if="owed(open)" class="wq-due" :class="{ over: owed(open).over, soft: owed(open).soft }">{{ owed(open).text }}</span>
          <div class="wq-actions">
            <button type="button" class="wq-x" :aria-label="W.cancel" @click="closeTicket()">×</button>
          </div>
        </header>

        <div class="st-bars">
          <label class="st-bar">
            <span>{{ W.state }}</span>
            <select :value="stateOf(open)" @change="setTicket(open.id, { status: $event.target.value })">
              <option v-for="s in STATES" :key="s" :value="s">{{ stateWord(s) }}</option>
            </select>
          </label>
          <label class="st-bar">
            <span>{{ W.priority }}</span>
            <select :value="open.priority" @change="setTicket(open.id, { priority: $event.target.value })">
              <option v-for="p in PRIORITIES" :key="p" :value="p">{{ priorityWord(p) }}</option>
            </select>
          </label>
          <div class="st-bar st-who">
            <span>{{ W.assignees }}</span>
            <div class="st-whos">
              <button
                v-for="a in agents" :key="a.id" type="button" class="st-chip" :class="{ on: onIt(a.id) }"
                :title="onIt(a.id) ? W.unassign : W.assign" @click="assignTicket(open.id, a.id, !onIt(a.id))">
                <SpaceAvatar :name="a.name" :size="18" /><span>{{ a.name }}</span>
              </button>
              <span v-if="!agents.length" class="st-quiet">{{ W.nobody }}</span>
            </div>
          </div>
          <div v-if="open.contact" class="st-bar">
            <span>{{ W.contact }}</span>
            <b class="st-contact">{{ open.contact.name }}<i v-if="open.contact.email">{{ open.contact.email }}</i></b>
          </div>
          <div v-else class="st-bar"><span>{{ W.contact }}</span><b class="st-contact">{{ W['contact-none'] }}</b></div>
          <div v-if="chats.length" class="st-bar">
            <span>{{ W.chats }}</span>
            <div class="st-whos">
              <button v-for="c in chats" :key="c.id" type="button" class="st-chip" @click="linkTicket(open.id, c.id, false)">
                <SpaceIcon name="dm" :size="12" /><span>{{ W.unlink }}</span>
              </button>
            </div>
          </div>
        </div>

        <div class="st-when wq-scroll">
          <!-- WHAT IT WAS RAISED WITH, where a form raised it — at the head of the ticket, so
               nobody spends their first three replies asking what a form already asked. -->
          <div v-if="(tickets.open.answers || []).length" class="st-asked">
            <div v-for="a in tickets.open.answers" :key="a.field">
              <b>{{ a.field }}</b><span>{{ Array.isArray(a.value) ? a.value.join(', ') : a.value }}</span>
            </div>
          </div>
          <p v-else-if="open.body" class="st-body"><MessageText :blocks="messageBlocks(open.body)" /></p>
          <article v-for="e in timeline" :key="e.id" class="st-event" :class="{ said: isSaid(e), note: e.internal }">
            <!-- the customer on the left, the staff on the right, as on the desk; a ticket has more
                 than one of the staff, so each line says who -->
            <div v-if="isSaid(e)" class="wq-msg" :class="{ mine: !e.by_contact }">
              <em v-if="e.internal" class="st-noteflag">{{ W['note-only'] }}</em>
              <p class="st-text"><MessageText :blocks="messageBlocks(e.body)" /></p>
              <footer>{{ e.by_contact ? ((open.contact || {}).name || W.someone) : (e.agent_name || W.someone) }} · <time :datetime="e.created_at">{{ stampOf(e.created_at, now) }}</time></footer>
            </div>
            <p v-else class="st-happened">
              <i>{{ e.agent_name || W.someone }}</i> {{ said(e) }}
              <time :datetime="e.created_at">{{ stampOf(e.created_at, now) }}</time>
            </p>
          </article>
          <div ref="foot"></div>
        </div>

        <!-- the desk's own reply box; the one thing a ticket adds is the note only the team sees -->
        <div class="st-say" :class="{ note: internal }">
          <label class="st-switch">
            <input v-model="internal" type="checkbox" />
            <span>{{ W['note-only'] }}</span>
          </label>
          <SpaceComposer
            :key="open.id" class="wq-write" :placeholder="internal ? W.note : W.reply" :disabled="busy"
            :may-mention="false" :may-voice="false" :may-file="false" @send="(s) => { text = s.body; say() }" />
        </div>
      </template>
      <div v-else-if="!shown.length && !tickets.loading" class="su-none wq-pick">
        <h3>{{ q || assignee || status !== 'open' ? W['empty-filtered'] : W.empty }}</h3>
        <p v-if="!q && !assignee && status === 'open'">{{ W['empty-line'] }}</p>
      </div>
      <p v-else class="wq-pick">{{ W.pick }}</p>
    </div>

    <!-- raising one: the same fields the function takes, and nothing that teaches a syntax -->
    <div v-if="making" class="st-veil wq-veil" @click.self="making = false">
      <form class="st-make wq-make" @submit.prevent="make">
        <h3>{{ W.new }}</h3>
        <label>{{ W['new-title'] }}<input v-model="draft.title" type="text" :placeholder="W['new-title-hint']" /></label>
        <label>{{ W['new-body'] }}<textarea v-model="draft.body" rows="4"></textarea></label>
        <label>{{ W['new-priority'] }}
          <select v-model="draft.priority">
            <option v-for="p in PRIORITIES" :key="p" :value="p">{{ priorityWord(p) }}</option>
          </select>
        </label>
        <div class="st-makewho">
          <span>{{ W['new-assign'] }}</span>
          <div class="st-whos">
            <button
              v-for="a in agents" :key="a.id" type="button" class="st-chip" :class="{ on: draft.assign.includes(a.id) }"
              @click="draft.assign = draft.assign.includes(a.id) ? draft.assign.filter((x) => x !== a.id) : [...draft.assign, a.id]">
              <SpaceAvatar :name="a.name" :size="18" /><span>{{ a.name }}</span>
            </button>
          </div>
        </div>
        <footer>
          <button type="button" class="wq-btn" @click="making = false">{{ W.cancel }}</button>
          <button type="submit" class="wq-btn primary" :disabled="!draft.title.trim() || busy">{{ W['new-go'] }}</button>
        </footer>
      </form>
    </div>
  </section>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; every rule here says what it wants instead.
   The frame — the panes, the list's head and rows, the header, the buttons, the bubbles, the reply
   box — is work-ui.css, shared with the desk; what is here is the ticket's own: its number, state
   and priority, the properties, the people on it, what a form raised it with, the team's notes. */
.st-answers { display: flex; flex-wrap: wrap; gap: 8px }
.st-answer { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink3) }
.st-answer select { font: inherit; font-size: 12px; color: var(--ink2); background: var(--paper);
  border: 1px solid var(--hair); border-radius: 7px; padding: 3px 7px; max-width: 170px }
.st-asked { display: grid; gap: 6px; margin: 0 0 14px; padding: 12px 14px; border-radius: 10px;
  background: color-mix(in srgb, var(--ink) 4%, transparent) }
.st-asked div { display: grid; grid-template-columns: minmax(90px, 26%) minmax(0, 1fr); gap: 10px; font-size: 13px }
.st-asked b { font-family: var(--m); font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--ink3); padding-top: 2px }
.st-asked span { color: var(--ink); line-height: 1.5; white-space: pre-wrap }
/* whose, and the order */
.st-more { display: flex; align-items: center; gap: 6px }
.st-toggle { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink2); background: transparent; border: 1px solid var(--hair); border-radius: 999px;
  padding: 4px 11px; cursor: pointer; transition: background .2s, color .2s, border-color .2s }
.st-toggle:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 25%, transparent) }
.st-toggle.on { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); background: color-mix(in srgb, var(--accent) 9%, transparent) }
.st-order-wrap { margin-left: auto }
.st-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap }
.st-order { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink2); background: transparent; border: 0; padding: 4px 18px 4px 4px; cursor: pointer;
  appearance: none; -webkit-appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: calc(100% - 9px) 55%, calc(100% - 5px) 55%; background-size: 4px 4px; background-repeat: no-repeat }
.st-order:hover { color: var(--ink) }

.st-row.done .wq-title { color: var(--ink3) }
.st-ref { font-family: var(--m); font-size: 11.5px; color: var(--ink3); padding-top: 2px }
.st-facts i { flex: none; display: inline-flex; align-items: center; gap: 3px; font-style: normal }
.wq-who > h3 .st-ref { margin-right: 7px; padding: 0; font-weight: 500 }
/* a state is a word, not a colour wheel: only what is being worked and what is urgent stand out */
.st-state { font-weight: 600 }
.st-state.doing { color: var(--sp-link) }
.st-pri.urgent, .st-pri.high { font-weight: 700; color: var(--sp-warn, #b4452f) }
.st-faces { display: flex; gap: 2px }
.st-empty { margin: 0; padding: 20px; max-width: none; font-size: 13.5px; color: var(--ink3) }

.st-bars { flex: none; display: flex; flex-wrap: wrap; gap: 14px 22px; padding: 12px 16px; border-bottom: 1px solid var(--hair) }
.st-bar { display: flex; flex-direction: column; gap: 4px }
.st-bar > span { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ink3) }
.st-bar select { font: inherit; font-size: 13px; color: var(--ink); background: var(--paper);
  border: 1px solid var(--hair); border-radius: 8px; padding: 4px 8px }
.st-contact { font-family: var(--fd); font-weight: 700; font-size: 13.5px; color: var(--ink); display: flex; flex-direction: column }
.st-contact i { font-style: normal; font-weight: 400; font-size: 11.5px; color: var(--ink3) }
.st-whos { display: flex; flex-wrap: wrap; gap: 5px }
/* somebody ON IT is filled in; somebody who could be is plainly an offer rather than a fact —
   three identical chips read as three people working the ticket, which is a lie */
.st-chip { display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 12px; color: var(--ink3);
  background: transparent; border: 1px dashed color-mix(in srgb, var(--ink) 22%, transparent);
  border-radius: 20px; padding: 2px 9px 2px 3px; cursor: pointer; opacity: .7 }
.st-chip:hover { opacity: 1; color: var(--ink2) }
.st-chip.on { color: var(--ink); background: color-mix(in srgb, var(--sp-link) 16%, transparent);
  border: 1px solid transparent; opacity: 1; font-weight: 600 }
.st-chip :deep(.sav) { filter: grayscale(1); opacity: .6 }
.st-chip.on :deep(.sav) { filter: none; opacity: 1 }
.st-quiet { font-size: 12px; color: var(--ink3) }

.st-body { margin: 0 0 14px; max-width: 74ch; font-size: 14.5px; line-height: 1.5; color: var(--ink) }
.st-text { margin: 0; max-width: none; font-size: 14.5px; line-height: 1.45; color: var(--ink); overflow-wrap: anywhere }
/* a note is the one thing on a ticket the customer never sees, so it says so and looks unlike a reply */
.st-event.note .wq-msg { background: var(--sp-tint); box-shadow: inset 2px 0 0 var(--sp-tint-bar) }
.st-noteflag { display: block; margin: 0 0 2px; font-style: normal; font-size: 10px; font-weight: 700; letter-spacing: .05em;
  text-transform: uppercase; color: var(--sp-tint-bar) }
/* what happened to the ticket, between the lines said: small and centred, as a chat marks a day */
.st-happened { display: flex; flex-wrap: wrap; justify-content: center; align-items: baseline; gap: 6px; margin: 4px 0 12px;
  max-width: none; text-align: center; font-size: 12px; color: var(--ink3) }
.st-happened i { font-style: normal; font-weight: 600; color: var(--ink2) }
.st-happened time { font-family: var(--m); font-size: 10.5px }

.st-say { flex: none; padding-top: 9px; border-top: 1px solid var(--hair) }
.st-say .wq-write { border-top: 0; padding-top: 6px }
.st-switch { display: inline-flex; align-items: center; gap: 6px; margin: 0 18px; font-size: 12.5px; color: var(--ink2); cursor: pointer }
.st-say.note :deep(.sc-box) { background: var(--sp-tint); border-color: color-mix(in srgb, var(--sp-tint-bar) 40%, transparent) }

@media (max-width: 900px) {
  .st-pane { position: fixed; inset: calc(var(--headh) + var(--spbar-m-height, 0px)) 0 var(--pk-dock, 0px); z-index: 33; background: var(--paper) }
  .st-pane:has(> .wq-pick) { display: none }
}
.st-makewho { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 600; color: var(--ink2) }
</style>

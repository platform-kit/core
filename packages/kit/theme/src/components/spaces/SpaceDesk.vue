<script setup>
/*
 * The desk: one list of everyone waiting on a member of staff, and the conversation beside it.
 *
 * A coach opens three inboxes today — the support desk, the coaching chat, a space's channels — and
 * none of that difference is theirs. This is one list, longest wait first, each row saying where it
 * came from, who is waiting, what was last said and what is owed; answering writes back through the
 * system that holds it, which the surface never names. The words are the desk scope of spaces.md,
 * and a source's own word is W['source-' + row.source] — so a source removed takes its word with it.
 *
 * A row is finished with from here too, and that writes through the system that holds it: a support
 * thread is resolved for real, where its own inbox reads the same status; a coaching thread and a
 * channel are marked by the person who finished with them, and the mark holds only until the other
 * party says something else. One source keeps an assignee of its own and is the only one offered a
 * picker, because the others do not have the idea and should not be made to pretend.
 *
 * Nothing here counts: the list is what the adapters answered, the badge is arithmetic over it, and
 * the clock ticks once a minute on its own like the coach's inbox does.
 */
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { us, ug } from 'platformkit/lib/content.js'
import { owedOf, sourceForQueue, filterQueue } from 'platformkit/lib/desk/shape.js'
import {
  rows, loading, booted, source, thread, start, stop, load, openRow, closeRow, reply, replyWith,
  resolve, assign, mayAssign, agents, loadAgents, showDone, sourceStatus,
} from 'platformkit/lib/desk/index.js'
import { messageBlocks } from 'platformkit/lib/chat/markup.js'
import { raise, ticketsFor } from 'platformkit/lib/desk/tickets.js'
import { runs, runsHere, summon, stop as stopRun, BOTS, mayRun } from 'platformkit/lib/agents/api.js'

import { clockOf as clock } from 'platformkit/lib/spaces/model.js'
import { previewOf } from 'platformkit/lib/chat/model.js'
import { plainBody } from 'platformkit/lib/spaces/model.js'
import VoiceNote from '../chat/VoiceNote.vue'
import './work-ui.css'   /* the frame every Work queue wears */
import SpaceAvatar from './SpaceAvatar.vue'
import SpaceComposer from './SpaceComposer.vue'
import MessageText from '../chat/MessageText.vue'
import SpaceIcon from './SpaceIcon.vue'

const props = defineProps({
  /* which queue this is. It is a place of its own in the person's column, so the component is told
     rather than asking: Support for the desk, Clients for the conversations they are having. */
  queue: { type: String, required: true },
  names: { type: Object, default: () => ({}) },
  members: { type: Object, default: () => ({}) },
  channels: { type: Array, default: () => [] },
  me: { type: String, default: '' },
})

const W = computed(() => us('spaces').desk.main)
const text = ref('')
const sending = ref(false)
const failed = ref(false)
const foot = ref(null)
const now = ref(Date.now())
let tick = null

/* a voice note is the recorder's own mp3 and carries what the browser wrote down while it was
   spoken; a file carries whatever words were in the box as its caption */
async function saidAloud(take) {
  failed.value = false
  const made = await replyWith(take.blob, { kind: 'voice', seconds: take.seconds, said: take.transcript || '' })
  if (made) await toFoot(); else failed.value = true
}
async function attached({ file, said }) {
  failed.value = false
  const made = await replyWith(file, { kind: 'file', said: said || '' })
  if (made) await toFoot(); else failed.value = true
}
const personOf = (row) => {
  const person = row && row.person || {}
  if (!row || row.source !== 'social' || !thread.row || thread.row.key !== row.key || !thread.messages.length) return person
  const last = thread.messages.slice().reverse().find((message) => !message.mine) || thread.messages[thread.messages.length - 1]
  return {
    ...person,
    name: last.author || person.name,
    username: last.authorUsername || person.username,
    avatarUrl: last.authorAvatarUrl || person.avatarUrl,
    profileUnavailable: last.authorProfileUnavailable || person.profileUnavailable,
  }
}
const nameOf = (row) => {
  const person = personOf(row)
  return person.name || props.names[person.id] || W.value.someone
}
const handleOf = (row) => {
  const username = personOf(row).username
  if (!username) return ''
  const handle = username.startsWith('@') ? username : '@' + username
  return handle.toLowerCase() === String(nameOf(row)).toLowerCase() ? '' : handle
}
const avatarOf = (row) => personOf(row).avatarUrl || ''
const profileUnavailableOf = (row) => !!personOf(row).profileUnavailable
const handleForMessage = (message) => {
  if (!message || !message.authorUsername) return ''
  const handle = message.authorUsername.startsWith('@') ? message.authorUsername : '@' + message.authorUsername
  return handle.toLowerCase() === String(message.author || '').toLowerCase() ? '' : handle
}
const kindOf = (row) => W.value['kind-' + ((row.person && row.person.kind) || 'guest')] || ''
const sourceOf = (row) => W.value['source-' + row.source] || ''
/* where they wrote from, where a queue has such a thing: the support desk keeps the page they
   were on, and a client's conversation has nowhere to point */
const whereOf = (row) => {
  if (row.source === 'social') {
    const platform = String(row.platform || '').trim()
    const label = platform.toLowerCase() === 'x' ? 'X' : platform
    return [label, row.accountName].filter(Boolean).join(' · ')
  }
  if (!row.detail) return ''
  return row.source === 'comments'
    ? (W.value['held-under'] || '{what}').replace('{what}', row.detail)
    : (W.value['on-page'] || '').replace('{path}', row.detail)
}
const queueStatusName = computed(() => props.queue.startsWith('social-') ? 'social' : props.queue)
const queueRows = computed(() => filterQueue(rows.value, props.queue, showDone.value))
const queueDoneCount = computed(() => filterQueue(rows.value, props.queue, true).length)
const queueStatus = computed(() => sourceStatus[queueStatusName.value] || {})
const owed = (row) => owedOf(row, W.value, now.value)
const audienceKey = (row) => row && row.source === 'social'
  ? row.conversationKind === 'comment' ? 'public-reply' : 'private-dm'
  : ''
const profileIncomplete = computed(() => thread.row && thread.row.source === 'social'
  && (profileUnavailableOf(thread.row) || thread.messages.some((message) => message.authorProfileUnavailable)))
const sourcePost = computed(() => thread.row && thread.row.source === 'social'
  && thread.row.conversationKind === 'comment'
  ? thread.row.social && (thread.row.social.postBody || thread.row.social.postTitle)
  : '')

/* A PICTURE IS A PICTURE wherever it came from: the support desk hands its rows a signed url, the
   clients' queue a path the chat's own module fetches through the signed-in client. */
const isPic = (m) => !!m && m.kind === 'file' && !!m.url && (!m.type || /^image\//.test(m.type))
const saidIn = (m) => messageBlocks(m && m.body)
/* RAISING A TICKET OUT OF A CONVERSATION. This is the join between the two halves of a desk: a
   chat is where somebody said it, a ticket is the work that follows, and one chat may throw up
   several. The title is offered from what they said, because retyping it is how a desk ends up
   with "issue" fifty times, and it is a plain field they can change. */
const TW = computed(() => us('spaces').tickets.main)
/* the bot's own words: the offer, the thinking, the way to call it off */
const BW = computed(() => us('spaces').bots.main)
const raising = ref(false)
const newTitle = ref('')
const onIt = ref([])
async function raiseIt() {
  if (!newTitle.value.trim() || !thread.row) return
  const r = await raise({
    title: newTitle.value, contact: (thread.row.person || {}).id ? null : null,
    conversation: thread.row.source === 'support' ? thread.row.id : null,
  })
  raising.value = false
  newTitle.value = ''
  if (r && r.ref) onIt.value = [...onIt.value, r.ref]
}
watch(() => thread.row && thread.row.id, async (id) => {
  onIt.value = []
  if (!id || !thread.row || thread.row.source !== 'support') return
  const got = await ticketsFor(id)
  onIt.value = (got || []).map((x) => x.ref)
})

/* ASKING THE BOT, AND STOPPING IT. A desk bot is a first draft, not an answer: it reads the
   thread, looks things up, and writes something the person on the desk can send, change or
   ignore. The Stop beside it is the whole reason an agent is allowed to take its time — one that
   cannot be stopped is one somebody has to sit and watch. */
const deskBots = computed(() => BOTS.filter((b) => (b.surfaces || []).includes('support') && mayRun(b.audience)))
const thinking = computed(() => runs.here.filter((r) => ['queued', 'running'].includes(r.status)))
async function askBot(bot) {
  if (!thread.row) return
  /* what it is given is written on the run, so what it was told is a matter of record beside what
     it did with it — never fetched by the bot behind anybody's back */
  /* what the thread said is read by the SERVER (agent_transcript), not sent from here: anything a
     client sends, a client can make up. The ask is the desk's own words. */
  await summon(bot.slug, {
    surface: 'support', conversation: thread.row.id, root: thread.row.id,
    ask: (ug('spaces', 'bots').context || {}).draft || '',
  })
  watchRun()
}
/* THE ANSWER IS A DRAFT. It arrives in the box with the cursor in it, and the person on the desk
   sends it, rewrites it or throws it away — the customer never hears from a bot in their name.
   (A bot may say `answers: directly` in its own file and take the desk over; this is what the
   default looks like.) Seeding the box means remounting it, hence the stamp on the key. */
const draft = ref('')
const draftAt = ref(0)
let runTick = null
const seen = new Set()
function watchRun() {
  clearInterval(runTick)
  runTick = setInterval(async () => {
    if (!thread.row) return clearInterval(runTick)
    const all = await runsHere(thread.row.id)
    for (const r of all) {
      if (r.status !== 'done' || !r.said || seen.has(r.id)) continue
      seen.add(r.id)
      draft.value = r.said
      draftAt.value = Date.now()
    }
    if (!runs.here.length) { clearInterval(runTick); await openRow(thread.row) }
  }, 1500)
}
onBeforeUnmount(() => clearInterval(runTick))

/* a mention is read back as the name it stands for: a preview never shows a token */
const preview = (row) => (row.last
  ? (row.last.mine ? W.value.you + ': ' : '')
    + previewOf({ ...row.last, body: plainBody(row.last.body, props.names, { someone: W.value.someone }), sender_id: null },
      { deleted: W.value.withdrawn, 'voice-label': W.value.voice, 'file-label': W.value.file })
  : '')
const unreadOf = (row) => (row.unread === 1 ? W.value['unread-one'] : (W.value['unread-many'] || '').replace('{n}', row.unread))
const count = computed(() => queueRows.value.filter((r) => r.waiting_since && !r.resolved).length)
const assigning = ref(false)
const assignedTo = computed(() => {
  const id = thread.row && thread.row.assignee
  const a = id && agents.value.find((x) => x.id === id)
  return a ? a.name : ''
})
async function finish(row, done) { await resolve(row, done); if (done) closeRow() }

/* A HELD COMMENT IS NOT FINISHED WITH, IT IS DECIDED — and the two ways of deciding are not one
   control with two meanings. Publishing it and refusing it are named, side by side, because a tick
   that means "publish" on the way down and "refuse" on the way back is a tick somebody will press
   by accident on somebody else's words. */
const held = (row) => !!row && row.source === 'comments' && row.state === 'waiting'
async function decide(row, yes) {
  await resolve(row, yes)
  closeRow()
}
/* what stopped it, for the moderator alone. The author is never told which word caught them: a
   list somebody can probe is a list somebody can walk around. */
const heldWhy = (row) => (row && row.flagged
  ? (W.value['held-flagged'] || '').replace('{word}', row.flagged)
  : held(row) ? W.value.held || '' : '')
const placeholder = computed(() => (thread.row ? (W.value.placeholder || '').replace('{name}', nameOf(thread.row)) : W.value['placeholder-plain']))


const when = (v) => {
  const d = new Date(v)
  if (isNaN(d)) return ''
  const mins = Math.max(1, Math.round((now.value - d.getTime()) / 60000))
  if (mins < 60) return mins + 'm'
  const hrs = Math.round(mins / 60)
  return hrs < 24 ? hrs + 'h' : Math.round(hrs / 24) + 'd'
}
/* the time of day is said one way across the surface (clockOf in spaces/model.js); chat/model's
   clock() is a duration — a voice note's length — and reading a timestamp with it gives 0:00 */

async function pick(row) { text.value = ''; failed.value = false; await openRow(row); await toFoot() }
async function say(said) {
  const body = String((said && said.body) || '').trim()
  if (!body || sending.value) return
  sending.value = true
  failed.value = false
  const id = await reply(body)
  sending.value = false
  if (id) { text.value = ''; draft.value = ''; await toFoot() } else failed.value = true
}
async function toFoot() { await nextTick(); const el = foot.value; if (el) el.scrollTop = el.scrollHeight }

/* the place IS the narrowing: a queue is a source, set when it opens and cleared when it closes,
   so nothing in here chooses and nothing remembers a choice made somewhere else */
watch(() => props.queue, (q) => { source.value = sourceForQueue(q) }, { immediate: true })
onMounted(() => { start(); load(); loadAgents(); tick = setInterval(() => { now.value = Date.now() }, 60000) })
const bothPanes = () => { try { return window.matchMedia('(min-width: 901px)').matches } catch (e) { return true } }
watch(() => queueRows.value.length && queueRows.value[0] && queueRows.value[0].id, (first) => {
  if (first && !thread.row && bothPanes()) pick(queueRows.value[0])
}, { immediate: true })
onBeforeUnmount(() => { clearInterval(tick); stop(); closeRow() })
</script>

<template>
  <section class="sd wq">
    <div class="sd-list wq-list">
      <header class="sd-head wq-head">
        <h2>{{ W['title-' + queue] }}</h2>
      </header>
      <p class="sd-line wq-line">{{ showDone ? W['line-done'] : W['line-' + queue] }}</p>
      <p v-if="queueStatus.state === 'partial'" class="sd-line wq-line">{{ (W['partial-' + queueStatusName] || '').replace('{n}', queueStatus.failures || 0) }}</p>
      <p v-else-if="queueStatus.state === 'unavailable' || (queueStatus.state === 'ready' && !queueStatus.available)" class="sd-line wq-line">{{ W['unavailable-' + queueStatusName] }}</p>
      <div class="wq-controls">
        <div class="wq-seg" role="tablist">
          <button type="button" role="tab" :aria-selected="!showDone" :class="{ on: !showDone }" @click="showDone = false">
            {{ W['tab-waiting'] }}<i v-if="count">{{ count }}</i>
          </button>
          <button type="button" role="tab" :aria-selected="showDone" :class="{ on: showDone }" @click="showDone = true">
            {{ W['tab-done'] }}<i v-if="queueDoneCount">{{ queueDoneCount }}</i>
          </button>
        </div>
      </div>
      <div class="sd-rows wq-rows">
        <p v-if="loading && !booted" class="sd-empty">{{ W.loading }}</p>
        <!-- an empty queue is said once, in the pane beside it -->
        <button
          v-for="r in queueRows" :key="r.key" type="button" class="sd-row wq-row"
          :class="{ on: thread.row && thread.row.key === r.key, over: owed(r) && owed(r).over, gone: r.resolved }"
          @click="pick(r)">
          <SpaceAvatar :name="nameOf(r)" :src="avatarOf(r)" :size="34" />
          <span class="sd-mid wq-mid">
            <span class="sd-top wq-top">
              <b class="wq-title">{{ nameOf(r) }}</b>
              <small v-if="handleOf(r)" class="sd-handle">{{ handleOf(r) }}</small>
              <i v-if="r.source !== 'social'" class="sd-kind">{{ kindOf(r) }}</i>
              <u class="wq-time">{{ when(r.at) }}</u>
            </span>
            <span v-if="r.source === 'social'" class="sd-social-meta">
              <span class="sd-from">{{ whereOf(r) }}</span>
              <span v-if="audienceKey(r)" class="sd-audience" :class="audienceKey(r)">{{ W[audienceKey(r)] }}</span>
            </span>
            <span v-else class="sd-from wq-meta">
              <SpaceIcon :name="r.source === 'coaching' ? 'dm' : r.source === 'comments' ? 'thread' : 'inbox'" :size="12" />
              {{ sourceOf(r) }}<template v-if="whereOf(r)"> · {{ whereOf(r) }}</template>
            </span>
            <span class="sd-say wq-say">{{ preview(r) }}</span>
            <span v-if="owed(r) && r.source !== 'social'" class="wq-due" :class="{ over: owed(r).over, soft: owed(r).soft }">{{ owed(r).text }}</span>
            <span v-if="heldWhy(r)" class="sd-held" :class="{ flagged: !!r.flagged }">{{ heldWhy(r) }}</span>
          </span>
          <em v-if="r.unread && !r.resolved" class="sd-n">{{ r.unread }}</em>
          <!-- A HELD COMMENT IS NOT DECIDED FROM THE LIST. Every other row's tick means "I have
               finished with this", which is a mark on the person's own work; publishing somebody
               else's words is an act with their name on it and happens before anybody else has read
               them. One stray press on a control that appears on hover is not how that should be
               done, so the two named acts live in the pane, where the words are in front of you. -->
          <span v-if="!held(r)" class="sd-tick" :title="r.resolved ? W.reopen : W.resolve" @click.stop="finish(r, !r.resolved)">
            <SpaceIcon name="tick" :size="15" />
          </span>
        </button>
      </div>
    </div>

    <div class="sd-pane wq-pane">
      <template v-if="thread.row">
        <header class="sd-thead wq-thead" :class="{ social: thread.row.source === 'social' }">
          <span class="sd-face"><SpaceAvatar :name="nameOf(thread.row)" :src="avatarOf(thread.row)" :size="thread.row.source === 'social' ? 34 : 28" /></span>
          <span class="sd-who wq-who" :class="{ 'sd-social-who': thread.row.source === 'social' }">
            <template v-if="thread.row.source === 'social'">
              <span class="sd-social-title">
                <b>{{ nameOf(thread.row) }}</b>
                <small v-if="handleOf(thread.row)" class="sd-handle">{{ handleOf(thread.row) }}</small>
                <span v-if="audienceKey(thread.row)" class="sd-audience" :class="audienceKey(thread.row)">{{ W[audienceKey(thread.row)] }}</span>
              </span>
              <i v-if="whereOf(thread.row) || profileIncomplete" class="sd-social-provider">
                {{ whereOf(thread.row) }}<template v-if="profileIncomplete"><span v-if="whereOf(thread.row)"> · </span>{{ W['profile-incomplete'] || W['profile-unavailable'] }}</template>
              </i>
            </template>
            <template v-else>
              <b>{{ nameOf(thread.row) }}</b>
              <small v-if="handleOf(thread.row)" class="sd-handle">{{ handleOf(thread.row) }}</small>
              <i>{{ sourceOf(thread.row) }}<template v-if="whereOf(thread.row)"> · {{ whereOf(thread.row) }}</template></i>
              <i v-if="heldWhy(thread.row)" class="sd-heldwhy">{{ heldWhy(thread.row) }}</i>
            </template>
          </span>
          <span v-if="owed(thread.row) && thread.row.source !== 'social'" class="wq-due" :class="{ over: owed(thread.row).over, soft: owed(thread.row).soft }">{{ owed(thread.row).text }}</span>
          <div class="sd-actions wq-actions" :class="{ social: thread.row.source === 'social' }">
            <div v-if="mayAssign(thread.row)" class="sd-menu">
              <button type="button" class="sd-go wq-btn" @click="assigning = !assigning">
                {{ assignedTo || W.assign }}
              </button>
              <ul v-if="assigning" class="sd-drop">
                <li><button type="button" @click="assign(thread.row, null); assigning = false">{{ W.unassigned }}</button></li>
                <li v-for="a in agents" :key="a.id">
                  <button type="button" :class="{ on: thread.row.assignee === a.id }" @click="assign(thread.row, a.id); assigning = false">{{ a.name }}</button>
                </li>
              </ul>
            </div>
            <!-- the work that comes out of a conversation, raised where the conversation is -->
            <button
              v-if="thread.row.source === 'support'" type="button" class="sd-ticket wq-btn"
              :title="TW['from-chat']" @click="raising = true; newTitle = (thread.row.last || {}).body || ''">
              <SpaceIcon name="ticket" :size="14" /><span :class="{ 'wq-lbl': !onIt.length }">{{ onIt.length ? '#' + onIt.join(' #') : TW['from-chat'] }}</span>
            </button>
            <template v-if="held(thread.row)">
              <button type="button" class="sd-done wq-btn" @click="decide(thread.row, true)">
                <SpaceIcon name="tick" :size="14" />{{ W.approve }}
              </button>
              <button type="button" class="sd-refuse wq-btn" @click="decide(thread.row, false)">{{ W.refuse }}</button>
            </template>
            <button v-else type="button" class="sd-done wq-btn" :class="{ on: thread.row.resolved }" :title="thread.row.resolved ? W.reopen : W.resolve" @click="finish(thread.row, !thread.row.resolved)">
              <SpaceIcon name="tick" :size="14" /><span class="wq-lbl">{{ thread.row.resolved ? W.reopen : W.resolve }}</span>
            </button>
            <button type="button" class="sd-x wq-x" :aria-label="W.close" @click="closeRow">×</button>
          </div>
        </header>
        <div ref="foot" class="sd-scroll wq-scroll">
          <p v-if="thread.loading" class="sd-empty">{{ W.loading }}</p>
          <article v-if="sourcePost" class="sd-social-post">
            <b>{{ W['social-post-context'] }}</b>
            <p>{{ sourcePost }}</p>
          </article>
          <div v-for="m in thread.messages" :key="m.id" class="sd-msg wq-msg" :class="{ mine: m.mine, pending: m.pending, deciding: m.subject_of }">
            <p v-if="m.subject_of" class="sd-deciding">{{ W['this-one'] }}</p>
            <div v-if="thread.row.source === 'social'" class="sd-author">
              <SpaceAvatar :name="m.author || m.authorUsername || W.someone" :src="m.authorAvatarUrl || ''" :size="23" />
              <span class="sd-author-copy">
                <b>{{ m.author || m.authorUsername || W.someone }}</b>
                <small v-if="handleForMessage(m)" class="sd-handle">{{ handleForMessage(m) }}</small>
              </span>
            </div>
            <p v-if="m.deleted_at" class="sd-gone">{{ W.withdrawn }}</p>
            <template v-else>
              <!-- A FILE IS SHOWN, not described. A picture is the message — which is the whole point
                   of the gif a prompt opens with — and anything else is a chip that opens it. A line
                   may carry both a file and words, so the words are drawn after it either way. -->
              <a v-if="isPic(m)" class="sd-pic" :href="m.url" target="_blank" rel="noopener">
                <img :src="m.url" :alt="m.name || ''" loading="lazy" />
              </a>
              <a v-else-if="m.kind === 'file' && m.url" class="sd-file" :href="m.url" target="_blank" rel="noopener">
                <SpaceIcon name="ticket" :size="13" /><span>{{ m.name || W.file }}</span>
              </a>
              <p v-else-if="m.kind === 'file'" class="sd-body">{{ m.body || W.file }}</p>
              <VoiceNote v-if="m.kind === 'voice'" class="sd-voice" :message="m" :own="m.mine" />
              <p v-if="m.body && m.kind !== 'text'" class="sd-body sd-caption"><MessageText :blocks="saidIn(m)" /></p>
              <p v-else-if="m.kind === 'text' || !m.kind" class="sd-body"><MessageText :blocks="saidIn(m)" /></p>
            </template>
            <time :datetime="m.created_at">{{ clock(m.created_at) }}</time>
          </div>
        </div>
        <p v-if="thread.row.resolved" class="sd-closed">{{ W['closed-note'] }}</p>
        <div v-if="thread.row.source !== 'social' && !thread.row.resolved && (deskBots.length || thinking.length)" class="sd-bots">
          <template v-if="thinking.length">
            <span class="sd-thinking"><i></i><i></i><i></i>{{ BW.thinking }}</span>
            <button v-for="r in thinking" :key="r.id" type="button" class="sd-stop" @click="stopRun(r.id)">{{ BW.stop }}</button>
          </template>
          <button
            v-for="b in deskBots" v-else :key="b.slug" type="button" class="sd-ask"
            :disabled="runs.starting" @click="askBot(b)">
            <SpaceIcon name="sparkle" :size="13" />{{ (BW.ask || '').replace('{name}', b.name) }}
          </button>
        </div>
        <p v-if="draft" class="sd-draft"><SpaceIcon name="sparkle" :size="12" />{{ BW.draft }}</p>
        <p v-if="thread.row.source === 'social' && thread.row.canReply === false" class="sd-closed">{{ W['unsupported-reply-social'] }}</p>
        <div v-if="!thread.row.resolved && thread.row.canReply !== false && audienceKey(thread.row)" class="sd-reply-area">
          <span class="sd-audience-note" :class="audienceKey(thread.row)">
            <b>{{ W[audienceKey(thread.row)] }}</b><span aria-hidden="true"> · </span>{{ W[audienceKey(thread.row) + '-note'] }}
          </span>
        </div>
        <SpaceComposer
          v-if="!thread.row.resolved && thread.row.canReply !== false" class="sd-write wq-write" :key="thread.row.key + ':' + draftAt" :draft="draft"
          :placeholder="placeholder" :disabled="sending"
          :may-mention="false" :may-voice="thread.row.source !== 'social'" :may-file="thread.row.source !== 'social'"
          @send="say" @voice="saidAloud" @file="attached" />
        <p v-if="failed" class="sd-failed">{{ W.failed }}</p>
        <div v-if="raising" class="sd-veil wq-veil" @click.self="raising = false">
          <form class="sd-make wq-make" @submit.prevent="raiseIt">
            <h3>{{ TW.new }}</h3>
            <label>{{ TW['new-title'] }}<input v-model="newTitle" type="text" :placeholder="TW['new-title-hint']" /></label>
            <footer>
              <button type="button" class="sd-ghost wq-btn" @click="raising = false">{{ TW.cancel }}</button>
              <button type="submit" class="wq-btn primary" :disabled="!newTitle.trim()">{{ TW['new-go'] }}</button>
            </footer>
          </form>
        </div>
      </template>
      <!-- NOTHING OPEN: an empty queue says so as every empty place does; a queue with something in it
           says what to do -->
      <div v-else-if="!queueRows.length && !loading" class="su-none wq-pick">
        <h3>{{ showDone ? W['empty-done'] : W['empty-' + queue] }}</h3>
      </div>
      <p v-else class="wq-pick">{{ W.pick }}</p>
    </div>
  </section>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements — header carries padding and a rule, p a
   measure — so each class says what it wants instead. The frame (the panes, the list's head and
   rows, the header, the buttons, the bubbles) is work-ui.css, shared with Support Tickets; what is
   here is the desk's own: the tick on a row, a held comment, the bots, pictures and files, Social. */
.sd-tick { display: none; place-items: center; align-self: center; width: 26px; height: 26px; border-radius: 7px;
  color: var(--ink3); border: 1px solid var(--hair) }
.sd-row:hover .sd-tick { display: grid }
.sd-tick:hover { color: var(--sp-go); border-color: color-mix(in srgb, var(--sp-go) 50%, transparent) }
/* the one line the two acts in the header apply to; everything round it is the conversation it
   was said in, which is the whole reason the pane shows more than the line */
.sd-msg.deciding { border-left: 2px solid var(--ink); padding-left: 10px; margin-left: -12px }
.sd-deciding { margin: 0 0 4px; font-family: var(--m); font-size: 10px; font-weight: 600;
  letter-spacing: .06em; text-transform: uppercase; color: var(--ink3) }
.sd-held { align-self: start; justify-self: start; margin-top: 3px; font-family: var(--m); font-size: 10.5px; font-weight: 600; letter-spacing: .02em;
  color: var(--ink3); border: 1px solid var(--sp-hair, var(--hair)); border-radius: 6px; padding: 2px 6px; white-space: nowrap }
.sd-held.flagged { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.sd-heldwhy { font-family: var(--m); font-size: 11px; color: var(--ink3) }
.sd-done.on { color: #fff; background: var(--sp-go); border-color: transparent }
.sd-menu { position: relative }
.sd-drop { position: absolute; right: 0; top: calc(100% + 5px); z-index: 20; width: 210px; list-style: none; margin: 0;
  padding: 4px; background: var(--paper); border: 1px solid var(--hair); border-radius: 9px;
  box-shadow: 0 10px 28px color-mix(in srgb, var(--ink) 16%, transparent) }
.sd-drop button { display: block; width: 100%; text-align: left; font: inherit; font-size: 13.5px; color: var(--ink);
  background: transparent; border: 0; border-radius: 6px; padding: 6px 8px; cursor: pointer }
.sd-drop button:hover { background: color-mix(in srgb, var(--ink) 6%, transparent) }
.sd-drop button.on::after { content: ' ✓' }
.sd-closed { margin: 0; max-width: none; padding: 12px 16px 16px; font-size: 13px; color: var(--ink3);
  border-top: 1px solid var(--hair) }
.sd-row.gone .sd-mid { opacity: .6 }
.sd-chips { flex: none; display: flex; flex-wrap: wrap; gap: 5px; padding: 9px 16px 2px }
.sd-chips button { font: inherit; font-size: 12px; font-weight: 600; color: var(--ink2); background: transparent;
  border: 1px solid var(--hair); border-radius: 999px; padding: 3px 10px; cursor: pointer }
.sd-chips button.on { color: var(--paper); background: var(--ink); border-color: var(--ink) }
.sd-empty { margin: 16px; max-width: none; font-size: 14px; color: var(--ink3) }
.sd-handle { font: inherit; font-size: 10.5px; color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sd-kind { font-style: normal; font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
  color: var(--ink3); border: 1px solid var(--hair); border-radius: 4px; padding: 0 4px }
.sd-from { display: flex; align-items: center; gap: 4px; margin-top: 2px; font-size: 11.5px; font-weight: 600; color: var(--ink3); min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.sd-social-meta { display: flex; align-items: center; gap: 7px; min-width: 0; margin-top: 3px }
.sd-social-meta .sd-from { display: block; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sd-social-meta .sd-audience { flex: none; margin: 0; padding: 1px 5px; font-size: 9px }
.sd-audience { display: inline-flex; align-items: center; width: fit-content; max-width: 100%;
  margin-top: 5px; border: 1px solid var(--hair); border-radius: 5px; padding: 2px 6px;
  font-size: 10px; line-height: 1.3; font-weight: 800; letter-spacing: .045em; text-transform: uppercase;
  color: var(--ink2); background: color-mix(in srgb, var(--ink) 5%, transparent) }
.sd-audience.public-reply { color: var(--sp-go); border-color: color-mix(in srgb, var(--sp-go) 35%, var(--hair));
  background: color-mix(in srgb, var(--sp-go) 8%, transparent) }
.sd-audience.private-dm { color: var(--ink2) }
.sd-reply-area { flex: none; padding: 7px 18px 0 }
.sd-audience-note { display: block; min-width: 0; padding: 5px 9px; border-left: 2px solid var(--ink3);
  border-radius: 4px; background: color-mix(in srgb, var(--ink) 3%, transparent); font-size: 12px;
  line-height: 1.35; color: var(--ink2) }
.sd-audience-note b { font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase }
.sd-audience-note.public-reply { border-left-color: var(--sp-go) }
.sd-social-post { flex: none; margin: 14px 18px 8px; padding: 12px 14px; border: 1px solid var(--hair);
  border-radius: 10px; background: color-mix(in srgb, var(--ink) 3%, var(--paper)) }
.sd-social-post b { display: block; margin-bottom: 6px; font-size: 11px; font-weight: 800;
  letter-spacing: .05em; text-transform: uppercase; color: var(--ink3) }
.sd-social-post p { margin: 0; max-width: none; font-size: 13.5px; line-height: 1.5; color: var(--ink);
  white-space: pre-wrap; overflow-wrap: anywhere }
.sd-n { align-self: center; min-width: 18px; height: 18px; display: grid; place-items: center; font-style: normal;
  font-size: 11px; font-weight: 800; color: #fff; background: var(--sp-badge); border-radius: 999px; padding: 0 5px }
.sd-who .sd-handle { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.sd-author { display: flex; align-items: center; gap: 7px; margin: 0 0 6px; color: var(--ink3) }
.sd-author-copy { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 7px; min-width: 0 }
.sd-author-copy b { font-size: 10.5px; line-height: 1.3; font-weight: 700; color: var(--ink3) }
.sd-thead.social .sd-social-who { flex: 1; min-width: 0 }
.sd-social-title { display: flex; align-items: center; gap: 7px; min-width: 0 }
.sd-social-title b { display: block; max-width: 12em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sd-social-title .sd-handle { max-width: 10em }
.sd-social-title .sd-audience { flex: none; margin: 0; padding: 1px 6px; font-size: 9px }
.sd-social-provider { display: block; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-style: normal; font-size: 11px; color: var(--ink3) }
/* the bot's own row: an offer while nothing is running, and while something is, the one control
   that matters */
.sd-draft { display: flex; align-items: center; gap: 5px; margin: 0; padding: 6px 18px 0; font-size: 12px; color: var(--ink3) }
.sd-bots { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 18px 0 }
.sd-ask { display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 12.5px; font-weight: 600;
  color: var(--ink2); background: transparent; border: 1px dashed color-mix(in srgb, var(--ink) 22%, transparent);
  border-radius: 20px; padding: 4px 11px; cursor: pointer }
.sd-ask:hover { color: var(--ink); border-style: solid; background: color-mix(in srgb, var(--ink) 4%, transparent) }
.sd-ask:disabled { opacity: .5; cursor: default }
.sd-thinking { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; color: var(--ink3) }
.sd-thinking i { width: 4px; height: 4px; margin-right: 1px; border-radius: 50%; background: currentColor;
  animation: sd-think 1.2s infinite ease-in-out }
.sd-thinking i:nth-child(2) { animation-delay: .15s }
.sd-thinking i:nth-child(3) { animation-delay: .3s; margin-right: 5px }
@keyframes sd-think { 0%, 60%, 100% { opacity: .25 } 30% { opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .sd-thinking i { animation: none; opacity: .6 } }
.sd-stop { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink); background: transparent;
  border: 1px solid var(--hair); border-radius: 20px; padding: 3px 11px; cursor: pointer }
.sd-stop:hover { background: color-mix(in srgb, var(--ink) 6%, transparent) }
/* a conversation grows from the foot, as every other message list on the surface does: a short
   one sitting at the top with a screenful of nothing between it and the reply box reads as the
   middle of something that failed to load */
.sd-scroll { display: flex; flex-direction: column; justify-content: flex-end }
.sd-msg.pending { opacity: .6 }
/* A PICTURE IS THE MESSAGE, so it fills the bubble and the bubble gives it no padding to sit in;
   it keeps its own shape and is capped so a tall one cannot push the thread about. */
.sd-msg:has(.sd-pic) { padding: 3px; max-width: 76% }
/* the picture has the bubble to its edges, so anything said beside it needs its own room back */
.sd-msg:has(.sd-pic) .sd-caption, .sd-msg:has(.sd-pic) time { padding: 0 6px }
.sd-msg:has(.sd-pic) time { padding-bottom: 3px }
.sd-pic { display: block; line-height: 0 }
.sd-pic img { display: block; width: 100%; max-height: 320px; object-fit: contain; border-radius: 10px; background: color-mix(in srgb, var(--ink) 5%, transparent) }
/* anything that is not a picture is a chip that opens it */
.sd-file { display: inline-flex; align-items: center; gap: 7px; max-width: 100%; font-size: 13.5px;
  color: var(--ink); text-decoration: none; padding: 5px 9px; border: 1px solid var(--hair); border-radius: 9px }
.sd-file:hover { background: color-mix(in srgb, var(--ink) 6%, transparent) }
.sd-file span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sd-voice { margin: 2px 0; max-width: 100% }
/* words beside a file are a caption, not the message */
.sd-caption { margin-top: 5px; font-size: 13.5px; color: var(--ink2) }
.sd-body { margin: 0; max-width: none; font-size: 14.5px; line-height: 1.45; color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere }
.sd-gone { margin: 0; max-width: none; font-size: 14px; font-style: italic; color: var(--ink3) }
.sd-failed { margin: 0 14px 10px; max-width: none; font-size: 12.5px; color: var(--sp-badge) }
@media (max-width: 900px) {
  .sd-pane { position: fixed; inset: calc(var(--headh) + var(--spbar-m-height, 0px)) 0 var(--pk-dock, 0px); z-index: 33; background: var(--paper) }
  .sd-pane:has(> .wq-pick) { display: none }
  .sd-social-title .sd-handle { display: none }
}
</style>

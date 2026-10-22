<script setup>
/*
 * The support panel: what opens over the launcher. One view at a time — the reader's
 * conversations (any number; a new one from the button), the open thread (the team's lines
 * on paper, theirs in ink, a prompt's opening line as a note; a resolved thread says so and
 * reopens on their next line), and the start of a new one. Identity is the account and nothing
 * else: a guest types no name and no address — they write as a guest, and the panel offers the
 * site's own sign-in (window.DLauth, the support intent) so replies can reach them by email; a
 * signed-in reader whose address is not yet confirmed is offered the confirmation link again
 * (the app's own gate, auth.js). The start view rests on a prompt: the teaser's, when the reader
 * answered one, else the desk's default (`when: default` — src/lib/support/prompts.js), its line
 * above the box and its choices as buttons; a choice is sent as the reader's first line the moment
 * it is clicked (the thread opens on it). The sign-in and confirm-your-address strips appear only
 * once the reader has a line in a thread. A prompt's showing, a choice, a thread begun are events. State and traffic are src/lib/support/api.js; words are
 * content/app/ui/support.md (widget).
 */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { ROUTES } from 'platformkit/lib/router.js'
import { session, user, emailVerified, resendConfirmation } from 'platformkit/lib/auth.js'
import { contact, conversations, thread, ME, bot, askBot, wantHuman, markSorted, openThread, closeThread, start, send, upload, withdraw, typing, agentTyping, markRead, siteUrl } from 'platformkit/lib/support/api.js'
import { daySections, groupRuns, previewOf, whenOf } from 'platformkit/lib/chat/model.js'
import { track } from 'platformkit/lib/support/prompts.js'
import { offerOf } from 'platformkit/lib/support/when.js'
import { LOCKDOWN } from 'platformkit/lib/lockdown.js'
import ChatBubble from '../chat/ChatBubble.vue'
import SupportComposer from './SupportComposer.vue'
import SupportMark from './SupportMark.vue'
import SupportTickets from './SupportTickets.vue'
import ChatChoices from '../chat/ChatChoices.vue'

const props = defineProps({
  /* a prompt the reader is answering (a teaser's): { id, text, choices } */
  prompt: { type: Object, default: null },
  /* the choice they picked on the teaser, if any */
  choice: { type: Object, default: null },
  /* the desk's resting prompt, for a fresh start */
  fallback: { type: Object, default: null },
})
const emit = defineEmits(['close', 'answered'])
const S = us('support').widget
const P = S.panel, I = S.identity, L = S.launcher, CW = S.composer, T = S.tickets, A = S.assistant

/*
 * THE ASSISTANT'S TWO BUTTONS.
 *
 * Offered as `ask`, nothing runs until somebody presses — so the button appears once they have said
 * something, and disappears the moment they ask for a person or a person answers. `always` needs no
 * button at all: it is already answering.
 *
 * "Talk to a person" is there whenever a bot is in play, and it does not ask the bot to hand over —
 * it writes a row the server checks before starting anything. A bot you cannot get away from is a
 * bad bot.
 */
const askedForHuman = computed(() => !!(thread.conversation && thread.conversation.bot_off_at))
const aPersonAnswered = computed(() => thread.messages.some((m) => m.author === 'agent' && !m.bot))
const botIsInPlay = computed(() => !!bot.value && !askedForHuman.value && !aPersonAnswered.value)
/* the last thing anybody actually SAID — the acknowledgement and the other system lines are the
   desk talking about the conversation rather than in it, so they do not count as an answer */
const lastSaid = computed(() => {
  const said = thread.messages.filter((m) => !m.deleted_at && (m.author === ME || m.author === 'agent'))
  return said[said.length - 1] || null
})
/*
 * A CONVERSATION HAS ONE HANDLER, and the reader chooses it once.
 *
 * Which is how every desk that does this models it. A button under each message asks the reader to
 * route their own conversation over and over; the first version of this did that, and it offered
 * "get an instant answer" directly beneath an answer it had just given.
 *
 * So: an `ask` bot offers itself ONCE, while their question is unanswered and it has not spoken.
 * After it answers, what sits under the answer is the resolution check — did that help — which is
 * where the way out lives and where every other desk puts it.
 */
const botHasSpoken = computed(() => thread.messages.some((m) => m.bot))
const mayRoute = computed(() => botIsInPlay.value && bot.value.offer === 'ask' && !botHasSpoken.value
  && !!lastSaid.value && lastSaid.value.author === ME)

/*
 * DID THAT HELP — the check after an answer, and the two steps behind it.
 *
 *   null     nothing asked
 *   helped   did that help?            yes → more        | talk to a person → handover
 *   more     anything else?            yes → go          | no → their thread is sorted
 *   go       go ahead, the box is open
 *
 * It is ephemeral: it belongs to the answer on screen, not to the conversation, so it is a ref and
 * not a row. A new line from either side clears it.
 */
const checking = ref(null)
const answered = computed(() => botIsInPlay.value && !!lastSaid.value && !!lastSaid.value.bot)
/* the check belongs to an answer you WATCHED ARRIVE, not to every time the panel is opened. Asking
   "did that help?" again about an answer from last Tuesday is a bot that has lost the thread — so
   the first load of a conversation sets no check, and only a line landing after that does. */
const settled = ref(0)
watch(() => thread.id, () => { checking.value = null; settled.value = 0 })
watch(() => thread.messages.length, (n) => {
  if (!settled.value) { settled.value = n; return }
  settled.value = n
  /* an answer that ends in choices has already said what happens next: two rows of buttons is noise */
  checking.value = answered.value && !liveOffer.value ? 'helped' : null
})
function helped() { checking.value = 'more' }
async function noMore() {
  checking.value = null
  try { await markSorted() } catch (e) { /* the thread stays as it was */ }
}
function oneMore() {
  checking.value = 'go'
  nextTick(() => { if (composer.value && composer.value.focus) composer.value.focus() })
}
const asking = ref(false)
const cannot = ref(false)
async function askTheBot() {
  if (asking.value) return
  asking.value = true; cannot.value = false
  try { cannot.value = !(await askBot()) } catch (e) { cannot.value = true } finally { asking.value = false }
}
async function askForHuman() { try { await wantHuman() } catch (e) { /* the note stays as it was */ } }
/* "the assistant has stepped back" is reassurance for the gap between asking for a person and one
   arriving. Outside that gap it is noise — with no bot on offer it describes an assistant the
   reader has never met, and once somebody has replied the reply says it better. */
const handedOver = computed(() => askedForHuman.value && !!bot.value && !aPersonAnswered.value)
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))

/* list | thread | start */
const view = ref('list')
/* chats | tickets — which side of the list the reader is looking at. The tab is the honest way
   to show two kinds of thing: a conversation is something you are having, a ticket is something
   somebody owes you, and mixing them into one feed loses exactly that. */
const side = ref('chats')
/* the prompt the start view rests on, and the choice in hand */
const active = computed(() => props.prompt || props.fallback || null)
const picked = ref(null)
/* a choice made on the teaser arrives with the panel: sent as the first line at once */
watch(() => props.choice, (c) => { if (c) pick(c) })
let shownFor = null
watch([view, active], ([v, a]) => { if (v !== 'start') { shownFor = null; return } if (a && !props.prompt && shownFor !== a.id) { shownFor = a.id; track.shown(a, 'default') } }, { immediate: true })
/* the choices offered next: a picked choice's children, until one without any is picked */
const followups = ref([])
const promptFor = ref(null)   /* the prompt the follow-ups belong to */
async function pick(c) {
  if (busy.value) return
  const a = active.value || promptFor.value
  if (!a) return
  track.chose(a, c)
  /* A CHOICE MAY OPEN A FORM, OR GO SOMEWHERE. It is how a desk with no chatbot still collects the
     four things nobody wants to ask one at a time over three days: the choice is recorded as any
     other, and then the reader is taken to what it points at rather than left typing into a box. */
  if (c.form || c.href) { window.location.assign(c.form ? ROUTES.form + '/' + c.form : c.href); return }
  followups.value = c.children && c.children.length ? c.children : []
  promptFor.value = a
  if (thread.id && view.value === 'thread') {
    err.value = ''; busy.value = true
    try { await send('', { prompt_id: a.id, choice: c.key, text: c.text }); toFoot() } catch (e) { err.value = P.error } finally { busy.value = false }
  } else {
    picked.value = c
    await begin('')
  }
  nextTick(() => composer.value && composer.value.focus && composer.value.focus())
}
/* the desk is writing: read every second while the thread is open */
const tick = ref(0)
const typingNow = computed(() => { void tick.value; return view.value === 'thread' && agentTyping() })
const ticker = setInterval(() => { tick.value++ }, 1000)
onBeforeUnmount(() => clearInterval(ticker))
async function takeBack(id) { await withdraw(id) }
const busy = ref(false), err = ref('')
const composer = ref(null)
const scroller = ref(null)

/* who the reader is, from the account alone: a guest is anonymous until they sign in; a
   reader's address counts once it has answered the app's confirmation */
const signedIn = computed(() => !!session.value)
const verified = computed(() => signedIn.value && (emailVerified.value || !!(contact.value && contact.value.verified)))
const asName = computed(() => (contact.value && contact.value.name) || (user.value && user.value.email) || '')
function signIn() { if (window.DLauth) window.DLauth.open({ intent: 'support' }) }
const resent = ref(false)
async function resend() { if (!user.value || resent.value) return; try { await resendConfirmation(user.value.email); resent.value = true } catch (e) { err.value = P.error } }

function goList() { closeThread(); followups.value = []; view.value = 'list'; err.value = '' }
function goStart() { closeThread(); followups.value = []; view.value = 'start'; err.value = ''; nextTick(() => composer.value && composer.value.focus && composer.value.focus()) }
async function goThread(id) { followups.value = []; view.value = 'thread'; err.value = ''; await openThread(id); toFoot() }

/* where to land on opening: a prompt → start; one thread → in it; else the list */
onMounted(() => {
  if (props.prompt) { view.value = 'start'; if (props.choice) pick(props.choice); return }
  if (thread.id) { view.value = 'thread'; toFoot(); return }
  /* a returning reader lands in their latest thread, at its foot, as though they had just written */
  if (conversations.value.length) { goThread(conversations.value[0].id); return }
  view.value = 'start'
})
watch(() => props.prompt, (p) => { if (p) { closeThread(); view.value = 'start' } })

/* ---- the thread ---- */
const sections = computed(() => daySections(thread.messages, Date.now(), { today: P.today, yesterday: P.yesterday }).map((s) => ({ ...s, messages: groupRuns(s.messages) })))
/* the thread as one keyed list — a day's label, then its lines — so each arrival can move in */
/*
 * A BOT MAY OFFER CHOICES, in the one grammar a prompt already uses: an answer whose last lines are
 * a `- ` list ends in buttons, and the words are sent as the reader's own next line. Which is worth
 * a paragraph, because the alternative was a second mechanism — a JSON shape only a model may
 * write, checked nowhere, drawn by its own component.
 *
 * Here the model writes markdown, splitChoices takes the list off exactly as it does for a prompt's
 * tree, and a press is an ordinary message. So a bot with no idea any of this exists still works
 * (its list renders as a list), a site may read the buttons in the transcript afterwards, and there
 * is nothing to keep in step.
 *
 * Only the LAST answer's list becomes buttons. An older one keeps its list as text, because a
 * button under an answer from last Tuesday offers a route the conversation has long since left —
 * the same reason the check belongs to an answer you watched arrive.
 */
/*
 * WHAT A BOT OFFERED. The row carries it — the answer's list was cut off its words on the way in —
 * so nothing here reparses markdown, and the reader is never shown the grammar (the arrow that
 * points a choice at a form read as an arrow and a path, the one time this was cut at render).
 *
 * Which set is live is the shared rule (offerOf): the last answer, not taken, nothing said after
 * it. An earlier set stays under its own answer, spent, with the one that was taken marked.
 */
const offer = computed(() => offerOf(thread.messages))
/* and it is the bot's, so it goes when the bot does: somebody who has asked for a person is
   waiting for one, not being offered another lap of the assistant */
const liveOffer = computed(() => (offer.value && offer.value.live && botIsInPlay.value && status.value !== 'resolved' ? offer.value.id : null))
const lines = computed(() => sections.value.flatMap((s) => [{ key: 'day:' + s.key, day: s.label }]
  .concat(s.messages.map((m) => ({ key: m.id, m })))))
/* a choice is the reader saying those words: the offer's row says what they are, not the client */
async function choose(m, c) {
  if (busy.value) return
  /* the same arrow a prompt's choice may carry: a bot may point at a form or a page */
  if (c.form || c.href) { window.location.assign(c.form ? ROUTES.form + '/' + c.form : c.href); return }
  err.value = ''; busy.value = true
  try { await send('', { offer: m.id, choice: c.key, text: c.text }); toFoot() } catch (e) { err.value = P.error } finally { busy.value = false }
}
const status = computed(() => (thread.conversation && thread.conversation.status) || 'open')
/* the reader has a line in the open thread: only then is who they are worth asking about */
const written = computed(() => view.value === 'thread' && thread.messages.some((m) => m.author === 'contact'))
/* the way in is offered only while there is one: under lockdown a sign-in is refused or undone at once (and
   undoing it drops the guest's token, and with it the thread from their device), so a guest just stays a guest */
const wayIn = computed(() => written.value && !LOCKDOWN)
const agentReadAt = computed(() => (thread.conversation && thread.conversation.agent_read_at) || null)
/* the person on the other side of the open thread: the last agent who wrote, else the house */
const agentName = computed(() => { for (let i = thread.messages.length - 1; i >= 0; i--) { const m = thread.messages[i]; if (m.author === 'agent' && m.agent_name) return m.agent_name } const c = conversations.value.find((x) => x.id === thread.id); return (c && c.agent_name) || '' })
/* the latest exchange stays in view: scrolled now, and again as lines settle and pictures arrive */
let footTimers = []
function toFoot() {
  for (const t of footTimers) clearTimeout(t); footTimers = []
  const go = () => { const el = scroller.value || (root.value && root.value.querySelector('.sp-body')); if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) }
  nextTick(go)
  for (const ms of [120, 320, 600]) footTimers.push(setTimeout(go, ms))
}
/* a picture landing anywhere in the panel changes a body's height: back to the foot (load does not bubble; capture does) */
const root = ref(null)
onMounted(() => { if (root.value) root.value.addEventListener('load', toFoot, true) })
watch(view, () => toFoot())
watch(scroller, (el) => { if (el) toFoot() })
watch(() => thread.messages.length, () => { toFoot(); if (view.value === 'thread') markRead() })

async function reply(text) {
  err.value = ''; busy.value = true
  try { await send(text); toFoot() } catch (e) { err.value = P.error } finally { busy.value = false }
}

/* ---- a new conversation ---- */
async function begin(text) {
  err.value = ''
  const body = String(text || '').trim()
  const a = active.value, c = picked.value
  if (!body && !c) return
  busy.value = true
  try {
    await start({ body, prompt_id: a ? a.id : undefined, choice: c ? c.key : undefined })
    track.started(a, c)
    picked.value = null
    if (props.prompt) emit('answered')
    view.value = 'thread'; toFoot()
  } catch (e) {
    if (e.status === 409 && e.data && e.data.conversation_id) { emit('answered'); await goThread(e.data.conversation_id) }
    else err.value = P.error
  } finally { busy.value = false }
}

/* ---- a file, a voice note: in the open thread, or as the first line of a new one ---- */
const MAX_FILE = 10 * 1024 * 1024
const ALLOWED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain']
async function ensureThread() {
  if (thread.id) return true
  const a = active.value
  await start({ prompt_id: a ? a.id : undefined, attach: true })
  track.started(a, null)
  if (props.prompt) emit('answered')
  view.value = 'thread'
  return !!thread.id
}
async function sendFile(file) {
  err.value = ''
  if (!file) return
  if (file.size > MAX_FILE) { err.value = CW['too-big']; return }
  if (!ALLOWED.includes(String(file.type || '').toLowerCase())) { err.value = CW['not-allowed']; return }
  busy.value = true
  try { if (await ensureThread()) { await upload(file, { kind: 'file' }); toFoot() } } catch (e) { err.value = e.status === 413 ? CW['too-big'] : e.status === 415 ? CW['not-allowed'] : CW['upload-failed'] } finally { busy.value = false }
}
async function sendVoice({ blob, seconds, transcript }) {
  err.value = ''; busy.value = true
  try { if (await ensureThread()) { await upload(new File([blob], 'voice.mp3', { type: 'audio/mpeg' }), { kind: 'voice', seconds, transcript }); toFoot() } } catch (e) { err.value = CW['upload-failed'] } finally { busy.value = false }
}
/* drag and drop over the whole panel */
const dragging = ref(0)
function dragIn(e) { if ([...(e.dataTransfer && e.dataTransfer.types || [])].includes('Files')) { dragging.value++ } }
function dragOut() { dragging.value = Math.max(0, dragging.value - 1) }
function dropped(e) { dragging.value = 0; const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f && view.value !== 'list') sendFile(f) }

/* anything that grows the thread's foot — a strip, the follow-ups, the dots — keeps the foot in view */
watch([written, () => followups.value.length, typingNow], () => { if (view.value === 'thread') toFoot() })

const statusWord = (s) => P['status-' + s] || ''
const preview = (c) => previewOf(c.last, { deleted: P.withdrawn })
const at = (c) => whenOf(c.last_message_at || c.created_at, Date.now(), { yesterday: P.yesterday })
</script>

<template>
  <div ref="root" class="sp" role="dialog" :aria-label="P.title" @dragenter.prevent="dragIn" @dragover.prevent @dragleave="dragOut" @drop.prevent="dropped">
    <Transition name="sp-fade"><div v-if="dragging > 0 && view !== 'list'" class="sp-drop"><span>{{ CW.drop }}</span></div></Transition>
    <header class="sp-head">
      <button v-if="view !== 'list' && conversations.length" type="button" class="sp-ic" :aria-label="P.back" :title="P.back" @click="goList">
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5"/></svg>
      </button>
      <SupportMark :name="view === 'thread' ? agentName : ''" :size="34" />
      <div class="sp-headtext">
        <b>{{ view === 'thread' && thread.conversation ? (agentName || P.team) : P.title }}</b>
        <small v-if="view === 'thread' && thread.conversation && status !== 'open'">{{ statusWord(status) }}</small>
        <small v-else>{{ P.subtitle }}</small>
      </div>
      <button v-if="view === 'list'" type="button" class="sp-ic" :aria-label="P.new" :title="P.new" @click="goStart">
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11"/></svg>
      </button>
      <button type="button" class="sp-ic" :aria-label="L.close" :title="L.close" @click="emit('close')">
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
    </header>

    <div v-if="view === 'list'" class="sp-tabs" role="tablist">
      <button type="button" role="tab" :aria-selected="side === 'chats'" :class="{ on: side === 'chats' }" @click="side = 'chats'">{{ T['tab-chats'] }}</button>
      <button type="button" role="tab" :aria-selected="side === 'tickets'" :class="{ on: side === 'tickets' }" @click="side = 'tickets'">{{ T['tab-tickets'] }}</button>
    </div>

    <Transition name="sp-view" mode="out-in">
    <!-- what somebody owes them, rather than what they are saying -->
    <SupportTickets v-if="view === 'list' && side === 'tickets'" key="tickets" class="sp-body" />

    <!-- the conversations -->
    <div v-else-if="view === 'list'" key="list" class="sp-body sp-list">
      <p class="sp-eyebrow">{{ P.conversations }}</p>
      <button v-for="c in conversations" :key="c.id" type="button" class="sp-row" :class="{ unread: c.unread > 0, resolved: c.status === 'resolved' }" @click="goThread(c.id)">
        <SupportMark :name="c.agent_name || ''" :size="34" />
        <span class="sp-rowtext">
          <b>{{ c.last && c.last.author === 'agent' ? (c.agent_name || P.team) : c.last && c.last.author === 'system' ? P['prompt-label'] : P.you }}<i v-if="c.status === 'resolved'">{{ statusWord('resolved') }}</i></b>
          <span>{{ preview(c) }}</span>
        </span>
        <span class="sp-rowmeta"><time>{{ at(c) }}</time><i v-if="c.unread > 0">{{ c.unread }}</i></span>
      </button>
      <button type="button" class="sp-btn sp-newbtn" @click="goStart">{{ P.new }}</button>
    </div>

    <!-- the thread: every line moves in as it arrives, the first load in a soft cascade -->
    <div v-else-if="view === 'thread'" key="thread" ref="scroller" class="sp-body sp-thread">
      <p v-if="thread.loading && !thread.messages.length" class="sp-note">{{ P.loading }}</p>
      <TransitionGroup name="sp-line" tag="div" class="sp-lines" appear>
        <template v-for="(l, i) in lines" :key="l.key">
          <div v-if="l.day" class="sp-day" :style="{ '--i': Math.min(i, 12) }"><span>{{ l.day }}</span></div>
          <a v-else-if="l.m.author === 'system' && l.m.kind === 'file'" class="sp-sysimg" :style="{ '--i': Math.min(i, 12) }" :href="l.m.url" target="_blank" rel="noopener"><img :src="l.m.url" alt="" loading="lazy" /></a>
          <div v-else-if="l.m.author === 'system'" class="sp-sys" :class="{ 'sp-ack': i > 0 && lines[i - 1].m && lines[i - 1].m.author === 'contact' }" :style="{ '--i': Math.min(i, 12) }"><small v-if="!(i > 0 && lines[i - 1].m && lines[i - 1].m.author === 'contact')">{{ P['prompt-label'] }}</small><p>{{ l.m.body }}</p></div>
          <div v-else class="sp-linewrap" :class="{ own: l.m.author === 'contact' }" :style="{ '--i': Math.min(i, 12) }">
            <small v-if="l.m.author === 'agent' && l.m.first" class="sp-who">{{ l.m.bot ? A.by : (l.m.agent_name || P.team) }}</small>
            <ChatBubble :message="l.m" :me="ME" :peer-read-at="agentReadAt" :actions="['remove']" @remove="takeBack(l.m.id)" />
            <ChatChoices :choices="l.m.choices || []" :live="l.m.id === liveOffer" :taken="l.m.choice_key || ''" :busy="busy" @choose="(c) => choose(l.m, c)" />
          </div>
        </template>
      </TransitionGroup>
      <Transition name="sp-rise"><div v-if="typingNow" class="sp-typing" :aria-label="fill(P.typing, { name: agentName || P.team })"><span /><span /><span /></div></Transition>
      <Transition name="sp-rise"><ChatChoices v-if="followups.length && status !== 'resolved'" class="sp-followups" :choices="followups" :busy="busy" @choose="pick" /></Transition>
      <!-- the routing choice, once: an instant answer, or somebody -->
      <Transition name="sp-rise">
        <div v-if="mayRoute && status !== 'resolved'" class="sp-assist">
          <p class="sp-note sp-asknote">{{ A.route }}</p>
          <div class="sp-choices">
            <button type="button" class="sp-choice" :disabled="asking || busy" @click="askTheBot">{{ asking ? A.asking : A.ask }}</button>
            <button type="button" class="sp-choice sp-human" :disabled="busy" @click="askForHuman">{{ A.wait }}</button>
          </div>
        </div>
      </Transition>
      <p v-if="cannot" class="sp-note">{{ A.unavailable }}</p>
      <p v-else-if="handedOver" class="sp-note">{{ A.handed }}</p>
      <!-- and after an answer, the check — which is where the way out lives -->
      <Transition name="sp-rise">
        <div v-if="checking && status !== 'resolved'" class="sp-assist">
          <p class="sp-note sp-asknote">{{ checking === 'go' ? A['go-ahead'] : checking === 'more' ? A.more : A.helped }}</p>
          <div v-if="checking !== 'go'" class="sp-choices">
            <template v-if="checking === 'helped'">
              <button type="button" class="sp-choice" :disabled="busy" @click="helped">{{ A['helped-yes'] }}</button>
              <button type="button" class="sp-choice sp-human" :disabled="busy" @click="askForHuman">{{ A.human }}</button>
            </template>
            <template v-else>
              <button type="button" class="sp-choice" :disabled="busy" @click="oneMore">{{ A['more-yes'] }}</button>
              <button type="button" class="sp-choice sp-human" :disabled="busy" @click="noMore">{{ A['more-no'] }}</button>
            </template>
          </div>
        </div>
      </Transition>
      <p v-if="status === 'resolved'" class="sp-note sp-resolved">{{ P['resolved-note'] }}</p>
      <p v-else-if="verified && thread.messages.length && !thread.messages.some((m) => m.author === 'agent')" class="sp-note">{{ P['away-note'] }}</p>
      <!-- who they are, from the account alone — the acknowledgement's own box, the last thing in the history, so it
           scrolls with the thread and stays under whatever arrives -->
      <Transition name="sp-rise">
        <div v-if="wayIn && !signedIn" class="sp-sys sp-ack sp-id"><p>{{ I.anonymous }}</p><button type="button" class="sp-idbtn" @click="signIn">{{ I['anonymous-cta'] }}</button></div>
        <div v-else-if="wayIn && !verified" class="sp-sys sp-ack sp-id"><p>{{ resent ? I['unverified-sent'] : I.unverified }}</p><button v-if="!resent" type="button" class="sp-idbtn" @click="resend">{{ I['unverified-cta'] }}</button></div>
      </Transition>
    </div>

    <!-- a new conversation -->
    <div v-else key="start" class="sp-body sp-start">
      <div v-if="active" class="sp-sys sp-promptline"><small>{{ P['prompt-label'] }}</small><p>{{ active.text }}</p><img v-if="active.image" class="sp-promptimg" :src="siteUrl(active.image)" alt="" /></div>
      <template v-if="active && active.choices && active.choices.length">
        <ChatChoices :choices="active.choices" :busy="busy" @choose="pick" />
        <p class="sp-choosehint">{{ P.choose }}</p>
      </template>
      <template v-if="!active">
        <h3 class="sp-h">{{ P['empty-heading'] }}</h3>
        <p class="sp-p">{{ P['empty-body'] }}</p>
      </template>
      <p v-if="asName" class="sp-as">{{ fill(I['writing-as'], { name: asName }) }}</p>
    </div>
    </Transition>

    <p v-if="err" class="sp-err">{{ err }}</p>
    <footer v-if="view !== 'list'" class="sp-foot">
      <SupportComposer ref="composer" :busy="busy" :placeholder="view === 'thread' && thread.messages.length && thread.messages.every((m) => m.author !== 'agent') && picked ? P['more-placeholder'] : ''" :autofocus="view === 'start'" @send="view === 'start' ? begin($event) : reply($event)" @file="sendFile" @voice="sendVoice" @typing="view === 'thread' && typing()" />
    </footer>
  </div>
</template>

<style scoped>
/* the bubbles read the palette, so both themes work without a look's own colours */
.sp { position: relative; --chat-peer: color-mix(in srgb, var(--ink) 7%, var(--paper)); --chat-field: color-mix(in srgb, var(--ink) 5%, var(--paper)); --chat-own: var(--ink); --chat-own-ink: var(--paper); display: flex; flex-direction: column; box-sizing: border-box; margin: 0; padding: 0; width: min(380px, calc(100vw - 32px)); height: min(720px, calc(100vh - 110px)); max-height: calc(100dvh - 100px);
  background: var(--paper); color: var(--ink); border: 1px solid var(--hair); border-radius: 20px; overflow: hidden;
  box-shadow: 0 30px 70px -30px #000c, 0 1px 2px #0000000d }
.sp-head { display: flex; align-items: center; gap: 10px; padding: 12px 10px 12px 14px; border-bottom: 1px solid var(--hair); background: color-mix(in srgb, var(--ink) 3%, var(--paper)) }
.sp-headtext { flex: 1; min-width: 0 }
.sp-headtext b { display: block; font-family: var(--fd); font-weight: 600; font-size: 15.5px; letter-spacing: -.01em; line-height: 1.2 }
.sp-headtext small { display: block; font-size: 12.5px; line-height: 1.3; color: var(--ink2) }
.sp-ic { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex: none; color: var(--ink2); background: none; border: 0; border-radius: 50%; cursor: pointer }
.sp-ic:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 8%, transparent) }
.sp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 14px 16px; overscroll-behavior: contain }
.sp-thread { display: flex; flex-direction: column; gap: 0 }
.sp-who { align-self: flex-start }
.sp-tabs { display: flex; gap: 2px; flex: none; margin: 10px 16px 0; padding: 3px; background: color-mix(in srgb, var(--ink) 6%, transparent); border-radius: 11px }
.sp-tabs button { flex: 1; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink3);
  padding: 6px 8px; background: none; border: 0; border-radius: 8px; cursor: pointer }
.sp-tabs button.on { color: var(--ink); background: var(--card); box-shadow: 0 1px 2px rgba(0, 0, 0, .06) }
.sp-eyebrow { margin: 4px 4px 10px; font-family: var(--m); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3) }
.sp-row { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; font: inherit; color: inherit; padding: 10px 8px; border: 0; border-radius: 14px; background: none; cursor: pointer }
.sp-row:hover { background: color-mix(in srgb, var(--ink) 5%, transparent) }
.sp-row.resolved :deep(.sm) { background: color-mix(in srgb, var(--ink) 35%, var(--paper)) }
.sp-rowtext { flex: 1; min-width: 0 }
.sp-rowtext b { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600 }
.sp-rowtext b i { font-style: normal; font-family: var(--m); font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); border: 1px solid var(--hair); border-radius: 999px; padding: 1px 7px }
.sp-rowtext span { display: block; font-size: 13.5px; color: var(--ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sp-row.unread .sp-rowtext span { color: var(--ink); font-weight: 500 }
.sp-rowmeta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none }
.sp-rowmeta time { font-family: var(--m); font-size: 10.5px; color: var(--ink3) }
.sp-rowmeta i { font-style: normal; font-family: var(--m); font-size: 10.5px; font-weight: 700; color: var(--paper); background: var(--ink); border-radius: 999px; min-width: 18px; height: 18px; padding: 0 5px; display: inline-flex; align-items: center; justify-content: center }
.sp-btn { font: inherit; font-size: 14px; font-weight: 600; color: var(--paper); background: var(--ink); border: 0; border-radius: 999px; padding: 10px 18px; cursor: pointer }
.sp-newbtn { display: block; margin: 14px auto 4px }
.sp-day { display: flex; justify-content: center; margin: 10px 0 4px }
.sp-day span { font-family: var(--m); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3) }
.sp-who { font-family: var(--m); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); margin: 10px 0 -8px 6px }
.sp-thread :deep(.cb) { max-width: 86% }
.sp-thread :deep(.cb-tick.read) { color: var(--ink2) }
/* the tail on the last of a run, as a phone draws it: a curve out of the corner, cut by the ground */
.sp-thread :deep(.cb.last .cb-bubble) { position: relative }
.sp-thread :deep(.cb.last:not(.own):not(.media) .cb-bubble) { border-bottom-left-radius: 18px }
.sp-thread :deep(.cb.last:not(.own):not(.media) .cb-bubble::before) { content: ''; position: absolute; left: -7px; bottom: 0; width: 20px; height: 20px; background: var(--chat-peer); border-bottom-right-radius: 16px }
.sp-thread :deep(.cb.last:not(.own):not(.media) .cb-bubble::after) { content: ''; position: absolute; left: -10px; bottom: 0; width: 10px; height: 20px; background: var(--paper); border-bottom-right-radius: 10px }
.sp-thread :deep(.cb.own.last:not(.media) .cb-bubble) { border-bottom-right-radius: 18px }
.sp-thread :deep(.cb.own.last:not(.media) .cb-bubble::before) { content: ''; position: absolute; right: -7px; bottom: 0; width: 20px; height: 20px; background: var(--chat-own); border-bottom-left-radius: 16px }
.sp-thread :deep(.cb.own.last:not(.media) .cb-bubble::after) { content: ''; position: absolute; right: -10px; bottom: 0; width: 10px; height: 20px; background: var(--paper); border-bottom-left-radius: 10px }

/* no red inside the chat — the site's accent reads as an error here; the notes and badges are ink */
.sp-sys { margin: 8px 0; padding: 10px 14px; border-radius: 14px; border: 1px dashed var(--hair); background: color-mix(in srgb, var(--ink) 4%, var(--paper)) }
.sp-sys small { display: block; font-family: var(--m); font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); margin-bottom: 4px }
.sp-sys p { margin: 0; font-size: 14.5px; line-height: 1.45 }
.sp-choices { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px }

/* the assistant's own two sit where a choice sits, because that is what they are: something to
   press rather than something to read */
.sp-assist { margin-top: 8px }
.sp-asknote { margin-bottom: 4px }
.sp-human { opacity: .85 }
.sp-choice { font: inherit; font-size: 13.5px; color: var(--ink); background: var(--paper); border: 1px solid var(--ink); border-radius: 999px; padding: 7px 13px; cursor: pointer; text-align: left; transition: background .12s, color .12s }
.sp-choice:hover { color: var(--paper); background: var(--ink) }
.sp-choice:disabled { opacity: .5; cursor: default }
.sp-choosehint { width: 100%; margin: 6px 4px 0; font-size: 12px; color: var(--ink3) }
.sp-drop { position: absolute; inset: 0; z-index: 3; display: flex; align-items: center; justify-content: center; border-radius: 20px; background: color-mix(in srgb, var(--paper) 88%, transparent); border: 2px dashed var(--ink); pointer-events: none }
.sp-drop span { font-family: var(--fd); font-weight: 600; font-size: 18px }
.sp-promptimg { display: block; width: 100%; height: auto; border-radius: 10px; margin-top: 10px }
.sp-sysimg { display: block; align-self: stretch; margin: 6px 0; border-radius: 16px; overflow: hidden; line-height: 0; border: 1px solid var(--hair) }
.sp-sysimg img { display: block; width: 100%; height: auto }
.sp-followups { margin: 10px 0 4px }
/* a line's measure is the thread's, not the control's: the buttons wrap inside it like the words do */
.sp-linewrap :deep(.cc), .sp-followups { max-width: 86% }
.sp-typing { display: inline-flex; gap: 4px; align-self: flex-start; margin: 10px 0 0; padding: 12px 14px; border-radius: 18px; border-bottom-left-radius: 6px; background: var(--chat-peer) }
.sp-typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--ink3); animation: sp-dot 1.2s ease-in-out infinite }
.sp-typing span:nth-child(2) { animation-delay: .15s } .sp-typing span:nth-child(3) { animation-delay: .3s }
@keyframes sp-dot { 0%, 60%, 100% { transform: translateY(0); opacity: .5 } 30% { transform: translateY(-4px); opacity: 1 } }
.sp-ack { align-self: center; max-width: 92%; text-align: center; border-style: solid; background: color-mix(in srgb, var(--ink) 3%, var(--paper)) } .sp-ack p { font-size: 13px; color: var(--ink2) }
.sp-note { margin: 14px 8px 4px; font-size: 13px; line-height: 1.45; color: var(--ink2); text-align: center }
.sp-resolved { padding: 10px 12px; border-radius: 12px; background: color-mix(in srgb, var(--ink) 5%, transparent) }
.sp-h { margin: 6px 4px 6px; font-family: var(--fd); font-weight: 600; font-size: 20px; letter-spacing: -.015em; line-height: 1.2 }
.sp-p { margin: 0 4px 14px; font-size: 14px; line-height: 1.5; color: var(--ink2) }
.sp-id { display: flex; align-items: center; gap: 12px; margin: 12px auto 0; text-align: left; width: 92% }
.sp-id p { flex: 1 }
/* the one way in wears the look's own colours — the only accent inside the chat, on purpose */
.sp-idbtn { flex: none; font: inherit; font-size: 12.5px; font-weight: 600; color: #fff; background: linear-gradient(135deg, var(--accent), var(--accent2)); border: 0; border-radius: 999px; padding: 7px 13px; cursor: pointer; white-space: nowrap; box-shadow: 0 6px 16px -8px color-mix(in srgb, var(--accent) 70%, transparent) }
.sp-idbtn:hover { filter: brightness(1.06) }
.sp-as { margin: 8px 4px 0; font-size: 13px; color: var(--ink3) }
.sp-err { margin: 0 18px 6px; font-size: 13px; color: #b3402e }
.sp-foot { flex: none; padding: 8px 10px 10px; border-top: 1px solid var(--hair); background: var(--paper) }
/* ---- motion: the views cross over, each line moves in as it arrives, the strips rise ----
   one curve for the whole widget — the same as the launcher's and the card's */
.sp-lines { display: flex; flex-direction: column }
.sp-linewrap { display: flex; flex-direction: column; align-items: flex-start }
.sp-linewrap.own { align-items: flex-end }
.sp-linewrap :deep(.cb) { max-width: 86% }
/* a picture fills the chat's width, whatever the width */
.sp-linewrap :deep(.cb.media) { max-width: 100%; width: 100% }
.sp-line-enter-active { transition: opacity .32s cubic-bezier(.2, .8, .2, 1), transform .38s cubic-bezier(.2, .8, .2, 1); transition-delay: calc(var(--i, 0) * 28ms) }
.sp-line-enter-from { opacity: 0; transform: translateY(10px) scale(.98) }
.sp-line-enter-from.own, .sp-linewrap.own.sp-line-enter-from { transform: translate(8px, 8px) scale(.98) }
.sp-line-move { transition: transform .3s cubic-bezier(.2, .8, .2, 1) }
.sp-view-enter-active { transition: opacity .22s ease, transform .3s cubic-bezier(.2, .8, .2, 1) }
.sp-view-leave-active { transition: opacity .14s ease, transform .14s ease }
.sp-view-enter-from { opacity: 0; transform: translateY(8px) }
.sp-view-leave-to { opacity: 0; transform: translateY(-6px) }
.sp-rise-enter-active { transition: opacity .28s ease, transform .34s cubic-bezier(.2, .8, .2, 1) }
.sp-rise-leave-active { transition: opacity .16s ease, transform .16s ease }
.sp-rise-enter-from, .sp-rise-leave-to { opacity: 0; transform: translateY(10px) }
.sp-fade-enter-active, .sp-fade-leave-active { transition: opacity .18s ease }
.sp-fade-enter-from, .sp-fade-leave-to { opacity: 0 }
.sp-row, .sp-choice, .sp-idbtn, .sp-btn { transition: background .16s, color .16s, transform .16s cubic-bezier(.2, .8, .2, 1) }
.sp-choice:active, .sp-idbtn:active, .sp-btn:active { transform: scale(.97) }
@media (prefers-reduced-motion: no-preference) { .sp-promptline, .sp-h, .sp-p { animation: sp-in .4s cubic-bezier(.2, .8, .2, 1) both } .sp-choices .sp-choice { animation: sp-in .4s cubic-bezier(.2, .8, .2, 1) both; animation-delay: calc(.1s + var(--i, 0) * 45ms) } @keyframes sp-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } } }
@media (prefers-reduced-motion: reduce) { .sp-line-enter-active, .sp-line-move, .sp-view-enter-active, .sp-view-leave-active, .sp-rise-enter-active, .sp-rise-leave-active { transition: none } }
@media (max-width: 480px) { .sp { width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; border: 0 } }
</style>
<style>
/* by night the accent is a light cyan: the button's words go dark on it */
:root[data-theme='dark'] .sp-idbtn { color: #0b1220 }
@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) .sp-idbtn { color: #0b1220 } }
</style>

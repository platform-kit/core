<script setup>
/*
 * The spaces surface, in the shape a workspace chat has: the spaces down the far edge, the open
 * space's channels beside them, the channel itself, and a thread or a search beside that. People
 * already know how to read this, which is the whole argument for it. The search is a button at the
 * head of the sidebar rather than a bar of its own across the top: the site's header is already up
 * there with a search in it, and two search bars stacked one on the other is one too many.
 *
 * It wears the site's own header like every other page — a place of work is still part of the site,
 * and the way back out of it is the way back out of everything else — and under it the surface takes
 * exactly what is left of the window. The support widget never mounts here, because a space is not a
 * place a visitor is ever in. Nothing here counts anything: the badges
 * are the counters, the history comes by the key, and a return from being away comes by the cursor.
 * A member of staff has one more place here than anyone else: the Desk, which is every conversation
 * waiting on them whatever system holds it (lib/desk/). Words from content/app/ui/spaces.md.
 */
import { moduleOn } from '@platform-kit/kit/lib/modules.js'
import { NOTE_TABS, frontOf, coachingPlace, spaceTabbed, lockedPlaces } from '@platform-kit/kit/lib/community/places.js'
import { sendMedia, signMedia, mediaUrls } from '@platform-kit/kit/lib/spaces/api.js'
import NetMedia from '../components/network/NetMedia.vue'
import { net, pin as netPin, loadSpaces as loadNetSpaces, PINNING } from '@platform-kit/kit/lib/network/api.js'
import { ref, computed, onMounted, onBeforeUnmount, watch as vueWatch, nextTick, defineAsyncComponent } from 'vue'
import SiteLayout from '../layouts/SiteLayout.vue'
import { ROUTES, route, navigate } from '../router.js'
import NetColumn from '../components/network/NetColumn.vue'
import NetJoinCard from '../components/network/NetJoinCard.vue'
import NetAside from '../components/network/NetAside.vue'
import SocialNav from '../components/network/SocialNav.vue'
import SocialAside from '../components/network/SocialAside.vue'
import { unread as netUnread, refresh as refreshNetUnread } from '@platform-kit/kit/lib/network/nav.js'
import { us } from '@platform-kit/kit/lib/content.js'
import { summon, mayRun, COMMANDS, BOTS, runs as agentRuns, runsHere, whyFailed } from '@platform-kit/kit/lib/agents/api.js'
import { supabase } from '@platform-kit/kit/lib/supabase.js'
import { session, isSignedIn, isSupport, isProvider, isStaff, canAccess, onIdentity, myFace } from '@platform-kit/kit/lib/auth.js'
import site, { modules, places as SITE_PLACES } from '#site'
/* NO FOOTER HERE. The community is an application, not a page: it fills the viewport, it has its
   own columns and its own foot, and a column of marketing links under it would be both unreachable
   (nothing scrolls) and wrong. Said while this surface is mounted and unsaid on the way out. */
import { siteFooterOff } from '@platform-kit/kit/lib/chrome.js'
import { unread as chatUnread, refresh as refreshChatUnread } from '@platform-kit/kit/lib/chat/unread.js'
import {
  spaces, channels, unread, booted, open, thread, boot, openChannel, older, send, react, pin,
  scheduled, loadScheduled, sendLater, unschedule, groups, loadGroups,
  withdraw, openThread, closeThread, join, markRead, setNotify, search, saidSomething, whoIsTyping,
  hushes, loadHushes, hush, unhush, hushOf, isHushed,
  setDms, dmRefused,
  catchUp, stop, here, drafts, threads, mentions, saved, unreads, dms, view, openDm, loadThreads, loadMentions, loadUnreads, loadDms,
  loadSaved, save, unsave, star, draft, sendVoice, sendFile, mayVoice, mayFile, mayMention, joined, status, setStatus,
  report, reportsOf, mayModerate,
  makePoll, vote, unvote, closePoll, chooseOffer, votes, loadVotes, firstReplies,
} from '@platform-kit/kit/lib/spaces/api.js'
import { toast } from '@platform-kit/kit/lib/toast.js'
import { spaces as declaredSpaces } from '#content'
import { daySections, runsOf, badgesBySpace, dmTitle, sidedRoom, mentionsOf, unreadOf, mutedNow, plainBody, BOT_PICK, ROLE_PICK } from '@platform-kit/kit/lib/spaces/model.js'
import { commandOf, isTyping, stepRoom } from '@platform-kit/kit/lib/spaces/keys.js'
/* THE COMMUNITY'S OWN LOOK AND BEHAVIOUR, from content/community.md: its six colours stamped on the
   surface's root (a site that names one names one), and which of its features this site runs. */
import { settings as community, paint, has } from '@platform-kit/kit/lib/spaces/settings.js'
import SpaceRail from '../components/spaces/SpaceRail.vue'
import SpaceBar from '../components/spaces/SpaceBar.vue'
import '../components/spaces/spaces-ui.css'   /* the surface's shared furniture: what a view says when it holds nothing */
import SpaceLine from '../components/spaces/SpaceLine.vue'
import SpaceComposer from '../components/spaces/SpaceComposer.vue'
import SpaceForum from '../components/spaces/SpaceForum.vue'
import SpaceCoaching from '../components/spaces/SpaceCoaching.vue'
import SpacePost from '../components/spaces/SpacePost.vue'
import SpaceSearch from '../components/spaces/SpaceSearch.vue'
import SpaceKeys from '../components/spaces/SpaceKeys.vue'
import SpaceCall from '../components/spaces/SpaceCall.vue'
import SpaceAvatar from '../components/spaces/SpaceAvatar.vue'
import SpaceFeed from '../components/spaces/SpaceFeed.vue'
import SpaceFeedActions from '../components/spaces/SpaceFeedActions.vue'
import SpaceSealSetup from '../components/spaces/SpaceSealSetup.vue'
import SpaceDms from '../components/spaces/SpaceDms.vue'
import SpaceDesk from '../components/spaces/SpaceDesk.vue'
import SpaceTickets from '../components/spaces/SpaceTickets.vue'
import SpaceMyTickets from '../components/spaces/SpaceMyTickets.vue'
import SpaceIcon from '../components/spaces/SpaceIcon.vue'
import SpaceEvents from '../components/spaces/SpaceEvents.vue'
import SpaceIndex from '../components/spaces/SpaceIndex.vue'
import { calendar, loadCalendar } from '@platform-kit/kit/lib/spaces/calendar.js'
import SpaceEvent from '../components/spaces/SpaceEvent.vue'
import SpacePeople from '../components/spaces/SpacePeople.vue'
import SpaceModeration from '../components/spaces/SpaceModeration.vue'
import SpaceDiscover from '../components/spaces/SpaceDiscover.vue'
import SpaceMember from '../components/spaces/SpaceMember.vue'
import SpacePollMaker from '../components/spaces/SpacePollMaker.vue'
import { rows as deskRows, sources as deskSources, sourceStatus as deskSourceStatus, start as deskStart, stop as deskStop, load as deskLoad, agents as deskAgents, loadAgents } from '@platform-kit/kit/lib/desk/index.js'
import { tickets as deskTickets, loadTickets, loadMyTickets, mine as myTickets, isLive } from '@platform-kit/kit/lib/desk/tickets.js'
import { badgeBySource } from '@platform-kit/kit/lib/desk/shape.js'

const W = computed(() => us('spaces').page.main)
const CW = computed(() => us('spaces').channel.main)
const TW = computed(() => us('spaces').thread.main)
const NW = computed(() => us('spaces').notify.main)
const MW = computed(() => us('spaces').moderation.main)
const CH = computed(() => us('spaces').chrome.main)
/* what a sealed room says about itself: the whole `## encryption` group, so a surface reaches for
   `EN.room`, `EN.setup` or `EN.refused` and never writes one of these sentences in a template */
const EN = computed(() => us('spaces').encryption)
const me = computed(() => (session.value && session.value.user && session.value.user.id) || '')

/* THE COMMANDS THIS PERSON MAY RUN HERE. Compiled from content/commands/*.md, gated by what the
   reader holds — the same audience grammar as everything else — and offered by the composer's `/`.
   What each one asks its bot is not here: that stays in the file and is filled in by the worker. */
const myCommands = computed(() => COMMANDS.filter((c) =>
  (c.surfaces || ['spaces']).includes('spaces') && mayRun(c.audience)))

/* THE BOTS THAT ANSWER TO THEIR NAME HERE. A bot is summoned by being named, like a colleague, but
   only where its own file says `hears: mention` — otherwise naming it is just words about it. */
const myBots = computed(() => BOTS.filter((b) =>
  (b.surfaces || []).includes('spaces')
  && (b.hears || []).some((h) => h.kind === 'mention')
  && mayRun(b.audience)))
/* the names the drawing looks up, keyed as the token stores them */
const botNames = computed(() => Object.fromEntries(myBots.value.map((b) => [BOT_PICK(b.slug), b.name])))

/* WHAT WENT WRONG, to the person who asked. The room hears the bot's own ending; whoever pressed
   the button hears the reason, because the commonest failures — no credits, a bad key, a rate
   limit — are theirs to fix and nobody else's business. */
const botTrouble = ref(null)   /* { name, why } */
let watching = null
let troubleName = ''
function watchBot(name) {
  troubleName = name || ''
  clearInterval(watching)
  watching = setInterval(async () => {
    if (!open.id) return clearInterval(watching)
    const all = await runsHere(open.id)
    const bad = all.find((r) => r.mine && r.status === 'failed' && r.error)
    if (bad) {
      const b = BOTS.find((x) => x.slug === bad.bot)
      botTrouble.value = { name: (b && b.name) || bad.bot, why: whyFailed(bad.error) }
      clearInterval(watching)
    }
    else if (!agentRuns.here.length) clearInterval(watching)
  }, 1500)
}
onBeforeUnmount(() => clearInterval(watching))

/*
 * Running one is summoning its bot, with the arguments as fields — never a line of text.
 *
 * What the room has been saying goes WITH the run, written onto the row, rather than being
 * fetched by the bot on its own account: a bot can then only ever have read what the person who
 * summoned it could read, and what it was given is a matter of record beside what it did with it.
 */
async function runCommand({ name, bot, args }) {
  if (!bot || !open.id) return
  botTrouble.value = null
  const its = BOTS.find((x) => x.slug === bot)
  const shown = (its && its.name) || bot
  const said = await summon(bot, { surface: 'spaces', channel: open.id, root: open.id, command: name, args })
  if (said && said.error) { botTrouble.value = { name: shown, why: said.error }; return }
  watchBot(shown)
}
/* what this person is called, from their own account: the names map belongs to the open space, and
   somebody in no space has no names at all */
const myName = computed(() => {
  const u = session.value && session.value.user
  if (!u) return ''
  return (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || String(u.email || '').split('@')[0] || ''
})

const people = ref([])
/* every name a line may carry, keyed as its token stores it: the people, the bots, the groups */
const groupNames = computed(() => Object.fromEntries(groups.value.map((g) => [ROLE_PICK(g.slug), g.name])))
/* the people every DM row already names — the rail draws a title before any space's people are
   loaded, and a DM's peers need not be in that space's list at all. Without this a conversation
   reads "someone, someone" until it is opened. */
const dmNames = computed(() => Object.fromEntries(
  (dms.value || []).flatMap((d) => (d.people || []).map((x) => [x.id, x.name])).filter(([, n]) => n)))
const names = computed(() => ({ ...Object.fromEntries(people.value.map((p) => [p.id, p.name])), ...dmNames.value, ...botNames.value, ...groupNames.value }))
/* AND WHO EACH OF THEM IS, for the face: the picture they chose, the style they picked, and the
   seed the database made for them. A face drawn from a display name changes the day somebody
   renames themselves, which is the one thing a face must not do. */
const faces = computed(() => Object.fromEntries(people.value.map((p) => [p.id, p])))
/* AND WHAT EACH OF THEM WEARS HERE. One map for the open space, built where the names are built
   and from the same read, so drawing a badge beside a name in a room costs nothing per line. */
const flairs = computed(() => Object.fromEntries(people.value.filter((p) => (p.flair || []).length).map((p) => [p.id, p.flair])))
/* the names the places that cross every space are given: the open space's people, and the reader
   themselves — a mention is usually OF them, and reading "@someone" about yourself is absurd */
/*
 * THE SIGNED-IN PERSON'S OWN RECORD, for the two places that draw THEM rather than somebody else:
 * the chip at the foot of the rail, and the composer on the front page. Both drew from the NAME
 * alone, which gives a face made out of "Member Person" — so a reader designed a face, saw it on
 * their account page and in the member list, and found a different one looking back at them from
 * the corner of every room. A face is a person's record or it is not their face.
 */
const myPerson = computed(() => (people.value || []).find((x) => x.id === me.value) || myFace.value || null)
const namesOut = computed(() => (me.value ? { ...names.value, [me.value]: myName.value } : names.value))
const scroller = ref(null)
/* the network's column, in the chat layout: refreshed when a space is pinned beside it */
const netColumn = ref(null)
const railOpen = ref(false)
const finding = ref(false)
/*
 * THE KEYBOARD. What a press MEANS is decided by a pure function (lib/spaces/keys.js) and only the
 * acting is here, so "does ⌘⇧A open the unread" is a test rather than something somebody tries.
 * While the caret is in a text box a bare key is a letter — Escape apart, which everywhere means
 * close this.
 */
const helping = ref(false)
/* the rooms as the rail shows them, which is the order the arrows move through */
const roomOrder = computed(() => channels.value
  .filter((c) => !space.value || c.space_id === space.value.id)
  .filter((c) => !c.archived_at))
const hasUnread = (c) => {
  const row = unread.value.find((r) => r.channel === c.id)
  return !!row && unreadOf(row) > 0 && !mutedNow(row)
}
async function pressed(e) {
  const what = commandOf(e, { typing: isTyping(e.target) })
  if (!what) return
  /* a shortcut that did something has used the press; one that did nothing leaves it alone */
  const act = {
    unreads: () => { loadUnreads(); goTo('unreads') },
    threads: () => goTo('threads'),
    mentions: () => goTo('mentions'),
    saved: () => goTo('saved'),
    dms: () => goTo('dms'),
    home: () => { if (space.value) pickSpace(space.value.id) },
    search: () => { finding.value = true },
    help: () => { helping.value = true },
    close: () => {
      if (helping.value) helping.value = false
      else if (finding.value) finding.value = false
      else if (thread.root) closeThread()
      else if (railOpen.value) railOpen.value = false
      else return false
    },
    'prev-room': () => step(-1, null),
    'next-room': () => step(1, null),
    'prev-unread': () => step(-1, hasUnread),
    'next-unread': () => step(1, hasUnread),
  }[what]
  if (!act) return
  if (act() === false) return
  e.preventDefault()
}
function step(by, only) {
  const id = stepRoom(roomOrder.value, open.id, by, { only })
  if (id) pick(id)
}
const found = ref([])
const busy = ref(false)
const posting = ref(false)
const postTitle = ref('')
/* the huddle is the page's, not the channel's: it is a panel over the surface, it survives moving
   from one room to another, and the only things that end it are leaving and closing the tab */
const huddle = ref(null)
const spaceId = ref(null)
const members = ref({})        /* channel id → the ids in it, so a direct message can be named */
const composing = ref(false)   /* the new-message picker */
const browsing = ref(false)    /* every channel of the space, to join one */
const chosen = ref([])
const whoQ = ref('')
const whoShown = computed(() => {
  const q = whoQ.value.trim().toLowerCase()
  const list = people.value.filter((x) => x.id !== me.value)
  return q ? list.filter((x) => String(x.name || '').toLowerCase().includes(q)) : list
})
const belling = ref(false)   /* the channel's own little menu */
/* What a community adds and a staff space never asks for: whether this person keeps this room,
   how many reports wait on them, and the message a reason is being chosen for. */
/* WHAT IS PINNED HERE. The room's own, not this person's — which is why it sits under the room's
   head where everybody sees it, and Saved does not. */
/* WHAT IS WAITING TO BE SENT, in this room. A decision already made, so it sits above the composer
   where the person who made it will see it — not in Drafts, which is for what is unfinished. */
const showLater = ref(false)
const laterHere = computed(() => scheduled.value.filter((s) => s.channel_id === open.id))
const LW = computed(() => us('spaces').later.main)
const BotW = computed(() => us('spaces').bots.main)
const laterLabel = computed(() => (laterHere.value.length === 1
  ? LW.value['waiting-one']
  : (LW.value['waiting-many'] || '').replace('{n}', laterHere.value.length)))
const sayWhenFull = (iso) => {
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const today = new Date().toDateString() === d.toDateString()
  const at = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return today ? at : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + at
}
async function scheduleIt({ body, when }) {
  await sendLater(open.id, body, when)
}
/* sending one now is sending it and dropping the plan: two acts, in that order, so a failure to
   send leaves the plan standing rather than losing the words */
async function sendNow(row) {
  await send(row.channel_id, row.body, { thread: row.thread_root_id })
  await unschedule(row.id)
  await toFoot()
}

const pinning = ref(false)
/* MAY THIS PERSON PIN HERE. Asked of the open room and of nothing else, because the capability may
   sit on one room. It is NOT `moderating`: that one is deliberately off in the staff's own space,
   where reports are not a thing — but a pin is a pin in every room there is. */
const mayPinHere = ref(false)
vueWatch(() => open.id, async (id) => {
  mayPinHere.value = false
  if (!id) return
  try { mayPinHere.value = !!(await mayModerate(id)) } catch { mayPinHere.value = false }
}, { immediate: true })
const pinnedIds = computed(() => new Set((open.pins || []).map((x) => x.message_id)))
const pinLabel = computed(() => (open.pins.length === 1
  ? CW.value['pinned-one']
  : (CW.value['pinned-many'] || '').replace('{n}', open.pins.length)))
async function togglePin(id, on) { await pin(id, on) }
/* opening a pin is going to the message: the panel closes behind you, as a search result does */
async function goToPin(row) {
  pinning.value = false
  if (row.thread_root_id) await openThread(row.thread_root_id)
  await nextTick()
  const el = document.getElementById('m-' + row.message_id)
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

const moderating = ref(false)
const waitingReports = ref(0)
const reporting = ref(null)
const REASONS = ['spam', 'rude', 'wrong-place', 'other']
/* which of the platform's own events this room hears is the CHANNEL's own line — `hears` in
   content/spaces/<space>/<channel>.md — and not a switch in a menu: it is part of what the site is,
   so it is declared where the room is declared and projected into space_hooks by the build. */

const channel = computed(() => channels.value.find((c) => c.id === open.id) || null)
const RW = computed(() => us('spaces').rail.main)
const dmWords = computed(() => ({ self: RW.value.self, more: RW.value.more, someone: RW.value.someone }))
const channelTitle = computed(() => (!channel.value ? '' : channel.value.kind === 'dm'
  ? dmTitle(members.value[channel.value.id] || [], names.value, me.value, dmWords.value)
  : channel.value.name))
const dmPeer = computed(() => {
  if (!channel.value || channel.value.kind !== 'dm') return null
  const ids = (members.value[channel.value.id] || []).filter((id) => id !== me.value)
  return ids.length === 1 ? ids[0] : null
})
const mentionCount = computed(() => unread.value.reduce((n, r) => n + mentionsOf(r), 0))
/* a mention landing live is in the community's one list too: its count is asked again */
vueWatch(mentionCount, (n, was) => { if (COMMUNITY && n > was) refreshNetUnread() })
/* the badge on the DMs place: how many conversations have something unread, not how many lines —
   the counters are already in hand from space_unread, so the place needs no read to say it */
const dmUnread = computed(() => {
  const isDm = new Set(channels.value.filter((c) => c.kind === 'dm').map((c) => c.id))
  return unread.value.filter((r) => isDm.has(r.channel) && unreadOf(r) > 0 && !mutedNow(r)).length
})
/* HOW MANY ARE WAITING, from the counters the rail already holds — not a second read. A muted room
   is left out, because muting is somebody saying they do not want to be told. */
const unreadCount = computed(() => unread.value.reduce((n, r) => {
  const row = channels.value.find((c) => c.id === r.channel)
  if (row && (row.notify === 'none' || mutedNow(row))) return n
  return n + unreadOf(r)
}, 0))
/* a row of the DMs place opens where it lives: the space first when it is not the one in front */
async function openDmRow(row) {
  if (!row) return
  if (!space.value || space.value.id !== row.space) enterSpace(row.space)
  await pick(row.channel)
}
/* a draft is a ROOM with something unsent in it, not a message: the row is the room it was typed
   in and the words so far, newest room first by where it sits in the rail */
const spaceOf = computed(() => {
  if (spaces.value.length < 2) return {}
  const byId = Object.fromEntries(spaces.value.map((s) => [s.id, s.name]))
  return Object.fromEntries(channels.value.map((c) => [c.id, byId[c.space_id] || '']))
})
const draftRows = computed(() => Object.keys(drafts)
  .map((id) => {
    const c = channels.value.find((x) => x.id === id)
    if (!c) return null
    return { channel_id: id, channel: c.name, channel_kind: c.kind, body: String(drafts[id] || '').trim() }
  })
  .filter((d) => d && d.body))
/* A QUEUE IS SHOWN TO WHOEVER ANSWERS IT. The support desk is a support agent's (and an
   administrator's); the clients' own conversations are whoever coaches. One person may answer both,
   or neither — and a badge counts only the rows of its own queue. */
const waiting = computed(() => badgeBySource(deskRows.value, Date.now(), deskSources.value))
const supportWaiting = computed(() => (isSupport.value ? waiting.value.support.waiting : 0))
const clientsWaiting = computed(() => (isProvider.value ? waiting.value.coaching.waiting : 0))
/* the comments no forum room owns. Shown to anybody who runs part of the site, because a comment
   under an article belongs to no space and so to no space's moderators — this queue is the only
   place it is anybody's job. */
const commentsWaiting = computed(() => (isStaff.value ? waiting.value.comments.waiting : 0))
const socialDesk = computed(() => isStaff.value && deskSources.value.includes('social')
  && deskSourceStatus.social?.available === true)
const socialCommentsWaiting = computed(() => socialDesk.value
  ? deskRows.value.filter((row) => row.source === 'social' && row.conversationKind === 'comment' && row.waiting_since && !row.resolved).length
  : 0)
const socialDmsWaiting = computed(() => socialDesk.value
  ? deskRows.value.filter((row) => row.source === 'social' && row.conversationKind === 'dm' && row.waiting_since && !row.resolved).length
  : 0)
/* the work, as against the conversation: the desk's open tickets, or a person's own */
const ticketsOpen = computed(() => (isSupport.value ? deskTickets.list.filter(isLive).length : 0))
const myTicketCount = computed(() => myTickets.list.filter((t) => t.status !== 'resolved' && t.status !== 'closed').length)
/* COACHING, the other side of the Clients queue. Where the business answers coaching here rather
   than on the results sheet (platformkit.config.js coaching.where), a member gets a place of their
   own for it — the conversation and their sessions together — the same conversation, the same rows, the same unread count the header used to
   carry. Somebody who gives sessions has one too: they may be a member with a coach of their own,
   and their sessions page carries the ones they give, their hours and offerings. */
/* MUTING, the reader's own. Three things can be muted and the question asked of all three is the
   same one: does this reach me with a noise. Nothing is hidden by it — a muted room opens and reads
   as it always did — so none of it is a policy, and all of it is undone by pressing the same thing. */
const MuW = computed(() => us('spaces').mute.main)
const hour = (n) => () => new Date(Date.now() + n * 3600e3).toISOString()
const MUTES = [
  { key: 'hour', at: hour(1) },
  { key: 'day', at: hour(24) },
  { key: 'week', at: hour(24 * 7) },
  { key: 'ever', at: () => null },
]
const mutedHere = computed(() => (open.id ? hushOf('channel', open.id) : null))
const mutedSpace = computed(() => (spaceId.value ? isHushed('space', spaceId.value) : false))
/* their own answer about being written to here, carried on the space row they already have */
const dmsMine = computed(() => !space.value || space.value.dms_mine !== false)
const mutedSays = computed(() => {
  const m = mutedHere.value
  if (!m) return ''
  if (!m.until) return MuW.value['muted-ever']
  const d = new Date(m.until)
  return (MuW.value['muted-until'] || '').replace('{when}', isNaN(d) ? '' : d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }))
})
/* the place and what is in it: the conversation where they may write to a coach — a coach always, a
   member, somebody whose paid session's week is still running (read from the booking: the coaches they
   have one with), or anybody with a line waiting — and their sessions where the sessions module is on
   (places.js coachingPlace, held by community-nav) */
const sessionCoaches = ref([])
vueWatch(() => me.value, async (id) => {
  sessionCoaches.value = []
  if (!id || !supabase) return
  const { data } = await supabase.rpc('chat_session_coaches')
  if (me.value === id) sessionCoaches.value = Array.isArray(data) ? data : []
}, { immediate: true })
const coachPlace = computed(() => coachingPlace({
  where: (site.coaching || {}).where, signedIn: !!me.value, coach: isProvider.value,
  mayChat: isProvider.value || canAccess('subscribed') || sessionCoaches.value.length > 0 || chatUnread.value > 0,
  chatOn: moduleOn('coaching'), sessionsOn: moduleOn('sessions'),
}))
const coachingHere = computed(() => !!coachPlace.value)
const notJoined = computed(() => channels.value.filter((c) => c.kind !== 'dm' && (!spaceId.value || c.space_id === spaceId.value) && !unread.value.some((r) => r.channel === c.id)))
const roomsHere = computed(() => channels.value
  .filter((c) => c.kind !== 'dm' && (!spaceId.value || c.space_id === spaceId.value))
  .map((c) => ({ ...c, joined: unread.value.some((r) => r.channel === c.id) }))
  .sort((a, b) => (a.position || 0) - (b.position || 0) || a.name.localeCompare(b.name)))
const space = computed(() => spaces.value.find((s) => s.id === (spaceId.value || (channel.value && channel.value.space_id))) || spaces.value[0] || null)
const myRow = computed(() => unread.value.find((r) => r.channel === open.id) || null)
const badges = computed(() => badgesBySpace(unread.value))
/* what this person may do here is the database's answer, carried on the channel's own counters */
const mentionHere = computed(() => !!open.id && mayMention(open.id))
/*
 * A CHANNEL READ AS A FEED (the network module): the same messages a stream holds, loaded and kept
 * live the same way, drawn the way a group's feed is — each post whole in its own card, newest
 * first, with its first answers under it and the way into the rest. Nothing is written by reading
 * a room this way rather than another.
 */
const feedPosts = computed(() => (channel.value && channel.value.mode === 'feed'
  ? open.messages.filter((m) => !m.thread_root_id && m.kind !== 'system').slice().sort((a, b) => Number(b.seq) - Number(a.seq))
  : []))
const feedReplies = ref({})
let feedTick = 0
vueWatch(() => [open.id, feedPosts.value.map((m) => m.id + ':' + (m.reply_count || 0)).join(','), thread.root ? thread.root.id : ''], async () => {
  const roots = feedPosts.value.filter((m) => (m.reply_count || 0) > 0 && !String(m.id).startsWith('tmp-')).map((m) => m.id)
  const n = ++feedTick
  const got = roots.length ? await firstReplies(roots).catch(() => ({})) : {}
  if (n === feedTick) feedReplies.value = got
})
const sections = computed(() => daySections(open.messages, Date.now(), { today: W.value.today, yesterday: W.value.yesterday }))
const runs = (list) => runsOf(list)
/* the words are a string with a slot, never two strings joined here */
const composerSays = computed(() => {
  const C = us('spaces').composer.main
  if (posting.value) return C['placeholder-post']
  if (!channel.value) return C.placeholder
  return (C[sidedRoom(channel.value) ? 'placeholder-dm' : 'placeholder-channel'] || '').replace('{channel}', channelTitle.value)
})
/* how this room is read — by side between two people, by author where anybody may speak */
const sided = computed(() => sidedRoom(channel.value))
const typingNow = computed(() => whoIsTyping(open.id).map((id) => names.value[id]).filter(Boolean))
const reactionsFor = (id) => {
  const by = new Map()
  for (const r of open.reactions) {
    if (r.message_id !== id) continue
    if (!by.has(r.emoji)) by.set(r.emoji, { emoji: r.emoji, users: [], mine: false })
    const g = by.get(r.emoji)
    g.users.push(r.user_id)
    if (r.user_id === me.value) g.mine = true
  }
  return [...by.values()]
}
const mentionsMe = (m) => !!m.body && m.body.includes('<@' + me.value + '>')
/* who is in a thread, for the summary row under its root */
const repliersOf = (id) => [...new Set(open.messages.filter((m) => m.thread_root_id === id).map((m) => m.author_id))]

async function loadMembers() {
  const { data } = await supabase.from('channel_members').select('channel_id, user_id')
  const by = {}
  for (const r of data || []) (by[r.channel_id] = by[r.channel_id] || []).push(r.user_id)
  members.value = by
}

/* the event whose own page is open, inside the events view */
const openEvent = ref('')
/* the spaces with something coming up: their Events row in the social navigation */
const eventSpaces = computed(() => [...new Set((calendar.upcoming || []).map((o) => o.space).filter(Boolean))])
/* a session from the sidebar: the reader's sessions, in the community's coaching place where coaching
   lives here, else on the sheet */
function openSessions() {
  if (coachingHere.value) { try { localStorage.setItem('pk.coaching.tab', 'sessions') } catch (e) { /* kept nowhere */ } socialGo('coaching') }
  else navigate('/app/coaching')
}
/* a space's place from the navigation (a space of several rooms carries them there, not as tabs) */
function openPlace(id, key) {
  if (!space.value || space.value.id !== id) enterSpace(id)
  if (key === 'events') { eventsAll.value = false; openEvent.value = '' }
  goTo(key)
}
/* does this space run anything? the rail carries an Events item only where it does */
const hasEvents = computed(() => (calendar.upcoming || []).some((o) => !space.value || o.space === space.value.id))

/*
 * WHAT A CALENDAR'S BUTTONS DO. All three of these used to be emitted by the space's home and listened for
 * by nobody, so "See the calendar" did nothing at all and a huddle could not be joined from a card.
 * A button that does nothing is worse than no button: somebody presses it twice, then stops
 * believing the page.
 */
async function joinOccurrence(o) {
  if (!o) return
  const id = o.channel || o.channel_id || (space.value && channels.value.find((c) => c.space_id === space.value.id && c.kind !== 'dm')?.id)
  if (id) { await pick(id); huddle.value = id }
}
async function bookSession(s) {
  if (s && s.slug) window.location.href = '/app/coaching?book=' + encodeURIComponent(s.slug)
}

/* the rail asks "has this space anything on?" before anybody opens a calendar, so the calendar is
   loaded when the space is — cheap, one read, and the home card wants it anyway */
vueWatch(() => space.value && space.value.id, (id) => { if (id) loadCalendar(id, { days: 120, limit: 200 }) }, { immediate: true })

/*
 * THE NETWORK, IN HERE — in the chat layout (community.layout, the default) with the network on: /feed opens on this page (App.vue),
 * as two of the person's own places in the column, Feed and Notifications, beside Home and the spaces;
 * the column in the middle is the network's own (NetColumn), the same one /feed draws on a site that
 * keeps them apart. Off, none of this is reachable and the spaces are exactly what they were.
 */
const COMMUNITY = moduleOn('network')
/*
 * THE SOCIAL LAYOUT (community.layout: social) — the same page, the same views, the same rules, in the
 * social-network layout: SocialNav down the left in place of the two columns, the view in the middle
 * column with the open space's header and tabs above it, and SocialAside on the right until a thread
 * or a card takes its place. Only where things are drawn changes (the community-layouts spec).
 */
const SOCIAL = (site.community && site.community.layout) === 'social'
/* A PLACE THIS READER MAY NOT ENTER (openspec: community-access-by-entitlement) shows the join card in
   its place. Signed in, the database's answers (admission(), asked by the navigation); a guest is outside
   every gated place. Home keeps its own card in the network's column, which also knows read from write. */
const GATED_PLACES = (site.community && site.community.gated) || []
const PLACE_OF_VIEW = { 'net-notes': 'notifications', mentions: 'notifications', events: 'events', dms: 'messages' }
const lockedHere = computed(() => {
  const word = PLACE_OF_VIEW[view.value] || view.value
  if (!GATED_PLACES.includes(word)) return false
  return isSignedIn.value ? lockedPlaces({ admitted: net.places }).includes(word) : true
})
/* Events is a place only where the events module is on */
const EVENTS_ON = moduleOn('events')
const NETWORK_ON = moduleOn('network')
/* the queues this reader answers, in the chat layout's order, with what waits in each */
const workList = computed(() => [
  ...(isSupport.value ? [{ key: 'support', count: supportWaiting.value }, { key: 'tickets', count: ticketsOpen.value }] : []),
  ...(isProvider.value ? [{ key: 'clients', count: clientsWaiting.value }] : []),
  ...(isStaff.value ? [{ key: 'comments', count: commentsWaiting.value }] : []),
  ...(socialDesk.value ? [{ key: 'social-comments', count: socialCommentsWaiting.value }, { key: 'social-dms', count: socialDmsWaiting.value }] : []),
])
/* Events from the navigation is everything on, in every space; from a space's tab, that space's */
const eventsAll = ref(false)
/* the open space's tabs: its feed, its rooms, what is on, who is in it, what it is, keeping it */
const firstOf = (pred) => channels.value.find((c) => space.value && c.space_id === space.value.id && c.kind !== 'dm' && !c.archived_at && pred(c))
const spaceTabs = computed(() => {
  if (!space.value) return []
  const SH = us('network').shell.main, RW = us('spaces').rail.main
  const feedRoom = firstOf((c) => c.mode === 'feed')
  const chatRoom = firstOf((c) => c.mode !== 'feed')
  return [
    ...(feedRoom ? [{ key: 'feed', word: RW.feed, on: view.value === 'channel' && open.id === feedRoom.id, go: () => pick(feedRoom.id) }] : []),
    ...(chatRoom ? [{ key: 'chat', word: SH.chat, on: view.value === 'channel' && !!channel.value && channel.value.mode !== 'feed', go: () => pick(chatRoom.id) }] : []),
    ...(hasEvents.value || (view.value === 'events' && !eventsAll.value) ? [{ key: 'events', word: RW.events, on: view.value === 'events', go: () => openPlace(space.value.id, 'events') }] : []),
    { key: 'people', word: RW.directory, on: view.value === 'people', go: () => goTo('people') },
    ...(moderating.value ? [{ key: 'keeping', word: RW.keeping, on: view.value === 'keeping', go: () => goTo('keeping') }] : []),
  ]
})
/* WHAT THE SPACE IS, in one line under its name: the first paragraph of its own file, its marks
   taken off — the words it is offered with on Browse spaces, not new ones */
const spaceLine = computed(() => {
  const d = space.value && (declaredSpaces || []).find((x) => x.slug === space.value.slug)
  if (!d) return ''
  /* .velite/spaces.json is written by velite (the body as html) and by the spaces compile (the body
     as markdown, `about`), whichever ran last; either is read */
  if (d.about) {
    const first = String(d.about).trim().split(/\n\s*\n/)[0] || ''
    return first.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim()
  }
  const p1 = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(String(d.body || ''))
  const text = p1 ? p1[1].replace(/<[^>]+>/g, '') : ''
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&[a-z]+;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim()
})
/* THE ROOM IN THE SPACE'S HEADER (social layout). The room's name and what it is for are the
   header's own title and line — never squeezed into a bar beside its tools — and its tools (pinned,
   scheduled, the huddle, the bell) sit at the header's right. A chat room or a board says its own
   name under the space's; the feed is the space's front, so there the header stays the space's. */
const roomInHead = computed(() => SOCIAL && inSpace.value && !!space.value && view.value === 'channel' && !!channel.value && channel.value.kind !== 'dm')
const roomTitled = computed(() => roomInHead.value && channel.value.mode !== 'feed')
/* PIN TO HOME: a space whose feed the reader may pin, from its own header (the network's spaces) */
const NT = computed(() => us('network').timeline.main)
const pinOf = computed(() => (COMMUNITY && space.value ? (net.spaces || []).find((x) => x.space_id === space.value.id) || null : null))
const pinBusy = ref(false)
async function togglePinHome() {
  if (!pinOf.value) return
  pinBusy.value = true
  try { await netPin(pinOf.value.space_id, !pinOf.value.pinned); if (netColumn.value) netColumn.value.refresh() } finally { pinBusy.value = false }
}
/* THE STAFF'S QUEUES ARE TOOLS, a list and the conversation side by side: in the social layout they
   take the width beside the navigation, with no sidebar, the way a desk does. A member's coaching
   place is the same shape — a conversation in two panes, or their sessions — and takes the same room. */
const WORK_VIEWS = ['support', 'tickets', 'clients', 'comments', 'social-comments', 'social-dms']
const WIDE = computed(() => SOCIAL && (WORK_VIEWS.includes(view.value) || !!(placeOf(view.value) && placeOf(view.value).wide)))
/* the navigation's Events is every space's: a space's own events are its tab, not that place */
const navView = computed(() => (view.value === 'events' && !eventsAll.value ? 'space-events'
  /* without the network, Notifications is Mentions and Threads as tabs: either is that place */
  : SOCIAL && !COMMUNITY && view.value === 'threads' ? 'mentions'
  /* Explore is the network's column at its own address */
  : view.value === 'net' && (route.value || '') === ROUTES.feed + '/explore' ? 'net-explore' : view.value))
const noteTabs = computed(() => (SOCIAL && !COMMUNITY && (view.value === 'mentions' || view.value === 'threads')
  ? NOTE_TABS.map((k) => ({ key: k, word: us('spaces').feed.main[k + '-title'] })) : []))
function socialGo(v) {
  railOpen.value = false
  if (v === 'events') { eventsAll.value = true; openEvent.value = '' }
  goTo(v)
}
const onFeed = (p) => COMMUNITY && (p === ROUTES.feed || p.startsWith(ROUTES.feed + '/'))
const netViewOf = (p) => (p === ROUTES.feed + '/notifications' ? 'net-notes' : 'net')
/* /feed/<place>: one of the reader's own places (OWN_ADDR), else null */
const ownViewOf = (p) => {
  if (!p || !p.startsWith(ROUTES.feed + '/')) return null
  const rest = p.slice(ROUTES.feed.length + 1).replace(/\/$/, '')
  /* a registered place owns its address and everything under it */
  const head = rest.split('/')[0]
  if (SITE_PLACE_KEYS.includes(head)) return head
  return OWN_VIEW[rest] || null
}
vueWatch(route, (p) => {
  if (!onFeed(p || '')) return
  const own = ownViewOf(p)
  if (own && SITE_PLACE_KEYS.includes(own)) view.value = own
  else if (!own) view.value = netViewOf(p)
})

async function goTo(where) {
  if (where === 'net-explore') { navigate(ROUTES.feed + '/explore'); view.value = 'net'; return }
  if (where === 'net' || where === 'net-notes') {
    navigate(where === 'net-notes' ? ROUTES.feed + '/notifications' : ROUTES.feed)
    view.value = where
    return
  }
  if (where === 'social-comments' || where === 'social-dms') {
    if (!socialDesk.value) where = 'index'
  }
  /* a site's registered place is a real address its own pages read, so it is navigated to */
  if (SITE_PLACE_KEYS.includes(where)) { navigate(ROUTES.feed + '/' + where); view.value = where; return }
  view.value = where
  /* Home is the community, not a room in it — inSpace is false for anything in MINE, which is
     why 'index' belongs in that list: the rail must stop saying you are inside a space. */
  if (where === 'index') loadPeople()
  if (where !== 'events') openEvent.value = ''
  if (where === 'dms') { await loadDms(); await loadMembers() }
  if (where === 'threads') await loadThreads()
  if (where === 'mentions') await loadMentions()
  if (where === 'unreads') await loadUnreads()
  if (where === 'saved') await loadSaved()
}

vueWatch(socialDesk, (available) => {
  if (!available && (view.value === 'social-comments' || view.value === 'social-dms')) goTo('index')
})

/* May this person keep this room, and how much is waiting on them? Asked of one of the space's own
   rooms, because moderating is a grant like any other and may sit on a single room. */
async function loadModeration() {
  const room = space.value ? channels.value.find((c) => c.space_id === space.value.id && c.kind !== 'dm') : null
  if (!room || !space.value || space.value.kind === 'staff') { moderating.value = false; waitingReports.value = 0; return }
  try {
    moderating.value = !!(await mayModerate(room.id))
    waitingReports.value = moderating.value ? ((await reportsOf(space.value.id)) || []).length : 0
  } catch { moderating.value = false; waitingReports.value = 0 }
}
async function sendReport(reason) {
  const m = reporting.value
  reporting.value = null
  if (!m) return
  try { await report(m.id, reason) } catch (e) { /* said once, and never twice */ }
}
/* a room where reporting means something: a community, never the staff's and never a direct message */
/* THE TWO LEVELS. The Desk, Threads, Activity, Later and the way in are about this PERSON across
   every space they are in; a space's rooms have nothing to do with any of them, so the sidebar is
   not drawn beside one and the view takes the width. What belongs to a space — its rooms, its home,
   its people, its queue — keeps the sidebar, because that is what the sidebar is for. */
/* THE COMMUNITY'S REGISTERED PLACES (openspec: community-places-by-registration): the kit's own Coaching
   first, then every place the site registered (community.places) — each mounted here by the same code,
   at /feed/<key> and under it, as wide as its registration says. Nothing below names one by hand. */
const SITE_PLACE_KEYS = (SITE_PLACES || []).map((x) => x.key)
const placeRest = computed(() => {
  const p = route.value || '', at = ROUTES.feed + '/' + view.value
  return p.startsWith(at + '/') ? p.slice(at.length + 1) : ''
})
const REGISTRY = [
  { key: 'coaching', component: SpaceCoaching, wide: true, props: () => ({ place: coachPlace.value }) },
  ...(SITE_PLACES || []).map((x) => ({ ...x, component: x.load ? defineAsyncComponent(x.load) : null, props: () => ({ rest: placeRest.value }) })),
]
const placeOf = (k) => REGISTRY.find((x) => x.key === k) || null
const MINE = [...SITE_PLACE_KEYS, 'net', 'net-notes', 'index', 'support', 'clients', 'comments', 'social-comments', 'social-dms', 'tickets', 'my-tickets', 'coaching', 'dms', 'unreads', 'threads', 'mentions', 'saved', 'drafts', 'discover']
const inSpace = computed(() => !MINE.includes(view.value) && !(view.value === 'events' && eventsAll.value))
const reportable = computed(() => !!space.value && space.value.kind !== 'staff' && !!channel.value && channel.value.kind !== 'dm')
/* A POST IN A FORUM TAKES THE WHOLE PANE. In a stream a thread belongs beside the room, because the
   room carries on and a reader wants both; in a forum the post IS the content and the board is only
   the index to it, so opening one squeezed the board into two thirds and pinned the post into a
   380-pixel column — every title over three lines, every reply in a gutter. Here the board goes,
   the side panel is not drawn, and SpacePost has the pane. */
const readingPost = computed(() => !!thread.root && !!channel.value && channel.value.mode === 'forum')
/* WHAT THE OPEN ROOM TAKES besides words, as the projection resolved it (the room's own answer, else
   its space's, else the platform's). Read once for the room rather than once per line. */
const takesReactions = computed(() => !channel.value || channel.value.reactions !== false)
const takesVotes = computed(() => !!(channel.value && channel.value.votes))

/* a mention read is the channel's own cursor moved past it — there is no second counter for a
   mention, and inventing one would be a number that could disagree with the first */
async function readOne(row) {
  await markRead(row.channel_id, Number(row.seq) || 0)
  await loadActivity()
}
async function readAll() {
  for (const r of mentions.value.filter((x) => x.unread)) await markRead(r.channel_id, Number(r.seq) || 0)
  await loadActivity()
}

async function openFromFeed(at) {
  await pick(at.channel)
  if (at.thread) await openThread(at.thread)
}

/* TOLD, NOT BAFFLED. A press that does nothing and says nothing is worse than a refusal, so both
   the database's refusals are said in words: the space has no direct messages at all, or the
   person has said they would rather not be written to. */
function sayRefused() {
  if (!dmRefused.value) return
  const M = MuW.value || {}
  toast({ kind: 'note', title: M['dms-no-' + dmRefused.value + '-title'] || M['dms-no-other-title'],
    body: M['dms-no-' + dmRefused.value] || M['dms-no-other'], dismiss: W.value.close || 'Close' })
  dmRefused.value = ''
}

async function startDm() {
  if (!space.value || !chosen.value.length) return
  const id = await openDm(space.value.id, chosen.value)
  composing.value = false
  chosen.value = []
  await loadMembers()
  if (id) await pick(id)
  else sayRefused()
}

async function loadPeople() {
  if (!space.value) { people.value = []; return }
  const { data } = await supabase.rpc('space_people', { p_space: space.value.id, p_channel: open.id })
  people.value = data || []
}

async function pick(id) {
  /* A ROOM OPENS ON THE ROOM. A thread left open from the last time somebody was in here is not
     where they meant to go: they pressed the channel, and the channel is the board or the stream.
     Carrying the old thread over meant pressing #the-books and landing inside one post of it,
     with no way of knowing why — the anti-pattern this line exists to stop. */
  closeThread()
  await openChannel(id)
  const c = channels.value.find((x) => x.id === id)
  if (c) spaceId.value = c.space_id
  await loadPeople()
  await loadMembers()
  view.value = 'channel'
  address(c)
  await toFoot()
}

/* THE ROOM IS AT AN ADDRESS, and the address follows the reader: /spaces/<space>/<channel>, which
   is what makes a link to a room a link and a refresh keep the place. It is written with
   replaceState rather than navigated, because moving between rooms is not moving between pages —
   the back button should leave the surface, not walk back through every room that was opened. */
function address(c) {
  if (!c || typeof history === 'undefined') return
  const sp = spaces.value.find((x) => x.id === c.space_id)
  if (!sp) return
  put(c.kind === 'dm' ? `${ROUTES.spaces}/${sp.slug}` : `${ROUTES.spaces}/${sp.slug}/${c.slug}`)
}
/* a space with no room in front of it (a space whose rooms the reader cannot see) is the space's own address */
function addressOf(id) {
  const sp = spaces.value.find((x) => x.id === id)
  if (sp) put(`${ROUTES.spaces}/${sp.slug}`)
}

/*
 * EVERY PLACE HAS AN ADDRESS.
 *
 * A room had one; the rest of this surface did not, so "the people of this space", "what is on" and
 * one event were states rather than places — nothing anybody could send, bookmark or come back to,
 * and a refresh dropped them at the space's home.
 *
 * The views that are PLACES are listed here and nowhere else, so a new one is added in one line and
 * is immediately linkable. What is NOT here is deliberate: unreads, threads, mentions, saved and the
 * DM list are questions about the reader rather than places on the site — "what is waiting for me"
 * has no meaning in somebody else's browser.
 */
const PLACES = ['people', 'events', 'keeping']
/* THE READER'S OWN PLACES — Coaching, Messages, the Work queues, Saved, Drafts, their tickets, every
   space's events — belong to no space, so they never wear one's address (they used to keep the last
   space's, which read as Coaching being a room of it). Where the network is one place with the spaces
   they sit beside Home under /feed, and an address opens its place; without it, the community's own. */
const OWN_ADDR = { coaching: 'coaching', dms: 'messages', saved: 'saved', drafts: 'drafts', 'my-tickets': 'my-tickets',
  support: 'support', tickets: 'tickets', clients: 'clients', comments: 'comments', 'social-comments': 'social-comments', 'social-dms': 'social-messages' }
const OWN_VIEW = Object.fromEntries([...Object.entries(OWN_ADDR).map(([v, a]) => [a, v]), ['events', 'events']])

function addressOfView() {
  const sp = space.value
  /* the network's places have their own addresses, which the router keeps */
  if (view.value === 'net' || view.value === 'net-notes') return
  if (view.value === 'index') return put(ROUTES.spaces)
  /* a registered place keeps the address it is at (its pages write their own beneath it) */
  if (SITE_PLACE_KEYS.includes(view.value)) return
  const own = OWN_ADDR[view.value] || (view.value === 'events' && eventsAll.value && !openEvent.value ? 'events' : null)
  if (own) return put(COMMUNITY ? `${ROUTES.feed}/${own}` : ROUTES.spaces)
  if (!sp) return
  if (!PLACES.includes(view.value)) return addressOf(sp.id)
  const tail = view.value === 'events' && openEvent.value ? `/events/${openEvent.value}` : `/${view.value}`
  put(`${ROUTES.spaces}/${sp.slug}${tail}`)
}
vueWatch([view, openEvent], addressOfView)
function put(at) {
  if (typeof history === 'undefined' || window.location.pathname === at) return
  history.replaceState(history.state, '', at + window.location.search)
}

/* the space in front changes: the groups belong to the space, so they are read when it changes and
   not per room */
function enterSpace(id) {
  spaceId.value = id
  closeThread()
  loadGroups(id)
}
/* A SPACE OPENS ON WHAT IT HOLDS (openspec: remove-space-about-tab): its feed, or its first room
   where it has none — never whichever room had the newest message, and no home of its own that only
   repeated its tabs. A space whose rooms the reader cannot see opens on its people, which every
   space has. Every way in comes here: the navigation, joining, an address naming no room, the
   shortcut. */
async function pickSpace(id) {
  enterSpace(id)
  const front = frontOf(id, channels.value)
  if (front) return pick(front.id)
  view.value = 'people'
  addressOfView()
}

async function toFoot() {
  await nextTick()
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

async function say(payload) {
  await send(open.id, payload.body, { echo: payload.echo })
  await toFoot()
}
/*
 * A BOT NAMED IN A MESSAGE IS ASKED BY THE DATABASE, not from here.
 *
 * This used to watch what it had just sent and call agent_summon. That works for exactly one
 * client: a line written by anything else — the Matrix surface, a bridge, a script holding a key —
 * landed as a good row that no bot ever heard, and nothing said so. The desk never had the problem
 * because the desk has always had a trigger.
 *
 * So the summon is `trg_agent_hear_mention` on space_messages now, which makes every refusal
 * agent_summon already made. Nothing is called from here, on purpose: two paths that both summon
 * would summon twice, and a bot answering a question twice is worse than one that does not answer.
 * The run appears through the same live channel every other run does.
 */
/*
 * PRESSING WHAT A BOT OFFERED. The database posts the words in that person's name and says whether
 * they got there first — so the room summons the bot with the answer exactly as if it had been
 * typed, and a second press finds the offer gone rather than starting a second run.
 */
async function tookOffer({ message, key, text }) {
  const m = [...open.messages, thread.root, ...thread.replies].find((x) => x && x.id === message)
  const made = await chooseOffer(message, key)
  if (!made) return
  const slug = m && m.meta && m.meta.bot
  const bot = slug ? myBots.value.find((b) => b.slug === slug) : null
  if (!bot) return
  botTrouble.value = null
  const said = await summon(bot.slug, {
    surface: 'spaces', channel: open.id, root: (m && m.thread_root_id) || open.id, ask: text,
  })
  if (said && said.error) { botTrouble.value = { name: bot.name, why: said.error }; return }
  watchBot(bot.name)
}
/* What the room said is read by the SERVER now (agent_transcript), with the same roomAsProse the
   line beside it is drawn with. It used to be sent from here — and anything a client sends, a
   client can make up, which is how three forged lines once made a bot promise free shipping. */
async function sayInThread(payload) {
  await send(open.id, payload.body, { thread: thread.root.id, echo: payload.echo })
}
async function saidAloud(take) { await sendVoice(open.id, take.blob, take.seconds, { transcript: take.transcript }); await toFoot() }
async function saidAloudInThread(take) { await sendVoice(open.id, take.blob, take.seconds, { thread: thread.root.id, transcript: take.transcript }) }
/* a file goes where the words would have gone, and what was in the box when it was chosen goes
   with it as its caption */
/* a feed post's pictures and videos: up, then one message carrying them */
async function postedMedia({ files, said }) { await sendMedia(open.id, files, { body: said }) }
/* the feed's media, signed as its posts arrive */
vueWatch(() => feedPosts.value.map((m) => m.id).join(), () => signMedia(feedPosts.value))
async function attached({ file, said }) { await sendFile(open.id, file, { body: said }); await toFoot() }
async function attachedInThread({ file, said }) { await sendFile(open.id, file, { body: said, thread: thread.root.id }) }
/* speaking is membership, as the insert policy has it: a button somebody cannot act on is a
   button that lies, so an offer is dead for anybody who is not in the room */
const mayWriteHere = computed(() => !!open.id && joined(open.id))
const voiceHere = computed(() => !!open.id && mayVoice(open.id))
const fileHere = computed(() => !!open.id && mayFile(open.id))

/* the search answers what it found AND how many rooms it could not look in — a sealed room leaves
   nothing in the index, and missing it silently reads as a broken search */
const sealedOut = ref(0)
async function find(q) {
  busy.value = true
  try { const r = await search(q); found.value = r.rows; sealedOut.value = r.sealed }
  finally { busy.value = false }
}
async function openHit(hit) {
  if (hit.channel_id !== open.id) await pick(hit.channel_id)
  if (hit.thread_root_id) await openThread(hit.thread_root_id)
  finding.value = false
}
async function newPost(payload) {
  const title = postTitle.value.trim()
  if (!title) return
  await send(open.id, payload.body, { title })
  postTitle.value = ''
  posting.value = false
  await openChannel(open.id)
}

const looking = ref('')        /* whose card is open beside the room */
vueWatch(finding, (on) => { if (on) { looking.value = ''; if (thread.root) closeThread() } })
vueWatch(looking, (id) => { if (id) { finding.value = false; if (thread.root) closeThread() } })
vueWatch(() => thread.root && thread.root.id, (id) => { if (id) { finding.value = false; looking.value = '' } })

/* THE VOTES OF THE POLLS ON SCREEN. They are rows of their own rather than a count on the message,
   so they are fetched for the polls in view and counted in the browser by tallyPoll. */
const polling = ref(false)          /* the maker's sheet, over the composer */
const pollIds = computed(() => [...open.messages, ...(thread.root ? [thread.root] : []), ...thread.replies]
  /* a poll of the reader's own is on screen under a client-made id before the insert lands, and
     that id is not a uuid: asking for its votes is a request that can only ever fail */
  .filter((m) => m && m.kind === 'poll' && !m.pending && !String(m.id).startsWith('tmp-')).map((m) => m.id))
/* by what the list SAYS and not by its identity: a computed over the messages makes a new array
   every time one lands, and watching the array itself fetched the same votes four times over a
   single channel opening */
vueWatch(() => pollIds.value.join(','), (ids) => {
  const want = ids ? ids.split(',') : []
  if (want.length) loadVotes(want); else votes.value = []
}, { immediate: true })
async function askRoom(p) {
  polling.value = false
  await makePoll(open.id, p.question, p.options, { multi: p.multi })
  await toFoot()
}

const onVisible = () => { if (document.visibilityState === 'visible') catchUp() }

/* Where in the surface a link lands. /spaces is the rooms; /spaces/join/<token> is an
   invitation somebody was sent; /spaces/discover is the page that says what a reader could be in.
   Everything else is a space and a room, which boot() and the rail already handle. */
const path = () => String(window.location.pathname || '')
const joinToken = computed(() => (path().match(/\/spaces\/join\/([A-Za-z0-9_-]{8,})/) || [])[1] || '')

siteFooterOff.value = true
onBeforeUnmount(() => { siteFooterOff.value = false })

/*
 * EVERYTHING THIS SURFACE NEEDS TO KNOW ABOUT WHOEVER IS LOOKING AT IT.
 *
 * It is a function and not the body of onMounted because it is wanted twice: when the page opens,
 * and again when somebody signs in on it. The modules below the page (spaces, the desk, the chats)
 * are told who is here by auth's own broadcast and reload themselves; the page's OWN reads — the
 * members, what is being kept, the queues, the DMs, what is scheduled — had nowhere to be told
 * from, so signing in on the community page left the rooms loaded and the rest of it empty.
 */
async function hydrate() {
  await boot()
  await loadMembers()
  await loadModeration()
  /* whoever answers a queue is told what is waiting in it from the moment the surface opens, not
     from the moment they open the queue — the badge is the reason to open it */
  if (isSupport.value || isProvider.value || isStaff.value) { deskStart(); deskLoad() }
  /* the counts the rail shows are wanted before anybody opens the place they belong to */
  if (isSupport.value) { loadTickets(); loadAgents() }
  loadMyTickets()
  /* what this person has asked not to hear, before anything is counted for them */
  loadHushes()
  /* and, where coaching is answered here, what is waiting in it — the badge on the rail's own
     Coaching place, read from the same counter the sheet's tab used to carry */
  if (moduleOn('coaching') && (site.coaching || {}).where === 'spaces') refreshChatUnread()
  /* the social layout shows Saved only while it holds something, so it needs the count from the start */
  if (SOCIAL) loadSaved().catch(() => {})
  /* which spaces the reader may pin to Home, for the pin in a space's header */
  if (SOCIAL && COMMUNITY) loadNetSpaces().catch(() => {})
  /* the rail names every DM from first paint, so the rows that carry those names come now rather
     than when somebody opens the DM list — a conversation reading "someone, someone" until it is
     clicked is a conversation nobody recognises */
  loadDms()
  /* what is waiting to be sent is wanted before the room it belongs to is opened */
  loadScheduled()
  /* what the address names comes first: /spaces/<space>/<channel>, or /spaces/<space> for the space
     with whatever is most recent in it. With no room named, the room with something unread in it. */
  const named = /^\/spaces\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?\/?$/.exec(path())
  const sp = named && spaces.value.find((x) => x.slug === named[1])
  const asked = named && named[2]
  const room = sp && asked && channels.value.find((x) => x.space_id === sp.id && x.slug === asked)
  if (room) await pick(room.id)
  else if (sp && asked && PLACES.includes(asked)) {
    /* a place rather than a room: /spaces/<space>/events, /people, and /events/<slug> for one */
    enterSpace(sp.id)
    if (asked === 'events' && named[3]) openEvent.value = named[3]
    goTo(asked)
  }
  /* the space alone — or the address of the home it used to have — opens on what it holds */
  else if (sp) await pickSpace(sp.id)
  /* DISCOVER AND AN INVITATION CHOOSE THEIR OWN VIEW, and the address is not a space — so the
     fall-through below must not take them to the front page a moment after they arrived. */
  else if (view.value === 'discover') { /* the view is already where the address asked for */ }
  /* /feed, where the network is one place with the spaces: the view was chosen from the address */
  else if (onFeed(path())) { /* the network's own place */ }
  /* NOTHING NAMED: the front page. Dropping somebody into the first space on its newest room is an
     address that means nothing and a page nobody chose — and it answers neither of the questions
     somebody actually arrives with, which are what is happening and where would I go next. */
  else { view.value = 'index'; loadPeople() }
}

onMounted(() => {
  /*
   * DISCOVER OPENS ON DISCOVER, and the rail still says where you already are. It used to return
   * before hydrating, so somebody looking for a space was told "you are not in a space yet" beside
   * a card saying "yours already" about the space they were in. The view is the only thing the
   * address decides; the rail is the same rail on every one of these pages.
   */
  if (joinToken.value || /\/spaces\/(join|discover)\/?$/.test(path())) view.value = 'discover'
  /* /feed/<place> is one of the reader's own places; the rest of /feed is the network's */
  if (onFeed(path())) { const own = ownViewOf(path()); if (own === 'events') eventsAll.value = true; view.value = own || netViewOf(path()) }
  hydrate()
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('keydown', pressed)
})
/* and again whenever somebody arrives: the modules reload themselves, this is the page's own half.
   Registered for as long as the page is mounted and no longer. */
const offIdentity = onIdentity((id) => {
  if (!id) return   /* signing out reloads the page; there is nothing to hydrate for a guest here */
  hydrate()
})
onBeforeUnmount(offIdentity)
/* a community keeps its own: who may moderate it and what waits on them is asked again per space */
vueWatch(() => space.value && space.value.id, loadModeration)
onBeforeUnmount(() => { document.removeEventListener('visibilitychange', onVisible); stop(); deskStop() })
/* a message lands in the channel that is open — but only reading it marks it read, and a member
   of staff on the Desk is not reading it: the row would vanish from under them as it arrived */
vueWatch(() => open.messages.length, () => { if (open.id && view.value === 'channel') markRead(open.id) })
</script>

<template>
  <SiteLayout :current="ROUTES.spaces">
  <div class="sp-page" :class="{ 'sp-social': SOCIAL }" :style="paint()">
    <!-- on a phone only: the one way to the nav, and which space this is -->
    <div class="sp-bar-m">
      <button type="button" class="sp-open" :aria-label="CH.spaces" @click="railOpen = true">☰</button>
      <b>{{ inSpace && space ? space.name : (CH.title || W.title) }}</b>
    </div>
    <div class="sp-body" :class="{ 'sp-wide': WIDE }">
      <div class="sp-nav" :class="{ out: railOpen }">
        <SocialNav
          v-if="SOCIAL" class="sp-snav" :view="navView" :network="COMMUNITY" :spaces="spaces" :channels="channels" :unread="unread"
          :space-id="inSpace && space ? space.id : ''" :channel-id="view === 'channel' ? (open.id || '') : ''" :work="workList"
          :events="EVENTS_ON" :coaching-unread="coachingHere ? chatUnread : 0" :dm-unread="dmUnread" :mentions="mentionCount"
          :saved="saved.length" :drafts="draftRows.length" :my-tickets="myTicketCount" :net-unread="netUnread"
          :coaching="coachingHere" :event-spaces="eventSpaces" :keeps="moderating && space ? [space.id] : []"
          @view="socialGo" @space="(id) => { railOpen = false; pickSpace(id) }" @open="(id) => { railOpen = false; pick(id) }"
          @place="(id, key) => { railOpen = false; openPlace(id, key) }"
          @drawer="railOpen = true" />
        <template v-else>
        <SpaceBar
          class="sp-bar" :spaces="spaces" :badges="badges" :open-id="space ? space.id : ''" :in-space="inSpace"
          :view="view" :events="EVENTS_ON" :work="workList" :my-tickets="myTicketCount"
          :coaching="coachingHere" :coaching-unread="coachingHere ? chatUnread : 0"
          :saved="saved.length" :drafts="draftRows.length"
          :mentions="mentionCount" :dm-unread="dmUnread" :unreads="unreadCount" :status="status"
          :me="me" :names="names" :myself="myName" :my-person="myPerson"
          :network="COMMUNITY" :network-unread="netUnread"
          @view="socialGo" @open-space="(id) => { railOpen = false; pickSpace(id) }"
          @status="setStatus" />
        <SpaceRail
          v-if="inSpace && space" class="sp-rail" :space="space" :channels="channels" :unread="unread" :events="hasEvents"
          :members="members" :names="names" :here="here" :me="me" :drafts="drafts" :active-id="open.id" :view="view"
          :moderating="moderating" :reports="waitingReports"
          @open="(id) => { railOpen = false; pick(id) }" @join="async (id) => { railOpen = false; await join(id); await pick(id) }"
          @view="(v) => { railOpen = false; openPlace(space.id, v) }" @compose="composing = true" @browse="browsing = true"
          @find="railOpen = false; finding = true" />
        </template>
      </div>
      <Transition name="sp-chat-veil">
        <div v-if="railOpen" class="sp-veil" @click="railOpen = false"></div>
      </Transition>
      <SocialNav v-if="SOCIAL" part="bottom" :view="navView" :network="COMMUNITY" :events="EVENTS_ON" :dm-unread="dmUnread" :coaching-unread="coachingHere ? chatUnread : 0" :net-unread="netUnread" :mentions="mentionCount" @view="socialGo" @drawer="railOpen = true" />

      <!-- THE OPEN SPACE, in the social layout: its name and its tabs above the column -->
      <div v-if="SOCIAL && inSpace && space && !(view === 'events' && eventsAll)" class="sp-shead">
        <div class="sp-shead-row">
          <div class="sp-shead-title">
            <span v-if="roomTitled" class="sp-seyebrow">{{ space.name }}</span>
            <h2 v-if="roomTitled">
              <SpaceIcon v-if="channel.visibility === 'private'" name="lock" :size="17" />{{ channelTitle }}
              <span v-if="channel.encrypted" class="sp-sealed-mark" role="img" :title="EN.room.sealed" :aria-label="EN.room.sealed"><SpaceIcon name="shield" :size="15" /></span>
            </h2>
            <h2 v-else>{{ space.name }}</h2>
          </div>
          <div class="sp-shead-tools">
            <!-- the open room's own tools land here (the room's header below teleports them) -->
            <div id="sp-shead-tools" class="sp-shead-room"></div>
            <!-- PINNING THE SPACE'S FEED TO HOME, from the space itself -->
            <button v-if="COMMUNITY && PINNING && pinOf" type="button" class="sp-pin" :class="{ on: pinOf.pinned }" :aria-pressed="!!pinOf.pinned" :disabled="pinBusy" @click="togglePinHome">
              <SpaceIcon name="pin" :size="14" /><span>{{ pinOf.pinned ? NT['unpin-home'] : NT['pin-home'] }}</span>
            </button>
          </div>
        </div>
        <p v-if="roomTitled ? channel.topic : spaceLine" class="sp-sline" :title="roomTitled ? channel.topic : spaceLine">{{ roomTitled ? channel.topic : spaceLine }}</p>
        <!-- TABS ONLY FOR A SPACE OF ONE ROOM: a space of several carries its rooms and places in the
             navigation (places.js spaceItems), and tabs above would say it twice -->
        <nav v-if="spaceTabbed(space.id, channels)" class="sp-stabs" :aria-label="space.name">
          <button v-for="t in spaceTabs" :key="t.key" type="button" :class="{ on: t.on }" :aria-pressed="t.on" @click="t.go()"><span>{{ t.word }}</span></button>
        </nav>
      </div>

      <!-- a place this reader may not enter: what it costs, in its place -->
      <div v-if="lockedHere" class="sp-plain sp-locked"><NetJoinCard /></div>

      <SpaceDesk
        v-else-if="view === 'support' || view === 'clients' || view === 'comments' || view === 'social-comments' || view === 'social-dms'" :key="view" class="sp-plain" :queue="view"
        :names="names" :members="members" :channels="channels" :me="me" />

      <SpaceTickets v-else-if="view === 'tickets'" class="sp-plain" :me="me" :agents="deskAgents" />

      <SpaceMyTickets v-else-if="view === 'my-tickets'" class="sp-plain" />

      <!-- a registered place (the kit's Coaching, a site's own): the registry mounts it -->
      <component :is="placeOf(view).component" v-else-if="placeOf(view) && placeOf(view).component" :key="view" class="sp-plain sp-place" v-bind="placeOf(view).props()" />

      <!-- /spaces with nothing named: the community's own front page rather than whichever space
           happened to be first, on whichever room happened to have the newest message -->
      <!-- THE NETWORK'S COLUMN, where the network and the spaces are one place -->
      <div v-else-if="view === 'net' || view === 'net-notes'" class="sp-plain sp-net">
        <div class="sp-net-in"><NetColumn ref="netColumn" @open-message="openFromFeed" @open-event="(slug) => { eventsAll = true; goTo('events'); openEvent = slug }" /><div v-if="!SOCIAL" class="sp-net-side"><NetAside @pinned="netColumn && netColumn.refresh()" /></div></div>
      </div>

      <SpaceIndex
        v-else-if="view === 'index'" class="sp-plain" :spaces="spaces" :rows="unread" :people="people"
        :names="names" :me="me" :my-name="myName" :my-person="myPerson"
        @space="pickSpace" @open="pick"         @events="socialGo('events')" @find="browsing = true"
        @start="composing = true" @who="(id) => { looking = id }" />


      <!-- what is on, and one event on its own page -->
      <SpaceEvents
        v-else-if="view === 'events' && !openEvent" class="sp-plain" :space="eventsAll ? null : space"
        @open="(slug) => { openEvent = slug }" @join="joinOccurrence" @book="bookSession" />
      <SpaceEvent
        v-else-if="view === 'events'" class="sp-plain" :slug="openEvent" :names="names"
        @back="openEvent = ''" @join="joinOccurrence" />

      <SpacePeople
        v-else-if="view === 'people'" class="sp-plain" :space="space" :channels="channels"
        :here="here" :me="me" @who="(id) => { goTo('channel'); looking = id }"
        @write="async (id) => { const c = await openDm(space.id, [id]); await loadMembers(); if (c) await pick(c); else sayRefused() }" />

      <SpaceModeration v-else-if="view === 'keeping'" class="sp-plain" :space="space" />

      <SpaceDiscover
        v-else-if="view === 'discover'" class="sp-plain" :token="joinToken"
        @joined="async (id) => { await boot(); const sp = spaces.value.find((x) => x.id === id || x.slug === id) || space.value; if (sp) await pickSpace(sp.id) }" />

      <SpaceDms
        v-else-if="view === 'dms'" class="sp-plain" :rows="dms" :me="me" :spaces="spaces"
        :pinned="null" @pinned="goTo('coaching')"
        @compose="composing = true" @open="openDmRow" />

      <SpaceFeed
        v-else-if="view !== 'channel'" class="sp-main" :kind="view"
        :rows="view === 'threads' ? threads : view === 'mentions' ? mentions : view === 'unreads' ? unreads : view === 'drafts' ? draftRows : saved"
        :names="namesOut" :members="members" :me="me" :space-of="spaceOf" :tabs="noteTabs" @tab="goTo"
        @open="openFromFeed" @unsave="unsave" @done="(l) => {}" @drop="(id) => draft(id, '')"
        @read="readOne" @read-all="readAll" />

      <section v-else class="sp-main">
        <header v-if="channel" class="sp-head" :class="{ 'sp-head-up': roomInHead }">
          <h2>
            <SpaceIcon v-if="channel.kind !== 'dm'" :name="channel.visibility === 'private' ? 'lock' : 'hash'" :size="15" />
            <span v-if="channel.kind === 'dm'" class="sp-face">
              <SpaceAvatar :name="channelTitle" :size="22" />
              <i v-if="dmPeer" class="sp-here" :class="'is-' + (here[dmPeer] || 'off')"></i>
            </span>
            {{ channelTitle }}
            <!-- and the seal, beside the name of the room somebody is reading. The lock to the
                 left of the name says who may come in; this says what the site can read, and a
                 room is often both — so it is its own mark and not a swapped glyph. -->
            <span v-if="channel.encrypted" class="sp-sealed-mark" role="img" :title="EN.room.sealed" :aria-label="EN.room.sealed">
              <SpaceIcon name="shield" :size="14" />
            </span>
          </h2>
          <p v-if="channel.topic" class="sp-topic">{{ channel.topic }}</p>
          <Teleport defer to="#sp-shead-tools" :disabled="!roomInHead">
          <div v-if="laterHere.length" class="sp-pinmenu">
            <button type="button" class="sp-pinned" :class="{ on: showLater }" @click="showLater = !showLater">
              <SpaceIcon name="clock" :size="13" />{{ laterLabel }}
            </button>
            <div v-if="showLater" class="sp-pinbox">
              <article v-for="s in laterHere" :key="s.id" class="sp-pinrow">
                <b>{{ s.failed ? LW.failed : sayWhenFull(s.send_at) }}</b>
                <p>{{ plainBody(s.body || '', names, {}) }}</p>
                <footer>
                  <small>{{ LW['waiting-title'] }}</small>
                  <button v-if="!s.failed" type="button" @click="sendNow(s)">{{ LW['send-now'] }}</button>
                  <button type="button" @click="unschedule(s.id)">{{ LW.drop }}</button>
                </footer>
              </article>
            </div>
          </div>
          <div v-if="open.pins.length" class="sp-pinmenu">
            <button type="button" class="sp-pinned" :class="{ on: pinning }" @click="pinning = !pinning">
              <SpaceIcon name="pin" :size="13" />{{ pinLabel }}
            </button>
            <div v-if="pinning" class="sp-pinbox">
              <article v-for="x in open.pins" :key="x.message_id" class="sp-pinrow">
                <b>{{ names[x.author_id] || W.someone }}</b>
                <p>{{ plainBody(x.body || '', names, {}) }}</p>
                <footer>
                  <small>{{ (CW['pinned-by'] || '').replace('{who}', x.by || W.someone) }}</small>
                  <button type="button" @click="goToPin(x)">{{ CW['pinned-go'] }}</button>
                  <button v-if="mayPinHere" type="button" @click="togglePin(x.message_id, false)">{{ CW.unpin }}</button>
                </footer>
              </article>
            </div>
          </div>
          <div class="sp-tools">
            <!-- who is here, at a glance, where there is no People tab (the chat layout) -->
            <span v-if="people.length && !SOCIAL" class="sp-people">
              <SpaceAvatar v-for="p in people.slice(0, 3)" :key="p.id" :name="p.name" :size="22" />
              <b>{{ people.length }}</b>
            </span>
            <button
              v-if="myRow && !(channel && channel.mode === 'feed')" type="button" class="sp-huddle" :class="{ on: huddle && huddle.id === open.id }"
              @click="huddle = huddle && huddle.id === open.id ? huddle : channel">
              {{ huddle && huddle.id === open.id ? us('spaces').call.main.join : us('spaces').call.main.start }}
            </button>
            <div v-if="myRow" class="sp-menu">
              <button type="button" class="sp-ico" :title="NW.title" :aria-label="NW.title" @click="belling = !belling">
                <SpaceIcon name="bell" :size="17" />
              </button>
              <ul v-if="belling" class="sp-drop">
                <li v-for="o in ['mentions', 'all', 'none']" :key="o">
                  <button type="button" :class="{ on: myRow.notify === o }" @click="setNotify(open.id, o); belling = false">
                    <b>{{ NW[o] }}</b><span>{{ NW[o + '-line'] }}</span>
                  </button>
                </li>
                <!-- MUTE, under the same bell, because "how much do I hear from here" and "nothing at
                     all for a while" are one question. A while and not only for ever: most muting is
                     somebody getting through an afternoon, and a mute with no end is how a room gets
                     quietly abandoned. The space below it is every room in it at once, and every room
                     it gains next week — which is why muting a space is not fifteen channel mutes. -->
                <li class="sp-sep"></li>
                <li v-if="mutedHere" class="sp-muted">
                  <button type="button" @click="unhush('channel', open.id); belling = false">
                    <b>{{ MuW.unmute }}</b><span>{{ mutedSays }}</span>
                  </button>
                </li>
                <template v-else>
                  <li v-for="w in MUTES" :key="w.key">
                    <button type="button" @click="hush('channel', open.id, w.at()); belling = false">
                      <b>{{ (MuW['mute-for'] || '').replace('{span}', MuW['for-' + w.key]) }}</b>
                    </button>
                  </li>
                </template>
                <li v-if="spaceId" class="sp-sep"></li>
                <li v-if="spaceId">
                  <button type="button" @click="mutedSpace ? unhush('space', spaceId) : hush('space', spaceId, null); belling = false">
                    <b>{{ mutedSpace ? MuW['unmute-space'] : MuW['mute-space'] }}</b>
                    <span>{{ mutedSpace ? MuW['unmute-space-line'] : MuW['mute-space-line'] }}</span>
                  </button>
                </li>
                <!-- WHETHER THIS PERSON WILL BE WRITTEN TO HERE. Beside muting because it answers
                     the same question — what reaches me in this place — and per space, since
                     somebody may want their coach's community open and a busy server closed.
                     Declining stops a NEW conversation and nothing else: every thread they are
                     already in keeps working, and is all still there if they change their mind. -->
                <li v-if="spaceId && space && space.dms !== false">
                  <button type="button" @click="setDms(spaceId, !dmsMine); belling = false">
                    <b>{{ dmsMine ? MuW['dms-off'] : MuW['dms-on'] }}</b>
                    <span>{{ dmsMine ? MuW['dms-off-line'] : MuW['dms-on-line'] }}</span>
                  </button>
                </li>
                <li class="sp-sep"></li>
                <li>
                  <button type="button" @click="star(open.id, !myRow.starred); belling = false">
                    <b>{{ myRow.starred ? RW['section-starred'] + ' ✓' : RW['section-starred'] }}</b>
                  </button>
                </li>
              </ul>
            </div>
          </div>
          </Teleport>
        </header>

        <SpaceForum
          v-if="channel && channel.mode === 'forum' && !readingPost" class="sp-scroll" :posts="open.posts" :names="names" :flair="flairs" :faces="faces" :me="me"
          :channel="channelTitle" :channel-id="open.id" :encrypted="!!channel.encrypted"
          @open="openThread" @new="posting = true" />

        <!-- the post, whole, where the board was -->
        <SpacePost
          v-else-if="readingPost" class="sp-scroll" :root="thread.root" :replies="thread.replies" :names="names" :flair="flairs" :faces="faces" :me="me"
          :channel="channelTitle" :reactions="reactionsFor" :may-pin="mayPinHere" :pinned="pinnedIds.has(thread.root.id)"
          :reportable="reportable"
          @back="closeThread" @react="(id, e) => react(id, e)" @withdraw="(id) => withdraw(id)"
          @report="(id) => { reporting = (thread.replies.find((r) => r.id === id) || thread.root) }"
          @choose="tookOffer"
          @pin="(on) => togglePin(thread.root.id, on)" />

        <!-- A FEED: each post whole in a card, newest first, its first answers under it (the post's own
             "n replies" line is the way into the rest) -->
        <div v-else-if="channel && channel.mode === 'feed'" class="sp-scroll">
          <div class="sp-feedch">
            <!-- WRITING A POST: the box at the top of the feed, the way a group's feed opens -->
            <div v-if="mayWriteHere" class="sp-fwrite">
              <SpaceComposer
                :key="'f:' + open.id"
                :people="people.filter((p) => p.id !== me)" :may-mention-channel="mentionHere"
                :channel-name="channel ? channel.name : ''"
                :placeholder="(CW['feed-write'] || '').replace('{name}', (space && space.name) || channelTitle)"
                :draft="drafts[open.id] || ''"
                :may-voice="voiceHere" :may-file="fileHere" :may-poll="true" :may-media="!(channel && channel.encrypted)"
                :commands="myCommands" :bots="myBots" :groups="groups" :may-later="false"
                @poll="polling = true" @command="runCommand" @media="postedMedia"
                @send="say($event)" @typing="saidSomething(open.id)"
                @voice="saidAloud" @file="attached" @draft="(t) => draft(open.id, t)" />
            </div>
            <p v-if="open.loading && !open.messages.length" class="sp-note">{{ W.loading }}</p>
            <div v-else-if="!feedPosts.length" class="sp-feedch-empty">
              <b>{{ CW['feed-empty-title'] }}</b>
              <span>{{ (CW['feed-empty-line'] || '').replace('{name}', channelTitle) }}</span>
            </div>
            <div v-for="m in feedPosts" :key="m.id" class="sp-fcard">
              <SpaceLine
                :reportable="reportable" @report="reporting = m" @who="(id) => { looking = id }"
                :votes="votes" :may-close="moderating"
                @vote="(v) => vote(v.message, v.key, { multi: v.multi })"
                @unvote="(v) => unvote(v.message, v.option)" @close-poll="closePoll"
                :message="m" :names="names" :flair="flairs" :faces="faces" :me="me" :first="true" :sided="sided" :reactions="reactionsFor(m.id)" :takes-reactions="takesReactions" :takes-votes="takesVotes"
                :may-pin="mayPinHere" :pinned="pinnedIds.has(m.id)" @pin="(on) => togglePin(m.id, on)"
                :mentions-me="mentionsMe(m)" :repliers="[]"
                :may-write="mayWriteHere" @choose="tookOffer"
                :hide-replies="true"
                @thread="openThread(m.id)" @react="(e) => react(m.id, e)" @withdraw="withdraw(m.id)" />
              <NetMedia v-if="m.media && m.media.length" class="sp-fmedia" :media="m.media" :urls="mediaUrls" />
              <SpaceFeedActions indent :message="m" :reactions="reactionsFor(m.id)" :may-react="takesReactions && mayWriteHere" @react="(e) => react(m.id, e)" @comment="openThread(m.id)" />
              <div v-if="(feedReplies[m.id] || []).length" class="sp-freplies">
                <SpaceLine
                  v-for="r in feedReplies[m.id]" :key="r.id"
                  :reportable="reportable" @report="reporting = r" @who="(id) => { looking = id }"
                  :votes="votes" :may-close="moderating"
                  :message="r" :names="names" :flair="flairs" :faces="faces" :me="me" :first="true" :sided="sided" :reactions="reactionsFor(r.id)" :takes-reactions="takesReactions" :takes-votes="takesVotes"
                  :may-pin="false" :pinned="false"
                  :mentions-me="mentionsMe(r)" :repliers="[]"
                  :may-write="mayWriteHere" @choose="tookOffer"
                  @thread="openThread(m.id)" @react="(e) => react(r.id, e)" @withdraw="withdraw(r.id)" />
              </div>
              <SpaceFeedActions part="write" :message="m" :may-write="mayWriteHere" @comment="openThread(m.id)" />
            </div>
            <button v-if="!open.done && feedPosts.length" type="button" class="sp-earlier" @click="older">{{ CW['feed-older'] }}</button>
          </div>
        </div>

        <div v-else ref="scroller" class="sp-scroll">
          <div class="sp-stream">
          <p v-if="open.loading && !open.messages.length" class="sp-note">{{ W.loading }}</p>
          <button v-else-if="!open.done && open.messages.length" type="button" class="sp-earlier" @click="older">{{ CW.earlier }}</button>
          <div v-if="channel && open.done" class="sp-start">
            <h3>
              <SpaceIcon v-if="channel.kind !== 'dm'" :name="channel.visibility === 'private' ? 'lock' : 'hash'" :size="22" />
              {{ channelTitle }}
            </h3>
            <p>{{ (CW.start || '').replace('{name}', channelTitle) }}</p>
          </div>

          <!--
            WHERE A SEALED ROOM BEGINS, FOR THIS READER.

            A member who joins reads from the moment they joined: the keys to what came before are
            on the devices of the people who were already here, and nobody on this side can hand
            them over. Said HERE, at the top of the timeline, and not as a toast — a toast is for
            something that just happened and is over, and this is a standing fact about the room
            that must still be there when they scroll back up to look for what is missing.

            It is set as a system line, which is what it is: the room telling them something.
          -->
          <div v-if="channel && channel.encrypted" class="sp-sealed">
            <p class="sp-sealed-head">{{ EN.room.sealed }}</p>
            <p>{{ EN.room['sealed-line'] }}</p>
            <p class="sp-sealed-why">{{ EN.room.history }} {{ EN.room['history-line'] }}</p>
          </div>

          <div v-for="day in sections" :key="day.key" class="sp-day">
            <div class="sp-rule"><span>{{ day.label }}</span></div>
            <template v-for="m in runs(day.messages)" :key="m.id">
              <div v-if="m.seq === open.divider" class="sp-new"><span>{{ CW['new-below'] }}</span></div>
              <SpaceLine
                :reportable="reportable" @report="reporting = m" @who="(id) => { looking = id }"
                :votes="votes" :may-close="moderating"
                @vote="(v) => vote(v.message, v.key, { multi: v.multi })"
                @unvote="(v) => unvote(v.message, v.option)" @close-poll="closePoll"
                :message="m" :names="names" :flair="flairs" :faces="faces" :me="me" :first="m.first" :sided="sided" :reactions="reactionsFor(m.id)" :takes-reactions="takesReactions" :takes-votes="takesVotes"
                :may-pin="mayPinHere" :pinned="pinnedIds.has(m.id)" @pin="(on) => togglePin(m.id, on)"
                :mentions-me="mentionsMe(m)" :repliers="repliersOf(m.id)"
                :may-write="mayWriteHere" @choose="tookOffer"
                @thread="openThread(m.thread_root_id || m.id)" @react="(e) => react(m.id, e)" @withdraw="withdraw(m.id)" />
            </template>
          </div>

          <p v-if="!open.id && booted" class="sp-note">{{ W.pick }}</p>
          </div>
        </div>

        <p class="sp-typing">
          <Transition name="sp-rise">
            <span v-if="typingNow.length" class="sp-dots">
              <i aria-hidden="true"></i><i aria-hidden="true"></i><i aria-hidden="true"></i>
              {{ typingNow.length === 1 ? (CW['typing-one'] || '').replace('{name}', typingNow[0]) : CW['typing-many'] }}
            </span>
          </Transition>
        </p>

        <!-- asking the room: a question and rows, never a grammar typed into the box -->
        <div v-if="polling" class="sp-ask">
          <SpacePollMaker @ask="askRoom" @cancel="polling = false" />
        </div>

        <div v-if="posting" class="sp-post">
          <input v-model="postTitle" type="text" :placeholder="CW['post-title']" :aria-label="CW['post-title']" />
        </div>
        <p v-if="botTrouble" class="sp-bottrouble">
          <SpaceIcon name="sparkle" :size="12" />
          <span>{{ (BotW['could-not'] || '').replace('{name}', botTrouble.name) }} {{ (BotW.why || '').replace('{reason}', botTrouble.why) }}</span>
          <button type="button" :aria-label="BotW.dismiss" @click="botTrouble = null">{{ BotW.dismiss }}</button>
        </p>
        <!-- WHAT A SEALED ROOM ASKS OF THIS BROWSER, above the composer rather than over the room:
             the device's keys, the recovery key once, or the key that opens a history this browser
             was not there for. It shows nothing at all once there is nothing to ask. -->
        <SpaceSealSetup v-if="open.id && channel && channel.encrypted" />
        <!-- one composer at the foot of the pane, and what it writes into depends on what is open:
             the room, a new post, or — in a forum with a post open — that post's replies. A second
             composer inside the reading column would put two boxes on one screen. -->
        <SpaceComposer
          v-if="readingPost"
          :key="'p:' + thread.root.id"
          :people="people.filter((p) => p.id !== me)" :may-mention-channel="mentionHere" :thread="true" :may-echo="false"
          :bots="myBots" :groups="groups" :channel-name="channel ? channel.name : ''"
          :placeholder="us('spaces').composer.main['placeholder-thread']"
          :may-voice="voiceHere" :may-file="fileHere"
          @send="sayInThread" @voice="saidAloudInThread" @file="attachedInThread" @typing="saidSomething(open.id)" />
        <SpaceComposer
          v-else-if="open.id && (channel && channel.mode !== 'forum' && channel.mode !== 'feed' || posting)"
          :key="'c:' + open.id + (posting ? ':post' : '')"
          :people="people.filter((p) => p.id !== me)" :may-mention-channel="mentionHere"
          :channel-name="channel ? channel.name : ''"
          :placeholder="composerSays"
          :draft="drafts[open.id] || ''"
          :may-voice="voiceHere && !posting" :may-file="fileHere && !posting"
          :may-poll="!!channel && channel.kind !== 'dm' && !posting"
          :commands="myCommands" :bots="myBots" :groups="groups" :may-later="!posting && !!channel && channel.mode !== 'forum'"
          @poll="polling = true" @command="runCommand" @later="scheduleIt"
          @send="posting ? newPost($event) : say($event)" @typing="saidSomething(open.id)"
          @voice="saidAloud" @file="attached" @draft="(t) => draft(open.id, t)" />
      </section>

      <Transition name="sp-slide">
        <SpaceMember
          v-if="looking" class="sp-side" :space="space" :user-id="looking" :me="me" :here="here"
          @close="looking = ''"
          @write="async (id) => { looking = ''; const c = await openDm(space.id, [id]); await loadMembers(); if (c) await pick(c); else sayRefused() }" />
      </Transition>

      <Transition name="sp-slide">
        <SpaceSearch
          v-if="finding" class="sp-side" :people="people" :channels="channels" :names="names" :results="found" :busy="busy" :sealed="sealedOut"
          @search="find" @open="openHit" @close="finding = false" />
      </Transition>

      <Transition name="sp-fade">
      <div v-if="composing || browsing" class="sp-modal" @click.self="composing = false; browsing = false; whoQ = ''">
        <div class="sp-sheet">
          <header><h3>{{ composing ? RW['new-dm'] : RW.browse }}</h3>
            <button type="button" :aria-label="TW.close" @click="composing = false; browsing = false">×</button></header>
          <label v-if="composing" class="sp-find">
            <SpaceIcon name="search" :size="14" />
            <input v-model="whoQ" type="search" :placeholder="RW['find-person']" :aria-label="RW['find-person']" />
          </label>
          <ul v-if="composing" class="sp-who">
            <li v-for="p in whoShown" :key="p.id">
              <label>
                <input v-model="chosen" type="checkbox" :value="p.id" />
                <SpaceAvatar :name="p.name" :size="26" /><span>{{ p.name }}</span>
              </label>
            </li>
            <li v-if="!whoShown.length" class="sp-none">{{ whoQ.trim() ? RW['find-none'] : RW['nobody-else'] }}</li>
          </ul>
          <ul v-else class="sp-who">
            <li v-for="c in roomsHere" :key="c.id">
              <button
                type="button" class="sp-joinrow" :class="{ already: c.joined }"
                @click="async () => { browsing = false; if (!c.joined) await join(c.id); await pick(c.id) }">
                <SpaceIcon :name="c.visibility === 'private' ? 'lock' : 'hash'" :size="14" />
                <span class="sp-room">{{ c.name }}<i v-if="c.topic">{{ c.topic }}</i></span>
                <em v-if="c.joined">{{ RW.joined }}</em>
              </button>
            </li>
            <li v-if="!roomsHere.length" class="sp-none">{{ RW['no-rooms'] }}</li>
          </ul>
          <footer v-if="composing">
            <button type="button" class="sp-go" :disabled="!chosen.length" @click="startDm">{{ RW['start-dm'] }}</button>
          </footer>
        </div>
      </div>
      </Transition>

      <!-- A report is a reason from a list. A free box alone would be a place to say anything to
           somebody who did not ask to read it; the list is what a moderator answers by. -->
      <Transition name="sp-fade">
      <div v-if="reporting" class="sp-modal" @click.self="reporting = null">
        <div class="sp-sheet">
          <header><h3>{{ MW.title }}</h3>
            <button type="button" :aria-label="TW.close" @click="reporting = null">×</button></header>
          <ul class="sp-who">
            <li v-for="r in REASONS" :key="r">
              <button type="button" class="sp-joinrow" @click="sendReport(r)">
                <SpaceIcon name="flag" :size="14" /><span>{{ MW['reason-' + r] }}</span>
              </button>
            </li>
          </ul>
          <footer><p class="sp-fine">{{ MW.note }}</p></footer>
        </div>
      </div>
      </Transition>

      <SpaceCall v-if="huddle" :channel="huddle" :me="me" @close="huddle = null" @open="pick" />

      <!-- BESIDE THE COLUMN in the social layout, until a thread or a card takes its place -->
      <SocialAside v-if="SOCIAL && !WIDE && !(thread.root && !readingPost) && !looking && !finding" class="sp-saside"
        @events="socialGo('events')" @event="(slug) => { eventsAll = true; goTo('events'); openEvent = slug }" @session="openSessions" />

      <Transition name="sp-slide">
      <aside v-if="thread.root && !readingPost" class="sp-side sp-thread">
        <header class="sp-thead">
          <h3>{{ TW.title }}</h3>
          <button type="button" :aria-label="TW.close" @click="closeThread">×</button>
        </header>
        <div class="sp-tscroll">
          <SpaceLine :message="thread.root" :names="names" :flair="flairs" :faces="faces" :me="me" :first="true" :sided="sided" :reactions="reactionsFor(thread.root.id)" :takes-reactions="takesReactions" :takes-votes="takesVotes" :hide-replies="true" :may-write="mayWriteHere" @choose="tookOffer" />
          <div class="sp-trule"><span>{{ thread.replies.length === 1 ? CW['replies-one'] : (CW['replies-many'] || '').replace('{n}', thread.replies.length) }}</span></div>
          <p v-if="!thread.replies.length" class="sp-note">{{ TW.empty }}</p>
          <SpaceLine
            v-for="r in runs(thread.replies)" :key="r.id" :message="r" :names="names" :flair="flairs" :faces="faces" :me="me" :first="r.first" :sided="sided"
            :reactions="reactionsFor(r.id)" :takes-reactions="takesReactions" :takes-votes="takesVotes" :may-write="mayWriteHere" @choose="tookOffer" @react="(e) => react(r.id, e)" @withdraw="withdraw(r.id)" />
        </div>
        <SpaceComposer
          :key="'t:' + (thread.root ? thread.root.id : '')"
          :people="people.filter((p) => p.id !== me)" :may-mention-channel="mentionHere" :thread="true" :bots="myBots" :groups="groups"
          :channel-name="channel ? channel.name : ''" :placeholder="us('spaces').composer.main['placeholder-thread']"
          :may-voice="voiceHere" :may-file="fileHere"
          @send="sayInThread" @voice="saidAloudInThread" @file="attachedInThread" @typing="saidSomething(open.id)" />
      </aside>
      </Transition>
    </div>
  </div>
  <SpaceKeys v-if="helping" @close="helping = false" />
  </SiteLayout>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements — header carries 70px of padding and a rule, p a
   bottom margin and a 74ch measure — so each class says what it wants instead.
   The five colours a workspace wears are the look's to own (src/looks/*.css); the values here are
   the rule owed to a look that has not named them. */
.sp-page { font-family: var(--spaces-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif);
  --sp-rail: var(--spaces-rail, #14161c); --sp-side: var(--spaces-side, #1d2028);
  --sp-side-ink: var(--spaces-side-ink, #d5d7dd);
  /* the row a person is standing on is a lighter panel of the sidebar, never a colour: a place of
     work wears none of the site's marketing accent, and a chrome that is only ever a shade of
     itself cannot clash with anything anybody says in it */
  --sp-side-on: var(--spaces-side-on, #2b3040);
  --sp-go: var(--spaces-go, #1b7f5a);
  /* the three colours the surface does allow: what can be opened, what is an alert, and the wash on
     a line that names you */
  --sp-link: var(--spaces-link, #1f6f66); --sp-badge: var(--spaces-badge, #c8382f);
  --sp-tint: var(--spaces-tint, #fdf2d8); --sp-tint-bar: var(--spaces-tint-bar, #dda229);
  /* the one curve everything in here moves on */
  --sp-ease: cubic-bezier(.2, .8, .2, 1);
  display: grid; grid-template-rows: minmax(0, 1fr); height: calc(100dvh - var(--headh)); min-height: 0;
  background: var(--sp-rail) }
/* ONE nav column, and it is always there. It was two — a strip of two-letter tiles beside a channel
   list — and the tiles said nothing a reader could read while the list said something untrue on
   every view that was not a room. TWO columns hold the two levels honestly: the person's own — their
   four places and every space by name, always there — and the open space's rooms, which exist only
   inside a space. Nothing is hidden behind a control, and there is always a way back into a room. */
.sp-body { display: grid; grid-template-columns: 214px minmax(0, 1fr); min-height: 0; height: 100% }
.sp-body:has(.sp-rail) { grid-template-columns: 214px 252px minmax(0, 1fr) }
.sp-body:has(.sp-side) { grid-template-columns: 214px minmax(0, 1fr) minmax(300px, 380px) }
.sp-body:has(.sp-rail):has(.sp-side) { grid-template-columns: 214px 252px minmax(0, 1fr) minmax(300px, 380px) }
/* FOUR COLUMNS NEED A WIDE SCREEN. 214 + 252 + 300 of furniture leaves a narrow laptop about two
   hundred pixels for the room itself, which is a message every three words. Under this the side
   panel lies over the room instead of taking a column of its own — the room is still there behind
   it, and the panel still closes the way it always did. */
@media (max-width: 1180px) {
  .sp-body:has(.sp-rail):has(.sp-side) { grid-template-columns: 214px 252px minmax(0, 1fr) }
  .sp-body:has(.sp-side) { grid-template-columns: 214px minmax(0, 1fr) }
  .sp-side { position: absolute; inset: 0 0 0 auto; width: min(380px, 62vw); z-index: 22;
    box-shadow: -18px 0 40px color-mix(in srgb, #000 22%, transparent) }
  .sp-page { position: relative }
}
/* the two columns are the grid's own children on a wide screen, and one drawer on a narrow one */
.sp-nav { display: contents }
.sp-bar, .sp-rail { min-height: 0 }
/* A bare section wears 56px of the global stylesheet's padding, which inset the whole channel.
   A column and not a row template: three of the children here come and go (the huddle, the post's
   title, the composer), and a template of six rows hands the 1fr to whichever child happens to be
   third — which for a channel with no huddle open was the typing line, leaving the messages in an
   auto row at the top and the composer floating clear of the foot. */
.sp-main { display: flex; flex-direction: column; min-height: 0; height: 100%;
  margin: 0; padding: 0; background: var(--paper); overflow: hidden }
/* the same frame for a surface that lays itself out: the row template above is the channel's, and a
   child's scoped style is injected before its parent's, so it would win a tie it should not be in */
/* AND IT SAYS NOTHING ABOUT OVERFLOW, which is the whole of the difference. The channel frames
   its own scroller and is hidden; a surface that lays itself out IS the scroller — the community
   front page, a space own home, the people, the events, discover, the keeping — and each of them
   says overflow-y: auto on its own root. A shorthand here overrode every one of those (equal
   specificity, and a child scoped style is injected before its parent own), so seven surfaces were
   a 932px window onto four thousand pixels of content with no way to reach the rest of it. The
   overflow of a surface is declared once, by the surface. */
.sp-plain { min-height: 0; height: 100%; margin: 0; padding: 0; background: var(--paper) }
/* the join card, where a locked place would be: placed exactly as Home places it, so every locked place reads the same */
.sp-locked { overflow-y: auto }
/* the network's column, in the middle of the pane at the width a timeline reads at */
.sp-net { overflow-y: auto; background: color-mix(in srgb, var(--ink) 2%, var(--paper)) }
.sp-net-in { display: grid; grid-template-columns: minmax(0, 640px) 320px; justify-content: center; gap: 0 24px; min-height: 100% }
.sp-net-in > :deep(.fd-main) { min-height: 100% }
.sp-net-side { padding-top: 16px }
.sp-net-side :deep(.nas) { top: 16px }
@media (max-width: 1180px) { .sp-net-in { grid-template-columns: minmax(0, 640px) } .sp-net-side { display: none } }
/* The chat layout owns the workspace width; keep the measure on the words and cards inside it,
   not on the whole page. The social layout keeps its separate three-column frame below. */
.sp-page:not(.sp-social) .sp-net-in { grid-template-columns: minmax(0, 1fr) minmax(280px, 320px); justify-content: stretch }
.sp-page:not(.sp-social) :deep(.sv-in),
.sp-page:not(.sp-social) :deep(.se-in) { width: 100%; max-width: none; margin-left: 0; margin-right: 0 }
.sp-page:not(.sp-social) :deep(section.sv > *),
.sp-page:not(.sp-social) :deep(section.sd > *),
.sp-page:not(.sp-social) :deep(section.sm > *) { max-width: none }
.sp-page:not(.sp-social) :deep(.sd-list),
.sp-page:not(.sp-social) :deep(.sm-list) { max-width: none }
@media (max-width: 1180px) {
  .sp-page:not(.sp-social) .sp-net-in { grid-template-columns: minmax(0, 1fr) }
}
.sp-head { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; align-items: center; column-gap: 10px;
  padding: 0 16px; height: 49px; border: 0; border-bottom: 1px solid var(--hair) }
.sp-head h2 { display: flex; align-items: center; gap: 5px; margin: 0; font-weight: 800;
  font-size: 16.5px; letter-spacing: -.012em; color: var(--ink) }
.sp-head h2 .si { color: var(--ink3) }
/* the seal beside the room's name: present, not loud — a fact about the room and not a warning */
.sp-sealed-mark { display: inline-flex; align-items: center; color: var(--ink3); opacity: .7 }
.sp-topic { margin: 0; max-width: none; padding-left: 10px; border-left: 1px solid var(--hair); font-size: 13px;
  color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sp-tools { display: flex; align-items: center; gap: 8px }
.sp-people { display: flex; align-items: center; gap: 3px; padding: 2px 8px 2px 3px; border: 1px solid var(--hair); border-radius: 7px }
.sp-people b { font-family: var(--m); font-size: 11px; font-weight: 700; color: var(--ink2); margin-left: 3px }
.sp-huddle { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink2); background: transparent;
  border: 1px solid var(--hair); border-radius: 7px; padding: 5px 11px; cursor: pointer }
.sp-huddle:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.sp-huddle.on { color: #fff; background: var(--sp-go); border-color: transparent }
.sp-ico { display: grid; place-items: center; width: 30px; height: 28px; color: var(--ink2); background: transparent;
  border: 1px solid var(--hair); border-radius: 7px; cursor: pointer }
.sp-ico:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.sp-menu { position: relative }
.sp-drop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; width: 260px; list-style: none; margin: 0;
  transform-origin: top right; animation: spdrop .16s var(--sp-ease) both;
  padding: 5px; background: var(--paper); border: 1px solid var(--hair); border-radius: 10px;
  box-shadow: 0 10px 30px color-mix(in srgb, var(--ink) 18%, transparent) }
.sp-drop button { display: block; width: 100%; text-align: left; font: inherit; background: transparent; border: 0;
  border-radius: 7px; padding: 7px 9px; cursor: pointer }
.sp-drop button:hover { background: color-mix(in srgb, var(--ink) 6%, transparent) }
.sp-drop b { display: block; font-size: 13.5px; font-weight: 700; color: var(--ink) }
.sp-drop button.on b::after { content: ' ✓' }
.sp-drop span { display: block; font-size: 12px; line-height: 1.4; color: var(--ink3) }
@keyframes spdrop { from { opacity: 0; transform: translateY(-4px) scale(.98) } }
.sp-sep { height: 1px; margin: 4px 6px; background: var(--hair) }
.sp-pinned { display: inline-flex; align-items: center; gap: 5px;
  font: inherit; font-size: 11.5px; font-weight: 600; color: var(--ink3);
  padding: 3px 9px 3px 7px; background: none; border: 1px solid var(--line, var(--hair)); border-radius: 999px; cursor: pointer }
.sp-pinned:hover, .sp-pinned.on { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 25%, transparent) }
.sp-bottrouble { display: flex; align-items: center; gap: 7px; margin: 0 0 6px; padding: 8px 12px;
  font-size: 12.5px; line-height: 1.45; color: var(--ink2);
  background: color-mix(in srgb, var(--ink) 6%, transparent); border-radius: 10px }
.sp-bottrouble span { flex: 1 }
.sp-bottrouble button { flex: none; font: inherit; font-size: 12px; font-weight: 600; color: var(--ink3);
  background: none; border: 0; padding: 0; cursor: pointer }
.sp-bottrouble button:hover { color: var(--ink) }
.sp-pinmenu { position: relative; grid-column: 2; justify-self: start }
.sp-pinbox { position: absolute; top: calc(100% + 6px); left: 0; z-index: 30;
  display: flex; flex-direction: column; gap: 8px; width: min(420px, 70vw); max-height: 60vh;
  padding: 10px; overflow-y: auto; background: var(--card); border: 1px solid var(--line, var(--hair)); border-radius: 13px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, .18) }
.sp-pinrow { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px;
  background: color-mix(in srgb, var(--ink) 4%, transparent); border-radius: 11px }
.sp-pinrow b { font-size: 12.5px; font-weight: 650 }
.sp-pinrow p { margin: 0; font-size: 13.5px; line-height: 1.5; max-width: none }
.sp-pinrow footer { display: flex; align-items: center; gap: 10px; margin: 2px 0 0; padding: 0;
  background: none; border: 0 }
.sp-pinrow footer small { flex: 1; font-size: 11px; color: var(--ink3) }
.sp-pinrow footer button { font: inherit; font-size: 11.5px; font-weight: 600; color: var(--ink2);
  background: none; border: 0; padding: 0; cursor: pointer }
.sp-pinrow footer button:hover { color: var(--ink) }
.sp-head-note { padding: 5px 9px 2px; font-size: 11px; font-weight: 700; letter-spacing: .04em;
  text-transform: uppercase; color: var(--ink3) }
.sp-vis { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%) }
/* a conversation grows from the foot: what was said last sits against the composer, and an empty
   channel is a line above it rather than a heading marooned at the top of a blank page */
.sp-scroll { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; overflow-y: auto; padding: 0 0 6px }
.sp-stream { margin-top: auto; width: 100%; max-width: 1180px }
.sp-start { padding: 26px 20px 10px }
.sp-start h3 { display: flex; align-items: center; gap: 5px; margin: 0 0 4px; font-weight: 800; font-size: 18px;
  letter-spacing: -.01em; color: var(--ink) }
.sp-start h3 .si { color: var(--ink3) }
.sp-start p { margin: 0; max-width: 64ch; font-size: 13.5px; color: var(--ink3) }
/* a sealed room, where its timeline begins. Set apart by a rule and a quiet ground rather than by
   a colour: it is a standing fact about the room and not a warning, and an alarm at the top of
   every visit is an alarm nobody reads twice. */
.sp-sealed { margin: 14px 16px 2px; padding: 12px 14px; border: 1px solid var(--hair);
  border-radius: 10px; background: var(--sp-tint, var(--wash)); max-width: 72ch }
.sp-sealed p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--ink3); max-width: none }
.sp-sealed-head { font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
  font-weight: 700; color: var(--ink2) !important; margin-bottom: 3px !important }
.sp-sealed-why { margin-top: 6px !important; padding-top: 6px; border-top: 1px solid var(--hair) }
.sp-rule { display: flex; align-items: center; gap: 0; margin: 18px 16px 4px; position: relative }
.sp-rule::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 1px; background: var(--hair) }
.sp-rule span { position: relative; font-size: 11.5px; font-weight: 700; letter-spacing: .01em; color: var(--ink2);
  background: var(--paper); border: 1px solid var(--hair); border-radius: 999px; padding: 2px 13px; margin: 0 auto }
.sp-new { display: flex; align-items: center; gap: 8px; margin: 12px 16px 2px; color: var(--sp-link) }
.sp-new::before { content: ''; height: 1px; flex: 1; background: currentColor; opacity: .5 }
.sp-new span { font-family: var(--m); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; font-weight: 700 }
.sp-note { margin: 24px 20px; max-width: none; font-size: 14px; color: var(--ink3) }
/* A FEED: one card per post, the answers under it on a line of their own */
.sp-feedch { box-sizing: border-box; width: 100%; max-width: 680px; margin: 0 auto; padding: 20px 16px 40px; display: flex; flex-direction: column; gap: 16px }
/* A GROUP'S FEED: the box to write in at the top, then each post a card of its own — who and when,
   what was said, Like · Comment · Share under it, its first comments, and a box to add one */
.sp-fwrite { border-radius: 16px; background: transparent }
.sp-fwrite > :deep(*) { margin: 0 !important; border-radius: 16px }
.sp-fcard { padding: 14px 16px 12px; border: 1px solid var(--hair); border-radius: 16px; background: var(--paper); box-shadow: 0 1px 2px rgba(0, 0, 0, .04) }
.sp-fcard > :deep(.sl) { padding-left: 0; padding-right: 0 }
.sp-fcard > :deep(.sl .sl-text), .sp-fcard > :deep(.sl .sl-body) { font-size: 15.5px; line-height: 1.55 }
.sp-freplies { margin: 10px 0 0; padding: 4px 0 0; border-top: 1px solid var(--hair) }
/* a feed post wears the network card's head: the name in the body face, bold, then '· time' */
.sp-fcard :deep(.sl-who) { font-family: var(--fb, inherit); font-size: 15px; font-weight: 700 }
.sp-fcard :deep(.sl-when) { font-family: inherit; font-size: 14px; color: var(--ink3) }
.sp-fcard :deep(.sl-when)::before { content: '· ' }
/* the card holds the message without the room's own breathing space above it */
.sp-fcard > :deep(.sl) { padding-top: 0; margin-top: 0 }
.sp-fcard :deep(.sl:hover) { background: transparent }
.sp-freplies :deep(.sl) { padding-left: 0; padding-right: 0 }
/* a post in a card is tall: its face belongs at the top of it, beside the name */
.sp-fcard :deep(.sl-gut) { align-items: flex-start }
.sp-feedch-empty { display: flex; flex-direction: column; gap: 6px; align-items: center; text-align: center; padding: 40px 24px; border: 1px dashed var(--hair); border-radius: 16px }
.sp-feedch-empty b { font-size: 17px; color: var(--ink) }
.sp-feedch-empty span { max-width: 44ch; font-size: 14px; line-height: 1.5; color: var(--ink3) }
@media (max-width: 560px) { .sp-feedch { padding: 10px 8px 24px; gap: 10px } .sp-fcard { padding: 12px 12px 10px } }
.sp-earlier { display: block; margin: 10px auto 2px; font: inherit; font-size: 12.5px; color: var(--ink2);
  background: var(--card); border: 1px solid var(--hair); border-radius: 999px; padding: 4px 12px; cursor: pointer }
.sp-typing { margin: 0; max-width: 1180px; padding: 0 20px; height: 18px; font-size: 12px; color: var(--ink3) }
.sp-dots { display: inline-flex; align-items: center; gap: 3px }
.sp-dots i { width: 4px; height: 4px; border-radius: 50%; background: currentColor; opacity: .35;
  animation: sptype 1.1s var(--sp-ease) infinite }
.sp-dots i:nth-child(2) { animation-delay: .15s }
.sp-dots i:nth-child(3) { animation-delay: .3s; margin-right: 5px }
@keyframes sptype { 0%, 60%, 100% { opacity: .3; transform: translateY(0) } 30% { opacity: 1; transform: translateY(-2px) } }

/* One curve for the whole surface, the support widget's own: things arrive from where they belong —
   a side panel from its edge, a sheet from the middle, a line from under itself — and none of it
   happens at all for somebody who has asked for less motion. */
.sp-slide-enter-active, .sp-slide-leave-active { transition: transform .22s var(--sp-ease), opacity .18s ease }
.sp-slide-enter-from, .sp-slide-leave-to { transform: translateX(14px); opacity: 0 }
.sp-fade-enter-active, .sp-fade-leave-active { transition: opacity .16s ease }
.sp-fade-enter-from, .sp-fade-leave-to { opacity: 0 }
.sp-fade-enter-active .sp-sheet, .sp-fade-leave-active .sp-sheet { transition: transform .22s var(--sp-ease) }
.sp-fade-enter-from .sp-sheet, .sp-fade-leave-to .sp-sheet { transform: translateY(10px) scale(.98) }
.sp-page:not(.sp-social) .sp-slide-enter-active, .sp-page:not(.sp-social) .sp-slide-leave-active {
  transition: transform .28s var(--sp-ease), opacity .2s var(--sp-ease)
}
.sp-page:not(.sp-social) .sp-slide-enter-from, .sp-page:not(.sp-social) .sp-slide-leave-to {
  transform: translateX(100%); opacity: 0
}
.sp-chat-veil-enter-active, .sp-chat-veil-leave-active { transition: opacity .22s var(--sp-ease) }
.sp-chat-veil-enter-from, .sp-chat-veil-leave-to { opacity: 0 }
@media (max-width: 900px) {
  .sp-page:not(.sp-social) .sp-nav { transition: transform .24s var(--sp-ease), opacity .18s var(--sp-ease) }
  .sp-page:not(.sp-social) .sp-nav:not(.out) { opacity: 0 }
  .sp-page:not(.sp-social) .sp-nav.out { opacity: 1 }
}
.sp-rise-enter-active, .sp-rise-leave-active { transition: opacity .16s ease, transform .16s var(--sp-ease) }
.sp-rise-enter-from, .sp-rise-leave-to { opacity: 0; transform: translateY(4px) }
@media (prefers-reduced-motion: reduce) {
  .sp-page:not(.sp-social) .sp-slide-enter-active, .sp-page:not(.sp-social) .sp-slide-leave-active,
  .sp-page:not(.sp-social) .sp-fade-enter-active, .sp-page:not(.sp-social) .sp-fade-leave-active,
  .sp-page:not(.sp-social) .sp-rise-enter-active, .sp-page:not(.sp-social) .sp-rise-leave-active,
  .sp-page:not(.sp-social) .sp-chat-veil-enter-active, .sp-page:not(.sp-social) .sp-chat-veil-leave-active { transition: none }
  .sp-page:not(.sp-social) .sp-fade-enter-active .sp-sheet,
  .sp-page:not(.sp-social) .sp-fade-leave-active .sp-sheet { transition: none }
  .sp-page:not(.sp-social) .sp-dots i { animation: none; opacity: .6 }
}
.sp-ask { margin: 0 0 8px; background: var(--card); border: 1px solid var(--hair); border-radius: 12px }
.sp-post { padding: 4px 16px 0 }
.sp-post input { width: 100%; font: inherit; font-weight: 800; font-size: 17px; color: var(--ink);
  background: transparent; border: 0; border-bottom: 1px solid var(--hair); padding: 6px 0 }
.sp-post input:focus { outline: none; border-color: color-mix(in srgb, var(--ink) 35%, transparent) }
.sp-side { min-height: 0; background: var(--paper); border-left: 1px solid var(--hair) }
.sp-thread { display: grid; grid-template-rows: auto minmax(0, 1fr) auto }
.sp-thead { display: flex; align-items: center; justify-content: space-between; padding: 0 14px; height: 49px;
  border: 0; border-bottom: 1px solid var(--hair) }
.sp-thead h3 { margin: 0; font-weight: 800; font-size: 16px; color: var(--ink) }
.sp-thead button { font: inherit; font-size: 18px; line-height: 1; color: var(--ink3); background: transparent; border: 0; cursor: pointer; padding: 0 4px }
.sp-tscroll { overflow-y: auto; padding: 6px 0 12px }
.sp-trule { display: flex; align-items: center; gap: 10px; margin: 10px 16px 2px; color: var(--ink3) }
.sp-trule::after { content: ''; height: 1px; flex: 1; background: var(--hair) }
.sp-trule span { font-size: 12.5px; font-weight: 600 }
/* the surface's own bar, on a phone only: the way to the nav, and where you are */
.sp-bar-m { display: none }
.sp-open { display: grid; place-items: center; width: 34px; height: 34px; flex: none; font-size: 17px; line-height: 1;
  color: var(--ink2); background: transparent; border: 0; border-radius: 8px; cursor: pointer }
.sp-open:hover { background: color-mix(in srgb, var(--ink) 7%, transparent) }
.sp-face { position: relative; display: block; width: 22px; height: 22px }
.sp-here { position: absolute; right: -2px; bottom: -2px; width: 9px; height: 9px; border-radius: 50%;
  background: transparent; border: 2px solid var(--paper); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--ink) 30%, transparent) }
.sp-here.is-active { background: #2bac76; box-shadow: none }
.sp-here.is-dnd { background: #d9a13d; box-shadow: none }
.sp-modal { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center;
  background: color-mix(in srgb, #000 38%, transparent); padding: 20px }
.sp-sheet { width: min(420px, 100%); max-height: 70vh; display: grid; grid-template-rows: auto minmax(0, 1fr) auto;
  background: var(--paper); border-radius: 12px; overflow: hidden;
  box-shadow: 0 20px 60px color-mix(in srgb, #000 30%, transparent) }
.sp-sheet header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px;
  border: 0; border-bottom: 1px solid var(--hair) }
.sp-sheet h3 { margin: 0; font-weight: 800; font-size: 15px; color: var(--ink) }
.sp-sheet header button { font: inherit; font-size: 18px; color: var(--ink3); background: transparent; border: 0; cursor: pointer }
.sp-find { display: flex; align-items: center; gap: 7px; margin: 10px 12px 2px; padding: 6px 10px;
  color: var(--ink3); border: 1px solid var(--hair); border-radius: 8px }
.sp-find input { flex: 1; min-width: 0; font: inherit; font-size: 13.5px; color: var(--ink); background: transparent; border: 0 }
.sp-find input:focus { outline: none }
.sp-who { list-style: none; margin: 0; padding: 6px; overflow-y: auto }
.sp-who label, .sp-joinrow { display: flex; align-items: center; gap: 9px; width: 100%; font: inherit; font-size: 14.5px;
  color: var(--ink); background: transparent; border: 0; border-radius: 7px; padding: 7px 9px; cursor: pointer; text-align: left }
/* a room already joined is still shown — greyed, and saying so — because the browser is also how
   somebody sees what the space HAS, not only what is left to join */
.sp-joinrow.already { color: var(--ink3) }
/* a room says what it is for, which is most of what somebody browsing is choosing by */
.sp-room { display: grid; gap: 1px; min-width: 0 }
.sp-room i { font-style: normal; font-size: 12px; color: var(--ink3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sp-joinrow em { margin-left: auto; font-style: normal; font-size: 11.5px; font-weight: 700; letter-spacing: .03em;
  text-transform: uppercase; color: var(--ink3) }
.sp-who label:hover, .sp-joinrow:hover { background: color-mix(in srgb, var(--ink) 6%, transparent) }
.sp-none { padding: 12px; font-size: 13.5px; color: var(--ink3) }
.sp-sheet footer { padding: 10px 14px; border-top: 1px solid var(--hair) }
.sp-fine { margin: 0; max-width: none; font-size: 12px; line-height: 1.5; color: var(--ink3) }
.sp-go { font: inherit; font-size: 14px; font-weight: 700; color: #fff; background: var(--sp-go); border: 0;
  border-radius: 7px; padding: 8px 14px; cursor: pointer }
.sp-go:disabled { opacity: .4; cursor: default }
@media (max-width: 900px) {
  .sp-body, .sp-body:has(.sp-side), .sp-body:has(.sp-rail), .sp-body:has(.sp-rail):has(.sp-side) {
    grid-template-columns: minmax(0, 1fr) }
  .sp-page { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0 }
  /* the body is always the second row: where the phone bar is not drawn (the social layout keeps its
     own bar at the foot) its row is empty and the body still takes the height, so a room's box sits
     at the bottom of the screen as a chat's does, never halfway up it */
  .sp-page > .sp-body { grid-row: 2 }
  .sp-page { --spbar-m-height: 44px }
  .sp-bar-m { display: flex; align-items: center; gap: 8px; padding: 0 10px; height: var(--spbar-m-height); flex: none;
    background: var(--paper); border-bottom: 1px solid var(--hair) }
  .sp-bar-m b { min-width: 0; font-size: 15px; font-weight: 750; letter-spacing: -.01em; color: var(--ink);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
  .sp-head { grid-template-columns: auto auto minmax(0, 1fr) auto; padding: 0 12px }
  .sp-topic, .sp-people, .sp-notify { display: none }
  /* On a phone the two columns are one drawer, the person's above the space's, scrolling together —
     which is the only shape a nav this deep has at this width. It holds everything, so nothing is
     out of reach: hiding it once left the Desk, Threads, Activity and Later with no way to them. */
  .sp-nav { display: flex; flex-direction: column; position: fixed; inset: var(--headh) auto 0 0;
    width: min(300px, 88vw); z-index: 35; overflow-y: auto; background: var(--sp-rail);
    transform: translateX(-102%); transition: transform .2s cubic-bezier(.2, .8, .2, 1) }
  .sp-nav.out { transform: none }
  .sp-bar { flex: none }
  .sp-bar, .sp-rail { display: block; height: auto }
  .sp-rail { flex: none; border-top: 1px solid color-mix(in srgb, #fff 10%, transparent) }
  .sp-veil { position: fixed; inset: var(--headh) 0 0; z-index: 30; background: color-mix(in srgb, #000 42%, transparent) }
  /* width: auto matters. The 1180px rule above gives a side pane min(380px, 62vw) — which at 390px
     is 242px — and a fixed box with an explicit width ignores its own left/right pair, so the thread
     opened as a 242px sliver with the channel showing through beside it. The tablet width has to be
     given back, not merely re-positioned. */
  .sp-side { position: fixed; inset: var(--headh) 0 0; width: auto; z-index: 32; border-left: 0 }
}
@media (prefers-reduced-motion: reduce) { .sp-page:not(.sp-social) .sp-nav { transition: none } }

/* ---------------------------------------------------------------------------------------------
   THE SOCIAL LAYOUT (community.layout: social): the navigation on the left, one column in the
   middle with the open space's header above it, and the sidebar on the right — a thread or a card
   takes the sidebar's place. The same views as the chat layout; only the frame differs.
   --------------------------------------------------------------------------------------------- */
.sp-page.sp-social { --e: cubic-bezier(.2, .8, .2, 1); font-family: var(--fb, inherit);
  background: radial-gradient(1200px 520px at 50% -180px, color-mix(in srgb, var(--accent) 6%, transparent), transparent 70%), color-mix(in srgb, var(--ink) 2%, var(--paper)) }
.sp-social .sp-body, .sp-social .sp-body:has(.sp-side) {
  grid-template-columns: 260px minmax(0, 680px) 340px; grid-template-rows: auto minmax(0, 1fr); justify-content: center }
.sp-social .sp-nav { display: block; grid-column: 1; grid-row: 1 / -1; min-height: 0 }
.sp-social .sp-snav { height: 100% }
.sp-social .sp-shead { grid-column: 2; grid-row: 1; padding: 18px 20px 0; animation: sp-in .4s var(--e);
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 5%, var(--paper)), var(--paper));
  border-left: 1px solid var(--hair); border-right: 1px solid var(--hair); border-bottom: 1px solid var(--hair) }
.sp-shead-row { display: flex; align-items: center; justify-content: space-between; gap: 12px }
.sp-shead-title { min-width: 0; flex: 1 1 auto }
.sp-shead-title h2 { display: flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.sp-shead-title h2 > svg { flex: none; color: var(--ink3) }
.sp-seyebrow { display: block; margin: 0 0 2px; font-family: var(--m); font-size: 10.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3) }
.sp-shead-tools { flex: none; display: flex; align-items: center; gap: 8px; margin: 0 0 10px }
.sp-shead-tools .sp-pin { margin: 0 }
.sp-shead-room, .sp-shead-room .sp-tools { display: flex; align-items: center; gap: 8px }
.sp-shead-room .sp-tools { margin: 0 }
.sp-head.sp-head-up { display: none }
/* the header's buttons are one family: the height and the round of the pin beside them */
.sp-shead-tools :is(.sp-huddle, .sp-ico, .sp-pinned) { height: 34px; border-radius: 999px }
.sp-shead-tools .sp-ico { width: 34px; display: grid; place-items: center; padding: 0 }
.sp-shead-tools :is(.sp-huddle, .sp-pinned) { padding: 0 14px }
.sp-pin { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 10px; padding: 6px 12px; border: 1px solid var(--hair); border-radius: 999px; background: transparent;
  font: inherit; font-size: 13px; font-weight: 600; color: var(--ink2); cursor: pointer; transition: background .2s cubic-bezier(.2, .8, .2, 1), color .2s, border-color .2s }
.sp-pin:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 25%, transparent) }
.sp-pin.on { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, transparent); background: color-mix(in srgb, var(--accent) 8%, transparent) }
.sp-fmedia { margin: 4px 0 0 52px }
@media (max-width: 700px) { .sp-fmedia { margin-left: 0 } }
.sp-social .sp-shead h2 { margin: 0 0 10px; max-width: none; font-family: var(--fd); font-size: 24px; font-weight: 800; letter-spacing: -.015em; color: var(--ink) }
.sp-sline { margin: -5px 0 12px; max-width: none; font-size: 13.5px; line-height: 1.4; color: var(--ink3);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.sp-stabs { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none }
.sp-stabs button { flex: none; padding: 0 12px; border: 0; border-radius: 10px 10px 0 0; background: transparent; font: inherit; font-size: 15px; font-weight: 600; color: var(--ink3); cursor: pointer;
  transition: color .2s var(--e), background .2s var(--e) }
.sp-stabs button:hover { background: color-mix(in srgb, var(--ink) 4%, transparent) }
.sp-stabs button span { position: relative; display: block; padding: 10px 2px 12px }
.sp-stabs button:hover { color: var(--ink) }
.sp-stabs button.on { color: var(--ink); font-weight: 700 }
.sp-stabs button.on span::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; border-radius: 3px 3px 0 0; background: var(--accent);
  animation: sp-ink .35s var(--e) }
@keyframes sp-ink { from { transform: scaleX(.2); opacity: 0 } }
@keyframes sp-in { from { opacity: 0; transform: translateY(6px) } }
.sp-social .sp-body > .sp-main, .sp-social .sp-body > .sp-plain { grid-column: 2; grid-row: 2; min-width: 0; background: var(--paper);
  border-left: 1px solid var(--hair); border-right: 1px solid var(--hair); animation: sp-in .4s var(--e) }
@media (prefers-reduced-motion: reduce) { .sp-social .sp-body > .sp-main, .sp-social .sp-body > .sp-plain, .sp-social .sp-shead, .sp-stabs button.on span::after { animation: none } }
.sp-social .sp-body:not(:has(.sp-shead)) > .sp-main, .sp-social .sp-body:not(:has(.sp-shead)) > .sp-plain { grid-row: 1 / -1 }
.sp-social .sp-body > .sp-side, .sp-social .sp-body > .sp-saside { grid-column: 3; grid-row: 1 / -1; min-height: 0 }
.sp-social .sp-body > .sp-side { border-left: 1px solid var(--hair); box-shadow: none }
/* A QUEUE: the tool takes the column and the sidebar's place together. The grid itself never
   changes from page to page, so the navigation never moves */
@media (min-width: 901px) { .sp-social .sp-body.sp-wide > .sp-main, .sp-social .sp-body.sp-wide > .sp-plain { grid-column: 2 / -1 } }
/* NOTHING COMING UP: the sidebar draws nothing and its column stays, empty, so nothing moves */
.sp-social .sp-body > .sp-saside.sa-none { display: none }
.sp-social .sp-net-in { display: block }
.sp-social .sp-net-in > :deep(.fd-main) { border: 0 }
@media (max-width: 1240px) {
  .sp-social .sp-body, .sp-social .sp-body:has(.sp-side) { grid-template-columns: 220px minmax(0, 680px) 300px }
}
@media (max-width: 1100px) {
  .sp-social .sp-body, .sp-social .sp-body:has(.sp-side) { grid-template-columns: 220px minmax(0, 1fr) }
  .sp-social .sp-body > .sp-saside { display: none }
  .sp-social .sp-body > .sp-side { position: absolute; inset: 0 0 0 auto; width: min(380px, 62vw); z-index: 22 }
}
@media (max-width: 900px) {
  .sp-social .sp-body, .sp-social .sp-body:has(.sp-side) { grid-template-columns: minmax(0, 1fr) }
  .sp-social .sp-nav { position: fixed; inset: var(--headh) auto 0 0; width: min(300px, 88vw); z-index: 35; background: var(--paper);
    transform: translateX(-102%); transition: transform .2s cubic-bezier(.2, .8, .2, 1) }
  .sp-social .sp-nav.out { transform: none }
  .sp-social .sp-body > .sp-main, .sp-social .sp-body > .sp-plain, .sp-social .sp-shead { grid-column: 1; border-left: 0; border-right: 0 }
}
@media (max-width: 700px) {
  .sp-page.sp-social { background: var(--paper) }
  .sp-social .sp-body > .sp-main, .sp-social .sp-body > .sp-plain { padding-bottom: calc(58px + env(safe-area-inset-bottom)) }
  .sp-social .sp-bar-m { display: none }
  .sp-social .sp-nav { bottom: calc(58px + env(safe-area-inset-bottom)) }
  .sp-social .sp-veil { bottom: calc(58px + env(safe-area-inset-bottom)) }
}
</style>
<style>
/* the community's bottom bar on a phone: whatever floats in the corner rides above it */
@media (max-width: 700px) { html:has(.sp-social) { --pk-dock: calc(58px + env(safe-area-inset-bottom)) } }
</style>

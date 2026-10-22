<script setup>
/*
 * One message, in the shape a workspace chat draws one: a rounded-square avatar in the gutter, the
 * name in bold with the time beside it, the words at 15px under them, and — in a run from the same
 * person — no avatar, no name, and the time only while the pointer is over it. The actions live in a
 * small bar that floats at the row's top-right on hover, where every reader already looks for them,
 * rather than sitting in the row and pushing the words about.
 *
 * In a room read by side — a direct message — the same line is drawn as a bubble instead: the other
 * person's at the left with their face beside it, the reader's own at the right with neither face
 * nor name, because between two people the side already says who spoke. Everything else about the
 * line is unchanged, which is why this is one component and not two.
 *
 * A mention is drawn from the parts the model cuts, never pasted into a string. A thread is a
 * summary row under the message — who is in it and when it was last answered — and not a bare count.
 * Words from spaces.md (channel).
 */
import { computed, ref, watchEffect } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { lineBlocks, canReply, canReact, saidIn } from 'platformkit/lib/spaces/model.js'
import { voiceUrl, fileUrl } from 'platformkit/lib/spaces/audio.js'
import SpaceAvatar from './SpaceAvatar.vue'
import SpacePoll from './SpacePoll.vue'
import ChatChoices from '../chat/ChatChoices.vue'
import SpaceIcon from './SpaceIcon.vue'
import SpaceFlair from './SpaceFlair.vue'
import SpaceEmoji from './SpaceEmoji.vue'
import VoiceNote from '../chat/VoiceNote.vue'
import MessageText from '../chat/MessageText.vue'

const props = defineProps({
  message: { type: Object, required: true },
  names: { type: Object, default: () => ({}) },
  /* what each person wears in this space, keyed by id — one map for the room, not a read per line */
  flair: { type: Object, default: () => ({}) },
  /* and who each of them is, for the face: the picture, the style and the seed, keyed by id */
  faces: { type: Object, default: () => ({}) },
  me: { type: String, default: '' },
  first: { type: Boolean, default: true },
  reactions: { type: Array, default: () => [] },
  /* WHAT THIS ROOM TAKES besides words — its own answer, resolved by the projection from the room's
     file and its space's. Reactions on, votes off: a score changes what people write as well as
     what they read, so a room opts into that. A comment subject is set apart and inherits nothing
     from here. */
  takesReactions: { type: Boolean, default: true },
  takesVotes: { type: Boolean, default: false },
  /* whether this person may pin in this room, and whether this line already is */
  mayPin: { type: Boolean, default: false },
  pinned: { type: Boolean, default: false },
  mentionsMe: { type: Boolean, default: false },
  hideReplies: { type: Boolean, default: false },
  repliers: { type: Array, default: () => [] },     /* who is in the thread, for the summary row */
  /* a room where reporting means something: a community, never a staff room and never a direct
     message, where the only two people who could read it are the two who are in it */
  reportable: { type: Boolean, default: false },
  votes: { type: Array, default: () => [] },        /* the votes of every poll on screen */
  mayClose: { type: Boolean, default: false },      /* this reader keeps the room, so may close one */
  /* a room read by side rather than by author (sidedRoom in lib/spaces/model.js): the other
     person's lines at the left, the reader's own at the right, and no name over either */
  sided: { type: Boolean, default: false },
  /* may this reader write here at all: a button they cannot act on is a button that lies */
  mayWrite: { type: Boolean, default: true },
})
const emit = defineEmits(['thread', 'react', 'edit', 'withdraw', 'report', 'who', 'vote', 'unvote', 'close-poll', 'pin', 'choose'])
const W = computed(() => us('spaces').channel.main)
const P = computed(() => us('spaces').page.main)
const EV = computed(() => us('spaces').events || {})

/* a bot's line is shown under the bot's name — the name the file gives it, carried on the row, so
   a renamed bot does not rewrite what it already said */
const botName = computed(() => (props.message.meta && (props.message.meta.name || props.message.meta.bot)) || '')
/*
 * WHAT A BOT OFFERED. Its answer's closing list was cut off the words on the way into the row and
 * kept on meta, immutable like a poll's options — so this draws data rather than reparsing
 * markdown, and the room and the desk draw the same control.
 *
 * In a room the offer belongs to the ROOM: everybody sees it, the first press takes it, and the
 * rest see what was taken. That is why being taken is a column the database writes and not a guess
 * from who said what last — two people press at the same moment far more often in a channel than
 * on a desk, and the alternative is the bot summoned twice for one question.
 */
const offered = computed(() => (props.message.meta && props.message.meta.choices) || [])
const takenKey = computed(() => props.message.choice_key || '')
const offerLive = computed(() => offered.value.length && !props.message.choice_at && !props.message.deleted_at && props.mayWrite)
const isBot = computed(() => props.message.kind === 'system' && !!botName.value)
const who = computed(() => botName.value || props.names[props.message.author_id] || P.value.someone)
const mine = computed(() => props.message.author_id === props.me)
const when = computed(() => {
  const d = new Date(props.message.created_at)
  return isNaN(d) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
})
const ago = computed(() => {
  const v = props.message.last_reply_at
  if (!v) return ''
  const mins = Math.max(1, Math.round((Date.now() - new Date(v).getTime()) / 60000))
  if (mins < 60) return (W.value['last-reply'] || '').replace('{when}', mins + 'm')
  const hrs = Math.round(mins / 60)
  return (W.value['last-reply'] || '').replace('{when}', hrs < 24 ? hrs + 'h' : Math.round(hrs / 24) + 'd')
})
const parts = computed(() => lineBlocks(props.message.body, props.names, { someone: P.value.someone, channel: P.value['channel-word'] }))

/* The platform's own line carries the facts and never a sentence: the words are markdown like every
   other, and this is where they are said. Money arrives in the smallest unit, as the ledger keeps it. */
const money = (v, c) => {
  const n = Number(v)
  if (!isFinite(n)) return ''
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: (c || 'usd').toUpperCase() }).format(n / 100) } catch (e) { return String(n / 100) }
}
/* said through the shared function, so what a person reads and what a bot is given cannot drift */
const systemLine = computed(() => saidIn(props.message, { names: props.names, words: EV.value, money }))
/* the sound is fetched once the row is on screen, and the player is the one the coaching chat
   uses — a waveform is a waveform, and two of them would be two to keep */
const heard = ref(null)
watchEffect(() => {
  if (props.message.kind !== 'voice' || props.message.deleted_at) { heard.value = null; return }
  const m = props.message
  voiceUrl(m).then((u) => { if (u) heard.value = { id: m.id, url: u, seconds: m.seconds } })
})

/* A FILE IS SHOWN, NOT DESCRIBED: a picture is the message, and anything else is a chip that opens
   it. The bucket is private, so the address is signed (or, for what this browser just sent, the
   bytes it already has). */
const got = ref(null)
watchEffect(() => {
  const m = props.message
  got.value = null
  if (m.kind !== 'file') return
  fileUrl(m).then((u) => { if (u) got.value = u })
})
const isPic = computed(() => props.message.kind === 'file' && !!got.value
  && (!props.message.attachment_type || /^image\//.test(props.message.attachment_type)))
const sizeOf = (n) => (!n ? '' : n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB')

const replies = computed(() => Number(props.message.reply_count || 0))
/* The picker is open on this line and no other, and it is drawn on the BODY rather than inside the
   line: a message list scrolls, and anything absolutely positioned inside a scroller is cut off by
   it. So its place is worked out from the button's own rectangle when it opens. */
const picking = ref(false)
const at = ref({ top: 0, left: 0 })
function pickHere(e) {
  if (picking.value) { picking.value = false; return }
  const r = e.currentTarget.getBoundingClientRect()
  const W = 288, H = 320, pad = 12
  /* below the button unless there is no room, and never off either edge */
  const below = r.bottom + 6 + H < window.innerHeight
  at.value = {
    top: below ? r.bottom + 6 : Math.max(pad, r.top - H - 6),
    left: Math.min(Math.max(pad, r.right - W), window.innerWidth - W - pad),
  }
  picking.value = true
}
const repliesLabel = computed(() => (replies.value === 1 ? W.value['replies-one'] : (W.value['replies-many'] || '').replace('{n}', replies.value)))
</script>

<template>
  <article :id="'m-' + message.id" class="sl" :class="{ first, gone: !!message.deleted_at, system: message.kind === 'system', named: mentionsMe, sided, mine: sided && mine }">
    <div v-if="!(sided && mine)" class="sl-gut">
      <span v-if="isBot && first" class="sl-mark" aria-hidden="true"><SpaceIcon name="sparkle" :size="17" /></span>
      <!-- A FACE IS A WAY TO SOMEBODY, not a decoration. The name beside it already opened their
           card, and the face is the bigger target and the thing people actually aim at. -->
      <button v-else-if="first && message.kind !== 'system'" type="button" class="sl-face"
              :aria-label="who" @click="emit('who', message.author_id)">
        <SpaceAvatar :name="who" :person="faces[message.author_id] || null" :size="36" />
      </button>
      <time v-else-if="!sided && message.kind !== 'system'" class="sl-tick" :datetime="message.created_at">{{ when }}</time>
      <span v-else-if="message.kind === 'system' && !isBot" class="sl-bot" aria-hidden="true">▣</span>
    </div>

    <div class="sl-body">
      <header v-if="first && (message.kind !== 'system' || isBot)" class="sl-head">
        <button v-if="isBot" type="button" class="sl-who" disabled>{{ who }}<i class="sl-isbot">{{ W.bot }}</i></button>
        <button v-else-if="!(sided && mine)" type="button" class="sl-who" @click="emit('who', message.author_id)">{{ who }}</button>
        <!-- what this space has given them, as a mark beside the name. A badge that asked not to be
             inline is not here; the card shows it. -->
        <SpaceFlair v-if="!isBot && (flair[message.author_id] || []).length" :flair="flair[message.author_id]" :size="12" />
        <time class="sl-when" :datetime="message.created_at">{{ when }}</time>
      </header>
      <div class="sl-bub">
        <h4 v-if="message.title" class="sl-title">{{ message.title }}</h4>
        <p v-if="message.deleted_at" class="sl-gone">{{ W.withdrawn }}</p>
        <p v-else-if="isBot" class="sl-text"><MessageText :blocks="parts" :me="me" /></p>
        <p v-else-if="message.kind === 'system'" class="sl-sys">{{ systemLine }}</p>
        <div v-else-if="message.kind === 'file'" class="sl-file">
          <a v-if="isPic" class="sl-pic" :href="got" target="_blank" rel="noopener">
            <img :src="got" :alt="message.attachment_name || W.file" loading="lazy" />
          </a>
          <a v-else-if="got" class="sl-chip" :href="got" target="_blank" rel="noopener" download>
            <SpaceIcon name="clip" :size="14" />
            <span><b>{{ message.attachment_name || W.file }}</b><small v-if="message.attachment_size">{{ sizeOf(message.attachment_size) }}</small></span>
          </a>
          <span v-else class="sl-wait">{{ W.file }}</span>
          <p v-if="message.body" class="sl-said"><MessageText :blocks="parts" :me="me" /></p>
        </div>
        <div v-else-if="message.kind === 'voice'" class="sl-voice">
          <VoiceNote v-if="heard" :message="heard" />
          <span v-else class="sl-wait">{{ W.voice }}</span>
          <p v-if="message.body" class="sl-said"><MessageText :blocks="parts" :me="me" /></p>
        </div>
        <template v-else-if="message.kind === 'poll'">
          <p class="sl-text"><MessageText :blocks="parts" :me="me" /><span v-if="message.edited_at" class="sl-edited">({{ W.edited }})</span></p>
          <SpacePoll
            :message="message" :votes="votes" :names="names" :me="me" :may-close="mayClose"
            @vote="(v) => emit('vote', { message: message.id, ...v })"
            @unvote="(k) => emit('unvote', { message: message.id, option: k })"
            @close="emit('close-poll', message.id)" />
        </template>
        <p v-else class="sl-text"><MessageText :blocks="parts" :me="me" /><span v-if="message.edited_at" class="sl-edited">({{ W.edited }})</span></p>
      </div>

      <ChatChoices
        :choices="offered" :live="!!offerLive" :taken="takenKey"
        @choose="(c) => emit('choose', { message: message.id, key: c.key, text: c.text })" />

      <ul v-if="reactions.length" class="sl-reacts">
        <li v-for="r in reactions" :key="r.emoji">
          <button type="button" :class="{ on: r.mine }" @click="emit('react', r.emoji)">{{ r.emoji }} <i>{{ r.users.length }}</i></button>
        </li>
        <li><button type="button" class="add" :title="W.react" :aria-label="W.react" @click="emit('react', '👍')">☺+</button></li>
      </ul>

      <button v-if="replies && !message.thread_root_id && !hideReplies" type="button" class="sl-thread sl-thread-here" @click="emit('thread')">
        <SpaceAvatar v-for="r in repliers.slice(0, 3)" :key="r" :name="names[r] || ''" :person="faces[r] || null" :size="20" />
        <b>{{ repliesLabel }}</b>
        <em>{{ ago }}</em>
      </button>
    </div>

    <div v-if="canReply(message)" class="sl-acts">
      <button v-if="takesReactions && canReact(message)" type="button" :title="W.react" :aria-label="W.react" @click="pickHere">☺</button>
      <!-- into the PAGE, not the bare body: the body has none of the design's tokens on it, and a
           picker drawn there is a picker with no background. The page is not a scroller, so
           nothing there clips it. -->
      <Teleport v-if="picking" to=".sp-page">
        <SpaceEmoji :at="at" @pick="(e) => { emit('react', e); picking = false }" @close="picking = false" />
      </Teleport>
      <button v-if="!message.thread_root_id" type="button" :title="W.reply" :aria-label="W.reply" @click="emit('thread')">⤷</button>
      <!-- the platform's own line is nobody's words: it can be answered, never edited or taken back -->
      <button v-if="mine && message.kind !== 'system'" type="button" :title="W.edit" :aria-label="W.edit" @click="emit('edit')">✎</button>
      <button v-if="mine && message.kind !== 'system'" type="button" :title="W.withdraw" :aria-label="W.withdraw" @click="emit('withdraw')">🗑</button>
      <!-- anybody may report what they can read; there is nothing here for what they wrote
           themselves, because a person who regrets a line withdraws it -->
      <button v-if="!mine && reportable" type="button" :title="W.report" :aria-label="W.report" @click="emit('report')">
        <SpaceIcon name="flag" :size="14" />
      </button>
      <!-- a pin is the ROOM's, not this person's: it is offered to whoever keeps the room, and
           what one person keeps for themselves is Saved, which is a different button -->
      <button v-if="mayPin" type="button" class="sl-pinbtn" :class="{ on: pinned }"
        :title="pinned ? W.unpin : W.pin" :aria-label="pinned ? W.unpin : W.pin" @click="emit('pin', !pinned)">
        <SpaceIcon name="pin" :size="14" />
      </button>
    </div>
  </article>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements — header carries 70px of padding and a rule, p a
   bottom margin and a 74ch measure. A :where() reset cannot undo it: Vue's scoped transform puts the
   data attribute inside the :where(), so the selector keeps zero specificity and the bare element
   wins. Each class below says what it wants instead. */
.sl { position: relative; display: grid; grid-template-columns: 36px minmax(0, 1fr); column-gap: 10px;
  padding: 2px 20px 2px 16px }
.sl.first { margin-top: 12px }
.sl:hover { background: color-mix(in srgb, var(--ink) 3%, transparent) }
/* a line that names you is washed in amber and marked at its edge — the one thing in the room that
   is addressed to nobody else. Never the site's accent, which in a place of work reads as an error. */
.sl.named { background: var(--sp-tint); box-shadow: inset 2px 0 0 var(--sp-tint-bar) }
.sl.named:hover { background: color-mix(in srgb, var(--ink) 3%, var(--sp-tint)) }
.sl-gut { display: flex; justify-content: center; padding-top: 2px }
.sl-tick { font-family: var(--m); font-size: 10px; color: var(--ink3); opacity: 0; line-height: 1.7 }
.sl:hover .sl-tick { opacity: 1 }
.sl-bot { font-size: 13px; color: var(--ink3); line-height: 1.4 }
.sl-head { display: flex; align-items: baseline; gap: 8px; margin: 0 0 1px; padding: 0; border: 0 }
.sl-face { padding: 0; background: none; border: 0; cursor: pointer; line-height: 0; border-radius: 999px }
.sl-face:hover { outline: 2px solid color-mix(in srgb, var(--ink) 18%, transparent); outline-offset: 1px }
.sl-who { width: auto; font: inherit; background: transparent; border: 0; padding: 0; cursor: pointer; text-align: left }
.sl-who:hover { text-decoration: underline }
.sl-face { padding: 0; background: none; border: 0; cursor: pointer; line-height: 0; border-radius: 999px }
.sl-face:hover { outline: 2px solid color-mix(in srgb, var(--ink) 18%, transparent); outline-offset: 1px }
.sl-who { font-family: var(--fd); font-weight: 700; font-size: 15px; color: var(--ink) }
.sl-when { font-family: var(--m); font-size: 11px; color: var(--ink3) }
.sl-title { margin: 1px 0 3px; max-width: 60ch; font-family: var(--fd); font-weight: 700; font-size: 16px; color: var(--ink) }
/* a measure, or a wide window turns every line into a ribbon nobody can read back along */
.sl-text { margin: 0; max-width: 74ch; font-size: 15px; line-height: 1.5; color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere }
.sl-edited { margin-left: 5px; font-size: 11px; color: var(--ink3) }
.sl-voice { max-width: 420px; margin: 2px 0 1px }
/* a picture keeps its own shape and is capped, so a tall one cannot push the room about */
.sl-file { margin: 2px 0 1px }
.sl-pic { display: inline-block; line-height: 0; border-radius: 10px; overflow: hidden;
  border: 1px solid var(--hair); max-width: 380px }
.sl-pic img { display: block; max-width: 100%; max-height: 320px; object-fit: contain }
.sl-chip { display: inline-flex; align-items: center; gap: 8px; max-width: 360px; font-size: 13.5px;
  color: var(--ink); text-decoration: none; padding: 7px 11px; border: 1px solid var(--hair); border-radius: 9px }
.sl-chip:hover { background: color-mix(in srgb, var(--ink) 6%, transparent) }
.sl-chip span { display: flex; flex-direction: column; min-width: 0 }
.sl-chip b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sl-chip small { font-family: var(--m); font-size: 11px; color: var(--ink3) }
.sl-wait { font-size: 13px; color: var(--ink3) }
/* what the browser wrote down while they spoke, under their voice — readable at a glance, found by
   the same search every other message is found by, and there for anybody who cannot play sound */
.sl-said { margin: 5px 0 0; max-width: 68ch; font-size: 13.5px; line-height: 1.45; color: var(--ink2) }
.sl-gone, .sl-sys { margin: 0; max-width: 74ch; font-size: 15px; line-height: 1.5; color: var(--ink3) }
.sl-gone { font-style: italic }
/* a name is a name, not a badge: weight and a whisper of ground, and the one addressed to you a
   little firmer. A solid chip in the accent made every mention look like a warning. */
.sl-at { color: var(--sp-link); background: color-mix(in srgb, currentColor 10%, transparent); border-radius: 3px;
  padding: 0 3px; font-weight: 600 }
.sl-at.me { color: color-mix(in srgb, var(--ink) 85%, var(--sp-tint-bar));
  background: color-mix(in srgb, var(--sp-tint-bar) 30%, transparent) }
.sl-reacts { display: flex; flex-wrap: wrap; gap: 4px; list-style: none; margin: 5px 0 0; padding: 0 }
.sl-reacts button { display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 12px; color: var(--ink2);
  background: color-mix(in srgb, var(--ink) 5%, transparent); border: 1px solid transparent; border-radius: 12px; padding: 1px 8px; cursor: pointer; line-height: 1.5 }
.sl-reacts button.on { color: var(--sp-link); background: color-mix(in srgb, var(--sp-link) 10%, transparent); border-color: color-mix(in srgb, var(--sp-link) 40%, transparent) }
.sl-reacts button.add { opacity: 0; font-size: 11px }
.sl:hover .sl-reacts button.add { opacity: 1 }
.sl-reacts i { font-family: var(--m); font-style: normal; font-size: 11px; font-weight: 600 }
.sl-thread { display: flex; align-items: center; gap: 7px; margin: 4px 0 1px; font: inherit; font-size: 13px;
  background: transparent; border: 1px solid transparent; border-radius: 8px; padding: 3px 8px 3px 3px; cursor: pointer }
.sl-thread:hover { background: var(--card); border-color: var(--hair) }
.sl-thread b { font-weight: 700; color: var(--sp-link) }
.sl-thread em { font-style: normal; font-size: 12px; color: var(--ink3) }
.sl-thread:hover em { color: var(--ink2) }
/* the actions float at the row's top-right, where a workspace chat puts them */
.sl-acts { position: absolute; top: -14px; right: 20px; z-index: 2; display: none; gap: 0;
  background: var(--paper); border: 1px solid var(--hair); border-radius: 8px;
  box-shadow: 0 1px 3px color-mix(in srgb, var(--ink) 12%, transparent) }
.sl:hover .sl-acts { display: flex }
.sl-acts button { display: grid; place-items: center; width: 30px; height: 28px; font: inherit; font-size: 13px;
  color: var(--ink2); background: transparent; border: 0; cursor: pointer; border-radius: 7px }
.sl-acts button:hover { background: color-mix(in srgb, var(--ink) 7%, transparent) }
/* ---------------------------------------------------------------- read by side

   A direct message is two people, so the side says who spoke and the bubble is the message. The
   wrapper below is drawn only here: in a room read by author it is display: contents and the
   stream is exactly what it was. Everything a line can be — a voice note, a poll, a withdrawal —
   goes in the bubble unchanged; what is ABOUT the line rather than said in it (a reaction, a
   thread) stays under it, on the line's own side. */
.sl-bub { display: contents }
.sl.sided { padding: 1px 20px 1px 16px }
.sl.sided.first { margin-top: 10px }
/* a bubble is its own shape and needs no row to sit in */
.sl.sided:hover { background: transparent }
.sl.sided .sl-bub { display: block; width: fit-content; max-width: 68%; padding: 7px 11px;
  border-radius: 12px 12px 12px 3px; background: color-mix(in srgb, var(--ink) 5%, transparent) }
.sl.sided .sl-text, .sl.sided .sl-gone, .sl.sided .sl-sys, .sl.sided .sl-said, .sl.sided .sl-title { max-width: none }
.sl.sided .sl-head { margin-bottom: 2px }
/* the reader's own: no face, no name, and the whole line hangs from the other edge */
.sl.sided.mine { grid-template-columns: minmax(0, 1fr) }
.sl.sided.mine .sl-body { display: flex; flex-direction: column; align-items: flex-end }
.sl.sided.mine .sl-bub { border-radius: 12px 12px 3px 12px; background: color-mix(in srgb, var(--sp-link) 13%, transparent) }
.sl.sided.mine .sl-thread, .sl.sided.mine .sl-reacts { align-self: flex-end }
/* a line addressed to you in a room of two is every line, so the mark goes on the bubble and the
   whole row is left alone — a washed row among bubbles reads as an error */
.sl.sided.named { background: transparent; box-shadow: none }
.sl.sided.named .sl-bub { background: var(--sp-tint); box-shadow: inset 2px 0 0 var(--sp-tint-bar) }
/* the actions keep to the line's own side rather than the room's right edge */
.sl.sided:not(.mine) .sl-acts { right: auto; left: 52px }
/* a narrow window has no room to spare beside a bubble: the measure that keeps a wide pane
   readable would leave a short sentence broken over three lines on a phone */
@media (max-width: 640px) { .sl { padding-right: 12px } .sl-acts { display: none !important }
  .sl.sided .sl-bub { max-width: 82% } }
/* a bot has no face; it gets the same mark the offer to summon it wears */
.sl-mark { display: grid; place-items: center; width: 36px; height: 36px; color: var(--ink3);
  background: color-mix(in srgb, var(--ink) 7%, transparent); border-radius: 10px }
.sl-who:disabled { cursor: default }
.sl-isbot { font-style: normal; font-size: 9.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  margin-left: 6px; padding: 2px 5px; color: var(--ink3);
  background: color-mix(in srgb, var(--ink) 9%, transparent); border-radius: 4px; vertical-align: 1px }

</style>

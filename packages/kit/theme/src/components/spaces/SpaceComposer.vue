<script setup>
/*
 * The box a message is written in: a bordered card with the words in it and a row of actions beneath,
 * the send button lighting up only when there is something to send — the shape a workspace chat has,
 * because it tells a reader where the message ends and what else they can do with it.
 *
 * A mention is CHOSEN from the list, and the writer sees the person's NAME while the message carries
 * a token — so it resolves exactly, survives a rename, and cannot be faked by typing an at-sign.
 * Showing the token itself would be the file's grammar in somebody's face, which this project does
 * not do to people: the box holds "@Sam Support", a mirror behind it draws that as a badge, and
 * model.js turns the two into the token on the way out. Naming the whole channel is
 * a permission: a member without it is told, before they send, that it will reach nobody. The
 * formatting buttons wrap a selection in the same marks a statement takes, and nothing here teaches
 * a syntax. Words from spaces.md (composer, bar).
 */
import { ref, computed, nextTick } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { mentionsChannel, toTokens, fromTokens, mentionSpans, CHANNEL_PICK, BOT_PICK, ROLE_PICK } from 'platformkit/lib/spaces/model.js'
import SpaceAvatar from './SpaceAvatar.vue'
import { micUsable } from 'platformkit/lib/chat/recorder.js'
import { FILE_TYPES, FILE_MAX } from 'platformkit/lib/spaces/audio.js'
import { MEDIA, refuseMedia } from 'platformkit/lib/network/model.js'
import SpaceIcon from './SpaceIcon.vue'
import SpaceCommand from './SpaceCommand.vue'
import SpaceEmoji from './SpaceEmoji.vue'
import { offers, usable, fieldValue } from 'platformkit/lib/spaces/later.js'
import VoiceRecorder from '../chat/VoiceRecorder.vue'

const props = defineProps({
  /* a feed's box takes pictures and videos, up to ten, as a post */
  mayMedia: { type: Boolean, default: false },
  people: { type: Array, default: () => [] },
  placeholder: { type: String, default: '' },
  mayMentionChannel: { type: Boolean, default: false },
  thread: { type: Boolean, default: false },
  /* whether a thread reply may also be sent to the room it hangs off — false in a forum */
  mayEcho: { type: Boolean, default: true },
  channelName: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  draft: { type: String, default: '' },
  /* the commands this person may run in this room — compiled records, already gated */
  commands: { type: Array, default: () => [] },
  /* the bots that can be summoned here by name: { slug, name } — mentioned like anybody else */
  bots: { type: Array, default: () => [] },
  /* the groups this room has: a space's roles, { slug, name } — named the same way */
  groups: { type: Array, default: () => [] },
  /* whether this room takes a message written now and sent later — not a thread, not a post */
  mayLater: { type: Boolean, default: false },
  /* whether this room takes a voice from this person — the database's answer, passed down; the
     button is not offered where the insert would be refused */
  mayVoice: { type: Boolean, default: false },
  mayPoll: { type: Boolean, default: false },   /* a room, not a direct message: two people need no ballot */
  /* whether this room takes a file from this person — the database's answer, as the voice is */
  mayFile: { type: Boolean, default: false },
  /* somewhere with nobody to name (a queue answers one person) offers no mention */
  mayMention: { type: Boolean, default: true },
})
const emit = defineEmits(['send', 'typing', 'draft', 'voice', 'poll', 'file', 'command', 'later', 'media'])
/* PICTURES AND VIDEOS, in a feed: up to ten at once, refused by name before anything is sent */
const MEDIA_ACCEPT = [...MEDIA.imageTypes, ...MEDIA.videoTypes].join(',')
async function pickedMedia(e) {
  const files = [...(e.target.files || [])]
  e.target.value = ''
  if (!files.length) return
  const why = refuseMedia(files.map((f) => ({ type: String(f.type || '').toLowerCase(), size: f.size })))
  if (why) { refused.value = NC.value[why] || W.value['file-kind']; return }
  refused.value = ''
  emit('media', { files, said: toTokens(body.value.trim(), picked.value) })
  body.value = ''
  emit('draft', '')
}
/* recording takes the composer's place, as it does in the coaching chat — the same recorder, the
   same preview to hear back before it goes */
const recording = ref(false)
const micOn = computed(() => props.mayVoice && !props.disabled && micUsable())
function sendVoice(take) { recording.value = false; if (take) emit('voice', take) }
/* WHAT MAY BE ATTACHED is the bucket's own list, said here so a file is refused by name in front
   of the person who chose it rather than as a failure after it has been sent. The words a person
   has already typed go with it as its caption, so an attachment is never a line on its own. */
function attached(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  if (!FILE_TYPES[String(file.type || '').toLowerCase()]) { refused.value = W.value['file-kind']; return }
  if (file.size > FILE_MAX) { refused.value = (W.value['file-big'] || '').replace('{n}', Math.round(FILE_MAX / 1048576)); return }
  refused.value = ''
  emit('file', { file, said: toTokens(body.value.trim(), picked.value) })
  body.value = ''
  emit('draft', '')
}
/*
 * SLASH COMMANDS. A `/` at the start of an empty line offers the commands this person may run
 * here; choosing one opens its ARGUMENTS AS FIELDS (SpaceCommand.vue) — a span as a number and a
 * unit, a choice as a list — and never as text to be typed after the name. Nobody is asked to
 * remember that `/summarise 2d` means two days, and nothing can be mistyped into meaning
 * something else. What the command then asks the bot is the file's, filled in by the worker.
 */
const slashing = ref(false)
const slashQ = ref('')
const running = ref(null)
const commands = computed(() => {
  const q = slashQ.value.toLowerCase()
  return (props.commands || []).filter((c) => !q || c.name.startsWith(q))
})
const refused = ref('')
const W = computed(() => us('spaces').composer.main)
const NC = computed(() => us('network').composer.main)
const B = computed(() => us('spaces').bar.main)
const P = computed(() => us('spaces').poll.main)
const L = computed(() => us('spaces').later.main)
/* what the writer sees is the name; picked is what each name stood for, and the token is made
   from the two on the way out */
const picked = ref({})
const first = fromTokens(props.draft || '', Object.fromEntries(props.people.map((p) => [p.id, p.name])), { channel: W.value['mention-channel'] })
const body = ref(first.text)
Object.assign(picked.value, first.picked)
const spans = computed(() => mentionSpans(body.value, picked.value))
const echo = ref(false)
const box = ref(null)
const picking = ref(false)
const query = ref('')
const at = ref(-1)
const cursor = ref(0)

const matches = computed(() => {
  const q = query.value.toLowerCase()
  const list = props.people.filter((p) => !q || String(p.name || '').toLowerCase().includes(q))
  /* the bots first and marked: naming one is asking it to do something, which is a different act
     from naming a person, and the list should not make the two look alike */
  const bots = props.bots
    .filter((b) => !q || String(b.name || '').toLowerCase().includes(q))
    .map((b) => ({ id: BOT_PICK(b.slug), name: b.name, bot: true }))
  /* the groups after the bots and before the people: naming a group is naming several people,
     which sits between asking a bot to do something and speaking to one person */
  const groups = props.groups
    .filter((g) => !q || String(g.name || '').toLowerCase().includes(q))
    .map((g) => ({ id: ROLE_PICK(g.slug), name: g.name, group: true }))
  const all = bots.concat(groups, list)
  return props.mayMentionChannel ? [{ id: null, name: W.value['mention-channel'] }].concat(all) : all
})
const warns = computed(() => !props.mayMentionChannel && mentionsChannel(toTokens(body.value, picked.value)))
const ready = computed(() => !!body.value.trim() && !props.disabled)

function typed(e) {
  emit('typing')
  emit('draft', body.value)
  const el = e.target
  cursor.value = el.selectionStart
  const upto = body.value.slice(0, cursor.value)
  const m = upto.match(/(^|\s)@([^\s@]*)$/)
  if (m) { picking.value = true; query.value = m[2]; at.value = cursor.value - m[2].length - 1 }
  else { picking.value = false; at.value = -1 }
  /* only at the very start: a slash mid-sentence is a slash */
  const s = body.value.match(/^\/([a-z0-9-]*)$/i)
  slashing.value = !!s && !!(props.commands || []).length
  slashQ.value = s ? s[1].toLowerCase() : ''
}

function choose(p) {
  const name = String(p.name || '')
  picked.value = { ...picked.value, [name]: p.id || CHANNEL_PICK }
  const put = '@' + name + ' '
  body.value = body.value.slice(0, at.value) + put + body.value.slice(cursor.value)
  picking.value = false
  const to = at.value + put.length
  nextTick(() => { if (box.value) { box.value.focus(); box.value.setSelectionRange(to, to) } })
}

/* the chosen command opens its form; running it clears the line, because the command IS the message */
function openCommand(c) { running.value = c; slashing.value = false }
function ranCommand(args) {
  const c = running.value
  running.value = null
  body.value = ''
  emit('draft', '')
  if (c) emit('command', { name: c.name, bot: c.bot, args })
}

const picks = ref(false)
function put(e) {
  const el = box.value
  const at = el ? el.selectionStart : body.value.length
  body.value = body.value.slice(0, at) + e + body.value.slice(at)
  picks.value = false
  nextTick(() => el && el.focus())
}
/* a mark at the head of the line, for a list or a quotation */
function lead(mark) {
  const el = box.value
  if (!el) return
  const at = body.value.lastIndexOf('\n', Math.max(0, el.selectionStart - 1)) + 1
  body.value = body.value.slice(0, at) + mark + body.value.slice(at)
  nextTick(() => el.focus())
}

/* wrap what is selected, or open the marks where the cursor is */
function wrap(mark) {
  const el = box.value
  if (!el) return
  const a = el.selectionStart, b = el.selectionEnd
  const chosen = body.value.slice(a, b)
  body.value = body.value.slice(0, a) + mark + chosen + mark + body.value.slice(b)
  nextTick(() => { el.focus(); el.setSelectionRange(a + mark.length, a + mark.length + chosen.length) })
}

function keys(e) {
  if (picking.value && e.key === 'Escape') { picking.value = false; e.preventDefault(); return }
  if (picking.value && e.key === 'Enter' && matches.value.length) { choose(matches.value[0]); e.preventDefault(); return }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go() }
}

function go() {
  if (!ready.value) return
  emit('send', { body: toTokens(body.value.trim(), picked.value), echo: echo.value })
  clear()
}
function clear() {
  picked.value = {}
  body.value = ''
  echo.value = false
  picking.value = false
  emit('draft', '')
}

/*
 * SEND LATER. Nobody wants to fill in a date: they want "in an hour", "tomorrow morning", "Monday"
 * — and, rarely, an exact time. So it is four offers and one field, never a calendar. What each
 * offer MEANS is worked out in a pure module (lib/spaces/later.js), so "tomorrow morning" on a
 * Sunday night is a test rather than something somebody notices is wrong.
 */
const timing = ref(false)
const exact = ref('')
const whens = computed(() => offers(Date.now()))
const sayWhen = (when) => {
  const d = when instanceof Date ? when : new Date(when)
  const today = new Date().toDateString() === d.toDateString()
  const at = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return today ? at : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + at
}
function later(when) {
  if (!ready.value || !usable(when)) return
  emit('later', { body: toTokens(body.value.trim(), picked.value), when })
  timing.value = false
  exact.value = ''
  clear()
}
/* placed from the button's own rectangle and drawn fixed: the composer sits in a box that scrolls,
   and anything positioned inside it is cut off by it — the same reason the emoji picker is. */
const whenAt = ref({ top: 0, left: 0 })
function openTiming(e) {
  timing.value = !timing.value
  if (!timing.value) return
  if (!exact.value) exact.value = fieldValue(whens.value[0].when)
  const r = e.currentTarget.getBoundingClientRect()
  const W = 272, H = 290, pad = 12
  whenAt.value = {
    top: Math.max(pad, r.top - H - 8),
    left: Math.min(Math.max(pad, r.right - W), window.innerWidth - W - pad),
  }
}
</script>

<template>
  <div class="sc">
    <p v-if="warns" class="sc-warn">{{ W['channel-warn'] }}</p>

    <SpaceCommand v-if="running" :command="running" :people="people" @run="ranCommand" @cancel="running = null" />

    <ul v-else-if="slashing && commands.length" class="sc-pick sc-slash">
      <li v-for="c in commands" :key="c.name">
        <button type="button" @mousedown.prevent="openCommand(c)">
          <SpaceIcon name="sparkle" :size="15" />
          <span><b>/{{ c.name }}</b><small v-if="c.hint">{{ c.hint }}</small></span>
        </button>
      </li>
    </ul>

    <ul v-if="picking && matches.length" class="sc-pick">
      <li v-for="p in matches" :key="p.id || 'channel'">
        <button type="button" @mousedown.prevent="choose(p)">
          <span v-if="p.bot" class="sc-botmark" aria-hidden="true"><SpaceIcon name="sparkle" :size="13" /></span>
          <span v-else-if="p.group" class="sc-botmark" aria-hidden="true"><SpaceIcon name="people" :size="13" /></span>
          <SpaceAvatar v-else :name="p.name" :size="22" />
          <span>{{ p.name }}<i v-if="p.bot" class="sc-isbot">{{ W.bot }}</i><i v-else-if="p.group" class="sc-isbot">{{ W.group }}</i></span>
        </button>
      </li>
    </ul>
    <p v-else-if="picking" class="sc-none">{{ W['mention-none'] }}</p>

    <SpaceEmoji v-if="picks" class="sc-emoji" @pick="put" @close="picks = false" />
    <p v-if="refused" class="sc-refused" role="alert">{{ refused }}</p>
    <div v-if="recording" class="sc-rec"><VoiceRecorder @send="sendVoice" @cancel="recording = false" /></div>
    <div v-else class="sc-box" :class="{ on: ready }">
      <div class="sc-marks">
        <button type="button" :title="B.bold" :aria-label="B.bold" @click="wrap('**')"><SpaceIcon name="bold" :size="15" /></button>
        <button type="button" :title="B.italic" :aria-label="B.italic" @click="wrap('*')"><SpaceIcon name="italic" :size="15" /></button>
        <button type="button" :title="B.strike" :aria-label="B.strike" @click="wrap('~~')"><SpaceIcon name="strike" :size="15" /></button>
        <span class="sc-sep"></span>
        <button type="button" :title="B.list" :aria-label="B.list" @click="lead('- ')"><SpaceIcon name="ul" :size="15" /></button>
        <button type="button" :title="B.quote" :aria-label="B.quote" @click="lead('> ')"><SpaceIcon name="quote" :size="15" /></button>
        <button type="button" :title="B.code" :aria-label="B.code" @click="wrap('`')"><SpaceIcon name="code" :size="15" /></button>
      </div>
      <div class="sc-field">
        <div class="sc-mirror" aria-hidden="true"><template v-for="(sp, i) in spans" :key="i"><span v-if="sp.kind === 'at'" class="sc-at">{{ sp.text }}</span><template v-else>{{ sp.text }}</template></template><span v-if="!body" class="sc-ph">{{ placeholder || W.placeholder }}</span>{{ '\n' }}</div>
        <textarea
          ref="box" v-model="body" rows="1" :disabled="disabled"
          :aria-label="placeholder || W.placeholder" @input="typed" @keydown="keys"></textarea>
      </div>
      <div class="sc-row">
        <button type="button" :title="B.emoji" :aria-label="B.emoji" @click="picks = !picks"><SpaceIcon name="smile" :size="16" /></button>
        <button v-if="mayMention" type="button" :title="W.mention" :aria-label="W.mention" @click="wrap('@')"><SpaceIcon name="at" :size="16" /></button>
        <button v-if="micOn" type="button" :title="W.record" :aria-label="W.record" @click="recording = true"><SpaceIcon name="mic" :size="16" /></button>
        <label v-if="mayMedia && mayFile && !disabled" class="sc-clip" :title="NC.media" :aria-label="NC.media">
          <input type="file" :accept="MEDIA_ACCEPT" multiple hidden @change="pickedMedia" />
          <SpaceIcon name="image" :size="16" />
        </label>
        <label v-if="mayFile && !disabled" class="sc-clip" :title="W.attach" :aria-label="W.attach">
          <input type="file" :accept="Object.keys(FILE_TYPES).join(',')" hidden @change="attached" />
          <SpaceIcon name="clip" :size="16" />
        </label>
        <button v-if="mayPoll" type="button" :title="P.make" :aria-label="P.make" @click="emit('poll')"><SpaceIcon name="chart" :size="16" /></button>
        <span class="sc-gap"></span>
        <!-- "also send to the channel" answers a real question in a STREAM, where a thread is off
             to one side and a reply might belong in the room as well. In a FORUM the post IS the
             channel, so the box asked whether to copy a reply into the place it already is. -->
        <label v-if="thread && mayEcho" class="sc-echo">
          <input v-model="echo" type="checkbox" />
          <span>{{ (W['also-send'] || '').replace('{channel}', channelName) }}</span>
        </label>
        <span class="sc-sendbit">
          <button v-if="mayLater" type="button" class="sc-clock" :disabled="!ready" :aria-label="L.later" :title="L.later" @click="openTiming"><SpaceIcon name="clock" :size="15" /></button>
          <button type="button" class="sc-send" :class="{ on: ready }" :disabled="!ready" :aria-label="B.send" :title="B.send" @click="go"><SpaceIcon name="send" :size="15" /></button>
          <div v-if="timing" class="sc-when" :style="{ top: whenAt.top + 'px', left: whenAt.left + 'px' }">
            <p>{{ L['when-title'] }}</p>
            <button v-for="o in whens" :key="o.key" type="button" @click="later(o.when)">
              <b>{{ L['when-' + o.key] }}</b><small>{{ sayWhen(o.when) }}</small>
            </button>
            <label>{{ L['when-exact'] }}<input v-model="exact" type="datetime-local" /></label>
            <footer>
              <button type="button" class="sc-ghost" @click="timing = false">{{ L.cancel }}</button>
              <button type="button" :disabled="!usable(exact)" @click="later(new Date(exact))">{{ L.schedule }}</button>
            </footer>
          </div>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; these say what they want instead */
/* the same column the conversation keeps, so the box ends where the words do rather than running
   the width of whatever monitor it is opened on */
.sc { position: relative; width: 100%; max-width: 1180px; padding: 0 16px 14px }
/* the clip wears the same shape as every other action in the row; a label rather than a button,
   because the input inside it is what opens the chooser */
.sc-clip { display: grid; place-items: center; width: 28px; height: 26px; color: var(--ink3);
  border-radius: 7px; cursor: pointer }
.sc-clip:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 7%, transparent) }
.sc-refused { margin: 0 0 6px; max-width: none; font-size: 12.5px; color: var(--ink2) }
.sc-rec { border: 1px solid color-mix(in srgb, var(--ink) 16%, transparent); border-radius: 9px;
  background: var(--paper); padding: 6px 8px }
.sc-box { display: flex; flex-direction: column; border: 1px solid color-mix(in srgb, var(--ink) 16%, transparent);
  border-radius: 9px; background: var(--paper); overflow: hidden;
  transition: border-color .12s ease, box-shadow .12s ease }
.sc-box:focus-within { border-color: color-mix(in srgb, var(--ink) 45%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink) 12%, transparent) }
.sc-marks { display: flex; gap: 1px; padding: 4px 6px 2px; border-bottom: 1px solid color-mix(in srgb, var(--ink) 6%, transparent) }
.sc-sep { width: 1px; height: 16px; margin: 4px 3px; background: color-mix(in srgb, var(--ink) 14%, transparent) }
.sc-emoji { position: absolute; left: 16px; bottom: calc(100% - 6px); display: flex; gap: 2px; list-style: none;
  margin: 0; padding: 5px; background: var(--paper); border: 1px solid var(--hair); border-radius: 10px;
  box-shadow: 0 8px 26px color-mix(in srgb, var(--ink) 16%, transparent); z-index: 5 }
.sc-emoji button { font: inherit; font-size: 17px; background: transparent; border: 0; border-radius: 6px;
  padding: 3px 5px; cursor: pointer }
.sc-emoji button:hover { background: color-mix(in srgb, var(--ink) 8%, transparent) }
.sc-marks button { display: grid; place-items: center; width: 26px; height: 24px; font: inherit; font-size: 12px;
  color: var(--ink3); background: transparent; border: 0; border-radius: 5px; cursor: pointer }
.sc-marks button:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 7%, transparent) }
/* one box, drawn twice: the mirror carries the words and the badges, the textarea carries the caret
   and the selection. They must agree on every pixel of type, so both read the same rules here. */
.sc-field { position: relative; max-height: 40vh; overflow-y: auto }
.sc-mirror, .sc textarea { font: inherit; font-size: 15px; line-height: 1.47; letter-spacing: inherit;
  padding: 9px 12px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: normal }
.sc-mirror { min-height: 38px; color: var(--ink); pointer-events: none }
.sc-ph { color: var(--ink3) }
.sc-at { color: var(--sp-link, #1f6f66); background: color-mix(in srgb, currentColor 12%, transparent);
  border-radius: 4px; padding: 0 3px; font-weight: 600; box-decoration-break: clone; -webkit-box-decoration-break: clone }
.sc textarea { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; border: 0; resize: none;
  background: transparent; color: transparent; caret-color: var(--ink); overflow: hidden }
.sc textarea::selection { background: color-mix(in srgb, var(--ink) 22%, transparent) }
.sc textarea:focus { outline: none }
.sc-row { display: flex; align-items: center; gap: 8px; padding: 4px 6px 6px }
.sc-row > button { display: grid; place-items: center; width: 28px; height: 26px; font: inherit; font-size: 14px;
  color: var(--ink3); background: transparent; border: 0; border-radius: 5px; cursor: pointer }
.sc-row > button:hover:not(:disabled) { color: var(--ink); background: color-mix(in srgb, var(--ink) 7%, transparent) }
.sc-row > button:disabled { opacity: .45; cursor: default }
.sc-gap { flex: 1 }
.sc-sendbit { position: relative; display: inline-flex; align-items: center; gap: 2px }
.sc-clock:disabled { opacity: .35; cursor: default }
.sc-when { position: fixed; z-index: 140;
  display: flex; flex-direction: column; gap: 2px; width: 272px; padding: 9px;
  background: var(--paper); border: 1px solid var(--hair, var(--line, var(--hair))); border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, .18) }
.sc-when > p { margin: 0 0 4px; padding: 0 2px; font-size: 10px; font-weight: 700; letter-spacing: .07em;
  text-transform: uppercase; color: var(--ink3) }
.sc-when > button { display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  font: inherit; font-size: 13px; text-align: left; color: inherit; padding: 7px 8px;
  background: none; border: 0; border-radius: 8px; cursor: pointer }
.sc-when > button:hover { background: color-mix(in srgb, var(--ink) 7%, transparent) }
.sc-when > button b { white-space: nowrap }
.sc-when > button small { flex: none; font-size: 11.5px; color: var(--ink3) }
.sc-when label { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; padding: 0 2px;
  font-size: 11px; font-weight: 600; color: var(--ink3) }
.sc-when input { font: inherit; font-size: 12.5px; font-weight: 400; color: var(--ink); padding: 6px 8px;
  background: color-mix(in srgb, var(--ink) 5%, transparent); border: 1px solid transparent; border-radius: 8px }
.sc-when footer { display: flex; justify-content: flex-end; gap: 6px; margin: 8px 0 0; padding: 0;
  background: none; border: 0 }
.sc-when footer button { font: inherit; font-size: 12px; font-weight: 600; padding: 6px 12px;
  color: var(--paper, #fff); background: var(--ink); border: 0; border-radius: 8px; cursor: pointer }
.sc-when footer button:disabled { opacity: .4; cursor: default }
.sc-when footer .sc-ghost { color: var(--ink2); background: none; border: 1px solid var(--line, var(--hair)) }
.sc-send { color: var(--ink2) !important; background: color-mix(in srgb, var(--ink) 8%, transparent) !important }
.sc-send.on { color: #fff !important; background: var(--sp-go) !important }
.sc-send:disabled { cursor: default }
.sc-echo { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink2); cursor: pointer }
.sc-warn { margin: 0 0 8px; max-width: none; font-size: 12.5px; line-height: 1.45; color: var(--ink2);
  background: color-mix(in srgb, var(--ink) 6%, transparent); border-radius: 8px; padding: 7px 10px }
.sc-botmark { display: grid; place-items: center; width: 22px; height: 22px; flex: none; color: var(--ink3);
  background: color-mix(in srgb, var(--ink) 8%, transparent); border-radius: 6px }
.sc-isbot { font-style: normal; font-size: 9px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  margin-left: 6px; padding: 2px 4px; color: var(--ink3);
  background: color-mix(in srgb, var(--ink) 9%, transparent); border-radius: 4px }
.sc-slash li button span { display: flex; flex-direction: column; gap: 1px; min-width: 0; text-align: left }
.sc-slash li button small { font-size: 11.5px; color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sc-pick { position: absolute; left: 16px; right: 16px; bottom: calc(100% - 8px); list-style: none; margin: 0; padding: 5px;
  max-height: 46vh; overflow-y: auto; background: var(--paper); border: 1px solid var(--hair); border-radius: 10px;
  box-shadow: 0 8px 26px color-mix(in srgb, var(--ink) 16%, transparent); z-index: 5 }
.sc-pick button { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; font: inherit; font-size: 14px;
  color: var(--ink); background: transparent; border: 0; border-radius: 6px; padding: 5px 8px; cursor: pointer }
.sc-pick button:hover { color: #fff; background: var(--sp-side-on) }
.sc-none { position: absolute; left: 16px; bottom: calc(100% - 8px); margin: 0; max-width: none; font-size: 12.5px;
  color: var(--ink3); background: var(--paper); border: 1px solid var(--hair); border-radius: 8px; padding: 6px 10px }
</style>

<script setup>
/*
 * A FORUM POST, READ WHOLE.
 *
 * In a stream channel a thread belongs in a side panel: the room carries on beside it and a reader
 * wants both. In a FORUM channel it does not. The post is the content and the board is only the
 * index to it, so opening one squeezed the board into two thirds of the pane and pinned the post
 * into a 380-pixel column beside it — every title wrapping over three lines, every reply in a
 * gutter — which is the single worst thing in this surface and the reason this file exists.
 *
 * Here a post takes the whole pane and is set like something meant to be read: the title at the
 * size of a title, the author under it, the body at a measure, then the replies as a conversation
 * beneath a rule, then the composer at the foot where the eye already is. One way back, at the top,
 * naming the room it belongs to.
 *
 * It draws the same SpaceLine as everywhere else for the replies — reactions, withdrawals, voice
 * notes, polls, mentions all come free — and the same SpaceComposer. Nothing about a post is its
 * own kind of message; only its reading is its own. Words: spaces.md channel.post.
 */
import { computed } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { saidBy, runsOf, lineBlocks, titleOf } from 'platformkit/lib/spaces/model.js'
import SpaceAvatar from './SpaceAvatar.vue'
import SpaceIcon from './SpaceIcon.vue'
import SpaceLine from './SpaceLine.vue'
import ChatChoices from '../chat/ChatChoices.vue'
import MessageText from '../chat/MessageText.vue'

const props = defineProps({
  root: { type: Object, required: true },
  replies: { type: Array, default: () => [] },
  names: { type: Object, default: () => ({}) },
  flair: { type: Object, default: () => ({}) },
  faces: { type: Object, default: () => ({}) },
  me: { type: String, default: '' },
  channel: { type: String, default: '' },
  reactions: { type: Function, default: () => () => [] },
  mayPin: { type: Boolean, default: false },
  pinned: { type: Boolean, default: false },
  reportable: { type: Boolean, default: false },
})
const emit = defineEmits(['back', 'react', 'withdraw', 'report', 'pin', 'choose'])
const W = computed(() => us('spaces').channel.main)
const T = computed(() => us('spaces').channel.post)
const P = computed(() => us('spaces').page.main)

const botName = computed(() => (props.root.meta && (props.root.meta.name || props.root.meta.bot)) || '')
const who = computed(() => saidBy(props.root, props.names, P.value.someone))
/* a post normally carries its own title; one promoted out of the stream — a message somebody
   replied to until it became a conversation — has none, and titleOf reads its first sentence, which
   is what the board shows for it too. The two must agree or going in looks like going somewhere else. */
const title = computed(() => props.root.title || titleOf(props.root, props.names))
const blocks = computed(() => lineBlocks(props.root.body, props.names, { someone: P.value.someone, channel: P.value['channel-word'] }))
const when = computed(() => {
  const d = new Date(props.root.created_at)
  if (isNaN(d)) return ''
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
})
const runs = computed(() => runsOf(props.replies))
/* a post a bot opened may offer choices, exactly as its line in a stream would — the board is
   where a question to the room most often belongs, so leaving them out here would leave them out
   of the surface that wants them most */
const offered = computed(() => (props.root.meta && props.root.meta.choices) || [])
const offerLive = computed(() => offered.value.length && !props.root.choice_at && !props.root.deleted_at)
const countWord = computed(() => (props.replies.length === 1 ? T.value['replies-one']
  : (T.value['replies-many'] || '').replace('{n}', props.replies.length)))
</script>

<template>
  <div class="sq">
    <div class="sq-in">
      <!-- ONE way back, and it names where to. "×" in the corner of a panel told a reader the panel
           was going; it never told them what they would be looking at afterwards. -->
      <button type="button" class="sq-back" @click="emit('back')">
        <SpaceIcon name="chev" :size="12" class="sq-chev" />{{ (T.back || '').replace('{channel}', channel) }}
      </button>

      <article class="sq-post">
        <h1 class="sq-title">{{ title }}</h1>
        <div class="sq-by">
          <SpaceAvatar :name="who" :size="30" />
          <span class="sq-byline">
            <b>{{ who }}<em v-if="botName" class="sq-bot">{{ W.bot }}</em></b>
            <small>{{ when }}<template v-if="root.edited_at"> · {{ T.edited }}</template></small>
          </span>
          <em v-if="pinned" class="sq-pin"><SpaceIcon name="pin" :size="11" />{{ W['pinned-badge'] }}</em>
        </div>
        <!-- the body at a reading measure and a reading size: it is the post, not a chat line -->
        <div class="sq-body"><MessageText :blocks="blocks" :me="me" /></div>
        <ChatChoices
          :choices="offered" :live="!!offerLive" :taken="root.choice_key || ''"
          @choose="(c) => emit('choose', { message: root.id, key: c.key, text: c.text })" />
      </article>

      <div class="sq-rule"><span>{{ countWord }}</span></div>

      <p v-if="!replies.length" class="sq-none">{{ T['replies-none'] }}</p>
      <div v-else class="sq-replies">
        <SpaceLine
          v-for="r in runs" :key="r.id" :message="r" :names="names" :flair="flair" :faces="faces" :me="me" :first="r.first"
          :reactions="reactions(r.id)" :reportable="reportable" :hide-replies="true"
          @react="(e) => emit('react', r.id, e)" @withdraw="emit('withdraw', r.id)" @report="emit('report', r.id)" @choose="(c) => emit('choose', c)" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; every class here says what it wants instead */
/* as in the board: the page's .sp-scroll owns this root's padding, so the reading column carries
   its own. A bare <article> and a bare <h1> are styled by the site's global stylesheet too, so both
   say their margins and padding outright below rather than inheriting a page's. */
.sq { overflow-y: auto }
/* the same measure the board keeps, so going in and coming back is not a jump */
/* width said outright: the pane is a flex column and this block shrank to its widest child,
   which centred a 560px reading measure in an 814px pane and left the title hanging in mid-air. */
.sq-in { width: 100%; box-sizing: border-box; max-width: 880px; margin: 0 auto; padding: 18px 20px 30px }

.sq-back { display: inline-flex; align-items: center; gap: 6px; width: auto; margin: 0 0 16px;
  font: inherit; font-size: 12.5px; color: var(--ink3); background: transparent; border: 0; padding: 0; cursor: pointer }
.sq-back:hover { color: var(--ink) }
.sq-chev { transform: rotate(90deg) }

.sq-post { display: flex; flex-direction: column; gap: 0; margin: 0; padding: 0; border: 0; background: transparent }
/* a title at the size of a title. In the side panel it was a chat line in bold and wrapped over
   three lines at 380px, which is what made a post read as a message rather than as a piece. */
.sq-title { margin: 0 0 14px; font-family: var(--fd); font-weight: 680; font-size: 30px; line-height: 1.18;
  letter-spacing: -.018em; color: var(--ink) }
.sq-by { display: flex; align-items: center; gap: 10px; margin: 0 0 20px }
.sq-byline { display: flex; flex-direction: column; gap: 1px; min-width: 0 }
.sq-byline b { display: flex; align-items: center; gap: 7px; font-weight: 650; font-size: 14px; color: var(--ink) }
.sq-byline small { font-family: var(--m); font-size: 11px; color: var(--ink3) }
.sq-bot { font-family: var(--m); font-style: normal; font-size: 9px; font-weight: 700; letter-spacing: .07em;
  text-transform: uppercase; color: var(--ink3); background: color-mix(in srgb, var(--ink) 8%, transparent);
  border-radius: 4px; padding: 1px 5px }
.sq-pin { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; font-family: var(--m); font-style: normal;
  font-size: 9.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--accent) }
/* the body reads at 16.5 on a 34em measure — a post is read, and 15px chat type across the whole
   pane is not reading, it is scanning */
.sq-body { max-width: 34em; font-size: 16.5px; line-height: 1.68; color: var(--ink) }
.sq-body :deep(p) { margin: 0 0 1em }
.sq-body :deep(p:last-child) { margin-bottom: 0 }

/* the rule that says how many answered: the count sits ON the line, as a book sets a break */
.sq-rule { display: flex; align-items: center; gap: 12px; margin: 30px 0 4px }
.sq-rule::before, .sq-rule::after { content: ''; height: 1px; background: var(--hair); flex: 1 }
.sq-rule span { font-family: var(--m); font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--ink3) }
.sq-none { margin: 22px 0 0; text-align: center; font-size: 13.5px; color: var(--ink3) }
.sq-replies { display: flex; flex-direction: column; padding-top: 10px }

@media (max-width: 640px) {
  .sq-in { padding: 14px 12px 22px }
  .sq-title { font-size: 23px }
  .sq-body { font-size: 16px }
}
</style>

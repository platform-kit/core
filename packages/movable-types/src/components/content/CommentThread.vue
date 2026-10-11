<script setup>
/*
 * THE CONVERSATION UNDER A THING — an article, a wiki page, a book, a product, an event.
 *
 * One component for all of them, because "what do people say about this" is one question and five
 * components would be five sets of nearly-the-same bugs. It is given a KIND and a SUBJECT and knows
 * nothing else: whether the thread lives in the comments table or as a post in a forum channel is
 * the database's business, and a component that had to know could get it wrong.
 *
 * THE SHAPE IS NOT DECIDED HERE either. A reply may answer any reply to any depth — who somebody
 * was answering is part of what they said — and what is bounded is the DRAWING: the surface says
 * how far to indent and how long a run may get, and src/lib/comments/model.js turns the flat list
 * into the lines to draw. A reply drawn shallower than it really is says whose comment it answers,
 * because once the indent stops the shape no longer carries that.
 *
 * Where it IS a forum post, the page says so and offers the way in — because a reader who says
 * something here should be able to find it in the community, and a reader in the community should
 * not wonder where these came from. One conversation, two doors.
 *
 * Words: '## comments' in the library scope.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { commentsOn, say, unsay, commentSubject, react, vote } from '@platform-kit/kit/lib/comments.js'
import { session } from '@platform-kit/kit/lib/auth.js'
import { initials } from '@platform-kit/kit/lib/chat/model.js'
import { shape, sortComments, ordersFor, reactionsOf, voteAfter, voteTally } from '@platform-kit/kit/lib/comments/model.js'

const props = defineProps({
  kind: { type: String, required: true },
  subject: { type: String, required: true },
  /* a host that already says what this conversation is — the reader's drawer, titled by the
     chapter — does not want it said twice */
  bare: { type: Boolean, default: false },
  /*
   * WHETHER TO SHOW THE JOIN. How the thread is separated from what came before is the PAGE's
   * question, not the thread's: a page of sections already separates its own, and a second rule a
   * few pixels under the first at a different width reads as a mistake rather than a division. So
   * a host that wants the join drawn asks for it — the article does, because there the thread
   * continues a column of prose and the reader should see it continue.
   */
  rule: { type: Boolean, default: false },
  /* what to call the thread where it does not exist yet and its kind is open — an embed naming the
     page it is on. Everything of the site's own is projected and already has a title. */
  title: { type: String, default: '' },
  /* and where that page actually is, so the community has a way back to it */
  href: { type: String, default: '' },
  /* an embed is a narrow column on somebody else's page: indenting in it is how a comment ends up
     eight words wide, so it draws one flat run whatever the surface says */
  depth: { type: Number, default: 0 },
})
const W = computed(() => us('library').comments.main)

const rows = ref([])
/* what the database says this conversation is: null where the thing takes none, and then the
   component draws nothing at all rather than an empty comments heading under everything */
const about = ref(null)
const may = computed(() => !!about.value && about.value.may_write)
/* the same conversation read in the community; named apart from the href PROP, which is where
   the embed's own page is */
const inChannel = computed(() => (about.value && about.value.thread) || '')
const loading = ref(true)
const busy = ref(false)
const draft = ref('')
const failed = ref(false)
/* who the reader is answering, and which folded runs they have opened */
const answering = ref(null)
const opened = ref([])

/* THE ORDER IS THE READER'S OWN, remembered in their own browser, and it never changes what anybody
   else sees. Oldest first stays the default, so turning voting on changes nothing about how a page
   reads until somebody asks it to. */
const PREF = 'dl.comments.order'
const order = ref((() => { try { return localStorage.getItem(PREF) || 'oldest' } catch (e) { return 'oldest' } })())
const orders = computed(() => ordersFor(!!(about.value && about.value.votes)))
watch(order, (v) => { try { localStorage.setItem(PREF, v) } catch (e) { /* private mode */ } })

async function load() {
  loading.value = true
  about.value = await commentSubject(props.kind, props.subject)
  rows.value = about.value ? await commentsOn(props.kind, props.subject) : []
  /* an OPEN kind has no row for this page until somebody says the first thing, and a page that
     drew nothing until then would never get one. The kind's own wildcard answers instead. */
  if (!about.value) about.value = await commentSubject(props.kind, '*')
  loading.value = false
}
onMounted(load)
watch(() => [props.kind, props.subject].join('/'), load)
watch(session, load)

const live = computed(() => rows.value.filter((r) => !r.deleted_at && r.state !== 'waiting'))
const count = computed(() => (live.value.length === 1 ? W.value.one : String(W.value.many || '').replace('{n}', live.value.length)))
/* the lines to draw, in the reader's order, at this surface's shape */
const drawn = computed(() => shape(sortComments(rows.value, orders.value.includes(order.value) ? order.value : 'oldest'), {
  depth: props.depth || (about.value && about.value.depth) || 3,
  collapse: (about.value && about.value.collapse) || 5,
  open: opened.value,
}))
const takesVotes = computed(() => !!(about.value && about.value.votes))
const takesReactions = computed(() => !!(about.value && about.value.reactions))
/* what a site offers to leave, which is deliberately a short list: a palette of six hundred is a
   palette nobody scrolls, and the five that mean something are the five people use */
const EMOJI = ['👍', '❤️', '🙏', '😂', '🤔']

/* the site's own modal, wherever this is drawn — on a page of the site, or in a frame of it on
   somebody else's. It is a global overlay of the shell, so the embed page has it too. */
function signIn() { if (typeof window !== 'undefined' && window.DLauth) window.DLauth.open({ intent: 'comment' }) }

const when = (v) => { const d = new Date(v); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) }
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const unfold = (id) => { opened.value = opened.value.includes(id) ? opened.value.filter((x) => x !== id) : [...opened.value, id] }

async function post() {
  const body = draft.value.trim()
  if (!body || busy.value) return
  busy.value = true; failed.value = false
  const r = await say(props.kind, props.subject, body, answering.value, props.title || null, props.href || null)
  if (r && r.error) failed.value = true
  else { draft.value = ''; answering.value = null; await load() }
  busy.value = false
}
async function withdraw(id) {
  if (busy.value) return
  busy.value = true
  await unsay(id)
  await load()
  busy.value = false
}

/* A PRESS SHOWS AT ONCE and is exchanged for what the database says on the next read: a tally that
   waits for a round trip is a tally people press twice. */
async function pressEmoji(row, emoji) {
  const mine = ((row.mine_re || []).includes(emoji))
  const held = rows.value.find((r) => r.id === row.id)
  if (held) {
    const re = { ...(held.re || {}) }
    re[emoji] = Math.max(0, (Number(re[emoji]) || 0) + (mine ? -1 : 1))
    if (!re[emoji]) delete re[emoji]
    held.re = re
    held.mine_re = mine ? (held.mine_re || []).filter((e) => e !== emoji) : [...(held.mine_re || []), emoji]
  }
  const r = await react(row.id, emoji, !mine)
  if (r && r.error) await load()
}
async function pressVote(row, dir) {
  const next = voteAfter(row.my_vote, dir)
  const held = rows.value.find((r) => r.id === row.id)
  if (held) Object.assign(held, voteTally(held, next))
  const r = await vote(row.id, next)
  if (r && r.error) await load()
}
</script>

<template>
  <!-- a thing whose file says nothing about comments has none, and draws nothing: an empty
       "Comments" heading under every article on a site that never wanted them is worse than none -->
  <section v-if="about" class="cmt" :class="{ 'cmt-set': !bare, 'cmt-rule': rule && !bare }">
    <header v-if="!bare" class="cmt-head">
      <h2>{{ W.title }}</h2>
      <span v-if="live.length" class="cmt-n">{{ count }}</span>
      <!-- THE ORDER IS THE READER'S, and it is offered only where there is more than one way to
           read the thread. An order nothing can compute is not a choice. -->
      <label v-if="live.length > 1 && orders.length > 1" class="cmt-order">
        <span>{{ W.order }}</span>
        <select v-model="order">
          <option v-for="o in orders" :key="o" :value="o">{{ W['order-' + o] }}</option>
        </select>
      </label>
    </header>

    <!-- ONE CONVERSATION, TWO DOORS. Where the thread is also a post in the community, say so and
         offer the way in — a reader who says something here should be able to find it there. -->
    <p v-if="inChannel" class="cmt-also">{{ W['in-channel'] }} <a :href="inChannel">{{ W['open-channel'] }}</a></p>

    <p v-if="loading" class="cmt-quiet">…</p>

    <ol v-else-if="drawn.length" class="cmt-list">
      <template v-for="c in drawn" :key="c.fold ? 'fold-' + c.fold : c.id">
        <!-- a run longer than the surface allows folds behind ONE control that says how many -->
        <li v-if="c.fold" class="cmt-fold" :style="{ '--in': c.indent }">
          <button type="button" @click="unfold(c.fold)">
            {{ c.hidden === 1 ? W['more-one'] : fill(W['more-many'], { n: c.hidden }) }}
          </button>
        </li>
        <li v-else class="cmt-row" :class="{ gone: !!c.deleted_at, held: c.state === 'waiting' }" :style="{ '--in': c.indent }">
          <span class="cmt-face" aria-hidden="true">{{ initials(c.name || '') }}</span>
          <div class="cmt-body">
            <div class="cmt-who">
              <b>{{ c.name }}</b><time>{{ when(c.created_at) }}</time>
              <!-- ONCE THE INDENT STOPS, the shape no longer says who somebody was answering, so
                   the line does: a flat run answering four different people is a conversation
                   nobody can follow. -->
              <em v-if="c.answers" class="cmt-at">{{ fill(W.answers, { name: c.answers.name }) }}</em>
            </div>
            <p v-if="c.deleted_at" class="cmt-gone">{{ W.withdrawn }}</p>
            <template v-else>
              <p class="cmt-said">{{ c.body }}</p>
              <!-- HELD IS NOT HIDDEN FROM ITS AUTHOR. They see it, marked as waiting — a comment
                   that vanishes on posting is how somebody decides the site is broken and says the
                   same thing twice. They are never told which word caught them. -->
              <p v-if="c.state === 'waiting'" class="cmt-wait">{{ W.waiting }}</p>

              <div class="cmt-acts">
                <template v-if="takesVotes">
                  <button type="button" class="cmt-vote" :class="{ on: c.my_vote === 1 }" :aria-label="W['vote-up']"
                          :aria-pressed="c.my_vote === 1" @click="pressVote(c, 1)">
                    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V4M4 7.5 8 3.5l4 4" /></svg>
                    <b v-if="c.up - c.down">{{ c.up - c.down }}</b>
                  </button>
                  <button type="button" class="cmt-vote" :class="{ on: c.my_vote === -1 }" :aria-label="W['vote-down']"
                          :aria-pressed="c.my_vote === -1" @click="pressVote(c, -1)">
                    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v9M4 8.5 8 12.5l4-4" /></svg>
                  </button>
                </template>

                <template v-if="takesReactions">
                  <button v-for="r in reactionsOf(c)" :key="r.emoji" type="button" class="cmt-re" :class="{ on: r.mine }"
                          @click="pressEmoji(c, r.emoji)"><span>{{ r.emoji }}</span>{{ r.n }}</button>
                  <span v-if="may" class="cmt-add">
                    <button type="button" class="cmt-plus" :aria-label="W.react">+</button>
                    <span class="cmt-palette">
                      <button v-for="e in EMOJI" :key="e" type="button" @click="pressEmoji(c, e)">{{ e }}</button>
                    </span>
                  </span>
                </template>

                <button v-if="may" type="button" class="cmt-x" @click="answering = c.id; draft = ''">{{ W.reply }}</button>
                <button v-if="c.mine" type="button" class="cmt-x" @click="withdraw(c.id)">{{ W.withdraw }}</button>
              </div>

              <!-- the box opens under the line it answers, so nobody has to remember who they
                   pressed Reply on by the time they have scrolled to the foot -->
              <form v-if="answering === c.id" class="cmt-form cmt-inline" @submit.prevent="post">
                <textarea v-model="draft" rows="2" :placeholder="fill(W['replying-to'], { name: c.name })" :disabled="busy"></textarea>
                <div class="cmt-act">
                  <button type="submit" :disabled="busy || !draft.trim()">{{ busy ? W.sending : W.send }}</button>
                  <button type="button" class="cmt-x" @click="answering = null">{{ W.cancel }}</button>
                  <small v-if="failed" class="cmt-bad">{{ W.error }}</small>
                </div>
              </form>
            </template>
          </div>
        </li>
      </template>
    </ol>

    <p v-else class="cmt-quiet">{{ W.none }}<template v-if="may">{{ ' ' }}{{ W.first }}</template></p>

    <form v-if="may && !answering" class="cmt-form" @submit.prevent="post">
      <textarea v-model="draft" rows="3" :placeholder="W.placeholder" :disabled="busy"></textarea>
      <div class="cmt-act">
        <button type="submit" :disabled="busy || !draft.trim()">{{ busy ? W.sending : W.send }}</button>
        <small v-if="about.approval !== 'none'" class="cmt-note">{{ W['waiting-note'] }}</small>
        <small v-if="failed" class="cmt-bad">{{ W.error }}</small>
      </div>
    </form>
    <!-- A SENTENCE WITH NO WAY IN IS A SENTENCE THAT WASTES SOMEBODY'S TIME, and in the embed it is
         the whole point of the frame: a reader on somebody else's page signs in here, under that
         page, and their browser keeps that apart from every other site the embed appears on. -->
    <p v-else-if="!session" class="cmt-quiet cmt-in">
      {{ W.signin }}
      <button type="button" class="cmt-signin" @click="signIn">{{ W['sign-in'] }}</button>
    </p>
    <p v-else-if="!loading && !answering" class="cmt-quiet">{{ W.members }}</p>
  </section>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; every class here says what it wants instead */
.cmt { margin: 40px 0 0; padding: 0; border: 0 }
/*
 * WHERE THE CONVERSATION SITS ON A PAGE: on the reading measure, like the piece it is about, so it
 * reads as the end of the thing rather than as a band across the site. That much is the THREAD's
 * question and the same on every page, which is why it is answered here and not by each host.
 *
 * How it is SEPARATED from whatever came before is the page's question, and is deliberately not
 * answered here. A page of sections already separates its own (the store's), and a rule drawn by
 * the thread on top of that is two rules a few pixels apart at two different widths, which reads
 * as a mistake rather than as a division. The article draws its own, because there the thread
 * continues a column of prose and wants the join shown.
 *
 * `bare` is the reader's panel and the embed: each is already a column, so it takes no measure —
 * a column inside a column is an indent nobody asked for.
 */
/* the MEASURE only, and no side padding: a host that already has a gutter would double it, and
   the thread would sit indented from the column it is meant to continue. A host that places the
   thread at the page's own root gives it the gutter (ArticleView), which is the one case that
   needs one. */
.cmt-set { max-width: var(--readw); margin: 56px auto 0 }
/* the join is the rule and the air around it: the host leaves the space above (the article's
   column foot), so the thread adds none of its own, or the line sits far from what it divides */
.cmt-rule { margin-top: 0; padding-top: 30px; border-top: 1px solid var(--hair) }
.cmt-head { display: flex; align-items: baseline; gap: 10px; margin: 0 0 4px; padding: 0; border: 0 }
.cmt-head h2 { margin: 0; font-family: var(--fd); font-size: 19px; font-weight: 700; color: var(--ink) }
.cmt-n { font-family: var(--m); font-size: 11px; color: var(--ink3); white-space: nowrap }
.cmt-order { margin-left: auto; display: inline-flex; align-items: baseline; gap: 6px;
  font-family: var(--m); font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--ink3) }
.cmt-order select { font: inherit; font-family: var(--f); font-size: 12.5px; letter-spacing: 0; text-transform: none;
  color: var(--ink); background: none; border: 1px solid var(--hair); border-radius: 7px; padding: 3px 7px; width: auto }
.cmt-also { margin: 0 0 18px; font-size: 13px; color: var(--ink3) }
.cmt-also a { color: var(--accent2, var(--ink)); text-decoration: underline; text-underline-offset: 3px }
/* on a phone the three of them do not fit on one line, and squeezing them breaks the count
   across two — so the order drops to its own line rather than the words breaking */
@media (max-width: 560px) {
  .cmt-head { flex-wrap: wrap }
  .cmt-order { margin-left: 0; width: 100% }
}
.cmt-quiet { margin: 14px 0; font-size: 14px; color: var(--ink3) }

.cmt-list { list-style: none; margin: 18px 0 0; padding: 0; display: flex; flex-direction: column; gap: 18px }
/* THE INDENT IS THE ONLY THING THE DEPTH DOES. It stops where the surface says and the conversation
   carries on flat — a fourth indent is a column six words wide. */
.cmt-row { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; align-items: start;
  margin-left: calc(var(--in, 0) * 30px) }
.cmt-fold { margin-left: calc(var(--in, 0) * 30px) }
.cmt-fold button { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink3); width: auto;
  background: none; border: 0; border-bottom: 1px solid var(--hair); padding: 0 0 2px; cursor: pointer }
.cmt-fold button:hover { color: var(--ink) }
.cmt-face { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 999px;
  font-family: var(--m); font-size: 12px; font-weight: 700; color: var(--paper);
  background: color-mix(in srgb, var(--ink) 55%, transparent) }
.cmt-body { min-width: 0 }
.cmt-who { display: flex; flex-wrap: wrap; align-items: baseline; gap: 9px }
.cmt-who b { font-size: 14px; font-weight: 650; color: var(--ink) }
.cmt-who time { font-family: var(--m); font-size: 11px; color: var(--ink3) }
.cmt-at { font-size: 11.5px; font-style: normal; color: var(--ink3) }
.cmt-said { margin: 3px 0 0; font-size: 15px; line-height: 1.6; color: var(--ink); white-space: pre-wrap }
.cmt-gone { margin: 3px 0 0; font-size: 14px; font-style: italic; color: var(--ink3) }
/* a held comment reads as a draft rather than as a published line: its author can see it is not up
   yet without being told which word, if any, caught it */
.cmt-row.held .cmt-said { opacity: .72 }
.cmt-wait { margin: 5px 0 0; font-family: var(--m); font-size: 11px; color: var(--ink3) }

.cmt-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 6px }
.cmt-x { width: auto; font: inherit; font-size: 11.5px; color: var(--ink3);
  background: none; border: 0; padding: 0 3px; cursor: pointer }
.cmt-x:hover { color: var(--ink) }
.cmt-vote, .cmt-re, .cmt-plus { display: inline-flex; align-items: center; gap: 4px; width: auto;
  font: inherit; font-size: 11.5px; color: var(--ink3); background: none;
  border: 1px solid var(--hair); border-radius: 999px; padding: 2px 8px; cursor: pointer }
.cmt-vote b { font-family: var(--m); font-size: 11px; font-weight: 700 }
.cmt-vote:hover, .cmt-re:hover, .cmt-plus:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.cmt-vote.on, .cmt-re.on { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 45%, transparent);
  background: color-mix(in srgb, var(--ink) 6%, transparent) }
.cmt-re span { font-size: 13px }
.cmt-plus { font-size: 13px; line-height: 1; padding: 3px 9px }
.cmt-add { position: relative; display: inline-flex }
.cmt-palette { position: absolute; bottom: calc(100% + 6px); left: 0; display: none; gap: 2px; padding: 4px;
  background: var(--card); border: 1px solid var(--hair); border-radius: 10px; box-shadow: 0 6px 20px rgba(0,0,0,.09); z-index: 2 }
.cmt-add:hover .cmt-palette, .cmt-add:focus-within .cmt-palette { display: flex }
.cmt-palette button { width: auto; font-size: 15px; line-height: 1; background: none; border: 0; border-radius: 6px; padding: 3px 4px; cursor: pointer }
.cmt-palette button:hover { background: color-mix(in srgb, var(--ink) 8%, transparent) }

.cmt-form { margin: 24px 0 0; display: grid; gap: 10px }
.cmt-inline { margin: 10px 0 0 }
.cmt-form textarea { font: inherit; font-size: 15px; line-height: 1.55; color: var(--ink); background: var(--card);
  border: 1px solid var(--hair); border-radius: 12px; padding: 12px 14px; resize: vertical; width: 100%; box-sizing: border-box }
.cmt-act { display: flex; align-items: center; gap: 12px }
.cmt-act button[type=submit] { width: auto; font: inherit; font-size: 14px; font-weight: 650; color: var(--paper);
  background: var(--ink); border: 0; border-radius: 999px; padding: 9px 20px; cursor: pointer }
.cmt-act button[type=submit]:disabled { opacity: .45; cursor: default }
.cmt-note { font-size: 12px; color: var(--ink3) }
.cmt-bad { font-size: 12.5px; color: #c8382f }
.cmt-in { display: flex; flex-wrap: wrap; align-items: center; gap: 10px }
.cmt-signin { width: auto; font: inherit; font-size: 13px; font-weight: 650; color: var(--paper);
  background: var(--ink); border: 0; border-radius: 999px; padding: 6px 15px; cursor: pointer }
</style>

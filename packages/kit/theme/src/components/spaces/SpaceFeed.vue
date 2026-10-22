<script setup>
/*
 * The places that are not a room: Threads (every thread the reader is in, its root and its last
 * few replies), Mentions (what has been said to them) and Saved (what they kept to come back to). Each is a
 * read rather than a walk, and each row opens the thing it is about where it lives.
 * Words from spaces.md (feed).
 */
import { computed } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { plainBody, dmTitle } from 'platformkit/lib/spaces/model.js'
import SpaceAvatar from './SpaceAvatar.vue'
import SpaceIcon from './SpaceIcon.vue'

const props = defineProps({
  kind: { type: String, required: true },          /* threads | mentions | saved | drafts */
  rows: { type: Array, default: () => [] },
  names: { type: Object, default: () => ({}) },
  members: { type: Object, default: () => ({}) },
  me: { type: String, default: '' },
  spaceOf: { type: Object, default: () => ({}) },   /* channel id → the space's name, where saying it helps */
  /* where several of these lists are one place (Notifications without the network: Mentions and
     Threads), their names as tabs in place of the title: [{ key, word }] */
  tabs: { type: Array, default: () => [] },
})
const emit = defineEmits(['open', 'unsave', 'done', 'read', 'read-all', 'drop', 'tab'])
const F = computed(() => us('spaces').feed.main)
const R = computed(() => us('spaces').rail.main)
const title = computed(() => F.value[props.kind + '-title'])
const empty = computed(() => F.value[props.kind + '-empty'])
const emptyLine = computed(() => F.value[props.kind + '-empty-line'])
/* Who said it. These places cross every space, and the names a page holds are the open space's —
   so a row that crosses brings its own name and that one wins; the map is the fallback for a row
   from the space in front. */
const who = (row, id) => (row && row.author) || props.names[id] || R.value.someone
const whereOf = (row) => {
  const space = props.spaceOf[row.channel_id] || ''
  const dm = row.channel_kind === 'dm'
  /* a row that crosses spaces brings its own names (`peers`); one from the open space is named
     from the members the page holds, as it always was */
  const who = !dm ? ''
    : (row.peers && row.peers.length) ? row.peers.slice(0, 3).join(', ')
    : dmTitle(props.members[row.channel_id] || [], props.names, props.me, { self: R.value.self, more: R.value.more, someone: R.value.someone })
  if (space) {
    return dm
      ? (F.value['in-dm-of'] || '').replace('{space}', space).replace('{who}', who)
      : (F.value['in-channel-of'] || '').replace('{space}', space).replace('{channel}', row.channel)
  }
  return dm
    ? (F.value['in-dm'] || '').replace('{who}', who)
    : (F.value['in-channel'] || '').replace('{channel}', row.channel)
}
const when = (v) => {
  const d = new Date(v)
  if (isNaN(d)) return ''
  const mins = Math.max(1, Math.round((Date.now() - d.getTime()) / 60000))
  if (mins < 60) return mins + 'm'
  const hrs = Math.round(mins / 60)
  return hrs < 24 ? hrs + 'h' : Math.round(hrs / 24) + 'd'
}
const count = (n) => (Number(n) === 1 ? F.value['replies-one'] : (F.value['replies-many'] || '').replace('{n}', Number(n) || 0))
const unread = computed(() => props.rows.filter((r) => r.unread).length)
</script>

<template>
  <section class="sf">
    <header class="sf-head">
      <div class="sf-headin">
        <nav v-if="tabs.length" class="sf-tabs" :aria-label="title">
          <button v-for="t in tabs" :key="t.key" type="button" :class="{ on: t.key === kind }" :aria-pressed="t.key === kind" @click="emit('tab', t.key)"><span>{{ t.word }}</span></button>
        </nav>
        <h2 v-else>{{ title }}</h2>
        <button v-if="(kind === 'mentions' || kind === 'unreads') && unread" type="button" class="sf-readall" @click="emit('read-all')">{{ F['mark-all'] }}</button>
        <span v-else-if="kind === 'mentions' || kind === 'unreads'" class="sf-quiet">{{ F['all-read'] }}</span>
      </div>
    </header>
    <div class="sf-body">
      <!-- WHAT THIS PLACE SAYS WHEN IT HOLDS NOTHING. Every one of these views is empty for a
           reader's first weeks, so this is a normal state and not an error: it says what is not
           here and what would put something here. -->
      <div v-if="!rows.length" class="su-none">
        <h3>{{ empty }}</h3>
        <p>{{ emptyLine }}</p>
      </div>

      <!-- A DRAFT IS NOT A MESSAGE, so it is not drawn like one: it is a room with something
           unsent in it, and the only two things to do with it are finish it or throw it away. -->
      <ul v-else-if="kind === 'drafts'" class="sf-drafts">
        <li v-for="d in rows" :key="d.channel_id">
          <button type="button" class="sf-draft" @click="emit('open', { channel: d.channel_id })">
            <span class="sf-draft-where"><SpaceIcon name="pencil" :size="13" />{{ whereOf(d) }}</span>
            <span class="sf-draft-body">{{ d.body }}</span>
          </button>
          <span class="sf-draft-acts">
            <button type="button" @click="emit('open', { channel: d.channel_id })">{{ F['draft-open'] }}</button>
            <button type="button" @click="emit('drop', d.channel_id)">{{ F['draft-drop'] }}</button>
          </span>
        </li>
      </ul>

      <!-- Threads: the root, who is in it, and the last few replies under it -->
      <template v-if="kind === 'threads'">
        <article v-for="t in rows" :key="t.id" class="sf-card">
          <header class="sf-where">
            <SpaceIcon :name="t.channel_kind === 'dm' ? 'dm' : 'hash'" :size="13" />
            <b>{{ whereOf(t) }}</b>
            <em>{{ count(t.reply_count) }} · {{ when(t.last_at) }}</em>
          </header>
          <button type="button" class="sf-open" @click="emit('open', { channel: t.channel_id, thread: t.id })">
            <div class="sf-line">
              <SpaceAvatar :name="who(t.root, t.root.author_id)" :size="30" />
              <div>
                <b>{{ who(t.root, t.root.author_id) }}</b>
                <p>{{ t.root.title ? t.root.title + ' — ' : '' }}{{ plainBody(t.root.body, names) }}</p>
              </div>
            </div>
            <div v-for="r in t.tail" :key="r.id" class="sf-line sf-reply">
              <SpaceAvatar :name="who(r, r.author_id)" :size="24" />
              <div><b>{{ who(r, r.author_id) }}</b><p>{{ plainBody(r.body, names) }}</p></div>
            </div>
          </button>
        </article>
      </template>

      <!-- Activity: what was said to them -->
      <template v-else-if="kind === 'mentions'">
        <div v-for="a in rows" :key="a.id" class="sf-line-row">
        <button type="button" class="sf-row" :class="{ unread: a.unread }"
                @click="emit('open', { channel: a.channel_id, thread: a.thread_root_id })">
          <SpaceAvatar :name="who(a, a.author_id)" :size="34" />
          <div class="sf-mid">
            <span class="sf-top"><b>{{ who(a, a.author_id) }}</b>
              <em>{{ a.mention === 'channel' ? F['mentioned-channel'] : F.mentioned }}</em>
              <i>{{ whereOf(a) }}</i><u>{{ when(a.created_at) }}</u></span>
            <p>{{ plainBody(a.body, names) }}</p>
          </div>
          <span v-if="a.unread" class="sf-flag">{{ F.unread }}</span>
        </button>
        <button v-if="a.unread" type="button" class="sf-read" :title="F['mark-read']" :aria-label="F['mark-read']" @click.stop="emit('read', a)">
          <SpaceIcon name="tick" :size="14" />
        </button>
        </div>
      </template>

      <!-- EVERYTHING WAITING, wherever it is. The same row as a mention, without the eyebrow that
           says why — here the reason is simply that it has not been read. -->
      <template v-else-if="kind === 'unreads'">
        <div v-for="a in rows" :key="a.id" class="sf-line-row">
        <button type="button" class="sf-row unread"
                @click="emit('open', { channel: a.channel_id, thread: a.thread_root_id })">
          <SpaceAvatar :name="who(a, a.author_id)" :size="34" />
          <div class="sf-mid">
            <span class="sf-top"><b>{{ who(a, a.author_id) }}</b><i>{{ whereOf(a) }}</i><u>{{ when(a.created_at) }}</u></span>
            <p>{{ a.title ? a.title + ' — ' : '' }}{{ plainBody(a.body, names) }}</p>
          </div>
        </button>
        <button type="button" class="sf-read" :title="F['mark-read']" :aria-label="F['mark-read']" @click.stop="emit('read', a)">
          <SpaceIcon name="tick" :size="14" />
        </button>
        </div>
      </template>

      <!-- Later: what they kept -->
      <template v-else-if="kind === 'saved'">
        <div v-for="l in rows" :key="l.id" class="sf-row" :class="{ done: !!l.done_at }">
          <SpaceAvatar :name="who(l, l.author_id)" :size="34" />
          <button type="button" class="sf-mid sf-plain" @click="emit('open', { channel: l.channel_id, thread: l.thread_root_id })">
            <span class="sf-top"><b>{{ who(l, l.author_id) }}</b><i>{{ whereOf(l) }}</i><u>{{ when(l.created_at) }}</u></span>
            <p>{{ plainBody(l.body, names) }}</p>
          </button>
          <span class="sf-acts">
            <button type="button" :title="l.done_at ? F.undone : F.done" @click="emit('done', l)">✓</button>
            <button type="button" :title="F.unsave" @click="emit('unsave', l.id)">×</button>
          </span>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; these say what they want instead */
/* the global stylesheet gives a bare section 56px of padding, which inset this whole surface */
.sf { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; margin: 0; padding: 0; background: var(--paper) }
.sf-headin { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%;
  max-width: var(--sp-measure, 860px) }
.sf-head { display: flex; align-items: center; padding: 0 20px; height: 49px;
  border: 0; border-bottom: 1px solid var(--hair) }
.sf-readall { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink2); background: transparent;
  border: 1px solid var(--hair); border-radius: 7px; padding: 4px 11px; cursor: pointer; transition: border-color .14s ease, color .14s ease }
.sf-readall:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.sf-quiet { font-size: 12.5px; color: var(--ink3) }
.sf-line-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px }
.sf-line-row .sf-row { border-bottom: 0 }
.sf-line-row { border-bottom: 1px solid var(--hair) }
.sf-read { display: grid; place-items: center; width: 28px; height: 28px; flex: none; color: var(--ink3);
  background: transparent; border: 1px solid transparent; border-radius: 7px; cursor: pointer;
  opacity: 0; transition: opacity .14s ease, color .14s ease, border-color .14s ease }
.sf-line-row:hover .sf-read { opacity: 1 }
.sf-read:hover { color: var(--sp-go, #1b7f5a); border-color: color-mix(in srgb, var(--ink) 18%, transparent) }
.sf-head h2 { margin: 0; font-weight: 800; font-size: 17px; color: var(--ink) }
.sf-head:has(.sf-tabs) .sf-headin { align-self: stretch }
.sf-tabs { display: flex; align-self: stretch; gap: 6px }
.sf-tabs button { padding: 0 10px; border: 0; background: transparent; font: inherit; font-size: 15px; font-weight: 600; color: var(--ink3); cursor: pointer;
  transition: color .2s cubic-bezier(.2, .8, .2, 1) }
.sf-tabs button span { position: relative; display: flex; align-items: center; height: 100% }
.sf-tabs button:hover { color: var(--ink) }
.sf-tabs button.on { color: var(--ink); font-weight: 700 }
.sf-tabs button.on span::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; border-radius: 3px 3px 0 0; background: var(--accent);
  animation: sf-ink .35s cubic-bezier(.2, .8, .2, 1) }
@keyframes sf-ink { from { transform: scaleX(.2); opacity: 0 } }
@media (prefers-reduced-motion: reduce) { .sf-tabs button.on span::after { animation: none } }
/* These three lists own the whole surface now — no channel sidebar sits beside a view that is
   about the person rather than a space — so they keep a measure of their own: a one-line mention
   set across 1370px is a line nobody reads to the end of. */
.sf-body { overflow-y: auto; padding: 14px 20px 24px }
.sf-body > * { max-width: var(--sp-measure, 860px) }
.sf-body > .su-none { max-width: 620px }
.sf-drafts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px }
.sf-drafts li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center;
  background: var(--card); border: 1px solid var(--hair); border-radius: 12px; padding: 11px 13px }
.sf-draft { display: grid; gap: 3px; width: 100%; min-width: 0; text-align: left; font: inherit;
  background: transparent; border: 0; padding: 0; cursor: pointer }
.sf-draft-where { display: flex; align-items: center; gap: 6px; font-family: var(--m); font-size: 10.5px;
  letter-spacing: .03em; color: var(--ink3) }
.sf-draft-body { display: block; min-width: 0; font-size: 14px; color: var(--ink2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sf-draft-acts { display: flex; gap: 6px; flex: none }
.sf-draft-acts button { width: auto; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink3);
  background: transparent; border: 1px solid var(--hair); border-radius: 999px; padding: 5px 11px;
  cursor: pointer; white-space: nowrap }
.sf-draft-acts button:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.sf-card { margin-bottom: 14px }
.sf-where { display: flex; align-items: center; gap: 6px; padding: 0 0 5px; border: 0; color: var(--ink2) }
.sf-where b { font-size: 13.5px; font-weight: 700 }
.sf-where em { font-style: normal; font-size: 12px; color: var(--ink3) }
.sf-open { display: block; width: 100%; text-align: left; font: inherit; background: var(--card);
  border: 1px solid var(--hair); border-radius: 10px; padding: 10px 12px; cursor: pointer }
.sf-open:hover { border-color: color-mix(in srgb, var(--ink) 24%, transparent) }
.sf-line { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 9px; align-items: start }
.sf-line + .sf-line { margin-top: 8px }
.sf-line b { display: block; font-size: 14px; font-weight: 700; color: var(--ink) }
.sf-line p { margin: 1px 0 0; max-width: none; font-size: 14px; line-height: 1.45; color: var(--ink2);
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical }
.sf-reply { padding-left: 8px; border-left: 2px solid var(--hair) }
.sf-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: start; width: 100%;
  text-align: left; font: inherit; background: transparent; border: 0; border-bottom: 1px solid var(--hair);
  padding: 10px 6px; cursor: pointer }
.sf-row:hover { background: color-mix(in srgb, var(--ink) 3%, transparent) }
.sf-row.done { opacity: .5 }
.sf-mid { min-width: 0 }
.sf-plain { text-align: left; font: inherit; background: transparent; border: 0; padding: 0; cursor: pointer; width: 100% }
.sf-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px }
.sf-top b { font-size: 14.5px; font-weight: 700; color: var(--ink) }
.sf-top em, .sf-top i, .sf-top u { font-style: normal; text-decoration: none; font-size: 12px; color: var(--ink3) }
.sf-row p { margin: 2px 0 0; max-width: none; font-size: 14.5px; line-height: 1.45; color: var(--ink2) }
.sf-flag { align-self: center; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  color: #fff; background: var(--sp-badge); border-radius: 999px; padding: 2px 7px }
.sf-acts { display: flex; gap: 2px; align-self: center }
.sf-acts button { display: grid; place-items: center; width: 28px; height: 26px; font: inherit; font-size: 13px;
  color: var(--ink3); background: transparent; border: 1px solid transparent; border-radius: 6px; cursor: pointer }
.sf-acts button:hover { color: var(--ink); border-color: var(--hair) }
</style>

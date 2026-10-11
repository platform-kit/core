<script setup>
import site from '#site'
/*
 * ONE POST, wherever it is drawn — the timeline, somebody's page, a thread, a notification. A post
 * of the network, or a space's message shaped as one (model.js postOfMessage), drawn by the same
 * card so a reader's timeline reads as one thing.
 *
 * The card is a row: the face on the left, and beside it who, where it went, when, what was said,
 * the pictures, what it quotes, and the actions — each in the row it acts on, never floating over
 * the words. Who may READ it was decided by the database before it got here; what the card decides
 * is only what the reader may DO with it (their own may be deleted; anybody else's reported).
 * Words from network.md (post, audience).
 */
import { computed, ref, watch } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { ROUTES, navigate } from '@platform-kit/kit/lib/router.js'
import { user, isSignedIn } from '@platform-kit/kit/lib/auth.js'
import { net, like, repost, remove, likeMessage, loadPeople } from '@platform-kit/kit/lib/network/api.js'
import { mentionParts } from '@platform-kit/kit/lib/spaces/model.js'
import { segmentsOf, agoOf } from '@platform-kit/kit/lib/network/model.js'
import SpaceAvatar from '../spaces/SpaceAvatar.vue'
import NetAudience from './NetAudience.vue'
import NetMedia from './NetMedia.vue'
import { mediaUrls } from '@platform-kit/kit/lib/spaces/api.js'

const props = defineProps({
  post: { type: Object, required: true },
  /* who reposted it, where this is a repost in the timeline */
  repostedBy: { type: String, default: '' },
  /* in a thread: how far in, and whether this is the post the thread was opened on */
  depth: { type: Number, default: 0 },
  focus: { type: Boolean, default: false },
  /* drawn inside another post as what it quotes: no actions, no quote of its own */
  quoted: { type: Boolean, default: false },
})
const emit = defineEmits(['reply', 'report', 'removed'])

const P = computed(() => us('network').post.main)
const S = computed(() => us('network').shell.main)
const T = computed(() => us('network').timeline.main)
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))

const live = computed(() => (props.post.kind === 'space' ? net.messages[props.post.id] || props.post : net.posts[props.post.id] || props.post))
const author = computed(() => net.people[live.value.author_id] || null)
const nameOf = (p) => (p && (p.name || p.username)) || P.value.someone
const pageOf = (p) => (p && p.page && p.username ? ROUTES.people + '/' + p.username : '')
const reposter = computed(() => (props.repostedBy ? net.people[props.repostedBy] : null))
const parent = computed(() => (live.value.reply_parent_id ? net.posts[live.value.reply_parent_id] : null))
const quote = computed(() => (!props.quoted && live.value.quote_id ? net.posts[live.value.quote_id] : null))
const FEDERATES = !!(site.network && site.network.federate)
const mine = computed(() => !!user.value && live.value.author_id === user.value.id)
/* the audience is said only when it is narrower than where the post is read: on a site that does
   not federate "People here" is the default; on one that does, Everyone is */
const narrower = computed(() => (FEDERATES ? live.value.audience !== 'everyone' : !['everyone', 'here'].includes(live.value.audience)))
/* A SPACE'S POST names people as tokens (<@id>): read here as the room reads them, the name in the
   accent, and every other run of words with its links */
const segs = computed(() => {
  if (live.value.kind !== 'space') return segmentsOf(live.value.text)
  const names = Object.fromEntries(Object.entries(net.people).map(([k, v]) => [k, v.name || v.username]))
  const words = { someone: P.value.someone, channel: us('spaces').page.main['channel-word'] }
  return mentionParts(live.value.text, names, words).flatMap((m) => (m.kind === 'mention' ? [{ kind: 'mention', text: '@' + m.name }] : segmentsOf(m.text)))
})
watch(() => live.value.kind === 'space' && live.value.text, (t) => {
  if (!t) return
  const ids = [...String(t).matchAll(/<@([0-9a-fA-F-]{36})>/g)].map((m) => m[1])
  if (ids.length) loadPeople(ids).catch(() => {})
}, { immediate: true })
/* a network post's media, or a space post's own (a feed post may carry it too) */
const media = computed(() => live.value.media || [])
const threadHref = computed(() => (live.value.kind === 'space'
  ? ROUTES.spaces + '/' + (live.value.space ? live.value.space.slug + '/' + (live.value.space.channel || '') : '')
  : ROUTES.feed + '/post/' + live.value.id))
const when = computed(() => agoOf(live.value.created_at))
const whenFull = computed(() => { try { return new Date(live.value.created_at).toLocaleString() } catch { return '' } })

const busy = ref(false)
const err = ref('')
const needSignIn = () => { if (window.DLauth) window.DLauth.open() }
async function toggle(which) {
  if (!isSignedIn.value) return needSignIn()
  if (busy.value) return
  if (live.value.kind === 'space' && which !== 'like') return
  busy.value = true; err.value = ''
  try {
    if (live.value.kind === 'space') await likeMessage(live.value, !live.value.liked)
    else if (which === 'like') await like(live.value.id, !live.value.liked)
    else await repost(live.value.id, !live.value.reposted)
  } catch (e) { err.value = e.message || String(e) } finally { busy.value = false }
}

/* the reader's own post may be deleted; anybody else's may be reported. The menu sits in the
   actions row, beside the actions, and closes on any press outside it. */
const menu = ref(false)
function closeMenu(e) { if (!e.target.closest || !e.target.closest('.np-menu')) { menu.value = false; document.removeEventListener('click', closeMenu, true) } }
function openMenu() { menu.value = !menu.value; if (menu.value) setTimeout(() => document.addEventListener('click', closeMenu, true)) }
async function drop() {
  menu.value = false
  if (!window.confirm(P.value['delete-confirm'])) return
  try { await remove(live.value.id); emit('removed', live.value.id) } catch (e) { err.value = e.message || String(e) }
}
/* SHARE: the post's address, copied — said on the button for a moment */
const copied = ref(false)
async function share() {
  const url = window.location.origin + threadHref.value
  try { await navigator.clipboard.writeText(url); copied.value = true; setTimeout(() => { copied.value = false }, 1600) } catch { window.prompt(S.value.share, url) }
}
function reportIt() { menu.value = false; if (!isSignedIn.value) return needSignIn(); emit('report', live.value) }
function open(e) {
  /* a press on the card opens the thread — but not one on a link, a button or a picture */
  if (props.quoted || props.focus) return
  if (e.target.closest('a, button, img, input, textarea')) return
  if (live.value.kind === 'space') { window.location.href = threadHref.value; return }
  navigate(threadHref.value)
}
</script>

<template>
  <article class="np" :class="{ 'np-quoted': quoted, 'np-focus': focus, 'np-removed': live.removed_at, 'np-up': menu }"
    :style="depth ? { '--np-depth': depth } : null" @click="open">
    <p v-if="reposter" class="np-reason">
      <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V6.5A2.5 2.5 0 0 1 6.5 4H15l-2.5-2.5M16 12v1.5a2.5 2.5 0 0 1-2.5 2.5H5l2.5 2.5" /></svg>
      {{ fill(T.reposted, { name: nameOf(reposter) }) }}
    </p>
    <div class="np-row">
      <a v-if="pageOf(author)" :href="pageOf(author)" class="np-face"><SpaceAvatar :person="author" :name="nameOf(author)" :size="quoted ? 22 : 44" /></a>
      <span v-else class="np-face"><SpaceAvatar :person="author" :name="nameOf(author)" :size="quoted ? 22 : 44" /></span>
      <div class="np-body">
        <div class="np-head">
          <a v-if="pageOf(author)" :href="pageOf(author)" class="np-name">{{ nameOf(author) }}</a>
          <b v-else class="np-name">{{ nameOf(author) }}</b>
          <span v-if="author && author.username" class="np-handle">@{{ author.username }}</span>
          <span class="np-dot" aria-hidden="true">·</span>
          <a class="np-when" :href="threadHref" :title="whenFull">{{ when }}</a>
          <NetAudience v-if="narrower" :post="live" />
        </div>
        <p v-if="parent && !depth && !quoted" class="np-to">{{ fill(P['replying-to'], { name: nameOf(net.people[parent.author_id]) }) }}</p>
        <p v-if="live.removed_at" class="np-flag">{{ P.removed }}</p>
        <div v-if="live.title" class="np-title">{{ live.title }}</div>
        <p v-if="segs.length" class="np-text"><template v-for="(s, i) in segs" :key="i"><a v-if="s.kind === 'link'" :href="s.href" target="_blank" rel="noopener nofollow ugc">{{ s.text }}</a><b v-else-if="s.kind === 'mention'" class="np-at">{{ s.text }}</b><template v-else>{{ s.text }}</template></template></p>
        <NetMedia v-if="media.length && !quoted" :media="media" :urls="live.kind === 'space' ? mediaUrls : null" />
        <div v-if="quote" class="np-quote"><NetPost :post="quote" quoted /></div>
        <div v-else-if="live.quote_id && !quoted" class="np-quote np-gone">{{ P.gone }}</div>

        <!-- THE BAR: Comment and Like, with their counts; everything else under "…". Outside the network's
             write grant there is nothing to press: the join card above the timeline says how in -->
        <div v-if="!quoted && (net.access.write || live.kind === 'space')" class="np-acts">
          <button type="button" class="np-act" :title="P.reply" :aria-label="P.reply" @click.stop="live.kind === 'space' ? open($event) : (isSignedIn ? emit('reply', live) : needSignIn())">
            <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 5.5A2 2 0 0 1 5.5 3.5h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8.5L4.5 17v-3.5h1a2 2 0 0 1-2-2z" /></svg>
            <span v-if="live.reply_count">{{ live.reply_count }}</span>
          </button>
          <button type="button" class="np-act np-like" :class="{ on: live.liked }" :disabled="busy" :title="live.liked ? P.liked : P.like" :aria-pressed="!!live.liked" @click.stop="toggle('like')">
            <svg viewBox="0 0 20 20" width="17" height="17" :fill="live.liked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M10 16.5s-6.5-3.8-6.5-8.3A3.6 3.6 0 0 1 10 6a3.6 3.6 0 0 1 6.5 2.2c0 4.5-6.5 8.3-6.5 8.3z" /></svg>
            <span v-if="live.like_count">{{ live.like_count }}</span>
          </button>
          <span v-if="live.kind !== 'space' && live.repost_count" class="np-count" :class="{ on: live.reposted }">
            <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V6.5A2.5 2.5 0 0 1 6.5 4H15l-2.5-2.5M16 12v1.5a2.5 2.5 0 0 1-2.5 2.5H5l2.5 2.5" /></svg>{{ live.repost_count }}
          </span>
          <span class="np-menu">
            <button type="button" class="np-act" :title="P.more" :aria-label="P.more" :aria-expanded="menu" @click.stop="openMenu">
              <svg viewBox="0 0 20 20" width="17" height="17" fill="currentColor" aria-hidden="true"><circle cx="5" cy="10" r="1.4" /><circle cx="10" cy="10" r="1.4" /><circle cx="15" cy="10" r="1.4" /></svg>
            </button>
            <span v-if="menu" class="np-pop" role="menu">
              <button v-if="live.kind !== 'space'" type="button" role="menuitem" :disabled="busy" @click.stop="menu = false; toggle('repost')">{{ live.reposted ? P.reposted : P.repost }}</button>
              <button type="button" role="menuitem" @click.stop="menu = false; share()">{{ copied ? S.copied : S.share }}</button>
              <a v-if="live.kind === 'space' && live.space" role="menuitem" class="np-pop-a" :href="threadHref" @click.stop>{{ fill(T['in-space'], { space: live.space.name }) }}</a>
              <button v-if="mine && live.kind !== 'space'" type="button" role="menuitem" class="np-pop-warn" @click.stop="drop">{{ P.delete }}</button>
              <button v-else-if="!mine && live.kind !== 'space'" type="button" role="menuitem" @click.stop="reportIt">{{ P.report }}</button>
            </span>
          </span>
          <em v-if="err" class="np-err">{{ err }}</em>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.np { padding: 12px 16px 6px calc(16px + (var(--np-depth, 0) * 28px)); border-bottom: 1px solid var(--hair); cursor: pointer;
  transition: background .2s cubic-bezier(.2, .8, .2, 1) }
.np:hover { background: color-mix(in srgb, var(--ink) 2.5%, transparent) }
/* AN ANSWER HANGS FROM WHAT IT ANSWERS: a line from its face up to the parent's, so depth is drawn
   rather than implied by an indent alone */
.np[style*="--np-depth"] { position: relative }
.np[style*="--np-depth"]::before { content: ''; position: absolute; top: 0; bottom: 0;
  left: calc(18px + (var(--np-depth) - 1) * 28px + 19px);
  border-left: 2px solid color-mix(in srgb, var(--ink) 16%, transparent) }
.np-focus { cursor: default; background: transparent !important }
.np-focus .np-text { font-size: 17px }
.np-removed { opacity: .72 }
.np-quoted { padding: 10px 12px; border: 1px solid var(--hair); border-radius: 12px; cursor: default }
.np-quoted:hover { background: transparent }
.np-reason { max-width: none; display: flex; align-items: center; gap: 6px; margin: 0 0 6px 50px; font-size: 12.5px; font-weight: 600; color: var(--ink3) }
.np-row { display: flex; gap: 12px; align-items: flex-start }
.np-face { flex: none; display: block; line-height: 0; text-decoration: none }
.np-body { flex: 1 1 auto; min-width: 0 }
.np-head { display: flex; align-items: baseline; flex-wrap: nowrap; gap: 4px; line-height: 1.3; min-width: 0; white-space: nowrap }
.np-dot { color: var(--ink3) }
.np-name { font-size: 15px; font-weight: 700; color: var(--ink); text-decoration: none; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 0 }
a.np-name:hover { text-decoration: underline }
.np-handle { font-size: 15px; color: var(--ink3); overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 0 }
.np-when { font-size: 15px; color: var(--ink3); text-decoration: none; white-space: nowrap; flex: none }
.np-head :deep(.na) { margin-left: auto }
.np-when:hover { text-decoration: underline }
.np-to, .np-flag { max-width: none; margin: 2px 0 0; font-size: 13px; color: var(--ink3) }
.np-flag { font-weight: 600; color: var(--ink2) }
.np-title { margin: 6px 0 0; font-family: var(--fd); font-size: 17px; font-weight: 700; color: var(--ink) }
.np-text { max-width: none; margin: 2px 0 0; font-size: 15.5px; line-height: 1.5; color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere }
.np-text a { color: var(--accent); text-decoration: none }
.np-at { font-weight: 600; color: var(--accent) }
.np-text a:hover { text-decoration: underline }
.np-quoted .np-text { font-size: 14px }

/* one picture keeps its own shape, no taller than a screen's worth */
.np-quote { margin-top: 10px }
.np-gone { padding: 10px 12px; border: 1px dashed var(--hair); border-radius: 12px; font-size: 13px; color: var(--ink3) }

.np-acts { display: flex; align-items: center; gap: 4px; margin: 6px 0 0 -8px; position: relative }
.np-acts .np-menu { margin-left: auto }
/* a post whose menu is open stands above the posts after it */
.np.np-up { position: relative; z-index: 30 }
.np-count { display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; font-size: 13px; color: var(--ink3) }
.np-count.on { color: #17a46b }
.np-pop-a { display: block; padding: 9px 12px; border-radius: 8px; font-size: 14px; color: var(--ink); text-decoration: none }
.np-pop-a:hover { background: color-mix(in srgb, var(--ink) 6%, transparent) }
.np-act { display: inline-flex; align-items: center; gap: 5px; min-width: 52px; padding: 6px 8px; border: 0; border-radius: 999px;
  background: transparent; color: var(--ink3); font: inherit; font-size: 13px; cursor: pointer }
.np-act { transition: color .15s, background .15s }
.np-act:hover { color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent) }
.np-act.np-rp:hover, .np-act.np-rp.on { color: #17a46b }
.np-act.np-rp:hover { background: rgba(23, 164, 107, .1) }
.np-like:hover, .np-like.on { color: #e0245e }
.np-like:hover { background: rgba(224, 36, 94, .1) }
.np-share.on { color: #17a46b }
.np-gap { visibility: hidden; pointer-events: none }
.np-open { text-decoration: none }
.np-like.on svg { animation: np-pop .35s cubic-bezier(.2, .8, .2, 1) }
@keyframes np-pop { 40% { transform: scale(1.3) } }
.np-act:disabled { cursor: default }
.np-menu { position: relative; order: 9 }
/* a post to Everyone is the ordinary case and says nothing; a narrower one says so */
.np-head :deep(.na-everyone) { display: none }
/* the name comes first; on a narrow screen the badge says who with its icon alone (its title says it in words) */
.np-name { flex-shrink: 0; max-width: 62% }
.np-head :deep(.na) { flex-shrink: 1; min-width: 0; overflow: hidden }
@media (max-width: 560px) { .np-head :deep(.na span) { display: none } .np-head :deep(.na) { padding: 3px 5px } }
.np-menu .np-act { min-width: 0 }
.np-pop { position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; display: flex; flex-direction: column; min-width: 180px;
  padding: 6px; border: 1px solid var(--hair); border-radius: 12px; background: var(--paper);
  box-shadow: 0 12px 32px -12px rgba(0, 0, 0, .28) }
.np-pop button { text-align: left; padding: 9px 12px; border: 0; border-radius: 8px; background: transparent; font: inherit; font-size: 14px; color: var(--ink); cursor: pointer }
.np-pop button:hover { background: color-mix(in srgb, var(--ink) 6%, transparent) }
.np-pop-warn { color: #c8382f !important }
.np-space { margin-left: auto; font-size: 13px; font-weight: 600; color: var(--ink2); text-decoration: none }
.np-space:hover { text-decoration: underline }
.np-err { font-style: normal; font-size: 12.5px; color: #c8382f }
@media (max-width: 560px) {
  .np { padding-left: calc(14px + (var(--np-depth, 0) * 16px)); padding-right: 14px }
  .np[style*="--np-depth"]::before { left: calc(14px + (var(--np-depth) - 1) * 16px + 7px) }
}
@media (prefers-reduced-motion: reduce) { .np, .np-act { transition: none } .np-like.on svg { animation: none } }
</style>

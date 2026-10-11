<script setup>
/*
 * UNDER A POST IN A SPACE'S FEED — the bar every group feed has: Like (a heart, said as a reaction
 * like any other, so the chat and the forum count it too), Comment (into the post's thread), and
 * Share (the post's address, copied); and under the first answers, "Write a comment…", which opens
 * the thread with its box. The post itself is drawn by SpaceLine; this is only what is done with it.
 * Words from spaces.md (channel: feed-*).
 */
import { computed, ref } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { myFace } from '@platform-kit/kit/lib/auth.js'
import SpaceAvatar from './SpaceAvatar.vue'

const LIKE = '❤️'
const props = defineProps({
  message: { type: Object, required: true },
  reactions: { type: Array, default: () => [] },
  mayReact: { type: Boolean, default: true },
  mayWrite: { type: Boolean, default: true },
  /* where the comment box goes: under the answers, so it is said after what it answers */
  part: { type: String, default: 'bar' },
  /* under a message's words rather than its face: past the 36px face and the 10px beside it */
  indent: { type: Boolean, default: false },
})
const emit = defineEmits(['react', 'comment'])
const W = computed(() => us('spaces').channel.main)
const like = computed(() => props.reactions.find((r) => r.emoji === LIKE) || null)
const liked = computed(() => !!(like.value && like.value.mine))
const likes = computed(() => (like.value ? like.value.users.length : 0))
const comments = computed(() => props.message.reply_count || 0)
const copied = ref(false)
async function share() {
  const url = window.location.origin + window.location.pathname + '?post=' + encodeURIComponent(props.message.id)
  try { await navigator.clipboard.writeText(url); copied.value = true; setTimeout(() => { copied.value = false }, 1600) } catch { window.prompt(W.value['feed-share'], url) }
}
</script>

<template>
  <!-- THE SAME BAR A NETWORK POST WEARS (NetPost): comment, the repost place left empty — a space's post is
       not reposted — like and share, each an icon with its count, coloured as it is pressed -->
  <div v-if="part === 'bar'" class="sfa" :class="{ 'sfa-indent': indent }">
    <button type="button" class="sfa-b" :title="W['feed-comment']" :aria-label="W['feed-comment']" @click="emit('comment')">
      <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 5.5A2 2 0 0 1 5.5 3.5h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8.5L4.5 17v-3.5h1a2 2 0 0 1-2-2z" /></svg>
      <em v-if="comments">{{ comments }}</em>
    </button>
    <span class="sfa-b sfa-gap" aria-hidden="true"></span>
    <button type="button" class="sfa-b sfa-like" :class="{ on: liked }" :disabled="!mayReact" :title="W['feed-like']" :aria-label="W['feed-like']" :aria-pressed="liked" @click="emit('react', LIKE)">
      <svg viewBox="0 0 20 20" width="16" height="16" :fill="liked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M10 16.5s-6.5-3.8-6.5-8.3A3.6 3.6 0 0 1 10 6a3.6 3.6 0 0 1 6.5 2.2c0 4.5-6.5 8.3-6.5 8.3z" /></svg>
      <em v-if="likes">{{ likes }}</em>
    </button>
    <button type="button" class="sfa-b sfa-share" :class="{ done: copied }" :title="copied ? W['feed-copied'] : W['feed-share']" :aria-label="W['feed-share']" @click="share">
      <svg v-if="!copied" viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 12.5V3M6 6.5 10 2.5l4 4M4 11v4.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V11" /></svg>
      <svg v-else viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 10.5 3.5 3.5 7.5-8" /></svg>
    </button>
    <span class="sfa-b sfa-gap" aria-hidden="true"></span>
  </div>
  <button v-else-if="mayWrite" type="button" class="sfa-write" @click="emit('comment')">
    <SpaceAvatar :person="myFace || null" :size="30" />
    <span class="sfa-ph">{{ W['feed-write-comment'] }}</span>
  </button>
</template>

<style scoped>
.sfa { display: flex; align-items: center; justify-content: space-between; max-width: 440px; margin: 8px 0 0 -8px }
.sfa-b { display: inline-flex; align-items: center; gap: 5px; min-width: 52px; padding: 6px 8px; border: 0; border-radius: 999px;
  background: transparent; color: var(--ink3); font: inherit; font-size: 13px; cursor: pointer;
  transition: background .15s cubic-bezier(.2, .8, .2, 1), color .15s cubic-bezier(.2, .8, .2, 1) }
.sfa-b em { font-style: normal; font-variant-numeric: tabular-nums }
.sfa-b:hover { color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent) }
.sfa-like:hover, .sfa-like.on { color: #e0245e }
.sfa-like:hover { background: rgba(224, 36, 94, .1) }
.sfa-like.on svg { animation: sfa-pop .35s cubic-bezier(.2, .8, .2, 1) }
@keyframes sfa-pop { 40% { transform: scale(1.3) } }
.sfa-b.done { color: #17a46b }
.sfa-b:disabled { opacity: .5; cursor: default }
.sfa-gap { visibility: hidden; pointer-events: none }
.sfa-indent { margin-left: 38px }
.sfa-write { display: flex; align-items: center; gap: 10px; width: 100%; margin-top: 10px; padding: 0; border: 0; background: transparent; cursor: text; font: inherit }
.sfa-write > :first-child { flex: none; width: 30px; height: 30px }
.sfa-write span.sfa-ph { flex: 1; text-align: left; padding: 9px 14px; border-radius: 999px; background: color-mix(in srgb, var(--ink) 5%, var(--paper));
  font-size: 14px; color: var(--ink3) }
.sfa-write:hover span.sfa-ph { background: color-mix(in srgb, var(--ink) 8%, var(--paper)) }
@media (prefers-reduced-motion: reduce) { .sfa-b { transition: none } .sfa-like.on svg { animation: none } }
</style>

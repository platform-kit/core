<script setup>
/*
 * THE COMMENT THREAD ON ITS OWN PAGE, FOR AN IFRAME: /embed/comments?kind=&subject=&title=&url=
 *
 * WHY AN IFRAME AND NOT A SCRIPT. A script drawn into somebody else's page runs on THEIR origin,
 * and a reader's session lives in ours — so inside a script embed everybody is a guest, and a guest
 * may not comment. The thread could be read and never joined, which is half a comment system. An
 * iframe is a page of ours: the session is ours to read, the sign-in is ours to offer, and every
 * policy behaves exactly as it does on the site. Nothing here is a second implementation — it is
 * the same CommentThread the site draws, with the chrome taken off.
 *
 * (A browser partitions storage by the top-level site, so signing in here signs somebody in for
 * THIS embedding site and no other. That is the right behaviour and not a workaround: a reader who
 * signs in under one publisher's article has not signed in everywhere the embed appears.)
 *
 * WHAT THE PAGE DECLARES, in the query rather than a config function, because a URL is the whole of
 * what an iframe can be told:
 *
 *   kind      which kind of thing this is; the site must have declared it open
 *   subject   its SLUG, and so the thread's identity — two pages with the same one are one
 *             conversation, and a page that changes address keeps its comments
 *   title     what a person reads, in the board and in the desk's queue
 *   url       where the page actually is, kept as the way back
 *
 * THE WHITELIST. Where the site's policy names domains, this refuses to draw anywhere else and says
 * so in words. The real fence is the `frame-ancestors` header the host serves (the docs say how);
 * this is the part that gives a readable answer rather than a blank refusal, and the part a site
 * can change without a deploy. Neither is a secret: somebody determined can always comment by
 * visiting the site itself, and what a whitelist prevents is the site's comments appearing under
 * pages it did not agree to.
 *
 * Words: '## embed' in the comments scope.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { supabase, configured } from '@platform-kit/kit/lib/supabase.js'
import { setHead } from '@platform-kit/kit/lib/seo.js'
import { embedAllowed } from '@platform-kit/kit/lib/comments/model.js'
import CommentThread from '../components/content/CommentThread.vue'

const props = defineProps({ path: { type: String, default: '' } })
const W = computed(() => (us('comments').embed || {}).main || {})

const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)
const kind = (q.get('kind') || 'page').trim()
const subject = (q.get('subject') || q.get('identifier') || '').trim()
const title = (q.get('title') || '').trim()
const url = (q.get('url') || '').trim()

/* THE TOP-LEVEL SITE THIS IS DRAWN IN. ancestorOrigins is the plain answer where a browser has it;
   the referrer is what the others send, and it is the embedding page for an iframe's own request.
   Not drawn in a frame at all — somebody opening the address directly — is the site itself. */
function ancestor() {
  try {
    if (window.top === window.self) return location.origin
    const list = location.ancestorOrigins
    if (list && list.length) return list[list.length - 1]
    if (document.referrer) return new URL(document.referrer).origin
  } catch (e) { /* a cross-origin read that is refused tells us nothing, which is 'unknown' */ }
  return ''
}

const state = ref('reading')   /* reading | ok | refused | nothing */
onMounted(async () => {
  setHead({ title: title || 'Comments', path: props.path || '/embed/comments', noindex: true })
  /* the host's page shows through: the site's own ground inside a frame on somebody's white blog
     reads as a grey box they forgot to style. The words and the rules are ours; the paper is theirs. */
  document.documentElement.setAttribute('data-embed', '')
  if (!subject) { state.value = 'nothing'; return }
  let domains = []
  if (configured) {
    const { data } = await supabase.rpc('comment_domains')
    domains = Array.isArray(data) ? data : []
  }
  state.value = embedAllowed(ancestor(), domains, location.origin) ? 'ok' : 'refused'
  tell()
})

/* HOW TALL IT IS, said to whoever framed it. An iframe cannot size itself, so the page that holds
   it is told on every change and sizes it — otherwise every thread is a scrollbar inside a box.
 *
 * AND AN OVERLAY IS PART OF THE HEIGHT. The sign-in modal is fixed, so it adds nothing to the
 * document's own height, and in a frame two hundred pixels tall it would open mostly off the
 * bottom — a sign-in nobody can reach, which is the one thing this frame exists to offer. So
 * whatever is over the page is measured too, and the frame grows while it is there. */
let ro = null, mo = null
const root = ref(null)
function tell() {
  if (typeof ResizeObserver === 'undefined' || !root.value) return
  const say = () => {
    let h = Math.ceil(root.value.getBoundingClientRect().height) + 8
    /* anything the shell has put over the page: the sign-in, a toast */
    for (const el of document.querySelectorAll('.au-card, .au-veil')) {
      const r = el.getBoundingClientRect()
      if (r.height) h = Math.max(h, Math.ceil(r.height) + 48)
    }
    try { window.parent.postMessage({ platformkitComments: true, height: h }, '*') } catch (e) { /* framed by nobody */ }
  }
  ro = new ResizeObserver(say)
  ro.observe(root.value)
  /* the overlay is not inside root, so its arrival is watched for rather than observed */
  mo = new MutationObserver(say)
  mo.observe(document.body, { childList: true, subtree: true })
  say()
}
onBeforeUnmount(() => { if (ro) ro.disconnect(); if (mo) mo.disconnect() })
</script>

<template>
  <div ref="root" class="cme">
    <p v-if="state === 'reading'" class="cme-quiet">…</p>
    <p v-else-if="state === 'nothing'" class="cme-quiet">{{ W.nothing }}</p>
    <p v-else-if="state === 'refused'" class="cme-quiet">{{ W.refused }}</p>
    <!-- the site's own thread, with the chrome off and the indent stopped at one: a narrow column
         on somebody else's page, so one flat run with each reply naming who it answers -->
    <CommentThread v-else :kind="kind" :subject="subject" :title="title" :href="url" :depth="1" bare />
  </div>
</template>

<style>
/* not scoped: the ground belongs to the document, and the document is the frame */
html[data-embed], html[data-embed] body, html[data-embed] #app { background: transparent !important }
html[data-embed] body { margin: 0 }
</style>

<style scoped>
/* the frame is the page: no margin of its own, and the host sizes it from the height we send */
.cme { padding: 0 2px 2px; background: transparent }
.cme :deep(.cmt) { margin: 0 }
.cme-quiet { margin: 10px 2px; font-size: 13.5px; color: var(--ink3) }
</style>

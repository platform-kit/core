<script setup>
/*
 * FOR YOU (community.forYou) — Explore as Instagram keeps it: a grid of the posts with pictures or
 * video the reader may read, ranked by what people did with them and who the reader is close to
 * (network_for_you), never more than two from one person in any six (spread). Square tiles, a video
 * two tiles tall, a mark on a carousel and on a video, its likes and comments over a wash on hover.
 * A tile opens the post: its media large on the left and the post with its conversation on the
 * right on a wide screen, one above the other on a phone; arrows and the keys step between tiles,
 * Escape closes. Words from network.md (foryou).
 */
import { computed, ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { ROUTES, navigate } from 'platformkit/lib/router.js'
import { net, forYou } from 'platformkit/lib/network/api.js'
import { mediaUrls } from 'platformkit/lib/spaces/api.js'
import { kindOf } from 'platformkit/lib/network/model.js'
import NetMedia from './NetMedia.vue'
import NetPost from './NetPost.vue'

const F = computed(() => us('network').foryou.main)
const items = ref([])
const busy = ref(false)
const done = ref(false)
const failed = ref(false)

async function more() {
  if (busy.value || done.value) return
  busy.value = true
  try {
    const page = await forYou(items.value.length)
    const have = new Set(items.value.map((x) => x.id))
    items.value = items.value.concat(page.items.filter((x) => !have.has(x.id)))
    done.value = page.done
  } catch { failed.value = true } finally { busy.value = false }
}

/* what a tile shows: the first item's picture, or a video's poster */
const urlsOf = (it) => (it.kind === 'space' ? mediaUrls : net.images)
function coverOf(it) {
  const m = (it.post.media || [])[0] || {}
  const at = urlsOf(it)
  return kindOf(m) === 'video' ? (m.poster ? at[m.poster] : '') : at[m.path] || ''
}
const isVideo = (it) => kindOf((it.post.media || [])[0] || {}) === 'video'
const isMany = (it) => (it.post.media || []).length > 1
const likes = (it) => (it.post.like_count || 0)
const replies = (it) => (it.post.reply_count || 0)

/* the viewer */
const open = ref(-1)
const current = computed(() => (open.value >= 0 ? items.value[open.value] : null))
function show(i) { open.value = i; document.documentElement.style.overflow = 'hidden' }
function close() { open.value = -1; document.documentElement.style.overflow = '' }
function step(d) { const n = open.value + d; if (n >= 0 && n < items.value.length) open.value = n }
function onKey(e) {
  if (open.value < 0) return
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowRight') step(1)
  else if (e.key === 'ArrowLeft') step(-1)
}
const threadOf = (it) => (it.kind === 'space' ? '' : ROUTES.feed + '/post/' + it.id)

/* more as the foot of the grid comes into view */
const foot = ref(null)
let io = null
onMounted(async () => {
  window.addEventListener('keydown', onKey)
  await more()
  await nextTick()
  if (foot.value && typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) more() }, { rootMargin: '600px' })
    io.observe(foot.value)
  }
})
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); if (io) io.disconnect(); document.documentElement.style.overflow = '' })
</script>

<template>
  <div class="fy">
    <div v-if="items.length" class="fy-grid">
      <button v-for="(it, i) in items" :key="it.kind + it.id" type="button" class="fy-tile" :class="{ tall: isVideo(it) }"
        :style="{ '--d': Math.min(i, 12) * 0.03 + 's' }" :aria-label="(it.post.text || '').slice(0, 80) || F.open" @click="show(i)">
        <img v-if="coverOf(it)" :src="coverOf(it)" alt="" loading="lazy" />
        <span v-else class="fy-wait" aria-hidden="true"></span>
        <span v-if="isMany(it)" class="fy-mark" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor"><path d="M6 3h9a2 2 0 0 1 2 2v9a1 1 0 0 1-2 0V5H6a1 1 0 0 1 0-2zM3 7a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
        </span>
        <span v-else-if="isVideo(it)" class="fy-mark" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor"><path d="M6 4.5v11l9-5.5z" /></svg>
        </span>
        <span class="fy-wash" aria-hidden="true">
          <span><svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor"><path d="M10 16.5s-6.5-3.8-6.5-8.3A3.6 3.6 0 0 1 10 6a3.6 3.6 0 0 1 6.5 2.2c0 4.5-6.5 8.3-6.5 8.3z" /></svg>{{ likes(it) }}</span>
          <span><svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor"><path d="M3.5 5.5A2 2 0 0 1 5.5 3.5h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8.5L4.5 17v-3.5h1a2 2 0 0 1-2-2z" /></svg>{{ replies(it) }}</span>
        </span>
      </button>
    </div>
    <div v-else-if="busy" class="fy-grid fy-skel" aria-hidden="true">
      <span v-for="i in 9" :key="i" class="fy-tile" :style="{ '--d': i * 0.04 + 's' }"></span>
    </div>
    <div v-else class="fy-empty">
      <span class="fy-empty-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg></span>
      <h2>{{ failed ? F.error : F.empty }}</h2>
      <p v-if="!failed">{{ F['empty-line'] }}</p>
    </div>
    <span ref="foot" class="fy-foot" aria-hidden="true"></span>

    <!-- THE VIEWER -->
    <Teleport to="body">
      <Transition name="fy-v">
        <div v-if="current" class="fy-veil" role="dialog" aria-modal="true" :aria-label="F.open" @click.self="close">
          <button type="button" class="fy-x" :aria-label="F.close" @click="close">
            <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" /></svg>
          </button>
          <button v-if="open > 0" type="button" class="fy-step fy-prev" :aria-label="F.prev" @click="step(-1)">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" /></svg>
          </button>
          <button v-if="open < items.length - 1" type="button" class="fy-step fy-next" :aria-label="F.next" @click="step(1)">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5" /></svg>
          </button>
          <div :key="current.kind + current.id" class="fy-box">
            <div class="fy-media"><NetMedia :media="current.post.media" :urls="current.kind === 'space' ? mediaUrls : null" full /></div>
            <aside class="fy-side">
              <NetPost :post="current.post" focus />
              <a v-if="threadOf(current)" class="fy-thread" :href="threadOf(current)" @click.prevent="close(); navigate(threadOf(current))">{{ F.thread }}</a>
            </aside>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.fy { --e: cubic-bezier(.2, .8, .2, 1); padding: 2px 0 24px }
.fy-grid { display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 1fr; grid-auto-flow: dense; gap: 3px }
.fy-tile { position: relative; display: block; padding: 0; border: 0; aspect-ratio: 1; overflow: hidden; cursor: pointer;
  background: color-mix(in srgb, var(--ink) 6%, var(--paper)); animation: fy-in .45s var(--e) both; animation-delay: var(--d) }
.fy-tile.tall { grid-row: span 2; aspect-ratio: auto }
.fy-tile img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform .5s var(--e) }
.fy-tile:hover img { transform: scale(1.03) }
.fy-tile:focus-visible { outline: 3px solid var(--accent); outline-offset: -3px }
.fy-mark { position: absolute; top: 8px; right: 8px; color: #fff; filter: drop-shadow(0 1px 3px rgba(0, 0, 0, .5)) }
.fy-wash { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 22px; color: #fff; font-size: 16px; font-weight: 700;
  background: rgba(0, 0, 0, .38); opacity: 0; transition: opacity .2s var(--e) }
.fy-wash span { display: inline-flex; align-items: center; gap: 7px }
.fy-tile:hover .fy-wash, .fy-tile:focus-visible .fy-wash { opacity: 1 }
@media (hover: none) { .fy-wash { display: none } }
.fy-wait, .fy-skel .fy-tile { display: block; width: 100%; height: 100%;
  background: linear-gradient(90deg, color-mix(in srgb, var(--ink) 6%, transparent), color-mix(in srgb, var(--ink) 11%, transparent), color-mix(in srgb, var(--ink) 6%, transparent));
  background-size: 300% 100%; animation: fy-shimmer 1.4s ease-in-out infinite }
@keyframes fy-shimmer { from { background-position: 100% 0 } to { background-position: -100% 0 } }
@keyframes fy-in { from { opacity: 0; transform: scale(.98) } }
.fy-foot { display: block; height: 1px }
.fy-empty { display: grid; justify-items: center; gap: 10px; padding: 64px 20px; text-align: center }
.fy-empty h2 { margin: 0; font-family: var(--fd); font-size: 21px; font-weight: 800; color: var(--ink) }
.fy-empty p { margin: 0; max-width: 40ch; font-size: 15px; line-height: 1.55; color: var(--ink2) }
.fy-empty-ic { display: grid; place-items: center; width: 64px; height: 64px; margin-bottom: 4px; border-radius: 20px; color: var(--accent);
  background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 16%, var(--paper)), color-mix(in srgb, var(--accent) 5%, var(--paper)));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent) }

/* the viewer: the media on black, the post beside it */
.fy-veil { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 40px 72px; background: rgba(8, 8, 12, .82); backdrop-filter: blur(6px) }
.fy-box { display: grid; grid-template-columns: minmax(0, 1fr) 400px; width: min(1180px, 100%); max-height: calc(100vh - 80px); border-radius: 16px; overflow: hidden;
  background: var(--paper); box-shadow: 0 40px 100px -30px rgba(0, 0, 0, .7); animation: fy-box .35s var(--e) }
@keyframes fy-box { from { opacity: 0; transform: scale(.97) } }
.fy-media { background: #000; display: grid; align-items: center; min-height: 0 }
.fy-media :deep(.nm) { margin: 0; border: 0; border-radius: 0; background: #000 }
.fy-side { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; border-left: 1px solid var(--hair) }
.fy-side :deep(.np) { border-bottom: 1px solid var(--hair); cursor: default }
.fy-side :deep(.nm) { display: none }
.fy-side .fy-thread { display: block; padding: 14px 18px; font-size: 14.5px; font-weight: 600; color: var(--accent); text-decoration: none; border-bottom: 0 }
.fy-side .fy-thread:hover { text-decoration: underline }
.fy-x { position: fixed; top: 16px; right: 16px; display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 999px; color: #fff;
  background: rgba(255, 255, 255, .12); cursor: pointer; transition: background .2s var(--e) }
.fy-x:hover { background: rgba(255, 255, 255, .22) }
.fy-step { position: fixed; top: 50%; transform: translateY(-50%); display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 999px;
  color: #111; background: rgba(255, 255, 255, .92); cursor: pointer; box-shadow: 0 6px 18px rgba(0, 0, 0, .35); transition: transform .2s var(--e) }
.fy-step:hover { transform: translateY(-50%) scale(1.06) }
.fy-prev { left: 18px } .fy-next { right: 18px }
.fy-v-enter-active, .fy-v-leave-active { transition: opacity .25s var(--e) }
.fy-v-enter-from, .fy-v-leave-to { opacity: 0 }
@media (max-width: 900px) {
  .fy-veil { padding: 0; place-items: stretch }
  .fy-box { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); max-height: 100vh; border-radius: 0; width: 100% }
  .fy-media :deep(.nm-full .nm-item) { height: min(62vh, 640px) }
  .fy-side { border-left: 0 }
  .fy-step { display: none }
  .fy-x { top: 10px; right: auto; left: 10px; z-index: 2; background: rgba(0, 0, 0, .5) }
}
@media (prefers-reduced-motion: reduce) {
  .fy-tile, .fy-box { animation: none } .fy-tile img, .fy-wash, .fy-step, .fy-x { transition: none } .fy-wait, .fy-skel .fy-tile { animation: none }
}
</style>

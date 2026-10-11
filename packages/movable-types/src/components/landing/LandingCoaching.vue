<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { md } from './md.js'
/* a phone or tablet gets a still in each tile instead of the loop: iOS draws its own
   play button over an autoplaying video, which is not the picture. Coarse pointer or a
   narrow window says phone; the stills are named on the call (coachImage / clientImage). */
const mobile = ref(false)
let mq = null
function readMobile() { mobile.value = !!(mq && mq.matches) }
onMounted(() => { if (typeof matchMedia === 'undefined') return; mq = matchMedia('(pointer: coarse), (max-width: 760px)'); readMobile(); mq.addEventListener('change', readMobile) })
onBeforeUnmount(() => { if (mq) mq.removeEventListener('change', readMobile) })
import { withBooker } from '@platform-kit/kit/lib/booking.js'
/*
 * Coaching: the one-on-one session the sheet's last tab books (cal.com, the
 * same link as CoachingPage.vue). Copy on the left; on the right a picture of
 * the session itself — a video call, the coach and the client each in a tile,
 * the coach mid-sentence, the call bar beneath — drawn with the page's own
 * tokens so it sits in either theme. No faces: two figures, a name each.
 * Every word is the page's.
 */
/*
 * Slots for a look's skin (src/lib/look.js): `copy` and `visual` (the call). Each wraps a whole block and
 * hands the skin the same data the default markup uses, so a look can rebuild that
 * block and leave the rest — the page's markdown names the section once either way.
 */
defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  call: {
    type: Object,
    /* title: the window's bar; live + elapsed: the chip; coach/client: name and role under each tile; leave: the red button */
    /* coachVideo / clientVideo: a short muted loop for the tile (mp4 or webm, any aspect — it is cropped to the tile);
       coachImage / clientImage: the still a phone shows instead; without either the tile shows the figure */
    default: () => ({ title: '', live: '', elapsed: '', coach: '', coachRole: '', coachVideo: '', coachImage: '', client: '', clientRole: '', clientVideo: '', clientImage: '', leave: '' }),
  },
  cta: { type: String, default: '' },
  href: { type: String, default: '/app/coaching' },
  fine: { type: String, default: '' },
})
</script>

<template>
  <section class="lpsec">
    <div id="lpcoaching" class="lpwrap lpc">
      <slot name="copy" :eyebrow="eyebrow" :heading="heading" :lead="lead" :cta="cta" :href="href" :fine="fine" :md="md">
      <div class="lpcol lprv lpc-copy">
        <span v-if="eyebrow" class="lpeyebrow" v-html="md(eyebrow)"></span>
        <h2 class="lps lpk" style="--k: .12s" v-html="md(heading)"></h2>
        <p v-if="lead" class="lpc-lead lpk" style="--k: .28s" v-html="md(lead)"></p>
        <a v-if="cta" :href="withBooker(href)" target="_blank" rel="noopener" class="lpbtn text-white lpc-cta lpk" style="--k: .5s"><span v-html="md(cta)"></span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5" /></svg>
        </a>
        <p v-if="fine" class="lpc-fine" v-html="md(fine)"></p>
      </div>
      </slot>

      <slot name="visual" :call="call" :md="md">
      <div class="lpstage lpc-stage lprv lpd1">
        <span class="lphalo"></span>
        <div class="lpcard lpappcard lptilt lpc-win">
          <div class="lpappbar">
            <span class="lpdots"><i></i><i></i><i></i></span>
            <span class="lpt" v-html="md(call.title)"></span>
            <span class="lpc-live"><i></i><span v-html="md(call.live)"></span><b class="lpnum">{{ call.elapsed }}</b></span>
          </div>

          <div class="lpc-tiles">
            <!-- the coach: speaking, so the tile carries the accent ring and the meter bars -->
            <div class="lpc-tile lpc-coach lpk" style="--k: .55s">
              <img v-if="mobile && call.coachImage" class="lpc-vid" :src="call.coachImage" alt="" loading="lazy" decoding="async" />
              <video v-else-if="!mobile && call.coachVideo" class="lpc-vid" :src="call.coachVideo" autoplay muted loop playsinline preload="metadata" disablepictureinpicture></video>
              <svg v-if="!((mobile && call.coachImage) || (!mobile && call.coachVideo))" class="lpc-fig" viewBox="0 0 120 112" aria-hidden="true">
                <circle cx="60" cy="34" r="17" />
                <path d="M20 112c0-30 18-46 40-46s40 16 40 46z" />
              </svg>
              <span class="lpc-name">
                <span class="lpc-bars"><i></i><i></i><i></i></span>
                <b v-html="md(call.coach)"></b><em v-if="call.coachRole" v-html="md(call.coachRole)"></em>
              </span>
            </div>
            <!-- the client: listening -->
            <div class="lpc-tile lpc-client lpk" style="--k: .8s">
              <img v-if="mobile && call.clientImage" class="lpc-vid" :src="call.clientImage" alt="" loading="lazy" decoding="async" />
              <video v-else-if="!mobile && call.clientVideo" class="lpc-vid" :src="call.clientVideo" autoplay muted loop playsinline preload="metadata" disablepictureinpicture></video>
              <svg v-if="!((mobile && call.clientImage) || (!mobile && call.clientVideo))" class="lpc-fig" viewBox="0 0 120 112" aria-hidden="true">
                <circle cx="60" cy="36" r="16" />
                <path d="M22 112c0-29 17-45 38-45s38 16 38 45z" />
              </svg>
              <span class="lpc-name">
                <svg class="lpc-mic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="8" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" /></svg>
                <b v-html="md(call.client)"></b><em v-if="call.clientRole" v-html="md(call.clientRole)"></em>
              </span>
            </div>
          </div>

          <div class="lpc-bar">
            <span class="lpc-btn lpk lpk-pop" style="--k: 1.05s"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="8" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" /></svg></span>
            <span class="lpc-btn lpk lpk-pop" style="--k: 1.15s"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="4" width="9" height="8" rx="1.5" /><path d="M10.5 7l4-2v6l-4-2" /></svg></span>
            <span class="lpc-btn lpk lpk-pop" style="--k: 1.25s"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="9" rx="1.5" /><path d="M5.5 14h5M8 8V5M6.2 6.8L8 5l1.8 1.8" /></svg></span>
            <span class="lpc-btn lpc-end lpk lpk-pop" style="--k: 1.35s"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9.2c3.6-3.2 8.4-3.2 12 0l-1.6 2.1-2.6-1.2V8.2a7 7 0 0 0-3.6 0v1.9l-2.6 1.2z" /></svg><span v-html="md(call.leave)"></span></span>
          </div>
        </div>
      </div>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lpc { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 56px; align-items: center }
.lpc-copy { max-width: 56ch }
.lpc-lead { font-size: 18px; line-height: 1.55; color: var(--ink2); margin: 14px 0 0 }
.lpc-cta { margin-top: 26px }
.lpc-fine { margin: 14px 0 0; font-size: 13.5px; color: var(--ink3) }

/* the window: the shared app-card frame, the call chip on the bar's right */
.lpc-live { margin-left: auto; display: inline-flex; align-items: center; gap: 7px; font-family: var(--m); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3) }
.lpc-live i { width: 7px; height: 7px; border-radius: 50%; background: var(--lvcatch, #dd3b3b); box-shadow: 0 0 0 3px color-mix(in srgb, var(--lvcatch, #dd3b3b) 18%, transparent); animation: lpc-blink 2.2s ease-in-out infinite }
.lpc-live b { font-weight: 500; color: var(--ink2) }
@keyframes lpc-blink { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }

/* two tiles, side by side; each a room lit in its own colour with a figure in it */
.lpc-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 12px 12px 0 }
.lpc-tile { position: relative; aspect-ratio: 4 / 3.1; border-radius: 12px; overflow: hidden; border: 1px solid var(--hair); min-width: 0 }
.lpc-coach { background: radial-gradient(120% 90% at 50% 100%, color-mix(in srgb, var(--accent) 34%, var(--paper)), color-mix(in srgb, var(--accent) 8%, var(--paper)) 70%); box-shadow: inset 0 0 0 2px var(--accent) }
.lpc-client { background: radial-gradient(120% 90% at 50% 100%, color-mix(in srgb, var(--lv2) 30%, var(--paper)), color-mix(in srgb, var(--lv2) 7%, var(--paper)) 70%) }
.lpc-vid { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block }
.lpc-fig { position: absolute; left: 50%; bottom: 0; width: 70%; transform: translateX(-50%); fill: color-mix(in srgb, var(--ink) 58%, transparent) }
.lpc-coach .lpc-fig { fill: color-mix(in srgb, var(--accent2) 80%, var(--ink)) }
.lpc-client .lpc-fig { fill: color-mix(in srgb, var(--ink) 62%, var(--lv2)) }
.lpc-name { position: absolute; left: 8px; bottom: 8px; display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px 5px 7px; border-radius: 8px; background: color-mix(in srgb, var(--paper) 82%, transparent); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); font-size: 12.5px; line-height: 1; color: var(--ink) }
.lpc-name b { font-family: var(--fd); font-weight: 600 }
.lpc-name em { font-style: normal; font-family: var(--m); font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); margin-left: 2px }
.lpc-mic { width: 12px; height: 12px; color: var(--ink3) }
/* the speaking bars: three sticks rising and falling out of step */
.lpc-bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 11px }
.lpc-bars i { width: 2.5px; border-radius: 2px; background: var(--accent); height: 40%; animation: lpc-bar 1.1s ease-in-out infinite }
.lpc-bars i:nth-child(2) { animation-delay: .18s; height: 100% }
.lpc-bars i:nth-child(3) { animation-delay: .36s; height: 65% }
@keyframes lpc-bar { 0%, 100% { transform: scaleY(.45) } 50% { transform: scaleY(1) } }
.lpc-bars i { transform-origin: bottom }

/* the call bar */
.lpc-bar { display: flex; justify-content: center; align-items: center; gap: 8px; padding: 12px 12px 14px }
.lpc-btn { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; border: 1px solid var(--hair); background: var(--wash); color: var(--ink2) }
.lpc-btn svg { width: 15px; height: 15px }
.lpc-end { width: auto; grid-auto-flow: column; gap: 6px; padding: 0 12px 0 10px; margin-left: 6px; background: var(--lvcatch, #dd3b3b); border-color: transparent; color: #fff; font-family: var(--m); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase }

@media (max-width: 900px) { .lpc { grid-template-columns: 1fr; gap: 28px } }
@media (prefers-reduced-motion: reduce) { .lpc-live i, .lpc-bars i { animation: none } }
</style>

<script setup>
/*
 * The paywall / sign-in gate, one component for every locked surface:
 *   kind='results'  the full diagnostic results — login is all it asks; or,
 *                   signed in with the address not yet confirmed
 *                   (required='verified'), the confirmation link again
 *   kind='book'     a chapter past the free allotment
 *   kind='doc'      a doc/wiki/article page with a canAccess bar
 *   kind='chat'     the coaching chat: sign in, or become a member
 * `required` is the class the reader must reach; the copy and the call to action
 * follow from that: sign in (free), buy this book, or become a member.
 * Everything it says lives in content/app/ui/gate.md.
 */
import { computed } from 'vue'
import { ref } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { STORE_ON } from '../router.js'
import { user, resendConfirmation } from 'platformkit/lib/auth.js'

const props = defineProps({
  kind: { type: String, default: 'doc' },
  required: { type: String, default: 'authenticated' },
  progress: { type: Object, default: null },   /* { n, total } for a book */
  teaser: { type: String, default: '' },       /* a faded glimpse of what's behind the gate */
  bookSlug: { type: String, default: '' },     /* a book's unlock goes straight into the cart */
})
const storeHref = computed(() => (props.kind === 'book' && props.bookSlug ? '/store?book=' + encodeURIComponent(props.bookSlug) : '/store'))
const G = us('gate')

const S = computed(() => (props.kind === 'results' ? G.results.lock : props.kind === 'book' ? G.book.lock : props.kind === 'chat' ? G.chat.lock : G.doc.lock))
/* signin | verify | buy | paid | sub */
const variant = computed(() => props.kind === 'results' ? (props.required === 'verified' ? 'verify' : 'signin')
  : props.required === 'subscribed' ? 'sub'
  : props.required === 'paid' ? (props.kind === 'book' ? 'buy' : 'paid')
  : 'signin')
const email = computed(() => (user.value && user.value.email) || '')
const heading = computed(() => (variant.value === 'verify' ? S.value['heading-verify'] : props.kind === 'results' ? S.value.heading : S.value['heading-' + variant.value]))
const subtitle = computed(() => (variant.value === 'verify' ? (S.value['subtitle-verify'] || '').replace('{email}', email.value) : props.kind === 'results' ? S.value.subtitle : S.value['subtitle-' + variant.value]))
const cta = computed(() => (variant.value === 'verify' ? S.value['cta-verify'] : props.kind === 'results' ? S.value.cta : S.value['cta-' + (variant.value === 'paid' ? 'buy' : variant.value)]))
/* the confirmation link again, once; the cooldown Supabase keeps is said as itself */
const resent = ref(false), busy = ref(false), note = ref('')
async function resend() {
  if (busy.value || resent.value || !email.value) return
  busy.value = true; note.value = ''
  try { await resendConfirmation(email.value); resent.value = true; note.value = S.value['sent-verify'] || '' }
  catch (e) { const w = /after (\d+) seconds/i.exec((e && e.message) || ''); note.value = w ? (us('auth').modal.errors.wait || '').replace('{n}', w[1]) : (us('auth').modal.errors.rate || '') }
  busy.value = false
}
const progressText = computed(() => (props.progress && S.value.progress
  ? S.value.progress.replace('{n}', props.progress.n).replace('{total}', props.progress.total) : ''))
const needsSignin = computed(() => variant.value === 'signin')

function openAuth() { if (window.DLauth) window.DLauth.open() }
</script>

<template>
  <div class="gate" :class="'gate-' + kind">
    <p v-if="teaser" class="gate-teaser" aria-hidden="true">{{ teaser }}</p>
    <div class="gate-card">
      <span class="gate-lock" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="11" width="16" height="10" rx="2.5" /><path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
        </svg>
      </span>
      <p v-if="progressText" class="gate-prog">{{ progressText }}</p>
      <h3 class="gate-h">{{ heading }}</h3>
      <p class="gate-subtitle">{{ subtitle }}</p>
      <div class="gate-ctas">
        <button v-if="needsSignin" type="button" class="gate-cta" @click="openAuth">{{ cta }}</button>
        <template v-else-if="variant === 'verify'">
          <button type="button" class="gate-cta gate-cta-quiet" :disabled="busy || resent" @click="resend">{{ cta }}</button>
          <span v-if="note" class="gate-note gate-note-sent">{{ note }}</span>
        </template>
        <!-- with the store switched off there is nothing to send them to: the gate
             still says what is locked, and offers no dead link -->
        <a v-else-if="STORE_ON" class="gate-cta" :href="storeHref">{{ cta }}</a>
        <a v-if="STORE_ON && variant === 'buy'" class="gate-alt" href="/store">{{ S['cta-sub'] }}</a>
        <span v-if="kind === 'results' && variant !== 'verify'" class="gate-note">{{ S.note }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gate { position: relative; margin: 8px 0 24px }
/* the glimpse behind the gate, fading into the card */
.gate-teaser { font-size: 17px; line-height: 1.75; color: var(--ink2); margin: 0 0 -34px; max-width: 66ch;
  -webkit-mask-image: linear-gradient(180deg, #000 0%, transparent 92%); mask-image: linear-gradient(180deg, #000 0%, transparent 92%);
  user-select: none; pointer-events: none }
.gate-card { position: relative; text-align: center; padding: 34px 28px 30px; border-radius: 20px;
  background: linear-gradient(170deg, var(--accentbg, color-mix(in srgb, var(--accent2) 10%, var(--paper))), var(--card));
  border: 1px solid var(--hair); box-shadow: 0 24px 60px -34px #0009, 0 1px 2px #0000000d; max-width: 560px; margin: 0 auto }
.gate-lock { display: inline-flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 50%;
  color: var(--accent2); background: color-mix(in srgb, var(--accent2) 14%, transparent); margin-bottom: 14px }
/* The progress line and the subtitle are paragraphs, and the gate can sit inside
   prose (the book reader styles every <p> beneath it: margin, colour). These
   selectors outrank an ancestor's paragraph rule so the card stays centred. */
.gate-card .gate-prog { font-family: var(--m); font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3);
  margin: 0 auto 10px; text-indent: 0 }
.gate-h { font-family: var(--fd); font-weight: 600; font-size: clamp(22px, 2.6vw, 27px); letter-spacing: -.02em; line-height: 1.15;
  color: var(--ink); margin: 0 0 10px; text-wrap: balance }
.gate-card .gate-subtitle { font-size: 15px; line-height: 1.55; color: var(--ink2); margin: 0 auto 20px; max-width: 42ch; text-indent: 0 }
.gate-ctas { display: flex; flex-direction: column; align-items: center; gap: 10px }
.gate-cta { display: inline-flex; align-items: center; justify-content: center; font: inherit; font-size: 15px; font-weight: 600;
  color: var(--paper); background: var(--ink); border: 0; border-radius: 999px; padding: 12px 26px; cursor: pointer; text-decoration: none;
  transition: transform .14s, box-shadow .14s }
.gate-cta:hover { transform: translateY(-1px); box-shadow: 0 10px 24px -14px #000a }
.gate-cta-quiet { color: var(--ink); background: none; border: 1px solid var(--ink) }
.gate-cta-quiet:disabled { opacity: .5; cursor: default; transform: none; box-shadow: none }
.gate-note-sent { text-transform: none; letter-spacing: 0; font-family: var(--f); font-size: 13px; color: var(--accent2) }
.gate-alt { font-size: 13.5px; color: var(--accent2); text-decoration: none }
.gate-alt:hover { text-decoration: underline; text-underline-offset: 3px }
.gate-note { font-family: var(--m); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3) }
/* inside the results sheet the card sits on the sheet's own palette */
.gate-results .gate-card { background: var(--qcard, var(--card)); border-color: var(--qhair, var(--hair)) }
</style>

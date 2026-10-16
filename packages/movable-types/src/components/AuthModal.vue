<script setup>
/*
 * The sign-in modal — mounted once, globally, in App.vue. Any surface opens it
 * with window.DLauth.open() (the same imperative pattern CommandK uses for
 * search). One form, email + password, for a reader new or returning: it tries
 * to sign in, and when that is refused it tries to create the account with the
 * same two fields — Supabase will not say whether an email is registered, so
 * the second call is how we find out. A new account means "confirm your email";
 * an existing one means the password was wrong. A magic-link tab and a Google
 * button appear only when enabled by env (VITE_AUTH_MAGIC_LINK, VITE_AUTH_GOOGLE).
 * It closes itself the moment a session appears; when the account needs its
 * email confirmed first (production) there is no session to wait for, so the
 * modal says the email is on its way, to which address, and offers it again.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { session, signInWithPassword, signUpWithPassword, signInWithMagicLink, signInWithGoogle, resendConfirmation, requestPasswordReset, setPassword, recovery, AUTH_GOOGLE, AUTH_MAGIC } from '@platform-kit/kit/lib/auth.js'
import { LOCKDOWN, notice as lockdownNotice } from '@platform-kit/kit/lib/lockdown.js'

const M = us('auth').modal
const props = defineProps({ inline: { type: Boolean, default: false } })
const inline = props.inline

const open = ref(false)
const tab = ref('password')    /* 'password' | 'magic' (magic only when enabled) */
const email = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')
const sent = ref('')           /* '' | 'link' (a magic link went out) | 'confirm' (a confirmation went out) | 'reset' (a password reset went out) */
/* the form shown: the sign-in, the forgotten password's email, or — back from the reset link — the new password */
const mode = ref('signin')     /* 'signin' | 'forgot' | 'new' */
const newPassword = ref('')
const resent = ref(false)
const emailEl = ref(null)
const onAuthenticated = ref(null)
const returnTo = ref('')

const heading = computed(() => sent.value === 'confirm' ? M.title['heading-confirm'] : sent.value === 'reset' ? M.title['heading-reset-sent'] : sent.value ? M.title['heading-sent'] : mode.value === 'forgot' ? M.title['heading-forgot'] : mode.value === 'new' ? M.title['heading-new-password'] : M.title['heading-signin'])
const subtitle = computed(() => (mode.value === 'forgot' ? M.subtitle['subtitle-forgot'] : mode.value === 'new' ? M.subtitle['subtitle-new-password'] : M.subtitle['subtitle-signin']))
/* the sent page's lines: what went, to where, what to do with it */
const sentLead = computed(() => (sent.value === 'confirm' ? M.subtitle['subtitle-confirm'] : sent.value === 'reset' ? M.subtitle['subtitle-reset-sent'] : M.subtitle['subtitle-sent']))
const sentAfter = computed(() => (sent.value === 'confirm' ? M.subtitle['subtitle-confirm-after'] : sent.value === 'reset' ? M.subtitle['subtitle-reset-sent-after'] : M.subtitle['subtitle-sent-after']))
const submitLabel = computed(() => busy.value ? M.buttons.working : mode.value === 'forgot' ? M.buttons['send-reset'] : mode.value === 'new' ? M.buttons['set-password'] : tab.value === 'magic' ? M.buttons['send-link'] : M.buttons['btn-continue'])

/* why we are asking, when a feature (not the header) opened the modal: one line
   under the subtitle, keyed into modal.intent in auth.md */
const intent = ref('')
function show(opts) {
  intent.value = (opts && opts.intent && M.intent && M.intent[opts.intent]) ? opts.intent : ''
  onAuthenticated.value = typeof opts?.onAuthenticated === 'function' ? opts.onAuthenticated : null
  returnTo.value = opts?.returnTo || ''
  mode.value = opts && opts.mode === 'new' ? 'new' : 'signin'
  open.value = true; error.value = ''; sent.value = ''; resent.value = false; newPassword.value = ''
  setTimeout(() => emailEl.value && emailEl.value.focus(), 30)
}
/* the reset link followed: the new-password form, whatever else was open */
watch(recovery, (on) => { if (on) show({ mode: 'new' }) }, { immediate: true })
function hide() { open.value = false; holding.value = false; onAuthenticated.value = null }
function finishSignIn() {
  const callback = onAuthenticated.value
  hide()
  if (callback) callback()
}

/* what Supabase's messages mean to a reader; the unconfirmed one also offers the email again */
const unconfirmed = ref(false)
const mapErr = (e) => {
  const m = (e && e.message) || ''
  if (/not confirmed/i.test(m)) { unconfirmed.value = true; return M.errors.unconfirmed }
  /* sign-ups switched off in Supabase (Authentication → Sign In / Providers): the sign-in was
     refused and no account can be made, so both are said */
  if (/signups? not allowed|signup_disabled/i.test(m)) return M.errors.closed
  /* a second email to the same address is held back for a minute; the message says how long */
  const wait = /after (\d+) seconds/i.exec(m)
  if (wait && Number(wait[1]) > 0) return M.errors.wait.replace('{n}', wait[1])
  if (/rate limit|too many|security purposes/i.test(m)) return M.errors.rate
  if (/already registered|already exists/i.test(m)) return M.errors.invalid
  if (/different from the old/i.test(m)) return M.errors['same-password']
  if (/password.*(short|least|weak)|weak password/i.test(m)) return M.errors.weak
  /* a reset link used twice, or after its hour: the session it made is gone */
  if (mode.value === 'new' && /session|expired|jwt|not.?logged/i.test(m)) return M.errors['reset-expired']
  if (/invalid|credentials|password/i.test(m)) return M.errors.invalid
  return M.errors.generic
}
async function run(fn) {
  busy.value = true; error.value = ''; unconfirmed.value = false
  try { await fn() } catch (e) { error.value = mapErr(e) } finally { busy.value = false }
}
function submit() {
  if (mode.value === 'new') return run(async () => { await setPassword(newPassword.value); hide() })
  if (!email.value.trim()) { error.value = M.errors['email-required']; return }
  if (mode.value === 'forgot') return run(async () => { await requestPasswordReset(email.value.trim()); sent.value = 'reset' })
  if (tab.value === 'magic') return run(async () => { await signInWithMagicLink(email.value.trim(), returnTo.value); sent.value = 'link' })
  return run(async () => {
    const who = email.value.trim(), pw = password.value
    try {
      await signInWithPassword(who, pw)
      return   /* a session arrives; the watcher below closes the modal */
    } catch (e) {
      /* anything but a refused password (not confirmed, a rate limit, offline) is said as itself */
      if (!/invalid|credentials/i.test((e && e.message) || '')) throw e
    }
    /* closed to new accounts while the app is under construction: say so, make nothing */
    if (LOCKDOWN) { hide(); lockdownNotice(); return }
    /* refused: no such account, or the wrong password — Supabase will not say which,
       so make the account; an email that is taken answers 'exists', and then the
       password was wrong */
    holding.value = true
    let r
    try { r = await signUpWithPassword(who, pw, returnTo.value) } finally { holding.value = false }
    if (r === 'exists') error.value = M.errors.invalid
    else if (r === 'confirm') sent.value = 'confirm'   /* signed in; the address awaits its link */
  })
}
/* the confirmation email once more, from the sent page or from a sign-in that was refused for it */
const resend = () => run(async () => { await (sent.value === 'reset' ? requestPasswordReset : resendConfirmation)(email.value.trim()); resent.value = true; unconfirmed.value = false })
function back() { sent.value = ''; resent.value = false; error.value = ''; password.value = ''; mode.value = 'signin'; setTimeout(() => emailEl.value && emailEl.value.focus(), 30) }
const forgot = () => { mode.value = 'forgot'; error.value = ''; password.value = ''; setTimeout(() => emailEl.value && emailEl.value.focus(), 30) }
const google = () => run(() => signInWithGoogle(returnTo.value))

/* a session arriving (any method, any tab) means we're done — unless the
   modal is telling a new reader to confirm their address, which it does with
   the session already in hand */
const holding = ref(false)   /* a sign-up in flight: the session lands before the confirm screen is set */
watch(session, (s) => {
  if (!s || !open.value || holding.value || mode.value === 'new') return
  if (onAuthenticated.value) finishSignIn()
  else if (!sent.value) hide()
})

function onKey(e) { if (e.key === 'Escape' && open.value) hide() }
onMounted(() => { if (!inline) window.DLauth = { open: show, close: hide }; document.addEventListener('keydown', onKey) })
onBeforeUnmount(() => { document.removeEventListener('keydown', onKey); if (!inline && window.DLauth) delete window.DLauth })
</script>

<template>
  <div v-if="inline || open" class="au-veil" :class="{ 'au-veil-inline': inline }" @click.self="!inline && hide()">
    <div
      class="au-card"
      :class="{ 'au-card-inline': inline }"
      :role="inline ? undefined : 'dialog'"
      :aria-modal="inline ? undefined : 'true'"
      :aria-label="inline ? undefined : heading"
    >
      <button v-if="!inline" type="button" class="au-x" :aria-label="M.buttons.close" @click="hide">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
      </button>

      <template v-if="!sent">
        <h2 class="au-h">{{ heading }}</h2>
        <p class="au-subtitle">{{ subtitle }}</p>
        <p v-if="intent" class="au-intent">{{ M.intent[intent] }}</p>

        <button v-if="AUTH_GOOGLE && mode === 'signin'" type="button" class="au-google" :disabled="busy" @click="google">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.27-4.74 3.27-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
          {{ M.buttons.google }}
        </button>
        <div v-if="AUTH_GOOGLE && mode === 'signin'" class="au-or"><span>{{ M.buttons.or }}</span></div>

        <div v-if="AUTH_MAGIC && mode === 'signin'" class="au-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="tab === 'password'" :class="{ on: tab === 'password' }" @click="tab = 'password'; error = ''">{{ M.tabs['tab-password'] }}</button>
          <button type="button" role="tab" :aria-selected="tab === 'magic'" :class="{ on: tab === 'magic' }" @click="tab = 'magic'; error = ''">{{ M.tabs['tab-magic'] }}</button>
        </div>

        <form class="au-form" @submit.prevent="submit">
          <!-- back from the reset link: the new password alone -->
          <label v-if="mode === 'new'" class="au-f">
            <span>{{ M.fields['new-password'] }}</span>
            <input ref="emailEl" v-model="newPassword" type="password" :placeholder="M.fields['new-password-placeholder']" autocomplete="new-password" minlength="6" required />
          </label>
          <label v-else class="au-f">
            <span>{{ M.fields.email }}</span>
            <input ref="emailEl" v-model="email" type="email" :placeholder="M.fields['email-placeholder']" autocomplete="email" required />
          </label>
          <label v-if="mode === 'signin' && tab === 'password'" class="au-f">
            <span>{{ M.fields.password }}<button type="button" class="au-forgot" @click="forgot">{{ M.buttons.forgot }}</button></span>
            <input v-model="password" type="password" :placeholder="M.fields['password-placeholder']"
                   autocomplete="current-password" minlength="6" required />
          </label>
          <p v-if="error" class="au-err" role="alert">{{ error }}
            <button v-if="unconfirmed" type="button" class="au-inline" :disabled="busy" @click="resend">{{ M.buttons.resend }}</button>
          </p>
          <p v-if="resent && !sent" class="au-ok" role="status">{{ M.buttons.resent }}</p>
          <button type="submit" class="au-submit" :disabled="busy">{{ submitLabel }}</button>
        </form>

        <p v-if="mode === 'signin' && tab === 'password'" class="au-note">{{ M.buttons['new-note'] }}</p>
        <p v-if="mode === 'forgot'" class="au-note"><button type="button" class="au-switch" @click="back">{{ M.buttons['back-to-signin'] }}</button></p>
      </template>

      <!-- the email is on its way: one centred piece — what went, to which address,
           what to do with it — and, quietly, the way to ask again or start over -->
      <div v-else class="au-sent" role="status" aria-live="polite">
        <span class="au-mail" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7.5 12 13l8.5-5.5"/></svg>
        </span>
        <h2 class="au-h">{{ heading }}</h2>
        <p class="au-sent-lead">{{ sentLead }}</p>
        <p class="au-addr">{{ email.trim() }}</p>
        <p class="au-sent-after">{{ sentAfter }}</p>
        <p v-if="resent" class="au-ok">{{ M.buttons.resent }}</p>
        <p v-if="error" class="au-err" role="alert">{{ error }}</p>
        <div class="au-sent-acts">
          <button type="button" class="au-again" :disabled="busy || resent" @click="resend">{{ busy ? M.buttons.working : M.buttons.resend }}</button>
          <button v-if="!session" type="button" class="au-switch" @click="back">{{ M.buttons.back }}</button>
          <button v-else type="button" class="au-switch" @click="hide">{{ M.buttons.later }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.au-veil { position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center; padding: 20px;
  background: #0a0d0b66; backdrop-filter: blur(6px) }
.au-veil.au-veil-inline { position: static; inset: auto; z-index: auto; display: block; padding: 0; background: none; backdrop-filter: none }
.au-card { position: relative; width: 100%; max-width: 420px; background: var(--paper); color: var(--ink);
  border: 1px solid var(--hair); border-radius: 22px; padding: 34px 32px 28px;
  box-shadow: 0 30px 80px -30px #000c, 0 1px 2px #0000000d }
.au-card.au-card-inline { max-width: none; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none }
.au-x { position: absolute; top: 14px; right: 14px; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
  color: var(--ink3); background: none; border: 0; border-radius: 8px; cursor: pointer }
.au-x:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 7%, transparent) }
.au-h { font-family: var(--fd); font-weight: 600; font-size: 26px; letter-spacing: -.02em; line-height: 1.1; margin: 0 0 8px }
.au-forgot { float: right; font: inherit; font-size: 12.5px; color: var(--ink3); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 2px }
.au-forgot:hover { color: var(--ink) }
.au-subtitle { font-size: 14.5px; line-height: 1.5; color: var(--ink2); margin: 0 0 22px; max-width: 34ch }
/* the one line that says why a feature asked — sits under the subtitle, quieter */
.au-intent { font-size: 13.5px; line-height: 1.5; color: var(--ink3); margin: -12px 0 22px; max-width: 36ch;
  padding-left: 10px; border-left: 2px solid var(--accent) }
.au-google { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; font: inherit; font-size: 14.5px; font-weight: 500;
  color: var(--ink); background: var(--card); border: 1px solid var(--hair); border-radius: 12px; padding: 11px 14px; cursor: pointer;
  transition: border-color .14s, background .14s }
.au-google:hover { border-color: var(--ink3) }
.au-google:disabled { opacity: .6; cursor: default }
.au-or { display: flex; align-items: center; gap: 12px; margin: 16px 0; font-family: var(--m); font-size: 10px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--ink3) }
.au-or::before, .au-or::after { content: ""; flex: 1; height: 1px; background: var(--hair) }
.au-tabs { display: inline-flex; background: var(--wash); border: 1px solid var(--hair); border-radius: 999px; padding: 3px; margin: 0 0 16px }
.au-tabs button { font: inherit; font-size: 12.5px; color: var(--ink3); background: none; border: 0; border-radius: 999px; padding: 6px 14px; cursor: pointer }
.au-tabs button.on { color: var(--ink); background: var(--paper); box-shadow: 0 1px 2px #0000000f }
.au-form { display: flex; flex-direction: column; gap: 12px }
.au-f { display: block }
.au-f span { display: block; font-family: var(--m); font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink2); margin: 0 0 6px }
.au-f input { width: 100%; box-sizing: border-box; font: inherit; font-size: 15px; color: var(--ink); background: var(--card);
  border: 1px solid var(--hair); border-radius: 11px; padding: 11px 13px }
.au-f input:focus { outline: 2px solid var(--accent2); outline-offset: 0; border-color: transparent }
.au-err { margin: 0; font-size: 13px; color: #b3402e }
.au-ok { margin: 0; font-size: 13px; color: var(--accent2) }
.au-inline { display: inline; font: inherit; font-size: 13px; color: var(--accent2); background: none; border: 0; padding: 0; margin-left: 4px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px }
.au-sent { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 6px 0 2px }
.au-sent .au-h { margin: 0 0 10px }
.au-mail { display: inline-flex; align-items: center; justify-content: center; width: 54px; height: 54px; border-radius: 50%; margin: 0 0 18px;
  color: var(--accent2); background: color-mix(in srgb, var(--accent2) 12%, transparent) }
.au-sent-lead { margin: 0; font-size: 14.5px; line-height: 1.5; color: var(--ink2) }
.au-addr { margin: 4px 0 10px; font-family: var(--m); font-size: 12.5px; letter-spacing: -.01em; color: var(--ink); padding: 6px 12px; border-radius: 8px;
  background: var(--wash); border: 1px solid var(--hair); max-width: 100%; overflow-wrap: anywhere }
.au-sent-after { margin: 0 0 22px; font-size: 14.5px; line-height: 1.5; color: var(--ink2); max-width: 32ch }
.au-sent .au-ok, .au-sent .au-err { margin: -10px 0 14px }
.au-sent-acts { display: flex; flex-direction: column; align-items: center; gap: 10px }
.au-again { font: inherit; font-size: 14px; font-weight: 600; color: var(--ink); background: none; border: 1px solid var(--hair);
  border-radius: 999px; padding: 9px 18px; cursor: pointer; transition: border-color .14s }
.au-again:hover:not(:disabled) { border-color: var(--ink3) }
.au-again:disabled { opacity: .5; cursor: default }
.au-sent .au-switch { margin: 0 }
.au-submit { font: inherit; font-size: 15px; font-weight: 600; color: var(--paper); background: var(--ink); border: 0; border-radius: 999px;
  padding: 12px 20px; cursor: pointer; margin-top: 4px }
.au-submit:disabled { opacity: .55; cursor: default }
.au-note { margin: 14px 0 0; text-align: center; font-size: 12.5px; line-height: 1.5; color: var(--ink3) }
.au-switch { display: block; margin: 14px auto 0; font: inherit; font-size: 13px; color: var(--accent2); background: none; border: 0; cursor: pointer }
.au-switch:hover { text-decoration: underline; text-underline-offset: 3px }
@media (prefers-reduced-motion: no-preference) {
  .au-card { animation: au-in .18s ease-out }
  @keyframes au-in { from { opacity: 0; transform: translateY(8px) scale(.985) } to { opacity: 1; transform: none } }
}
</style>

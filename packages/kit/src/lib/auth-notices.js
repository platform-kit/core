/*
 * What an email link left behind, said out loud. Supabase sends a reader back
 * from a magic link with either tokens (a session, which supabase-js picks up
 * itself) or an error, in the address's hash:
 *   #error=access_denied&error_code=otp_expired&error_description=…
 * Nothing used to read the error, so a second click on a link showed a landing
 * page and no word. This reads it at boot, says it in a toast — expired or
 * used links get "Send a new link" when the reader is signed in (the address
 * is theirs to prove) and "Sign in" when not — and cleans the address. When a
 * link does work, the verified flag turns on for a session that was read as
 * unverified a moment before — the only way it ever turns on — and that is
 * told the same way (the token hash itself is gone before anything here runs:
 * supabase-js takes it).
 * Words: content/app/ui/auth.md (notices).
 */
import { watch } from 'vue'
import { session, user, emailVerified, roleKnown, resendConfirmation } from './auth.js'
import { us } from './content.js'
import { toast } from './toast.js'

const N = () => ((us('auth').notices || {}).link || {})

function readHash() {
  const h = window.location.hash || ''
  if (!/[#&]error(_code|_description)?=/.test(h)) return null
  const p = new URLSearchParams(h.replace(/^#/, ''))
  return { code: p.get('error_code') || p.get('error') || '', text: p.get('error_description') || '' }
}
function clean() {
  try { history.replaceState(null, '', window.location.pathname + window.location.search) } catch (e) { /* nothing */ }
}

async function resend() {
  const L = N()
  const email = user.value && user.value.email
  if (!email) { if (window.DLauth) window.DLauth.open(); return }
  try { await resendConfirmation(email); toast({ kind: 'ok', title: L['sent-title'], body: L.sent, dismiss: L.dismiss }) }
  catch (e) {
    const w = /after (\d+) seconds/i.exec((e && e.message) || '')
    const E = us('auth').modal.errors || {}
    toast({ kind: 'warn', title: L['expired-title'], body: w ? (E.wait || '').replace('{n}', w[1]) : (E.rate || E.generic || ''), dismiss: L.dismiss })
  }
}

let started = false
export function initAuthNotices() {
  if (started) return
  started = true
  const err = readHash()
  if (err) {
    clean()
    const L = N()
    const expired = /expired|invalid/i.test(err.code + ' ' + err.text)
    /* the action depends on whether there is a session to ask a link for; the
       session is known a moment after boot, so the toast waits for that */
    const show = () => {
      const signed = !!session.value
      toast({
        kind: 'warn', ms: 0,
        title: expired ? L['expired-title'] : L['failed-title'],
        body: expired ? L.expired : L.failed,
        action: signed ? { label: L.again, run: resend } : { label: L.signin, run: () => { if (window.DLauth) window.DLauth.open() } },
        dismiss: L.dismiss,
      })
    }
    setTimeout(show, 600)
  }
  /* the confirmation: the flag seen off for this session, then on */
  let seenOff = false
  watch([emailVerified, roleKnown, session], ([ok, known, s]) => {
    if (!s) { seenOff = false; return }
    if (!known) return
    if (!ok) { seenOff = true; return }
    if (seenOff) { seenOff = false; const L = N(); toast({ kind: 'ok', title: L['confirmed-title'], body: L.confirmed, dismiss: L.dismiss, ms: 10000 }) }
  })
}

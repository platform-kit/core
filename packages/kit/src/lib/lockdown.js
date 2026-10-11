/*
 * Lockdown: LOCKDOWN_MODE=1 in the build's environment (read by the client
 * under that exact name — vite.config.js envPrefix) closes the app to everyone
 * but the admins. A signed-in reader who is not one is signed out the moment
 * their role is known, and told why in a toast; the sign-in modal refuses to
 * let one in or make an account. Admins are untouched, so the site can be
 * worked on while it is closed. The notice survives the reload that signing
 * out does, through sessionStorage. Words: content/app/ui/auth.md, lockdown.
 */
import { watch } from 'vue'
import { session, isStaff, roleKnown, signOut } from './auth.js'
import { us } from './content.js'
import { toast } from './toast.js'

const on = (v) => /^(1|true|yes|on)$/i.test(String(v || ''))
export const LOCKDOWN = on(import.meta.env.LOCKDOWN_MODE)
const KEY = 'dl.lockdown.notice'

export function notice() {
  const L = (us('auth').lockdown || {}).notice || {}
  toast({ title: L.title, body: L.body, dismiss: L.dismiss, kind: 'lock', ms: 0 })
}

let started = false
export function initLockdown() {
  if (!LOCKDOWN || started) return
  started = true
  /* the notice a sign-out left for after its reload */
  try { if (sessionStorage.getItem(KEY)) { sessionStorage.removeItem(KEY); notice() } } catch (e) { /* private mode */ }
  watch([session, roleKnown], async ([s, known]) => {
    if (!s || !known || isStaff.value) return
    try { sessionStorage.setItem(KEY, '1') } catch (e) { /* private mode */ }
    await signOut()
  }, { immediate: true })
}

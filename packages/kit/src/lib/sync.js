/*
 * Loro ↔ cloud. For a signed-in user the cloud copy (user_docs) is the source of
 * truth; Loro stays the local engine that buffers offline work and merges.
 *
 * On sign-in: pull the remote snapshot and import it — a CRDT merge with whatever
 * the device already held, so a guest's diagnostic answers and reading places
 * survive their first login — reconcile the synchronous view, then push the merged
 * document back. After that: push (debounced) after every local commit, pull
 * whenever the tab regains focus. On sign-out: stop; the local copy remains for
 * the guest. Every network failure is swallowed — offline, the local copy is
 * authoritative until the next commit or focus retries.
 */
import { supabase } from './supabase.js'
import { ready, loroDoc, onCommit, reconcileFromDoc, b64ToBytes, bytesToB64 } from './store.js'

let userId = null
let offCommit = null
let pushTimer = null
let pulling = false
/* the sign-in pull, so whoever rebuilds state from the merged document (the
   answer rows in src/lib/records.js) can wait for it; resolved when signed out */
let pulled = Promise.resolve()
export function whenPulled() { return pulled }

async function pull() {
  if (!userId || pulling) return
  pulling = true
  try {
    await ready
    const doc = loroDoc()   /* the live document — a sign-out swaps in a new one */
    if (!doc) return
    const { data, error } = await supabase
      .from('user_docs').select('snapshot').eq('user_id', userId).maybeSingle()
    if (error || !data || !data.snapshot) return
    doc.import(b64ToBytes(data.snapshot))
    reconcileFromDoc()
  } catch (e) { /* offline or transient */ } finally { pulling = false }
}

async function push() {
  if (!userId) return
  try {
    await ready
    const doc = loroDoc()
    if (!doc) return
    const snapshot = bytesToB64(doc.export({ mode: 'snapshot' }))
    await supabase.from('user_docs').upsert({ user_id: userId, snapshot }, { onConflict: 'user_id' })
  } catch (e) { /* offline — the next commit or focus retries */ }
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => { pushTimer = null; push() }, 1500)
}
/* a final, awaited push — used right before a sign-out so nothing is left behind */
export async function pushNow() {
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
  await push()
}
function onFocus() { if (document.visibilityState === 'visible') pull() }

/* idempotent per user: INITIAL_SESSION and SIGNED_IN both fire for one login */
export async function attachSync(session) {
  const id = session && session.user && session.user.id
  if (!id || id === userId) return
  userId = id
  pulled = pull()
  await pulled
  await push()
  offCommit = onCommit(schedulePush)
  document.addEventListener('visibilitychange', onFocus)
  window.addEventListener('focus', onFocus)
}

export function detachSync() {
  userId = null
  pulled = Promise.resolve()
  if (offCommit) { offCommit(); offCommit = null }
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
  document.removeEventListener('visibilitychange', onFocus)
  window.removeEventListener('focus', onFocus)
}

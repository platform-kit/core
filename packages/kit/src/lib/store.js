/*
 * The one place state is persisted.
 *
 * Everything the app remembers — the theme, the diagnostic session, each book's
 * reading state, which tab was last open — is persisted through a single Loro
 * document (a CRDT). Modelling it as a CRDT now is what lets the whole of it sync
 * to a backend later without a single consumer changing: the same document
 * merges cleanly across devices.
 *
 * Two things have to be true at once, though: the facade must be synchronous
 * (the diagnostic engine reads its saved session the moment its module loads,
 * and the theme must be set before first paint), and boot must not wait on Loro's
 * multi-megabyte WASM. So the shape is local-first in the usual way — a small
 * in-memory view, keyed exactly like the old localStorage, is hydrated
 * synchronously from a compact JSON mirror and answers every get/set with no
 * WASM in sight. Loro itself loads asynchronously a moment later; once ready it
 * is the system of record, seeded from that view and re-snapshotted, and every
 * write from then on lands in the document as well. The document's snapshot is
 * what a backend will one day exchange.
 *
 * Values are the JSON strings the callers already produce — string in, string
 * out — so this is a drop-in for the localStorage calls it replaces.
 */

const MIRROR_KEY = 'dl.kv'    /* compact {key: value} JSON, for synchronous reads */
const SNAP_KEY = 'dl.loro'    /* the Loro document snapshot, base64 */

/* ---- the synchronous view: hydrated now, no WASM ---- */
const view = Object.create(null)
let migrated = false
try {
  const raw = localStorage.getItem(MIRROR_KEY)
  if (raw) {
    Object.assign(view, JSON.parse(raw))
  } else {
    /* first run under Loro: lift whatever the app already saved under its own
       keys, once, so returning readers keep their theme, answers, and place in
       every book. All of our keys are 'dl'-prefixed; our own keys are skipped. */
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || k === MIRROR_KEY || k === SNAP_KEY) continue
      if (k.indexOf('dl.') !== 0 && k.indexOf('dl-') !== 0) continue
      const v = localStorage.getItem(k)
      if (v != null) { view[k] = v; migrated = true }
    }
  }
} catch (e) { /* private mode or corrupt mirror — start clean */ }

let mirrorTimer = null
function persistMirror() {
  try { localStorage.setItem(MIRROR_KEY, JSON.stringify(view)) } catch (e) { /* full or private */ }
}
function scheduleMirror() {
  if (mirrorTimer) return
  mirrorTimer = setTimeout(() => { mirrorTimer = null; persistMirror() }, 120)
}
/* make the one-time legacy migration durable in the fast path immediately, not
   only on the next write or unload */
if (migrated) persistMirror()

/* ---- Loro: loaded asynchronously, then the system of record ---- */
let doc = null
let map = null
const pending = []            /* writes made before the document was ready */

export function b64ToBytes(b64) {
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
}
export function bytesToB64(u8) {
  let s = ''
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
  return btoa(s)
}

let snapTimer = null
function persistSnapshot() {
  if (!doc) return
  try { localStorage.setItem(SNAP_KEY, bytesToB64(doc.export({ mode: 'snapshot' }))) } catch (e) { /* full or private */ }
}
function scheduleSnapshot() {
  if (snapTimer) return
  snapTimer = setTimeout(() => { snapTimer = null; persistSnapshot() }, 300)
}
/* subscribers told after every local commit — the cloud sync (src/lib/sync.js)
   registers a debounced push here, so nothing else in the app has to know it exists */
const commitFns = []
export function onCommit(fn) {
  commitFns.push(fn)
  return () => { const i = commitFns.indexOf(fn); if (i >= 0) commitFns.splice(i, 1) }
}
function notifyCommit() { for (const f of commitFns) { try { f() } catch (e) { /* a listener must never break a write */ } } }

function toLoro(key, value) {
  if (map) { map.set(key, value); doc.commit(); scheduleSnapshot(); notifyCommit() }
  else pending.push([key, value, 'set'])
}
function delLoro(key) {
  if (map) { map.delete(key); doc.commit(); scheduleSnapshot(); notifyCommit() }
  else pending.push([key, null, 'del'])
}

/* after the sync layer imports a remote snapshot into the document (a CRDT
   merge), surface whatever that merge changed into the synchronous view and the
   local mirror, so every consumer sees the reconciled state without a reload */
export function reconcileFromDoc() {
  if (!map) return
  const changed = []
  for (const [k, v] of Object.entries(map.toJSON())) {
    if (typeof v === 'string' && view[k] !== v) { view[k] = v; changed.push(k); scheduleMirror() }
  }
  persistSnapshot()
  if (changed.length) for (const f of reconcileFns) { try { f(changed) } catch (e) { /* a listener must never break a merge */ } }
}
/* subscribers told which keys a merge changed — a module that keeps its own
   in-memory copy of a key (the diagnostic engine's session) re-reads it here,
   so the merged state is what it shows and what its next write carries forward */
const reconcileFns = []
export function onReconcile(fn) {
  reconcileFns.push(fn)
  return () => { const i = reconcileFns.indexOf(fn); if (i >= 0) reconcileFns.splice(i, 1) }
}

/* the document, once it exists, for the backend sync this layer is built for */
export let ready = (async function init() {
  try {
    const { LoroDoc } = await import('loro-crdt')
    const d = new LoroDoc()
    try {
      const b64 = localStorage.getItem(SNAP_KEY)
      if (b64) d.import(b64ToBytes(b64))
    } catch (e) { /* corrupt snapshot — the view still holds the truth */ }
    const m = d.getMap('state')
    /* the view is authoritative on boot (it carries the legacy migration and any
       write made while the document was still loading); seed the document from it */
    for (const k in view) m.set(k, view[k])
    /* and surface anything the document alone held (a snapshot from another device) */
    for (const [k, v] of Object.entries(m.toJSON())) {
      if (!(k in view) && typeof v === 'string') { view[k] = v; scheduleMirror() }
    }
    d.commit()
    doc = d; map = m
    for (const [k, v, op] of pending) { if (op === 'del') m.delete(k); else m.set(k, v) }
    pending.length = 0
    d.commit()
    persistSnapshot()
    return d
  } catch (e) {
    /* Loro failed to load; the JSON mirror keeps the app fully working offline */
    return null
  }
})()

/* a set right before navigation must not be lost to either debounce */
function flush() {
  if (mirrorTimer) { clearTimeout(mirrorTimer); mirrorTimer = null }
  persistMirror()
  if (snapTimer) { clearTimeout(snapTimer); snapTimer = null }
  persistSnapshot()
}
try {
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
  }
} catch (e) { /* no DOM (SSR, tests) — nothing to flush on */ }

export function get(key) {
  const v = view[key]
  return v === undefined || v === null ? null : v
}
export function set(key, value) {
  view[key] = value
  scheduleMirror()
  toLoro(key, value)
}
export function del(key) {
  delete view[key]
  scheduleMirror()
  delLoro(key)
}

/* the live Loro document, or null until it has loaded. Always read this at the
   moment of use rather than keeping a reference: reset() swaps in a new one. */
export function loroDoc() { return doc }

/* Forget everything — a sign-out. Deliberately a BRAND-NEW document rather than
   deletes inside the old one: a CRDT map is last-writer-wins per key, so those
   deletions would carry newer timestamps than another account's cloud writes
   and out-vote them at the next login's merge (then get pushed up). A fresh
   document has no history to fight with. Device preferences survive. */
const KEEP_ON_RESET = ['dl.theme', 'dl.admin.fs']
export async function reset() {
  const kept = {}
  for (const k of KEEP_ON_RESET) if (view[k] != null) kept[k] = view[k]
  for (const k of Object.keys(view)) delete view[k]
  Object.assign(view, kept)
  if (mirrorTimer) { clearTimeout(mirrorTimer); mirrorTimer = null }
  if (snapTimer) { clearTimeout(snapTimer); snapTimer = null }
  pending.length = 0
  try { localStorage.removeItem(SNAP_KEY) } catch (e) { /* private mode */ }
  persistMirror()
  if (!doc) return
  try {
    const { LoroDoc } = await import('loro-crdt')
    const d = new LoroDoc()
    const m = d.getMap('state')
    for (const k in kept) m.set(k, kept[k])
    d.commit()
    doc = d; map = m
    persistSnapshot()
  } catch (e) { doc = null; map = null }
}

/* a localStorage-shaped adapter, so the diagnostic engine's STORE slot and any
   other get/set consumer can be pointed here with no code change */
export const STORE = { get, set }

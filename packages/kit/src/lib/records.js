/*
 * Answers and results as rows — the record of truth for the diagnostic.
 *
 * The Loro document stays the device's state and its offline buffer; what a
 * signed-in reader has answered lives in `answers`, one row per answer, keyed
 * naturally (user, test, item, when). A blockages answer is amended later in the
 * same round (recall / again / self report), so a row is upserted, never
 * duplicated. Each finished round writes a `results` snapshot from the scorer.
 *
 * Writes go through a small persistent outbox (a Loro key), coalesced by that
 * natural key and drained with a short debounce, on focus, and — via a
 * keepalive request, the analytics pattern — when the page hides. Anything the
 * network refused stays in the outbox for the next attempt; upserts make the
 * retry idempotent.
 *
 * On sign-in the session is rebuilt from the rows as a union with whatever is
 * local: server rows win nothing and lose nothing, local-only entries (a guest
 * who answered before accounts existed) are uploaded. This is what replaces the
 * last-writer-wins merge of two unrelated documents.
 *
 * Test names in the database are the reader-facing ones, not the engine's
 * corpus names; the mapping below is the only place the two meet.
 */
import { ref } from 'vue'
import { supabase, configured } from './supabase.js'
import { session, beforeSignOut, onIdentity } from './auth.js'
import { whenPulled } from './sync.js'
import { get as storeGet, set as storeSet, onReconcile } from './store.js'
import { S, KEY as SESSION_KEY, save, load, setRecorder, blank } from '../instrument/engine/session.js'
import { ENGINE_VERSION } from '../instrument/engine/session.js'

export const TESTS = { type: 'personality', domain: 'diagnostics', words: 'blockages', books: 'books' }
const CORPUS = { personality: 'type', diagnostics: 'domain', blockages: 'words', books: 'books' }
const CORPORA = ['domain', 'type', 'words', 'books']
export const testOf = (corpus) => TESTS[corpus]

const OUTBOX_KEY = 'dl.outbox.v1'
const FLUSH_MS = 1500
const PULL_WAIT_MS = 8000
const ON_CONFLICT = 'user_id,test,item_id,answered_at'
const PAGE = 1000

/* bumps whenever the session was rebuilt from rows, so the sheet can remount */
export const sessionRev = ref(0)

const uid = () => (session.value && session.value.user && session.value.user.id) || null
/* the item an entry is about: statement id, pair id, or the word itself */
const itemOf = (corpus, e) => (corpus === 'words' ? e.w : e.id)
/* the natural key, with time as epoch ms so a server row and a local entry agree */
const keyOf = (test, item, ms) => test + '|' + item + '|' + ms

function rowFor(corpus, e, userId) {
  /* answers saved before timestamps existed cannot be keyed; they stay local */
  if (!e || typeof e.ts !== 'number') return null
  const item = itemOf(corpus, e)
  if (item == null) return null
  return {
    user_id: userId, test: TESTS[corpus], item_id: String(item), value: e,
    latency_ms: corpus === 'words' && typeof e.ms === 'number' ? Math.round(e.ms) : null,
    answered_at: new Date(e.ts).toISOString(),
  }
}
const rowKey = (r) => keyOf(r.test, r.item_id, Date.parse(r.answered_at))

/* ---- the outbox ---- */
let outbox = null
function box() {
  if (!outbox) { try { outbox = JSON.parse(storeGet(OUTBOX_KEY) || 'null') || {} } catch (e) { outbox = {} } }
  return outbox
}
function saveBox() { try { storeSet(OUTBOX_KEY, JSON.stringify(box())) } catch (e) { /* full */ } }

let timer = null
/* the engine calls this (through session.setRecorder) at every write site */
export function record(corpus, entry) {
  const id = uid()
  if (!id || !configured) return
  const row = rowFor(corpus, entry, id)
  if (!row) return
  box()[rowKey(row)] = row
  saveBox()
  if (!timer) timer = setTimeout(flush, FLUSH_MS)
}

export async function flush() {
  if (timer) { clearTimeout(timer); timer = null }
  const b = box(), rows = Object.values(b)
  if (!rows.length || !uid() || !configured) return
  const { error } = await supabase.from('answers').upsert(rows, { onConflict: ON_CONFLICT })
  if (error) return /* offline or refused — the outbox keeps them for next time */
  /* drop what was sent, unless a follow-up replaced the row meanwhile */
  for (const r of rows) { const k = rowKey(r); if (b[k] === r) delete b[k] }
  saveBox()
}

/* the page is going away: one keepalive request, no confirmation possible, so the
   rows stay queued and the next flush's upsert makes the repeat harmless */
function flushKeepalive() {
  const rows = Object.values(box())
  const token = session.value && session.value.access_token
  if (!rows.length || !token || !configured) return
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  try {
    fetch(import.meta.env.VITE_SUPABASE_URL + '/rest/v1/answers?on_conflict=' + ON_CONFLICT, {
      method: 'POST', keepalive: true,
      headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
                 Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    })
  } catch (e) { /* offline */ }
}

/* a finished round: the scorer's own object, stamped with the engine that made it.
   Derivable from the answers, so no outbox — a miss is recomputed next time. */
export async function recordResult(corpus, payload, answered) {
  const id = uid()
  if (!id || !configured || !payload) return
  try {
    await supabase.from('results').insert({
      user_id: id, test: TESTS[corpus], engine_version: ENGINE_VERSION,
      answered: answered | 0, payload,
    })
  } catch (e) { /* offline */ }
}

/* the engine's in-memory session was replaced: the words scorer caches on
   waRev, and the sheet remounts on sessionRev */
function rebuilt() {
  S.waRev = (S.waRev || 0) + 1
  sessionRev.value++
}

/* Start over: every answer and every reading gone, on this device and — signed
   in — in the account's rows, so nothing hydrates them back. Books, highlights and
   trophies are not answers and stay. The blank session is saved and the sheet
   remounts on the bump. */
export async function clearAll() {
  const id = uid()
  if (id && configured) {
    try {
      await supabase.from('answers').delete().eq('user_id', id)
      await supabase.from('results').delete().eq('user_id', id)
    } catch (e) { /* offline: the local clear still lands, and the rows are gone next time */ }
  }
  const fresh = blank()
  Object.keys(S).forEach((k) => { delete S[k] })
  Object.assign(S, fresh)
  save()
  rebuilt()
}

/* rebuild the session from the rows, as a union with what is local */
export async function hydrate() {
  const id = uid()
  if (!id || !configured) return false
  await flush()
  /* the cloud document lands first — a CRDT merge into the local one — and the
     engine's session is re-read from it, so the union below starts from the
     merged state rather than the blank one a fresh boot loaded. Without this a
     reader whose rows could not be read saw an empty sheet until a reload, and
     their next answer wrote that blank session over the cloud copy. */
  await Promise.race([whenPulled(), new Promise((r) => setTimeout(r, PULL_WAIT_MS))])
  load()
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('answers')
      .select('test,item_id,value,answered_at').eq('user_id', id)
      .order('answered_at').range(from, from + PAGE - 1)
    if (error) { rebuilt(); return false } /* the document's state still shows */
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  const resp = { domain: [], type: [], words: [], books: [] }, seen = {}
  for (const r of rows) {
    const c = CORPUS[r.test]
    if (!c || !r.value) continue
    seen[rowKey(r)] = 1
    resp[c].push(r.value)
  }
  const b = box()
  let uploads = 0
  for (const c of CORPORA) {
    for (const e of S.resp[c] || []) {
      const row = rowFor(c, e, id)
      if (!row) { resp[c].push(e); continue }          /* legacy, unkeyed: local only */
      if (seen[rowKey(row)]) continue
      resp[c].push(e); b[rowKey(row)] = row; uploads++  /* local only: goes up */
    }
    resp[c].sort((a, b2) => (a.ts || 0) - (b2.ts || 0))
  }
  if (uploads) saveBox()
  /* the seen-counts follow from the answers */
  const ledger = { domain: {}, type: {}, words: {}, books: {} }
  for (const c of CORPORA) for (const e of resp[c]) {
    const k = itemOf(c, e)
    if (k != null) ledger[c][k] = (ledger[c][k] || 0) + 1
  }
  S.resp = resp
  S.ledger = ledger
  save()
  rebuilt()
  if (uploads) flush()
  return true
}

let started = false
/* called where the engine loads (the instrument), never from the main bundle */
export function initRecords() {
  if (started) return
  started = true
  setRecorder(record)
  /* a merge that changed the saved session (sign-in, or a focus pull bringing
     another device's answers) replaces the in-memory copy, so the sheet shows
     it and the next save carries it forward instead of overwriting it */
  onReconcile((keys) => { if (keys.indexOf(SESSION_KEY) >= 0) { load(); rebuilt() } })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushKeepalive() })
  window.addEventListener('pagehide', flushKeepalive)
  window.addEventListener('focus', () => { flush() })
  beforeSignOut.push(flush)
  /*
   * AND THE OTHER HALF: somebody arrived, so the answers that are theirs are read. Without it a
   * reader who signs in on the sheet is shown the blank session this browser had — their own
   * results are in the account's rows and nothing asks for them until a reload.
   *
   * It is the module's own registration rather than each surface's, which is why the hub no longer
   * carries one: two of them meant the rows were paged twice for one sign-in.
   */
  onIdentity((id) => { if (id) hydrate() })
}

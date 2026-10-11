/*
 * The queues: who is waiting on the business, whatever system holds them.
 *
 * Two adapters answer one shape (shape.js) and this file is the union of whichever of them the site
 * runs — the support desk and the clients' own conversations. It names a system nowhere but in the
 * table below, so adding a third is a file and a line, and taking one away is a module switch, which
 * is why `sourcesOn` is a rule and not an `if` in the surface.
 *
 * A space is deliberately not a queue. What waits in one is a mention or an unanswered direct
 * message, and each of those is a place of the person's own — a room is not a queue, and a member of
 * staff should not be handed one as though it were.
 *
 * Answering goes back through the adapter the row came from, so a support reply is an agent's line
 * under the desk's guards and a client's is a message under the coaching policies. Nothing moves
 * table and no policy is relaxed to make the list possible.
 *
 * Live is the cheap kind: the list is small and rebuilt whole, on a line landing in either of the
 * two tables a staff member may watch, and on coming back to the tab. Nothing here counts anything
 * or polls on a timer.
 */
import { ref, reactive, computed, watch } from 'vue'
import { supabase, configured } from '../supabase.js'
import { session, isStaff, beforeSignOut, onIdentity } from '../auth.js'
import { modules } from '#site'
import { sources as registeredSources } from '#site/desk'
import { products } from '#content'
import { tierRank } from '../storefront.js'
import { sourcesOn, sortDesk, deskBadge, filterDesk, sourcesIn, doneSet } from './shape.js'
import * as support from './support.js'
import * as coaching from './coaching.js'
import * as comments from './comments.js'

const EXTRA_ADAPTERS = Array.isArray(registeredSources) ? registeredSources : []
for (const adapter of EXTRA_ADAPTERS) {
  if (!adapter || typeof adapter.id !== 'string' || !adapter.id
    || typeof adapter.module !== 'string' || !adapter.module
    || ['support', 'coaching', 'comments'].includes(adapter.id)
    || typeof adapter.list !== 'function' || typeof adapter.messages !== 'function'
    || typeof adapter.send !== 'function' || typeof adapter.resolve !== 'function') {
    throw new Error('A registered Desk source must export a unique id and list, messages, send, and resolve operations.')
  }
}
const ADAPTERS = {
  support, coaching, comments,
  ...Object.fromEntries(EXTRA_ADAPTERS.map((adapter) => [adapter.id, adapter])),
}
const LAST_ROWS = new Map()

const on = () => !!(supabase && configured && session.value && isStaff.value)
const uid = () => (session.value && session.value.user && session.value.user.id) || null

export const rows = ref([])
export const loading = ref(false)
export const booted = ref(false)
export const sourceStatus = reactive({})
export const source = ref(null)        /* the one narrowing: a source, or all of them */
export const showDone = ref(false)     /* what is waiting, or what has been finished with */
export const agents = ref([])          /* who a support thread may be handed to */
export const thread = reactive({ row: null, messages: [], loading: false, error: null })

/* what the site runs; `spaces` is the desk's own module, so with it off there is no desk */
export const sources = computed(() => sourcesOn(modules, EXTRA_ADAPTERS))
export const has = computed(() => sourcesIn(rows.value))
export const shown = computed(() => sortDesk(filterDesk(rows.value, source.value, showDone.value)))
export const doneCount = computed(() => filterDesk(rows.value, source.value, true).length)
export const badge = (now = Date.now()) => deskBadge(rows.value, now)

/* the desk's own clock, from the same policy the escalation keeps */
const POLICY = Object.values(import.meta.glob('#content/desk-policy.json', { eager: true, import: 'default' }))[0] || {}

/* what this member of staff has finished with, for the two sources that keep no status of their own */
let marks = {}
async function loadMarks() {
  try {
    const { data } = await supabase.from('desk_done').select('source, ref, resolved_at').eq('user_id', uid())
    marks = doneSet(data || [])
  } catch (e) { marks = {} }
}

export async function load() {
  if (!on()) { rows.value = []; booted.value = true; return }
  loading.value = true
  try {
    await loadMarks()
    const want = sources.value
    const got = await Promise.all(want.map(async (name) => {
      try {
        return await gather(name)
      } catch (e) {
        console.warn('desk: ' + name + ' did not answer', e)
        const previous = LAST_ROWS.get(name) || []
        sourceStatus[name] = {
          state: 'unavailable',
          available: previous.length > 0,
          failures: 1,
          stale: previous.length > 0,
        }
        return previous.map((row) => ({ ...row, stale: true }))
      }
    }))
    rows.value = sortDesk(got.flat())
    /* the list is rebuilt whole, so the open conversation must be pointed at its new row or it would
       keep saying what was owed before it was answered */
    if (thread.row) thread.row = rows.value.find((r) => r.key === thread.row.key) || { ...thread.row, waiting_since: null, unread: 0 }
  } finally {
    loading.value = false
    booted.value = true
  }
}

async function gather(name) {
  let result
  if (name === 'support') result = support.rowsOf(await support.list(supabase), { wait: Number(POLICY.wait) || 0 })
  /* no promise: the desk's wait is how long somebody has been left without a REPLY, and a comment
     waiting to be decided is not overdue in fifteen minutes. It says how long it has waited. */
  else if (name === 'comments') result = comments.rowsOf(await comments.list(supabase), {})
  else if (name === 'coaching') result = coaching.rowsOf(await coaching.list(supabase), { products, rank: tierRank, me: uid(), marks })
  else if (EXTRA_ADAPTERS.some((adapter) => adapter.id === name)) {
    const response = await ADAPTERS[name].list(supabase, marks)
    const found = response.rows || []
    const failures = Array.isArray(response.failures) ? response.failures : []
    sourceStatus[name] = {
      state: response.state || (failures.length ? 'partial' : 'ready'),
      available: response.available ?? (response.availableAccounts > 0),
      failures: failures.length,
      stale: false,
    }
    LAST_ROWS.set(name, found)
    return found
  } else {
    throw new Error('The Desk source is not registered: ' + name)
  }
  sourceStatus[name] = { state: 'ready', available: true, failures: 0, stale: false }
  LAST_ROWS.set(name, result)
  return result
}

const adapterRef = (row) => row && row.source === 'social' ? row : row && row.id

/* ------------------------------------------------------------------ one conversation */

export async function openRow(row) {
  thread.row = row || null
  thread.messages = []
  thread.error = null
  if (!on() || !row) return
  thread.loading = true
  try {
    thread.messages = await ADAPTERS[row.source].messages(supabase, adapterRef(row), uid())
    await markRead(row)
  } catch (e) {
    thread.error = e
  } finally {
    thread.loading = false
  }
}

export function closeRow() { thread.row = null; thread.messages = []; thread.error = null }

export async function reply(body) {
  const row = thread.row
  const text = String(body || '').trim()
  if (!on() || !row || !text) return null
  if (row.canReply === false) {
    thread.error = new Error('This Social account is read-only.')
    return null
  }
  const temp = { id: 'tmp-' + Math.random().toString(36).slice(2), body: text, kind: 'text', created_at: new Date().toISOString(), mine: true, pending: true }
  thread.messages = thread.messages.concat([temp])
  try {
    const id = await ADAPTERS[row.source].send(supabase, adapterRef(row), text, uid())
    thread.messages = thread.messages.map((m) => (m.id === temp.id ? { ...m, id: id || m.id, pending: false } : m))
    /* answered: the row stops waiting, here and on the next rebuild alike */
    const held = rows.value.find((r) => r.key === row.key)
    if (held) { held.waiting_since = null; held.unread = 0; held.last = { body: text, at: temp.created_at, mine: true } }
    return id
  } catch (e) {
    thread.messages = thread.messages.filter((m) => m.id !== temp.id)
    thread.error = e
    return null
  }
}

/* THE SAME REPLY, WITH SOMETHING ATTACHED. A queue answers with whatever the conversation it is
   answering can carry — a picture of the bent corner, the invoice, a voice note — and each source
   puts it where that source keeps such things: the desk's own private bucket, the coaching thread's
   own. The row appears at once and is exchanged for the real one, exactly as a line of words is. */
export async function replyWith(file, { kind = 'file', seconds = 0, said = '' } = {}) {
  const row = thread.row
  if (!on() || !row || !file) return null
  const adapter = ADAPTERS[row.source]
  if (!adapter || !adapter.sendFile) return null
  const temp = {
    id: 'tmp-' + Math.random().toString(36).slice(2), kind, body: said || (kind === 'file' ? file.name : null),
    name: kind === 'voice' ? 'voice.mp3' : file.name, type: kind === 'voice' ? 'audio/mpeg' : file.type,
    size: file.size, seconds: kind === 'voice' ? seconds : null,
    /* what this browser just made plays and shows from the bytes in hand, with no round trip */
    url: kind === 'file' ? URL.createObjectURL(file) : null, blob: kind === 'voice' ? file : null,
    created_at: new Date().toISOString(), mine: true, pending: true,
  }
  thread.messages = thread.messages.concat([temp])
  try {
    const made = await adapter.sendFile(supabase, row.id, file, uid(), { kind, seconds, said })
    thread.messages = thread.messages.map((m) => (m.id === temp.id ? { ...m, ...made, id: (made && made.id) || m.id, url: temp.url, blob: temp.blob, pending: false } : m))
    const held = rows.value.find((r) => r.key === row.key)
    if (held) { held.waiting_since = null; held.unread = 0; held.last = { body: temp.body, at: temp.created_at, mine: true, kind } }
    return made
  } catch (e) {
    thread.messages = thread.messages.filter((m) => m.id !== temp.id)
    thread.error = e
    return null
  }
}

/* finished with, or back on the list — written through the system that holds it where that system
   has a status of its own, and kept as this person's own mark where it does not */
export async function resolve(row, done = true) {
  if (!on() || !row) return
  try {
    await ADAPTERS[row.source].resolve(supabase, adapterRef(row), done, uid())
  } catch (e) {
    thread.error = e
    return
  }
  const held = rows.value.find((r) => r.key === row.key)
  if (held) { held.resolved = !!done; if (done) held.waiting_since = null }
  if (thread.row && thread.row.key === row.key) thread.row = held || { ...row, resolved: !!done }
  soon()
}

/* one source keeps an assignee of its own; the others are not asked to pretend they do */
export const mayAssign = (row) => !!row && row.source === 'support'
export async function assign(row, userId) {
  if (!on() || !mayAssign(row)) return
  try { await support.assign(supabase, row.id, userId) } catch (e) { thread.error = e; return }
  const held = rows.value.find((r) => r.key === row.key)
  if (held) held.assignee = userId || null
  soon()
}

export async function loadAgents() {
  if (!on()) return
  try { const { data } = await supabase.rpc('support_agents'); agents.value = data || [] } catch (e) { agents.value = [] }
}

export async function markRead(row) {
  if (!on() || !row) return
  try { await ADAPTERS[row.source].read(supabase, row.id, uid(), row.seq) } catch (e) { /* a courtesy */ }
  const held = rows.value.find((r) => r.key === row.key)
  if (held) held.unread = 0
}

/* ------------------------------------------------------------------ live */

let live = null
let again = null
const soon = () => { clearTimeout(again); again = setTimeout(() => load(), 400) }

export function start() {
  if (!on() || live) return
  load()
  live = supabase.channel('desk:' + uid())
  if (sources.value.includes('support')) live.on('postgres_changes', { event: '*', schema: 'public', table: 'support_messages' }, soon)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'support_conversations' }, soon)
  if (sources.value.includes('coaching')) live.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, soon)
  live.subscribe()
}

export function stop() {
  clearTimeout(again)
  if (live) { supabase.removeChannel(live); live = null }
}

const forget = () => { stop(); rows.value = []; booted.value = false; closeRow() }
beforeSignOut.push(forget)
/* the other half, and only for somebody who answers a queue: isStaff is already settled when the
   identity is broadcast, which is the whole reason the broadcast waits for the role to answer */
onIdentity((id) => { forget(); if (id && isStaff.value) load() })

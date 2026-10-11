/*
 * TICKETS — the work, as against the conversation.
 *
 * A chat is a conversation: it starts when somebody writes in, it wanders, it goes quiet. A ticket
 * is a piece of WORK: it has a state, somebody owns it, and it is not finished until it is
 * finished. The two come apart constantly — a ticket outlives its chat while a carrier takes three
 * weeks to answer; one chat throws up two tickets; the staff raise a ticket nobody reported — so
 * they are separate rows with an optional, many-to-many link, and this module is how a surface
 * asks about them.
 *
 * The arithmetic is pure, lives in shape.js with the rest of the desk's own and is pinned by
 * build/tickets.test.mjs — what a ticket's state is worth in an ordering, what is owed on one, how
 * long it has been open, how a list narrows — and is re-exported here so a surface has one place
 * to ask. The reads are the database's, and every write goes through a function there, because a status change is both a
 * column and a line on the timeline and a surface that writes one without the other leaves a
 * ticket whose history does not explain its state.
 */
import { reactive, ref } from 'vue'
import { supabase } from '../supabase.js'
/* the arithmetic lives with the rest of the desk's own, where a test reads it without a browser */
export { STATES, LIVE, PRIORITIES, isLive, isOwed, sortTickets, owedOn, ageOf, tally, narrow, statusOfTicket, priorityOf, WAS } from './shape.js'

/* ------------------------------------------------------------------ the reads */

export const tickets = reactive({ list: [], open: null, loading: false, error: null })
export const ticketsOn = ref(false)

export async function loadTickets({ status = null, assignee = null, q = null, limit = 200 } = {}) {
  if (!supabase) return []
  tickets.loading = true
  try {
    const { data, error } = await supabase.rpc('support_tickets_list', { p_status: status, p_assignee: assignee, p_q: q, p_limit: limit })
    if (error) throw error
    tickets.list = data || []
    ticketsOn.value = true
    return tickets.list
  } catch (e) {
    tickets.list = []
    ticketsOn.value = false
    return []
  } finally { tickets.loading = false }
}

export async function openTicket(id) {
  if (!supabase || !id) { tickets.open = null; return null }
  const { data } = await supabase.rpc('support_ticket', { p_ticket: id })
  tickets.open = data || null
  return tickets.open
}

export const closeTicket = () => { tickets.open = null }

/* EVERY ANSWER ACROSS THE OPEN TICKETS: a field, a value, and how many carry it. The desk offers
   whatever the site asked for, which is why it asks the database rather than holding a list. */
export async function answerValues(open = true) {
  if (!supabase) return []
  const { data } = await supabase.rpc('ticket_answer_values', { p_open: open })
  return data || []
}

/* ------------------------------------------------------------------ the writes */

const after = async (id) => { if (id) await openTicket(id); await loadTickets() }

export async function raise({ title, body = '', contact = null, priority = 'normal', category = null, conversation = null, assign = null } = {}) {
  if (!supabase) return { error: 'offline' }
  const { data, error } = await supabase.rpc('support_ticket_open', {
    p_title: title, p_body: body, p_contact: contact, p_priority: priority,
    p_category: category, p_conversation: conversation, p_assign: assign,
  })
  if (error) return { error: error.message }
  await loadTickets()
  return data || {}
}

export async function setTicket(id, patch = {}) {
  if (!supabase) return { error: 'offline' }
  const { data, error } = await supabase.rpc('support_ticket_set', {
    p_ticket: id,
    p_status: patch.status ?? null, p_priority: patch.priority ?? null,
    p_title: patch.title ?? null, p_category: patch.category ?? null,
    p_due: patch.due ?? null, p_clear_due: !!patch.clearDue,
  })
  if (error) return { error: error.message }
  await after(id)
  return data || {}
}

export async function assignTicket(id, userId, on = true) {
  if (!supabase) return { error: 'offline' }
  const { data, error } = await supabase.rpc('support_ticket_assign', { p_ticket: id, p_user: userId, p_on: on })
  if (error) return { error: error.message }
  await after(id)
  return data || {}
}

export async function sayOnTicket(id, body, internal = false) {
  if (!supabase) return { error: 'offline' }
  const { data, error } = await supabase.rpc('support_ticket_say', { p_ticket: id, p_body: body, p_internal: internal })
  if (error) return { error: error.message }
  await after(id)
  return data || {}
}

export async function linkTicket(id, conversationId, on = true) {
  if (!supabase) return { error: 'offline' }
  const { data, error } = await supabase.rpc('support_ticket_link', { p_ticket: id, p_conversation: conversationId, p_on: on })
  if (error) return { error: error.message }
  await after(id)
  return data || {}
}

/* the tickets one conversation has thrown up, for the chat's own side panel */
export async function ticketsFor(conversationId) {
  if (!supabase || !conversationId) return []
  const { data } = await supabase.rpc('support_tickets_for', { p_conversation: conversationId })
  return data || []
}

/* ------------------------------------------------------------------ a person's own */

export const mine = reactive({ list: [], open: null, loading: false })

export async function loadMyTickets() {
  if (!supabase) return []
  mine.loading = true
  try {
    const { data } = await supabase.rpc('support_tickets_mine')
    mine.list = data || []
    return mine.list
  } catch { mine.list = []; return [] } finally { mine.loading = false }
}

export async function openMyTicket(id) {
  if (!supabase || !id) { mine.open = null; return null }
  const { data } = await supabase.rpc('support_ticket_mine', { p_ticket: id })
  mine.open = data || null
  return mine.open
}

export async function myOpenCount() {
  if (!supabase) return 0
  try { const { data } = await supabase.rpc('support_tickets_mine_open'); return Number(data) || 0 } catch { return 0 }
}

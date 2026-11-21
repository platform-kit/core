/*
 * WHERE THE READER STANDS WITH AN OFFER THAT GATES ITS CHECKOUT (openspec: applications-and-intro-calls).
 *
 * An offer's `before` block may require an application, a call, or both before its checkout opens. The pricing card
 * and the offer's checkout page ask `stateOf(offer)` what to show in place of the buy button: Buy, Apply, Book a
 * call, Application sent, Checkout open, Declined. The reader's own admissions come from `my_admissions()`
 * (47-admissions.sql), read on sign-in. The reviewers' queue goes through the `admissions` function.
 */
import { ref, watch } from 'vue'
import { supabase, configured } from './supabase.js'
import { isSignedIn, onIdentity } from './auth.js'

export type Admission = { sku: string; status: string; note: string | null; open_until: string | null; booked: boolean }
export const admissions = ref<Record<string, Admission>>({})

export async function loadAdmissions() {
  if (!configured || !isSignedIn.value) { admissions.value = {}; return }
  const { data } = await supabase!.rpc('my_admissions')
  admissions.value = Object.fromEntries(((data as Admission[]) || []).map((a) => [a.sku, a]))
}
onIdentity(loadAdmissions)
/* and for a reader already signed in when this is first imported */
watch(isSignedIn, () => { loadAdmissions() }, { immediate: true })

export type Gate = { call?: string; 'call-required'?: boolean; apply?: string; review?: 'person' | 'none'; 'open-for'?: string }
export const gateOf = (offer: any): Gate | null => (offer && offer.before) || null
/* whether checkout is closed to the reader until something comes first */
export const isGated = (offer: any) => { const g = gateOf(offer); return !!g && (!!g.apply || (!!g.call && g['call-required'] === true)) }

/* what the offer's button should be for this reader */
export type State = 'buy' | 'apply' | 'call' | 'sent' | 'booked' | 'open' | 'declined' | 'closed'
export function stateOf(offer: any): State {
  if (!isGated(offer)) return 'buy'
  const g = gateOf(offer)!
  const a = offer && admissions.value[offer.sku]
  if (!a) return g.apply ? 'apply' : 'call'
  if (a.status === 'open') return 'open'
  if (a.status === 'used') return 'buy'
  if (a.status === 'declined') return 'declined'
  if (a.status === 'closed' || a.status === 'expired') return 'closed'
  if (a.status === 'approved') return g.call && g['call-required'] ? 'call' : 'sent'
  if (a.status === 'booked') return 'booked'
  return 'sent'
}
export const applyHref = (offer: any) => `/apply/${encodeURIComponent(offer.sku)}?offer=${encodeURIComponent(offer.sku)}`
export const callHref = (offer: any) => { const g = gateOf(offer); return g && g.call ? `/book/${encodeURIComponent(g.call)}` : '' }

/* the reviewers' queue */
export async function listApplications(status = '') {
  const { data, error } = await supabase!.functions.invoke('admissions', { body: { op: 'list', status } })
  if (error) throw error
  return (data && data.items) || []
}
export async function decideApplication(id: string, act: 'approve' | 'decline' | 'close' | 'reopen', note = '') {
  const { data, error } = await supabase!.functions.invoke('admissions', { body: { op: 'decide', id, act, note } })
  if (error) throw error
  return data
}

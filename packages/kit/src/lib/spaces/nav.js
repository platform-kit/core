/*
 * Whether this reader is in any space at all, and what is owed them there — the header's Channels
 * button and its badge. Kept light on purpose: SiteLayout mounts on every page, so this imports
 * none of the surface's machinery and holds no socket per channel. One read (space_unread, which
 * answers an empty list to anyone who is in nothing) on sign-in and on returning to the tab, and
 * the counters it already returns are the badge — nothing here counts anything.
 */
import { ref, watch } from 'vue'
import { supabase, configured } from '../supabase.js'
import { session } from '../auth.js'
import { badgeOf, waitingOf } from './model.js'

export const inSpaces = ref(false)   /* they are in at least one room */
export const mentions = ref(0)       /* what is owed them across all of them */
export const waiting = ref(0)        /* ONE number for the header: DMs unread + every mention */

let started = false

export async function refresh() {
  if (!supabase || !configured || !session.value) { inSpaces.value = false; mentions.value = 0; waiting.value = 0; return }
  try {
    const { data, error } = await supabase.rpc('space_unread')
    if (error) return
    const rows = data || []
    inSpaces.value = rows.length > 0
    mentions.value = badgeOf(rows).mentions
    waiting.value = waitingOf(rows)
  } catch (e) { /* offline: keep what we had */ }
}

export function startSpacesWatch() {
  if (started || !supabase || !configured) return
  started = true
  watch(session, (s) => { if (s) refresh(); else { inSpaces.value = false; mentions.value = 0; waiting.value = 0 } }, { immediate: true })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session.value) refresh() })
}

/*
 * How many messages await the signed-in reader, across every conversation —
 * the number on the header's chat button. Kept light on purpose: SiteLayout
 * mounts on every page, so this imports no player and no recorder. The count
 * comes from chat_unread() on sign-in, on return to the tab, and whenever a
 * message row arrives on the reader's own realtime listener (RLS narrows the
 * stream to conversations they are in); the open thread bumps it directly.
 */
import { ref, watch } from 'vue'
import { supabase, configured } from '../supabase.js'
import { session, isProvider, canAccess } from '../auth.js'

export const unread = ref(0)

let channel = null
let started = false
let timer = null

/* whether the chat is for this reader at all: a coach, or a member */
export const chatOn = () => !!session.value && (isProvider.value || canAccess('subscribed'))

export async function refresh() {
  if (!supabase || !configured || !session.value) { unread.value = 0; return }
  try {
    const { data, error } = await supabase.rpc('chat_unread')
    if (!error) unread.value = Number(data) || 0
  } catch (e) { /* offline: keep the last count */ }
}
export function bump(n) { unread.value = Math.max(0, unread.value + (n || 0)) }

function listen() {
  if (channel || !supabase || !session.value) return
  channel = supabase.channel('chat:unread')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: row }) => {
      if (row.sender_id === session.value.user.id) return
      /* a beat later, so the open thread's own read mark (if any) has landed first */
      clearTimeout(timer); timer = setTimeout(refresh, 400)
    })
    /* counted again once the channel is up: a message that landed between the
       first count and the join would otherwise wait for the next return to the tab */
    .subscribe((status) => { if (status === 'SUBSCRIBED') refresh() })
}
function unlisten() {
  if (channel) { try { supabase.removeChannel(channel) } catch (e) { /* gone */ } channel = null }
}

export function startUnreadWatch() {
  if (started || !supabase || !configured) return
  started = true
  watch(session, (s) => { if (s) { refresh(); listen() } else { unread.value = 0; unlisten() } }, { immediate: true })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session.value) refresh() })
}

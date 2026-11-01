/*
 * What the header needs of the network: whether to offer it, and how much has happened to the
 * reader since they last looked. Light on purpose — SiteLayout mounts on every page — so this
 * imports none of the store: one read on sign-in and on returning to the tab — the community's one
 * list (community_unread, 98-community.sql) where the spaces are on, else the network's own.
 */
import { ref, watch } from 'vue'
import { supabase, configured } from '../supabase.js'
import { session } from '../auth.js'
import { moduleOn } from '../modules.js'

const READ = moduleOn('spaces') ? 'community_unread' : 'network_unread'

export const unread = ref(0)
let started = false

export async function refresh() {
  if (!supabase || !configured || !session.value) { unread.value = 0; return }
  try {
    const { data, error } = await supabase.rpc(READ)
    if (!error) unread.value = Number(data) || 0
  } catch (e) { /* offline: keep what we had */ }
}

export function startNetworkWatch() {
  if (started || !supabase || !configured) return
  started = true
  watch(session, (s) => { if (s) refresh(); else unread.value = 0 }, { immediate: true })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session.value) refresh() })
}

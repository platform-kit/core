<script setup>
/*
 * THE COACHING CHAT, as a panel — the two panes and everything between them, with no opinion about
 * where it is mounted.
 *
 * A member talks to a coach in one conversation per pair, and a business chooses which surface that
 * happens in (platformkit.config.js coaching.where, the chat and the booking together): the results sheet's own Chat tab, or the
 * community, beside everything else the person is already reading. It is the same conversation
 * either way — the same tables, the same policies, the same unread count — so it is one component,
 * and the two hosts differ only in what surrounds it:
 *
 *   ChatPage.vue        the sheet's tab: the gates in front of it, a card on the sheet's ground,
 *                       sized to what the viewport leaves under the tabs, and the open conversation
 *                       in the address (/app/chat/<id>).
 *   SpaceCoaching.vue   the community's place: the surface's own pane, no card, no address of its
 *                       own — the pane already says where you are.
 *
 * 'home' decides that last difference. Given one, the open conversation lives in the address and
 * this navigates; given none, it is held here. Nothing else in the component knows which host it is
 * in. Words: chat.md page.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import ChatList from './ChatList.vue'
import ChatThread from './ChatThread.vue'
import ChatNewMessage from './ChatNewMessage.vue'
import { route, navigate, replace } from '../../router.js'
import { us } from '@platform-kit/kit/lib/content.js'
import { supabase, configured } from '@platform-kit/kit/lib/supabase.js'
import { session, user, canAccess, isProvider } from '@platform-kit/kit/lib/auth.js'
import { inbox, people, loadingInbox, loadInbox, loadPeople, open } from '@platform-kit/kit/lib/chat/api.js'
import { unread, refresh as refreshUnread } from '@platform-kit/kit/lib/chat/unread.js'

const props = defineProps({
  /* the base path the open conversation hangs off, when the host keeps it in the address */
  home: { type: String, default: '' },
})
const emit = defineEmits(['ready'])
const P = us('chat').page.main

const ready = ref(false)      /* the session is known, so no gate flashes in the host */
const coach = ref(false)
const held = ref('')          /* the open conversation, when the host has no address for one */
const me = computed(() => (user.value ? user.value.id : ''))
const activeId = computed(() => {
  if (!props.home) return held.value || null
  const m = new RegExp('^' + props.home + '/([0-9a-f-]{36})$').exec(route.value)
  return m ? m[1] : null
})
/* who may write: a coach, a member, and somebody whose paid session's week is still running — the
   coaches they have one with, read from their bookings (chat_session_coaches); the database holds the
   same rule on every line sent (chat_may_send) */
const sessionCoaches = ref([])
watch(me, async (id) => {
  sessionCoaches.value = []
  if (!id || !configured) return
  const { data } = await supabase.rpc('chat_session_coaches')
  if (me.value === id) sessionCoaches.value = Array.isArray(data) ? data : []
}, { immediate: true })
const allowed = computed(() => coach.value || canAccess('subscribed') || sessionCoaches.value.length > 0)
/* what the host should put in front of this, or nothing. Decided here because the answer depends on
   what the inbox turned out to hold: somebody whose membership lapsed still reads what was said. */
const gate = computed(() => {
  if (!ready.value) return null
  if (!session.value) return 'authenticated'
  if (!allowed.value && !inbox.value.length) return 'subscribed'
  return null
})
defineExpose({ gate, ready })
const active = computed(() => inbox.value.find((c) => c.id === activeId.value) || null)

const narrow = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 819px)').matches)
let mq = null

const names = computed(() => {
  const by = {}
  for (const p of people.value) by[p.id] = p.name
  for (const c of inbox.value) if (c.peer) by[c.peer.id] = c.peer.name
  return by
})
const nameOf = (id) => (id === me.value ? P.you : names.value[id] || '')

/* whether this person answers as a coach is the capability and nothing else: auth.js has already
   read the profile's roles for this session. */
async function roleCheck() { coach.value = isProvider.value }

async function boot() {
  if (!configured) { ready.value = true; emit('ready'); return }
  try { await supabase.auth.getSession() } catch (e) { /* offline */ }
  if (session.value) {
    await Promise.all([roleCheck(), loadInbox(), loadPeople()])
    /* one coach and nothing said yet: straight in */
    const coaches = people.value.filter((p) => (p.roles || []).includes('provider') || (p.roles || []).includes('coach'))
    if (!coach.value && allowed.value && !inbox.value.length && coaches.length === 1 && !activeId.value) {
      const id = await open(coaches[0].id).catch(() => null)
      if (id) go(id, true)
    } else if (!activeId.value && !narrow.value && inbox.value.length === 1) {
      go(inbox.value[0].id, true)
    }
  }
  ready.value = true
  emit('ready')
}

/* the one place the two hosts differ */
function go(id, quietly = false) {
  if (!props.home) { held.value = id; return }
  ;(quietly ? replace : navigate)(props.home + '/' + id)
}
function back() { if (props.home) navigate(props.home); else held.value = '' }

onMounted(() => {
  mq = window.matchMedia('(max-width: 819px)')
  mq.addEventListener('change', (e) => { narrow.value = e.matches })
  boot()
})
onBeforeUnmount(() => { refreshUnread() })
watch(session, (s, was) => { if (!!s !== !!was) { ready.value = false; boot() } })
/* a message in any conversation moves the count; the list follows it */
watch(unread, () => { if (ready.value && session.value) loadInbox() })

/* the picker: a coach choosing whom to write to */
const picking = ref(false)
function picked(m) { picking.value = false; if (m.conversation_id) go(m.conversation_id); else start(m.id) }
async function start(peerId) {
  const id = await open(peerId).catch(() => null)
  if (id) go(id)
}
</script>

<template>
  <div class="cpan" :class="{ narrow, open: !!activeId }">
    <aside v-show="!narrow || !activeId" class="cpan-list">
      <ChatList :coach="coach" :conversations="inbox" :people="people" :active-id="activeId" :me="me" :loading="loadingInbox"
                @pick="go" @start="start" @new="picking = true" />
    </aside>
    <main v-show="!narrow || activeId" class="cpan-main">
      <ChatThread v-if="activeId" :key="activeId" :id="activeId" :me="me" :peer="active ? active.peer : null" :can-write="allowed"
                  :name-of="nameOf" :show-back="narrow" @back="back" />
      <div v-else class="cpan-empty">
        <svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M8 12a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H20l-8 7v-7a4 4 0 0 1-4-4z"/><path d="M16 17h16M16 23h10"/>
        </svg>
        <p>{{ P['empty-thread'] }}</p>
      </div>
    </main>
    <ChatNewMessage v-if="picking" @pick="picked" @close="picking = false" />
  </div>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; every class here says what it wants instead */
.cpan { height: 100%; min-height: 0; display: grid; grid-template-columns: minmax(280px, 340px) minmax(0, 1fr) }
.cpan-list { min-height: 0; border-right: 1px solid var(--hair) }
.cpan-main { min-height: 0; min-width: 0 }
.cpan-empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--ink3) }
.cpan-empty p { margin: 0; font-size: 15px }
@media (max-width: 819px) {
  .cpan { grid-template-columns: minmax(0, 1fr) }
  .cpan-list { border-right: 0 }
}
</style>

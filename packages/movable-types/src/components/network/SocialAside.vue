<script setup>
/*
 * BESIDE THE COLUMN IN THE SOCIAL LAYOUT — what is coming up for this reader: the next events across
 * every space they are in, and their own sessions — the ones they booked and the ones they give —
 * merged by time, each a way to its page, and nothing else (streamline-social-layout,
 * space-places-in-the-nav). Where nothing is coming up
 * it draws nothing, and the page lets the column stand alone. A thread or a person's card takes this
 * place while it is open. People are found from the header's Search; a space is pinned to Home from
 * its own header. Words from network.md (shell) and spaces.md (calendar).
 */
import { ref, computed, onMounted, watch } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { supabase, configured } from '@platform-kit/kit/lib/supabase.js'
import { user } from '@platform-kit/kit/lib/auth.js'
import { moduleOn } from '@platform-kit/kit/lib/modules.js'
import { loadCalendar, calendar, whenWord, clockOf } from '@platform-kit/kit/lib/spaces/calendar.js'

const emit = defineEmits(['events', 'event', 'session'])
const S = computed(() => us('network').shell.main)
const C = computed(() => us('spaces').calendar.main)
const now = new Date()

/* THE READER'S OWN SESSIONS, attended or given. An administrator may read every booking, so the
   rows are narrowed to the reader's own here rather than trusted to the policy alone. */
const sessions = ref([])
async function loadSessions() {
  const me = user.value && user.value.id
  if (!me || !configured || !moduleOn('sessions')) { sessions.value = []; return }
  try {
    const { data } = await supabase.from('bookings').select('uid, title, start_at, end_at, status, user_id, provider_id, host_id')
      .in('status', ['accepted', 'pending']).gt('end_at', new Date().toISOString()).order('start_at').limit(20)
    sessions.value = (data || []).filter((b) => b.user_id === me || b.host_id === me || b.provider_id === me)
  } catch (e) { sessions.value = [] }
}
/* one list, by time: an event is a way to its page, a session a way to the reader's sessions */
const next = computed(() => [
  ...(calendar.upcoming || []).map((o) => ({ kind: 'event', key: 'e' + o.id, at: o.starts_at, title: o.title, slug: o.slug })),
  ...sessions.value.map((b) => ({ kind: 'session', key: 's' + b.uid, at: b.start_at, title: b.title, hosting: b.user_id !== (user.value || {}).id })),
].sort((a, b) => new Date(a.at) - new Date(b.at)).slice(0, 4))
const titleWord = computed(() => (sessions.value.length ? S.value['coming-up'] : S.value.events))
onMounted(() => { loadCalendar(null, { days: 60, limit: 20 }).catch(() => {}); loadSessions() })
watch(() => user.value && user.value.id, loadSessions)
</script>

<template>
  <div class="sa" :class="{ 'sa-none': !next.length }">
    <div v-if="next.length" class="sa-card">
      <button type="button" class="sa-title" @click="emit('events')">{{ titleWord }}</button>
      <ul>
        <li v-for="o in next" :key="o.key">
          <button type="button" class="sa-row" :class="{ 'sa-session': o.kind === 'session' }" @click="o.kind === 'event' ? emit('event', o.slug) : emit('session')">
            <span class="sa-date"><b>{{ new Date(o.at).getDate() }}</b><small>{{ new Date(o.at).toLocaleString(undefined, { month: 'short' }) }}</small></span>
            <span class="sa-what"><b>{{ o.title }}</b><small>{{ whenWord(o.at, now, { today: C.today, tomorrow: C.tomorrow }) }} · {{ clockOf(o.at) }}<template v-if="o.kind === 'session'"> · {{ o.hosting ? S['aside-hosting'] : S['aside-session'] }}</template></small></span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.sa { height: 100%; overflow-y: auto; padding: 16px 16px 24px; box-sizing: border-box; display: flex; flex-direction: column; gap: 16px }
.sa-card { padding: 14px 0 8px; border: 1px solid color-mix(in srgb, var(--ink) 9%, transparent); border-radius: 18px; background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 3.5%, var(--paper)) 0%, var(--paper) 55%); box-shadow: 0 1px 2px color-mix(in srgb, var(--ink) 4%, transparent), 0 10px 28px -20px color-mix(in srgb, var(--ink) 35%, transparent); animation: sa-in .45s cubic-bezier(.2, .8, .2, 1) both; animation-delay: .12s }
@keyframes sa-in { from { opacity: 0; transform: translateY(8px) } }
@media (prefers-reduced-motion: reduce) { .sa-card { animation: none } }
.sa-row { transition: background .2s cubic-bezier(.2, .8, .2, 1) }
.sa-title { display: block; margin: 0 16px 6px; padding: 0; border: 0; background: transparent; font-family: var(--fd); font-size: 19px; font-weight: 800; color: var(--ink); cursor: pointer }
.sa-card ul { list-style: none; margin: 0; padding: 0 }
.sa-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 0 16px 6px }
.sa-head .sa-title { margin: 0 }
.sa-static { cursor: default }
.sa-link { padding: 0; border: 0; background: none; font: inherit; font-size: 13.5px; font-weight: 600; color: var(--accent); cursor: pointer }
.sa-link:hover { text-decoration: underline }
.sa-none { margin: 0 16px 10px; font-size: 14px; color: var(--ink3) }
.sa-row.on { background: color-mix(in srgb, var(--accent) 8%, transparent) }
.sa-mark { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; color: #fff; font-weight: 800; font-size: 16px; text-transform: uppercase;
  background: linear-gradient(140deg, color-mix(in srgb, var(--accent) 70%, #fff) 0%, var(--accent) 55%, color-mix(in srgb, var(--accent) 80%, #000) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .25), 0 2px 6px -2px color-mix(in srgb, var(--accent) 60%, transparent) }
.sa-row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px 16px; border: 0; background: transparent; text-align: left; cursor: pointer; font: inherit }
.sa-row:hover { background: color-mix(in srgb, var(--ink) 4%, transparent) }
.sa-date { flex: none; display: grid; place-items: center; align-content: center; gap: 2px; width: 44px; height: 48px; border-radius: 12px; color: var(--accent); line-height: 1;
  background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 16%, var(--paper)), color-mix(in srgb, var(--accent) 6%, var(--paper))); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 14%, transparent) }
.sa-date b { font-size: 18px; font-weight: 800 }
/* a session wears the ink rather than the accent: it is the reader's own appointment, not a place */
.sa-session .sa-date { color: var(--ink2); background: color-mix(in srgb, var(--ink) 6%, var(--paper)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 10%, transparent) }
.sa-date small { font-size: 11px; font-weight: 700; text-transform: uppercase }
.sa-what { display: flex; flex-direction: column; min-width: 0 }
.sa-what b { font-size: 14.5px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sa-what small { font-size: 13px; color: var(--ink3) }
</style>

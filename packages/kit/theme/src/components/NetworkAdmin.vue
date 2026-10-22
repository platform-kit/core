<script setup>
/*
 * THE NETWORK'S MODERATION, for the people responsible for it — the site's administrators, since
 * the network belongs to no space (93-network.sql network_moderator). Two views, one at a time:
 *
 *   Reports     every report not yet answered, newest first: the post as its author wrote it
 *               (a moderator reads a removed one too), who reported it and why, and the three
 *               answers — remove the post, suspend its author for a span, or dismiss it.
 *   Suspended   every suspension still in force, with who made it and until when, and Lift.
 *
 * Every answer is a function that writes a record nobody edits (network_remove_post,
 * network_suspend, network_lift); this page decides nothing and judges nothing by machine.
 * Words from network.md (admin).
 */
import { ref, computed, onMounted, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { supabase, configured } from 'platformkit/lib/supabase.js'
import { isSignedIn, isAdmin, roleKnown } from 'platformkit/lib/auth.js'
import { net, loadPeople, loadPosts } from 'platformkit/lib/network/api.js'
import { agoOf } from 'platformkit/lib/network/model.js'
import AdminHead from './admin/AdminHead.vue'
import NetPost from './network/NetPost.vue'

const W = computed(() => us('network').admin.main)
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const tab = ref('reports')
const state = ref('idle')   /* idle | loading | ok | denied | error */
const reports = ref([])
const suspended = ref([])
const busy = ref('')
const SPANS = [['day', 1], ['week', 7], ['month', 30], ['ever', 0]]

const nameOf = (id) => { const p = net.people[id]; return (p && (p.name || p.username)) || us('network').post.main.someone }

async function load() {
  if (!configured || !isSignedIn.value) { state.value = 'idle'; return }
  if (roleKnown.value && !isAdmin.value) { state.value = 'denied'; return }
  if (state.value !== 'ok') state.value = 'loading'
  const [r, s, l] = await Promise.all([
    supabase.from('network_moderation').select('*').eq('kind', 'report').is('answered_at', null).order('created_at', { ascending: false }).limit(200),
    supabase.from('network_moderation').select('*').eq('kind', 'suspend').order('created_at', { ascending: false }).limit(200),
    supabase.from('network_moderation').select('lifts_id').eq('kind', 'lift'),
  ])
  if (r.error || s.error) { state.value = /permission|denied/i.test((r.error || s.error).message || '') ? 'denied' : 'error'; return }
  const lifted = new Set((l.data || []).map((x) => x.lifts_id))
  const now = Date.now()
  reports.value = r.data || []
  suspended.value = (s.data || []).filter((x) => !lifted.has(x.id) && (!x.until || new Date(x.until).getTime() > now))
  await Promise.all([
    loadPosts(reports.value.map((x) => x.post_id).filter(Boolean)),
    loadPeople([...reports.value, ...suspended.value].flatMap((x) => [x.actor_id, x.subject_id])),
  ])
  state.value = 'ok'
}
onMounted(load)
watch([isSignedIn, roleKnown], load)

async function run(key, fn, args) {
  busy.value = key
  try { const { error } = await supabase.rpc(fn, args); if (error) throw error; await load() }
  catch (e) { state.value = 'error' } finally { busy.value = '' }
}
const remove = (r) => run(r.id, 'network_remove_post', { p_post: r.post_id, p_reason: r.reason })
const suspend = (r, days) => run(r.id, 'network_suspend', { p_person: r.subject_id, p_until: days ? new Date(Date.now() + days * 86400000).toISOString() : null, p_reason: r.reason })
const dismiss = (r) => run(r.id, 'network_lift', { p_act: r.id, p_reason: null })
const lift = (s) => run(s.id, 'network_lift', { p_act: s.id, p_reason: null })
const reasonWord = (k) => W.value['reason-' + k] || k
const untilWord = (s) => (s.until ? fill(W.value.until, { when: new Date(s.until).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) }) : W.value['for-good'])
</script>

<template>
  <div class="ui-page nwa">
    <AdminHead :title="W.title" :sub="W.subtitle" />
    <p v-if="state === 'denied'" class="nwa-note">{{ W.denied }}</p>
    <p v-else-if="state === 'error'" class="nwa-note">{{ W.error }}</p>
    <template v-else>
      <div class="nwa-tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="tab === 'reports'" :class="{ on: tab === 'reports' }" @click="tab = 'reports'">{{ W['tab-reports'] }}<em v-if="reports.length">{{ reports.length }}</em></button>
        <button type="button" role="tab" :aria-selected="tab === 'suspended'" :class="{ on: tab === 'suspended' }" @click="tab = 'suspended'">{{ W['tab-suspended'] }}<em v-if="suspended.length">{{ suspended.length }}</em></button>
      </div>
      <p v-if="state === 'loading'" class="nwa-note">{{ W.loading }}</p>

      <!-- REPORTS -->
      <template v-else-if="tab === 'reports'">
        <div v-if="!reports.length" class="nwa-empty">
          <b>{{ W['empty-reports'] }}</b>
          <span>{{ W['empty-reports-line'] }}</span>
        </div>
        <ol v-else class="nwa-list">
          <li v-for="r in reports" :key="r.id" class="nwa-row">
            <div class="nwa-meta">
              <b>{{ r.post_id ? fill(W['reported-by'], { name: nameOf(r.actor_id) }) : fill(W['reported-person'], { name: nameOf(r.subject_id) }) }}</b>
              <span>{{ W.reason }}: {{ reasonWord(r.reason) }} · {{ agoOf(r.created_at) }}</span>
              <q v-if="r.note">{{ r.note }}</q>
            </div>
            <div v-if="r.post_id" class="nwa-post">
              <NetPost v-if="net.posts[r.post_id]" :post="net.posts[r.post_id]" quoted />
              <p v-else class="nwa-note">{{ W['post-gone'] }}</p>
            </div>
            <div class="nwa-acts">
              <button v-if="r.post_id && net.posts[r.post_id] && !net.posts[r.post_id].removed_at" type="button" class="nwa-warn" :disabled="busy === r.id" @click="remove(r)">{{ W.remove }}</button>
              <span class="nwa-span">
                <span class="nwa-span-label">{{ fill(W.suspend, { name: nameOf(r.subject_id) }) }}</span>
                <button v-for="[k, d] in SPANS" :key="k" type="button" :disabled="busy === r.id" @click="suspend(r, d)">{{ W['suspend-' + k] }}</button>
              </span>
              <button type="button" class="nwa-quiet" :disabled="busy === r.id" @click="dismiss(r)">{{ W.dismiss }}</button>
            </div>
          </li>
        </ol>
      </template>

      <!-- SUSPENDED -->
      <template v-else>
        <div v-if="!suspended.length" class="nwa-empty">
          <b>{{ W['empty-suspended'] }}</b>
          <span>{{ W['empty-suspended-line'] }}</span>
        </div>
        <ol v-else class="nwa-list">
          <li v-for="s in suspended" :key="s.id" class="nwa-row nwa-row-flat">
            <div class="nwa-meta">
              <b>{{ nameOf(s.subject_id) }}</b>
              <span>{{ untilWord(s) }} · {{ fill(W['suspended-by'], { name: nameOf(s.actor_id) }) }} · {{ agoOf(s.created_at) }}</span>
              <span v-if="s.reason">{{ W.reason }}: {{ reasonWord(s.reason) }}</span>
            </div>
            <div class="nwa-acts"><button type="button" :disabled="busy === s.id" @click="lift(s)">{{ W.lift }}</button></div>
          </li>
        </ol>
      </template>
    </template>
  </div>
</template>

<style scoped>
.nwa-note { font-size: 14px; color: var(--ink3) }
.nwa-tabs { display: inline-flex; width: fit-content; align-self: flex-start; gap: 4px; margin: 4px 0 18px; padding: 3px; border-radius: 999px; background: color-mix(in srgb, var(--ink) 6%, transparent) }
.nwa-tabs button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border: 0; border-radius: 999px; background: transparent;
  font: inherit; font-size: 13.5px; font-weight: 600; color: var(--ink2); cursor: pointer }
.nwa-tabs button.on { background: var(--paper); color: var(--ink); box-shadow: 0 1px 3px rgba(0, 0, 0, .12) }
.nwa-tabs em { font-style: normal; min-width: 18px; padding: 0 5px; border-radius: 999px; background: var(--ink); color: var(--paper); font-size: 11px; line-height: 18px; text-align: center }
.nwa-empty { display: flex; flex-direction: column; gap: 4px; padding: 28px; border: 1px dashed var(--hair); border-radius: 14px; text-align: center }
.nwa-empty b { font-size: 16px; color: var(--ink) }
.nwa-empty span { font-size: 14px; color: var(--ink3) }
.nwa-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; max-width: 760px }
.nwa-row { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--hair); border-radius: 14px; background: var(--paper) }
.nwa-row-flat { grid-template-columns: 1fr auto; align-items: center }
.nwa-meta { display: flex; flex-direction: column; gap: 3px }
.nwa-meta b { font-size: 14.5px; color: var(--ink) }
.nwa-meta span { font-size: 13px; color: var(--ink3) }
.nwa-meta q { font-size: 13.5px; color: var(--ink2); font-style: italic }
.nwa-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px }
.nwa-acts button { font: inherit; font-size: 13px; font-weight: 600; padding: 7px 12px; border: 1px solid var(--hair); border-radius: 999px; background: transparent; color: var(--ink); cursor: pointer }
.nwa-acts button:hover { border-color: color-mix(in srgb, var(--ink) 35%, transparent) }
.nwa-acts button:disabled { opacity: .5; cursor: default }
.nwa-acts .nwa-warn { border-color: #c8382f; color: #c8382f }
.nwa-acts .nwa-quiet { margin-left: auto; color: var(--ink2) }
/* the spans a suspension may run for, as one group with its own label: a row on a wide screen,
   its own block on a narrow one */
.nwa-span { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 5px 5px 5px 12px; border: 1px solid var(--hair); border-radius: 14px }
@media (max-width: 640px) {
  .nwa-span { display: flex; width: 100%; box-sizing: border-box; padding: 10px }
  .nwa-span-label { flex-basis: 100% }
}
.nwa-span-label { font-size: 12.5px; font-weight: 700; color: var(--ink2) }
.nwa-span button { padding: 5px 10px }
</style>

<script setup>
/*
 * EVERY COMMENT ON THE SITE, in one place, for whoever is responsible for all of them.
 *
 * The desk's Comments queue is what is WAITING, on the conversations no room owns; this is the
 * whole of it — what is live, what was removed, what is held — across every surface, narrowed by
 * where it is, what state it is in and who wrote it. A moderator releases, removes and answers from
 * here without opening the thing the comment is attached to, because opening eleven books to find
 * eleven held comments is how a queue stops being read.
 *
 * ONE ACT THIS PAGE DOES NOT HAVE: editing somebody else's words. A moderator may publish a comment,
 * remove one, or answer it under their own name in the open. Rewriting what somebody said is not a
 * moderation act and there is no control for it.
 *
 * The rows are comment_queue() under the moderator's own session — the same read the desk uses, and
 * the policy, not this page, decides which ones come back. Words are content/app/ui/comments.md.
 */
import { ref, computed, reactive, watch, onMounted } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { supabase, configured } from 'platformkit/lib/supabase.js'
import { isSignedIn, isStaff, roleKnown } from 'platformkit/lib/auth.js'
import { spanOf } from 'platformkit/lib/chat/model.js'
import AdminHead from './admin/AdminHead.vue'

/* a scope the site has not compiled yet must not white-screen the admin: a missing key shows
   blank, which pixels catch, and a missing GROUP would otherwise throw in the render */
const A = computed(() => us('comments').admin || {})
const H = computed(() => A.value.head || {})
const FL = computed(() => A.value.filters || {})
const R = computed(() => A.value.row || {})
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))

const state = ref('idle')      /* idle | loading | ok | denied | error */
const rows = ref([])
const busy = ref('')
const open = ref(null)         /* the comment being answered */
const draft = ref('')

/* the narrowings, remembered per browser */
const PREF = 'dl.comments.admin'
const read = () => { try { return JSON.parse(localStorage.getItem(PREF) || '{}') } catch (e) { return {} } }
const f = reactive({ state: 'waiting', kind: 'all', where: 'all', ...read() })
watch(f, () => { try { localStorage.setItem(PREF, JSON.stringify({ ...f })) } catch (e) { /* private mode */ } })

async function load() {
  if (!configured || !isSignedIn.value) { state.value = 'idle'; rows.value = []; return }
  if (roleKnown.value && !isStaff.value) { state.value = 'denied'; return }
  if (state.value !== 'ok') state.value = 'loading'
  const { data, error } = await supabase.rpc('comment_queue', {
    p_state: f.state === 'all' ? null : f.state,
    p_kind: f.kind === 'all' ? null : f.kind,
    p_attached: f.where === 'all' ? null : f.where === 'rooms',
    p_limit: 500,
  })
  if (error) { state.value = /permission|denied/i.test(error.message || '') ? 'denied' : 'error'; return }
  rows.value = data || []
  state.value = 'ok'
}
onMounted(load)
watch(() => [f.state, f.kind, f.where].join('|'), load)
watch([isSignedIn, roleKnown], load)

/* the kinds actually in hand, so the narrowing offers what there is rather than a list of every
   kind a site could ever have */
const kinds = computed(() => [...new Set(rows.value.map((r) => r.kind))].sort())
const waiting = computed(() => rows.value.filter((r) => r.state === 'waiting').length)

async function decide(row, yes) {
  if (busy.value) return
  busy.value = row.id
  try {
    const { data, error } = await supabase.rpc(yes ? 'comment_approve' : 'comment_refuse', { p_comment: row.id })
    if (error || (data && data.error)) throw new Error((error && error.message) || data.error)
    row.state = yes ? 'live' : 'removed'
    if (!yes) row.body = null
  } catch (e) { state.value = 'error' } finally { busy.value = '' }
}

/* AN ANSWER IS A COMMENT LIKE ANYBODY'S — under the moderator's own name, in the open, a reply to
   the line it answers. Never a note that appears to come from the site. */
async function answer(row) {
  const body = draft.value.trim()
  if (!body || busy.value) return
  busy.value = row.id
  try {
    const { data, error } = await supabase.rpc('comment_say', { p_kind: row.kind, p_subject: row.subject, p_body: body, p_parent: row.id })
    if (error || (data && data.error)) throw new Error((error && error.message) || data.error)
    draft.value = ''
    open.value = null
  } catch (e) { state.value = 'error' } finally { busy.value = '' }
}

const when = (v) => { const d = new Date(v); return isNaN(d) ? '' : spanOf(Date.now() - d.getTime()) }
</script>

<template>
  <div class="ui-page cma">
    <AdminHead :title="H.title" :sub="H.subtitle">
      <template #actions>
        <span v-if="state === 'ok'" class="cma-count">{{ fill(H.count, { n: rows.length, waiting }) }}</span>
      </template>
    </AdminHead>

    <p v-if="state === 'denied'" class="cma-note">{{ H.denied }}</p>
    <p v-else-if="state === 'error'" class="cma-note">{{ H.error }}</p>
    <template v-else>
      <div class="cma-filters">
        <label>{{ FL.state }}
          <select v-model="f.state">
            <option value="waiting">{{ FL['state-waiting'] }}</option>
            <option value="live">{{ FL['state-live'] }}</option>
            <option value="removed">{{ FL['state-removed'] }}</option>
            <option value="all">{{ FL['state-all'] }}</option>
          </select>
        </label>
        <label>{{ FL.where }}
          <select v-model="f.where">
            <option value="all">{{ FL['where-all'] }}</option>
            <option value="rooms">{{ FL['where-rooms'] }}</option>
            <option value="pages">{{ FL['where-pages'] }}</option>
          </select>
        </label>
        <label v-if="kinds.length > 1">{{ FL.kind }}
          <select v-model="f.kind">
            <option value="all">{{ FL['kind-all'] }}</option>
            <option v-for="k in kinds" :key="k" :value="k">{{ k }}</option>
          </select>
        </label>
      </div>

      <p v-if="state === 'loading'" class="cma-note">{{ H.loading }}</p>
      <p v-else-if="!rows.length" class="cma-note">{{ H.empty }}</p>

      <ol v-else class="cma-list">
        <li v-for="r in rows" :key="r.id" class="cma-row" :class="r.state">
          <div class="cma-meta">
            <b>{{ r.author || H.someone }}</b>
            <span v-if="r.trusted" class="cma-trusted">{{ R.trusted }}</span>
            <time>{{ when(r.created_at) }}</time>
            <span class="cma-under">
              {{ R.under }}
              <a v-if="r.href" :href="r.href">{{ r.title }}</a>
              <template v-else>{{ r.title }}</template>
            </span>
            <span v-if="r.attached" class="cma-where">{{ R['in-room'] }}</span>
          </div>

          <p v-if="r.state === 'removed'" class="cma-gone">{{ R.removed }}</p>
          <p v-else class="cma-said">{{ r.body }}</p>

          <!-- WHAT HELD IT, and only here. The author is never told which word caught them: a
               list somebody can probe is a list somebody can walk around. -->
          <p v-if="r.state === 'waiting'" class="cma-held">
            <template v-if="r.flagged">{{ fill(R['held-word'], { word: r.flagged }) }}</template>
            <template v-else>{{ R.held }}</template>
          </p>

          <div class="cma-acts">
            <template v-if="r.state === 'waiting'">
              <button type="button" class="cma-go" :disabled="busy === r.id" @click="decide(r, true)">{{ R.approve }}</button>
              <button type="button" :disabled="busy === r.id" @click="decide(r, false)">{{ R.refuse }}</button>
            </template>
            <button v-else-if="r.state === 'live'" type="button" :disabled="busy === r.id" @click="decide(r, false)">{{ R.remove }}</button>
            <button v-if="r.state !== 'removed'" type="button" @click="open = open === r.id ? null : r.id; draft = ''">{{ R.reply }}</button>
          </div>

          <form v-if="open === r.id" class="cma-reply" @submit.prevent="answer(r)">
            <textarea v-model="draft" rows="2" :placeholder="fill(R.placeholder, { name: r.author || H.someone })"></textarea>
            <button type="submit" class="cma-go" :disabled="busy === r.id || !draft.trim()">{{ R.send }}</button>
          </form>
        </li>
      </ol>
    </template>
  </div>
</template>

<style scoped>

.cma-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin: 0 0 22px }
.cma-head h1 { margin: 0; font-family: var(--fd); font-size: 27px; font-weight: 700; color: var(--ink) }
.cma-head p { margin: 4px 0 0; font-size: 13.5px; color: var(--ink3) }
.cma-count { font-family: var(--m); font-size: 11.5px; color: var(--ink3); white-space: nowrap }
.cma-note { margin: 30px 0; font-size: 14px; color: var(--ink3) }

.cma-filters { display: flex; flex-wrap: wrap; gap: 16px; margin: 0 0 20px; padding: 0 0 18px; border-bottom: 1px solid var(--hair) }
.cma-filters label { display: inline-flex; align-items: center; gap: 7px; font-family: var(--m); font-size: 11px;
  letter-spacing: .06em; text-transform: uppercase; color: var(--ink3) }
.cma-filters select { font: inherit; font-family: var(--f); font-size: 13px; text-transform: none; letter-spacing: 0;
  color: var(--ink); background: var(--card); border: 1px solid var(--hair); border-radius: 8px; padding: 5px 9px; width: auto }

.cma-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px }
.cma-row { padding: 15px 17px; background: var(--card); border: 1px solid var(--hair); border-radius: 13px }
.cma-row.waiting { border-color: color-mix(in srgb, var(--ink) 26%, transparent) }
.cma-row.removed { opacity: .6 }
.cma-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 9px; font-size: 12.5px; color: var(--ink3) }
.cma-meta b { font-size: 13.5px; font-weight: 650; color: var(--ink) }
.cma-meta time { font-family: var(--m); font-size: 11px }
.cma-trusted { font-family: var(--m); font-size: 10px; letter-spacing: .04em; text-transform: uppercase;
  border: 1px solid var(--hair); border-radius: 5px; padding: 1px 5px }
.cma-under a { color: var(--ink); text-decoration: underline; text-underline-offset: 3px }
.cma-where { font-family: var(--m); font-size: 10.5px }
.cma-said { margin: 8px 0 0; font-size: 14.5px; line-height: 1.55; color: var(--ink); white-space: pre-wrap }
.cma-gone { margin: 8px 0 0; font-size: 13.5px; font-style: italic; color: var(--ink3) }
.cma-held { margin: 8px 0 0; font-family: var(--m); font-size: 11.5px; color: var(--ink3) }
.cma-acts { display: flex; gap: 8px; margin: 12px 0 0 }
.cma-acts button, .cma-reply button { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink3);
  background: none; border: 1px solid var(--hair); border-radius: 8px; padding: 5px 12px; cursor: pointer; width: auto }
.cma-acts button:hover, .cma-reply button:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.cma-acts button:disabled { opacity: .45; cursor: default }
.cma-go { color: var(--paper) !important; background: var(--ink) !important; border-color: transparent !important }
.cma-reply { display: flex; gap: 9px; align-items: flex-start; margin: 12px 0 0 }
.cma-reply textarea { flex: 1; font: inherit; font-size: 14px; line-height: 1.5; color: var(--ink);
  background: var(--paper); border: 1px solid var(--hair); border-radius: 9px; padding: 9px 11px; resize: vertical }
</style>

<script setup>
/*
 * Content → Publishing, for cloud mode alone (the rail has no such row in git mode): what waits, and where a publish goes. The drafts — every record saved
 * and not yet published (a removal marked, a new record marked), who and when — with a line for the commit's
 * message and Publish everything, which makes them live at once and sends them to the repository as one
 * commit through the `admin` function; a removal can be called off (Keep). Under it the repository (owner/name,
 * the branch, a write-only token — sent once to the function, kept in app_settings, never shown again) and the
 * pushes' state: connected or not, the last push, how many files wait, the last failure, and Push now (the
 * function's retry; pg_cron asks again every minute on its own). From a checkout there are no drafts and nothing
 * to set: every save is a file, and the page says so. Words are content/app/ui/publishing.md.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { CLOUD } from 'platformkit/lib/router.js'
import { isSignedIn, mayEditContent, roleKnown } from 'platformkit/lib/auth.js'
import { github, drafts as readDrafts, publish, keep } from '../lib/admin/api.js'

const emit = defineEmits(['published'])
const W = us('publishing').page
const H = W.head, D = W.drafts, F = W.form, S = W.status, R = W.rebuild, C = W.copy
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))

const state = ref('idle')          /* idle | denied | loading | ok */
const st = ref(null)               /* the pushes: repo, branch, token (set or not), connected, last_push, error, pending */
const list = ref([])               /* the drafts */
const repo = ref(''), branch = ref(''), token = ref(''), hook = ref('')
const message = ref('')
const busy = ref(false), said = ref(''), pushing = ref(false), pushed = ref(''), publishing = ref(false), published = ref('')
const hookBusy = ref(false), hookSaid = ref(''), rebuilding = ref(false), rebuilt = ref('')
const taking = ref(false), took = ref('')
/*
 * WHETHER THE REPOSITORY IS IN THE CYCLE AT ALL. Three states, and only one of them asks for a
 * repository: 'git' has one, 'undecided' has not been told yet, and 'off' is a deployment that
 * deliberately has none. Telling the third to connect one — or reporting its rows as files waiting
 * to be pushed somewhere — is the page saying something untrue about the deployment it is on.
 */
const gitOut = computed(() => st.value && st.value.mode === 'off')

async function load() {
  if (!CLOUD) { state.value = 'ok'; return }
  if (!isSignedIn.value) { state.value = 'idle'; return }
  if (roleKnown.value && !mayEditContent.value) { state.value = 'denied'; return }
  state.value = 'loading'
  try {
    const [g, d] = await Promise.all([github('get'), readDrafts()])
    st.value = g; repo.value = g.repo; branch.value = g.branch; list.value = d.drafts || []
    state.value = 'ok'
  } catch (e) { state.value = e.status === 403 ? 'denied' : 'ok' }
}
onMounted(load)
watch([isSignedIn, roleKnown, mayEditContent], load)

const n = computed(() => list.value.length)
const placeholder = computed(() => (n.value === 1 ? D['message-placeholder-one'] : fill(D['message-placeholder'], { n: n.value })))
async function publishAll() {
  publishing.value = true; published.value = ''
  try {
    const r = await publish(null, null, message.value)
    const k = (r.published || []).length
    published.value = k === 1 ? D['published-one'] : fill(D.published, { n: k })
    if (r.push && r.push.error) published.value += ' ' + fill(S.error, { error: r.push.error })
    message.value = ''
    emit('published')
    await load()
  } catch (e) {
    published.value = e.issues && e.issues.length ? fill(D.checks, { name: e.name || '', issue: e.issues.map((i) => (i.path ? i.path + ': ' : '') + i.message).join('; ') }) : (D.failed + (e.message ? ' ' + e.message : ''))
  } finally { publishing.value = false }
}
async function keepOne(d) { try { await keep(d.path); await load() } catch (e) { published.value = e.message } }
async function save() {
  busy.value = true; said.value = ''
  try { const g = await github('put', { repo: repo.value, branch: branch.value, token: token.value || undefined }); st.value = { ...st.value, ...g }; token.value = ''; said.value = F.saved }
  catch (e) { said.value = F.failed + (e.message ? ' ' + e.message : '') }
  finally { busy.value = false; setTimeout(() => { said.value = '' }, 2500) }
}
async function saveHook() {
  hookBusy.value = true; hookSaid.value = ''
  try { const g = await github('hook', { url: hook.value }); st.value = { ...st.value, ...g }; hook.value = ''; hookSaid.value = F.saved }
  catch (e) { hookSaid.value = F.failed + (e.message ? ' ' + e.message : '') }
  finally { hookBusy.value = false; setTimeout(() => { hookSaid.value = '' }, 2500) }
}
async function rebuild() {
  rebuilding.value = true; rebuilt.value = ''
  try { const r = await github('rebuild'); st.value = { ...st.value, ...r }; rebuilt.value = r.error ? fill(R.failed, { error: r.error }) : R.asked }
  catch (e) { rebuilt.value = e.message }
  finally { rebuilding.value = false }
}
/* the copy: the function answers a zip, so it is fetched and handed to the browser as a download */
async function takeCopy() {
  taking.value = true; took.value = ''
  try {
    /* the function answers a zip rather than json, so what comes back is the bytes themselves */
    const out = await github('archive')
    const blob = out instanceof Blob ? out : new Blob([out], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'content.zip'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  } catch (e) { took.value = fill(C.failed, { error: (e && e.message) || e }) }
  finally { taking.value = false }
}
async function push() {
  pushing.value = true; pushed.value = ''
  try { const r = await github('retry'); st.value = { ...st.value, ...r }; pushed.value = fill(S.retried, { n: r.pushed || 0 }) }
  catch (e) { pushed.value = e.message }
  finally { pushing.value = false }
}
const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
const connected = computed(() => st.value && st.value.connected)
function openAuth() { if (window.DLauth) window.DLauth.open() }
</script>

<template>
  <div class="rp">
    <div class="rp-head"><div><h1 class="rp-title">{{ H.title }}</h1><p class="rp-subtitle">{{ gitOut ? H['subtitle-off'] : H.subtitle }}</p></div></div>

    <div v-if="!CLOUD" class="rp-note"><p>{{ H['git-mode'] }}</p></div>
    <div v-else-if="state === 'idle'" class="rp-note"><h2>{{ H['signin-heading'] }}</h2><p>{{ H['signin-subtitle'] }}</p><button type="button" class="rp-cta" @click="openAuth">{{ H['signin-cta'] }}</button></div>
    <div v-else-if="state === 'denied'" class="rp-note"><h2>{{ H['denied-heading'] }}</h2><p>{{ H['denied-subtitle'] }}</p></div>
    <p v-else-if="state === 'loading'" class="rp-loading">{{ H.loading }}</p>

    <template v-else-if="st">
      <section class="rp-card">
        <div class="rp-ch"><h2>{{ D.heading }} <i v-if="n" class="rp-count">{{ n === 1 ? D['waiting-one'] : fill(D.waiting, { n }) }}</i></h2></div>
        <p v-if="!n" class="rp-line">{{ D.empty }}</p>
        <ul v-else class="rp-drafts">
          <li v-for="d in list" :key="d.path" class="rp-draft" :class="{ removed: d.removed }">
            <div class="rp-dmain">
              <b>{{ d.title }}</b>
              <span class="rp-dtag">{{ d.label }}</span>
              <span v-if="d.removed" class="rp-dstate">{{ D.removed }}</span>
              <span v-else-if="d.fresh" class="rp-dstate">{{ D.new }}</span>
            </div>
            <div class="rp-dside">
              <span class="rp-dwho">{{ fill(D.by, { who: d.by || '', when: when(d.at) }) }}</span>
              <button v-if="d.removed" type="button" class="rp-btn ghost small" @click="keepOne(d)">{{ D.keep }}</button>
            </div>
          </li>
        </ul>
        <form v-if="n" class="rp-form" @submit.prevent="publishAll">
          <label class="rp-field"><span>{{ D.message }}</span><input v-model="message" type="text" :placeholder="placeholder" autocomplete="off"></label>
          <div class="rp-row"><button type="submit" class="rp-btn rp-publish" :disabled="publishing">{{ publishing ? D.publishing : D['publish-all'] }}</button><span v-if="published" class="rp-said">{{ published }}</span></div>
        </form>
        <p v-else-if="published" class="rp-said">{{ published }}</p>
      </section>

      <section v-if="!gitOut" class="rp-card">
        <div class="rp-ch"><h2>{{ F.heading }}</h2></div>
        <form class="rp-form" @submit.prevent="save">
<!-- where this site publishes is configuration: declared in the repository, it is shown and not
               asked for, because a setting somebody re-types after every deploy is in the wrong place -->
          <label class="rp-field"><span>{{ F.repo }}</span>
            <input v-model="repo" type="text" :placeholder="F['repo-hint']" autocomplete="off" spellcheck="false" :readonly="st.declared">
            <small v-if="st.declared">{{ F['from-config'] }}</small></label>
          <label class="rp-field"><span>{{ F.branch }}</span>
            <input v-model="branch" type="text" autocomplete="off" spellcheck="false" :readonly="st.declared"></label>
          <label class="rp-field"><span>{{ F.token }}</span><input v-model="token" type="password" autocomplete="new-password" spellcheck="false"><small>{{ F['token-hint'] }}</small><i>{{ st.token ? F['token-set'] : F['token-none'] }}</i></label>
          <div class="rp-row"><button type="submit" class="rp-btn" :disabled="busy || (st.declared && !token)">{{ busy ? F.saving : F.save }}</button><span v-if="said" class="rp-said">{{ said }}</span></div>
        </form>
      </section>

      <section v-if="!gitOut" class="rp-card">
        <div class="rp-ch"><h2>{{ S.heading }}</h2></div>
        <p class="rp-line" :class="{ on: connected }">{{ connected ? fill(S.connected, { repo: st.repo, branch: st.branch }) : S.disconnected }}</p>
        <p class="rp-line">{{ st.last_push ? fill(S['last-push'], { when: when(st.last_push) }) : S.never }}</p>
        <p class="rp-line">{{ st.pending ? fill(S['pending-some'], { n: st.pending }) : S['pending-none'] }}</p>
        <p v-if="st.error" class="rp-warn">{{ fill(S.error, { error: st.error }) }}</p>
        <div class="rp-row"><button type="button" class="rp-btn ghost" :disabled="pushing || !connected || !st.pending" @click="push">{{ pushing ? S.retrying : S.retry }}</button><span v-if="pushed" class="rp-said">{{ pushed }}</span></div>
      </section>

      <!-- WHAT MAKES THE STATIC COPY CATCH UP. A publish is live for a reader at once; the
           prerendered pages and the share images are the last build's until the host builds again.
           With a repository the commit does that. Without one, this does. -->
      <section class="rp-card">
        <div class="rp-ch"><h2>{{ R.heading }}</h2></div>
        <p class="rp-line">{{ gitOut ? R['why-off'] : R['why-git'] }}</p>
        <form class="rp-form" @submit.prevent="saveHook">
          <label class="rp-field"><span>{{ R.hook }}</span>
            <input v-model="hook" type="password" autocomplete="new-password" spellcheck="false" :placeholder="R['hook-hint']">
            <i>{{ st.hook ? R['hook-set'] : R['hook-none'] }}</i></label>
          <div class="rp-row"><button type="submit" class="rp-btn" :disabled="hookBusy">{{ hookBusy ? F.saving : F.save }}</button><span v-if="hookSaid" class="rp-said">{{ hookSaid }}</span></div>
        </form>
        <p class="rp-line">{{ st.hook_at ? fill(R.last, { when: when(st.hook_at) }) : R.never }}</p>
        <p v-if="st.hook_error" class="rp-warn">{{ fill(R.failed, { error: st.hook_error }) }}</p>
        <div class="rp-row"><button type="button" class="rp-btn ghost" :disabled="rebuilding || !st.hook" @click="rebuild">{{ rebuilding ? R.asking : R.ask }}</button><span v-if="rebuilt" class="rp-said">{{ rebuilt }}</span></div>
      </section>

      <!-- with no repository these rows are the only copy of the content, so there is a way to take one -->
      <section v-if="gitOut" class="rp-card">
        <div class="rp-ch"><h2>{{ C.heading }}</h2></div>
        <p class="rp-line">{{ C.why }}</p>
        <div class="rp-row"><button type="button" class="rp-btn ghost" :disabled="taking" @click="takeCopy">{{ taking ? C.taking : C.take }}</button><span v-if="took" class="rp-said">{{ took }}</span></div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.rp { max-width: 760px; margin: 0 auto; padding: 36px 28px 90px; color: var(--ink) }
.rp-head { margin-bottom: 22px }
.rp-title { font-family: var(--fd); font-weight: 600; font-size: 34px; letter-spacing: -.02em; margin: 0 0 6px }
.rp-subtitle { margin: 0; color: var(--ink2); font-size: 15px; line-height: 1.5 }
.rp-note { max-width: 520px; margin: 40px auto; text-align: center; padding: 34px 28px; border: 1px solid var(--hair); border-radius: 18px; background: var(--card) }
.rp-note h2 { font-family: var(--fd); font-weight: 600; font-size: 24px; margin: 0 0 8px } .rp-note p { color: var(--ink2); margin: 0 0 16px; line-height: 1.5 } .rp-note p:last-child { margin-bottom: 0 }
.rp-cta, .rp-btn { border: 0; background: var(--ink); color: var(--paper); font: inherit; padding: 10px 18px; border-radius: 999px; cursor: pointer }
.rp-btn:disabled { opacity: .5; cursor: default }
.rp-btn.ghost { background: transparent; color: var(--ink); border: 1px solid var(--hair) }
.rp-btn.small { padding: 5px 12px; font-size: 12.5px }
.rp-publish { background: var(--accent2) }
.rp-loading { color: var(--ink3); text-align: center; padding: 40px 0 }
.rp-card { padding: 22px 24px; border: 1px solid var(--hair); border-radius: 14px; background: var(--card); margin-bottom: 16px }
.rp-ch h2 { font-family: var(--fd); font-weight: 600; font-size: 19px; margin: 0 0 14px; display: flex; align-items: baseline; gap: 10px }
.rp-count { font-style: normal; font-family: var(--m); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3) }
.rp-drafts { list-style: none; margin: 0 0 16px; padding: 0; display: flex; flex-direction: column; gap: 6px }
.rp-draft { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--hair); border-radius: 10px; background: var(--paper) }
.rp-draft.removed b { text-decoration: line-through; color: var(--ink3) }
.rp-dmain { display: flex; align-items: baseline; gap: 10px; min-width: 0 } .rp-dmain b { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.rp-dtag, .rp-dstate { font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3) }
.rp-dstate { padding: 2px 7px; border-radius: 999px; border: 1px solid var(--hair) }
.rp-dside { display: flex; align-items: center; gap: 10px; flex-shrink: 0 } .rp-dwho { color: var(--ink3); font-size: 12.5px }
.rp-form { display: flex; flex-direction: column; gap: 14px }
.rp-field { display: flex; flex-direction: column; gap: 5px }
.rp-field span { font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3) }
.rp-field input { font: inherit; font-size: 14px; padding: 9px 12px; border: 1px solid var(--hair); border-radius: 9px; background: var(--paper); color: var(--ink) }
.rp-field small { color: var(--ink3); font-size: 12.5px; line-height: 1.45 } .rp-field i { font-style: normal; color: var(--ink2); font-size: 12.5px }
.rp-row { display: flex; align-items: center; gap: 12px; margin-top: 4px }
.rp-said { color: var(--ink2); font-size: 13px }
.rp-line { margin: 0 0 8px; font-size: 14px; color: var(--ink2) } .rp-line.on { color: var(--ink) }
.rp-warn { margin: 0 0 10px; font-size: 13.5px; color: #b45309 }
</style>

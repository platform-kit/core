<script setup>
/*
 * Notifications, for the staff: this browser on or off, what it wants to hear about (a support
 * topic for anyone on the desk, the rest for administrators), a test, and the account's other
 * browsers. The mechanics are src/lib/push.js; words are content/app/ui/push.md. Ships in
 * under Settings → Notifications of the one admin shell, in production and the CMS alike — a
 * full-width page in the admin's own idiom (the head, the eyebrows, the switch rows, the ui-
 * primitives of admin-ui.css), never a column of its own.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { isSignedIn, isStaff, isAdmin, roleKnown } from 'platformkit/lib/auth.js'
import { supported, permission, KEY, TOPICS, STAFF_TOPICS, mine, devices, enable, disable, setTopics, forget, test } from 'platformkit/lib/push.js'
import './admin/admin-ui.css'
import AdminHead from './admin/AdminHead.vue'

const W = us('push').page
const H = W.head, D = W.device, T = W.topics, O = W.devices
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))

const state = ref('idle')          /* idle | denied | ok */
const row = ref(null)              /* this browser's row */
const others = ref([])
const busy = ref(false), said = ref(''), saved = ref('')
const picked = ref([])
const allowed = computed(() => (isAdmin.value ? TOPICS : STAFF_TOPICS))
const on = computed(() => !!row.value)
/* the topics by who they are for: the desk's, then — for an administrator — the accounts and the sales */
const groups = computed(() => {
  const desk = allowed.value.filter((t) => STAFF_TOPICS.includes(t)), site = allowed.value.filter((t) => !STAFF_TOPICS.includes(t))
  return [{ key: 'support', items: desk }, { key: 'site', items: site }].filter((g) => g.items.length)
})
/* what stands in the way, if anything: the deployment, the browser, its permission */
const notice = computed(() => (!KEY ? H.unconfigured : !supported() ? H.unsupported : permission === 'denied' ? H.blocked : ''))
const canTurnOn = computed(() => !busy.value && !notice.value)

async function load() {
  if (!isSignedIn.value) { state.value = 'idle'; return }
  if (roleKnown.value && !isStaff.value) { state.value = 'denied'; return }
  state.value = 'ok'
  row.value = await mine().catch(() => null)
  picked.value = row.value ? row.value.topics.slice() : allowed.value.slice()
  others.value = (await devices().catch(() => [])).filter((d) => !row.value || d.id !== row.value.id)
}
onMounted(load)
watch([isSignedIn, roleKnown, isStaff], load)

async function turnOn() {
  busy.value = true; said.value = ''
  try { await enable(picked.value); await load() } catch (e) { said.value = e.message === 'denied' ? H.blocked : D.failed } finally { busy.value = false }
}
async function turnOff() { busy.value = true; said.value = ''; try { await disable(); await load() } finally { busy.value = false } }
async function toggle(t) {
  picked.value = picked.value.includes(t) ? picked.value.filter((x) => x !== t) : picked.value.concat([t])
  if (on.value) { await setTopics(picked.value); saved.value = T.saved; setTimeout(() => { saved.value = '' }, 1500) }
}
async function sendTest() {
  busy.value = true; said.value = ''
  try { const r = await test(); said.value = r && r.sent ? D['test-sent'] : D['test-none'] } catch (e) { said.value = D.failed } finally { busy.value = false }
}
async function drop(d) { await forget(d.id); await load() }
const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
const kindOf = (ua) => { const s = String(ua || ''); return /iPhone|iPad/.test(s) ? 'ios' : /Android/.test(s) ? 'android' : /Mac/.test(s) ? 'mac' : /Windows/.test(s) ? 'windows' : 'other' }
const phone = (k) => k === 'ios' || k === 'android'
function openAuth() { if (window.DLauth) window.DLauth.open() }
</script>

<template>
  <div class="ui-page ui-narrow pu">
    <AdminHead :title="H.title" :sub="H.subtitle">
      <template #actions>
        <span v-if="state === 'ok'" class="ui-badge" :class="{ 'ui-ok': on }">{{ on ? H['state-on'] : H['state-off'] }}</span>
      </template>
    </AdminHead>

    <div v-if="state === 'idle'" class="ui-empty pu-gate"><h3>{{ H['signin-heading'] }}</h3><p>{{ H['signin-subtitle'] }}</p><button type="button" class="ui-btn ui-primary" @click="openAuth">{{ H['signin-cta'] }}</button></div>
    <div v-else-if="state === 'denied'" class="ui-empty pu-gate"><h3>{{ H['denied-heading'] }}</h3><p>{{ H['denied-subtitle'] }}</p></div>

    <div v-else class="pu-grid">
      <aside class="pu-side">
        <section class="pu-card pu-device" :class="{ 'pu-on': on }">
          <div class="pu-bell" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V10a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>
            <i v-if="on" class="pu-ring"></i>
          </div>
          <span class="ui-eyebrow">{{ D.heading }}</span>
          <h2>{{ on ? D.on : D.off }}</h2>
          <p class="pu-lead">{{ on ? D['lead-on'] : D['lead-off'] }}</p>
          <p v-if="notice" class="pu-notice">{{ notice }}</p>
          <div class="pu-actions">
            <button v-if="!on" type="button" class="ui-btn ui-primary" :disabled="!canTurnOn" @click="turnOn">{{ busy ? D.working : D.enable }}</button>
            <template v-else>
              <button type="button" class="ui-btn ui-primary" :disabled="busy" @click="sendTest">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10l14-6-4 13-3-5z"/><path d="M10 12l7-8"/></svg>
                {{ busy ? D.working : D.test }}
              </button>
              <button type="button" class="ui-btn" :disabled="busy" @click="turnOff">{{ D.disable }}</button>
            </template>
          </div>
          <p v-if="said" class="pu-said">{{ said }}</p>
        </section>
      </aside>

      <div class="pu-main">
        <section class="pu-card">
          <div class="pu-ch"><span class="ui-eyebrow">{{ T.heading }}</span><transition name="pu-fade"><span v-if="saved" class="ui-badge ui-ok">{{ saved }}</span></transition></div>
          <div v-for="g in groups" :key="g.key" class="pu-group">
            <h3>{{ T['group-' + g.key] }} <small>{{ T['group-' + g.key + '-hint'] }}</small></h3>
            <ul class="pu-topics">
              <li v-for="t in g.items" :key="t">
                <label class="pu-topic" :class="{ 'pu-picked': picked.includes(t) }">
                  <span class="pu-topic-words"><b>{{ T[t] }}</b><small>{{ T[t + '-hint'] }}</small></span>
                  <span class="ui-switch ui-compact"><input type="checkbox" :checked="picked.includes(t)" @change="toggle(t)" /><i></i></span>
                </label>
              </li>
            </ul>
          </div>
          <p v-if="!isAdmin" class="ui-hint">{{ T['staff-only'] }}</p>
        </section>

        <section class="pu-card">
          <div class="pu-ch"><span class="ui-eyebrow">{{ O.heading }}</span><span v-if="others.length" class="ui-count"><b>{{ others.length }}</b></span></div>
          <p v-if="!others.length" class="pu-none">{{ O.none }}</p>
          <ul v-else class="pu-devices">
            <li v-for="d in others" :key="d.id">
              <span class="pu-dev-glyph" aria-hidden="true">
                <svg v-if="phone(kindOf(d.ua))" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="6" y="2.5" width="8" height="15" rx="1.8"/><path d="M9 15h2"/></svg>
                <svg v-else viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2.5" y="4" width="15" height="10" rx="1.5"/><path d="M7 17h6"/></svg>
              </span>
              <span class="pu-dev-words">
                <b>{{ O[kindOf(d.ua)] }}</b>
                <small>{{ fill(O.since, { when: when(d.created_at) }) }}<template v-if="d.last_sent_at"> · {{ fill(O.last, { when: when(d.last_sent_at) }) }}</template></small>
                <small class="pu-dev-topics">{{ d.topics.length ? d.topics.map((t) => T[t] || t).join(' · ') : O['topics-none'] }}</small>
              </span>
              <span v-if="d.failures > 2" class="ui-badge ui-warn">{{ O.failing }}</span>
              <button type="button" class="ui-btn ui-ghost ui-sm" @click="drop(d)">{{ O.forget }}</button>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pu { color: var(--ink) }
.pu-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin: 0 0 20px; padding-bottom: 18px; border-bottom: 1px solid var(--hair) }
.pu-head h1 { font-family: var(--fd); font-weight: 600; font-size: 27px; margin: 0; letter-spacing: -.01em }
.pu-head p { margin: 4px 0 0; color: var(--ink3); font-size: 13px; max-width: 64ch }
.pu-gate { max-width: 520px; margin: 48px auto }
.pu-grid { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 18px; align-items: start }
.pu-side { position: sticky; top: 0 }
.pu-main { display: flex; flex-direction: column; gap: 18px; min-width: 0 }
.pu-card { border: 1px solid var(--hair); border-radius: 14px; background: var(--paper); padding: 20px 22px; box-shadow: 0 1px 2px #0000000a, 0 10px 30px -24px #00000040 }
.pu-ch { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 14px }
.pu-ch .ui-eyebrow { padding-left: 0 }

/* this browser: the bell, the state, the one thing to do */
.pu-device { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 26px 24px }
.pu-device .ui-eyebrow { padding-left: 0; margin-top: 6px }
.pu-device h2 { font-family: var(--fd); font-weight: 600; font-size: 20px; letter-spacing: -.01em; margin: 0; line-height: 1.25 }
.pu-lead { margin: 0; font-size: 13.5px; line-height: 1.5; color: var(--ink2) }
.pu-bell { position: relative; width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; color: var(--ink3); background: var(--wash); border: 1px solid var(--hair); transition: color .2s, background .2s, border-color .2s }
.pu-bell svg { width: 26px; height: 26px }
.pu-on .pu-bell { color: var(--accent2); background: color-mix(in srgb, var(--accent2) 10%, var(--paper)); border-color: color-mix(in srgb, var(--accent2) 35%, transparent) }
.pu-ring { position: absolute; inset: -1px; border-radius: 16px; border: 1px solid var(--accent2); opacity: 0; animation: pu-ring 2.4s ease-out infinite }
@keyframes pu-ring { 0% { opacity: .5; transform: scale(1) } 100% { opacity: 0; transform: scale(1.28) } }
@media (prefers-reduced-motion: reduce) { .pu-ring { animation: none } }
.pu-notice { margin: 4px 0 0; padding: 10px 12px; border-radius: 10px; font-size: 12.5px; line-height: 1.45; color: #9a6a10; background: #d8a03a1a; border: 1px solid #d8a03a55 }
.pu-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px }
.pu-said { margin: 0; font-size: 12.5px; color: var(--ink3) }

/* the topics: rows with a switch, grouped by who they are for */
.pu-group + .pu-group { margin-top: 18px; padding-top: 16px; border-top: 1px solid color-mix(in srgb, var(--hair) 60%, transparent) }
.pu-group h3 { font-family: var(--fd); font-weight: 600; font-size: 15px; margin: 0 0 8px; letter-spacing: -.005em }
.pu-group h3 small { font-family: var(--f, inherit); font-weight: 400; font-size: 12px; color: var(--ink3); margin-left: 8px }
.pu-topics { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px }
.pu-topic { display: flex; align-items: center; justify-content: space-between; gap: 14px; cursor: pointer; padding: 12px 14px; border-radius: 11px; border: 1px solid var(--hair); background: var(--paper); transition: border-color .15s, background .15s }
.pu-topic:hover { border-color: var(--ink3) }
.pu-topic.pu-picked { background: color-mix(in srgb, var(--accent2) 5%, var(--paper)); border-color: color-mix(in srgb, var(--accent2) 30%, var(--hair)) }
.pu-topic-words { min-width: 0 } .pu-topic-words b { display: block; font-size: 14px; font-weight: 600 } .pu-topic-words small { display: block; font-size: 12.5px; color: var(--ink3); margin-top: 1px }
.pu-topic .ui-switch { flex: none }

/* the other browsers */
.pu-none { margin: 0; font-size: 13.5px; color: var(--ink3) }
.pu-devices { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column }
.pu-devices li { display: flex; align-items: center; gap: 14px; padding: 12px 0; border-top: 1px solid color-mix(in srgb, var(--hair) 60%, transparent) }
.pu-devices li:first-child { border-top: 0; padding-top: 0 } .pu-devices li:last-child { padding-bottom: 0 }
.pu-dev-glyph { flex: none; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; color: var(--ink2); background: var(--wash); border: 1px solid var(--hair) }
.pu-dev-glyph svg { width: 18px; height: 18px }
.pu-dev-words { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px }
.pu-dev-words b { font-size: 14px; font-weight: 600 } .pu-dev-words small { font-size: 12.5px; color: var(--ink3) }
.pu-dev-topics { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }

.pu-fade-enter-active, .pu-fade-leave-active { transition: opacity .2s } .pu-fade-enter-from, .pu-fade-leave-to { opacity: 0 }
@media (max-width: 900px) { .pu-grid { grid-template-columns: 1fr } .pu-side { position: static } }
@media (max-width: 640px) { .pu-topics { grid-template-columns: 1fr } .pu-head { align-items: flex-start; flex-direction: column } }
</style>

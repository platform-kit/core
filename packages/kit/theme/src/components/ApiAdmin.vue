<script setup>
/* Settings → API: the content API's keys (content-api). The space, the environment and the base a Contentful client
   is pointed at; every key with its name, kind, creation and last use, and Revoke; New key — a name, a kind, whether
   gated content is allowed — with the key shown once. The key is made here in the browser (random, base62) and only
   its sha256 and its first characters are kept (api_keys, under RLS for administrators), so nobody stores it but the
   site that uses it. Under the keys, the webhooks (content_webhooks) read-only: a subscription is made and changed through
   the Management API alone (webhook_definitions), and this page shows what is subscribed, to what, and how the last delivery
   went. Words: `content/app/ui/api.md` (the theme's default), groups page.head, page.keys and page.webhooks. */
import { moduleOn } from 'platformkit/lib/modules.js'
import { ref, computed, onMounted } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { supabase } from 'platformkit/lib/supabase.js'
import { isSignedIn, isAdmin, roleKnown, user } from 'platformkit/lib/auth.js'
import { api as API, modules } from '#site'
import { site as SITE } from '#content'
import { ROUTES } from 'platformkit/lib/router.js'
import './admin/admin-ui.css'

const W = us('api').page
const H = W.head || {}, K = W.keys || {}, WH = W.webhooks || {}, R = (us('api').reference || {}).head || {}
const S = Array.isArray(SITE) ? SITE[0] : SITE
const base = computed(() => String((S && S.url) || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, ''))
const state = computed(() => (!roleKnown.value ? 'loading' : !isSignedIn.value ? 'idle' : !isAdmin.value ? 'denied' : 'ok'))
const keys = ref([]), hooks = ref([]), loading = ref(false), making = ref(false), form = ref(null), reveal = ref(null), copied = ref(false), failed = ref('')
/* the content API's three kinds, then a kind per door the site has on: forms (the Forms API), scheduling (the Scheduling API) */
const KINDS = ['delivery', 'preview', 'management', ...(moduleOn('forms') ? ['forms'] : []), ...(moduleOn('sessions') ? ['scheduling'] : []), ...(moduleOn('store') ? ['storefront'] : []), ...(moduleOn('support') ? ['support'] : [])]

async function load() {
  loading.value = true
  const { data } = await supabase.from('api_keys').select('id, name, kind, gated, prefix, created_at, last_used_at, revoked_at').order('created_at', { ascending: false })
  keys.value = data || []
  const { data: h } = await supabase.from('content_webhooks').select('id, name, url, topics, active, last_at, last_error').order('created_at')
  hooks.value = h || []
  loading.value = false
}
onMounted(() => { if (state.value === 'ok') load() })
import { watch } from 'vue'
import AdminHead from './admin/AdminHead.vue'
watch(state, (s) => { if (s === 'ok') load() })

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const random = (n) => { const bytes = new Uint8Array(n); crypto.getRandomValues(bytes); return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('') }
const sha256 = async (s) => { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('') }

function startNew() { form.value = { name: '', kind: 'delivery', gated: false }; failed.value = ''; reveal.value = null }
async function create() {
  if (!form.value || !form.value.name.trim() || making.value) return
  making.value = true; failed.value = ''
  try {
    const key = `pk_${form.value.kind}_${random(32)}`
    const row = { name: form.value.name.trim().slice(0, 80), kind: form.value.kind, gated: !!form.value.gated, prefix: key.slice(0, 12), hash: await sha256(key), created_by: user.value ? user.value.id : null }
    const { error } = await supabase.from('api_keys').insert(row)
    if (error) throw error
    reveal.value = { key, name: row.name, kind: row.kind }
    form.value = null
    await load()
  } catch (e) { failed.value = K.failed + (e && e.message ? ' ' + e.message : '') }
  finally { making.value = false }
}
async function revoke(k) {
  if (!window.confirm(K['revoke-confirm'])) return
  await supabase.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', k.id)
  await load()
}
async function copy() { try { await navigator.clipboard.writeText(reveal.value.key); copied.value = true; setTimeout(() => { copied.value = false }, 1600) } catch { /* the field is selectable */ } }
const when = (iso) => { if (!iso) return K.never; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
function openAuth() { if (window.DLauth) window.DLauth.open() }
</script>

<template>
  <div class="ui-page ui-narrow ak">
    <AdminHead :title="H.title" :sub="H.subtitle" />

    <div v-if="state === 'idle'" class="ui-empty ak-gate"><h3>{{ H['signin-heading'] }}</h3><p>{{ H['signin-subtitle'] }}</p><button type="button" class="ui-btn ui-primary" @click="openAuth">{{ H['signin-cta'] }}</button></div>
    <div v-else-if="state === 'denied'" class="ui-empty ak-gate"><h3>{{ H['denied-heading'] }}</h3><p>{{ H['denied-subtitle'] }}</p></div>

    <template v-else-if="state === 'ok'">
      <section class="ak-card ak-space">
        <dl class="ak-facts">
          <div><dt>{{ H.space }}</dt><dd><code>{{ API.space }}</code></dd></div>
          <div><dt>{{ H.environment }}</dt><dd><code>master</code></dd></div>
          <div><dt>{{ H.base }}</dt><dd><code>{{ base }}</code></dd></div>
        </dl>
        <p class="ui-hint">{{ API.public ? H['public-on'] : H['public-off'] }} <a class="ak-ref" :href="ROUTES.api" target="_blank" rel="noopener">{{ R.link }}</a></p>
      </section>

      <section v-if="reveal" class="ak-card ak-reveal">
        <span class="ui-eyebrow">{{ reveal.name }} · {{ K[reveal.kind] }}</span>
        <h2>{{ K['reveal-heading'] }}</h2>
        <p>{{ K['reveal-lead'] }}</p>
        <div class="ak-keyline"><code class="ak-key" tabindex="0">{{ reveal.key }}</code><button type="button" class="ui-btn ui-primary" @click="copy">{{ copied ? K.copied : K.copy }}</button></div>
        <button type="button" class="ui-btn ui-ghost ui-sm" @click="reveal = null">{{ K.done }}</button>
      </section>

      <section class="ak-card">
        <div class="ak-ch"><span class="ui-eyebrow">{{ K.heading }}</span><button v-if="!form" type="button" class="ui-btn ui-primary ui-sm" @click="startNew">{{ K.new }}</button></div>

        <form v-if="form" class="ak-form" @submit.prevent="create">
          <label class="ak-field"><span>{{ K.name }}</span><input v-model="form.name" type="text" class="ui-input" :placeholder="K['name-placeholder']" maxlength="80" required /></label>
          <fieldset class="ak-kinds"><legend>{{ K.kind }}</legend>
            <label v-for="k in KINDS" :key="k" class="ak-kind" :class="{ 'ak-picked': form.kind === k }"><input v-model="form.kind" type="radio" name="kind" :value="k" /><b>{{ K[k] }}</b><small>{{ K[k + '-hint'] }}</small></label>
          </fieldset>
          <label class="ak-switch"><span class="ui-switch ui-compact"><input v-model="form.gated" type="checkbox" /><i></i></span><span><b>{{ K.gated }}</b><small>{{ K['gated-hint'] }}</small></span></label>
          <p v-if="failed" class="ui-hint ak-failed">{{ failed }}</p>
          <div class="ak-actions"><button type="submit" class="ui-btn ui-primary" :disabled="making || !form.name.trim()">{{ making ? K.working : K.create }}</button><button type="button" class="ui-btn" @click="form = null">{{ K.cancel }}</button></div>
        </form>

        <p v-if="!loading && !keys.length" class="ak-none">{{ K.none }}</p>
        <table v-else-if="keys.length" class="ak-table">
          <thead><tr><th>{{ K.name }}</th><th>{{ K.kind }}</th><th>{{ K.created }}</th><th>{{ K['last-used'] }}</th><th></th></tr></thead>
          <tbody>
            <tr v-for="k in keys" :key="k.id" :class="{ 'ak-off': k.revoked_at }">
              <td><b>{{ k.name }}</b><small><code>{{ k.prefix }}…</code></small></td>
              <td><span class="ui-badge" :class="{ 'ui-ok': k.kind === 'delivery' && !k.revoked_at }">{{ K[k.kind] }}</span><span v-if="k.gated" class="ak-gated">{{ K.gated }}</span></td>
              <td>{{ when(k.created_at) }}</td>
              <td>{{ k.revoked_at ? K.revoked : when(k.last_used_at) }}</td>
              <td class="ak-act"><button v-if="!k.revoked_at" type="button" class="ui-btn ui-ghost ui-sm" @click="revoke(k)">{{ K.revoke }}</button></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="ak-card">
        <div class="ak-ch"><span class="ui-eyebrow">{{ WH.heading }}</span></div>
        <p class="ui-hint ak-lead">{{ WH.lead }}</p>
        <p v-if="!loading && !hooks.length" class="ak-none">{{ WH.none }}</p>
        <table v-else-if="hooks.length" class="ak-table">
          <thead><tr><th>{{ WH.name }}</th><th>{{ WH.url }}</th><th>{{ WH.topics }}</th><th>{{ WH.active }}</th><th>{{ WH['last-delivery'] }}</th></tr></thead>
          <tbody>
            <tr v-for="h in hooks" :key="h.id" :class="{ 'ak-off': !h.active }">
              <td><b>{{ h.name }}</b></td>
              <td class="ak-url"><code>{{ h.url }}</code></td>
              <td><span v-for="t in h.topics" :key="t" class="ak-topic"><code>{{ t }}</code></span></td>
              <td><span class="ui-badge" :class="{ 'ui-ok': h.active }">{{ h.active ? WH.on : WH.off }}</span></td>
              <td><span v-if="h.last_error" class="ak-err" :title="h.last_error">{{ WH.failed }}</span><template v-else>{{ h.last_at ? when(h.last_at) : WH.never }}</template></td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>

.ak-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin: 0 0 22px }
.ak-head h1 { margin: 0 0 6px; font-size: 28px } .ak-head p { margin: 0; color: var(--ink2); max-width: 60ch }
.ak-gate { padding: 40px 24px; text-align: center } .ak-gate h3 { margin: 0 0 6px } .ak-gate p { margin: 0 0 16px; color: var(--ink2) }
.ak-card { background: var(--card); border: 1px solid var(--hair); border-radius: 14px; padding: 18px 20px; margin: 0 0 16px }
.ak-facts { display: flex; flex-wrap: wrap; gap: 18px 32px; margin: 0 0 10px } .ak-facts div { display: flex; flex-direction: column; gap: 4px } .ak-facts dt { font-family: var(--m); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3) } .ak-facts dd { margin: 0 } .ak-facts code { font-size: 13px }
.ak-ref { margin-left: 6px; color: var(--ink); text-decoration: underline; text-underline-offset: 3px }
.ak-ch { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 12px }
.ak-reveal { border-color: var(--accent2); background: color-mix(in srgb, var(--accent2) 6%, var(--card)) } .ak-reveal h2 { margin: 6px 0 4px; font-size: 18px } .ak-reveal p { margin: 0 0 12px; color: var(--ink2) }
.ak-keyline { display: flex; gap: 10px; align-items: center; margin: 0 0 12px } .ak-key { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13px; padding: 10px 12px; border-radius: 8px; background: color-mix(in srgb, var(--ink) 6%, transparent); user-select: all }
.ak-form { display: grid; gap: 14px; padding: 4px 0 18px; margin: 0 0 14px; border-bottom: 1px solid var(--hair) }
.ak-field { display: grid; gap: 6px } .ak-field span { font-size: 13px; color: var(--ink2) }
.ak-kinds { border: 0; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px } .ak-kinds legend { font-size: 13px; color: var(--ink2); margin: 0 0 6px }
.ak-kind { display: grid; gap: 2px; padding: 10px 12px; border: 1px solid var(--hair); border-radius: 10px; cursor: pointer } .ak-kind input { position: absolute; opacity: 0; width: 0; height: 0 } .ak-kind b { font-size: 14px } .ak-kind small { color: var(--ink3); font-size: 12px } .ak-picked { border-color: var(--accent2); background: color-mix(in srgb, var(--accent2) 8%, transparent) }
.ak-switch { display: flex; align-items: center; gap: 12px; cursor: pointer } .ak-switch b { display: block; font-size: 14px } .ak-switch small { color: var(--ink3); font-size: 12px }
.ak-actions { display: flex; gap: 8px } .ak-failed { color: var(--ink) }
.ak-none { margin: 0; color: var(--ink3) }
.ak-lead { margin: -6px 0 12px }
.ak-url code { font-size: 12px; overflow-wrap: anywhere } .ak-topic { display: inline-block; margin: 0 6px 2px 0 } .ak-topic code { font-size: 11px } .ak-err { color: var(--ink); text-decoration: underline dotted; text-underline-offset: 3px; cursor: help }
.ak-table { width: 100%; min-width: 0; border-collapse: collapse; font-size: 13px }   /* the site's table rule wants 920px; the card is narrower */ .ak-table th { text-align: left; font-family: var(--m); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); font-weight: 500; padding: 6px 8px; border-bottom: 1px solid var(--hair) } .ak-table td { padding: 10px 8px; border-bottom: 1px solid var(--hair); vertical-align: middle } .ak-table tr:last-child td { border-bottom: 0 }
.ak-table td b { display: block } .ak-table td small { color: var(--ink3) } .ak-table td small code { font-size: 11px } .ak-gated { display: inline-block; margin-left: 6px; font-size: 11px; color: var(--ink3) }
.ak-off td { color: var(--ink3) } .ak-act { text-align: right }
@media (max-width: 640px) { .ak-kinds { grid-template-columns: 1fr } .ak-table th:nth-child(3), .ak-table td:nth-child(3) { display: none } }
</style>

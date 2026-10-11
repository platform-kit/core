<script setup>
/*
 * OTHER APPS, on the reader's own account page (the network module): the address and the handle to
 * give Bluesky's app or any other atproto client, and the app passwords to sign in with — made here,
 * shown once, revoked here. A member never gives another app their own password; the card says so.
 * Words from network.md (apps).
 */
import { computed, ref, onMounted } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { describe, listAppPasswords, makeAppPassword, revokeAppPassword } from '@platform-kit/kit/lib/network/apps.js'
import { user } from '@platform-kit/kit/lib/auth.js'

const props = defineProps({ username: { type: String, default: '' } })
const W = computed(() => us('network').apps.main)
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const server = typeof window !== 'undefined' ? window.location.origin : ''
const domain = ref('')
const rows = ref([])
const name = ref('')
const busy = ref(false)
const err = ref('')
const made = ref(null)
const copied = ref(false)
/* the handle the protocol knows them by: their username, or until they take one, 'm' and the last
   twelve hex of their id (the same rule the server's own reads use) */
const handle = computed(() => {
  const name = props.username || (user.value ? 'm' + user.value.id.replace(/-/g, '').slice(-12) : '')
  return name && domain.value ? `${name}.${domain.value}` : ''
})
const when = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return '' } }

async function load() {
  const [d, list] = await Promise.all([describe().catch(() => null), listAppPasswords().catch(() => [])])
  domain.value = (d && d.domain) || ''
  rows.value = list
}
onMounted(load)

async function make() {
  if (!name.value.trim() || busy.value) return
  busy.value = true; err.value = ''; copied.value = false
  try { made.value = await makeAppPassword(name.value); name.value = ''; rows.value = await listAppPasswords() }
  catch (e) { err.value = e.message || W.value.failed } finally { busy.value = false }
}
async function copy() {
  try { await navigator.clipboard.writeText(made.value.password); copied.value = true } catch { copied.value = false }
}
async function revoke(r) {
  if (!window.confirm(W.value['revoke-confirm'])) return
  try { await revokeAppPassword(r.id); rows.value = rows.value.filter((x) => x.id !== r.id) } catch (e) { err.value = W.value.failed }
}
</script>

<template>
  <div class="na-card">
    <h2>{{ W.title }}</h2>
    <p class="na-line">{{ W.line }}</p>

    <dl class="na-facts">
      <div>
        <dt>{{ W.server }}</dt>
        <dd><code>{{ server }}</code><span>{{ W['server-line'] }}</span></dd>
      </div>
      <div>
        <dt>{{ W.handle }}</dt>
        <dd v-if="handle"><code>@{{ handle }}</code><span>{{ W['handle-line'] }}</span><span v-if="!username">{{ W['handle-none'] }}</span></dd>
      </div>
    </dl>

    <!-- THE PASSWORD, ONCE: in a box of its own, with the one thing to do with it -->
    <div v-if="made" class="na-made" role="status">
      <b>{{ W['made-title'] }} · {{ made.name }}</b>
      <span>{{ W.made }}</span>
      <div class="na-made-row">
        <code>{{ made.password }}</code>
        <button type="button" class="na-quiet" @click="copy">{{ copied ? W.copied : W.copy }}</button>
        <button type="button" class="na-go" @click="made = null">{{ W.done }}</button>
      </div>
    </div>

    <form class="na-make" @submit.prevent="make">
      <label>
        <span>{{ W.name }}</span>
        <input v-model="name" type="text" maxlength="60" autocomplete="off" />
      </label>
      <button type="submit" class="na-go" :disabled="busy || !name.trim()">{{ busy ? W.making : W.make }}</button>
    </form>
    <em v-if="err" class="na-err">{{ err }}</em>

    <h3>{{ W['list-title'] }}</h3>
    <ul v-if="rows.length" class="na-list">
      <li v-for="r in rows" :key="r.id">
        <span class="na-name">{{ r.name }}</span>
        <span class="na-when">{{ fill(W.created, { when: when(r.created_at) }) }} · {{ r.last_used_at ? fill(W.used, { when: when(r.last_used_at) }) : W.never }}</span>
        <button type="button" class="na-quiet na-warn" @click="revoke(r)">{{ W.revoke }}</button>
      </li>
    </ul>
    <p v-else class="na-none">{{ W.none }}</p>
  </div>
</template>

<style scoped>
.na-card { margin: 0 0 18px; padding: 22px 24px; background: var(--paper); border: 1px solid var(--hair); border-radius: 16px }
.na-card h2 { margin: 0 0 6px; font-family: var(--fd); font-size: 17px; font-weight: 700; letter-spacing: -.01em; color: var(--ink) }
.na-card h3 { margin: 20px 0 8px; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--ink3) }
.na-line { max-width: none; margin: 0 0 16px; font-size: 14px; line-height: 1.55; color: var(--ink2) }
.na-facts { display: grid; gap: 10px; margin: 0 0 16px }
.na-facts > div { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 10px; align-items: baseline }
.na-facts dt { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--ink3) }
.na-facts dd { margin: 0; display: flex; flex-direction: column; gap: 3px; min-width: 0 }
.na-facts code, .na-made code { font-family: var(--m); font-size: 13.5px; color: var(--ink); overflow-wrap: anywhere }
.na-facts span { font-size: 12.5px; color: var(--ink3) }
.na-made { display: flex; flex-direction: column; gap: 6px; margin: 0 0 16px; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--ink);
  background: color-mix(in srgb, var(--ink) 4%, var(--paper)) }
.na-made b { font-size: 14px; color: var(--ink) }
.na-made > span { font-size: 13px; color: var(--ink2) }
.na-made-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 4px }
.na-made-row code { padding: 6px 10px; border-radius: 8px; background: var(--paper); border: 1px solid var(--hair); font-size: 16px; letter-spacing: .04em }
.na-make { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px }
.na-make label { flex: 1 1 220px; display: flex; flex-direction: column; gap: 6px }
.na-make label span { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--ink3) }
.na-make input { box-sizing: border-box; width: 100%; font: inherit; font-size: 15px; padding: 10px 12px; border: 1px solid var(--hair); border-radius: 10px;
  background: color-mix(in srgb, var(--ink) 3%, var(--paper)); color: var(--ink) }
.na-go { font: inherit; font-size: 14px; font-weight: 700; padding: 10px 18px; border: 0; border-radius: 10px; background: var(--ink); color: var(--paper); cursor: pointer }
.na-go:disabled { opacity: .45; cursor: default }
.na-quiet { font: inherit; font-size: 13px; font-weight: 600; padding: 7px 12px; border: 1px solid var(--hair); border-radius: 999px; background: transparent; color: var(--ink2); cursor: pointer }
.na-warn { color: #c8382f }
.na-err { display: block; margin-top: 8px; font-style: normal; font-size: 12.5px; color: #c8382f }
.na-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border: 1px solid var(--hair); border-radius: 12px; overflow: hidden }
.na-list li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--hair) }
.na-list li:last-child { border-bottom: 0 }
.na-name { font-size: 14.5px; font-weight: 600; color: var(--ink); overflow-wrap: anywhere }
.na-when { grid-column: 1; font-size: 12.5px; color: var(--ink3) }
.na-list .na-quiet { grid-column: 2; grid-row: 1 / span 2 }
.na-none { max-width: none; margin: 0; padding: 14px; border: 1px dashed var(--hair); border-radius: 12px; font-size: 13.5px; color: var(--ink3) }
@media (max-width: 560px) { .na-facts > div { grid-template-columns: 1fr; gap: 2px } }
</style>

<script setup>
/*
 * JOINING THE WIDER NETWORK, on the reader's own account page — offered only where the site federates
 * (network.federate). Joining is the member's own act: a portable identity is made for them, their
 * page becomes public, and what they post to Everyone is published to Bluesky and every app like it.
 * Leaving takes their public posts down from this site, and says plainly that copies other apps
 * already made may stay. Words from network.md (join).
 */
import { computed, ref, onMounted } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { networkStatus, joinNetwork, leaveNetwork, describe } from '@platform-kit/kit/lib/network/apps.js'

const props = defineProps({ username: { type: String, default: '' } })
const emit = defineEmits(['changed'])
const W = computed(() => us('network').join.main)
const status = ref(null)
const domain = ref('')
const busy = ref(false)
const err = ref('')
const handle = computed(() => (props.username && domain.value ? `@${props.username}.${domain.value}` : ''))

onMounted(async () => {
  const [st, d] = await Promise.all([networkStatus().catch(() => null), describe().catch(() => null)])
  status.value = st
  domain.value = (d && d.domain) || ''
})
async function go() {
  busy.value = true; err.value = ''
  try { await joinNetwork(); status.value = await networkStatus(); emit('changed') } catch (e) { err.value = e.message || W.value.failed } finally { busy.value = false }
}
async function leave() {
  if (!window.confirm(W.value['leave-confirm'])) return
  busy.value = true; err.value = ''
  try { await leaveNetwork(); status.value = await networkStatus(); emit('changed') } catch (e) { err.value = e.message || W.value.failed } finally { busy.value = false }
}
</script>

<template>
  <div v-if="status" class="nj-card" :class="{ 'nj-on': status.joined }">
    <template v-if="!status.joined">
      <h2>{{ W.title }}</h2>
      <p>{{ W.line }}</p>
      <p v-if="!username" class="nj-note">{{ W['needs-name'] }}</p>
      <button type="button" class="nj-go" :disabled="busy || !username" @click="go">{{ busy ? W.joining : W.join }}</button>
    </template>
    <template v-else>
      <p class="nj-as">{{ (W['joined-as'] || '').replace('{handle}', handle) }}</p>
      <h2>{{ W['joined-title'] }}</h2>
      <p>{{ W['joined-line'] }}</p>
      <button type="button" class="nj-quiet" :disabled="busy" @click="leave">{{ busy ? W.leaving : W.leave }}</button>
    </template>
    <em v-if="err" class="nj-err">{{ err }}</em>
  </div>
</template>

<style scoped>
.nj-card { margin: 0 0 18px; padding: 22px 24px; background: var(--paper); border: 1px solid var(--hair); border-radius: 16px }
.nj-on { border-color: color-mix(in srgb, var(--accent) 40%, var(--hair)) }
.nj-card h2 { margin: 0 0 6px; font-family: var(--fd); font-size: 17px; font-weight: 700; letter-spacing: -.01em; color: var(--ink) }
.nj-card p { max-width: none; margin: 0 0 14px; font-size: 14px; line-height: 1.55; color: var(--ink2) }
.nj-card .nj-note { font-size: 13px; color: var(--ink3) }
.nj-as { font-size: 13px !important; font-weight: 700; color: var(--accent) !important; margin-bottom: 10px !important }
.nj-go { font: inherit; font-size: 14px; font-weight: 700; padding: 10px 22px; border: 0; border-radius: 10px; background: var(--ink); color: var(--paper); cursor: pointer }
.nj-go:disabled { opacity: .45; cursor: default }
.nj-quiet { font: inherit; font-size: 13.5px; font-weight: 600; padding: 9px 16px; border: 1px solid var(--hair); border-radius: 10px; background: transparent; color: #c8382f; cursor: pointer }
.nj-err { display: block; margin-top: 10px; font-style: normal; font-size: 12.5px; color: #c8382f }
</style>

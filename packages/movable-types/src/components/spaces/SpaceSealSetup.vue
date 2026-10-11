<script setup>
/*
 * WHAT A SEALED ROOM ASKS OF THE READER, and the only place it is asked. Three states, one at a
 * time, each a card above the composer in the room they apply to — never a modal and never a
 * toast, because each is a standing fact about this browser that must still be there when the
 * reader looks again.
 *
 *   SET THIS DEVICE UP — a sealed room is read by a device, not by an account, and this browser
 *     has no keys in it yet. Pressing it publishes them and makes the recovery key.
 *   YOUR RECOVERY KEY — shown ONCE, at the one moment it exists outside the library's own store.
 *     Nothing writes it down: not a row, not localStorage, not a log. When the reader says they
 *     have it, it is gone from the page, and nothing here can show it again.
 *   READ YOUR EARLIER MESSAGES — this browser is set up and the account has a history it cannot
 *     open. The key lets it in; carrying on without it costs only what was said before.
 *
 * Every sentence is `## encryption / ### setup` in spaces.md. Nothing is decided here: the state
 * comes from `sealing` in api.js, which is the only thing that has ever spoken to the crypto.
 */
import { ref, computed, watch } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { sealing, makeRecoveryKey, keyKept, useRecoveryKey, skipRecoveryKey, unskip } from '@platform-kit/kit/lib/spaces/api.js'
import { spaceOut } from '@platform-kit/kit/lib/spaces/model.js'

const S = computed(() => us('spaces').encryption.setup)

const typed = ref('')
const lost = ref(false)
const copied = ref(false)

/* which of the three, or none at all */
const show = computed(() => {
  if (sealing.key) return 'key'
  if (!sealing.ready || !sealing.backup) return 'setup'
  if (!sealing.holds && !sealing.skipped) return lost.value ? 'lost' : 'restore'
  return null
})

watch(() => sealing.key, (k) => { if (k) copied.value = false })

/* going back from "carrying on without it" undoes it: without this the card simply vanished and
   there was no way back to the key short of a reload. */
function backToKey() { lost.value = false; unskip() }

async function start() {
  await makeRecoveryKey()
}
async function unlock() {
  if (!typed.value.trim()) return
  const got = await useRecoveryKey(typed.value)
  if (got) typed.value = ''
}
async function copy() {
  try { await navigator.clipboard.writeText(sealing.key); copied.value = true } catch { copied.value = false }
}
</script>

<template>
  <div v-if="show" class="sz" :class="'sz-' + show">
    <!-- the device has no keys in it yet -->
    <template v-if="show === 'setup'">
      <p class="sz-head">{{ S.title }}</p>
      <p class="sz-line">{{ S.line }}</p>
      <button class="sz-go" type="button" :disabled="sealing.working" @click="start">
        {{ sealing.working ? S.working : S.start }}
      </button>
    </template>

    <!-- the one time the key exists outside the browser's own store -->
    <template v-else-if="show === 'key'">
      <p class="sz-head">{{ S['key-title'] }}</p>
      <p class="sz-line">{{ S['key-line'] }}</p>
      <p class="sz-secret">{{ spaceOut(sealing.key) }}</p>
      <div class="sz-row">
        <button class="sz-copy" type="button" @click="copy">{{ copied ? S['key-copied'] : S['key-copy'] }}</button>
        <button class="sz-go" type="button" @click="keyKept">{{ S['key-done'] }}</button>
      </div>
    </template>

    <!-- set up here, with a history this browser cannot open -->
    <template v-else-if="show === 'restore'">
      <p class="sz-head">{{ S['restore-title'] }}</p>
      <p class="sz-line">{{ S['restore-line'] }}</p>
      <form class="sz-row" @submit.prevent="unlock">
        <input
          v-model="typed" class="sz-field" type="text" autocomplete="off" spellcheck="false"
          :placeholder="S['restore-placeholder']" :aria-label="S['restore-placeholder']"
        >
        <button class="sz-go" type="submit" :disabled="sealing.working || !typed.trim()">
          {{ sealing.working ? S.restoring : S.restore }}
        </button>
      </form>
      <p v-if="sealing.wrong" class="sz-wrong">{{ S['restore-wrong'] }}</p>
      <button class="sz-quiet" type="button" @click="lost = true">{{ S['lost-title'] }}</button>
    </template>

    <!-- and what it costs to go on without it -->
    <template v-else-if="show === 'lost'">
      <p class="sz-head">{{ S['lost-title'] }}</p>
      <p class="sz-line">{{ S['lost-line'] }}</p>
      <div class="sz-row">
        <button class="sz-quiet" type="button" @click="backToKey">{{ S['restore-title'] }}</button>
        <button class="sz-go" type="button" @click="skipRecoveryKey">{{ S['key-done'] }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* A CARD, not a banner: it is doing something, so it stands on the paper with a visible edge and
   room to breathe, and it sits where the reader's hands already are — just above the composer. */
.sz { margin: 0 16px 10px; padding: 14px 16px; border: 1px solid var(--hair); border-radius: 12px;
      background: var(--card); display: flex; flex-direction: column; gap: 8px; align-items: flex-start }
.sz-head { margin: 0; font-family: var(--m); font-size: 10.5px; letter-spacing: .1em;
           text-transform: uppercase; color: var(--ink2) }
.sz-line { margin: 0; font-size: 13px; line-height: 1.55; color: var(--ink3); max-width: 62ch }
.sz-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; width: 100% }

.sz-go { font: inherit; font-size: 13px; padding: 7px 14px; border: 1px solid transparent;
         border-radius: 8px; background: var(--ink); color: var(--paper); cursor: pointer }
.sz-go:disabled { opacity: .55; cursor: default }
.sz-copy, .sz-quiet { font: inherit; font-size: 13px; padding: 7px 12px; border: 1px solid var(--hair);
                      border-radius: 8px; background: transparent; color: var(--ink2); cursor: pointer }
.sz-quiet { border-color: transparent; padding-left: 0; color: var(--ink3); text-decoration: underline;
            text-underline-offset: 3px }

/* THE KEY ITSELF, in the mono face and in groups of four: a 43-character secret is copied off a
   screen by hand exactly once, and only if it is grouped. It selects whole on a click.

   NOT `.sz-key`: that is the root's own modifier for this state, and an inner element sharing it
   put the whole card in the mono face and broke its sentences mid-word. A root class is never
   also an inner one. */
.sz-secret { margin: 2px 0; padding: 10px 12px; width: 100%; box-sizing: border-box;
          font-family: var(--m); font-size: 13.5px; line-height: 1.8; letter-spacing: .04em;
          word-break: normal; overflow-wrap: normal; color: var(--ink); background: var(--wash); border-radius: 8px;
          user-select: all }

.sz-field { flex: 1 1 240px; min-width: 0; font: inherit; font-family: var(--m); font-size: 13px;
            padding: 7px 10px; border: 1px solid var(--hair); border-radius: 8px;
            background: var(--paper); color: var(--ink) }
.sz-wrong { margin: 0; font-size: 12.5px; color: var(--ink2) }

@media (max-width: 560px) {
  .sz { margin: 0 10px 8px; padding: 12px }
  .sz-go, .sz-copy, .sz-quiet { width: 100%; text-align: center }
  .sz-quiet { padding-left: 12px }
}
</style>

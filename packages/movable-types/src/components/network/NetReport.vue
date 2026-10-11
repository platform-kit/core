<script setup>
/* REPORTING a post or a person: a reason from the list, a line of the reader's own if they want,
   and a person reads it — nothing here is judged by a machine (the moderation spec). A modal of its
   own, over a dimmed page, with the choices as rows. Words from network.md (report). */
import { computed, ref } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { report } from '@platform-kit/kit/lib/network/api.js'

const props = defineProps({
  post: { type: Object, default: null },
  person: { type: String, default: '' },
})
const emit = defineEmits(['close'])
const R = computed(() => us('network').report.main)
const REASONS = ['spam', 'abuse', 'harm', 'other']
const reason = ref('spam')
const note = ref('')
const busy = ref(false)
const sent = ref(false)
const err = ref('')
async function send() {
  busy.value = true; err.value = ''
  try { await report({ post: props.post ? props.post.id : null, person: props.post ? null : props.person, reason: reason.value, note: note.value }); sent.value = true }
  catch (e) { err.value = e.message || String(e) } finally { busy.value = false }
}
</script>

<template>
  <div class="nr-scrim" @click.self="emit('close')">
    <form class="nr" role="dialog" aria-modal="true" :aria-label="R.title" @submit.prevent="send" @keydown.esc="emit('close')">
      <h2>{{ R.title }}</h2>
      <template v-if="!sent">
        <p class="nr-line">{{ R.line }}</p>
        <div class="nr-reasons" role="radiogroup" :aria-label="R.title">
          <label v-for="k in REASONS" :key="k" class="nr-reason" :class="{ on: reason === k }">
            <input v-model="reason" type="radio" :value="k" name="nr-reason" />
            <span>{{ R['reason-' + k] }}</span>
          </label>
        </div>
        <label class="nr-note">
          <span>{{ R.note }}</span>
          <textarea v-model="note" rows="3" maxlength="1000"></textarea>
        </label>
        <em v-if="err" class="nr-err">{{ err }}</em>
        <div class="nr-bar">
          <button type="button" class="nr-quiet" @click="emit('close')">{{ R.cancel }}</button>
          <button type="submit" class="nr-go" :disabled="busy">{{ R.send }}</button>
        </div>
      </template>
      <template v-else>
        <p class="nr-line">{{ R.sent }}</p>
        <div class="nr-bar"><button type="button" class="nr-go" @click="emit('close')">{{ R.cancel }}</button></div>
      </template>
    </form>
  </div>
</template>

<style scoped>
.nr-scrim { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 16px;
  background: color-mix(in srgb, #000 42%, transparent) }
.nr { box-sizing: border-box; width: min(440px, 100%); padding: 22px 22px 18px; border-radius: 18px; background: var(--paper);
  border: 1px solid var(--hair); box-shadow: 0 30px 80px -30px rgba(0, 0, 0, .5) }
.nr h2 { margin: 0 0 6px; font-family: var(--fd); font-size: 20px; font-weight: 700; color: var(--ink) }
.nr-line { margin: 0 0 14px; font-size: 14px; line-height: 1.5; color: var(--ink2) }
.nr-reasons { display: flex; flex-direction: column; gap: 6px }
.nr-reason { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--hair); border-radius: 10px;
  font-size: 14.5px; color: var(--ink); cursor: pointer }
.nr-reason.on { border-color: var(--ink); background: color-mix(in srgb, var(--ink) 4%, transparent) }
.nr-note { display: block; margin-top: 14px }
.nr-note span { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--ink3) }
.nr-note textarea { box-sizing: border-box; width: 100%; font: inherit; font-size: 14.5px; padding: 9px 11px; border: 1px solid var(--hair);
  border-radius: 10px; background: color-mix(in srgb, var(--ink) 3%, var(--paper)); color: var(--ink); resize: vertical }
.nr-err { display: block; margin-top: 8px; font-style: normal; font-size: 12.5px; color: #c8382f }
.nr-bar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px }
.nr-quiet, .nr-go { font: inherit; font-size: 14px; font-weight: 700; padding: 9px 18px; border-radius: 999px; cursor: pointer }
.nr-quiet { border: 1px solid var(--hair); background: transparent; color: var(--ink2) }
.nr-go { border: 0; background: var(--ink); color: var(--paper) }
.nr-go:disabled { opacity: .45; cursor: default }
</style>

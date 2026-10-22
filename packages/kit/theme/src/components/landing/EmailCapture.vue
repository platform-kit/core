<script setup>
/*
 * One field and one button: an address, captured into one of the site's forms (lib/capture.js).
 * The words are the page's (the button, the placeholder) with the section strings' behind them;
 * the states — sending, done, refused — are the strings'. Inline in a hero, a CTA or a newsletter.
 */
import { ref, computed } from 'vue'
import { md } from './md.js'
import { us } from 'platformkit/lib/strings.js'
import { capture, isEmail } from '../../lib/capture.js'
const props = defineProps({
  form: { type: String, default: '' },
  button: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  fine: { type: String, default: '' },       /* under the field: "No spam. Unsubscribe any time." */
  size: { type: String, default: 'normal' }, /* normal | large */
  name: { type: Boolean, default: false },   /* a first-name field before the address (to a form with a text field named name) */
  namePlaceholder: { type: String, default: '' },
})
const W = (us('sections').capture || {}).field || {}
const email = ref(''), first = ref(''), state = ref('idle'), error = ref('')
const label = computed(() => props.button || W.button || 'Subscribe')
async function go() {
  if (state.value === 'sending' || state.value === 'done') return
  if (!isEmail(email.value)) { error.value = W.invalid || ''; return }
  error.value = ''; state.value = 'sending'
  try { await capture(props.form, email.value, props.name ? { name: first.value } : {}); state.value = 'done' } catch (e) { state.value = 'idle'; error.value = W.error || String(e.message || e) }
}
</script>

<template>
  <form class="lpcap" :class="['lpcap-' + size, { done: state === 'done' }]" @submit.prevent="go">
    <template v-if="state !== 'done'">
      <div class="lpcap-row">
        <input v-if="name" v-model="first" type="text" class="lpcap-in lpcap-name" :placeholder="namePlaceholder || W.name || ''" autocomplete="given-name" :aria-label="namePlaceholder || W.name || ''" />
        <input v-model="email" type="email" class="lpcap-in" :placeholder="placeholder || W.placeholder || ''" autocomplete="email" required :aria-label="placeholder || W.placeholder || ''" />
        <button type="submit" class="lpbtn text-white lpcap-btn" :disabled="state === 'sending'"><span v-html="md(state === 'sending' ? (W.sending || label) : label)"></span></button>
      </div>
      <p v-if="error" class="lpcap-err">{{ error }}</p>
      <p v-else-if="fine" class="lpcap-fine" v-html="md(fine)"></p>
    </template>
    <p v-else class="lpcap-done"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg><span v-html="md(W.done || '')"></span></p>
  </form>
</template>

<style scoped>
.lpcap { display: flex; flex-direction: column; gap: 8px; max-width: 460px }
.lpcap-row { display: flex; gap: 8px; padding: 5px; border-radius: 999px; background: var(--card); border: 1px solid var(--hair); box-shadow: var(--sh) }
.lpcap-in { flex: 1; min-width: 0; font: inherit; font-size: 15px; color: var(--ink); background: transparent; border: 0; padding: 0 16px; outline: none }
.lpcap-in::placeholder { color: var(--ink3) }
.lpcap-name { flex: 0 1 140px; border-right: 1px solid var(--hair); border-radius: 0 }
.lpcap-btn { padding: 12px 22px; font-size: 14.5px; white-space: nowrap }
.lpcap-large .lpcap-btn { padding: 14px 26px; font-size: 15.5px }
.lpcap-large .lpcap-in { font-size: 16px }
.lpcap-fine, .lpcap-err { margin: 0; font-size: 13px; color: var(--ink3); padding-left: 12px }
.lpcap-err { color: #c2410c }
.lpcap-done { display: inline-flex; align-items: center; gap: 10px; margin: 0; padding: 12px 18px; border-radius: 999px; background: var(--accentbg); color: var(--accent2); font-weight: 600; font-size: 15px }
@media (max-width: 480px) { .lpcap-row { flex-direction: column; border-radius: 16px; padding: 6px } .lpcap-in { padding: 10px 12px } .lpcap-btn { justify-content: center } }
</style>

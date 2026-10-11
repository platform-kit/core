<script setup>
/*
 * The site's one toast — src/lib/toast.js says what it holds. A card at the
 * foot of the window: an icon for its kind, a title, a line, a dismiss. It
 * slides up on arrival and away on dismissal, and the words are whoever
 * called toast()'s, from the strings files.
 */
import { current, hide, act } from '@platform-kit/kit/lib/toast.js'
</script>

<template>
  <Transition name="toast">
    <div v-if="current" class="toast" :class="'toast-' + current.kind" role="status" aria-live="polite">
      <span class="toast-icon" aria-hidden="true">
        <svg v-if="current.kind === 'lock'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/></svg>
        <svg v-else-if="current.kind === 'warn'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 21 19.5H3z"/><path d="M12 10v4M12 17h.01"/></svg>
        <svg v-else-if="current.kind === 'ok'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
        <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
      </span>
      <div class="toast-text">
        <b v-if="current.title">{{ current.title }}</b>
        <p v-if="current.body">{{ current.body }}</p>
      </div>
      <div class="toast-acts">
        <button v-if="current.action" type="button" class="toast-x" @click="act">{{ current.action.label }}</button>
        <button v-if="current.dismiss" type="button" class="toast-x" :class="{ quiet: !!current.action }" @click="hide">{{ current.dismiss }}</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 120; display: flex; align-items: flex-start; gap: 14px;
  width: min(480px, calc(100vw - 32px)); padding: 16px 16px 16px 18px; border-radius: 16px;
  background: var(--paper); color: var(--ink); border: 1px solid var(--hair);
  box-shadow: 0 24px 60px -24px #000c, 0 1px 2px #0000000d }
.toast-icon { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; flex: none; border-radius: 50%;
  color: var(--accent2); background: color-mix(in srgb, var(--accent2) 12%, transparent) }
.toast-text { flex: 1; min-width: 0 }
.toast-text b { display: block; font-family: var(--fd); font-weight: 600; font-size: 16px; letter-spacing: -.01em; line-height: 1.25; margin: 2px 0 4px }
.toast-text p { margin: 0; font-size: 14px; line-height: 1.5; color: var(--ink2) }
.toast-acts { align-self: center; display: flex; flex-direction: column; align-items: stretch; gap: 6px; flex: none }
.toast-warn .toast-icon { color: #b3402e; background: color-mix(in srgb, #b3402e 12%, transparent) }
.toast-ok .toast-icon { color: #1f7a4d; background: color-mix(in srgb, #1f7a4d 12%, transparent) }
.toast-x.quiet { color: var(--ink2); background: none; border: 1px solid var(--hair) }
.toast-x { flex: none; font: inherit; font-size: 13px; font-weight: 600; color: var(--paper); background: var(--ink); border: 0;
  border-radius: 999px; padding: 8px 14px; cursor: pointer }
.toast-enter-active { transition: opacity .28s ease, transform .28s cubic-bezier(.2, .8, .2, 1) }
.toast-leave-active { transition: opacity .18s ease, transform .18s ease }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 16px) }
@media (prefers-reduced-motion: reduce) { .toast-enter-active, .toast-leave-active { transition: none } }
@media (max-width: 480px) { .toast { bottom: 12px; padding: 14px; gap: 12px } .toast-acts { align-self: flex-end } }
</style>

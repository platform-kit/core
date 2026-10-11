<script setup>
/*
 * THE KEYBOARD MAP, shown. `?` opens it, and it is the only place the shortcuts are written down —
 * read from the same list the handler reads, so a shortcut can never be documented as something it
 * does not do. The symbols are the ones on the reader's own machine.
 */
import { computed } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { KEYS, sayKey } from '@platform-kit/kit/lib/spaces/keys.js'

const emit = defineEmits(['close'])
const K = computed(() => us('spaces').keys.main)
const mac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent || '')
const rows = computed(() => KEYS.map((k) => ({ keys: sayKey(k, { mac }), says: K.value[k.command] || k.command })))
</script>

<template>
  <div class="sk" @click.self="emit('close')" @keydown.esc="emit('close')">
    <section class="sk-box" role="dialog" :aria-label="K.title">
      <header><b>{{ K.title }}</b><button type="button" :aria-label="K.dismiss" @click="emit('close')">×</button></header>
      <ul>
        <li v-for="r in rows" :key="r.keys + r.says"><span>{{ r.says }}</span><kbd>{{ r.keys }}</kbd></li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.sk { position: fixed; inset: 0; z-index: 150; display: grid; place-items: center; padding: 24px;
  background: color-mix(in srgb, var(--ink) 22%, transparent) }
.sk-box { display: flex; flex-direction: column; gap: 10px; width: min(420px, 100%); max-height: 80vh;
  padding: 18px; overflow-y: auto; background: var(--paper); border: 1px solid var(--hair, var(--line, var(--hair)));
  border-radius: 15px; box-shadow: 0 24px 60px rgba(0, 0, 0, .22) }
.sk-box > header { display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin: 0; padding: 0; background: none; border: 0 }
.sk-box > header b { font-size: 15px; font-weight: 700 }
.sk-box > header button { font: inherit; font-size: 18px; line-height: 1; color: var(--ink3);
  background: none; border: 0; padding: 0 2px; cursor: pointer }
.sk-box ul { display: flex; flex-direction: column; gap: 1px; margin: 0; padding: 0; list-style: none }
.sk-box li { display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 7px 2px; font-size: 13.5px }
.sk-box li + li { border-top: 1px solid color-mix(in srgb, var(--ink) 7%, transparent) }
.sk-box kbd { flex: none; font: inherit; font-size: 12px; font-weight: 600; letter-spacing: .02em;
  padding: 3px 8px; color: var(--ink2);
  background: color-mix(in srgb, var(--ink) 7%, transparent); border-radius: 6px }
</style>

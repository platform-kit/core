<script setup>
/*
 * A coach starting a conversation: a modal with a search box that asks the
 * server as they type (chat_members(q) — a page of matches, never the whole
 * membership), the matches as rows with a name, an email and a tier, and the
 * keyboard through them: arrows move, Enter opens, Escape closes. A member
 * the coach already talks to is marked, and choosing them opens that thread.
 * Words from content/app/ui/chat.md (picker).
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { members, membersTotal, loadMembers } from 'platformkit/lib/chat/api.js'
import ChatAvatar from './ChatAvatar.vue'

const emit = defineEmits(['pick', 'close'])
const K = us('chat').picker.main

const q = ref('')
const box = ref(null)
const list = ref(null)
const cursor = ref(0)
const searching = ref(false)
let timer = null

const count = computed(() => K.count.replace('{n}', membersTotal.value))
const rows = computed(() => members.value)

async function search() {
  searching.value = true
  await loadMembers(q.value.trim())
  searching.value = false
  cursor.value = 0
}
watch(q, () => { clearTimeout(timer); timer = setTimeout(search, 160) })

function move(d) {
  if (!rows.value.length) return
  cursor.value = (cursor.value + d + rows.value.length) % rows.value.length
  const el = list.value && list.value.children[cursor.value]
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
}
function choose(m) { if (m) emit('pick', m) }
function key(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
  else if (e.key === 'Enter') { e.preventDefault(); choose(rows.value[cursor.value]) }
}

/* Escape closes wherever focus is */
function esc(e) { if (e.key === 'Escape') { e.preventDefault(); emit('close') } }
onMounted(() => { search(); document.addEventListener('keydown', esc); setTimeout(() => box.value && box.value.focus(), 30) })
onBeforeUnmount(() => { clearTimeout(timer); document.removeEventListener('keydown', esc) })
</script>

<template>
  <Teleport to="body">
    <div class="nm-veil" @click.self="emit('close')">
      <div class="nm-card" role="dialog" aria-modal="true" :aria-label="K.title" @keydown="key">
        <div class="nm-head">
          <h2 class="nm-h">{{ K.title }}</h2>
          <span v-if="membersTotal" class="nm-count">{{ count }}</span>
          <button type="button" class="nm-x" :aria-label="K.close" :title="K.close" @click="emit('close')">
            <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>
          </button>
        </div>
        <label class="nm-search" :class="{ busy: searching }">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M13.5 13.5 17.5 17.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          <input ref="box" v-model="q" type="search" :placeholder="K.placeholder" :aria-label="K.placeholder" autocomplete="off" spellcheck="false"
                 role="combobox" aria-autocomplete="list" aria-controls="nm-list" :aria-activedescendant="rows.length ? 'nm-' + cursor : null" />
          <span class="nm-spin" aria-hidden="true" />
        </label>
        <p class="nm-hint">{{ K.hint }}</p>
        <div id="nm-list" ref="list" class="nm-list" role="listbox">
          <button v-for="(m, i) in rows" :id="'nm-' + i" :key="m.id" type="button" role="option" class="nm-row" :class="{ on: i === cursor }"
                  :aria-selected="i === cursor" @mousemove="cursor = i" @click="choose(m)">
            <ChatAvatar :name="m.name" :size="38" />
            <span class="nm-body">
              <b>{{ m.name }}</b>
              <span>{{ m.email }}</span>
            </span>
            <span class="nm-meta">
              <i v-if="m.tier" class="nm-tier">{{ m.tier }}</i>
              <em class="nm-act">{{ m.conversation_id ? K.open : K.start }}</em>
            </span>
          </button>
          <p v-if="!rows.length && !searching" class="nm-empty">{{ membersTotal ? K.none : K.empty }}</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.nm-veil { position: fixed; inset: 0; z-index: 95; display: flex; align-items: flex-start; justify-content: center; padding: clamp(24px, 12vh, 120px) 16px 24px;
  background: #0a0d0b66; backdrop-filter: blur(6px) }
.nm-card { width: 100%; max-width: 520px; max-height: min(640px, calc(100vh - 48px)); display: flex; flex-direction: column;
  background: var(--paper); color: var(--ink); border: 1px solid var(--hair); border-radius: 20px;
  box-shadow: 0 30px 80px -30px #000c, 0 1px 2px #0000000d; overflow: hidden }
.nm-head { display: flex; align-items: center; gap: 10px; padding: 18px 18px 10px 22px }
.nm-h { flex: 1; margin: 0; font-family: var(--fd); font-weight: 600; font-size: 20px; letter-spacing: -.02em }
.nm-count { font-family: var(--m); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3) }
.nm-x { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; color: var(--ink3); background: none; border: 0; border-radius: 8px; cursor: pointer }
.nm-x:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 7%, transparent) }
.nm-search { display: flex; align-items: center; gap: 10px; margin: 0 18px; padding: 0 12px; border-radius: 12px; color: var(--ink3);
  background: var(--card); border: 1px solid var(--hair); transition: border-color .12s }
.nm-search:focus-within { border-color: var(--ink3); color: var(--ink2) }
.nm-search input { flex: 1; min-width: 0; font: inherit; font-size: 15px; color: var(--ink); background: none; border: 0; outline: none; padding: 11px 0 }
.nm-search input::placeholder { color: var(--ink3) }
.nm-search input::-webkit-search-cancel-button { -webkit-appearance: none }
.nm-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--hair); border-top-color: var(--accent2); opacity: 0; flex: none }
.nm-search.busy .nm-spin { opacity: 1; animation: nmspin .7s linear infinite }
@keyframes nmspin { to { transform: rotate(360deg) } }
.nm-hint { margin: 8px 22px 6px; font-family: var(--m); font-size: 10.5px; letter-spacing: .06em; color: var(--ink3) }
.nm-list { flex: 1; min-height: 120px; overflow-y: auto; padding: 4px 8px 10px; overscroll-behavior: contain }
.nm-row { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; font: inherit; color: var(--ink); background: none; border: 0;
  border-radius: 12px; padding: 9px 12px; cursor: pointer }
.nm-row.on { background: color-mix(in srgb, var(--accent) 9%, var(--paper)) }
.nm-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px }
.nm-body b { font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.nm-body span { font-size: 13px; color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.nm-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex: none }
.nm-tier { font-style: normal; font-family: var(--m); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3);
  border: 1px solid var(--hair); border-radius: 999px; padding: 2px 7px }
.nm-act { font-style: normal; font-size: 12px; color: var(--accent2); opacity: 0; transition: opacity .1s }
.nm-row.on .nm-act { opacity: 1 }
.nm-empty { margin: 0; padding: 26px 14px; text-align: center; font-size: 14px; color: var(--ink3) }
@media (max-width: 640px) { .nm-veil { padding: 12px 10px } .nm-card { max-height: calc(100vh - 24px) } .nm-tier, .nm-act { display: none } }
@media (prefers-reduced-motion: no-preference) { .nm-card { animation: nm-in .18s ease-out } @keyframes nm-in { from { opacity: 0; transform: translateY(8px) scale(.985) } to { opacity: 1; transform: none } } }
</style>

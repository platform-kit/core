<script setup>
/*
 * Asking the room a question. A question, and the answers as ROWS to add, reorder and remove —
 * never a list typed into a box, never a placeholder teaching a separator. The structure this
 * produces is the structure the database is given; nobody is asked to type the grammar of it.
 * Words from spaces.md (poll).
 */
import { computed, ref, nextTick } from 'vue'
import { us } from 'platformkit/lib/content.js'
import SpaceIcon from './SpaceIcon.vue'

const emit = defineEmits(['ask', 'cancel'])
const W = computed(() => us('spaces').poll.main)
const question = ref('')
const options = ref(['', ''])
const multi = ref(false)
const rows = ref(null)

const ready = computed(() => !!question.value.trim() && options.value.filter((o) => o.trim()).length >= 2)

async function add() {
  options.value.push('')
  await nextTick()
  const last = rows.value && rows.value.querySelectorAll('input')
  if (last && last.length) last[last.length - 1].focus()
}
const drop = (i) => { if (options.value.length > 2) options.value.splice(i, 1); else options.value[i] = '' }
function ask() {
  if (!ready.value) return
  emit('ask', { question: question.value.trim(), options: options.value.map((o) => o.trim()).filter(Boolean), multi: multi.value })
}
</script>

<template>
  <div class="sk">
    <label class="sk-q">
      <span>{{ W.question }}</span>
      <input
        v-model="question" type="text" :placeholder="W['question-placeholder']"
        :aria-label="W.question" @keydown.enter.prevent="add" />
    </label>

    <ul ref="rows" class="sk-list">
      <li v-for="(o, i) in options" :key="i">
        <input
          v-model="options[i]" type="text" :placeholder="W['option-placeholder']"
          :aria-label="(W.option || '').replace('{n}', i + 1)"
          @keydown.enter.prevent="i === options.length - 1 ? add() : null" />
        <button
          type="button" class="sk-x" :aria-label="W['drop-option']" :title="W['drop-option']"
          @click="drop(i)">×</button>
      </li>
    </ul>

    <button type="button" class="sk-add" @click="add">
      <SpaceIcon name="plus" :size="13" />{{ W['add-option'] }}
    </button>

    <label class="sk-multi">
      <input v-model="multi" type="checkbox" />
      <span>{{ W.multi }}</span>
    </label>

    <p v-if="!ready" class="sk-note">{{ W['too-few'] }}</p>

    <footer class="sk-foot">
      <button type="button" class="sk-quiet" @click="emit('cancel')">{{ W.cancel }}</button>
      <button type="button" class="sk-go" :disabled="!ready" @click="ask">{{ W.ask }}</button>
    </footer>
  </div>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; these say what they want instead */
/* a measure of its own: an answer is a few words, and a field nine hundred pixels wide for "Thursday"
   invites an essay — the poll it makes is 460 wide, so the form that makes it is not far off */
.sk { display: grid; gap: 10px; max-width: 520px; padding: 14px 16px 15px }
.sk-q { display: grid; gap: 4px }
.sk-q span { font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--ink3) }
.sk input[type="text"] { width: 100%; box-sizing: border-box; font: inherit; font-size: 14px; color: var(--ink);
  background: var(--paper); border: 1px solid var(--hair); border-radius: 8px; padding: 8px 11px }
.sk input[type="text"]:focus { outline: none; border-color: color-mix(in srgb, var(--ink) 40%, transparent) }
.sk-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px }
.sk-list li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center }
.sk-x { width: 30px; height: 30px; font: inherit; font-size: 17px; line-height: 1; color: var(--ink3);
  background: transparent; border: 0; border-radius: 7px; cursor: pointer }
.sk-x:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 7%, transparent) }
.sk-add { display: flex; align-items: center; gap: 7px; width: auto; justify-self: start; font: inherit;
  font-size: 13px; font-weight: 600; color: var(--ink2); background: transparent; border: 1px solid var(--hair);
  border-radius: 999px; padding: 6px 12px; cursor: pointer }
.sk-add:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.sk-multi { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink2) }
.sk-note { margin: 0; max-width: none; font-size: 12px; color: var(--ink3) }
.sk-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 0; border: 0 }
.sk-quiet { width: auto; font: inherit; font-size: 13px; font-weight: 600; color: var(--ink3);
  background: transparent; border: 0; padding: 7px 10px; cursor: pointer }
.sk-go { width: auto; font: inherit; font-size: 13px; font-weight: 700; color: var(--paper);
  background: var(--ink); border: 0; border-radius: 999px; padding: 8px 16px; cursor: pointer }
.sk-go:disabled { opacity: .45; cursor: default }
</style>

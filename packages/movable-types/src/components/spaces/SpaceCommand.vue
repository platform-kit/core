<script setup>
/*
 * A COMMAND'S ARGUMENTS, AS FIELDS.
 *
 * The one rule this file exists for: nobody types a grammar. `/summarise since: 2d` is not
 * something a person should have to remember the shape of, so a span is a number and a unit, a
 * choice is a list, a person is picked from the room, a boolean is a switch — and what goes to the
 * bot is built from the controls, never parsed back out of a line somebody typed. A command with
 * no arguments has no form at all: it runs.
 *
 * The command record is the compiled one (build/bots.mjs → .velite/commands.json), which carries
 * the name, the hint and each argument's kind, label, default and choices — and deliberately NOT
 * the prompt: what the command asks the bot stays in the file and is filled in by the worker.
 */
import { ref, computed, onMounted, nextTick } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import SpaceIcon from './SpaceIcon.vue'

const props = defineProps({
  command: { type: Object, required: true },
  people: { type: Array, default: () => [] },
})
const emit = defineEmits(['run', 'cancel'])
const W = computed(() => us('spaces').commands.main)

/* the units a span is offered in, shortest first — the same letters the files use */
const UNITS = ['m', 'h', 'd', 'w']
const unitWord = (u) => W.value['unit-' + u] || u

/* every argument starts at its default, taken apart into the controls that will put it back */
const vals = ref({})
const nums = ref({})
const units = ref({})
onMounted(async () => {
  for (const a of props.command.args || []) {
    if (a.kind === 'span') {
      const m = /^(\d+)\s*([mhdw])$/.exec(String(a.default || '1d'))
      nums.value[a.name] = m ? Number(m[1]) : 1
      units.value[a.name] = m ? m[2] : 'd'
    } else if (a.kind === 'boolean') vals.value[a.name] = a.default === true || a.default === 'true'
    else vals.value[a.name] = a.default == null ? '' : String(a.default)
  }
  await nextTick()
  const el = document.querySelector('.scm input, .scm select')
  if (el) el.focus()
})

/* what goes out: a value per argument, built from its controls */
const args = computed(() => {
  const out = {}
  for (const a of props.command.args || []) {
    out[a.name] = a.kind === 'span' ? `${nums.value[a.name] || 1}${units.value[a.name] || 'd'}` : vals.value[a.name]
  }
  return out
})
const ready = computed(() => (props.command.args || []).every((a) => !a.required || String(args.value[a.name] ?? '').trim() !== ''))
const go = () => { if (ready.value) emit('run', args.value) }
onMounted(() => { if (!(props.command.args || []).length) go() })
</script>

<template>
  <form class="scm" @submit.prevent="go" @keydown.esc="emit('cancel')">
    <p class="scm-head"><SpaceIcon name="sparkle" :size="14" /><b>/{{ command.name }}</b><span v-if="command.hint">{{ command.hint }}</span></p>
    <div v-for="a in command.args" :key="a.name" class="scm-arg">
      <label :for="`scm-${a.name}`">{{ a.label || a.name }}</label>

      <!-- a span is a number and a unit, never "2d" typed into a box -->
      <span v-if="a.kind === 'span'" class="scm-span">
        <input :id="`scm-${a.name}`" v-model.number="nums[a.name]" type="number" min="1" max="999" />
        <select v-model="units[a.name]"><option v-for="u in UNITS" :key="u" :value="u">{{ unitWord(u) }}</option></select>
      </span>

      <select v-else-if="a.kind === 'choice'" :id="`scm-${a.name}`" v-model="vals[a.name]">
        <option v-for="c in a.choices" :key="c" :value="c">{{ c }}</option>
      </select>

      <select v-else-if="a.kind === 'person'" :id="`scm-${a.name}`" v-model="vals[a.name]">
        <option v-for="p in people" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>

      <label v-else-if="a.kind === 'boolean'" class="scm-switch">
        <input :id="`scm-${a.name}`" v-model="vals[a.name]" type="checkbox" /><i></i>
      </label>

      <input v-else :id="`scm-${a.name}`" v-model="vals[a.name]" :type="a.kind === 'number' ? 'number' : 'text'" />
    </div>
    <footer>
      <button type="button" class="scm-ghost" @click="emit('cancel')">{{ W.cancel }}</button>
      <button type="submit" :disabled="!ready">{{ W.run }}</button>
    </footer>
  </form>
</template>

<style scoped>
.scm { flex: 0 0 auto; display: flex; flex-direction: column; gap: 10px; margin: 0 0 8px; padding: 13px 14px;
  background: var(--card); border: 1px solid var(--line, var(--hair)); border-radius: 13px }
.scm-head { display: flex; align-items: center; gap: 6px; margin: 0 }
.scm-head b { font-size: 13.5px; font-weight: 650 }
.scm-head span { font-size: 12px; color: var(--ink3) }
.scm-arg { display: flex; align-items: center; gap: 10px }
.scm-arg > label { flex: none; min-width: 120px; font-size: 12.5px; font-weight: 600; color: var(--ink2) }
.scm input[type=text], .scm input[type=number], .scm select { font: inherit; font-size: 13px; color: var(--ink);
  padding: 7px 9px; background: var(--paper, transparent); border: 1px solid var(--line, var(--hair)); border-radius: 9px }
.scm input[type=number] { width: 72px }
.scm input:focus, .scm select:focus { outline: none; border-color: color-mix(in srgb, var(--ink) 34%, transparent) }
.scm-span { display: flex; gap: 6px }
.scm-switch { position: relative; display: inline-flex; width: 38px; height: 22px; cursor: pointer }
.scm-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer }
.scm-switch i { flex: 1; background: color-mix(in srgb, var(--ink) 16%, transparent); border-radius: 999px; transition: background .15s }
.scm-switch i::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
  background: var(--paper, #fff); border-radius: 50%; transition: transform .15s }
.scm-switch input:checked + i { background: var(--ink) }
.scm-switch input:checked + i::after { transform: translateX(16px) }
/* margin and padding said outright: the site global stylesheet owns bare element names,
   and a bare <footer> there carries padding that would otherwise land in this card */
.scm footer { display: flex; justify-content: flex-end; gap: 8px; margin: 0; padding: 0; background: none; border: 0 }
.scm footer button { font: inherit; font-size: 12.5px; font-weight: 600; padding: 7px 14px; border-radius: 9px; cursor: pointer }
.scm-ghost { color: var(--ink2); background: none; border: 1px solid var(--line, var(--hair)) }
.scm footer button[type=submit] { color: var(--paper, #fff); background: var(--ink); border: 0 }
.scm footer button[type=submit]:disabled { opacity: .4; cursor: default }
</style>

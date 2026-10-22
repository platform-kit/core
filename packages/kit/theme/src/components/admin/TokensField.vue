<script setup>
/*
 * EVERY COLOUR THE LOOK NAMES, and a way back to each one.
 *
 * A look is a stylesheet and an owner is not going to edit one. So this offers what the look
 * actually states — read from the stylesheet itself at build time (build/tokens.mjs), never a list
 * anybody keeps in step — grouped by where each colour applies, with the look's own value behind
 * every field.
 *
 * THREE DECISIONS WORTH STATING.
 *
 *   A TOKEN NOBODY CHANGED IS ABSENT, not a copy of the default. Storing the default would freeze
 *   it: the day the look is retuned, every site that had "changed" nothing would keep the old
 *   colour for ever. So Put back deletes the key, and the field then shows the look's own.
 *
 *   DAY AND NIGHT ARE TWO ANSWERS, because a look states both and a site changing one usually
 *   means one. The night is behind a disclosure per colour rather than a second column, which
 *   would double the height of a page that is already sixty rows.
 *
 *   THE SCOPE IS PART OF THE NAME. The same token means different things in different places —
 *   --ink is one colour site-wide and another on the landing — so they are grouped by where they
 *   apply and never merged into one row.
 *
 * Words from the `models` scope, group `tokens`.
 */
import { computed, ref } from 'vue'
import { us } from 'platformkit/lib/content.js'

const props = defineProps({
  /* { "<token>" | "<scope> <token>": "#hex" | { light, dark } } — what this site changed */
  modelValue: { type: Object, default: () => ({}) },
  /* the look's own, per token: { token, scope, light, dark, kind } */
  tokens: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:modelValue'])
const W = computed(() => us('models').tokens || {})
const say = (k, fallback) => (W.value.main || {})[k] || fallback

const chosen = computed(() => props.modelValue || {})
const open = ref({})

/* by where they apply, in the order somebody thinks about them */
const ORDER = ['site', 'landing', 'qz', 'sp-page', 'reader']
const groups = computed(() => {
  const by = {}
  for (const [key, def] of Object.entries(props.tokens || {})) {
    const g = def.scope || 'site'
    ;(by[g] || (by[g] = [])).push({ key, ...def })
  }
  for (const list of Object.values(by)) list.sort((a, b) => a.token.localeCompare(b.token))
  const names = Object.keys(by).sort((a, b) => {
    const i = ORDER.indexOf(a), j = ORDER.indexOf(b)
    return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || a.localeCompare(b)
  })
  return names.map((n) => ({ name: n, label: say('scope-' + n, n), rows: by[n] }))
})

/* what this field shows: what they chose, or the look's own behind it */
const valueOf = (row, mode) => {
  const v = chosen.value[row.key]
  const own = typeof v === 'string' ? (mode === 'light' ? v : '') : (v && v[mode]) || ''
  return own || ''
}
const shownOf = (row, mode) => valueOf(row, mode) || row[mode] || ''
const changed = (row) => !!(valueOf(row, 'light') || valueOf(row, 'dark'))

function set(row, mode, value) {
  const next = { ...chosen.value }
  const was = next[row.key]
  const pair = typeof was === 'string' ? { light: was, dark: '' } : { light: (was && was.light) || '', dark: (was && was.dark) || '' }
  pair[mode] = String(value || '').trim()
  if (!pair.light && !pair.dark) delete next[row.key]
  else if (!pair.dark) next[row.key] = pair.light      /* a day-only change is just a colour */
  else next[row.key] = pair
  emit('update:modelValue', next)
}
/* PUT BACK DELETES THE KEY. It does not write the default in, for the reason at the top. */
function putBack(row) {
  const next = { ...chosen.value }
  delete next[row.key]
  emit('update:modelValue', next)
}
function putAllBack() { emit('update:modelValue', {}) }
const anyChanged = computed(() => Object.keys(chosen.value).length > 0)
</script>

<template>
  <div class="tf">
    <!-- no note here: the field's own help says it once, above -->
    <div v-if="anyChanged" class="tf-head">
      <button type="button" class="tf-quiet" @click="putAllBack">{{ say('put-all-back', 'Put them all back') }}</button>
    </div>

    <div v-for="g in groups" :key="g.name" class="tf-group">
      <p class="tf-scope">{{ g.label }}</p>
      <div class="tf-rows">
        <div v-for="row in g.rows" :key="row.key" class="tf-row" :class="{ on: changed(row) }">
          <label class="tf-swatch" :title="row.token">
            <span class="tf-chip" :style="{ background: shownOf(row, 'light') }"></span>
            <input
              v-if="row.kind === 'colour'" type="color" class="tf-input"
              :value="shownOf(row, 'light')" @input="set(row, 'light', $event.target.value)" />
          </label>
          <div class="tf-txt">
            <b>{{ row.token.replace(/^--/, '') }}</b>
            <input
              class="tf-val" type="text" :value="shownOf(row, 'light')"
              :placeholder="row.light" @change="set(row, 'light', $event.target.value)" />
          </div>
          <div class="tf-acts">
            <button v-if="row.dark" type="button" class="tf-quiet" @click="open[row.key] = !open[row.key]">
              {{ open[row.key] ? say('hide-night', 'Day only') : say('show-night', 'Night…') }}
            </button>
            <button v-if="changed(row)" type="button" class="tf-quiet" @click="putBack(row)">{{ say('put-back', 'Put back') }}</button>
          </div>
          <div v-if="open[row.key]" class="tf-night">
            <label class="tf-swatch" :title="row.token">
              <span class="tf-chip" :style="{ background: shownOf(row, 'dark') }"></span>
              <input
                v-if="row.kind === 'colour'" type="color" class="tf-input"
                :value="shownOf(row, 'dark')" @input="set(row, 'dark', $event.target.value)" />
            </label>
            <input
              class="tf-val" type="text" :value="shownOf(row, 'dark')"
              :placeholder="row.dark" @change="set(row, 'dark', $event.target.value)" />
            <span class="tf-nightlbl">{{ say('at-night', 'at night') }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tf { display: grid; gap: 18px }
.tf-head { display: flex; align-items: baseline; justify-content: space-between; gap: 14px }
.tf-note { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--ink3); max-width: 62ch }
.tf-group { display: grid; gap: 8px }
.tf-scope { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--ink3) }
.tf-rows { display: grid; gap: 4px }
/* a row is a swatch, a name with its value, and what can be done to it — one grid so every row's
   parts line up down the page rather than each row finding its own width */
.tf-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; align-items: center; gap: 12px;
  padding: 6px 8px; border: 1px solid transparent; border-radius: 10px }
.tf-row:hover { background: color-mix(in srgb, var(--ink) 3%, transparent) }
.tf-row.on { border-color: color-mix(in srgb, var(--ink) 16%, transparent) }
.tf-swatch { position: relative; display: block; width: 30px; height: 30px; cursor: pointer }
.tf-chip { display: block; width: 100%; height: 100%; border-radius: 8px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 18%, transparent) }
.tf-input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; border: 0; padding: 0 }
.tf-txt { display: grid; grid-template-columns: minmax(0, 13ch) minmax(0, 1fr); align-items: center; gap: 10px; min-width: 0 }
.tf-txt b { font-size: 12.5px; font-weight: 650; color: var(--ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.tf-val { font: inherit; font-family: var(--m, ui-monospace, monospace); font-size: 12px; color: var(--ink);
  background: var(--paper); border: 1px solid var(--hair); border-radius: 8px; padding: 5px 8px; min-width: 0 }
.tf-val::placeholder { color: var(--ink3) }
.tf-acts { display: flex; gap: 10px; align-items: center }
.tf-quiet { font: inherit; font-size: 12px; font-weight: 600; color: var(--ink3); background: none; border: 0;
  padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; white-space: nowrap }
.tf-quiet:hover { color: var(--ink) }
.tf-night { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; padding: 6px 0 2px 0 }
.tf-nightlbl { font-size: 12px; color: var(--ink3) }
@media (max-width: 720px) {
  .tf-row { grid-template-columns: 30px minmax(0, 1fr); }
  .tf-acts { grid-column: 2 }
  .tf-txt { grid-template-columns: minmax(0, 1fr) }
}
</style>

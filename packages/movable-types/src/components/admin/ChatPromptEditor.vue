<script setup>
/*
 * A funnel's chat step, edited as what it is — never as the grammar the file holds. The line
 * it says is a sentence; the choices are a list of rows (add, reorder, remove); how it shows
 * is a switch (the panel's default, or a pop-up) and, for a pop-up, its triggers as rows —
 * each a kind picked from a list and a control that fits it (a span as a number and a unit, a
 * page as a path, signed-in as either/or, the flags as their presence). The step's `body` and
 * `when` are written back through the same pure functions the build reads them with
 * (src/lib/support/when.js: splitChoices / joinChoices, parseWhen / serialiseWhen), so the
 * markdown is never typed by hand and can never be bent out of shape.
 */
import pipe from '../../lib/admin/api.js'
import { useMediaPick } from '../../lib/admin/media-pick.js'
import { us } from '@platform-kit/kit/lib/strings.js'
import { computed, ref } from 'vue'
import { parseWhen, serialiseWhen, splitChoices, joinChoices, TRIGGER_KEYS } from '@platform-kit/kit/lib/support/when.js'
import ChoiceTree from './ChoiceTree.vue'

const props = defineProps({ step: { type: Object, required: true } })

/* ---- the line and the choices, over step.body ---- */
const parts = computed(() => splitChoices(props.step.body))
const line = computed({ get: () => parts.value.text, set: (v) => { props.step.body = joinChoices(v, parts.value.choices) } })
const choices = computed(() => parts.value.choices)
function setChoices(tree) { props.step.body = joinChoices(parts.value.text, tree) }

/* ---- the picture: a file uploaded to content/uploads, or one chosen from the library ---- */
const MF = us('media').page.field
const { choose } = useMediaPick()
async function fromLibrary() { const url = await choose('image'); if (url) props.step.image = url }
const uploading = ref(false), uploadErr = ref('')
async function pickImage(e) {
  const file = e.target.files && e.target.files[0]; e.target.value = ''
  if (!file) return
  uploading.value = true; uploadErr.value = ''
  try {
    const j = await pipe.uploadImage(file)
    props.step.image = j.path
  } catch (err) { uploadErr.value = err.message || 'upload failed' } finally { uploading.value = false }
}

/* ---- how it shows, over step.when ---- */
const when = computed(() => parseWhen(props.step.when).when)
function setWhen(w) { props.step.when = serialiseWhen(w) }
const isDefault = computed({ get: () => !!when.value.default, set: (v) => { setWhen(v ? { default: true } : {}) } })
const SPAN = ['on-site', 'page-time']
const KINDS = [
  ['on-site', 'Time on the site'], ['page-time', 'Time on the page'], ['on-page', 'On a page'],
  ['signed-in', 'Signed in or not'], ['returning', 'A returning visitor'], ['cart', 'Something in the bag'],
]
const label = Object.fromEntries(KINDS)
const rows = computed(() => TRIGGER_KEYS.filter((k) => k !== 'default' && when.value[k] != null))
const unused = computed(() => KINDS.filter(([k]) => when.value[k] == null))
const defaults = { 'on-site': 30, 'page-time': 10, 'on-page': '/store/**', 'signed-in': true, returning: true, cart: true }
function addTrigger(k) { if (!k) return; setWhen({ ...when.value, [k]: defaults[k] }) }
function dropTrigger(k) { const w = { ...when.value }; delete w[k]; setWhen(w) }
function setTrigger(k, v) { setWhen({ ...when.value, [k]: v }) }
/* a span as a number and a unit: 90 → 90 s; 120 → 2 min; 3600 → 1 h */
const unitOf = (s) => (s && s % 3600 === 0 ? 3600 : s && s % 60 === 0 ? 60 : 1)
const spanNum = (k) => Math.round((when.value[k] || 0) / unitOf(when.value[k] || 0))
const spanUnit = (k) => unitOf(when.value[k] || 0)
function setSpan(k, num, unit) { const n = Math.max(0, Number(num) || 0); setTrigger(k, n * Number(unit)) }
</script>

<template>
  <div class="cp">
    <label class="ui-field"><span>Above the launcher <small>· a short line shown as a waiting message before the panel opens; a click opens it; blank shows nothing</small></span><input v-model="step.teaser" class="ui-input" placeholder="Do you have a question? We are here to help." /></label>
    <label class="ui-field"><span>The line it says <small>· inside the panel, opening the conversation</small></span><textarea :value="line" class="ui-textarea cp-line" rows="2" placeholder="Hi there! Anything I can help you with?" @input="line = $event.target.value" /></label>

    <div class="ui-field">
      <span>A picture <small>· shown with the line, above the launcher and in the panel; a gif moves</small></span>
      <div class="cp-row cp-image">
        <img v-if="step.image" :src="step.image" alt="" class="cp-thumb" />
        <label class="ui-btn ui-ghost ui-sm cp-upload">{{ uploading ? MF.uploading : (step.image ? MF.replace : MF['upload-image']) }}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" :disabled="uploading" @change="pickImage" /></label>
        <button type="button" class="ui-btn ui-ghost ui-sm" @click="fromLibrary">{{ MF.choose }}</button>
        <button v-if="step.image" type="button" class="ui-btn ui-ghost ui-danger ui-sm" @click="step.image = ''">{{ MF.remove }}</button>
        <span v-if="uploadErr" class="ui-err">{{ uploadErr }}</span>
      </div>
    </div>

    <div class="ui-field">
      <span>Choices <small>· buttons under the line; a click sends the choice as the reader's line, and its follow-ups are offered next</small></span>
      <ChoiceTree :model-value="choices" @update:model-value="setChoices" />
    </div>

    <div class="ui-field">
      <span>How it shows</span>
      <div class="cp-seg" role="radiogroup">
        <button type="button" role="radio" :aria-checked="!isDefault" :class="{ 'ui-on': !isDefault }" @click="isDefault = false">Pops up when its triggers hold</button>
        <button type="button" role="radio" :aria-checked="isDefault" :class="{ 'ui-on': isDefault }" @click="isDefault = true">The panel's default</button>
      </div>
      <small v-if="isDefault" class="ui-hint">The reader sees it at the top of every new conversation when nothing else is showing. It never pops up on its own, and they may start as many conversations from it as they like.</small>
    </div>

    <div v-if="!isDefault" class="ui-field">
      <span>Triggers <small>· every one must hold; shown once</small></span>
      <div class="cp-list">
        <div v-for="k in rows" :key="k" class="cp-row cp-trigger">
          <b class="cp-kind">{{ label[k] }}</b>
          <template v-if="SPAN.includes(k)">
            <input type="number" min="0" step="1" class="ui-input ui-mono cp-num" :value="spanNum(k)" @input="setSpan(k, $event.target.value, spanUnit(k))" />
            <select class="ui-select cp-unit" :value="spanUnit(k)" @change="setSpan(k, spanNum(k), $event.target.value)"><option :value="1">seconds</option><option :value="60">minutes</option><option :value="3600">hours</option></select>
          </template>
          <input v-else-if="k === 'on-page'" class="ui-input ui-mono" :value="when[k]" placeholder="/store/**" title="A path; * is one segment, ** any depth" @input="setTrigger(k, $event.target.value)" />
          <select v-else-if="k === 'signed-in'" class="ui-select" :value="when[k] ? 'yes' : 'no'" @change="setTrigger(k, $event.target.value === 'yes')"><option value="yes">Only signed-in readers</option><option value="no">Only guests</option></select>
          <span v-else class="ui-hint cp-flag">{{ k === 'returning' ? 'has been here before this visit' : 'has something in the bag' }}</span>
          <span class="ui-grow" />
          <button type="button" class="ui-btn ui-ghost ui-danger ui-sm" title="Remove" @click="dropTrigger(k)">×</button>
        </div>
        <p v-if="!rows.length" class="ui-err">No trigger yet — a pop-up with none never shows.</p>
        <select v-if="unused.length" class="ui-select cp-add" :value="''" @change="addTrigger($event.target.value); $event.target.value = ''">
          <option value="" disabled>+ Add a trigger</option>
          <option v-for="[k, l] in unused" :key="k" :value="k">{{ l }}</option>
        </select>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cp { display: flex; flex-direction: column; gap: 14px; min-width: 0 }
.cp-line { min-height: 64px; resize: vertical }
.cp-list { display: flex; flex-direction: column; gap: 6px }
.cp-row { display: flex; align-items: center; gap: 6px }
.cp-row .ui-input { flex: 1; min-width: 0 }
.cp-add { align-self: flex-start; margin-top: 2px; width: auto }
.cp-seg { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--hair); border-radius: 999px; background: var(--card); align-self: flex-start }
.cp-seg button { border: 0; background: transparent; color: var(--ink2); font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 999px; cursor: pointer; white-space: nowrap }
.cp-seg button.ui-on { background: var(--ink); color: var(--paper) }
.cp-kind { flex: none; width: 150px; font-size: 13px; font-weight: 600 }
.cp-num { width: 84px; flex: none !important }
.cp-unit { width: 110px; flex: none }
.cp-flag { flex: 1 }
.cp-image { align-items: center } .cp-thumb { height: 64px; max-width: 140px; border-radius: 8px; object-fit: cover; border: 1px solid var(--hair) }
.cp-upload { position: relative; overflow: hidden; cursor: pointer } .cp-upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer }
</style>

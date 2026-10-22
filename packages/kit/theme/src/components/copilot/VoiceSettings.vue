<!--
  WHAT THE READER DECIDED ABOUT THE VOICE.

  Four things, and every one of them is about this person on this machine rather than about the
  site: which voice, what language, how fast, and whether the microphone is open the whole time or
  only while they hold the button. WHICH PROVIDER SPEAKS IS NOT HERE and never will be — that is
  the site's decision, made once in a file, and nobody using an assistant has any way to know what
  the answer would mean for them.

  The voices offered depend on who is speaking: the kit's own ten where the kit is speaking, and
  where the site named an endpoint, only what the SITE says that endpoint offers. The kit cannot
  enumerate somebody else's service and must not pretend to.

  Language names come from the browser (`Intl.DisplayNames`) rather than from markdown. That is
  the one place in this project where a reader-facing string is not authored, and it is the right
  answer: thirty-one names hand-written in English would be worse for every reader who does not
  read English, which is exactly the person choosing a language.
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import VoiceVisual from './VoiceVisual.vue'
import { LANGS, SPEEDS, SHAPES } from 'platformkit/lib/copilot/prefs.js'

const props = defineProps({
  prefs: { type: Object, required: true },
  voices: { type: Array, default: () => [] },   /* what this provider offers, named by the site */
  /*
   * THE DEFAULTS, RESOLVED, because a control should show the value that is in force rather than
   * a sentence about where it came from. "As the site set it" tells somebody that a decision was
   * made somewhere else and still leaves them not knowing what it was; the voice is called alloy
   * and the language is English, so that is what the control says.
   */
  voiceNow: { type: String, default: '' },
  langNow: { type: String, default: 'en' },
  visualNow: { type: String, default: 'aura' },
})
const emit = defineEmits(['change', 'close'])

const S = computed(() => ((us('copilot').page || {}).settings || {}))
const card = ref(null)

/* the browser's own name for a language, in the reader's language. A browser too old for it
   falls back to the code, which is still an answer a person can act on. */
const named = (code) => {
  try { return new Intl.DisplayNames(undefined, { type: 'language' }).of(code) || code } catch { return code }
}
const langs = computed(() => LANGS.map((c) => ({ c, name: named(c) })).sort((a, b) => a.name.localeCompare(b.name)))
/* what is actually in force right now: their choice, or the default it would otherwise be */
const voice = computed(() => props.prefs.voice || props.voiceNow)
const lang = computed(() => props.prefs.lang || props.langNow)
/* a default the list does not contain is still the one in use, so it is still shown */
const list = computed(() => (voice.value && !props.voices.includes(voice.value) ? [voice.value, ...props.voices] : props.voices))
const visual = computed(() => props.prefs.visual || props.visualNow)

const set = (patch) => emit('change', { ...props.prefs, ...patch })

/* a dialogue traps the keyboard or it is not one */
watch(card, (el) => el && el.focus())
const keys = (e) => { if (e.key === 'Escape') emit('close') }
</script>

<template>
  <div class="vs" @click.self="emit('close')" @keydown="keys">
    <div ref="card" class="vs-card" role="dialog" aria-modal="true" :aria-label="S.title" tabindex="-1">
      <p class="vs-head">{{ S.title }}</p>

      <!-- WHERE THERE IS NOTHING TO CHOOSE, THERE IS NO CHOICE. A site whose endpoint it has
           named no voices for gets no voice row at all, rather than a select holding one option
           that does nothing — which reads as broken and is worse than the absence. -->
      <label v-if="list.length" class="vs-row">
        <span class="vs-label">{{ S.voice }}</span>
        <select class="vs-in" :value="voice" @change="set({ voice: $event.target.value })">
          <option v-for="v in list" :key="v" :value="v">{{ v }}</option>
        </select>
      </label>

      <label class="vs-row">
        <span class="vs-label">{{ S.language }}</span>
        <select class="vs-in" :value="lang" @change="set({ lang: $event.target.value })">
          <option v-for="l in langs" :key="l.c" :value="l.c">{{ l.name }}</option>
        </select>
      </label>

      <!-- the shape is a look, so it is shown as shapes rather than named in a list: five
           little drawings, the one in use lit -->
      <div class="vs-row">
        <span class="vs-label">{{ S.shape }}</span>
        <div class="vs-shapes">
          <button v-for="sh in SHAPES" :key="sh" type="button" class="vs-shape"
                  :class="{ 'is-on': visual === sh }" :aria-pressed="visual === sh"
                  :title="S['shape-' + sh]" @click="set({ visual: sh })">
            <VoiceVisual :shape="sh" state="speaking" :mine="0" :theirs="0.75" :label="S['shape-' + sh]" />
            <span class="vs-shape-name">{{ S['shape-' + sh] }}</span>
          </button>
        </div>
      </div>

      <div class="vs-row">
        <span class="vs-label">{{ S.speed }}</span>
        <!-- five fixed speeds rather than a slider: nobody wants 1.37, and a row of them is one
             press where a slider is a drag and a read -->
        <div class="vs-speeds">
          <button v-for="n in SPEEDS" :key="n" type="button" class="vs-speed"
                  :class="{ 'is-on': prefs.speed === n }" :aria-pressed="prefs.speed === n"
                  @click="set({ speed: n })">{{ n === 1 ? S.normal : n + '×' }}</button>
        </div>
      </div>

      <!-- the two ways of being heard, as a choice between two described things rather than a
           switch whose off state nobody can picture -->
      <div class="vs-pick">
        <button type="button" class="vs-way" :class="{ 'is-on': !prefs.hold }" :aria-pressed="!prefs.hold"
                @click="set({ hold: false })">
          <span class="vs-way-name">{{ S.always }}</span>
          <span class="vs-way-note">{{ S['always-note'] }}</span>
        </button>
        <button type="button" class="vs-way" :class="{ 'is-on': prefs.hold }" :aria-pressed="prefs.hold"
                @click="set({ hold: true })">
          <span class="vs-way-name">{{ S.hold }}</span>
          <span class="vs-way-note">{{ S['hold-note'] }}</span>
        </button>
      </div>

      <button type="button" class="vs-done" @click="emit('close')">{{ S.done }}</button>
    </div>
  </div>
</template>

<style scoped>
.vs { position: fixed; z-index: 6; inset: 0; display: grid; place-items: center; padding: 16px;
  background: color-mix(in srgb, var(--ink) 38%, transparent); backdrop-filter: blur(3px) }
.vs-card { width: min(420px, 100%); max-height: 86dvh; overflow-y: auto; display: grid; gap: 16px;
  padding: 22px; border-radius: 20px; border: 1px solid var(--hair); background: var(--paper);
  box-shadow: 0 30px 70px -30px color-mix(in srgb, var(--ink) 55%, transparent); outline: none }
.vs-head { margin: 0; font-family: var(--fd, inherit); font-size: 20px; color: var(--ink) }
.vs-row { display: grid; gap: 7px }
.vs-label { font-size: 13px; color: var(--ink3) }
.vs-in { width: 100%; padding: 10px 12px; border: 1px solid var(--hair); border-radius: 10px;
  background: var(--card2); color: var(--ink); font: inherit; font-size: 15px }
.vs-shapes { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px }
.vs-shape { display: grid; gap: 4px; justify-items: center; padding: 7px 2px 6px; border: 1px solid var(--hair);
  border-radius: 10px; background: none; color: var(--ink3); font: inherit; cursor: pointer }
.vs-shape.is-on { border-color: var(--accent); background: var(--accentbg); color: var(--ink) }
.vs-shape :deep(.cv) { width: 34px; height: 34px; max-width: none }
.vs-shape-name { font-size: 11px }
.vs-speeds { display: flex; gap: 6px; flex-wrap: wrap }
.vs-speed { flex: 1 1 auto; padding: 9px 4px; border: 1px solid var(--hair); border-radius: 10px;
  background: none; color: var(--ink3); font: inherit; font-size: 14px; cursor: pointer }
.vs-speed.is-on { background: var(--ink); color: var(--paper); border-color: var(--ink) }
.vs-pick { display: grid; gap: 8px }
.vs-way { display: grid; gap: 3px; padding: 12px 14px; border: 1px solid var(--hair); border-radius: 12px;
  background: none; text-align: left; cursor: pointer }
.vs-way.is-on { border-color: var(--accent); background: var(--accentbg) }
.vs-way-name { font-size: 15px; color: var(--ink) }
.vs-way-note { font-size: 13px; line-height: 1.45; color: var(--ink3) }
.vs-done { padding: 12px; border: 0; border-radius: 999px; background: var(--ink); color: var(--paper);
  font: inherit; font-size: 15px; cursor: pointer }
</style>

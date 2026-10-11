<script setup>
/*
 * One slide of a form, on the runner: its copy and its fields together, as forms.md shows a slide,
 * drawn in the site's design. The values typed here join the answers so far for the conditions and
 * bindings on the same slide (an "Other" line appearing under a choice); a slide goes when every
 * field on it that is shown passes its kind's check — and, for a form, once its answers are sent
 * (screen.state.submit: the host's, which posts to the kit and says whether it landed). The end slide
 * is the document's own copy or the default words, with a quiz's score and the restart button when
 * the document asks for one; "already answered" and "sign in" are states the host sets.
 */
import { reactive, computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { context, holds } from '@platform-kit/kit/lib/forms/logic.js'
import { validateSlide } from '@platform-kit/kit/lib/forms/validate.js'
import FmBlocks from './FmBlocks.vue'
import FmCopy from './FmCopy.vue'

const props = defineProps({ screen: { type: Object, required: true } })
const emit = defineEmits(['answer'])
const S = computed(() => props.screen.state)   /* the host's state: answers, data, words, submit, grade, already, signin, restart */
const W = computed(() => S.value.words)
const values = reactive({})
for (const f of props.screen.fields) values[f.name] = S.value.answers[f.name] !== undefined ? S.value.answers[f.name] : (f.params && f.params.value !== undefined ? f.params.value : f.params && f.params.checked ? (f.params.multiple !== undefined ? f.params.checked : f.params.checked[0]) : f.params && f.params.selected !== undefined ? f.params.selected : undefined)
const ctx = computed(() => context(S.value.data, { ...S.value.answers, ...values }))
const errors = reactive({})
const sending = ref(false)
const sendError = ref('')
/* the fields shown now: a field behind a false condition is neither checked nor sent */
function visibleFields() {
  const out = []
  const walk = (blocks, on) => { for (const b of blocks) { const ok = on && (!b.condition || holds(b.condition, ctx.value)); if (b.type === 'field' && ok) out.push(b); if (b.blocks) walk(b.blocks, ok) } }
  walk(props.screen.blocks, true)
  return out
}

async function submit() {
  if (sending.value) return
  const fields = visibleFields()
  for (const k of Object.keys(errors)) delete errors[k]
  Object.assign(errors, validateSlide(fields, values, W.value))
  if (Object.keys(errors).length) { const first = document.querySelector('.ff-err'); if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' }); return }
  const out = {}
  for (const f of fields) if (values[f.name] !== undefined) out[f.name] = values[f.name]
  sendError.value = ''
  if (props.screen.post && S.value.submit) {
    sending.value = true
    try { await S.value.submit(out, props.screen) }
    catch (e) { sendError.value = (e && e.message) || W.value['not-sent']; sending.value = false; return }
    sending.value = false
  }
  emit('answer', out)
}
function onEnter(how) { if (how !== 'pick') submit() }
const buttonText = computed(() => {
  const s = props.screen
  if (s.type === 'start') return s.button || W.value.start
  if (s.isForm) return s.submitText || W.value.ok
  return W.value.next
})
const grade = computed(() => S.value.grade)
/* the host's Next control reaches the screen on stage through the state */
onMounted(() => { S.value.active = { submit } })
onBeforeUnmount(() => { if (S.value.active && S.value.active.submit === submit) S.value.active = null })
defineExpose({ submit })
</script>

<template>
  <div class="qzin fslide" :class="['fslide-' + screen.type, { 'fslide-end': screen.end }]">
    <!-- the end: what the document says, or the default words; a quiz's score; the states -->
    <template v-if="screen.end">
      <div v-if="S.already" class="fend">
        <h3 class="qh">{{ W['already'] }}</h3>
      </div>
      <div v-else-if="S.closed" class="fend">
        <h3 class="qh">{{ W['closed'] }}</h3>
      </div>
      <template v-else>
        <FmBlocks v-if="!screen.defaultEnd && screen.blocks.length" :blocks="screen.blocks" :ctx="ctx" :values="values" :errors="errors" :words="W" />
        <div v-else class="fend">
          <h3 class="qh">{{ screen.isForm || S.wasForm ? W['end-title'] : W['end-title-page'] }}</h3>
          <p class="qsay">{{ screen.isForm || S.wasForm ? W['end-subtitle'] : W['end-subtitle-page'] }}</p>
        </div>
        <div v-if="grade && grade.total" class="fscore">
          <b class="fscore-n">{{ (W.score || '{score} of {total}').replace('{score}', grade.score).replace('{total}', grade.total) }}</b>
          <span v-if="grade.passed !== null" class="fscore-p" :class="{ ok: grade.passed }">{{ grade.passed ? W.passed : W.failed }}</span>
        </div>
      </template>
      <div v-if="screen.restart && S.restart" class="fact" :class="'fact-' + (screen.align || 'start')">
        <button type="button" class="qbtn" @click="S.restart()">{{ W.restart }}</button>
      </div>
    </template>
    <!-- a slide: the blocks, then the button -->
    <template v-else>
      <FmBlocks :blocks="screen.blocks" :ctx="ctx" :values="values" :errors="errors" :words="W" :autofocus-all="S.autofocusAll" @enter="onEnter" />
      <p v-if="Object.keys(errors).length > 1" class="ff-msg fslide-err" role="alert">{{ W['slide-error'] }}</p>
      <p v-if="sendError" class="ff-msg fslide-err" role="alert">{{ sendError }} <button type="button" class="ff-flink" @click="submit">{{ W['try-again'] }}</button></p>
      <div v-if="!screen.single" class="fact" :class="'fact-' + (screen.align || 'start')">
        <button type="button" class="qbtn" :disabled="sending" @click="submit">{{ buttonText }}<span v-if="!sending" class="fact-arrow" aria-hidden="true">→</span><span v-else class="fact-dot" aria-hidden="true" /></button>
      </div>
    </template>
  </div>
</template>

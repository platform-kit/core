<script setup>
/*
 * AN ANSWER SOMEBODY SAYS — a voice note, or a video of themselves — rather than one they type.
 *
 * Some questions are answered better out loud. "Tell me what is actually in the way" gets two
 * sentences typed and two minutes said, and the two minutes are the answer.
 *
 * Both kinds end as a FILE, which is the whole trick: it goes to the forms bucket like any other
 * file answer and nothing past this field knows it was recorded rather than chosen. A voice note is
 * the chat's own MP3 recorder (mono, 128 kbps, nothing trimmed); a video is MediaRecorder in
 * whatever the browser makes, which is webm nearly everywhere and mp4 on Safari.
 *
 * Nothing is uploaded while they are still deciding: the recording is held here, played back here,
 * and thrown away if they record again. It leaves when the slide is posted, like every other answer.
 */
import { computed, ref, onBeforeUnmount, watch, nextTick } from 'vue'
import FmLabel from './FmLabel.vue'
import { createRecorder, micUsable } from 'platformkit/lib/chat/recorder.js'

const props = defineProps({
  field: { type: Object, required: true },
  modelValue: { default: null },
  ctx: { type: Object, default: () => ({}) },
  words: { type: Object, default: () => ({}) },
  error: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'enter'])
const p = computed(() => props.field.params || {})
const isVideo = computed(() => props.field.kind === 'video')
/* how long they may go on for: a minute unless the field says otherwise */
const cap = computed(() => Math.max(5, Number(p.value.maxlength || p.value.seconds || 60)))

const rec = createRecorder()
const busy = ref(false)
const shot = ref('')          /* the object url of what they have, for playing it back */
const secs = ref(0)
const denied = ref('')
const live = ref(null)        /* the preview element, while a video is recording */

/* THE VIDEO SIDE IS ITS OWN: MediaRecorder, not the audio graph. Whether it is running has to be
   a ref and not the recorder object: a plain variable is not something Vue watches, so the button
   never changed and the preview never appeared — which is what happened the first time. */
let mr = null, vstream = null, chunks = [], vtick = null
const vrec = ref(false)
const recording = computed(() => (isVideo.value ? vrec.value : rec.state.recording))
const seconds = computed(() => (isVideo.value ? secs.value : rec.state.seconds))
const left = computed(() => Math.max(0, cap.value - seconds.value))

const clock = (s) => {
  const n = Math.floor(s)
  return String(Math.floor(n / 60)) + ':' + String(n % 60).padStart(2, '0')
}

function drop() {
  if (shot.value) { try { URL.revokeObjectURL(shot.value) } catch { /* gone */ } shot.value = '' }
}
function clear() { drop(); emit('update:modelValue', null) }

async function startVideo() {
  chunks = []
  try {
    vstream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true })
  } catch (e) { vrec.value = false; denied.value = props.words['record-denied'] || 'No camera'; return }
  mr = new MediaRecorder(vstream)
  mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
  mr.start(250)
  vrec.value = true
  secs.value = 0
  /* the preview element exists only once it is recording, so it is wired on the next frame */
  await nextTick()
  if (live.value) { live.value.srcObject = vstream; live.value.play().catch(() => {}) }
  vtick = setInterval(() => { secs.value += 0.25; if (secs.value >= cap.value) stop() }, 250)
}
function stopVideo() {
  return new Promise((done) => {
    if (!mr) return done(null)
    const type = mr.mimeType || 'video/webm'
    mr.onstop = () => {
      const blob = new Blob(chunks, { type })
      const ext = /mp4/.test(type) ? 'mp4' : 'webm'
      done(new File([blob], 'answer.' + ext, { type }))
    }
    try { mr.stop() } catch { done(null) }
  })
}

async function start() {
  if (recording.value || busy.value) return
  denied.value = ''
  clear()
  busy.value = true
  try {
    if (isVideo.value) await startVideo()
    else await rec.start()
  } catch (e) { denied.value = props.words['record-denied'] || 'No microphone' } finally { busy.value = false }
}

async function stop() {
  if (!recording.value) return
  let file = null
  if (isVideo.value) {
    clearInterval(vtick); vtick = null
    file = await stopVideo()
    try { vstream.getTracks().forEach((t) => t.stop()) } catch { /* gone */ }
    if (live.value) live.value.srcObject = null
    mr = null; vstream = null; vrec.value = false
  } else {
    /* the chat's recorder answers { blob, seconds }: the blob is what was said, and a form answer
       is a File, so it is given a name here and nowhere else */
    const out = rec.stop()
    if (out && out.blob) { file = new File([out.blob], 'answer.mp3', { type: out.blob.type || 'audio/mpeg' }); secs.value = out.seconds || 0 }
  }
  if (file) { shot.value = URL.createObjectURL(file); emit('update:modelValue', file) }
}

/* a recording the reader replaced or left behind is not left in memory */
watch(() => props.modelValue, (v) => { if (!v) drop() })
onBeforeUnmount(() => { try { if (recording.value) stop() } catch { /* gone */ } drop() })

/* the whole field is unavailable where the browser will not record at all */
const usable = computed(() => (isVideo.value
  ? typeof MediaRecorder !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  : micUsable()))
</script>

<template>
  <div class="ff ff-rec" :class="{ 'ff-err': error, 'is-video': isVideo }">
    <FmLabel :field="field" :ctx="ctx" :words="words" />

    <p v-if="!usable" class="ff-hint">{{ words['record-unavailable'] }}</p>

    <template v-else>
      <!-- while recording a video, they see themselves; a voice note shows its own level -->
      <div v-if="isVideo && (recording || shot)" class="ff-stage">
        <video v-show="recording" ref="live" class="ff-live" muted playsinline></video>
        <video v-if="shot && !recording" class="ff-live" :src="shot" controls playsinline></video>
      </div>
      <div v-else-if="recording" class="ff-level">
        <i v-for="(l, n) in rec.state.level" :key="n" :style="{ transform: 'scaleY(' + Math.max(0.08, l) + ')' }"></i>
      </div>
      <audio v-else-if="shot" class="ff-play" :src="shot" controls></audio>

      <div class="ff-recbar">
        <button v-if="!recording" type="button" class="ff-recbtn" :disabled="busy" @click="start">
          <span class="ff-dot" :class="{ 'is-video': isVideo }"></span>
          {{ shot ? words['record-again'] : (isVideo ? words['record-video'] : words['record-voice']) }}
        </button>
        <button v-else type="button" class="ff-recbtn is-on" @click="stop">
          <span class="ff-square"></span>{{ words['record-stop'] }} · {{ clock(seconds) }}
        </button>
        <button v-if="shot && !recording" type="button" class="ff-flink" @click="clear">{{ words['record-discard'] }}</button>
        <span v-if="recording" class="ff-hint">{{ (words['record-left'] || '').replace('{time}', clock(left)) }}</span>
      </div>
      <p v-if="denied" class="ff-msg" role="alert">{{ denied }}</p>
    </template>

    <p v-if="error" class="ff-msg" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.ff-stage { margin: 0 0 12px }
.ff-live { width: 100%; max-width: 420px; aspect-ratio: 4 / 3; border-radius: 12px; background: #0000001a; display: block }
.ff-play { width: 100%; max-width: 420px; margin: 0 0 12px; display: block }
/* the level, while a voice note is going: the same bars the chat draws */
.ff-level { display: flex; align-items: center; gap: 2px; height: 34px; margin: 0 0 12px; max-width: 420px }
.ff-level i { flex: 1; height: 100%; border-radius: 2px; background: currentColor; opacity: .45;
  transform-origin: center; transition: transform .1s linear }
.ff-recbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px }
.ff-recbtn { display: inline-flex; align-items: center; gap: 9px; font: inherit; font-size: 14px; font-weight: 650;
  color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 999px;
  padding: 8px 18px; cursor: pointer; opacity: .85 }
.ff-recbtn:hover:not(:disabled) { opacity: 1 }
.ff-recbtn:disabled { opacity: .4; cursor: default }
.ff-dot { width: 11px; height: 11px; border-radius: 50%; background: #c8382f }
.ff-dot.is-video { border-radius: 3px }
.ff-recbtn.is-on .ff-square { width: 10px; height: 10px; border-radius: 2px; background: currentColor }
.ff-recbtn.is-on { animation: ff-pulse 1.6s ease-in-out infinite }
@keyframes ff-pulse { 0%, 100% { opacity: .85 } 50% { opacity: .5 } }
@media (prefers-reduced-motion: reduce) { .ff-recbtn.is-on { animation: none } .ff-level i { transition: none } }
</style>

<script setup>
/*
 * The call page — a booking's video room on the site, /app/call/<uid>: a lobby (the reader's own
 * camera, a microphone and a camera to choose, whether the call is recorded), the call (every person
 * a tile with their name, the one speaking marked, a shared screen on the stage; mute · camera ·
 * share · leave, and for the host End for everyone), the ended screen. Credentials come from
 * session-room for this person and this booking alone (src/lib/room.js); the room itself is
 * livekit-client, the theme's own tiles on the site's tokens — no component library. Dark by
 * default (a call is a dark room); the light theme honoured on the lobby and the ended screen.
 * Words: content/app/ui/library.md, `## call`. Motion: the one curve.
 */
import { ref, computed, onMounted, onBeforeUnmount, shallowRef, watch, nextTick } from 'vue'
import { route, navigate, ROUTES } from '../router.js'
import { us } from '@platform-kit/kit/lib/content.js'
import { isSignedIn, user, roleKnown } from '@platform-kit/kit/lib/auth.js'
import { admit, startRecording, endRoom } from '@platform-kit/kit/lib/room.js'
import { Room, RoomEvent, Track, createLocalTracks } from 'livekit-client'

const W = us('library').call.page
const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const uid = computed(() => { const m = /\/call\/([^/]+)/.exec(route.value || ''); return m ? m[1] : '' })

/* the states: loading → lobby → joining → call → ended; or a refusal: early | over | not-yours | no-room | signin | failed */
const state = ref('loading'), refusal = ref(''), opens = ref(''), errorLine = ref('')
const grant = ref(null)   /* what session-room answered: url, token, role, title, record, start_at, end_at */
async function load() {
  if (!uid.value) { state.value = 'refused'; refusal.value = 'no-room'; return }
  if (!isSignedIn.value) { if (roleKnown.value) { state.value = 'refused'; refusal.value = 'signin' } return }
  state.value = 'loading'
  try { grant.value = await admit(uid.value); state.value = 'lobby'; await nextTick(); preview() }
  catch (e) { state.value = 'refused'; refusal.value = e.code === 'early' ? 'early' : e.code === 'over' ? 'over' : e.code === 'no-room' ? 'no-room' : e.status === 403 ? 'not-yours' : 'failed'; opens.value = e.opens || ''; errorLine.value = e.message || '' }
}
onMounted(load)
watch([isSignedIn, roleKnown], () => { if (state.value === 'loading' || state.value === 'refused') load() })

/* the lobby: a preview of the reader's own camera, the devices to choose from */
const previewEl = ref(null), mics = ref([]), cams = ref([]), micId = ref(''), camId = ref(''), noDevices = ref(false)
let previewTracks = []
async function preview() {
  try {
    previewTracks = await createLocalTracks({ audio: micId.value ? { deviceId: micId.value } : true, video: camId.value ? { deviceId: camId.value } : true })
    const v = previewTracks.find((t) => t.kind === Track.Kind.Video)
    if (v && previewEl.value) v.attach(previewEl.value)
    const list = await Room.getLocalDevices()
    mics.value = list.filter((d) => d.kind === 'audioinput'); cams.value = list.filter((d) => d.kind === 'videoinput')
    if (!micId.value && mics.value[0]) micId.value = mics.value[0].deviceId
    if (!camId.value && cams.value[0]) camId.value = cams.value[0].deviceId
  } catch (e) { noDevices.value = true }
}
function stopPreview() { for (const t of previewTracks) { try { t.stop() } catch (e) { /* gone */ } } previewTracks = [] }
watch([micId, camId], async () => { if (state.value === 'lobby') { stopPreview(); await preview() } })

/* the call */
const room = shallowRef(null)
const tiles = ref([])          /* [{ id, name, me, speaking, muted, cameraOff }] */
const stage = ref(null)        /* a shared screen: { id, name } */
const micOn = ref(true), camOn = ref(true), sharing = ref(false), recording = ref(false), asking = ref(false)
const tileEls = new Map()
const setTileEl = (id, el) => { if (el) tileEls.set(id, el); else tileEls.delete(id) }
const stageEl = ref(null)
const isHost = computed(() => grant.value && grant.value.role === 'host')
const others = computed(() => tiles.value.filter((t) => !t.me))
function refresh() {
  const r = room.value; if (!r) return
  const list = []
  const one = (p, me) => {
    const cam = p.getTrackPublication(Track.Source.Camera), mic = p.getTrackPublication(Track.Source.Microphone), screen = p.getTrackPublication(Track.Source.ScreenShare)
    list.push({ id: p.identity, name: me ? W.you : p.name || p.identity, me, speaking: p.isSpeaking, muted: !mic || mic.isMuted || !mic.track, cameraOff: !cam || cam.isMuted || !cam.track })
    if (screen && screen.track) stage.value = { id: p.identity, name: me ? W.you : p.name || p.identity, track: screen.track }
  }
  stage.value = null
  one(r.localParticipant, true)
  for (const p of r.remoteParticipants.values()) one(p, false)
  tiles.value = list
  nextTick(attach)
}
function attach() {
  const r = room.value; if (!r) return
  const all = [r.localParticipant, ...r.remoteParticipants.values()]
  for (const p of all) {
    const el = tileEls.get(p.identity); if (!el) continue
    const cam = p.getTrackPublication(Track.Source.Camera)
    const video = el.querySelector('video')
    if (cam && cam.track && video) cam.track.attach(video)
    if (!p.isLocal) { const mic = p.getTrackPublication(Track.Source.Microphone); if (mic && mic.track) { let a = el.querySelector('audio'); if (!a) { a = document.createElement('audio'); a.autoplay = true; el.appendChild(a) } mic.track.attach(a) } }
  }
  if (stage.value && stageEl.value) stage.value.track.attach(stageEl.value)
}
async function join() {
  if (!grant.value) return
  state.value = 'joining'; errorLine.value = ''
  stopPreview()
  const r = new Room({ adaptiveStream: true, dynacast: true })
  room.value = r
  const evs = [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged]
  for (const e of evs) r.on(e, refresh)
  r.on(RoomEvent.RecordingStatusChanged, (on) => { recording.value = !!on })
  r.on(RoomEvent.Disconnected, () => { if (state.value === 'call' || state.value === 'joining') ended() })
  try {
    await r.connect(grant.value.url, grant.value.token)
    try { await r.localParticipant.enableCameraAndMicrophone() } catch (e) { noDevices.value = true }
    if (micId.value) await r.switchActiveDevice('audioinput', micId.value).catch(() => {})
    if (camId.value) await r.switchActiveDevice('videoinput', camId.value).catch(() => {})
    micOn.value = r.localParticipant.isMicrophoneEnabled; camOn.value = r.localParticipant.isCameraEnabled
    recording.value = !!r.isRecording
    state.value = 'call'; refresh()
    /* the host's arrival starts the recording when the type says so (the provider's own notification confirms it) */
    if (isHost.value && grant.value.record && !recording.value) startRecording(uid.value).then((r) => { if (r && r.started) recording.value = true }).catch(() => {})
  } catch (e) { state.value = 'lobby'; errorLine.value = W.failed; await preview() }
}
async function toggleMic() { const r = room.value; if (!r) return; await r.localParticipant.setMicrophoneEnabled(!micOn.value); micOn.value = r.localParticipant.isMicrophoneEnabled; refresh() }
async function toggleCam() { const r = room.value; if (!r) return; await r.localParticipant.setCameraEnabled(!camOn.value); camOn.value = r.localParticipant.isCameraEnabled; refresh() }
async function toggleShare() { const r = room.value; if (!r) return; try { await r.localParticipant.setScreenShareEnabled(!sharing.value); sharing.value = r.localParticipant.isScreenShareEnabled } catch (e) { /* refused by the browser */ } refresh() }
async function leave() { const r = room.value; if (r) { await r.disconnect() } ended() }
async function endAll() { asking.value = false; try { await endRoom(uid.value) } catch (e) { /* the room may already be gone */ } await leave() }
function ended() { state.value = 'ended'; const r = room.value; room.value = null; if (r) { try { r.removeAllListeners() } catch (e) { /* gone */ } } }
onBeforeUnmount(() => { stopPreview(); const r = room.value; if (r) r.disconnect() })
const when = (iso) => { try { return new Intl.DateTimeFormat(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) } catch (e) { return iso } }
const back = () => navigate(ROUTES.diagnostics + '/coaching')
const cols = computed(() => { const n = tiles.value.length; return n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4 })
</script>

<template>
  <div class="vc" :class="{ 'vc-dark': state === 'call' || state === 'joining' }">
    <!-- the lobby -->
    <div v-if="state === 'loading'" class="vc-card vc-note"><p>{{ W.joining }}</p></div>
    <div v-else-if="state === 'refused'" class="vc-card vc-note">
      <h1>{{ refusal === 'early' ? W.early : refusal === 'over' ? W.over : refusal === 'not-yours' ? W['not-yours'] : refusal === 'signin' ? W.signin : refusal === 'no-room' ? W['no-room'] : W.failed }}</h1>
      <p v-if="refusal === 'early' && opens">{{ fill(W['early-at'], { when: when(opens) }) }}</p>
      <p v-else-if="refusal === 'failed' && errorLine">{{ errorLine }}</p>
      <div class="vc-acts"><button v-if="refusal === 'failed'" type="button" class="vc-btn" @click="load">{{ W.retry }}</button><button type="button" class="vc-btn ghost" @click="back">{{ W.back }}</button></div>
    </div>
    <div v-else-if="state === 'lobby' || state === 'joining'" class="vc-card vc-lobby">
      <div class="vc-preview"><video ref="previewEl" autoplay muted playsinline /><span v-if="noDevices" class="vc-nodev">{{ W['no-devices'] }}</span></div>
      <div class="vc-lobby-side">
        <span class="vc-eyebrow">{{ grant && grant.title }}</span>
        <h1>{{ W['lobby-title'] }}</h1>
        <p>{{ W['lobby-lead'] }}</p>
        <label class="vc-field"><span>{{ W.mic }}</span><select v-model="micId" :disabled="!mics.length"><option v-for="d in mics" :key="d.deviceId" :value="d.deviceId">{{ d.label || W.mic }}</option></select></label>
        <label class="vc-field"><span>{{ W.camera }}</span><select v-model="camId" :disabled="!cams.length"><option v-for="d in cams" :key="d.deviceId" :value="d.deviceId">{{ d.label || W.camera }}</option></select></label>
        <p v-if="grant && grant.record" class="vc-rec-line"><i></i>{{ W.recorded }}</p>
        <p v-if="errorLine" class="vc-err">{{ errorLine }}</p>
        <div class="vc-acts"><button type="button" class="vc-btn" :disabled="state === 'joining'" @click="join">{{ state === 'joining' ? W.joining : W.join }}</button><button type="button" class="vc-btn ghost" @click="back">{{ W.back }}</button></div>
      </div>
    </div>

    <!-- the call -->
    <div v-else-if="state === 'call'" class="vc-room" :class="{ staged: !!stage }">
      <div class="vc-top">
        <span class="vc-title">{{ grant && grant.title }}</span>
        <transition name="vc-fade"><span v-if="recording" class="vc-recording"><i></i>{{ W.recording }}</span></transition>
      </div>
      <div v-if="stage" class="vc-stage"><video ref="stageEl" autoplay playsinline /><span class="vc-tile-name">{{ stage.name }}</span></div>
      <div class="vc-grid" :style="{ '--cols': stage ? Math.max(1, tiles.length) : cols }">
        <div v-for="t in tiles" :key="t.id" :ref="(el) => setTileEl(t.id, el)" class="vc-tile" :class="{ me: t.me, speaking: t.speaking, off: t.cameraOff }">
          <video autoplay playsinline :muted="t.me" />
          <span class="vc-tile-name">{{ t.name }}<i v-if="t.muted" class="vc-muted" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l12 12"/><path d="M7.5 9.5V6a2.5 2.5 0 0 1 4.6-1.3"/><path d="M12.5 10.5V10"/><path d="M5.5 10a4.5 4.5 0 0 0 7.3 3.5M14.5 10c0 .6-.1 1.2-.3 1.7"/><path d="M10 14.5V17"/></svg></i></span>
          <span v-if="t.cameraOff" class="vc-initial">{{ (t.name || '?').slice(0, 1) }}</span>
        </div>
      </div>
      <p v-if="!others.length" class="vc-waiting">{{ W['waiting-any'] }}</p>
      <div class="vc-bar">
        <button type="button" class="vc-ctl" :class="{ off: !micOn }" :aria-label="micOn ? W.mute : W.unmute" :title="micOn ? W.mute : W.unmute" @click="toggleMic">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="7.5" y="3" width="5" height="8" rx="2.5"/><path d="M5.5 9.5a4.5 4.5 0 0 0 9 0"/><path d="M10 14v3"/><path v-if="!micOn" d="M4 4l12 12"/></svg><span>{{ micOn ? W.mute : W.unmute }}</span>
        </button>
        <button type="button" class="vc-ctl" :class="{ off: !camOn }" :title="camOn ? W['camera-off'] : W['camera-on']" @click="toggleCam">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="6" width="10" height="8" rx="1.5"/><path d="M13 9l4-2v6l-4-2"/><path v-if="!camOn" d="M4 4l12 12"/></svg><span>{{ camOn ? W['camera-off'] : W['camera-on'] }}</span>
        </button>
        <button type="button" class="vc-ctl" :class="{ on: sharing }" :title="sharing ? W['stop-share'] : W.share" @click="toggleShare">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="4" width="14" height="9" rx="1.5"/><path d="M7 16.5h6"/><path d="M10 7v4M8 9l2-2 2 2"/></svg><span>{{ sharing ? W['stop-share'] : W.share }}</span>
        </button>
        <button type="button" class="vc-ctl leave" :title="W.leave" @click="leave">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 5h3.5v10H12"/><path d="M4 10h7M8 7l-3 3 3 3"/></svg><span>{{ W.leave }}</span>
        </button>
        <button v-if="isHost" type="button" class="vc-ctl end" :title="W['end-all']" @click="asking = true">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="6.5"/><path d="M7.5 7.5l5 5M12.5 7.5l-5 5"/></svg><span>{{ W['end-all'] }}</span>
        </button>
      </div>
      <div v-if="asking" class="vc-ask"><div class="vc-ask-card"><p>{{ W['end-confirm'] }}</p><div class="vc-acts"><button type="button" class="vc-btn danger" @click="endAll">{{ W['end-yes'] }}</button><button type="button" class="vc-btn ghost" @click="asking = false">{{ W['end-no'] }}</button></div></div></div>
    </div>

    <!-- ended -->
    <div v-else class="vc-card vc-note">
      <h1>{{ W['ended-title'] }}</h1>
      <p>{{ grant && grant.record ? W['ended-lead'] : '' }}</p>
      <div class="vc-acts"><button type="button" class="vc-btn" @click="back">{{ W.back }}</button></div>
    </div>
  </div>
</template>

<style scoped>
.vc { --e: cubic-bezier(.2, .8, .2, 1); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; background: var(--paper); color: var(--ink) }
.vc.vc-dark { --paper: #0d0f12; --card: #16191e; --ink: #f2f3f0; --ink2: #b8bbb6; --ink3: #7f837e; --hair: #262a30; --wash: #1d2127; background: #0d0f12; color: #f2f3f0; align-items: stretch; padding: 0 }
.vc-card { width: min(100%, 880px); border: 1px solid var(--hair); border-radius: 18px; background: var(--card); box-shadow: 0 1px 2px #0000000a, 0 24px 60px -36px #00000066; animation: vc-in .4s var(--e) }
@keyframes vc-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
.vc-note { padding: 40px 36px; text-align: center; max-width: 560px }
.vc-note h1 { font-family: var(--fd); font-weight: 600; font-size: 26px; letter-spacing: -.01em; margin: 0 0 8px } .vc-note p { color: var(--ink2); margin: 0 0 18px; font-size: 15px }
.vc-eyebrow { display: block; font-family: var(--m); font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3); margin-bottom: 8px }
.vc-acts { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap }
.vc-btn { font: inherit; font-size: 14px; font-weight: 600; color: var(--paper); background: var(--ink); border: 1px solid var(--ink); border-radius: 999px; padding: 10px 20px; cursor: pointer; transition: transform .2s var(--e) } .vc-btn:hover { transform: translateY(-1px) } .vc-btn:disabled { opacity: .6; cursor: default }
.vc-btn.ghost { color: var(--ink2); background: transparent; border-color: var(--hair) } .vc-btn.danger { background: #b3261e; border-color: #b3261e; color: #fff }
/* the lobby */
.vc-lobby { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); overflow: hidden }
.vc-preview { position: relative; background: #0d0f12; min-height: 320px; display: grid; place-items: center } .vc-preview video { width: 100%; height: 100%; object-fit: cover; display: block; transform: scaleX(-1) }
.vc-nodev { position: absolute; inset: auto 16px 16px; font-size: 13px; color: #b8bbb6; text-align: center }
.vc-lobby-side { padding: 32px 30px; display: flex; flex-direction: column; gap: 10px }
.vc-lobby-side h1 { font-family: var(--fd); font-weight: 600; font-size: 26px; letter-spacing: -.01em; margin: 0 } .vc-lobby-side p { margin: 0; color: var(--ink2); font-size: 14.5px }
.vc-lobby-side .vc-acts { justify-content: flex-start; margin-top: 8px }
.vc-field { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--ink3) } .vc-field select { font: inherit; font-size: 14px; color: var(--ink); background: var(--paper); border: 1px solid var(--hair); border-radius: 8px; padding: 7px 10px }
.vc-rec-line { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink2) } .vc-rec-line i, .vc-recording i { width: 8px; height: 8px; border-radius: 50%; background: #e04b3a; box-shadow: 0 0 0 3px #e04b3a33 }
.vc-err { color: #e04b3a; font-size: 13.5px }
/* the call */
.vc-room { flex: 1; display: flex; flex-direction: column; height: 100vh; overflow: hidden; padding: 14px 16px 92px; box-sizing: border-box; gap: 12px }
.vc-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--ink2); font-size: 13.5px } .vc-title { font-weight: 600; color: var(--ink) }
.vc-recording { display: inline-flex; align-items: center; gap: 8px; font-family: var(--m); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #ff8a7a }
.vc-stage { position: relative; flex: 1 1 0; min-height: 0; border-radius: 16px; overflow: hidden; background: #000; animation: vc-in .4s var(--e) } .vc-stage video { width: 100%; height: 100%; object-fit: contain; display: block }
.vc-grid { display: grid; grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); gap: 10px; flex: 1; min-height: 0; align-content: center; transition: grid-template-columns .4s var(--e) }
.vc-room.staged .vc-grid { flex: 0 0 auto; grid-auto-flow: column; grid-template-columns: repeat(var(--cols), 160px); justify-content: center; overflow-x: auto; align-content: start }
.vc-tile { position: relative; aspect-ratio: 16 / 10; border-radius: 16px; overflow: hidden; background: var(--card); border: 2px solid transparent; transition: border-color .3s var(--e), transform .4s var(--e) }
.vc-room.staged .vc-tile { aspect-ratio: 16 / 10; width: 160px }
.vc-tile video { width: 100%; height: 100%; object-fit: cover; display: block } .vc-tile.me video { transform: scaleX(-1) } .vc-tile.off video { visibility: hidden }
.vc-tile.speaking { border-color: var(--accent2, #7cc6a6); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent2, #7cc6a6) 25%, transparent) }
.vc-tile-name { position: absolute; left: 12px; bottom: 10px; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #fff; background: #0009; padding: 4px 10px; border-radius: 999px; backdrop-filter: blur(6px) }
.vc-muted { display: inline-flex; width: 14px; height: 14px; color: #ff8a7a } .vc-muted svg { width: 14px; height: 14px }
.vc-initial { position: absolute; inset: 0; display: grid; place-items: center; font-family: var(--fd); font-size: 44px; color: var(--ink2) }
.vc-waiting { text-align: center; color: var(--ink3); font-size: 14px; margin: 0 }
.vc-bar { position: fixed; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; gap: 10px; padding: 14px 16px 18px; background: linear-gradient(to top, #0d0f12, #0d0f12ee 70%, transparent); animation: vc-rise .5s var(--e) }
@keyframes vc-rise { from { transform: translateY(20px); opacity: 0 } to { transform: none; opacity: 1 } }
.vc-ctl { display: inline-flex; flex-direction: column; align-items: center; gap: 4px; font: inherit; font-size: 11px; color: #d8dbd6; background: #1d2127; border: 1px solid #262a30; border-radius: 14px; padding: 9px 14px; min-width: 76px; cursor: pointer; transition: background .2s var(--e), transform .2s var(--e) } .vc-ctl:hover { background: #262a30; transform: translateY(-1px) }
.vc-ctl svg { width: 20px; height: 20px } .vc-ctl.off { background: #3a2626; border-color: #5a2f2f; color: #ffb4a8 } .vc-ctl.on { background: #24382f; border-color: #2f5a44; color: #b6f0d0 }
.vc-ctl.leave { background: #b3261e; border-color: #b3261e; color: #fff } .vc-ctl.end { background: transparent; color: #ff8a7a; border-color: #5a2f2f }
.vc-ask { position: fixed; inset: 0; display: grid; place-items: center; background: #0009; animation: vc-in .3s var(--e) } .vc-ask-card { background: var(--card); border: 1px solid var(--hair); border-radius: 16px; padding: 24px 28px; text-align: center } .vc-ask-card p { margin: 0 0 16px; font-size: 15px }
.vc-fade-enter-active, .vc-fade-leave-active { transition: opacity .3s var(--e) } .vc-fade-enter-from, .vc-fade-leave-to { opacity: 0 }
@media (prefers-reduced-motion: reduce) { .vc-card, .vc-stage, .vc-bar, .vc-ask { animation: none } .vc-btn, .vc-ctl, .vc-tile, .vc-grid { transition: none } }
@media (max-width: 720px) { .vc-lobby { grid-template-columns: 1fr } .vc-preview { min-height: 220px } .vc-grid { grid-template-columns: 1fr !important; align-content: start; overflow-y: auto } .vc-tile { aspect-ratio: 4 / 3 } .vc-ctl { min-width: 0; padding: 8px 10px } .vc-ctl span { display: none } .vc-ctl.end span { display: inline } .vc-room { padding: 12px 12px 84px } }
</style>

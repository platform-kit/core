<script setup>
/*
 * A huddle, in the shape every workspace chat gives one: a small panel docked at the foot of the
 * sidebar, NOT a room that takes the screen. The whole point of a huddle is that you keep working
 * while you are in it — reading a channel, answering somebody else, looking something up — so it
 * stays out of the way, it follows you from channel to channel, and it opens larger only if you ask.
 *
 * It holds the people as faces rather than a wall of video, because in a huddle most cameras are
 * off most of the time; whoever is speaking wears a ring. The controls are the two the mesh actually
 * has (the microphone and the camera) and the one everybody looks for (leaving) — there is no
 * screen-share button, because there is no screen share, and a button that does nothing is worse
 * than none. What the call cannot do is said in words rather than hidden behind a spinner, and
 * whether it is recorded is said in the dock itself — a disclosure nobody should have to open a
 * panel to read.
 *
 * Words from spaces.md (call).
 */
import { computed, onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { meshCall } from 'platformkit/lib/call/mesh.js'
import { tiles } from 'platformkit/lib/call/rules.js'
import { callFor } from 'platformkit/lib/spaces/api.js'
import SpaceAvatar from './SpaceAvatar.vue'
import SpaceIcon from './SpaceIcon.vue'

const props = defineProps({
  channel: { type: Object, required: true },
  me: { type: String, default: '' },
})
const emit = defineEmits(['close', 'open'])
const W = computed(() => us('spaces').call.main)
/* shallow on purpose: a plain ref would unwrap the refs the call hands back (state, trouble), and
   reading .value on the unwrapped value is an error rather than the ref it looks like */
const call = shallowRef(null)
const cred = ref(null)
const error = ref(null)
const els = ref({})
const big = ref(false)

const list = computed(() => (call.value
  ? tiles(call.value.peers, { id: props.me, stream: call.value.local.stream, muted: call.value.local.muted, cameraOff: call.value.local.cameraOff }, { you: W.value.you, someone: W.value.someone })
  : []))
const anyVideo = computed(() => list.value.some((t) => t.stream && !t.cameraOff))
const trouble = computed(() => {
  const t = (call.value && call.value.trouble.value) || error.value
  return t ? (W.value[t] || W.value.failed) : ''
})
const joining = computed(() => !!call.value && call.value.state.value === 'joining')

/* a stream belongs to an element, and only while there is a picture to put in it */
function attach() {
  for (const t of list.value) {
    const el = els.value[t.id]
    if (el && t.stream && el.srcObject !== t.stream) el.srcObject = t.stream
  }
}
watch(list, attach, { deep: true })
watch(big, () => requestAnimationFrame(attach))

onMounted(async () => {
  try {
    cred.value = await callFor(props.channel.id)
  } catch (e) { error.value = 'failed'; return }
  if (!cred.value || cred.value.error) { error.value = 'failed'; return }
  call.value = meshCall({
    token: cred.value.token, topic: cred.value.topic, iceServers: cred.value.iceServers,
    relay: !!cred.value.relay, max: cred.value.max, me: { id: props.me, name: cred.value.who || '' },
  })
  await call.value.join()
  attach()
})
onBeforeUnmount(() => { if (call.value) call.value.leave() })

const hangUp = async () => { if (call.value) await call.value.leave(); emit('close') }
</script>

<template>
  <section class="sq" :class="{ big, video: anyVideo && big }" :aria-label="(W.title || '').replace('{channel}', channel.name)">
    <header class="sq-head">
      <button type="button" class="sq-where" :title="W.title" @click="emit('open', channel.id)">
        <SpaceIcon name="hash" :size="12" /><span>{{ channel.name }}</span>
      </button>
      <span v-if="joining" class="sq-dot" :title="W.joining" aria-hidden="true"></span>
      <button type="button" class="sq-ico" :title="big ? W.shrink : W.expand" :aria-label="big ? W.shrink : W.expand" @click="big = !big">
        <SpaceIcon :name="big ? 'shrink' : 'expand'" :size="14" />
      </button>
    </header>

    <p v-if="trouble" class="sq-trouble">{{ trouble }}</p>

    <ul class="sq-tiles">
      <li v-for="t in list" :key="t.id" :class="{ speaking: t.speaking, off: t.cameraOff || !t.stream, mine: t.me }">
        <video v-show="big && t.stream && !t.cameraOff" :ref="(el) => (els[t.id] = el)" autoplay playsinline :muted="t.me"></video>
        <SpaceAvatar v-if="!big || t.cameraOff || !t.stream" :name="t.name" :size="big ? 64 : 34" class="sq-face" />
        <span v-if="big" class="sq-name">{{ t.name }}</span>
        <SpaceIcon v-if="t.muted" name="mic-off" :size="big ? 13 : 10" class="sq-mute" />
      </li>
    </ul>

    <p v-if="!trouble && list.length < 2" class="sq-note">{{ joining ? W.joining : W.alone }}</p>
    <p class="sq-fine">
      {{ cred && cred.records ? W.recorded : W['not-recorded'] }}
      <template v-if="cred && cred.max"> {{ (W.carries || '').replace('{n}', cred.max) }}</template>
    </p>

    <div class="sq-bar">
      <button
        type="button" class="sq-btn" :class="{ off: call && call.local.muted }" :disabled="!call"
        :title="call && call.local.muted ? W['mic-off'] : W['mic-on']"
        :aria-label="call && call.local.muted ? W['mic-off'] : W['mic-on']"
        @click="call.setMic(call.local.muted)">
        <SpaceIcon :name="call && call.local.muted ? 'mic-off' : 'mic'" :size="16" />
      </button>
      <button
        type="button" class="sq-btn" :class="{ off: call && call.local.cameraOff }" :disabled="!call"
        :title="call && call.local.cameraOff ? W['cam-off'] : W['cam-on']"
        :aria-label="call && call.local.cameraOff ? W['cam-off'] : W['cam-on']"
        @click="call.setCam(call.local.cameraOff)">
        <SpaceIcon :name="call && call.local.cameraOff ? 'cam-off' : 'cam'" :size="16" />
      </button>
      <span class="sq-gap"></span>
      <button type="button" class="sq-btn sq-hang" :title="W.leave" :aria-label="W.leave" @click="hangUp">
        <SpaceIcon name="hang" :size="16" />
      </button>
    </div>
  </section>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; these say what they want instead.
   The dock sits at the foot of the sidebar, over it — the sidebar scrolls behind it — so a huddle
   never moves the conversation about, and stays put while you read something else. */
.sq { position: fixed; left: 74px; bottom: 10px; z-index: 34; width: 248px; display: flex; flex-direction: column;
  gap: 8px; margin: 0; padding: 9px 10px 10px; color: var(--sp-side-ink);
  background: color-mix(in srgb, #fff 8%, var(--sp-side)); border: 1px solid color-mix(in srgb, #fff 13%, transparent);
  border-radius: 12px; box-shadow: 0 10px 30px rgba(0, 0, 0, .35);
  transition: width .18s cubic-bezier(.2, .8, .2, 1), height .18s cubic-bezier(.2, .8, .2, 1) }
.sq.big { left: auto; right: 18px; bottom: 18px; width: min(680px, calc(100vw - 120px)); padding: 12px 14px 13px }

.sq-head { display: flex; align-items: center; gap: 6px; margin: 0; padding: 0; border: 0; min-height: 20px }
.sq-where { display: flex; align-items: center; gap: 4px; min-width: 0; font: inherit; font-size: 12.5px;
  font-weight: 700; color: #fff; background: transparent; border: 0; padding: 0; cursor: pointer }
.sq-where span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sq-where:hover { text-decoration: underline }
.sq-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--sp-go); animation: sqpulse 1.4s ease-in-out infinite }
@keyframes sqpulse { 0%, 100% { opacity: .35 } 50% { opacity: 1 } }
.sq-ico { margin-left: auto; display: grid; place-items: center; width: 24px; height: 22px; flex: none;
  color: color-mix(in srgb, var(--sp-side-ink) 80%, transparent); background: transparent; border: 0;
  border-radius: 6px; cursor: pointer }
.sq-ico:hover { color: #fff; background: color-mix(in srgb, #fff 12%, transparent) }

.sq-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(46px, 1fr)); gap: 6px;
  list-style: none; margin: 0; padding: 0 }
.sq.big .sq-tiles { grid-template-columns: repeat(auto-fit, minmax(190px, 260px)); justify-content: center; gap: 10px }
.sq-tiles li { position: relative; display: grid; place-items: center; aspect-ratio: 1;
  background: color-mix(in srgb, #000 30%, transparent); border-radius: 10px; overflow: hidden }
.sq.big .sq-tiles li { aspect-ratio: 4 / 3; border-radius: 12px }
.sq-tiles li.speaking { box-shadow: inset 0 0 0 2px var(--sp-go) }
.sq-tiles video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover }
.sq-face { position: relative; z-index: 1 }
.sq-name { position: absolute; left: 7px; bottom: 6px; z-index: 2; max-width: calc(100% - 14px); font-size: 11px;
  font-weight: 600; color: #fff; background: rgba(0, 0, 0, .5); border-radius: 999px; padding: 2px 8px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sq-mute { position: absolute; right: 4px; bottom: 4px; z-index: 2; color: #fff; opacity: .85;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .6)) }

.sq-note, .sq-fine { margin: 0; max-width: none; font-size: 11.5px; line-height: 1.4;
  color: color-mix(in srgb, var(--sp-side-ink) 70%, transparent) }
.sq-fine { font-size: 10.5px }
.sq-trouble { margin: 0; max-width: none; font-size: 11.5px; line-height: 1.45; color: #fff;
  background: color-mix(in srgb, var(--sp-badge) 55%, transparent); border-radius: 8px; padding: 6px 9px }

.sq-bar { display: flex; align-items: center; gap: 6px }
.sq-gap { flex: 1 }
.sq-btn { display: grid; place-items: center; width: 34px; height: 34px; flex: none; color: #fff;
  background: color-mix(in srgb, #fff 14%, transparent); border: 0; border-radius: 50%; cursor: pointer;
  transition: background .12s ease }
.sq-btn:hover:not(:disabled) { background: color-mix(in srgb, #fff 24%, transparent) }
.sq-btn:disabled { opacity: .4; cursor: default }
/* off is a state, not a warning: the control is filled in when it is ON and hollow when it is not */
.sq-btn.off { color: var(--sp-side); background: #fff }
.sq-hang { background: var(--sp-badge) }
.sq-hang:hover { background: color-mix(in srgb, #fff 18%, var(--sp-badge)) }

@media (max-width: 900px) {
  .sq { left: 10px; right: 10px; width: auto; bottom: 10px }
  .sq.big { left: 10px; right: 10px; width: auto }
}
@media (prefers-reduced-motion: reduce) { .sq { transition: none } .sq-dot { animation: none; opacity: 1 } }
</style>

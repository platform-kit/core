<!--
  HOW A SPOKEN CONVERSATION LOOKS, in five shapes over one source of numbers.

  `aura`, `wave`, `radial`, `grid`, `bar` — chosen by name in the bot's `voice:` block the way a
  landing section chooses its layout. A sixth is a branch in `draw` and a name in SHAPES, never a
  change to anything that listens.

  WHOSE TURN IT IS, IN FOUR SIGNALS AT ONCE. A person must be able to tell at a glance whether
  they are being heard or being answered, and COLOUR ALONE CANNOT CARRY THAT — not for somebody
  colour-blind, not on a monochrome display, not at the edge of vision. So the two differ in:

    DIRECTION   the person draws INWARD (they are being taken in); the assistant draws OUTWARD
                (it is being given out). This is the signal that survives everything else.
    WEIGHT      the person is an outline; the assistant is filled.
    SCALE       the assistant occupies more room than the person ever does.
    COLOUR      the person is ink, the assistant the look's accent — the fourth signal, never the
                only one.

  WHAT IT DRAWS IS THE STATE, not only the signal. Each shape answers all four states, because a
  surface that animates only while there is audio has solved the easy case and left the two that
  matter: `thinking` and `connecting` carry no sound at all, and going flat during them reads as a
  crash at the moment somebody is waiting. `lib/copilot/levels.js` holds that arithmetic — the
  floor under each state, the breathing idle, the fast rise and slow fall — so all five agree and
  none of it is written in a component.

  COLOUR COMES FROM THE LOOK, read off the element rather than passed as a hue, so a visualizer in
  a site's palette is the default. No colour literal anywhere below.
-->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { frame } from 'platformkit/lib/copilot/levels.js'
import VoiceAura from './VoiceAura.vue'
import { paintShape, SHAPES } from 'platformkit/lib/copilot/visual.js'

const props = defineProps({
  shape: { type: String, default: 'aura' },      /* aura · wave · radial · grid · bar */
  state: { type: String, default: 'connecting' },
  mine: { type: Number, default: 0 },            /* the person's loudness, 0..1 */
  theirs: { type: Number, default: 0 },          /* the assistant's */
  label: { type: String, default: '' },          /* the state in words, for anybody not watching */
})

const canvas = ref(null)
const root = ref(null)
let raf = 0, started = 0
const level = ref(0)
const live = ref(null)
let ink = '', accent = '', soft = ''
/* THE AURA IS A SHADER and the other four are drawn; it is the only one that is per-pixel (see
   VoiceAura.vue). A browser with no WebGL, or one that loses the context, falls back to the
   drawn shape rather than to nothing. */
const glDead = ref(false)
const isAura = computed(() => props.shape === 'aura' && !glDead.value)
/* the colour the ring is made of: the person in ink, the assistant in the look's accent */
const hue = ref('#1FD5F9')

/* a reader who asked for less motion gets the shape at rest: still legible, never moving */
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const stillNow = still()

function colours(el) {
  const s = getComputedStyle(el)
  accent = s.getPropertyValue('--accent').trim() || s.color
  ink = s.getPropertyValue('--ink3').trim() || s.color
  soft = s.getPropertyValue('--accentbg').trim() || accent
}

/* the aura needs the same numbers but paints none of them itself, so the loop still runs */
function tick(now) {
  const at = still() ? 0 : now - started
  const f = frame({ state: props.state, mine: props.mine, theirs: props.theirs, previous: level.value, at })
  level.value = f.level; live.value = f.live
  hue.value = f.live === 'me' ? ink : accent
  if (!still()) raf = requestAnimationFrame(tick)
}

function draw(now) {
  const el = canvas.value
  if (!el) return
  const ctx = el.getContext('2d')
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = el.clientWidth, h = el.clientHeight
  /* BOTH, not one. Guarding on the width alone let a canvas sit at 300 x 150 on a phone — the
     box was measured before it was square — and the backing store is never resized again once
     the width matches, so the ring was drawn into half the height and came out as an arch. */
  if (el.width !== w * dpr || el.height !== h * dpr) { el.width = w * dpr; el.height = h * dpr }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const at = still() ? 0 : now - started
  const f = frame({ state: props.state, mine: props.mine, theirs: props.theirs, previous: level.value, at })
  level.value = f.level; live.value = f.live
  /* the shapes themselves live in lib, so all twenty combinations can be drawn side by side in a
     headless browser and looked at — a shape that can only be seen by mounting an app is a shape
     that gets reported without being seen, which this project has a rule against */
  paintShape(ctx, { shape: props.shape, state: props.state, w, h, level: f.level, live: f.live, at, paint: { accent, ink, soft }, still: still() })
  if (!still()) raf = requestAnimationFrame(draw)
}

onMounted(() => {
  colours(root.value)
  started = performance.now()
  raf = requestAnimationFrame(isAura.value ? tick : draw)
})
watch(isAura, (on) => { cancelAnimationFrame(raf); raf = requestAnimationFrame(on ? tick : draw) })
onBeforeUnmount(() => cancelAnimationFrame(raf))
/* at rest it is drawn once per change rather than every frame, so reduced motion costs nothing */
watch(() => [props.state, props.shape], () => { if (still()) requestAnimationFrame(draw) })
</script>

<template>
  <!-- the shape is the decoration; the STATE is the information, so it is also said in words for
       anybody who is not watching it, and that is what a screen reader announces -->
  <div ref="root" class="cv" :data-state="state" :data-shape="shape" :data-live="live">
    <VoiceAura v-if="isAura" :state="state" :level="level" :live="live" :colour="hue"
               :still="stillNow" @fail="glDead = true" />
    <canvas v-else ref="canvas" class="cv-c" aria-hidden="true"></canvas>
    <p class="cv-say" role="status" aria-live="polite">{{ label }}</p>
  </div>
</template>

<style scoped>
.cv { position: relative; display: grid; place-items: center; width: 100%; aspect-ratio: 1 / 1; max-width: 320px; margin-inline: auto }
.cv-c { width: 100%; height: 100%; display: block }
/* the state in words is for anybody not watching the shape, so it is read rather than seen */
.cv-say { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap }
</style>

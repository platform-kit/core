<!--
  THE AURA — a ring of light that moves like breath. WebGL, because nothing else does this.

  WHY A SHADER AND NOT THE CANVAS the other four shapes use: this effect is per-pixel. It is a
  dozen overlapping arcs, each blurred over tens of pixels, each with its own wobble, summed and
  tonemapped. Drawn with 2D circles it is a handful of hard rings; drawn with shadowBlur it is a
  handful of soft rings and a frame rate nobody wants. The thing that makes it beautiful — light
  accumulating where strands cross — only exists if every pixel asks every strand how near it is.

  ORIGINAL. LiveKit's aura is a shader too, and it is licensed Polyform Non-Resale (© UNCRN LLC),
  which forbids use in anything sold — so not one line of it is here and none of it was read for
  structure. This is a signed-distance ring with domain-warped radius, which is the ordinary way
  to draw this, arrived at from the picture rather than from their source.

  It degrades rather than fails: no WebGL, or a context lost, and the canvas simply goes away and
  the shape falls back to the drawn one.
-->
<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  state: { type: String, default: 'listening' },
  level: { type: Number, default: 0 },     /* 0..1, whoever is speaking */
  live: { type: String, default: null },   /* 'me' | 'them' | null */
  colour: { type: String, default: '#1FD5F9' },
  still: { type: Boolean, default: false },
})
const emit = defineEmits(['fail'])
const canvas = ref(null)
let gl = null, raf = 0, u = {}, t0 = 0, lost = null
/* what each state looks like: how fast it turns, how far it wobbles, how wide it sits, how
   bright. The person's own voice is tighter and cooler than the assistant's, which is the same
   distinction the drawn shapes make in outline and fill. */
const MOOD = {
  connecting: { speed: 0.35, wobble: 0.5, radius: 0.30, thick: 0.030, bright: 0.95, pulse: 0.5 },
  listening: { speed: 0.5, wobble: 0.85, radius: 0.31, thick: 0.032, bright: 1.1, pulse: 0.35 },
  thinking: { speed: 1.25, wobble: 1.15, radius: 0.30, thick: 0.030, bright: 1.1, pulse: 1.1 },
  speaking: { speed: 1.9, wobble: 1.5, radius: 0.33, thick: 0.042, bright: 1.35, pulse: 0 },
}
const SRC = {
  v: `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`,
  f: `precision highp float;
uniform vec2 uSize; uniform vec3 uColor;
uniform float uTime, uLevel, uWobble, uRadius, uThick, uBright, uPulse, uSpin;

/* a cheap hash, for the dither that keeps wide soft gradients off the banding */
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.31, 289.17))) * 43758.5453); }

/*
 * The radius of one strand at one angle. THE FREQUENCIES ARE WHOLE NUMBERS and that is not a
 * detail: sin(a * f) is only continuous all the way round the circle when f is an integer, and
 * with 2.8 or 4.6 the curve does not meet itself where atan wraps at ±π — which draws a hard
 * horizontal line out of the left of the ring. It took a render to see and a moment to explain.
 */
float wob(float a, float t, float f1, float f2, float ph){
  return sin(a * f1 + t + ph) * 0.62 + sin(a * f2 - t * 1.3 + ph * 2.1) * 0.38;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uSize) / min(uSize.x, uSize.y);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float t = uTime;
  float lvl = clamp(uLevel, 0.0, 1.0);
  /* the breath: the whole ring opens and closes slowly even when nothing is being said */
  float breath = 1.0 + 0.03 * sin(t * 0.6) + 0.05 * lvl;

  float sum = 0.0;
  vec3 col = vec3(0.0);
  /*
   * NINE THIN STRANDS, NOT A BAND. The first attempt used seven fat ones at nearly the same
   * radius: they overlapped everywhere, the alpha saturated, and it came out as a solid blue
   * donut. What makes the reference beautiful is that each strand is nearly transparent on its
   * own and only the CROSSINGS are bright — so they are thin, they sit at visibly different
   * radii, and the sum is rolled off hard so it blooms instead of filling in.
   */
  for (int i = 0; i < 9; i++){
    float fi = float(i);
    float ph = fi * 2.399;                           /* golden-ish, so no two line up */
    float f1 = 2.0 + floor(mod(fi, 4.0));            /* 2..5, whole, so the circle closes */
    float f2 = f1 + 3.0;
    /*
     * THE TURN, AND IT IS WHAT MAKES IT ALIVE. Amplitude alone is a pulse — the ring swells and
     * shrinks on the spot and reads as a meter. What a voice looks like is motion ROUND the
     * ring, and faster while there is more to say.
     *
     * Every strand turns at its own rate and every other one turns the OTHER way, so they shear
     * past each other and the crossings travel instead of sitting still. A single shared
     * rotation would turn the whole picture like a wheel, which is a different and much duller
     * thing. Adding a constant to the angle keeps the whole-number frequencies intact, so the
     * circle still closes and there is no seam.
     */
    float dir = mod(fi, 2.0) < 0.5 ? 1.0 : -0.78;
    float sa = a + uSpin * dir * (0.55 + 0.5 * fi / 9.0);
    /* each strand keeps its own station, which is what stops them merging into a band */
    float seat = uRadius * breath + (fi / 8.0 - 0.5) * uThick * 1.9;
    float amp  = (0.030 + 0.045 * lvl) * uWobble;
    float rad  = seat + amp * wob(sa, t * (0.8 + fi * 0.07) + fi * 0.7, f1, f2, ph);
    float th   = uThick * (0.34 + 0.26 * mod(fi, 3.0)) * (0.9 + 0.35 * lvl);
    float d    = (r - rad) / th;
    float g    = exp(-d * d);                        /* a gaussian, so every strand is pure glow */
    float w    = 0.24 + 0.34 * (1.0 - abs(fi - 4.0) / 4.0);
    sum += g * w;
    col += uColor * g * w;
  }
  /* where strands cross, light adds — then it is rolled off so it blooms instead of clipping */
  float A = sum * uBright * (0.9 + 0.5 * lvl);
  /* a gentle knee: hard enough that crossings bloom instead of clipping, soft enough that a
     single strand is still clearly a strand. Rolled off at 1.9 the whole ring was a haze. */
  A = A / (1.0 + A * 0.55);
  /* and the slow pulse that tells thinking from listening without any sound to measure */
  A *= 1.0 - uPulse * 0.22 * (0.5 + 0.5 * sin(t * 2.1));
  vec3 rgb = col / max(sum, 0.0001);
  float n = (hash(gl_FragCoord.xy + fract(t)) - 0.5) * 0.02;
  gl_FragColor = vec4(rgb + n, clamp(A, 0.0, 0.95));
}`,
}

const rgb = (hex) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex).trim())
  return m ? [1, 2, 3].map((i) => parseInt(m[i], 16) / 255) : [0.12, 0.84, 0.98]
}

function build() {
  const el = canvas.value
  if (!el) return false
  gl = el.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false })
  if (!gl) return false
  const sh = (kind, src) => {
    const s = gl.createShader(kind); gl.shaderSource(s, src); gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader')
    return s
  }
  const prog = gl.createProgram()
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, SRC.v))
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, SRC.f))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link')
  gl.useProgram(prog)
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const p = gl.getAttribLocation(prog, 'p')
  gl.enableVertexAttribArray(p)
  gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0)
  for (const k of ['uSize', 'uColor', 'uTime', 'uLevel', 'uWobble', 'uRadius', 'uThick', 'uBright', 'uPulse', 'uSpin']) u[k] = gl.getUniformLocation(prog, k)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  return true
}

/* the mood eases toward the state rather than snapping, so a turn change is a swell */
const now = { ...MOOD.listening }
/*
 * The rotation is INTEGRATED rather than computed from the clock. Multiplying the time by a
 * speed that changes makes the whole picture jump backwards and forwards as the speed moves —
 * the phase has to accumulate, so it only ever goes on turning, faster or slower.
 */
let spin = 0, lastMs = 0
function draw(ms) {
  const el = canvas.value
  if (!el || !gl) return
  if (!t0) t0 = ms
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = Math.max(1, Math.round(el.clientWidth * dpr)), h = Math.max(1, Math.round(el.clientHeight * dpr))
  if (el.width !== w || el.height !== h) { el.width = w; el.height = h }
  gl.viewport(0, 0, w, h)
  const want = MOOD[props.state] || MOOD.listening
  for (const k of Object.keys(want)) now[k] += (want[k] - now[k]) * 0.06
  gl.uniform2f(u.uSize, w, h)
  gl.uniform3fv(u.uColor, rgb(props.colour))
  gl.uniform1f(u.uTime, props.still ? 2.0 : ((ms - t0) / 1000) * now.speed)
  gl.uniform1f(u.uLevel, props.level)
  /* DEV ONLY: the value the shader was actually given, where a probe can read it. Proving this
     chain by photographing the canvas does not work — a PNG is compressed, so byte differences
     say nothing about how much the picture changed. */
  if (import.meta.env.DEV) el.dataset.level = props.level.toFixed(3)
  if (import.meta.env.DEV) el.dataset.spin = spin.toFixed(3)
  gl.uniform1f(u.uWobble, now.wobble)
  gl.uniform1f(u.uRadius, now.radius)
  gl.uniform1f(u.uThick, now.thick)
  gl.uniform1f(u.uBright, now.bright)
  gl.uniform1f(u.uPulse, props.still ? 0 : now.pulse)
  /* how far it has turned: always drifting, and much faster while there is a voice */
  const dt = lastMs ? Math.min(0.1, (ms - lastMs) / 1000) : 0
  lastMs = ms
  if (!props.still) spin += dt * now.speed * (0.18 + 1.6 * props.level)
  gl.uniform1f(u.uSpin, spin)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  if (!props.still) raf = requestAnimationFrame(draw)
}

onMounted(() => {
  try { if (!build()) return emit('fail') } catch { return emit('fail') }
  lost = (e) => { e.preventDefault(); cancelAnimationFrame(raf); emit('fail') }
  canvas.value.addEventListener('webglcontextlost', lost)
  raf = requestAnimationFrame(draw)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  try { canvas.value && lost && canvas.value.removeEventListener('webglcontextlost', lost) } catch { /* gone */ }
  try { gl && gl.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* gone */ }
})
/* at rest it is painted once per change rather than every frame */
watch(() => [props.state, props.still], () => { if (props.still) requestAnimationFrame(draw) })
</script>

<template>
  <canvas ref="canvas" class="au" aria-hidden="true"></canvas>
</template>

<style scoped>
.au { width: 100%; height: 100%; display: block }
</style>

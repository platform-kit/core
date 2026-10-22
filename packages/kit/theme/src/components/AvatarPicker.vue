<script setup>
/*
 * DESIGNING A FACE.
 *
 * Nobody is assigned one. Somebody who has never opened this has a pattern — patchwork, drawn from
 * a digest of their own address — because every anthropomorphic style hands a person a face with a
 * presentation, and a presentation nobody chose can be wrong about the person wearing it.
 *
 * So this is a DESIGNER and not a randomiser. A style, then the parts of it: the hair, the eyes,
 * the mouth, what they are wearing, and the palettes each of those draws from. What a style offers
 * is read from the style's own definition (traitsOf), so nothing here is a list somebody has to
 * keep in step and a style that gains a part next release gains it in the picker too.
 *
 * TWO RULES ABOUT WHAT IS NOT CHOSEN.
 *
 *   A part nobody picked is left to the SEED, not set to a default. That keeps a half-finished
 *   face a face — somebody who changes the hair and stops has their own face with different hair,
 *   rather than a stranger with one familiar feature.
 *
 *   Surprise me is one press and is not the same as not choosing: it picks every part, so it can
 *   be kept, edited or put back. A randomiser that quietly cleared the choices would lose work.
 *
 * Words from the `account` scope.
 */
import { computed, ref, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { avatarUrl, AVATAR_STYLES, traitsOf, traitRows, isolate, offKey, isOff } from 'platformkit/lib/avatar.js'

const props = defineProps({
  /* what is on the profile now: the picture they uploaded, the style they picked, the parts they
     designed, and the seed the database made from their address. */
  avatar: { type: String, default: '' },
  style: { type: String, default: '' },
  seed: { type: String, default: '' },
  options: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['pick', 'upload', 'clear'])
const W = computed(() => us('account').avatar.main)

/*
 * THE DESIGNER IS FOLDED AWAY UNTIL IT IS ASKED FOR. Eight styles, a row per part and eight seeds
 * is the whole of a screen, and it was the first thing on the account page — so somebody who came
 * to change their name scrolled past a face workshop to get to it.
 *
 * ALL OF IT FOLDS, and nothing is taken away. The first attempt folded the styles and the parts and
 * left the SEEDS showing, which is the one part of this nobody asked for: the page then looked as
 * though the customisation had been removed and a randomiser left in its place. What stays out is
 * the face they have and the one button most people want; everything that changes the face is
 * behind the press.
 */
const designing = ref(false)

/* A SEED TO TRY. The one the database made is first and is always there, so "put it back" is a
   press rather than a thing they have to remember. The rest are that seed with a suffix, which
   keeps them stable: the fourth face is the fourth face tomorrow as well. */
const seeds = computed(() => {
  const base = String(props.seed || '').trim().toLowerCase()
  return base ? [base, ...Array.from({ length: 7 }, (_, i) => base + '-' + (i + 1))] : []
})
const style = ref(props.style || AVATAR_STYLES[0])
const seed = ref(props.seed || '')
const parts = ref({ ...(props.options || {}) })
/*
 * THE PROPS COME BACK ROUND, and they must not undo what was just chosen.
 *
 * Every choice emits, the page writes it into its draft, and the draft flows back in as a prop —
 * so a watcher that copies the prop over the local state will, in the tick between the two, put
 * back what was there BEFORE the press. The symptom is a designer where nothing ever looks
 * selected, which reads as the feature not working at all.
 *
 * So the last thing emitted is remembered, and a prop that says the same thing is not applied
 * again. What IS applied is a prop that differs — the page loading somebody's saved face, or the
 * person pressing Start again — which is the only reason the watcher exists.
 */
let lastSaid = JSON.stringify({ style: style.value, seed: seed.value, options: parts.value })
watch(() => [props.style, props.seed, props.options], () => {
  const incoming = JSON.stringify({ style: props.style || AVATAR_STYLES[0], seed: props.seed || '', options: props.options || {} })
  if (incoming === lastSaid) return
  lastSaid = incoming
  style.value = props.style || AVATAR_STYLES[0]
  seed.value = props.seed || ''
  parts.value = { ...(props.options || {}) }
})

/* what THIS style offers, by name, straight from its definition */
const traits = computed(() => traitsOf(style.value))
/* a colour's option name is the palette's name plus Color, which is DiceBear's convention */
const colourKey = (name) => name + 'Color'

/*
 * ONE PART AT A TIME, LARGE — and every option in a row only when somebody asks for that.
 *
 * Shown as a row of forty-pixel squares, the difference between two mouths or two pairs of glasses
 * is a few pixels across: the form was unreadable, which made it unusable. So the default is a
 * carousel — one square big enough to see, with a step either way — and "Show all options" lays
 * the whole row out for somebody who would rather scan it, at a size they can actually scan.
 */
const wide = ref(false)

/* every part this style offers, in the order a face is built: the skin outward, not the order the
   style definition happens to list its components in (`traitRows` in lib/avatar.js) */
const rows = computed(() => traitRows(style.value, traits.value))
/* what a row is choosing among, and the key it writes */
const rowKey = (r) => (r.kind === 'colour' ? colourKey(r.name) : r.name)
const rowValues = (r) => (r.kind === 'colour' ? traits.value.colours[r.name] : traits.value.shapes[r.name]) || []
const rowName = (r) => say(r.kind === 'colour' ? 'colour' : 'part', r.name)
/* a shape may also be NONE, which is a choice and not the absence of one; a colour may not */
const rowOptions = (r) => (r.kind === 'shape' ? [OFF, ...rowValues(r)] : rowValues(r))
const OFF = '\u0000none'
/* what is showing for this row: what they chose, else None if they chose that, else the seed's own
   — which is where the carousel starts, so stepping is relative to the face they can see */
const rowAt = (r) => {
  const k = rowKey(r)
  if (r.kind === 'shape' && isOff(parts.value, r.name)) return OFF
  const v = parts.value[k]
  return v === undefined ? null : v
}
function step(r, by) {
  const opts = rowOptions(r)
  if (!opts.length) return
  const now = rowAt(r)
  const i = now === null ? -1 : opts.indexOf(now)
  /* from "not chosen" a step forward lands on the first option and a step back on the last */
  const next = opts[((i < 0 ? (by > 0 ? 0 : opts.length - 1) : i + by) + opts.length) % opts.length]
  if (next === OFF) pickNone(r.name)
  else if (r.kind === 'shape' && isOff(parts.value, r.name)) { delete parts.value[offKey(r.name)]; pickPart(rowKey(r), next) }
  else pickPart(rowKey(r), next)
}
/* back to whatever the seed draws for this part, which is not the same as any option */
function resetPart(r) {
  delete parts.value[rowKey(r)]
  delete parts.value[offKey(r.name)]
  parts.value = { ...parts.value }
  settle()
}
/* the face this row is showing, at the size somebody can see */
/* what the colour input opens on: their own colour, else the one the seed drew */
const colourNow = (r) => {
  const v = parts.value[colourKey(r.name)]
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : (rowValues(r)[0] || '#000000')
}
/* …and whether what they chose is a colour of their own rather than one of the presets */
const isCustom = (r) => {
  const v = parts.value[colourKey(r.name)]
  return !!v && !rowValues(r).includes(v)
}

const rowFace = (r) => {
  const now = rowAt(r)
  if (now === OFF) return noneOf(r.name)
  if (now === null) return partFace(rowKey(r), undefined)
  return partFace(rowKey(r), now)
}

const face = (over = {}) => avatarUrl(seed.value || seeds.value[0], { style: style.value, parts: { ...parts.value, ...over } })
/*
 * A THUMBNAIL SHOWS ONE PART. A row of eyes is unreadable while the glasses somebody already chose
 * are drawn over all eight of them, so everything above the part being chosen comes off — which
 * the style itself says, in the order it draws its components. Everything BELOW stays, so the part
 * is still shown on a face rather than floating on its own.
 */
const partFace = (name, v) => avatarUrl(seed.value || seeds.value[0], {
  style: style.value, parts: { ...parts.value, [name]: v }, ...isolate(style.value, name),
})

const say = (group, name) => W.value[group + '-' + name] || name.replace(/([A-Z])/g, ' $1').toLowerCase()

function settle() {
  const said = { style: style.value, seed: seed.value, options: { ...parts.value } }
  lastSaid = JSON.stringify(said)
  emit('pick', said)
}
/*
 * WHAT WAS DESIGNED IN EACH STYLE IS KEPT WHILE THE PICKER IS OPEN.
 *
 * The parts of one style mean nothing to another — "short01" hair is not a quilt pattern — so the
 * face does start again when the style changes. But LOOKING at another style and coming back is not
 * the same as abandoning what was built: somebody who designed a face, pressed the other style to
 * see it and pressed back found their work gone, with nothing to undo it. The parts of each style
 * are held here until the page is left, so the toggle is reversible.
 */
const byStyle = ref({})
function pickStyle(st) {
  if (st === style.value) return
  byStyle.value[style.value] = { ...parts.value }   /* what was built here, to come back to */
  style.value = st
  parts.value = { ...(byStyle.value[st] || {}) }
  settle()
}
function pickSeed(sd) { seed.value = sd; settle() }
function pickPart(key, value) {
  if (parts.value[key] === value) delete parts.value[key]   /* pressing it again leaves it to the seed */
  else parts.value[key] = value
  /* a part cannot be both a shape and absent: choosing one clears the other */
  delete parts.value[offKey(key)]
  parts.value = { ...parts.value }
  settle()
}
/*
 * NONE. Not every face has glasses, and not everybody has hair. DiceBear's way of saying so is a
 * probability of nothing, which is a different answer from "I did not choose" — the latter leaves
 * the part to the seed and may well draw some. So the row offers it as a choice of its own, and
 * picking it clears whichever shape was chosen.
 */
function pickNone(name) {
  if (isOff(parts.value, name)) delete parts.value[offKey(name)]   /* pressing it again gives it back to the seed */
  else { delete parts.value[name]; parts.value[offKey(name)] = 0 }
  parts.value = { ...parts.value }
  settle()
}
const noneOf = (name) => avatarUrl(seed.value || seeds.value[0], {
  style: style.value, parts: { ...parts.value, [offKey(name)]: 0 }, ...isolate(style.value, name),
})
/* SURPRISE ME picks every part, so what it makes can be edited or put back */
function surprise() {
  const next = {}
  /* a surprise picks parts, never absences: somebody who wanted none can say so */
  for (const [name, list] of Object.entries(traits.value.shapes)) next[name] = list[Math.floor(Math.random() * list.length)]
  for (const [name, list] of Object.entries(traits.value.colours)) next[colourKey(name)] = list[Math.floor(Math.random() * list.length)]
  parts.value = next
  settle()
}
/* and back to the face their address made, which is the one they had before they opened this */
function putBack() { parts.value = {}; seed.value = props.seed || seeds.value[0]; settle() }
const designed = computed(() => Object.keys(parts.value).length > 0)

const file = ref(null)
function chose(e) {
  const f = e.target.files && e.target.files[0]
  if (f) emit('upload', f)
  e.target.value = ''
}
</script>

<template>
  <section class="ap">
    <!-- what they have now, at the size it is actually seen -->
    <div class="ap-now">
      <img class="ap-face" :src="avatar || face()" alt="" width="84" height="84" />
      <div class="ap-nowtxt">
        <b>{{ avatar ? W['yours-picture'] : W.yours }}</b>
        <p>{{ avatar ? W['yours-picture-line'] : W['yours-line'] }}</p>
        <div class="ap-nowacts">
          <button type="button" class="ap-quiet" @click="file.click()">{{ avatar ? W.replace : W.upload }}</button>
          <button v-if="avatar" type="button" class="ap-quiet" @click="emit('clear')">{{ W.remove }}</button>
          <!-- THE WAY BACK IS NEVER INVISIBLE. The label is a string like every other, and a string
               that has not been compiled yet resolves to nothing — which on a text-only button is
               a control zero pixels wide: the designer is folded behind something nobody can see
               or press, and the page reads as though the customisation had been deleted. The
               chevron is drawn whatever the words do, so the fold is always openable. -->
          <button type="button" class="ap-quiet ap-fold" :aria-expanded="String(designing)"
            :aria-label="(designing ? W['design-close'] : W.design) || undefined" @click="designing = !designing">
            <span>{{ designing ? W['design-close'] : W.design }}</span>
            <i class="ap-chev" :class="{ up: designing }" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </div>
    <input ref="file" type="file" accept="image/*" class="ap-file" @change="chose" />

    <!-- and the drawn ones, where they have not uploaded one (or would rather go back to one) -->
    <div v-if="designing" class="ap-styles">
      <button
        v-for="st in AVATAR_STYLES" :key="st" type="button"
        :class="{ on: !avatar && style === st }" @click="pickStyle(st)">
        <img :src="avatarUrl(seed || seeds[0], { style: st })" alt="" width="34" height="34" />
        <span>{{ W['style-' + st] || st }}</span>
      </button>
    </div>

    <!-- THE PARTS. One row per thing this style lets somebody change. -->
    <div v-if="designing && rows.length" class="ap-design">
      <div class="ap-designhead">
        <p class="ap-lbl">{{ W.parts }}</p>
        <div class="ap-designacts">
          <button type="button" class="ap-quiet" @click="wide = !wide">{{ wide ? W['fewer-options'] : W['all-options'] }}</button>
          <button type="button" class="ap-quiet" @click="surprise">{{ W.surprise }}</button>
          <button v-if="designed" type="button" class="ap-quiet" @click="putBack">{{ W['put-back'] }}</button>
        </div>
      </div>

      <div v-for="r in rows" :key="r.kind + ':' + r.name" class="ap-trait">
        <p class="ap-traitname">{{ rowName(r) }}</p>

        <!--
          A COLOUR IS NOT A CAROUSEL. Stepping through eight browns one at a time to find a skin
          tone is a worse form than seeing all eight at once, and neither lets somebody have the
          colour they actually want. So a colour row is always its swatches — and the last of them
          opens a real picker, so the presets are a shortcut rather than the whole of what is on
          offer. A swatch is drawn as the FACE wearing it in the row of all options, because a
          circle of brown is not a skin tone until it is on a face.
        -->
        <div v-if="r.kind === 'colour'" class="ap-colour">
          <button
            v-for="v in rowValues(r)" :key="v" type="button"
            class="ap-swatch" :class="{ on: parts[colourKey(r.name)] === v }"
            :style="{ background: v }" :title="v" :aria-label="v"
            @click="pickPart(colourKey(r.name), v)"></button>
          <label class="ap-any" :class="{ on: isCustom(r) }" :title="W['custom-colour']">
            <span class="ap-anyface" :style="isCustom(r) ? { background: parts[colourKey(r.name)] } : null"></span>
            <input
              type="color" :value="colourNow(r)" :aria-label="W['custom-colour']"
              @input="pickPart(colourKey(r.name), $event.target.value)">
          </label>
          <button
            v-if="rowAt(r) !== null" type="button" class="ap-quiet ap-reset"
            @click="resetPart(r)">{{ W['reset-part'] }}</button>
        </div>

        <!-- ONE AT A TIME, big enough to see what is being chosen -->
        <div v-else-if="!wide" class="ap-one">
          <button type="button" class="ap-step" :aria-label="W.prev" @click="step(r, -1)">
            <i class="ap-arrow left" aria-hidden="true"></i>
          </button>
          <img class="ap-big" :src="rowFace(r)" alt="" width="104" height="104" />
          <button type="button" class="ap-step" :aria-label="W.next" @click="step(r, 1)">
            <i class="ap-arrow right" aria-hidden="true"></i>
          </button>
          <button
            v-if="rowAt(r) !== null" type="button" class="ap-quiet ap-reset"
            @click="resetPart(r)">{{ W['reset-part'] }}</button>
        </div>

        <!-- …or all of them, for somebody who would rather scan the row -->
        <template v-else>
          <div class="ap-choices">
            <!-- no glasses, no hair: a choice of its own, and not the same as not choosing -->
            <button
              type="button" class="ap-none" :class="{ on: isOff(parts, r.name) }"
              :title="W.none" @click="pickNone(r.name)">
              <img :src="noneOf(r.name)" alt="" width="56" height="56" />
              <span>{{ W.none }}</span>
            </button>
            <button
              v-for="v in rowValues(r)" :key="v" type="button"
              :class="{ on: parts[r.name] === v }" :title="v" @click="pickPart(r.name, v)">
              <img :src="partFace(r.name, v)" alt="" width="56" height="56" />
            </button>
          </div>
        </template>
      </div>
    </div>

    <p v-if="designing" class="ap-lbl">{{ W.which }}</p>
    <div v-if="designing" class="ap-seeds">
      <button
        v-for="(sd, i) in seeds" :key="sd" type="button"
        :class="{ on: !avatar && seed === sd }" :title="i === 0 ? W['seed-first'] : ''" @click="pickSeed(sd)">
        <img :src="avatarUrl(sd, { style, parts })" alt="" width="46" height="46" />
      </button>
    </div>
  </section>
</template>

<style scoped>
section.ap { display: grid; gap: 16px; margin: 0; padding: 0; border: 0 }
.ap-now { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 16px; align-items: center }
.ap-face { border-radius: 16px; display: block; background: color-mix(in srgb, var(--ink) 5%, transparent) }
.ap-nowtxt b { display: block; font-size: 14.5px; font-weight: 750; color: var(--ink) }
.ap-nowtxt p { margin: 3px 0 0; max-width: 46ch; font-size: 13px; line-height: 1.5; color: var(--ink3) }
.ap-nowacts { display: flex; gap: 12px; margin-top: 8px }

/* ONE PART AT A TIME. The square is 104px because the difference between two mouths is a few pixels
   across and at 40 nobody could see which one they were choosing. */
.ap-one { display: flex; align-items: center; gap: 10px; flex-wrap: wrap }
.ap-big { width: 104px; height: 104px; border-radius: 14px; display: block;
          background: color-mix(in srgb, var(--ink) 4%, transparent) }
.ap-step { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px;
           padding: 0; border: 1px solid var(--hair); border-radius: 50%; background: var(--paper);
           color: var(--ink2); cursor: pointer }
.ap-step:hover { border-color: color-mix(in srgb, var(--ink) 30%, transparent); color: var(--ink) }
.ap-arrow { width: 8px; height: 8px; border-top: 1.5px solid currentColor; border-right: 1.5px solid currentColor }
.ap-arrow.right { transform: rotate(45deg) translate(-1px, 1px) }
.ap-arrow.left { transform: rotate(-135deg) translate(-1px, 1px) }
.ap-reset { margin-left: 4px }
/* the fold's own chevron, drawn rather than typed, so the control has a size even with no label */
.ap-fold { display: inline-flex; align-items: center; gap: 6px; min-height: 22px }
.ap-chev { width: 7px; height: 7px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
           transform: rotate(45deg) translate(-2px, -2px); transition: transform .15s ease }
.ap-chev.up { transform: rotate(-135deg) translate(-2px, -2px) }
.ap-quiet { font: inherit; font-size: 13px; font-weight: 600; color: var(--ink2); background: none;
  border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px }
.ap-quiet:hover { color: var(--ink) }
.ap-file { display: none }

.ap-styles { display: flex; flex-wrap: wrap; gap: 8px }
.ap-styles button { display: flex; align-items: center; gap: 8px; font: inherit; font-size: 13px; font-weight: 600;
  color: var(--ink2); background: transparent; border: 1px solid var(--hair); border-radius: 11px;
  padding: 6px 12px 6px 6px; cursor: pointer }
.ap-styles button:hover { border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.ap-styles button.on { color: var(--ink); border-color: var(--ink) }
.ap-styles img { border-radius: 8px; display: block }

/* THE DESIGNER. A row per part, each a strip of the face as it would be — a choice you can see is
   worth more than a choice you have to read, and every one of these is a picture of the answer. */
.ap-design { display: grid; gap: 14px; padding: 16px; border: 1px solid var(--hair); border-radius: 14px;
  background: color-mix(in srgb, var(--ink) 2%, transparent) }
.ap-designhead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px }
.ap-designacts { display: flex; gap: 12px }
.ap-trait { display: grid; gap: 7px }
.ap-traitname { margin: 0; font-size: 12.5px; font-weight: 650; color: var(--ink2); text-transform: capitalize }
.ap-choices { display: flex; flex-wrap: wrap; gap: 6px }
.ap-choices button { padding: 2px; background: var(--paper); border: 2px solid transparent; border-radius: 10px;
  cursor: pointer; line-height: 0 }
.ap-choices button:hover { border-color: var(--hair) }
.ap-choices button.on { border-color: var(--ink) }
.ap-choices img { border-radius: 7px; display: block }
/* NONE reads as a choice and not as a missing thumbnail: the face without that part, under the
   word, so what it means is visible rather than inferred */
.ap-none { display: grid; justify-items: center; gap: 2px; padding: 2px 4px 3px }
.ap-none span { font-size: 9.5px; font-weight: 650; letter-spacing: .02em; color: var(--ink3); line-height: 1 }
.ap-none.on span { color: var(--ink) }
.ap-colour { display: flex; flex-wrap: wrap; align-items: center; gap: 8px }
.ap-swatch { width: 38px; height: 38px; border-radius: 999px; border: 2px solid transparent;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 14%, transparent); cursor: pointer; padding: 0 }
/*
 * ANY COLOUR AT ALL. The presets are a shortcut, not the offer: the last swatch opens the browser's
 * own colour picker, which is a real one on every platform and is the one somebody already knows.
 * It wears the colour they chose once they have chosen one, and the wheel until then — so what it
 * does is visible rather than something to be guessed from an icon.
 */
.ap-any { position: relative; width: 38px; height: 38px; border-radius: 999px; cursor: pointer;
  border: 2px solid transparent; display: inline-block; line-height: 0 }
.ap-any .ap-anyface { display: block; width: 100%; height: 100%; border-radius: 999px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 14%, transparent);
  background: conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444) }
.ap-any input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; padding: 0; border: 0 }
.ap-any:hover { border-color: var(--hair) }
.ap-any.on { border-color: var(--ink) }
.ap-swatch:hover { border-color: var(--hair) }
.ap-swatch.on { border-color: var(--ink) }

.ap-lbl { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--ink3) }
.ap-seeds { display: flex; flex-wrap: wrap; gap: 8px }
.ap-seeds button { padding: 3px; background: transparent; border: 2px solid transparent; border-radius: 12px; cursor: pointer; line-height: 0 }
.ap-seeds button:hover { border-color: var(--hair) }
.ap-seeds button.on { border-color: var(--ink) }
.ap-seeds img { border-radius: 10px; display: block }
</style>

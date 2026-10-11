<script setup>
/*
 * WRITING A POST — or an answer to one. The words, up to four pictures each with a line describing
 * it, and WHO CAN SEE IT, chosen before anything is sent: Everyone, People here, or the members of
 * one of the reader's spaces. An answer offers only what its parent allows (model.js
 * answerAudiences), and says why the choice is narrower when it is.
 *
 * The audience is a chip under the words naming who will see it — Everyone, People here, a space's
 * members — that opens a menu of the choices, each with its line saying what it means, the way every
 * social app asks. The chosen one is always named on the chip, so what a reader is about to say to
 * whom is in front of them as they say it.
 * Words from network.md (composer, audience).
 */
import { computed, ref, watch, onMounted, nextTick } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import site from '#site'
import { myFace, user } from '@platform-kit/kit/lib/auth.js'
import { net, publish, loadSpaces, loadPeople } from '@platform-kit/kit/lib/network/api.js'
import { answerAudiences, defaultAudience, MAX_TEXT, MEDIA, refuseMedia, kindOfType } from '@platform-kit/kit/lib/network/model.js'
import SpaceAvatar from '../spaces/SpaceAvatar.vue'

const props = defineProps({
  replyTo: { type: Object, default: null },
  autofocus: { type: Boolean, default: false },
})
const emit = defineEmits(['posted'])

const C = computed(() => us('network').composer.main)
const A = computed(() => us('network').audience.main)
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const FEDERATES = !!(site.network && site.network.federate)

const text = ref('')
const files = ref([])       /* { file, url, alt } */
const audience = ref(defaultAudience(props.replyTo))
const busy = ref(false)
const err = ref('')
const box = ref(null)
/* FOLDED TO ONE LINE until it is wanted: the face and "Write something…". A reply, or a composer
   opened in the post window, starts open. It folds back when it is left with nothing in it. */
const opened = ref(!!(props.replyTo || props.autofocus))
async function unfold() { opened.value = true; await nextTick(); box.value && box.value.focus() }
function maybeFold(e) {
  if (props.replyTo || props.autofocus) return
  const next = e.relatedTarget
  if (next && e.currentTarget.contains(next)) return
  if (!text.value.trim() && !files.value.length && !menu.value) opened.value = false
}
const picker = ref(null)

onMounted(async () => {
  if (!props.replyTo) loadSpaces().catch(() => {})
  if (user.value) loadPeople([user.value.id]).catch(() => {})
  if (props.autofocus) { await nextTick(); box.value && box.value.focus() }
})

/* every audience this post may have: the network's two, then a space each where it is not an answer */
const choices = computed(() => {
  const net2 = answerAudiences(props.replyTo).map((a) => ({ key: a, label: A.value[a], note: a === 'everyone' && FEDERATES ? A.value['everyone-federated'] : A.value[a + '-note'] }))
  if (props.replyTo) return net2
  return net2.concat((net.spaces || []).map((s) => ({ key: 'space:' + s.space_id, label: fill(A.value.space, { space: s.name }), note: A.value['space-note'] })))
})
const chosen = computed(() => choices.value.find((c) => c.key === audience.value) || choices.value[0])
const narrowed = computed(() => !!props.replyTo && choices.value.length < 2)

const left = computed(() => MAX_TEXT - text.value.length)
/* the ring that fills as the post nears its length */
const used = computed(() => Math.min(1, text.value.length / MAX_TEXT))
const RING = 2 * Math.PI * 9
/* the audience menu */
const menu = ref(false)
function closeMenu(e) { if (!e.target.closest || !e.target.closest('.nc-aud')) { menu.value = false; document.removeEventListener('click', closeMenu, true) } }
function openMenu() { if (narrowed.value) return; menu.value = !menu.value; if (menu.value) setTimeout(() => document.addEventListener('click', closeMenu, true)) }
function choose(k) { audience.value = k; menu.value = false }
const iconOf = (k) => (k === 'everyone' ? 'globe' : k === 'here' ? 'house' : 'space')
const canPost = computed(() => !busy.value && left.value >= 0 && (text.value.trim().length > 0 || files.value.length > 0))

/* the box grows with what is written, to a point */
function grow() { const el = box.value; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 360) + 'px' }

/* PICTURES AND VIDEOS: up to ten, refused by name before anything is sent (_shared/atproto/media.js) */
const ACCEPT = [...MEDIA.imageTypes, ...MEDIA.videoTypes].join(',')
function addPictures(e) {
  const list = [...(e.target.files || [])]
  e.target.value = ''
  const why = refuseMedia(list.map((f) => ({ type: f.type, size: f.size })), files.value.length)
  if (why) { err.value = C.value[why] || C.value.failed; return }
  err.value = ''
  for (const f of list) files.value.push({ file: f, url: URL.createObjectURL(f), alt: '', kind: kindOfType(f.type) })
}
function dropPicture(i) { URL.revokeObjectURL(files.value[i].url); files.value.splice(i, 1) }
function clearPictures() { for (const f of files.value) URL.revokeObjectURL(f.url); files.value = [] }

async function send() {
  if (!canPost.value) return
  busy.value = true; err.value = ''
  try {
    const out = await publish({
      text: text.value, audience: chosen.value.key,
      files: files.value.map((f) => f.file), alts: files.value.map((f) => f.alt),
      replyTo: props.replyTo ? props.replyTo.id : null,
    })
    text.value = ''; clearPictures(); await nextTick(); grow()
    emit('posted', out)
  } catch (e) { err.value = C.value.failed } finally { busy.value = false }
}
function onKey(e) { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send() } }
const me = computed(() => (user.value ? net.people[user.value.id] || myFace.value || null : null))
</script>

<template>
  <!-- FOLDED: one line, the way into it -->
  <div v-if="!opened" class="nc nc-folded">
    <button type="button" class="nc-line" @click="unfold">
      <SpaceAvatar class="nc-face" :person="me" :size="36" />
      <span>{{ C.write }}</span>
    </button>
  </div>
  <form v-else class="nc nc-open" :class="{ 'nc-reply': replyTo }" @submit.prevent="send" @focusout="maybeFold">
    <div class="nc-row">
      <SpaceAvatar class="nc-face" :person="me" :size="replyTo ? 32 : 40" />
      <div class="nc-main">
        <textarea ref="box" v-model="text" class="nc-text" rows="2" :maxlength="MAX_TEXT + 500"
          :placeholder="replyTo ? C['reply-placeholder'] : C.placeholder" :aria-label="replyTo ? C['reply-placeholder'] : C.placeholder"
          @input="grow" @keydown="onKey"></textarea>

        <ul v-if="files.length" class="nc-pics">
          <li v-for="(f, i) in files" :key="f.url">
            <video v-if="f.kind === 'video'" :src="f.url" muted playsinline preload="metadata" />
            <img v-else :src="f.url" alt="" />
            <span v-if="f.kind === 'video'" class="nc-vid" aria-hidden="true"><svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor"><path d="M6 4.5v11l9-5.5z" /></svg></span>
            <button type="button" class="nc-pic-x" :title="C['picture-remove']" :aria-label="C['picture-remove']" @click="dropPicture(i)">
              <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" /></svg>
            </button>
            <input v-model="f.alt" type="text" class="nc-alt" maxlength="1000" :placeholder="C.alt" :aria-label="C.alt" />
          </li>
        </ul>

        <div class="nc-aud">
          <button type="button" class="nc-aud-chip" :disabled="narrowed" :aria-expanded="menu" :aria-label="A.label" :title="narrowed ? A.narrowed : (chosen && chosen.note)" @click="openMenu">
            <svg v-if="iconOf(chosen && chosen.key) === 'globe'" viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="M2.5 10h15M10 2.5c2.2 2.3 2.2 12.7 0 15M10 2.5c-2.2 2.3-2.2 12.7 0 15" /></svg>
            <svg v-else-if="iconOf(chosen && chosen.key) === 'house'" viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3 9 10 3l7 6v7.5a.5.5 0 0 1-.5.5H12v-5H8v5H3.5a.5.5 0 0 1-.5-.5z" /></svg>
            <svg v-else viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7.5" r="2.5" /><circle cx="13.5" cy="8.5" r="2" /><path d="M2.5 16a4.5 4.5 0 0 1 9 0M11.5 16a3.5 3.5 0 0 1 6 0" stroke-linecap="round" /></svg>
            <span>{{ chosen && chosen.label }}</span>
            <svg v-if="!narrowed" viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>
          </button>
          <div v-if="menu" class="nc-aud-pop" role="menu">
            <p class="nc-aud-title">{{ A.label }}</p>
            <button v-for="c in choices" :key="c.key" type="button" role="menuitemradio" :aria-checked="chosen && chosen.key === c.key" class="nc-aud-opt" :class="{ on: chosen && chosen.key === c.key }" @click="choose(c.key)">
              <span class="nc-aud-ic" aria-hidden="true">
                <svg v-if="iconOf(c.key) === 'globe'" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="7.5" /><path d="M2.5 10h15M10 2.5c2.2 2.3 2.2 12.7 0 15M10 2.5c-2.2 2.3-2.2 12.7 0 15" /></svg>
                <svg v-else-if="iconOf(c.key) === 'house'" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 9 10 3l7 6v7.5a.5.5 0 0 1-.5.5H12v-5H8v5H3.5a.5.5 0 0 1-.5-.5z" /></svg>
                <svg v-else viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7.5" r="2.5" /><circle cx="13.5" cy="8.5" r="2" /><path d="M2.5 16a4.5 4.5 0 0 1 9 0M11.5 16a3.5 3.5 0 0 1 6 0" stroke-linecap="round" /></svg>
              </span>
              <span class="nc-aud-words"><b>{{ c.label }}</b><small>{{ c.note }}</small></span>
              <svg v-if="chosen && chosen.key === c.key" class="nc-aud-tick" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 10.5 3.5 3.5 7.5-8" /></svg>
            </button>
          </div>
        </div>

        <div class="nc-bar">
          <input ref="picker" type="file" :accept="ACCEPT" multiple hidden @change="addPictures" />
          <button type="button" class="nc-tool" :disabled="files.length >= MEDIA.max" :title="C.media" :aria-label="C.media" @click="picker && picker.click()">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4" width="15" height="12" rx="2" /><circle cx="7.5" cy="8.5" r="1.5" /><path d="m3 14.5 4-4 3 3 2.5-2.5 4.5 4.5" /></svg>
          </button>
          <span v-if="text.length" class="nc-ring" :class="{ bad: left < 0, near: left >= 0 && left < 100 }" :title="left < 0 ? fill(C['too-long'], { n: -left }) : fill(C.left, { n: left })">
            <svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="9" fill="none" stroke="var(--hair)" stroke-width="2" /><circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" stroke-width="2" :stroke-dasharray="RING" :stroke-dashoffset="RING * (1 - used)" transform="rotate(-90 11 11)" stroke-linecap="round" /></svg>
            <em v-if="left < 100">{{ left }}</em>
          </span>
          <em v-if="err" class="nc-err">{{ err }}</em>
          <button type="submit" class="nc-go" :disabled="!canPost">{{ busy ? C.posting : replyTo ? C.reply : C.post }}</button>
        </div>
      </div>
    </div>
  </form>
</template>

<style scoped>
.nc { padding: 16px 18px 12px; border-bottom: 1px solid var(--hair) }
.nc-folded { padding: 12px 16px }
.nc-line { display: flex; align-items: center; gap: 12px; width: 100%; padding: 6px 8px 6px 6px; border: 1px solid var(--hair); border-radius: 999px;
  background: color-mix(in srgb, var(--ink) 2.5%, var(--paper)); font: inherit; font-size: 15px; color: var(--ink3); text-align: left; cursor: text;
  transition: border-color .2s cubic-bezier(.2, .8, .2, 1), background .2s cubic-bezier(.2, .8, .2, 1) }
.nc-line:hover { border-color: color-mix(in srgb, var(--ink) 22%, transparent); background: var(--paper) }
.nc-line:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
.nc-open:not(.nc-reply) { animation: nc-open .3s cubic-bezier(.2, .8, .2, 1) }
@keyframes nc-open { from { opacity: .4; transform: translateY(-3px) } }
@media (prefers-reduced-motion: reduce) { .nc-open { animation: none } .nc-line { transition: none } }
.nc-reply { padding-top: 12px }
.nc-row { display: flex; gap: 10px; align-items: flex-start }
.nc-face { flex: none }
.nc-main { flex: 1 1 auto; min-width: 0 }
.nc-text { display: block; box-sizing: border-box; width: 100%; min-height: 52px; resize: none; border: 0; padding: 8px 0;
  background: transparent; font: inherit; font-size: 19px; line-height: 1.45; color: var(--ink) }
.nc-reply .nc-text { font-size: 15.5px; min-height: 40px }
.nc-text:focus { outline: none }
.nc-text::placeholder { color: var(--ink3) }

.nc-pics { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)) }
.nc-pics li { position: relative; display: flex; flex-direction: column; gap: 4px }
.nc-pics img, .nc-pics video { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 10px; border: 1px solid var(--hair); background: #000 }
.nc-vid { position: absolute; left: 6px; top: 6px; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 999px; color: #fff; background: rgba(0, 0, 0, .55) }
.nc-pic-x { position: absolute; top: 6px; right: 6px; display: grid; place-items: center; width: 24px; height: 24px; border: 0; border-radius: 999px;
  background: rgba(0, 0, 0, .62); color: #fff; cursor: pointer }
.nc-alt { box-sizing: border-box; width: 100%; font: inherit; font-size: 12px; padding: 5px 7px; border: 1px solid var(--hair); border-radius: 7px;
  background: color-mix(in srgb, var(--ink) 3%, var(--paper)); color: var(--ink) }

.nc-aud { position: relative; margin: 6px 0 2px }
.nc-aud-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 999px; background: transparent; font: inherit; font-size: 13.5px; font-weight: 700; color: var(--accent); cursor: pointer;
  transition: background .2s cubic-bezier(.2, .8, .2, 1) }
.nc-aud-chip:hover { background: color-mix(in srgb, var(--accent) 10%, transparent) }
.nc-aud-chip:disabled { cursor: default; color: var(--ink3); border-color: var(--hair); background: transparent }
.nc-aud-pop { position: absolute; left: 0; top: calc(100% + 6px); z-index: 30; width: min(340px, 86vw); padding: 6px; border: 1px solid var(--hair);
  border-radius: 16px; background: var(--paper); box-shadow: 0 18px 48px -14px rgba(0, 0, 0, .35); animation: nc-pop .18s cubic-bezier(.2, .8, .2, 1) }
@keyframes nc-pop { from { opacity: 0; transform: translateY(-4px) } }
.nc-aud-title { max-width: none; margin: 6px 10px 6px; font-size: 15px; font-weight: 800; color: var(--ink) }
.nc-aud-opt { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px; border: 0; border-radius: 12px; background: transparent; text-align: left; cursor: pointer; font: inherit; color: var(--ink) }
.nc-aud-opt:hover { background: color-mix(in srgb, var(--ink) 5%, transparent) }
.nc-aud-ic { flex: none; display: grid; place-items: center; width: 38px; height: 38px; border-radius: 999px; background: var(--accent); color: var(--paper) }
.nc-aud-words { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px }
.nc-aud-words b { font-size: 15px; font-weight: 700 }
.nc-aud-words small { font-size: 12.5px; line-height: 1.4; color: var(--ink3) }
.nc-aud-tick { flex: none; color: var(--accent) }
.nc-ring { display: inline-flex; align-items: center; gap: 6px; color: var(--accent); font-size: 12.5px; font-variant-numeric: tabular-nums }
.nc-ring em { font-style: normal; color: var(--ink3) }
.nc-ring.near { color: #e0a100 }
.nc-ring.bad, .nc-ring.bad em { color: #e0245e; font-weight: 700 }

.nc-bar { display: flex; align-items: center; gap: 10px; margin-top: 8px; padding-top: 10px; border-top: 1px solid var(--hair) }
.nc-tool { display: grid; place-items: center; width: 34px; height: 34px; border: 0; border-radius: 999px; background: transparent; color: var(--accent); cursor: pointer }
.nc-tool:hover { background: color-mix(in srgb, var(--accent) 12%, transparent) }
.nc-tool:disabled { color: var(--ink3); opacity: .5; cursor: default; background: transparent }
.nc-err { font-style: normal; font-size: 12.5px; color: #c8382f }
.nc-go { margin-left: auto; font: inherit; font-size: 15px; font-weight: 700; padding: 9px 20px; border: 0; border-radius: 999px;
  background: var(--accent); color: var(--paper); cursor: pointer }
.nc-go:not(:disabled):hover { filter: brightness(1.06) }
.nc-go:disabled { opacity: .4; cursor: default }
@media (prefers-reduced-motion: reduce) { .nc-aud-chip { transition: none } .nc-aud-pop { animation: none } }
</style>

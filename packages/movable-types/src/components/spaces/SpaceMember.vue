<script setup>
/*
 * A PERSON, IN A SPACE. Opened from the directory and from a name in a room, in the same column the
 * thread and the search use — so it joins their one-at-a-time rule rather than inventing a fourth.
 *
 * It has two halves and they are not the same kind of thing.
 *
 * The PUBLIC half is what the directory already says — who they are, what this space calls them,
 * when they arrived, how much they have said here — plus the line they wrote about themselves,
 * which is here because they put it there. Every member of the space sees it and nobody else does:
 * the read refuses unless the caller and the subject are both in the space.
 *
 * The PRIVATE half is what they have read, scored and bought, and it is shown to that person or to
 * a member of staff and to no peer — a member is shown nothing about somebody that the site does
 * not already show them elsewhere. The card does not decide that: the database answers `more` on
 * the card itself, and the panels are the SITE's (#site/member), each fetching its own data behind
 * the same rule. The kit has no idea what a business means by "read", so it draws what it is given
 * and nothing when it is given nothing.
 *
 * Reporting is NOT here: every report in this system is about something somebody said — the queue
 * shows the line and the act that answers it withdraws the line — so it stays on the message.
 *
 * Words from spaces.md (member).
 */
import { computed, ref, watch } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { memberCard, setAbout, hush, unhush, isHushed, flairsOf, giveFlair } from '@platform-kit/kit/lib/spaces/api.js'
import { panels } from '#site/member'
import SpaceAvatar from './SpaceAvatar.vue'
import SpaceIcon from './SpaceIcon.vue'
import SpaceFlair from './SpaceFlair.vue'

const props = defineProps({
  space: { type: Object, default: null },
  userId: { type: String, default: '' },
  me: { type: String, default: '' },
  here: { type: Object, default: () => ({}) },   /* the live presence the rail and directory already show */
})
const emit = defineEmits(['close', 'write'])
const M = computed(() => us('spaces').mute.main)
const muted = computed(() => !!card.value && isHushed('person', card.value.id))
async function toggleMute() {
  if (!card.value) return
  if (muted.value) await unhush('person', card.value.id)
  else await hush('person', card.value.id, null)
}
const W = computed(() => us('spaces').member.main)
const FW = computed(() => us('spaces').flair.main)

/* GIVING A BADGE. The list of badges is the space's declaration and is asked for only when
   somebody who can give one opens the panel — a member's card never fetches it. What they already
   wear is on the card, so the panel is a list with a tick, not a form. */
const giving = ref(false)
const badges = ref([])
const busyFlair = ref('')
const worn = computed(() => new Set(((card.value && card.value.flair) || []).map((x) => x.slug)))
async function openGiving() {
  giving.value = !giving.value
  if (giving.value && !badges.value.length) badges.value = (await flairsOf(props.space.id)) || []
}
async function toggleFlair(b) {
  if (!card.value) return
  busyFlair.value = b.slug
  try {
    const on = !worn.value.has(b.slug)
    await giveFlair(b.id, card.value.id, on)
    /* the card is the record of what they wear, so it is what gets updated */
    card.value.flair = on
      ? [...(card.value.flair || []), { slug: b.slug, name: b.name, colour: b.colour, icon: b.icon, note: b.note, inline: b.inline }]
      : (card.value.flair || []).filter((x) => x.slug !== b.slug)
  } finally { busyFlair.value = '' }
}

const card = ref(null)
const loading = ref(true)
const editing = ref(false)
const draft = ref('')
const saving = ref(false)

const mine = computed(() => !!props.userId && props.userId === props.me)
const said = computed(() => {
  const n = Number(card.value && card.value.said) || 0
  if (!n) return W.value['said-none']
  return n === 1 ? W.value['said-one'] : (W.value['said-many'] || '').replace('{n}', n)
})
const when = (v) => {
  const d = new Date(v)
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
/* A PANEL'S TITLE KNOWS WHOSE CARD IT IS. On your own card "What they have read" is about you, and
   a site cannot word that from a single string — so a title may be a word or a function given
   { mine }, and the panel's own component is told too, for the sentence it says when it has
   nothing to show. */
const titleOf = (p) => (typeof p.title === 'function' ? p.title({ mine: mine.value }) : p.title)
const left = computed(() => (W.value['about-left'] || '').replace('{n}', 280 - draft.value.length))

async function load() {
  loading.value = true
  editing.value = false
  try {
    card.value = props.space && props.userId ? await memberCard(props.space.id, props.userId) : null
  } catch (e) { card.value = null } finally { loading.value = false }
}
watch(() => [props.space && props.space.id, props.userId], load, { immediate: true })

function edit() { draft.value = (card.value && card.value.about) || ''; editing.value = true }
async function save() {
  saving.value = true
  try {
    await setAbout(draft.value)
    if (card.value) card.value.about = draft.value.trim() || null
    editing.value = false
  } finally { saving.value = false }
}
</script>

<template>
  <aside class="sn">
    <header class="sn-head">
      <h2>{{ W.title }}</h2>
      <button type="button" class="sn-x" :aria-label="W.close" @click="emit('close')">×</button>
    </header>

    <div v-if="!loading && !card" class="sn-body"><p class="su-quiet">{{ W.gone }}</p></div>

    <div v-else-if="card" class="sn-body">
      <div class="sn-who">
        <span class="sn-face">
          <SpaceAvatar :name="card.name" :person="card" :size="52" />
          <i class="sn-here" :class="'is-' + (here[card.id] || 'off')"></i>
        </span>
        <b>{{ card.name }}</b>
        <span v-if="(card.roles || []).length" class="sn-roles">
          <em
            v-for="r in card.roles" :key="r.slug"
            :style="r.colour ? { background: r.colour, color: '#fff' } : null">{{ r.name }}</em>
        </span>
        <!-- the badges this space gave them. A role says what somebody may DO here; a badge says
             something about them, and a card shows both because they answer different questions. -->
        <SpaceFlair v-if="(card.flair || []).length" class="sn-flair" :flair="card.flair" mode="full" :size="13" />
        <span class="sn-facts">
          <i v-if="card.since">{{ (W.since || '').replace('{when}', when(card.since)) }}</i>
          <i>{{ said }}</i>
        </span>
      </div>

      <!-- the line they wrote about themselves; their own to write, and only on their own card -->
      <div class="sn-about">
        <template v-if="editing">
          <textarea
            v-model="draft" rows="3" maxlength="280"
            :placeholder="W['about-placeholder']" :aria-label="W['about-placeholder']"></textarea>
          <span class="sn-row">
            <em>{{ left }}</em>
            <button type="button" class="sn-quiet" @click="editing = false">{{ W['about-cancel'] }}</button>
            <button type="button" class="sn-go" :disabled="saving" @click="save">{{ W['about-save'] }}</button>
          </span>
        </template>
        <template v-else>
          <p v-if="card.about">{{ card.about }}</p>
          <p v-else class="su-quiet">{{ mine ? W['about-none-own'] : W['about-none'] }}</p>
          <button v-if="mine" type="button" class="sn-quiet" @click="edit">
            {{ card.about ? W['about-edit'] : W['about-add'] }}
          </button>
        </template>
      </div>

      <div class="sn-acts">
        <button v-if="!mine" type="button" class="sn-go" @click="emit('write', card.id)">{{ W.write }}</button>
        <!-- MUTING SOMEBODY is the reader's own and hides nothing: this person's lines are still in
             every room, still read by opening it. What stops is their name arriving with a noise —
             a mention, a reply, a number on the direct message. It is here rather than in a
             moderation menu because it is not an act against them; it is a preference of the
             reader's, undone by pressing the same thing. -->
        <button v-if="!mine" type="button" class="sn-quiet" @click="toggleMute">
          {{ (muted ? M['unmute-person'] : M['mute-person'] || '').replace('{name}', card.name || '') }}
        </button>
      </div>
      <p v-if="!mine && muted" class="sn-note">{{ M['mute-person-line'] }}</p>

      <!-- and, for whoever keeps the space, what they may be given. The badges are the file's; who
           wears one is this act, which is why it is a press here and not a line in a markdown file. -->
      <div v-if="card.may_flair" class="sn-give">
        <button type="button" class="sn-quiet" @click="openGiving">{{ giving ? FW['give-close'] : FW.give }}</button>
        <ul v-if="giving" class="sn-badges">
          <li v-for="b in badges" :key="b.slug">
            <button type="button" :class="{ on: worn.has(b.slug) }" :disabled="busyFlair === b.slug" @click="toggleFlair(b)">
              <SpaceIcon :name="worn.has(b.slug) ? 'tick' : 'plus'" :size="13" />
              <span>
                <b :style="b.colour ? { color: b.colour } : null">{{ b.name }}</b>
                <i v-if="b.note">{{ b.note }}</i>
              </span>
            </button>
          </li>
          <li v-if="!badges.length" class="sn-nobadges">{{ FW.none }}</li>
        </ul>
      </div>

      <!-- THE SECOND HALF, and only for somebody the database says may see it. The panels are the
           site's own; each fetches what it shows behind the same rule, and a site that registered
           none leaves the card exactly as it is above. -->
      <template v-if="card.more && panels.length">
        <p class="sn-note"><SpaceIcon name="lock" :size="12" />{{ mine ? W['private-note-own'] : W['private-note'] }}</p>
        <section v-for="p in panels" :key="p.key" class="sn-panel">
          <h3>{{ titleOf(p) }}</h3>
          <component :is="p.component" :user="card.id" :mine="mine" />
        </section>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.sn-flair { margin-top: 8px }
.sn-give { margin-top: 4px }
.sn-badges { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 5px }
.sn-badges > li > button { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 9px; align-items: start;
  width: 100%; text-align: left; font: inherit; padding: 8px 10px; cursor: pointer;
  background: transparent; border: 1px solid var(--hair); border-radius: 9px; color: var(--ink3) }
.sn-badges > li > button:hover:not(:disabled) { border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.sn-badges > li > button.on { border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  background: color-mix(in srgb, var(--accent) 7%, transparent); color: var(--ink2) }
.sn-badges > li > button:disabled { opacity: .5; cursor: default }
.sn-badges b { display: block; font-size: 13px; font-weight: 700; color: var(--ink) }
.sn-badges i { display: block; margin-top: 1px; font-style: normal; font-size: 11.5px; line-height: 1.45; color: var(--ink3) }
.sn-nobadges { font-size: 12.5px; color: var(--ink3); padding: 6px 2px }
/* the site's global stylesheet styles bare elements; every class here says what it wants instead */
.sn { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; margin: 0; padding: 0;
  background: var(--paper); border: 0 }
.sn-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 12px 0 18px;
  height: 49px; border: 0; border-bottom: 1px solid var(--hair) }
.sn-head h2 { margin: 0; font-size: 15px; font-weight: 750; letter-spacing: -.01em; color: var(--ink) }
.sn-x { font: inherit; font-size: 19px; line-height: 1; color: var(--ink3); background: transparent;
  border: 0; padding: 2px 6px; cursor: pointer }
.sn-x:hover { color: var(--ink) }
.sn-body { overflow-y: auto; padding: 20px 18px 28px }
.sn-who { display: grid; justify-items: center; gap: 7px; text-align: center; margin-bottom: 18px }
.sn-face { position: relative; display: block; width: 52px; height: 52px }
/* here, away, not now: filled, hollow, a bar through it — never colour alone */
.sn-here { position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; border-radius: 50%;
  background: transparent; border: 3px solid var(--paper);
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--ink) 30%, transparent) }
.sn-here.is-active { background: #2bac76; box-shadow: none }
.sn-here.is-dnd { background: #d9a13d; box-shadow: none }
.sn-who b { font-family: var(--fd); font-size: 18px; font-weight: 750; letter-spacing: -.01em; color: var(--ink) }
.sn-roles { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px }
.sn-roles em { font-style: normal; font-size: 11px; font-weight: 700; color: var(--ink2);
  background: color-mix(in srgb, var(--ink) 7%, transparent); border-radius: 999px; padding: 2px 9px }
/* two facts side by side need something between them: without it they read as one sentence that
   does not parse — "Here since September 2026 Nothing said here yet" */
.sn-facts { display: flex; flex-wrap: wrap; justify-content: center; align-items: baseline; gap: 3px 8px }
.sn-facts i { font-style: normal; font-size: 12px; color: var(--ink3) }
.sn-facts i + i::before { content: "·"; margin-right: 8px; color: color-mix(in srgb, var(--ink) 25%, transparent) }
.sn-about { margin-bottom: 16px; padding: 13px 14px; background: var(--card);
  border: 1px solid var(--hair); border-radius: 12px }
.sn-about p { margin: 0; max-width: none; font-size: 13.5px; line-height: 1.6; color: var(--ink2) }
.sn-about textarea { width: 100%; box-sizing: border-box; font: inherit; font-size: 13.5px; line-height: 1.6;
  color: var(--ink); background: transparent; border: 0; resize: vertical }
.sn-about textarea:focus { outline: none }
.sn-row { display: flex; align-items: center; gap: 7px; margin-top: 8px }
.sn-row em { margin-right: auto; font-style: normal; font-family: var(--m); font-size: 10.5px; color: var(--ink3) }
.sn-acts { display: grid; gap: 7px; margin-bottom: 20px }
.sn-go { width: 100%; font: inherit; font-size: 13.5px; font-weight: 700; color: var(--paper);
  background: var(--ink); border: 0; border-radius: 9px; padding: 9px 14px; cursor: pointer }
.sn-go:disabled { opacity: .5; cursor: default }
.sn-quiet { width: auto; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink3);
  background: transparent; border: 1px solid var(--hair); border-radius: 999px; padding: 6px 12px; cursor: pointer }
.sn-quiet:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.sn-acts .sn-quiet { justify-self: center; border-color: transparent }
.sn-note { display: flex; align-items: center; gap: 6px; margin: 0 0 12px; max-width: none;
  font-size: 11.5px; color: var(--ink3); padding-top: 14px; border-top: 1px solid var(--hair) }
.sn-panel { margin: 0 0 18px; padding: 0; border: 0 }
.sn-panel h3 { margin: 0 0 7px; font-size: 10.5px; font-weight: 800; letter-spacing: .08em;
  text-transform: uppercase; color: var(--ink3) }
</style>

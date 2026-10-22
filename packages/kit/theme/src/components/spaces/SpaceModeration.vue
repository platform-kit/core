<script setup>
/*
 * The queue. A report is a row and not an email — a moderator sent an email for every report learns
 * to ignore them — so this is where they are answered, with a count in the rail beside it.
 *
 * Whoever the space granted `moderate` sees it. Three acts hang off a report and one hangs off
 * nothing: remove the message (withdrawn the way an author withdraws one, the placeholder staying,
 * because a hole in a conversation is worse than a mark), mute the author for a while, remove them
 * from the space (their words stay: removing a person is not rewriting the history of a room), or
 * simply mark it seen. Every one writes a record that nobody can edit afterwards, and the second
 * list here is that record.
 *
 * NOTHING IS MODERATED BY A MACHINE. There is no word list, no score and no automatic rule anywhere
 * in this module. A report reaches a person, and a person answers it.
 *
 * Words from spaces.md (## moderation).
 */
import { computed, ref, onMounted, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { reportsOf, recordOf, answerReport, removeMessage, mute, removeMember, asksOf, answerAsk } from 'platformkit/lib/spaces/api.js'
import SpaceAvatar from './SpaceAvatar.vue'
import SpaceIcon from './SpaceIcon.vue'

const props = defineProps({ space: { type: Object, default: null } })
const W = computed(() => us('spaces').moderation.main)
/* what a sealed room says about itself, where the words of a reported message would be */
const EN = computed(() => us('spaces').encryption)

/* the door belongs here and not in a rail entry of its own: somebody who keeps a room open is
   already the person who decides who comes into it, and two queues in two places is one too many.
   It shows only where the space actually has a door that waits — an open one has no queue. */
const VIEWS = ['open', 'door', 'record']
const view = ref('open')
const reports = ref([])
const record = ref([])
const asks = ref([])
const busy = ref('')
const err = ref('')
/* how long a mute lasts, in minutes: chosen from a few rather than typed */
const SPANS = [60, 60 * 24, 60 * 24 * 7]
/* a day by default: long enough to mean something, short enough that forgetting about it is not a
   punishment of its own */
const spanFor = ref({})
const spanOf = (id) => spanFor.value[id] || SPANS[1]

async function load() {
  if (!props.space) { reports.value = []; record.value = []; asks.value = []; return }
  err.value = ''
  try {
    reports.value = (await reportsOf(props.space.id)) || []
    record.value = (await recordOf(props.space.id)) || []
    asks.value = (await asksOf(props.space.id)) || []
  } catch (e) { err.value = e.message || String(e) }
}
onMounted(load)
watch(() => props.space && props.space.id, load)

async function act(r, what) {
  busy.value = r.id; err.value = ''
  try {
    if (what === 'seen') await answerReport(r.id)
    if (what === 'remove') await removeMessage(props.space.id, r.message, r.reason)
    if (what === 'mute') await mute(props.space.id, r.about_id, spanOf(r.id), r.reason)
    if (what === 'out') await removeMember(props.space.id, r.about_id, r.reason)
    await load()
  } catch (e) { err.value = e.message || String(e) } finally { busy.value = '' }
}
/* letting somebody in, or not. Either way the row is answered and stamped with who did it. */
async function answer(a, yes) {
  busy.value = a.id; err.value = ''
  try { await answerAsk(a.id, yes); await load() } catch (e) { err.value = e.message || String(e) } finally { busy.value = '' }
}
const when = (iso) => new Date(iso).toLocaleString()
const spanWord = (m) => (W.value['span-' + m] || String(m))
</script>

<template>
  <section v-if="space" class="sm">
    <header class="sm-head">
      <div>
        <h2>{{ W.title }}</h2>
        <p>{{ (view === 'door' ? W['line-door'] : W.line) }}</p>
      </div>
      <nav class="sm-seg">
        <button v-for="v in VIEWS" :key="v" type="button" :class="{ on: view === v }" @click="view = v">
          {{ W['view-' + v] }}<em v-if="v === 'open' && reports.length">{{ reports.length }}</em><em v-if="v === 'door' && asks.length">{{ asks.length }}</em>
        </button>
      </nav>
    </header>

    <p v-if="err" class="sm-err">{{ err }}</p>

    <template v-if="view === 'open'">
      <ul v-if="reports.length" class="sm-list">
        <li v-for="r in reports" :key="r.id">
          <div class="sm-what">
            <span class="sm-meta">
              <SpaceIcon name="flag" :size="13" />
              <b>{{ W['reason-' + r.reason] || r.reason }}</b>
              <i>{{ (W.reported || '').replace('{by}', r.by).replace('{room}', r.room || '') }}</i>
              <u>{{ when(r.created_at) }}</u>
            </span>
            <blockquote v-if="r.body" class="sm-body">
              <SpaceAvatar :name="r.about" :size="22" /><span><b>{{ r.about }}</b>{{ r.body }}</span>
            </blockquote>
            <!--
              THREE DIFFERENT REASONS THERE ARE NO WORDS, and the desk has to tell them apart.
              Withdrawn: somebody took it back. Sealed: nobody on this side can read it and never
              could, which is a fact about the room and not a fault — said as a sentence so a
              moderator knows to ask the person who reported it. Otherwise: simply gone.
              Every action below still works either way: they act on a person, not on a message.
            -->
            <p v-else-if="r.sealed" class="sm-gone sm-sealed">{{ EN.refused['report-words'] }}</p>
            <p v-else class="sm-gone">{{ r.withdrawn ? W.withdrawn : W['no-body'] }}</p>
            <p v-if="r.note" class="sm-note">{{ r.note }}</p>
          </div>
          <div class="sm-acts">
            <button type="button" :disabled="busy === r.id" @click="act(r, 'seen')">{{ W.seen }}</button>
            <button v-if="!r.withdrawn" type="button" :disabled="busy === r.id" @click="act(r, 'remove')">{{ W.remove }}</button>
            <span class="sm-mute">
              <select :value="spanOf(r.id)" :aria-label="W.mute" @change="spanFor[r.id] = Number($event.target.value)">
                <option v-for="m in SPANS" :key="m" :value="m">{{ spanWord(m) }}</option>
              </select>
              <button type="button" :disabled="busy === r.id" @click="act(r, 'mute')">{{ W.mute }}</button>
            </span>
            <button type="button" class="sm-out" :disabled="busy === r.id" @click="act(r, 'out')">{{ W.out }}</button>
          </div>
        </li>
      </ul>
      <div v-else class="su-none">
        <h3>{{ W['none-open'] }}</h3>
        <p>{{ W['none-open-line'] }}</p>
      </div>
    </template>

    <template v-else-if="view === 'door'">
      <ul v-if="asks.length" class="sm-list">
        <li v-for="a in asks" :key="a.id">
          <div class="sm-what">
            <span class="sm-meta">
              <SpaceAvatar :name="a.name || a.email || ''" :size="22" />
              <b>{{ a.name || a.email }}</b>
              <u>{{ when(a.created_at) }}</u>
              <i v-if="a.agreed_at">{{ W.agreed }}</i>
            </span>
            <p v-if="a.note" class="sm-note">{{ a.note }}</p>
          </div>
          <div class="sm-acts">
            <button type="button" :disabled="busy === a.id" @click="answer(a, true)">{{ W['let-in'] }}</button>
            <button type="button" class="sm-out" :disabled="busy === a.id" @click="answer(a, false)">{{ W['not-now'] }}</button>
          </div>
        </li>
      </ul>
      <div v-else class="su-none">
        <h3>{{ W['none-door'] }}</h3>
        <p>{{ W['none-door-line'] }}</p>
      </div>
    </template>

    <template v-else>
      <ul v-if="record.length" class="sm-record">
        <li v-for="m in record" :key="m.id">
          <SpaceIcon :name="m.kind === 'mute' ? 'lock' : m.kind === 'remove-member' ? 'people' : 'close'" :size="14" />
          <span>
            <b>{{ (W['did-' + m.kind] || m.kind).replace('{by}', m.by || '').replace('{about}', m.about || '') }}</b>
            <i v-if="m.reason">{{ W['reason-' + m.reason] || m.reason }}</i>
            <u>{{ when(m.created_at) }}<template v-if="m.until"> · {{ (W.until || '').replace('{when}', when(m.until)) }}</template></u>
          </span>
        </li>
      </ul>
      <div v-else class="su-none">
        <h3>{{ W['none-record'] }}</h3>
        <p>{{ W['none-record-line'] }}</p>
      </div>
      <p class="sm-fine">{{ W.kept }}</p>
    </template>
  </section>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; every class here says what it wants instead */
/* section.sm, not .sm: the page gives this element its own class too (sp-plain), and a
   parent's scoped style is injected after a child's — so a tie goes to the page, and this surface
   would lose both its padding and its scrolling to it. */
section.sm { box-sizing: border-box; min-width: 0; overflow-y: auto; margin: 0; padding: 26px 28px 40px; border: 0 }
/* one measure for everything on the page: heading, controls, lists and cards all start and end
   together. A control that belongs to a heading stays beside it rather than at the pane's edge. */
section.sm > * { max-width: var(--sp-measure, 860px) }
section.sm > .su-none { max-width: 620px }
.sm-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; flex-wrap: wrap;
  margin: 0 0 18px; padding: 0; border: 0 }
.sm-head h2 { margin: 0 0 5px; font-size: 22px; font-weight: 800; letter-spacing: -.02em; color: var(--ink) }
.sm-head p { margin: 0; max-width: 62ch; font-size: 13.5px; color: var(--ink3) }
.sm-seg { display: flex; gap: 2px; padding: 3px; background: color-mix(in srgb, var(--ink) 6%, transparent); border-radius: 9px }
.sm-seg button { display: flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; font-weight: 600;
  color: var(--ink2); background: transparent; border: 0; border-radius: 7px; padding: 5px 12px; cursor: pointer }
.sm-seg button.on { color: var(--ink); background: var(--paper); box-shadow: 0 1px 2px color-mix(in srgb, var(--ink) 12%, transparent) }
.sm-seg em { font-style: normal; font-size: 11px; font-weight: 800; color: #fff; background: var(--sp-badge, #c8382f);
  border-radius: 999px; padding: 0 6px }
.sm-err { margin: 0 0 12px; max-width: 62ch; font-size: 13.5px; color: #c8382f }
.sm-none { margin: 0; font-size: 13.5px; color: var(--ink3) }
.sm-fine { margin: 14px 0 0; max-width: 62ch; font-size: 12px; color: var(--ink3) }

.sm-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 11px; max-width: 760px }
.sm-list li { padding: 14px 16px; background: var(--paper); border: 1px solid var(--hair); border-radius: 12px }
.sm-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; color: var(--ink3) }
.sm-meta b { font-size: 12.5px; font-weight: 800; color: var(--ink2) }
.sm-meta i, .sm-meta u { font-style: normal; text-decoration: none }
.sm-body { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 9px; align-items: start;
  margin: 10px 0 0; padding: 10px 12px; font-size: 13.5px; line-height: 1.5; color: var(--ink);
  background: color-mix(in srgb, var(--ink) 4%, transparent); border: 0; border-radius: 9px }
.sm-body b { display: block; font-size: 12.5px; font-weight: 700; color: var(--ink2) }
.sm-gone, .sm-note { margin: 9px 0 0; max-width: none; font-size: 13px; color: var(--ink3) }
/* a sealed room's line stands where the quote would, so the eye finds it in the same place it was
   going to read the words — a rule down the side as a quote has, and no alarm colour: this is a
   fact about the room and not a thing that went wrong */
.sm-sealed { padding-left: 11px; border-left: 2px solid var(--hair); line-height: 1.5; max-width: 72ch }
.sm-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 12px }
.sm-acts button, .sm-mute select { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink2);
  background: transparent; border: 1px solid var(--hair); border-radius: 7px; padding: 4px 10px; cursor: pointer }
.sm-acts button:hover:not(:disabled) { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.sm-acts button:disabled { opacity: .45; cursor: default }
.sm-out:hover:not(:disabled) { color: #c8382f !important; border-color: color-mix(in srgb, #c8382f 45%, transparent) !important }
.sm-mute { display: flex; gap: 4px }

.sm-record { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; max-width: 760px }
.sm-record li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: start;
  padding: 10px 12px; color: var(--ink3); background: var(--paper); border: 1px solid var(--hair); border-radius: 10px }
.sm-record b { display: block; font-size: 13.5px; font-weight: 600; color: var(--ink) }
.sm-record i, .sm-record u { display: inline; font-style: normal; text-decoration: none; font-size: 12px; color: var(--ink3) }
.sm-record i { margin-right: 8px }

@media (max-width: 900px) { section.sm { padding: 18px 16px 32px } }
</style>

<script setup>
/*
 * The space's column: the one space being read, and nothing else. Its name at the head with what
 * kind of place it is, then where to go in it that is not a room (its home, its people, its queue,
 * the drafts somebody left), a box to find a room by typing part of it, and then the rooms — under
 * the headings the space's own file declares, then Starred, Channels and Direct messages.
 *
 * It exists only inside a space. On one of the person's own views — the Desk, Threads, Activity,
 * Later, the way in — there is no space open, so this column is not drawn at all and that view takes
 * the width. The column beside it (SpaceBar) never goes away, so the way back is always in the same
 * place.
 *
 * A room is bold while it has unread messages and carries a badge only for what is owed. A direct
 * message has no name of its own: it is who is in it. Words from spaces.md (rail, chrome).
 */
import { computed, ref } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { unreadOf, mentionsOf, mutedNow, dmTitle, railSections, draftCount } from 'platformkit/lib/spaces/model.js'
import SpaceIcon from './SpaceIcon.vue'
import SpaceAvatar from './SpaceAvatar.vue'

const props = defineProps({
  events: { type: Boolean, default: false },   /* this space has something on */
  space: { type: Object, default: null },
  channels: { type: Array, default: () => [] },
  unread: { type: Array, default: () => [] },
  members: { type: Object, default: () => ({}) },   /* channel id → [user id] */
  names: { type: Object, default: () => ({}) },
  here: { type: Object, default: () => ({}) },
  me: { type: String, default: '' },
  drafts: { type: Object, default: () => ({}) },
  activeId: { type: String, default: null },
  view: { type: String, default: 'channel' },
  moderating: { type: Boolean, default: false },  /* the space granted them keeping it; a staff room grants nobody */
  reports: { type: Number, default: 0 },
})
const emit = defineEmits(['open', 'join', 'view', 'compose', 'browse', 'find'])
const W = computed(() => us('spaces').rail.main)
const C = computed(() => us('spaces').chrome.main)
/* the words a sealed room is marked with, from the `## encryption` group like every other */
const EN = computed(() => us('spaces').encryption)
const filter = ref('')
const shut = ref({})

const rowOf = (id) => props.unread.find((r) => r.channel === id) || null
const joined = (id) => !!rowOf(id)
const titleOf = (c) => (c.kind === 'dm' ? dmTitle(props.members[c.id] || [], props.names, props.me, { self: W.value.self, more: W.value.more, someone: W.value.someone }) : c.name)
const sections = computed(() => railSections(props.channels, props.unread, props.space ? props.space.id : null, (props.space && props.space.groups) || []))
/* The rail's runs, in the order they are drawn: the headings the space's own file declares (each
   with the rooms that name it), then what this person starred, then whatever sits under no heading,
   then the direct messages. A space that declares no heading has exactly the rail it always had. */
const runs = computed(() => [
  ...sections.value.groups.map((g) => ({ key: 'group:' + g.name, label: g.name, list: g.channels })),
  { key: 'starred', label: W.value['section-starred'], list: sections.value.starred },
  { key: 'channels', label: W.value['section-channels'], list: sections.value.channels },
  { key: 'dms', label: W.value['section-direct'], list: sections.value.dms },
])
const shown = (list) => {
  const q = filter.value.trim().toLowerCase()
  return q ? list.filter((c) => titleOf(c).toLowerCase().includes(q)) : list
}
const nothing = computed(() => filter.value.trim() && runs.value.every((r) => !shown(r.list).length))
const drafting = computed(() => draftCount(props.drafts))
/* a community or a server has a home and a directory; a staff space has neither */
const community = computed(() => !!props.space && props.space.kind !== 'staff')
/* the places in this space that are not rooms, in one list so they read as one run */
const PLACES = computed(() => [
  ...(community.value ? [{ key: 'home', icon: 'home', word: W.value.home }] : []),
  ...(community.value ? [{ key: 'people', icon: 'people', word: W.value.directory }] : []),
  /* what is on, where there is anything on. A space that runs nothing does not carry an empty
     calendar in its nav; one that does gets the canonical place for it, under the people. */
  ...(community.value && props.events ? [{ key: 'events', icon: 'calendar', word: W.value.events }] : []),
  ...(props.moderating ? [{ key: 'keeping', icon: 'shield', word: W.value.keeping, count: props.reports }] : []),
  ...(drafting.value ? [{ key: 'drafts', icon: 'pencil', word: W.value.drafts, quiet: drafting.value }] : []),
])
function badge(id) {
  const row = rowOf(id)
  if (!row) return null
  const m = mentionsOf(row), u = unreadOf(row)
  if (m) return { text: String(m), mention: true }
  if (!u || row.notify === 'none' || mutedNow(row)) return null
  return { text: '', mention: false }
}
/* a direct message with one other person shows whether they are here */
const soloPeer = (c) => {
  const ids = (props.members[c.id] || []).filter((id) => id !== props.me)
  return ids.length === 1 ? ids[0] : null
}
</script>

<template>
  <nav class="sr" :aria-label="space ? space.name : C.spaces">
    <!-- THE SPACE'S NAME, set as the head of its own column. It was one row among fifteen once. -->
    <header class="sr-head">
      <span class="sr-who">
        <h2>{{ space ? space.name : '' }}</h2>
        <small v-if="space">{{ W['kind-' + space.kind] }}</small>
      </span>
      <span class="sr-acts">
        <button type="button" class="sr-ico" :title="C.search" :aria-label="C.search" @click="emit('find')">
          <SpaceIcon name="search" :size="15" />
        </button>
        <button type="button" class="sr-compose" :title="W['new-dm']" :aria-label="W['new-dm']" @click="emit('compose')">
          <SpaceIcon name="pencil" :size="15" />
        </button>
      </span>
    </header>

    <div class="sr-body">
      <label class="sr-filter">
        <SpaceIcon name="search" :size="14" />
        <input v-model="filter" type="search" :placeholder="W.find" :aria-label="W.find" />
      </label>

      <ul v-if="PLACES.length" class="sr-places">
        <li v-for="p in PLACES" :key="p.key">
          <button type="button" class="sr-row" :class="{ on: view === p.key }" @click="emit('view', p.key)">
            <SpaceIcon :name="p.icon" :size="15" /><span class="sr-label">{{ p.word }}</span>
            <em v-if="p.count" class="sr-badge">{{ p.count }}</em>
            <em v-else-if="p.quiet" class="sr-count">{{ p.quiet }}</em>
          </button>
        </li>
      </ul>

      <template v-for="run in runs" :key="run.key">
        <div v-if="shown(run.list).length" class="sr-group">
          <button type="button" class="sr-section" :aria-expanded="!shut[run.key]" @click="shut[run.key] = !shut[run.key]">
            <SpaceIcon name="chev" :size="12" :class="{ shut: shut[run.key] }" />
            {{ run.label }}
          </button>
          <ul v-show="!shut[run.key]" class="sr-list">
            <li v-for="c in shown(run.list)" :key="c.id">
              <button
                type="button" class="sr-row"
                :class="{ on: c.id === activeId && view === 'channel', bold: badge(c.id) && c.id !== activeId, quiet: !joined(c.id) }"
                @click="joined(c.id) ? emit('open', c.id) : emit('join', c.id)">
                <template v-if="c.kind === 'dm'">
                  <span class="sr-face">
                    <SpaceAvatar :name="titleOf(c)" :size="20" />
                    <i v-if="soloPeer(c)" class="sr-here" :class="'is-' + (here[soloPeer(c)] || 'off')"></i>
                  </span>
                </template>
                <!-- A LOCK SAYS SOMETHING; A HASH SAYS NOTHING. Every open room in the list wore one, so
                     it told a reader only that a channel is a channel — which the list already said. The
                     slot stays, empty, so a locked row and an open row still line their names up. -->
                <SpaceIcon v-else-if="c.visibility === 'private'" name="lock" :size="14" />
                <i v-else class="sr-gap" aria-hidden="true"></i>
                <span class="sr-label">{{ titleOf(c) }}</span>
                <!-- SEALED IS NOT THE SAME AS PRIVATE, so it is not the same glyph in the same
                     slot. Private says who may come in; sealed says what the site can read, and a
                     room is often both. The shield sits AFTER the name, where a reader reads it as
                     a fact about the room rather than as its kind. -->
                <span v-if="c.encrypted" class="sr-sealed" role="img" :title="EN.room.sealed" :aria-label="EN.room.sealed">
                  <SpaceIcon name="shield" :size="12" />
                </span>
                <em v-if="badge(c.id) && badge(c.id).mention" class="sr-badge">{{ badge(c.id).text }}</em>
              </button>
            </li>
          </ul>
        </div>
      </template>

      <p v-if="nothing" class="sr-empty">{{ W['find-none'] }}</p>

      <button type="button" class="sr-add" @click="emit('browse')">
        <SpaceIcon name="plus" :size="14" />{{ W.browse }}
      </button>
    </div>
  </nav>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; these say what they want instead */
.sr { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; grid-template-rows: auto minmax(0, 1fr); height: 100%; min-height: 0;
  background: var(--sp-side); color: var(--sp-side-ink) }
.sr-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 8px 0 15px;
  height: 49px; border: 0; border-bottom: 1px solid color-mix(in srgb, #fff 10%, transparent) }
.sr-who { min-width: 0 }
.sr-head h2 { margin: 0; font-weight: 800; font-size: 16.5px; letter-spacing: -.01em; line-height: 1.2; color: #fff;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sr-who small { display: block; font-size: 10.5px; letter-spacing: .03em;
  color: color-mix(in srgb, var(--sp-side-ink) 55%, transparent) }
.sr-acts { display: flex; align-items: center; gap: 3px; flex: none }
.sr-ico { display: grid; place-items: center; width: 28px; height: 28px; cursor: pointer;
  color: color-mix(in srgb, var(--sp-side-ink) 85%, transparent); background: transparent; border: 0; border-radius: 50% }
.sr-ico:hover { color: #fff; background: color-mix(in srgb, #fff 12%, transparent) }
.sr-compose { display: grid; place-items: center; width: 28px; height: 28px; flex: none; color: var(--sp-side);
  background: #fff; border: 0; border-radius: 50%; cursor: pointer }
.sr-body { overflow-y: auto; padding: 10px 0 18px }
.sr-places { list-style: none; margin: 0 0 10px; padding: 0 8px }
.sr-gap { display: block; width: 14px; height: 14px }
.sr-filter { display: flex; align-items: center; gap: 6px; margin: 0 8px 12px; padding: 5px 9px;
  border: 1px solid color-mix(in srgb, #fff 16%, transparent); border-radius: 7px;
  color: color-mix(in srgb, var(--sp-side-ink) 70%, transparent) }
.sr-filter input { flex: 1; min-width: 0; font: inherit; font-size: 13px; color: #fff; background: transparent; border: 0 }
.sr-filter input:focus { outline: none }
.sr-filter input::placeholder { color: color-mix(in srgb, var(--sp-side-ink) 55%, transparent) }
.sr-group { margin-bottom: 10px }
/* a heading is smaller and quieter than the rooms under it, so the rooms are what the eye lands on */
.sr-section { display: flex; align-items: center; gap: 5px; width: calc(100% - 16px); margin: 0 8px 2px;
  font: inherit; font-size: 10.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase;
  color: color-mix(in srgb, var(--sp-side-ink) 52%, transparent);
  background: transparent; border: 0; border-radius: 6px; padding: 4px 8px; cursor: pointer; text-align: left }
.sr-section:hover { color: color-mix(in srgb, var(--sp-side-ink) 85%, transparent) }
.sr-section .si { transition: transform .16s var(--sp-ease, ease) }
.sr-section .si.shut { transform: rotate(-90deg) }
.sr-list { list-style: none; margin: 0; padding: 0 8px }
.sr-row { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 8px; width: 100%;
  font: inherit; font-size: 14.5px; line-height: 1.35; color: color-mix(in srgb, var(--sp-side-ink) 82%, transparent);
  background: transparent; border: 0; border-radius: 7px; padding: 5px 9px; cursor: pointer; text-align: left;
  transition: background .12s ease, color .12s ease }
.sr-row:hover { color: #fff; background: color-mix(in srgb, #fff 8%, transparent) }
.sr-row.on { color: #fff; background: var(--sp-side-on) }
.sr-row.bold { color: #fff; font-weight: 800 }
.sr-row.quiet { color: color-mix(in srgb, var(--sp-side-ink) 52%, transparent) }
.sr-row .si { opacity: .75 }
.sr-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
/* the seal, after the name: quieter than the name and never shrunk away by it, so a long room
   name truncates and the mark stays */
.sr-sealed { display: flex; align-items: center; flex: none; margin-left: 5px; opacity: .7 }
.sr-face { position: relative; display: block; width: 20px; height: 20px }
/* here, away, not now: filled, hollow, and a bar through it — never colour alone */
.sr-here { position: absolute; right: -2px; bottom: -2px; width: 9px; height: 9px; border-radius: 50%;
  background: transparent; border: 2px solid var(--sp-side); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--sp-side-ink) 45%, transparent);
  transition: background .18s var(--sp-ease, ease), box-shadow .18s var(--sp-ease, ease) }
.sr-here.is-active { background: #2bac76; box-shadow: none }
.sr-here.is-dnd { background: #d9a13d; box-shadow: none }
.sr-badge { min-width: 18px; height: 18px; display: grid; place-items: center; font-style: normal;
  font-size: 11px; font-weight: 800; color: #fff; background: var(--sp-badge); border-radius: 999px; padding: 0 5px }
.sr-count { font-style: normal; font-size: 11px; font-weight: 700; opacity: .7 }
.sr-add { display: flex; align-items: center; gap: 8px; width: calc(100% - 16px); margin: 4px 8px 0;
  font: inherit; font-size: 13.5px; color: color-mix(in srgb, var(--sp-side-ink) 65%, transparent);
  background: transparent; border: 0; border-radius: 7px; padding: 6px 9px; cursor: pointer; text-align: left }
.sr-add:hover { color: #fff; background: color-mix(in srgb, #fff 8%, transparent) }
.sr-empty { margin: 10px 14px; max-width: none; font-size: 13px; color: color-mix(in srgb, var(--sp-side-ink) 60%, transparent) }
</style>

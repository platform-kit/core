<script setup>
/*
 * DIRECT MESSAGES — the place, not a section of one space's rail.
 *
 * A direct message belongs to a space, but a person does not think of it that way: they think of
 * who they are talking to. So this lists every direct message they are in, across every space they
 * are in, newest first, the way an inbox does — who it is with, the last line, when, and whether
 * anything in it is unread. The space is said quietly beside the name, because the same two people
 * may talk in two communities and the rooms are not the same room.
 *
 * The rows come from `space_dms()` whole, names included: the names a page holds belong to the
 * space it has open, so a DM in another space would otherwise be addressed to "someone".
 * Words from spaces.md (dms). Every class is `sd-` prefixed: the site's own stylesheet owns the
 * short bare names.
 */
import { computed, ref } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { plainBody } from 'platformkit/lib/spaces/model.js'
import SpaceAvatar from './SpaceAvatar.vue'
import SpaceIcon from './SpaceIcon.vue'

const props = defineProps({
  rows: { type: Array, default: () => [] },     /* space_dms() */
  me: { type: String, default: '' },
  spaces: { type: Array, default: () => [] },   /* to say which community a row is in */
  /* a member's coaching conversation, pinned above every other (the social layout keeps it here
     rather than as a place of its own): its unread, or null where there is none to pin */
  pinned: { type: Object, default: null },        /* { unread, chat, host } — chat false: sessions alone; host: a coach's own sessions */
})
const emit = defineEmits(['open', 'compose', 'pinned'])
const D = computed(() => us('spaces').dms.main)
const R = computed(() => us('spaces').rail.main)

const q = ref('')
/* a direct message has no name of its own: it is who is in it */
const titleOf = (row) => {
  const said = (row.people || []).map((p) => p.name).filter(Boolean)
  if (!said.length) return R.value.self
  if (said.length <= 3) return said.join(', ')
  return said.slice(0, 2).join(', ') + ' ' + (R.value.more || '+{n}').replace('{n}', said.length - 2)
}
const nameOf = (row, id) => (id === props.me ? D.value.you : ((row.people || []).find((p) => p.id === id) || {}).name || R.value.someone)
/* The last line. Whose it is, is said only where it is not already obvious: between two people the
   name is on the row above, so their own line stands bare and only the reader's own is marked
   "You"; in a conversation between three or more, every line is named. A voice note or a file has
   no words, so it is named instead of quoted. */
const lineOf = (row) => {
  const l = row.last
  if (!l) return D.value['nothing-said']
  const body = l.kind === 'voice' ? D.value.voice : l.kind === 'file' ? D.value.file : plainBody(l.body, {})
  const mine = l.author === props.me
  const many = (row.people || []).length > 1
  if (!mine && !many) return body
  return (D.value.line || '{who}: {what}').replace('{who}', nameOf(row, l.author)).replace('{what}', body)
}
const when = (v) => {
  const d = new Date(v)
  if (isNaN(d)) return ''
  const mins = Math.max(1, Math.round((Date.now() - d.getTime()) / 60000))
  if (mins < 60) return mins + 'm'
  const hrs = Math.round(mins / 60)
  return hrs < 24 ? hrs + 'h' : Math.round(hrs / 24) + 'd'
}
const spaceName = (row) => row.space_name || ((props.spaces || []).find((s) => s.id === row.space) || {}).name || ''
const shown = computed(() => {
  const t = q.value.trim().toLowerCase()
  if (!t) return props.rows
  return props.rows.filter((r) => (titleOf(r) + ' ' + lineOf(r)).toLowerCase().includes(t))
})
const unread = computed(() => props.rows.filter((r) => r.unread > 0).length)
</script>

<template>
  <section class="sd">
    <header class="sd-head">
      <div class="sd-headin">
        <h2>{{ D.title }}</h2>
        <span v-if="unread" class="sd-quiet">{{ unread === 1 ? D['unread-one'] : (D['unread-many'] || '').replace('{n}', unread) }}</span>
      </div>
      <div class="sd-tools">
        <input v-model="q" type="search" class="sd-find" :placeholder="D.find" :aria-label="D.find">
        <button type="button" class="sd-new" @click="emit('compose')">
          <SpaceIcon name="pencil" :size="14" />{{ D.new }}
        </button>
      </div>
    </header>

    <div class="sd-body">
      <!-- Empty is the ordinary state for somebody's first weeks here, so it says what would put
           something in it rather than reading as a fault. -->
      <!-- THE COACH, pinned above every conversation -->
      <ul v-if="pinned" class="sd-list sd-pinned">
        <li>
          <button type="button" class="sd-row" :class="{ unread: pinned.unread > 0 }" @click="emit('pinned')">
            <span class="sd-pin-ic" aria-hidden="true"><SpaceIcon name="head" :size="18" /></span>
            <span class="sd-mid">
              <span class="sd-top"><b>{{ R.coaching }}</b></span>
              <span class="sd-low"><span class="sd-line">{{ pinned.host ? D[pinned.chat === false ? 'pinned-host' : 'pinned-host-chat'] : pinned.chat === false ? D['pinned-sessions'] : D.pinned }}</span></span>
            </span>
            <em v-if="pinned.unread > 0" class="sd-badge">{{ pinned.unread }}</em>
          </button>
        </li>
      </ul>
      <div v-if="!rows.length && !pinned" class="su-none">
        <h3>{{ D.empty }}</h3>
        <p>{{ D['empty-line'] }}</p>
        <button type="button" class="sd-new sd-new-big" @click="emit('compose')">
          <SpaceIcon name="pencil" :size="14" />{{ D.new }}
        </button>
      </div>
      <div v-else-if="rows.length && !shown.length" class="su-none">
        <h3>{{ D['none-found'] }}</h3>
      </div>

      <ul v-else-if="shown.length" class="sd-list">
        <li v-for="r in shown" :key="r.channel">
          <button type="button" class="sd-row" :class="{ unread: r.unread > 0 }" @click="emit('open', r)">
            <SpaceAvatar :name="(r.people && r.people[0] && r.people[0].name) || ''" :size="38" />
            <span class="sd-mid">
              <span class="sd-top">
                <b>{{ titleOf(r) }}</b>
                <i v-if="(r.people || []).length > 1" class="sd-n">{{ (r.people || []).length + 1 }}</i>
                <u>{{ when(r.last_message_at) }}</u>
              </span>
              <span class="sd-low">
                <span class="sd-line">{{ lineOf(r) }}</span>
                <em v-if="spaceName(r)" class="sd-space">{{ spaceName(r) }}</em>
              </span>
            </span>
            <em v-if="r.unread > 0" class="sd-badge">{{ r.unread }}</em>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
@import './spaces-ui.css';
.sd { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; height: 100%; overflow: hidden }
.sd-head { padding: 16px 20px 12px; border-bottom: 1px solid var(--hair) }
.sd-headin { display: flex; align-items: baseline; gap: 10px }
.sd-headin h2 { margin: 0; font-size: 19px; font-weight: 650; color: var(--ink) }
.sd-quiet { font-size: 12.5px; color: var(--ink3) }
.sd-tools { display: flex; align-items: center; gap: 8px; margin-top: 10px }
.sd-tools .sd-new { margin-left: auto }
.sd-find { flex: 1; min-width: 0; max-width: 340px; font: inherit; font-size: 13.5px; color: var(--ink);
  background: var(--paper); border: 1px solid var(--hair); border-radius: 8px; padding: 7px 11px }
.sd-find:focus { outline: none; border-color: color-mix(in srgb, var(--ink) 40%, transparent) }
.sd-new { display: inline-flex; align-items: center; gap: 6px; flex: none; font: inherit; font-size: 13px;
  font-weight: 600; color: var(--paper); background: var(--ink); border: 1px solid var(--ink);
  border-radius: 8px; padding: 7px 12px; cursor: pointer }
.sd-new:hover { opacity: .88 }
.sd-new-big { margin-top: 14px; color: var(--paper) }
.sd-body { overflow: auto; min-height: 0; padding: 8px 12px 24px }
.sd-list { list-style: none; margin: 0; padding: 0 }
.sd-pinned { margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px solid var(--hair) }
.sd-pin-ic { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 999px; color: var(--accent);
  background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 16%, var(--paper)), color-mix(in srgb, var(--accent) 6%, var(--paper))) }
.sd-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 11px;
  width: 100%; text-align: left; background: none; border: 0; border-radius: 10px; padding: 9px 10px;
  cursor: pointer; color: inherit; font: inherit }
.sd-row:hover { background: color-mix(in srgb, var(--ink) 6%, transparent) }
.sd-mid { display: grid; gap: 2px; min-width: 0 }
.sd-top { display: flex; align-items: baseline; gap: 7px; min-width: 0 }
.sd-top b { font-size: 14.5px; font-weight: 600; color: var(--ink); overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap }
.sd-n { flex: none; font-style: normal; font-size: 11px; font-weight: 600; color: var(--ink3);
  background: color-mix(in srgb, var(--ink) 8%, transparent); border-radius: 999px; padding: 1px 6px }
.sd-top u { margin-left: auto; flex: none; text-decoration: none; font-size: 11.5px; color: var(--ink3) }
.sd-low { display: flex; align-items: baseline; gap: 8px; min-width: 0 }
.sd-line { font-size: 13px; color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sd-space { flex: none; font-style: normal; font-size: 11px; color: var(--ink3); opacity: .8 }
/* unread is weight and ink, never a colour: the badge alone carries the count */
.sd-row.unread .sd-top b { font-weight: 750 }
.sd-row.unread .sd-line { color: var(--ink); font-weight: 500 }
.sd-badge { flex: none; font-style: normal; font-size: 11px; font-weight: 700; color: var(--paper);
  background: var(--ink); border-radius: 999px; padding: 2px 7px; min-width: 18px; text-align: center }
</style>

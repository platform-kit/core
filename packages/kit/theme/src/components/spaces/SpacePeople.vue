<script setup>
/*
 * Who else is here. A member of a space can see who is in it, what each of them is called here (the
 * roles the space invented), whether they are about, and write to any of them — and nothing else.
 *
 * WHAT IT DOES NOT SHOW is the point: no address, nothing anybody bought, no membership tier, no
 * last seen. It is the profile the site already shows beside a message, in a list — the read behind
 * it (space_people) selects those columns and no others, so there is nothing here to leak by
 * forgetting to hide it.
 *
 * Whoever the space granted `invite` gets one more thing: a link to make. The token is made in this
 * browser and shown once; the database keeps only its digest, so a link that is lost is lost.
 *
 * Words from spaces.md (## directory).
 */
import { computed, ref, onMounted, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { peopleOf, makeInvite, invitesOf, dropInvite, mayInvite } from 'platformkit/lib/spaces/api.js'
import SpaceAvatar from './SpaceAvatar.vue'
import SpaceFlair from './SpaceFlair.vue'
import SpaceIcon from './SpaceIcon.vue'

const props = defineProps({
  space: { type: Object, default: null },
  channels: { type: Array, default: () => [] },
  here: { type: Object, default: () => ({}) },
  me: { type: String, default: '' },
})
const emit = defineEmits(['write', 'who'])
const W = computed(() => us('spaces').directory.main)

const people = ref([])
const invites = ref([])
const mayAsk = ref(false)
const made = ref('')        /* the one time a token is ever readable */
const busy = ref(false)
const err = ref('')
const filter = ref('')

const aRoom = computed(() => (props.space ? (props.channels.find((c) => c.space_id === props.space.id && c.kind !== 'dm') || null) : null))
const shown = computed(() => {
  const q = filter.value.trim().toLowerCase()
  const list = people.value
  return q ? list.filter((p) => String(p.name || '').toLowerCase().includes(q)) : list
})

async function load() {
  if (!props.space) { people.value = []; invites.value = []; return }
  people.value = (await peopleOf(props.space.id)) || []
  mayAsk.value = aRoom.value ? !!(await mayInvite(aRoom.value.id)) : false
  invites.value = mayAsk.value ? ((await invitesOf(props.space.id)) || []) : []
}
onMounted(load)
watch(() => props.space && props.space.id, load)

async function make() {
  busy.value = true; err.value = ''
  try {
    made.value = await makeInvite(props.space.id, { uses: 0, days: 30 })
    invites.value = (await invitesOf(props.space.id)) || []
  } catch (e) { err.value = e.message || String(e) } finally { busy.value = false }
}
async function drop(id) {
  try { await dropInvite(id); invites.value = (await invitesOf(props.space.id)) || [] } catch (e) { err.value = e.message }
}
const link = computed(() => (made.value ? `${window.location.origin}/spaces/join/${made.value}` : ''))
const copy = () => { try { navigator.clipboard.writeText(link.value) } catch { /* no clipboard */ } }
</script>

<template>
  <section v-if="space" class="sd">
    <header class="sd-head">
      <h2>{{ (W.title || '').replace('{name}', space.name) }}</h2>
      <p>{{ W.line }}</p>
    </header>

    <label class="sd-filter">
      <SpaceIcon name="search" :size="14" />
      <input v-model="filter" type="search" :placeholder="W.find" :aria-label="W.find" />
    </label>

    <ul class="sd-list">
      <li v-for="p in shown" :key="p.id">
        <span class="sd-face">
          <SpaceAvatar :name="p.name" :person="p" :size="34" />
          <i class="sd-here" :class="'is-' + (here[p.id] || 'off')"></i>
        </span>
        <span class="sd-who">
          <b>{{ p.name }}<em v-if="p.id === me" class="sd-you">{{ W.you }}</em></b>
          <span v-if="(p.wearing || []).length" class="sd-roles">
            <em
              v-for="r in p.wearing" :key="r.name"
              :style="r.colour ? { background: r.colour, color: '#fff' } : null">{{ r.name }}</em>
          </span>
          <!-- and the badges this space gave them, under the roles: a role says what somebody may
               do here, a badge says something about them, and the two are not the same claim -->
          <SpaceFlair v-if="(p.flair || []).length" :flair="p.flair" mode="full" :size="12" />
        </span>
        <button type="button" class="sd-write" @click="emit('who', p.id)">{{ W.open }}</button>
      </li>
      <li v-if="!shown.length && filter.trim()" class="sd-none">{{ W['find-none'] }}</li>
    </ul>

    <div v-if="!shown.length && !filter.trim()" class="su-none">
      <h3>{{ W['nobody-title'] }}</h3>
      <p>{{ W['nobody-line'] }}</p>
    </div>

    <div v-if="mayAsk" class="sd-invite">
      <h3>{{ W['invite-title'] }}</h3>
      <p>{{ W['invite-line'] }}</p>
      <p v-if="err" class="sd-err">{{ err }}</p>
      <div v-if="made" class="sd-link">
        <code>{{ link }}</code>
        <button type="button" @click="copy">{{ W.copy }}</button>
        <span class="sd-once">{{ W['shown-once'] }}</span>
      </div>
      <button v-else type="button" class="sd-make" :disabled="busy" @click="make">
        <SpaceIcon name="ticket" :size="14" />{{ W['make-link'] }}
      </button>
      <ul v-if="invites.length" class="sd-invites">
        <li v-for="i in invites" :key="i.id" :class="{ off: i.state !== 'good' }">
          <SpaceIcon name="ticket" :size="13" />
          <span>{{ i.state === 'good' ? (W['used-n'] || '').replace('{n}', i.used) : W['state-' + i.state] }}</span>
          <button type="button" @click="drop(i.id)">{{ W.revoke }}</button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; every class here says what it wants instead */
/* section.sd, not .sd: the page gives this element its own class too (sp-plain), and a
   parent's scoped style is injected after a child's — so a tie goes to the page, and this surface
   would lose both its padding and its scrolling to it. */
section.sd { box-sizing: border-box; min-width: 0; overflow-y: auto; margin: 0; padding: 26px 28px 40px; border: 0 }
/* one measure for everything on the page: heading, controls, lists and cards all start and end
   together. A control that belongs to a heading stays beside it rather than at the pane's edge. */
section.sd > * { max-width: var(--sp-measure, 860px) }
section.sd > .su-none { max-width: 620px }
.sd-head { margin: 0 0 16px; padding: 0; border: 0 }
.sd-head h2 { margin: 0 0 5px; font-size: 22px; font-weight: 800; letter-spacing: -.02em; color: var(--ink) }
.sd-head p { margin: 0; max-width: 62ch; font-size: 13.5px; color: var(--ink3) }

.sd-filter { display: flex; align-items: center; gap: 7px; max-width: 320px; margin: 0 0 14px; padding: 6px 10px;
  color: var(--ink3); background: var(--paper); border: 1px solid var(--hair); border-radius: 9px }
.sd-filter input { flex: 1; min-width: 0; font: inherit; font-size: 13.5px; color: var(--ink); background: transparent; border: 0; outline: none }

.sd-list { list-style: none; margin: 0 0 26px; padding: 0; display: grid; gap: 2px; max-width: 620px }
.sd-list li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: center;
  padding: 8px 10px; border-radius: 9px }
.sd-list li:hover { background: color-mix(in srgb, var(--ink) 4%, transparent) }
.sd-face { position: relative; display: block; line-height: 0 }
.sd-here { position: absolute; right: -1px; bottom: -1px; width: 10px; height: 10px; border-radius: 50%;
  border: 2px solid var(--paper); background: var(--ink3) }
.sd-here.is-active { background: #3fae7a } .sd-here.is-dnd { background: #c8382f } .sd-here.is-away { background: #d9a13b }
.sd-who { min-width: 0; display: grid; gap: 3px }
.sd-who b { font-size: 14.5px; font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sd-roles { display: flex; flex-wrap: wrap; gap: 4px }
.sd-roles em { font-style: normal; font-size: 11px; font-weight: 700; color: var(--ink3);
  background: color-mix(in srgb, var(--ink) 7%, transparent); border-radius: 999px; padding: 1px 8px }
.sd-write { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink2); background: transparent;
  border: 1px solid var(--hair); border-radius: 7px; padding: 4px 11px; cursor: pointer }
.sd-write:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.sd-you { margin-left: 7px; font-style: normal; font-size: 11px; font-weight: 800; letter-spacing: .05em;
  text-transform: uppercase; color: var(--ink3) }
.sd-none { display: block; padding: 10px; font-size: 13.5px; color: var(--ink3) }

.sd-invite { max-width: 620px; padding: 15px 17px; background: var(--paper); border: 1px solid var(--hair); border-radius: 12px }
.sd-invite h3 { margin: 0 0 5px; font-size: 14px; font-weight: 800; color: var(--ink) }
.sd-invite p { margin: 0 0 11px; max-width: none; font-size: 13px; line-height: 1.5; color: var(--ink3) }
.sd-err { color: #c8382f }
.sd-make { display: inline-flex; align-items: center; gap: 7px; font: inherit; font-size: 13px; font-weight: 600;
  color: var(--ink2); background: transparent; border: 1px solid var(--hair); border-radius: 8px; padding: 6px 12px; cursor: pointer }
.sd-make:hover:not(:disabled) { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.sd-make:disabled { opacity: .5; cursor: default }
.sd-link { display: flex; flex-wrap: wrap; align-items: center; gap: 9px }
.sd-link code { flex: 1; min-width: 0; font-family: var(--m); font-size: 12px; color: var(--ink2);
  background: color-mix(in srgb, var(--ink) 5%, transparent); border-radius: 7px; padding: 6px 9px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sd-link button { font: inherit; font-size: 12.5px; font-weight: 700; color: var(--paper); background: var(--ink);
  border: 0; border-radius: 7px; padding: 6px 12px; cursor: pointer }
.sd-once { width: 100%; font-size: 11.5px; color: var(--ink3) }
.sd-invites { list-style: none; margin: 13px 0 0; padding: 13px 0 0; border-top: 1px solid var(--hair); display: grid; gap: 7px }
.sd-invites li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 9px; align-items: center;
  font-size: 12.5px; color: var(--ink2) }
.sd-invites li.off { opacity: .55 }
.sd-invites button { font: inherit; font-size: 12px; color: var(--ink3); background: transparent; border: 0;
  padding: 2px 4px; cursor: pointer }
.sd-invites button:hover { color: #c8382f }

@media (max-width: 900px) { section.sd { padding: 18px 16px 32px } }
</style>

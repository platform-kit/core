<script setup>
/*
 * WHO IS IN A TEAM — the rows beside the file, in the team's own drawer.
 *
 * The declaration (name, the line, the ways in) is the file and is edited above this; a member is
 * not, and never could be: a file that named Ada would be a file that owned somebody's membership,
 * and putting a person in a team is an act. So this reads `team_people` and writes through
 * `team_invite` / `team_remove`, each of which is the database's own check that the caller is an
 * administrator — nothing here decides that.
 *
 * Each row says HOW they arrived, because the three are not the same fact: the rule swept them in
 * (and will again), somebody invited them (and the sweep leaves them alone), or somebody put them
 * here by hand. Removing somebody the rule matches is honest and temporary — the sweep puts them
 * back — so the row says so rather than pretending the removal is final.
 *
 * Words: the `teams` scope, `## members`.
 */
import { ref, computed, watch, onMounted } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { teamPeople, teamProjected, inviteToTeam, removeFromTeam, peopleToAsk } from '@platform-kit/kit/lib/teams.js'
import { faceOf } from '@platform-kit/kit/lib/avatar.js'

const props = defineProps({
  team: { type: String, default: '' },   /* the slug; empty while the team is being created */
  saved: { type: Boolean, default: true },
})
const W = computed(() => (us('teams').members || {}).main || {})
const rows = ref([])
/* null while unknown, false where the file exists and the row does not — see teamProjected */
const projected = ref(null)
const loading = ref(false)
const err = ref('')
const asking = ref(false)
const q = ref('')
const found = ref([])
const looking = ref(false)
const busy = ref('')

const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const how = (r) => (r.source === 'fill' ? W.value['by-fill'] : r.source === 'invite' ? W.value['by-invite'] : W.value['by-manual'])
const when = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) } catch (e) { return '' } }
const nameOf = (r) => r.name || r.username || ''

async function load() {
  if (!props.team || !props.saved) { rows.value = []; projected.value = null; return }
  loading.value = true; err.value = ''
  try {
    projected.value = await teamProjected(props.team)
    rows.value = projected.value === false ? [] : await teamPeople(props.team)
  } catch (e) { err.value = W.value.failed } finally { loading.value = false }
}
onMounted(load)
watch(() => [props.team, props.saved], load)

/* the search is the People section's read, a beat after the typing stops */
let t = null
watch(q, (v) => {
  clearTimeout(t)
  if (!v.trim()) { found.value = []; looking.value = false; return }
  looking.value = true
  t = setTimeout(async () => {
    try { found.value = await peopleToAsk(v.trim()) } catch (e) { found.value = [] } finally { looking.value = false }
  }, 300)
})

async function add(p) {
  busy.value = p.id; err.value = ''
  try { await inviteToTeam(props.team, p.id); q.value = ''; found.value = []; asking.value = false; await load() }
  catch (e) { err.value = W.value.failed } finally { busy.value = '' }
}
async function drop(r) {
  busy.value = r.user_id; err.value = ''
  try { await removeFromTeam(props.team, r.user_id); await load() }
  catch (e) { err.value = W.value.failed } finally { busy.value = '' }
}
const already = (id) => rows.value.some((r) => r.user_id === id)
</script>

<template>
  <section class="tm">
    <div class="tm-head">
      <h3>{{ W.title }}</h3>
      <span v-if="rows.length" class="tm-n">{{ rows.length === 1 ? W['count-one'] : fill(W.count, { n: rows.length }) }}</span>
    </div>
    <p class="tm-line">{{ W.line }}</p>

    <p v-if="!saved || !team" class="tm-empty">{{ W['save-first'] }}</p>
    <template v-else>
      <p v-if="loading" class="tm-empty">{{ W.loading }}</p>
      <p v-else-if="projected === false" class="tm-empty">{{ W.unprojected }}</p>
      <ul v-else-if="rows.length" class="tm-list">
        <li v-for="r in rows" :key="r.user_id">
          <img class="tm-face" :src="faceOf(r)" alt="" width="28" height="28" />
          <span class="tm-who">
            <b>{{ nameOf(r) }}</b>
            <i>{{ how(r) }}<template v-if="r.joined_at"> · {{ fill(W.since, { when: when(r.joined_at) }) }}</template></i>
          </span>
          <button type="button" class="tm-rm" :disabled="busy === r.user_id" @click="drop(r)">
            {{ busy === r.user_id ? W.removing : W.remove }}
          </button>
        </li>
      </ul>
      <p v-else class="tm-empty">{{ W.empty }}</p>

      <div v-if="projected !== false" class="tm-add">
        <button v-if="!asking" type="button" class="tm-addbtn" @click="asking = true">{{ W.add }}</button>
        <template v-else>
          <input v-model="q" type="search" class="tm-search" :placeholder="W.search" autocomplete="off" />
          <p v-if="looking" class="tm-empty">{{ W.searching }}</p>
          <ul v-else-if="found.length" class="tm-found">
            <li v-for="p in found" :key="p.id">
              <span class="tm-who"><b>{{ p.name || p.email }}</b><i>{{ p.email }}</i></span>
              <button v-if="!already(p.id)" type="button" class="tm-pick" :disabled="busy === p.id" @click="add(p)">{{ W.pick }}</button>
              <em v-else class="tm-in">{{ W.added }}</em>
            </li>
          </ul>
          <p v-else-if="q.trim()" class="tm-empty">{{ W['no-people'] }}</p>
        </template>
      </div>
    </template>
    <p v-if="err" class="tm-bad">{{ err }}</p>
  </section>
</template>

<style scoped>
.tm { border-top: 1px solid var(--hair); padding-top: 16px; margin-top: 4px; display: flex; flex-direction: column; gap: 8px }
.tm-head { display: flex; align-items: baseline; gap: 10px }
.tm-head h3 { margin: 0; font: inherit; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink2) }
.tm-n { font-family: var(--m); font-size: 11px; color: var(--ink3) }
.tm-line { margin: 0; font-size: 12px; line-height: 1.5; color: var(--ink3) }
.tm-empty { margin: 0; font-size: 12.5px; color: var(--ink3) }
.tm-list, .tm-found { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px }
.tm-list li, .tm-found li { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 9px }
.tm-list li:hover, .tm-found li:hover { background: var(--wash) }
.tm-face { border-radius: 50%; flex: 0 0 auto; background: var(--wash) }
.tm-who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px }
.tm-who b { font-size: 13.5px; font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.tm-who i { font-style: normal; font-size: 11.5px; color: var(--ink3) }
.tm-rm, .tm-pick, .tm-addbtn { font: inherit; font-size: 12px; padding: 5px 11px; border-radius: 8px; border: 1px solid var(--hair); background: var(--card); color: var(--ink2); cursor: pointer }
.tm-rm:hover:not(:disabled) { color: #b3261e; border-color: #b3261e55; background: #b3261e0d }
.tm-pick:hover:not(:disabled), .tm-addbtn:hover { border-color: var(--ink3); color: var(--ink) }
.tm-rm:disabled, .tm-pick:disabled { opacity: .5; cursor: default }
.tm-in { font-style: normal; font-size: 11.5px; color: var(--ink3) }
.tm-addbtn { align-self: flex-start; margin-top: 2px }
.tm-add { display: flex; flex-direction: column; gap: 6px }
.tm-search { font: inherit; font-size: 13px; color: var(--ink); background: var(--card); border: 1px solid var(--hair); border-radius: 8px; padding: 0 10px; height: 34px; box-sizing: border-box }
.tm-search:focus { outline: 2px solid var(--accent2); outline-offset: -1px; border-color: transparent }
.tm-bad { margin: 0; font-size: 12px; color: #b3261e }
</style>

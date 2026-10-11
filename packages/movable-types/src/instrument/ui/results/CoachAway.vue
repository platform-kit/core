<script setup>
/* When you are away — the stretches of days nobody can book, on the Coaching tab beside Your hours:
   a from and a to, what it is (only they see it), and who takes it instead. A day off on its own is
   an exception on a set of hours; this is for the stretch, and it comes back by itself.
   Words: library.md coaching.away. */
import { ref, onMounted } from 'vue'
import { us } from '../strings.js'
import { getAway, addAway, removeAway, coverChoices } from '@platform-kit/kit/lib/hours.js'
const A = us('library').coaching.away || {}
const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const open = ref(false), loading = ref(true), saving = ref(false), error = ref('')
const rows = ref([]), covers = ref([])
const draft = ref({ from: '', to: '', reason: '', cover: '' })
const today = new Date().toISOString().slice(0, 10)
const nameOf = (id) => (covers.value.find((c) => c.id === id) || {}).name || ''
const dayLabel = (d) => { try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d + 'T12:00:00')) } catch (e) { return d } }
async function load() {
  loading.value = true
  try { rows.value = await getAway(); covers.value = await coverChoices() }
  catch (e) { error.value = e.message } finally { loading.value = false }
}
onMounted(load)
async function add() {
  if (!draft.value.from) return
  saving.value = true; error.value = ''
  try {
    rows.value = await addAway({ ...draft.value, to: draft.value.to || draft.value.from })
    draft.value = { from: '', to: '', reason: '', cover: '' }
  } catch (e) { error.value = A.error || e.message } finally { saving.value = false }
}
async function drop(id) { try { rows.value = await removeAway(id) } catch (e) { error.value = e.message } }
const summary = () => (rows.value.length ? rows.value.map((r) => fill(A.one, { from: dayLabel(r.from), to: dayLabel(r.to) })).join(' · ') : A['none-yet'])
</script>

<template>
  <section class="aw" :class="{ open }">
    <button type="button" class="aw-head" :aria-expanded="open" @click="open = !open">
      <span class="aw-title">{{ A.title }}</span>
      <span class="aw-sum">{{ loading ? '' : summary() }}</span>
      <span class="aw-btn">{{ open ? A.close : A.open }}</span>
    </button>
    <div v-if="open" class="aw-body">
      <p class="aw-lead">{{ A.lead }}</p>
      <ul v-if="rows.length" class="aw-list">
        <li v-for="r in rows" :key="r.id" class="aw-row">
          <b>{{ fill(A.one, { from: dayLabel(r.from), to: dayLabel(r.to) }) }}</b>
          <i v-if="r.reason">{{ r.reason }}</i>
          <span v-if="r.cover_id" class="aw-cover">{{ A.cover }}: {{ nameOf(r.cover_id) }}</span>
          <button type="button" class="aw-x" :title="A.remove" @click="drop(r.id)">×</button>
        </li>
      </ul>
      <div class="aw-new">
        <label class="aw-field"><span>{{ A.from }}</span><input type="date" v-model="draft.from" :min="today" /></label>
        <label class="aw-field"><span>{{ A.to }}</span><input type="date" v-model="draft.to" :min="draft.from || today" /></label>
        <label class="aw-field aw-wide"><span>{{ A.reason }}</span><input type="text" maxlength="120" v-model="draft.reason" :placeholder="A['reason-placeholder']" /></label>
        <label class="aw-field aw-wide"><span>{{ A.cover }}</span>
          <select v-model="draft.cover">
            <option value="">{{ A['cover-none'] }}</option>
            <option v-for="c in covers" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <small v-if="draft.cover" class="aw-note">{{ A['cover-note'] }}</small>
        <div class="aw-act">
          <button type="button" class="aw-primary" :disabled="saving || !draft.from" @click="add">{{ saving ? A.adding : A.add }}</button>
          <em v-if="error" class="aw-err">{{ error }}</em>
        </div>
      </div>
      <p class="aw-standing">{{ A.standing }}</p>
    </div>
  </section>
</template>

<style scoped>
.aw { border: 1px solid var(--qhair); border-radius: 14px; background: var(--qcard); margin: 0 0 var(--s3); padding: 0; overflow: hidden }   /* padding 0: the global stylesheet gives a section its own */
.aw-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; width: 100%; font: inherit; text-align: left; padding: 14px 16px; background: none; border: 0; color: var(--qink); cursor: pointer }
.aw-title { font-weight: 700; font-size: 15px }
.aw-sum { font-size: 13px; color: var(--qink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.aw-btn { font-size: 13px; color: var(--qink2); padding: 6px 12px; border: 1px solid var(--qhair); border-radius: 999px; white-space: nowrap }
.aw-body { padding: 0 16px 16px; display: flex; flex-direction: column; gap: 14px }
.aw-lead { margin: 0; font-size: 13.5px; color: var(--qink2); max-width: 62ch }
.aw-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px }
.aw-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; gap: 12px; align-items: baseline; padding: 8px 0; border-top: 1px dashed var(--qhair) }
.aw-row:first-child { border-top: 0 }
.aw-row b { font-size: 14px }
.aw-row i { font-style: normal; font-size: 13px; color: var(--qink3) }
.aw-cover { font-size: 12.5px; color: var(--qink3) }
.aw-x { font: inherit; font-size: 16px; line-height: 1; color: var(--qink3); background: none; border: 0; cursor: pointer; padding: 0 4px }
.aw-new { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; align-items: end }
.aw-field { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--qink3) }
.aw-field input, .aw-field select { font: inherit; font-size: 14px; color: var(--qink); background: transparent; border: 1px solid var(--qhair); border-radius: 9px; padding: 8px 10px; width: 100% }
.aw-wide { grid-column: 1 / -1 }
.aw-note { grid-column: 1 / -1; font-size: 12.5px; color: var(--qink3) }
.aw-act { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px }
.aw-primary { font: inherit; font-size: 14px; font-weight: 600; color: var(--qcard); background: var(--qink); border: 0; border-radius: 999px; padding: 9px 18px; cursor: pointer }
.aw-primary:disabled { opacity: .5; cursor: default }
.aw-err { font-style: normal; font-size: 13px; color: var(--c3, #fc5151) }
.aw-standing { margin: 0; font-size: 12.5px; color: var(--qink3); max-width: 62ch }
@media (max-width: 640px) { .aw-new { grid-template-columns: 1fr } .aw-head { grid-template-columns: minmax(0, 1fr) auto } .aw-title { grid-row: 1 } .aw-btn { grid-row: 1; grid-column: 2; justify-self: end } .aw-sum { grid-column: 1 / -1; grid-row: 2; white-space: normal } .aw-row { grid-template-columns: minmax(0, 1fr) auto } .aw-row > * { grid-column: 1 } .aw-row .aw-x { grid-row: 1; grid-column: 2; justify-self: end } }
</style>

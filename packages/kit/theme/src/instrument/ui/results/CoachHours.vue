<script setup>
/* Your hours — a host's own availability, on the Coaching tab: the time zone, the week as seven rows
   (a switch per day, its ranges as from · to pickers, add and remove), the breathing room, the notice,
   the cap, and the exceptions (a date, off all day or its own ranges). Every value a control; saved
   through coach-hours (src/lib/hours.js). Words: library.md coaching.hours. */
import { ref, computed, onMounted } from 'vue'
import { us } from '../strings.js'
import { getHours, setHours, setOverride, removeOverride, makeDefault, forgetHours, zones, WEEKDAYS, emptyHours } from 'platformkit/lib/hours.js'
const H = us('library').coaching.hours || {}
const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const DAYS = { 1: H.mon, 2: H.tue, 3: H.wed, 4: H.thu, 5: H.fri, 6: H.sat, 7: H.sun }
const open = ref(false), loading = ref(true), saving = ref(false), saved = ref(false), error = ref('')
const hours = ref(emptyHours()), overrides = ref([]), had = ref(false)
/* A HOST KEEPS ANY NUMBER OF NAMED SETS — "mornings for discovery calls, evenings for clients" —
   one of them theirs by default. The panel edits ONE at a time, picked here; a booking type asks
   for a set by name and anything that asks for none uses the default. */
const sets = ref([]), picked = ref(null)
const current = computed(() => sets.value.find((s) => s.id === picked.value) || null)
const isDefault = computed(() => !!(current.value && current.value.is_default))
const { list: ZONES } = zones()
const on = (d) => Array.isArray(hours.value.weekly[d]) && hours.value.weekly[d].length > 0
function toggle(d) { if (on(d)) delete hours.value.weekly[d]; else hours.value.weekly[d] = [['09:00', '17:00']]; hours.value.weekly = { ...hours.value.weekly } }
function add(d) { hours.value.weekly[d] = [...(hours.value.weekly[d] || []), ['13:00', '17:00']]; hours.value.weekly = { ...hours.value.weekly } }
function drop(d, i) { const r = (hours.value.weekly[d] || []).filter((_, j) => j !== i); if (r.length) hours.value.weekly[d] = r; else delete hours.value.weekly[d]; hours.value.weekly = { ...hours.value.weekly } }
async function load() {
  loading.value = true
  try {
    const r = await getHours()
    sets.value = r.schedules || (r.hours ? [r.hours] : [])
    if (!picked.value || !sets.value.some((s) => s.id === picked.value)) picked.value = (sets.value.find((s) => s.is_default) || sets.value[0] || {}).id ?? null
    const mine = sets.value.find((s) => s.id === picked.value) || r.hours
    if (mine) { hours.value = { ...emptyHours(), ...mine }; had.value = true }
    /* an exception belongs to the set it was written on; one written before there were several has
       no set and belongs to the default */
    overrides.value = (r.overrides || []).filter((o) => o.schedule_id === picked.value || (!o.schedule_id && (current.value ? current.value.is_default : true)))
  }
  catch (e) { error.value = e.message } finally { loading.value = false }
}
onMounted(load)
async function save() {
  saving.value = true; error.value = ''; saved.value = false
  try {
    const r = await setHours(hours.value, picked.value || undefined)
    sets.value = r.schedules || []
    const mine = sets.value.find((s) => s.name === hours.value.name) || sets.value.find((s) => s.id === picked.value) || r.hours
    if (mine) { picked.value = mine.id; hours.value = { ...emptyHours(), ...mine } }
    had.value = true; saved.value = true; setTimeout(() => { saved.value = false }, 1800)
  }
  catch (e) { error.value = H.error || e.message } finally { saving.value = false }
}
/* the exceptions: a day picked, off by default; its own ranges when the switch says so */
const newDay = ref('')
/* picking another set re-reads, because its exceptions are its own */
async function pick(id) { picked.value = id; await load() }
async function addSet() { picked.value = null; hours.value = { ...emptyHours(), name: '', timezone: (usual.value || hours.value).timezone || emptyHours().timezone }; overrides.value = [] }
async function beDefault() { if (!picked.value) return; try { const r = await makeDefault(picked.value); sets.value = r.schedules || [] } catch (e) { error.value = e.message } }
async function forget() { if (!picked.value || !window.confirm(H['forget-ask'])) return; try { const r = await forgetHours(picked.value); sets.value = r.schedules || []; picked.value = null; await load() } catch (e) { error.value = e.code === 'last' ? H['forget-last'] : e.message } }
const today = new Date().toISOString().slice(0, 10)
async function addOverride() { if (!newDay.value) return; try { const r = await setOverride(newDay.value, null, '', picked.value || undefined); overrides.value = r.overrides || []; newDay.value = '' } catch (e) { error.value = e.message } }
async function setKind(o, own) { try { const r = await setOverride(o.day, own ? [['09:00', '12:00']] : null, o.note, picked.value || undefined); overrides.value = r.overrides || [] } catch (e) { error.value = e.message } }
async function saveRanges(o) { try { const r = await setOverride(o.day, o.ranges, o.note, picked.value || undefined); overrides.value = r.overrides || [] } catch (e) { error.value = e.message } }
function addRange(o) { o.ranges = [...(o.ranges || []), ['13:00', '17:00']]; saveRanges(o) }
function dropRange(o, i) { o.ranges = (o.ranges || []).filter((_, j) => j !== i); if (!o.ranges.length) o.ranges = null; saveRanges(o) }
async function removeDay(o) { try { const r = await removeOverride(o.day, picked.value || undefined); overrides.value = r.overrides || [] } catch (e) { error.value = e.message } }
const dayLabel = (d) => { try { return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(d + 'T12:00:00')) } catch (e) { return d } }
const usual = computed(() => sets.value.find((s) => s.is_default) || sets.value[0] || null)
const summary = computed(() => { const w = (usual.value || hours.value).weekly || {}; return WEEKDAYS.filter((d) => Array.isArray(w[d]) && w[d].length).map((d) => DAYS[d].slice(0, 3)).join(' · ') })
</script>

<template>
  <section class="ch" :class="{ open }">
    <button type="button" class="ch-head" :aria-expanded="open" @click="open = !open">
      <span class="ch-title">{{ H.title }}</span>
      <span class="ch-sum">{{ loading ? '' : had ? (sets.length > 1 ? fill(H['sets-count'], { n: sets.length }) + ' · ' : '') + summary + ' · ' + ((usual || hours).timezone || hours.timezone) : H['none-yet'] }}</span>
      <span class="ch-btn">{{ open ? H.close : H.open }}</span>
    </button>
    <div v-if="open" class="ch-body">
      <p class="ch-lead">{{ H.lead }}</p>
      <!-- THE SETS. A host keeps any number; this row picks which one the panel below edits, and
           says which is the usual one, because "a booking type asks for a set by name" is
           meaningless until you can see the names. -->
      <div v-if="sets.length" class="ch-sets">
        <span class="ch-sets-label">{{ H.sets }}</span>
        <span class="ch-tabs">
          <button v-for="s in sets" :key="s.id" type="button" class="ch-tab" :class="{ on: s.id === picked }" @click="pick(s.id)">
            {{ s.name }}<i v-if="s.is_default" class="ch-star" :title="H['is-default']">★</i>
          </button>
          <button type="button" class="ch-tab ch-tab-new" :class="{ on: picked === null }" @click="addSet">+ {{ H['set-new'] }}</button>
        </span>
      </div>
      <p v-if="sets.length" class="ch-sets-lead">{{ H['set-lead'] }}</p>
      <label v-if="sets.length" class="ch-field ch-zone"><span>{{ H['set-name'] }}</span><input type="text" maxlength="60" v-model="hours.name" :placeholder="H['set-name-hint']" /></label>
      <label class="ch-field ch-zone"><span>{{ H.timezone }}</span><select v-model="hours.timezone"><option v-for="z in ZONES" :key="z" :value="z">{{ z }}</option></select></label>
      <ul class="ch-week">
        <li v-for="d in WEEKDAYS" :key="d" class="ch-day" :class="{ off: !on(d) }">
          <label class="ch-switch"><input type="checkbox" :checked="on(d)" @change="toggle(d)" /><i></i><b>{{ DAYS[d] }}</b></label>
          <div class="ch-ranges">
            <template v-if="on(d)">
              <span v-for="(r, i) in hours.weekly[d]" :key="i" class="ch-range">
                <input type="time" v-model="r[0]" :aria-label="H.from" /><em>–</em><input type="time" v-model="r[1]" :aria-label="H.to" />
                <button v-if="hours.weekly[d].length > 1" type="button" class="ch-x" :title="H.remove" @click="drop(d, i)">×</button>
              </span>
              <button v-if="hours.weekly[d].length < 4" type="button" class="ch-add" @click="add(d)">{{ H.add }}</button>
            </template>
            <span v-else class="ch-off">{{ H.off }}</span>
          </div>
        </li>
      </ul>
      <div class="ch-nums">
        <label class="ch-field"><span>{{ H['buffer-before'] }}</span><span class="ch-num"><input type="number" min="0" max="240" step="5" v-model.number="hours.buffer_before" /><small>{{ H['buffer-unit'] }}</small></span></label>
        <label class="ch-field"><span>{{ H['buffer-after'] }}</span><span class="ch-num"><input type="number" min="0" max="240" step="5" v-model.number="hours.buffer_after" /><small>{{ H['buffer-unit'] }}</small></span></label>
        <label class="ch-field"><span>{{ H['notice-label'] }}</span><span class="ch-num"><input type="number" min="0" max="720" v-model.number="hours.notice_hours" /><small>{{ H['notice-unit'] }}</small></span></label>
        <label class="ch-field"><span>{{ H['max-label'] }}</span><span class="ch-num"><input type="number" min="0" max="48" v-model.number="hours.max_per_day" /><small>{{ hours.max_per_day ? '' : H['max-none'] }}</small></span></label>
        <label class="ch-field"><span>{{ H['max-week-label'] }}</span><span class="ch-num"><input type="number" min="0" max="200" v-model.number="hours.max_per_week" /><small>{{ hours.max_per_week ? '' : H['max-none'] }}</small></span></label>
      </div>
      <div class="ch-save">
        <button type="button" class="ch-primary" :disabled="saving" @click="save">{{ saving ? H.saving : H.save }}</button>
        <button v-if="picked && !isDefault" type="button" class="ch-add" @click="beDefault">{{ H['make-default'] }}</button>
        <button v-if="picked && sets.length > 1" type="button" class="ch-add" @click="forget">{{ H.forget }}</button>
        <transition name="ch-fade"><i v-if="saved" class="ch-saved">{{ H.saved }}</i></transition>
        <em v-if="error" class="ch-err">{{ error }}</em>
      </div>
      <h4 class="ch-sub">{{ H.overrides }}</h4>
      <p v-if="picked === null" class="ch-sets-lead">{{ H['override-unsaved'] }}</p>
      <template v-else>
      <ul class="ch-overrides">
        <li v-for="o in overrides" :key="o.day" class="ch-ov">
          <b>{{ dayLabel(o.day) }}</b>
          <label class="ch-switch"><input type="checkbox" :checked="o.ranges === null" @change="setKind(o, o.ranges !== null ? false : true)" /><i></i><span>{{ o.ranges === null ? H['override-off'] : H['override-hours'] }}</span></label>
          <div v-if="o.ranges" class="ch-ranges">
            <span v-for="(r, i) in o.ranges" :key="i" class="ch-range"><input type="time" v-model="r[0]" @change="saveRanges(o)" /><em>–</em><input type="time" v-model="r[1]" @change="saveRanges(o)" /><button type="button" class="ch-x" :title="H.remove" @click="dropRange(o, i)">×</button></span>
            <button v-if="o.ranges.length < 4" type="button" class="ch-add" @click="addRange(o)">{{ H.add }}</button>
          </div>
          <button type="button" class="ch-x ch-drop" :title="H.remove" @click="removeDay(o)">×</button>
        </li>
      </ul>
      <div class="ch-newday"><input type="date" v-model="newDay" :min="today" /><button type="button" class="ch-add" :disabled="!newDay" @click="addOverride">{{ H['add-override'] }}</button></div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.ch { border: 1px solid var(--qhair); border-radius: 14px; background: var(--qcard); margin: 0 0 var(--s3); padding: 0; overflow: hidden }
.ch-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; width: 100%; font: inherit; text-align: left; padding: 14px 16px; background: none; border: 0; color: var(--qink); cursor: pointer }
.ch-title { font-weight: 700; font-size: 15px }
.ch-sum { font-size: 13px; color: var(--qink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ch-btn { font-size: 13px; color: var(--qink2); padding: 6px 12px; border: 1px solid var(--qhair); border-radius: 999px; white-space: nowrap }
.ch-sets { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin: 0 0 6px }
.ch-sets-label { font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--qink3) }
.ch-tabs { display: flex; flex-wrap: wrap; gap: 6px }
.ch-tab { font: inherit; font-size: 13px; padding: 5px 12px; border: 1px solid var(--qhair); border-radius: 999px; background: none; color: var(--qink2); cursor: pointer }
.ch-tab.on { border-color: var(--qink); color: var(--qink) }
.ch-tab-new { border-style: dashed }
.ch-star { font-style: normal; margin-left: 6px; font-size: 10px; color: var(--qink3) }
.ch-sets-lead { font-size: 12.5px; color: var(--qink3); margin: 0 0 12px }
.ch-body { padding: 4px 16px 16px; border-top: 1px dashed var(--qhair); animation: ch-in .3s cubic-bezier(.2, .8, .2, 1) }
@keyframes ch-in { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: none } }
@media (prefers-reduced-motion: reduce) { .ch-body { animation: none } }
.ch-lead { font-size: 13.5px; color: var(--qink3); margin: 10px 0 12px }
.ch-field { display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: var(--qink2) }
.ch-field select, .ch-field input, .ch-newday input { font: inherit; font-size: 14px; color: var(--qink); background: var(--qpaper, var(--qcard)); border: 1px solid var(--qhair); border-radius: 8px; padding: 7px 10px }
.ch-zone { max-width: 320px; margin-bottom: 12px }
.ch-week { list-style: none; margin: 0; padding: 0; border: 1px solid var(--qhair); border-radius: 10px; overflow: hidden }
.ch-day { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 12px; align-items: center; padding: 8px 12px; border-top: 1px solid var(--qhair) }
.ch-day:first-child { border-top: 0 } .ch-day.off { color: var(--qink3) }
.ch-switch { display: inline-flex; align-items: center; gap: 9px; cursor: pointer; font-size: 14px; user-select: none }
.ch-switch input { position: absolute; opacity: 0; width: 0; height: 0 }
.ch-switch i { position: relative; flex: none; width: 34px; height: 20px; border-radius: 999px; background: color-mix(in srgb, var(--qink3) 45%, var(--qcard)); transition: background .15s }
.ch-switch i::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px #00000033; transition: transform .15s cubic-bezier(.2, .8, .2, 1) }
.ch-switch input:checked + i { background: var(--qink) } .ch-switch input:checked + i::after { transform: translateX(14px); background: var(--qflip, #fff) }
.ch-ranges { display: flex; flex-wrap: wrap; gap: 8px; align-items: center }
.ch-range { display: inline-flex; align-items: center; gap: 4px } .ch-range em { color: var(--qink3); font-style: normal }
.ch-range input { font: inherit; font-size: 13.5px; color: var(--qink); background: var(--qpaper, var(--qcard)); border: 1px solid var(--qhair); border-radius: 8px; padding: 5px 8px }
.ch-x { font: inherit; font-size: 15px; line-height: 1; color: var(--qink3); background: none; border: 0; padding: 4px 6px; cursor: pointer; border-radius: 6px } .ch-x:hover { color: var(--qink); background: color-mix(in srgb, var(--qink) 8%, transparent) }
.ch-add { font: inherit; font-size: 12.5px; color: var(--qink2); background: transparent; border: 1px dashed var(--qhair); border-radius: 999px; padding: 5px 11px; cursor: pointer } .ch-add:disabled { opacity: .5; cursor: default }
.ch-off { font-size: 13px; color: var(--qink3) }
.ch-nums { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 14px 0 }
.ch-num { display: inline-flex; align-items: center; gap: 8px } .ch-num input { width: 84px } .ch-num small { font-size: 12px; color: var(--qink3) }
.ch-save { display: flex; align-items: center; gap: 12px; margin: 0 0 18px }
.ch-primary { font: inherit; font-size: 13.5px; font-weight: 600; color: var(--qflip, #fff); background: var(--qink); border: 1px solid var(--qink); border-radius: 999px; padding: 8px 16px; cursor: pointer } .ch-primary:disabled { opacity: .6 }
.ch-saved { font-style: normal; font-size: 13px; color: var(--qink2) } .ch-err { font-style: normal; font-size: 13px; color: var(--lvcatch, #dd3b3b) }
.ch-fade-enter-active, .ch-fade-leave-active { transition: opacity .2s } .ch-fade-enter-from, .ch-fade-leave-to { opacity: 0 }
.ch-sub { font-size: 14px; font-weight: 700; margin: 0 0 8px }
.ch-overrides { list-style: none; margin: 0; padding: 0 }
.ch-ov { display: grid; grid-template-columns: 130px auto minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px dashed var(--qhair) } .ch-ov:first-child { border-top: 0 }
.ch-ov b { font-size: 14px }
.ch-newday { display: flex; align-items: center; gap: 8px; margin-top: 10px }
@media (max-width: 640px) { .ch-day { grid-template-columns: 1fr } /* the exception keeps its × beside the date rather than adrift on a row of its own */ .ch-ov { grid-template-columns: minmax(0, 1fr) auto } .ch-ov > * { grid-column: 1 } .ch-ov .ch-drop { grid-row: 1; grid-column: 2; justify-self: end } .ch-nums { grid-template-columns: 1fr } .ch-head { grid-template-columns: minmax(0, 1fr) auto } .ch-title { grid-row: 1 } .ch-btn { grid-row: 1; grid-column: 2; justify-self: end } .ch-sum { grid-column: 1 / -1; grid-row: 2; white-space: normal } }
</style>

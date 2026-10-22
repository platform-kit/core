<script setup>
/*
 * THE HEADER, AS THE ROWS IT ACTUALLY IS.
 *
 * A header item is four decisions — what it says, where it goes, what it looks like, and who sees
 * it — and every one of them is a choice from a list rather than a string somebody types. That is
 * the project's rule about structured data, and the header is where breaking it would be most
 * tempting: an `href` LOOKS like a thing to type. It is not. A typed path is a path that can 404
 * the day a module is switched off, and a typed rung (`tier:inner`) is a rung nobody can spell.
 *
 * So: WHERE comes from the server, which knows which modules are on and which pages exist, and a
 * route no module answers is simply not in the list. WHO comes from the server too, with this
 * site's own tiers by their real names ("Inner Circle and above") rather than their slugs. The
 * ICON is the landing sections' own palette, so one glyph vocabulary serves the whole site.
 *
 * "A path of my own" is last, and it is the only free text here — because a site may link at
 * something the kit cannot know about, and refusing that would be worse than offering it.
 *
 * INHERITANCE IS SHOWN, NOT GUESSED AT. A site that has declared no header inherits one — its
 * config's, else the theme's — and an empty list is a terrible way to say so: it reads as "this
 * site has no header", which is false. So the inherited items are drawn, greyed, with one button
 * that copies them in to start from.
 */
import { ref, computed, onMounted } from 'vue'
import draggable from 'vuedraggable'
import { t, us } from 'platformkit/lib/content.js'
import { options } from '../../lib/admin/api.js'
import GlyphPicker from './GlyphPicker.vue'

const props = defineProps({
  modelValue: { type: Array, default: null },
  /* what the site would show if it declared nothing — drawn greyed until the editor starts from it */
  inherited: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue'])

/* the strings are `## nav / ### main / field: value`, so the group is nav and the record is main */
const W = computed(() => (us('models').nav || {}).main || {})
const rows = computed({
  get: () => props.modelValue || [],
  set: (v) => emit('update:modelValue', v),
})
const declared = computed(() => Array.isArray(props.modelValue) && props.modelValue.length > 0)

/* the two lists the server owns */
const links = ref([])
const sees = ref([])
onMounted(async () => {
  try { links.value = await options('nav-links') } catch { links.value = [] }
  try { sees.value = await options('nav-see') } catch { sees.value = [] }
})
/* the groups in the order the server gave them, so "The site" stays above "Your pages" */
const linkGroups = computed(() => {
  const by = new Map()
  for (const o of links.value) { const g = o.group || ''; if (!by.has(g)) by.set(g, []); by.get(g).push(o) }
  return [...by]
})
const known = (href) => links.value.some((o) => o.value === href)

const OWN = '\u0000own'   /* the sentinel for "a path of my own" — never a real value */
const whereOf = (r) => (r.href && !known(r.href) ? OWN : (r.href || ''))
function setWhere(r, v) {
  if (v === OWN) { r.href = r.href && !known(r.href) ? r.href : '/'; r.own = true }
  else { r.href = v; delete r.own }
  touch()
}
const isOwn = (r) => !!r.own || (!!r.href && !known(r.href))

/* the word the header itself would show for an inherited item: its own label, else the key
   through the nav strings — never the bare key, which is what the editor must not have to know */
const word = (l) => l.label || t('nav.' + l.key) || l.key || l.href
function touch() { emit('update:modelValue', [...rows.value]) }
function add() {
  rows.value = [...rows.value, { label: '', href: links.value.length ? links.value[0].value : '/', prefix: false }]
}
function drop(i) { const next = [...rows.value]; next.splice(i, 1); emit('update:modelValue', next) }
function startFrom() { emit('update:modelValue', (props.inherited || []).map((x) => ({ ...x }))) }
/* exactly one item may be the call to action: turning one on turns the others off, which is a
   rule the file enforces anyway and is far better met here than refused on save */
function setCta(r, on) { for (const x of rows.value) if (x !== r) delete x.cta; if (on) r.cta = true; else delete r.cta; touch() }
</script>

<template>
  <div class="ui-nav">
    <!-- what this site would show if it declared nothing -->
    <div v-if="!declared" class="ui-navinherit">
      <p class="ui-navinheritsay">{{ W.inheriting }}</p>
      <ul class="ui-navghosts">
        <li v-for="(g, i) in inherited" :key="i">{{ word(g) }}</li>
        <li v-if="!inherited.length" class="ui-navnone">{{ W.nothing }}</li>
      </ul>
      <button type="button" class="ui-btn" @click="startFrom">{{ W['start-from'] }}</button>
    </div>

    <draggable v-if="declared" v-model="rows" item-key="href" handle=".ui-navgrip" class="ui-navrows" :animation="150">
      <template #item="{ element: r, index: i }">
        <div class="ui-navrow">
          <span class="ui-navgrip" :aria-label="W.reorder" role="button" tabindex="0">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="6" cy="4" r="1.2"/><circle cx="10" cy="4" r="1.2"/><circle cx="6" cy="8" r="1.2"/><circle cx="10" cy="8" r="1.2"/><circle cx="6" cy="12" r="1.2"/><circle cx="10" cy="12" r="1.2"/></svg>
          </span>

          <label class="ui-navcell">
            <span class="ui-navlab">{{ W.says }}</span>
            <input v-model="r.label" type="text" class="ui-input" :placeholder="r.key ? word(r) : ''" @input="touch" />
          </label>

          <label class="ui-navcell">
            <span class="ui-navlab">{{ W.where }}</span>
            <select class="ui-input" :value="whereOf(r)" @change="setWhere(r, $event.target.value)">
              <optgroup v-for="[g, list] in linkGroups" :key="g" :label="g">
                <option v-for="o in list" :key="o.value" :value="o.value">{{ o.label }}</option>
              </optgroup>
              <option :value="OWN">{{ W['own-path'] }}</option>
            </select>
            <input v-if="isOwn(r)" v-model="r.href" type="text" class="ui-input ui-navown" @input="touch" />
          </label>

          <label class="ui-navcell ui-navnarrow">
            <span class="ui-navlab">{{ W.icon }}</span>
            <GlyphPicker v-model="r.icon" @update:model-value="touch" />
          </label>

          <label class="ui-navcell">
            <span class="ui-navlab">{{ W.who }}</span>
            <select v-model="r.see" class="ui-input" @change="touch">
              <option v-for="o in sees" :key="o.value" :value="o.value || undefined">{{ o.label }}</option>
            </select>
          </label>

          <label class="ui-navtick" :title="W['cta-help']">
            <input type="checkbox" :checked="!!r.cta" @change="setCta(r, $event.target.checked)" />
            <span>{{ W.cta }}</span>
          </label>

          <button type="button" class="ui-navx" :aria-label="W.remove" @click="drop(i)">×</button>
        </div>
      </template>
    </draggable>

    <button v-if="declared" type="button" class="ui-btn ui-navadd" @click="add">{{ W.add }}</button>
  </div>
</template>

<style scoped>
.ui-nav { display: flex; flex-direction: column; gap: 10px }
.ui-navinherit { border: 1px dashed var(--hair); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; align-items: flex-start }
.ui-navinheritsay { margin: 0; font-size: 13px; color: var(--ink3) }
.ui-navghosts { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px }
.ui-navghosts li { font-size: 13px; color: var(--ink3); border: 1px solid var(--hair); border-radius: 999px; padding: 3px 11px }
.ui-navnone { font-style: italic }
.ui-navrows { display: flex; flex-direction: column; gap: 8px }
.ui-navrow { display: flex; align-items: flex-end; gap: 10px; padding: 10px; border: 1px solid var(--hair); border-radius: 12px; background: var(--wash) }
.ui-navgrip { cursor: grab; color: var(--ink3); padding: 6px 2px; align-self: center; fill: currentColor }
.ui-navgrip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px }
.ui-navcell { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0 }
.ui-navnarrow { flex: 0 0 auto }
.ui-navlab { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3) }
.ui-navown { margin-top: 5px }
.ui-navtick { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink2); white-space: nowrap; padding-bottom: 8px }
.ui-navx { border: 0; background: none; color: var(--ink3); font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px 6px }
.ui-navx:hover { color: var(--ink) }
.ui-navadd { align-self: flex-start }
@media (max-width: 760px) {
  .ui-navrow { flex-wrap: wrap; align-items: stretch }
  .ui-navcell { flex: 1 1 100% }
  .ui-navtick { padding-bottom: 0 }
}
</style>

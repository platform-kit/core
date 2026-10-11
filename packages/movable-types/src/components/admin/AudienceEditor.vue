<script setup>
/*
 * Who an email goes to, as a list of rules: only the rules the audience has are on the page,
 * each with its own control and nothing else; "Add a rule" offers the rest. Kept in the
 * markdown's own words (`inactive: 7d+`, `subscription: [none]`), never the query's json
 * (_shared/emails/rules.js turns one into the other). Below the list, the rules read back in
 * words and "Who matches now" — the count from email_audience_count, never the list. The
 * choices are the site's: the areas from the published diagnostics, the levels from the
 * glossary, the tiers from the membership products, the books from the shelf, the statements
 * from the bank.
 */
import { ref, computed, watch } from 'vue'
import { books as BOOKS, products as PRODUCTS } from '#content'
import { DOMAINS, LEVELS, CHS, STATEMENTS } from '#site/instrument'   /* the site's vocabulary for a reading — its areas, levels, charges and statements — or the kit's empty default */
import { normalizeRules, describeRules } from '@platform-kit/kit/supabase/functions/_shared/emails/rules.js'
import { supabase, configured as supabaseOn } from '@platform-kit/kit/lib/supabase.js'
import { isSignedIn } from '@platform-kit/kit/lib/auth.js'

const props = defineProps({ modelValue: { type: Object, default: () => ({}) } })
const emit = defineEmits(['update:modelValue'])
const a = computed(() => props.modelValue || {})
const set = (k, v) => { const next = { ...a.value }; if (v == null || v === '' || (Array.isArray(v) && !v.length)) delete next[k]; else next[k] = v; emit('update:modelValue', next) }

/* the rules there are, each with the control it takes */
const RULES = [
  { key: 'inactive', label: 'Last active', hint: 'an event, an answer, or the profile', kind: 'span' },
  { key: 'signed-up', label: 'Signed up', hint: 'the account\'s age', kind: 'span' },
  { key: 'since-purchase', label: 'Last purchase', hint: 'a paid order', kind: 'span', none: true },
  { key: 'since-session', label: 'Last coaching session', hint: 'attended', kind: 'span', none: true },
  { key: 'subscription', label: 'Membership', hint: 'none, any, or a tier', kind: 'tiers' },
  { key: 'level', label: 'Working at', hint: 'the level their last reading placed them at', kind: 'levels' },
  { key: 'interest', label: 'Interested in', hint: 'took the area\'s diagnostic, or read content tagged with it', kind: 'areas' },
  { key: 'bought', label: 'Bought', hint: 'any of these books', kind: 'books' },
  { key: 'not-bought', label: 'Never bought', hint: 'none of these books', kind: 'books' },
  /* ONE VOCABULARY: the two things the rest of the product already gates on — a role somebody
     holds on the site, and a capability somebody has been granted in a space — said here in the
     same words a bot says them in. */
  { key: 'role', label: 'Holds the role', hint: 'what they run on this site', kind: 'roles' },
  { key: 'grant', label: 'May', hint: 'a capability they have been granted in a space', kind: 'grants' },
  { key: 'verified', label: 'Address', hint: 'confirmed or not', kind: 'verified' },
  { key: 'answered', label: 'Answered', hint: 'a specific statement, as they answered it', kind: 'answered' },
]
/* the site's roles and a space's capabilities, named once each. Both lists are short and closed —
   a role nobody holds and a capability nothing grants would be a rule matching nobody. */
const ROLES = ['admin', 'provider', 'editor', 'support', 'analyst']
const GRANTS = ['voice', 'file', 'mention-channel', 'moderate', 'invite']
const byKey = Object.fromEntries(RULES.map((r) => [r.key, r]))
/* a rule is on the page while the audience carries it — or while it was just added and is still blank */
const added = ref([])
const active = computed(() => RULES.filter((r) => a.value[r.key] != null || added.value.includes(r.key)))
const available = computed(() => RULES.filter((r) => !active.value.includes(r)))
function add(key) { if (!key) return; if (!added.value.includes(key)) added.value.push(key); if (key === 'answered' && !a.value.answered) set('answered', [{ item: '' }]) }
function drop(key) { added.value = added.value.filter((k) => k !== key); set(key, null) }

/* the choices */
const TIERS = [...new Map(PRODUCTS.filter((p) => p.kind === 'membership' && p.tier).map((p) => [p.tier, p.title])).entries()]
const AREAS = DOMAINS.map(([k, name]) => [k, name])
const LVLS = Object.entries(LEVELS).map(([k, l]) => [k, l.name])
const BOOKLIST = BOOKS.map((b) => [b.slug, b.title])
const CHARGES = [['clear', 'nothing stirred'], ...CHS.map((c) => [c.k, c.label])]
const bookName = (slug) => { const b = BOOKLIST.find(([s]) => s === slug); return b ? b[1] : slug }
const statementText = (id) => { const s = STATEMENTS.find((x) => x.id === id); return s ? s.text : '' }

/* a span rule as three controls: the mode, the number, the unit */
const UNITS = [['d', 'days'], ['w', 'weeks'], ['h', 'hours']]
function spanParts(v) {
  const t = String(v || '').trim()
  if (!t) return { mode: 'atleast', n: 7, u: 'd' }
  if (/^(none|never)$/i.test(t)) return { mode: 'none', n: 7, u: 'd' }
  const m = /^(\d+(?:\.\d+)?)([dwh])?\s*([+-])?$/i.exec(t)
  if (m) return { mode: m[3] === '-' ? 'within' : 'atleast', n: Number(m[1]), u: (m[2] || 'd').toLowerCase() }
  return { mode: 'atleast', n: 7, u: 'd' }
}
const spanOf = (p) => (p.mode === 'none' ? 'none' : p.mode === 'within' ? `${p.n}${p.u}-` : `${p.n}${p.u}+`)
const setSpan = (k, patch) => set(k, spanOf({ ...spanParts(a.value[k]), ...patch }))

const listOf = (k) => (Array.isArray(a.value[k]) ? a.value[k] : a.value[k] ? String(a.value[k]).split(/[,\s]+/) : []).filter(Boolean)
const toggle = (k, v) => { const l = listOf(k); set(k, l.includes(v) ? l.filter((x) => x !== v) : [...l, v]) }
const toggleTier = (v) => { let l = listOf('subscription'); if (l.includes(v)) l = l.filter((x) => x !== v); else if (v === 'none' || v === 'any') l = [v]; else l = [...l.filter((x) => x !== 'none' && x !== 'any'), v]; set('subscription', l) }

/* the specific answers: rows of item · truth · charge */
const answered = computed(() => (Array.isArray(a.value.answered) ? a.value.answered : []).map((r) => (typeof r === 'string' ? parseRow(r) : { item: r.item || '', truth: r.truth || '', charge: r.charge || '' })))
const parseRow = (s) => { const m = /^\s*([\w-]+\.[\w-]+)\s*(?:=\s*(\w+))?\s*,?\s*(\w+)?\s*$/.exec(s) || []; return { item: m[1] || '', truth: m[2] || '', charge: m[3] || '' } }
const writeAnswered = (rows) => set('answered', rows.map((r) => ({ item: r.item, ...(r.truth ? { truth: r.truth } : {}), ...(r.charge ? { charge: r.charge } : {}) })))
const patchAnswered = (i, patch) => writeAnswered(answered.value.map((r, j) => (j === i ? { ...r, ...patch } : r)))
const dropAnswered = (i) => { const rows = answered.value.filter((_, j) => j !== i); if (rows.length) writeAnswered(rows); else drop('answered') }

/* the rules read back, and the count */
const rules = computed(() => normalizeRules(a.value, { skusOf: (slug) => PRODUCTS.filter((p) => p.book === slug).map((p) => p.sku) }))
const words = computed(() => describeRules(rules.value))
const count = ref(null), counting = ref(false), countErr = ref('')
async function countNow() {
  if (!supabaseOn || !isSignedIn.value) { countErr.value = 'Sign in as an admin to count'; return }
  counting.value = true; countErr.value = ''
  try { const { data, error } = await supabase.rpc('email_audience_count', { rules: rules.value }); if (error) throw error; count.value = data } catch (e) { countErr.value = e.message || 'Could not count' }
  finally { counting.value = false }
}
watch(rules, () => { count.value = null })
</script>

<template>
  <div class="ae">
    <p v-if="!active.length" class="ae-everyone">Everyone reachable — every account with an address that has not opted out. Add a rule to narrow it.</p>

    <div v-for="r in active" :key="r.key" class="ae-rule">
      <div class="ae-rule-head">
        <b>{{ r.label }}</b><span class="ui-hint">{{ r.hint }}</span>
        <span class="ui-grow" />
        <button type="button" class="ui-btn ui-ghost ui-sm" title="Remove this rule" @click="drop(r.key)">Remove</button>
      </div>

      <div v-if="r.kind === 'span'" class="ae-span">
        <select class="ui-select" :value="spanParts(a[r.key]).mode" @change="setSpan(r.key, { mode: $event.target.value })">
          <option value="atleast">at least</option><option value="within">within</option><option v-if="r.none" value="none">never</option>
        </select>
        <template v-if="spanParts(a[r.key]).mode !== 'none'">
          <input class="ui-input ae-n" type="number" min="0" step="1" :value="spanParts(a[r.key]).n" @input="setSpan(r.key, { n: Number($event.target.value) })" />
          <select class="ui-select ae-u" :value="spanParts(a[r.key]).u" @change="setSpan(r.key, { u: $event.target.value })"><option v-for="[u, name] in UNITS" :key="u" :value="u">{{ name }}</option></select>
          <span class="ui-hint">ago</span>
        </template>
      </div>

      <div v-else-if="r.kind === 'tiers'" class="ui-chips">
        <button type="button" class="ui-chip" :class="{ 'ui-on': listOf('subscription').includes('none') }" @click="toggleTier('none')">None</button>
        <button type="button" class="ui-chip" :class="{ 'ui-on': listOf('subscription').includes('any') }" @click="toggleTier('any')">Any</button>
        <button v-for="[t, name] in TIERS" :key="t" type="button" class="ui-chip" :class="{ 'ui-on': listOf('subscription').includes(t) }" @click="toggleTier(t)">{{ name }}</button>
      </div>
      <div v-else-if="r.kind === 'roles'" class="ui-chips"><button v-for="k in ROLES" :key="k" type="button" class="ui-chip" :class="{ 'ui-on': listOf('role').includes(k) }" @click="toggle('role', k)">{{ k }}</button></div>
      <div v-else-if="r.kind === 'grants'" class="ui-chips"><button v-for="k in GRANTS" :key="k" type="button" class="ui-chip" :class="{ 'ui-on': listOf('grant').includes(k) }" @click="toggle('grant', k)">{{ k }}</button></div>
      <div v-else-if="r.kind === 'levels'" class="ui-chips"><button v-for="[k, name] in LVLS" :key="k" type="button" class="ui-chip" :class="{ 'ui-on': listOf('level').includes(k) }" @click="toggle('level', k)">{{ name }}</button></div>
      <div v-else-if="r.kind === 'areas'" class="ui-chips"><button v-for="[k, name] in AREAS" :key="k" type="button" class="ui-chip" :class="{ 'ui-on': listOf('interest').includes(k) }" @click="toggle('interest', k)">{{ name }}</button></div>

      <div v-else-if="r.kind === 'books'" class="ui-chips">
        <button v-for="slug in listOf(r.key)" :key="slug" type="button" class="ui-chip ui-on" title="Remove" @click="toggle(r.key, slug)">{{ bookName(slug) }} <span class="ae-x">×</span></button>
        <select class="ui-select ae-add" value="" @change="$event.target.value && toggle(r.key, $event.target.value); $event.target.value = ''">
          <option value="">+ Add a book</option><option v-for="[slug, name] in BOOKLIST.filter(([s]) => !listOf(r.key).includes(s))" :key="slug" :value="slug">{{ name }}</option>
        </select>
      </div>

      <div v-else-if="r.kind === 'verified'">
        <select class="ui-select ae-one" :value="a.verified === true || a.verified === 'true' ? 'yes' : 'no'" @change="set('verified', $event.target.value === 'yes')">
          <option value="yes">confirmed</option><option value="no">not confirmed</option>
        </select>
      </div>

      <div v-else-if="r.kind === 'answered'" class="ae-answers">
        <div v-for="(row, i) in answered" :key="i" class="ae-row">
          <input class="ui-input ui-mono" list="ae-statements" :value="row.item" placeholder="start typing a statement" @change="patchAnswered(i, { item: $event.target.value.trim() })" />
          <select class="ui-select" :value="row.truth" @change="patchAnswered(i, { truth: $event.target.value })"><option value="">true — any</option><option value="yes">true — yes</option><option value="no">true — no</option><option value="partly">true — partly</option></select>
          <select class="ui-select" :value="row.charge" @change="patchAnswered(i, { charge: $event.target.value })"><option value="">stirred — any</option><option v-for="[k, name] in CHARGES" :key="k" :value="k">{{ name }}</option></select>
          <button type="button" class="ui-btn ui-ghost ui-sm" title="Remove" @click="dropAnswered(i)">×</button>
          <small v-if="statementText(row.item)" class="ae-stmt">{{ statementText(row.item) }}</small>
        </div>
        <datalist id="ae-statements"><option v-for="s in STATEMENTS" :key="s.id" :value="s.id">{{ s.area }} · {{ s.text }}</option></datalist>
        <div><button type="button" class="ui-btn ui-ghost ui-sm" @click="writeAnswered([...answered, { item: '' }])">+ Another statement</button></div>
      </div>
    </div>

    <div class="ae-add-row">
      <select v-if="available.length" class="ui-select ae-addrule" value="" @change="add($event.target.value); $event.target.value = ''">
        <option value="">+ Add a rule</option>
        <option v-for="r in available" :key="r.key" :value="r.key">{{ r.label }} — {{ r.hint }}</option>
      </select>
    </div>

    <div class="ae-foot">
      <div class="ui-chips"><span v-for="w in words" :key="w" class="ui-chip ui-static">{{ w }}</span></div>
      <span class="ui-grow" />
      <span v-if="count != null" class="ui-kpi ae-count"><b>{{ count }}</b><span>match now</span></span>
      <span v-if="countErr" class="ui-err">{{ countErr }}</span>
      <button type="button" class="ui-btn ui-sm" :disabled="counting" @click="countNow">{{ counting ? 'Counting…' : count != null ? 'Count again' : 'Who matches now?' }}</button>
    </div>
  </div>
</template>

<style scoped>
.ae { display: flex; flex-direction: column; gap: 10px }
.ae-everyone { margin: 0; font-size: 14px; color: var(--ink2); line-height: 1.5 }
.ae-rule { border: 1px solid var(--hair); border-radius: 12px; padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 10px; background: color-mix(in srgb, var(--wash) 40%, var(--card)) }
.ae-rule-head { display: flex; align-items: baseline; gap: 8px } .ae-rule-head b { font-size: 13.5px; font-weight: 600 }
.ae-span { display: flex; align-items: center; gap: 6px } .ae-span .ui-select { width: auto } .ae-n { width: 64px; text-align: center }
.ae-one { width: auto; min-width: 160px }
.ae-add { width: auto; max-width: 170px; height: 28px; font-size: 12.5px; border-radius: 999px; padding: 0 8px; color: var(--ink3) }
.ae-x { opacity: .7; margin-left: 2px }
.ae-answers { display: flex; flex-direction: column; gap: 8px }
.ae-row { display: grid; grid-template-columns: minmax(180px, 1.6fr) 1fr 1fr auto; gap: 6px; align-items: center }
.ae-stmt { grid-column: 1 / -1; font-size: 12px; color: var(--ink3); margin: -2px 0 2px 2px }
.ae-add-row { display: flex } .ae-addrule { width: auto; max-width: 340px; color: var(--ink2) }
.ae-foot { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--hair) }
.ae-count b { font-size: 18px }
</style>

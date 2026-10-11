<script setup>
/*
 * EVERYBODY WITH AN ACCOUNT HERE, and what the site already knows about each of them.
 *
 * This was a grid of the five roles over the people who already held one — which is what GRANTING a
 * role needs, and is useless for the other question an operator has all day: who are my customers,
 * what did this person buy, why has their address never been confirmed. So the list is now every
 * account, narrowed by what the site already knows, and a person opens into everything it holds
 * about them: their roles, what they hold, what they bought, what they pay, what they booked, and a
 * way out to their invoices at the processor.
 *
 * NOTHING HERE IS EDITABLE BUT A ROLE. It is a page for seeing who somebody is; changing their
 * address, their name or their membership from behind their back is not a thing this admin does.
 * The one write goes through `set_roles`, which is already the only writer and holds the rules
 * worth holding — an administrator only, and never the last `admin` away — so this shows what that
 * writer answered, including its refusals, in its own words.
 *
 * Nothing about a card or a bank has ever been in this database and this is not the place to start:
 * the invoices are a link out, built from the customer id the processor gave us.
 *
 * Words from content/app/ui/people.md (scope `people`).
 */
import { ref, computed, onMounted, watch } from 'vue'
import { supabase } from '@platform-kit/kit/lib/supabase.js'
import { us } from '@platform-kit/kit/lib/content.js'
import { user } from '@platform-kit/kit/lib/auth.js'
import { traitsOf } from '@platform-kit/kit/lib/awards.js'
import AdminHead from './AdminHead.vue'

const W = computed(() => us('people').page.main)
const R = computed(() => us('people').roles.main)
/* the five, in the order they are drawn — the database holds the same list and refuses any other */
const ROLES = ['admin', 'provider', 'editor', 'support', 'analyst']
const NARROWS = ['all', 'staff', 'provider', 'member', 'paid', 'unconfirmed']
const PAGE = 50
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))

const rows = ref([])
const total = ref(0)
const q = ref('')
const narrow = ref('all')
const busy = ref('')
const said = ref('')
const loading = ref(true)

async function load(more = false) {
  loading.value = true
  try {
    const { data } = await supabase.rpc('admin_everybody', {
      p_q: q.value.trim() || null, p_narrow: narrow.value,
      p_limit: PAGE, p_offset: more ? rows.value.length : 0,
    })
    const got = data || { people: [], total: 0 }
    rows.value = more ? [...rows.value, ...(got.people || [])] : (got.people || [])
    total.value = Number(got.total) || 0
  } finally { loading.value = false }
}
onMounted(load)
let timer = null
watch(q, () => { clearTimeout(timer); timer = setTimeout(() => load(), 250) })
watch(narrow, () => load())

/* ------------------------------------------------------------------ one person */

const openId = ref('')
const person = ref(null)
const traits = ref([])
async function open(row) {
  openId.value = row.id
  person.value = null
  traits.value = []
  const { data } = await supabase.rpc('admin_person', { p_user: row.id })
  person.value = data || null
  /* WHAT THE SITE HAS COME TO BELIEVE about them: a note for whoever is about to talk to them. The
     read refuses anybody the declaration (content/traits.md) does not name, so this only asks. */
  try { traits.value = await traitsOf(row.id) } catch { traits.value = [] }
}
function back() { openId.value = ''; person.value = null; traits.value = [] }

const holds = (role) => !!person.value && (person.value.roles || []).includes(role)
const mine = (id) => !!user.value && id === user.value.id

async function toggle(role) {
  if (busy.value || !person.value) return
  busy.value = role
  said.value = ''
  const had = person.value.roles || []
  const want = had.includes(role) ? had.filter((r) => r !== role) : [...had, role]
  try {
    const { data, error } = await supabase.rpc('set_roles', { p_user: person.value.id, p_roles: want })
    if (error) { said.value = error.message; return }
    if (!data || !data.ok) {
      /* the database's own refusals, said in the site's words */
      said.value = data && data.why === 'last-admin' ? W.value['last-admin'] : (W.value.refused || '')
      return
    }
    person.value = { ...person.value, roles: want }
    const inList = rows.value.find((r) => r.id === person.value.id)
    if (inList) inList.roles = want
  } finally { busy.value = '' }
}

/* what somebody IS, in the words the list uses — read off what the site already knows and never
   off anything they typed about themselves */
const marks = (row) => [
  ...((row.roles || []).length ? [{ k: 'staff', w: W.value['is-staff'] }] : []),
  ...(row.member ? [{ k: 'member', w: W.value['is-member'] }] : []),
  ...(row.customer ? [{ k: 'customer', w: W.value['is-customer'] }] : []),
  ...(row.verified === false ? [{ k: 'unconfirmed', w: W.value['is-unconfirmed'] }] : []),
]
const when = (v) => { const d = new Date(v); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) }
const money = (a, c) => (a == null ? '' : new Intl.NumberFormat(undefined, { style: 'currency', currency: (c || 'usd').toUpperCase() }).format(Number(a) / 100))
/* the processor's own page for this customer — the site keeps the id and nothing else */
const invoicesAt = computed(() => (person.value && person.value.billing_id
  ? 'https://dashboard.stripe.com/customers/' + person.value.billing_id : ''))
</script>

<template>
  <section class="ui-page">
    <!-- ONE PERSON, opened out of the list -->
    <template v-if="openId">
      <button type="button" class="pp-back" @click="back">← {{ W.back }}</button>
      <header class="pp-phead">
        <template v-if="person">
          <h2>{{ person.name }}<em v-if="mine(person.id)">{{ W.you }}</em></h2>
          <p>
            <code>{{ person.email }}</code>
            <span v-if="!person.verified_at" class="pp-mark unconfirmed">{{ W['is-unconfirmed'] }}</span>
            <span class="pp-quiet">{{ W.joined }} {{ when(person.since) }}</span>
          </p>
        </template>
      </header>
      <p v-if="!person" class="pp-quiet">{{ W.loading }}</p>
      <template v-else>
        <p v-if="said" class="pp-said">{{ said }}</p>

        <!-- THE ONE THING THIS PAGE CHANGES -->
        <section class="pp-panel">
          <h3>{{ W['roles-title'] }}</h3>
          <ul class="pp-roles">
            <li v-for="r in ROLES" :key="r">
              <button
                type="button" class="pp-switch" :class="{ on: holds(r) }" :disabled="busy === r"
                :aria-pressed="holds(r)" :aria-label="R[r]" @click="toggle(r)"><span></span></button>
              <b>{{ R[r] }}</b><i>{{ R[r + '-what'] }}</i>
            </li>
          </ul>
        </section>

        <div class="pp-cols">
          <section class="pp-panel">
            <h3>{{ W['holds-title'] }}</h3>
            <ul v-if="person.entitlements.length" class="pp-lines">
              <li v-for="(e, i) in person.entitlements" :key="i">
                <b>{{ e.key }}<template v-if="e.tier"> · {{ e.tier }}</template></b>
                <i>{{ e.source }}<template v-if="e.expires_at"> · {{ when(e.expires_at) }}</template></i>
              </li>
            </ul>
            <p v-else class="pp-quiet">{{ W['holds-none'] }}</p>
          </section>

          <section class="pp-panel">
            <h3>{{ W['plan-title'] }}</h3>
            <template v-if="person.subscription">
              <p class="pp-plan"><b>{{ person.subscription.sku }}</b><i>{{ person.subscription.status }}</i></p>
              <p v-if="person.subscription.period_end" class="pp-quiet">{{ fill(W['plan-until'], { date: when(person.subscription.period_end) }) }}</p>
              <p v-if="person.subscription.next_sku" class="pp-quiet">{{ fill(W['plan-next'], { sku: person.subscription.next_sku, date: when(person.subscription.next_at) }) }}</p>
            </template>
            <p v-else class="pp-quiet">{{ W['plan-none'] }}</p>
          </section>

          <section class="pp-panel">
            <h3>{{ W['bought-title'] }}</h3>
            <ul v-if="person.purchases.length" class="pp-lines">
              <li v-for="p in person.purchases" :key="p.id">
                <b>{{ p.sku }}</b>
                <i>{{ money(p.amount, p.currency) }} · {{ when(p.at) }}<template v-if="p.status !== 'paid'"> · {{ W.refunded }}</template></i>
              </li>
            </ul>
            <p v-else class="pp-quiet">{{ W['bought-none'] }}</p>
          </section>

          <section class="pp-panel">
            <h3>{{ W['booked-title'] }}</h3>
            <ul v-if="person.bookings.length" class="pp-lines">
              <li v-for="b in person.bookings" :key="b.uid">
                <b>{{ b.title || b.type }}</b>
                <i>{{ when(b.start_at) }} · {{ b.status }}</i>
              </li>
            </ul>
            <p v-else class="pp-quiet">{{ W['booked-none'] }}</p>
          </section>

          <!-- NEVER A CARD, NEVER A BANK. The site keeps the processor's id and nothing else. -->
          <section class="pp-panel">
            <h3>{{ W.invoices }}</h3>
            <p class="pp-quiet">{{ W['invoices-what'] }}</p>
            <a v-if="invoicesAt" class="pp-out" :href="invoicesAt" target="_blank" rel="noopener">{{ W.open }} ↗</a>
            <p v-else class="pp-quiet">{{ W['invoices-none'] }}</p>
          </section>

          <section v-if="traits.length" class="pp-panel">
            <h3>{{ W.traits }}</h3>
            <p class="pp-quiet">{{ W['traits-what'] }}</p>
            <ul class="pp-lines">
              <li v-for="(t, i) in traits" :key="i"><b>{{ t.label || t.key }}</b><i>{{ t.value }}</i></li>
            </ul>
          </section>
        </div>
      </template>
    </template>

    <!-- EVERYBODY -->
    <template v-else>
      <AdminHead :title="W.title" :sub="W['line-everybody']">
        <template #actions>
          <label class="pp-find">
            <input v-model="q" type="search" class="ui-input" :placeholder="W.find" :aria-label="W.find" />
          </label>
          <label class="pp-narrow">{{ W.narrow }}
            <select v-model="narrow" class="ui-select">
              <option v-for="n in NARROWS" :key="n" :value="n">{{ W['narrow-' + n] }}</option>
            </select>
          </label>
          <span v-if="!loading" class="pp-count">{{ fill(W.count, { shown: rows.length, total }) }}</span>
        </template>
      </AdminHead>

      <p v-if="said" class="pp-said">{{ said }}</p>
      <p v-if="loading && !rows.length" class="pp-quiet">{{ W.loading }}</p>
      <p v-else-if="!rows.length" class="pp-quiet">{{ W['none-found'] }}</p>

      <ul v-else class="pp-people">
        <li v-for="row in rows" :key="row.id">
          <button type="button" class="pp-row" @click="open(row)">
            <span class="pp-who">
              <b>{{ row.name }}<em v-if="mine(row.id)">{{ W.you }}</em></b>
              <i>{{ row.email }}</i>
            </span>
            <span class="pp-marks">
              <span v-for="m in marks(row)" :key="m.k" class="pp-mark" :class="m.k">{{ m.w }}</span>
            </span>
            <span class="pp-since">{{ when(row.since) }}</span>
          </button>
        </li>
      </ul>
      <button v-if="rows.length < total" type="button" class="pp-more" :disabled="loading" @click="load(true)">{{ W.more }}</button>
    </template>
  </section>
</template>

<style scoped>
/* the admin's own tokens; every class is pp-prefixed, because the site's stylesheet owns bare names */
.pp-find { flex: 0 1 260px; min-width: 160px; display: flex }
.pp-find input { width: 100%; max-width: 260px; font: inherit; font-size: 14px; color: var(--ink); background: var(--card);
  border: 1px solid var(--hair); border-radius: 9px; padding: 8px 12px }
.pp-narrow { display: inline-flex; align-items: center; gap: 7px; font-family: var(--m); font-size: 11px;
  letter-spacing: .05em; text-transform: uppercase; color: var(--ink3) }
.pp-narrow select { font: inherit; font-family: var(--f); font-size: 13px; letter-spacing: 0; text-transform: none;
  color: var(--ink); background: var(--card); border: 1px solid var(--hair); border-radius: 8px; padding: 5px 9px; width: auto }
.pp-count { font-family: var(--m); font-size: 11.5px; color: var(--ink3); white-space: nowrap }
.pp-said { margin: 0 0 14px; font-size: 13.5px; color: #c8382f }
.pp-quiet { margin: 8px 0; font-size: 13.5px; color: var(--ink3) }

.pp-people { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px }
.pp-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 14px; align-items: center;
  width: 100%; text-align: left; font: inherit; background: none; border: 0; border-radius: 10px;
  padding: 10px 12px; cursor: pointer }
.pp-row:hover { background: color-mix(in srgb, var(--ink) 4%, transparent) }
.pp-who { display: flex; flex-direction: column; gap: 1px; min-width: 0 }
.pp-who b { font-size: 14.5px; font-weight: 650; color: var(--ink) }
.pp-who em { font-style: normal; font-family: var(--m); font-size: 10px; letter-spacing: .06em;
  text-transform: uppercase; color: var(--ink3); margin-left: 7px }
.pp-who i { font-style: normal; font-family: var(--m); font-size: 11.5px; color: var(--ink3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.pp-marks { display: flex; flex-wrap: wrap; gap: 5px; justify-content: flex-end }
/* WHAT SOMEBODY IS, read off what the site knows — never off anything they typed about themselves */
.pp-mark { font-family: var(--m); font-size: 10px; font-weight: 600; letter-spacing: .04em;
  text-transform: uppercase; color: var(--ink3); border: 1px solid var(--hair); border-radius: 5px; padding: 2px 6px }
.pp-mark.staff { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 35%, transparent) }
.pp-mark.unconfirmed { color: #9a6b1f; border-color: color-mix(in srgb, #9a6b1f 40%, transparent) }
.pp-since { font-family: var(--m); font-size: 11px; color: var(--ink3); white-space: nowrap }
.pp-more { margin: 16px 0 0; width: auto; font: inherit; font-size: 13px; font-weight: 600; color: var(--ink3);
  background: none; border: 1px dashed var(--hair); border-radius: 9px; padding: 8px 16px; cursor: pointer }
.pp-more:hover { color: var(--ink) }

/* --- one person --- */
.pp-phead { position: relative }
.pp-back { width: auto; font: inherit; font-size: 12.5px; color: var(--ink3); background: none; border: 0;
  padding: 0 0 8px; cursor: pointer; display: block }
.pp-back:hover { color: var(--ink) }
.pp-phead h2 em { font-style: normal; font-family: var(--m); font-size: 11px; letter-spacing: .06em;
  text-transform: uppercase; color: var(--ink3); margin-left: 9px }
.pp-phead p { display: flex; flex-wrap: wrap; align-items: center; gap: 10px }
.pp-phead code { font-family: var(--m); font-size: 12.5px; color: var(--ink2) }

.pp-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); gap: 14px; margin-top: 14px }
.pp-panel { background: var(--card); border: 1px solid var(--hair); border-radius: 13px; padding: 15px 17px }
.pp-panel h3 { margin: 0 0 9px; font-family: var(--m); font-size: 10.5px; font-weight: 700;
  letter-spacing: .07em; text-transform: uppercase; color: var(--ink3) }
.pp-lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px }
.pp-lines li { display: flex; flex-direction: column; gap: 1px }
.pp-lines b { font-size: 13.5px; font-weight: 600; color: var(--ink) }
.pp-lines i, .pp-plan i { font-style: normal; font-family: var(--m); font-size: 11.5px; color: var(--ink3) }
.pp-plan { display: flex; align-items: baseline; gap: 9px; margin: 0 }
.pp-plan b { font-size: 14px; font-weight: 650; color: var(--ink) }
.pp-out { display: inline-block; margin-top: 8px; font-size: 13px; font-weight: 600;
  color: var(--ink); text-decoration: underline; text-underline-offset: 3px }

.pp-roles { list-style: none; margin: 0; padding: 0; display: grid;
  grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); gap: 10px 18px }
.pp-roles li { display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: auto auto;
  column-gap: 10px; align-items: center }
.pp-roles b { font-size: 13.5px; font-weight: 650; color: var(--ink) }
.pp-roles i { grid-column: 2; font-style: normal; font-size: 11.5px; color: var(--ink3) }
.pp-roles .pp-switch { grid-row: 1 / 3 }
.pp-switch { width: 34px; height: 20px; padding: 0; border: 0; border-radius: 999px; cursor: pointer;
  background: color-mix(in srgb, var(--ink) 16%, transparent); transition: background .15s }
.pp-switch span { display: block; width: 16px; height: 16px; margin: 2px; border-radius: 999px;
  background: var(--paper); transition: transform .15s }
.pp-switch.on { background: var(--sp-go, #2f8f6b) }
.pp-switch.on span { transform: translateX(14px) }
.pp-switch:disabled { opacity: .5; cursor: default }
</style>

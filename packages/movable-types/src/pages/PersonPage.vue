<script setup>
/*
 * A PERSON. Two pages that are one route, because they are one thing seen from two sides:
 *
 *   /p/<username>  — somebody's own page, as anybody sees it. It exists only where its owner has
 *                    turned it on: a profile is private until they say otherwise, and a directory
 *                    of everybody who ever signed up, indexed, is not a thing to publish on
 *                    somebody's behalf. A name nobody holds, or one whose holder has kept their
 *                    page private, is the same answer — not found — so nothing here says whether
 *                    an account exists.
 *
 *   /p             — the reader's own settings: what they are called, the face they wear, the line
 *                    they wrote, whether that page is public at all.
 *
 * Words from the `account` scope.
 */
import { computed, ref, watch, onMounted } from 'vue'
import { route, ROUTES, navigate } from '@platform-kit/kit/lib/router.js'
import { us } from '@platform-kit/kit/lib/content.js'
import { isSignedIn, authSettled } from '@platform-kit/kit/lib/auth.js'
import { me, loadMe, saveMe, nameFree, usernameOk, personOf, uploadAvatar } from '@platform-kit/kit/lib/account.js'
import { faceOf } from '@platform-kit/kit/lib/avatar.js'
import { offeringsOf, managedOf } from '@platform-kit/kit/lib/booking.js'
import { myTeams } from '@platform-kit/kit/lib/teams.js'
import { catalogue as ALL, awardsOf } from '@platform-kit/kit/lib/awards.js'
import AwardBadge from '../components/AwardBadge.vue'
import { setHead } from '@platform-kit/kit/lib/seo.js'
import SiteLayout from '../layouts/SiteLayout.vue'
import AvatarPicker from '../components/AvatarPicker.vue'
import SiteClose from '../components/SiteClose.vue'
import { moduleOn } from '@platform-kit/kit/lib/modules.js'
import { user } from '@platform-kit/kit/lib/auth.js'
import { personOf as networkPerson, authorFeed, follow, block, mute, net, admission } from '@platform-kit/kit/lib/network/api.js'
import NetPost from '../components/network/NetPost.vue'
import NetReport from '../components/network/NetReport.vue'
import NetApps from '../components/network/NetApps.vue'
import NetJoin from '../components/network/NetJoin.vue'
import site from '#site'
import { showsFollowing } from '@platform-kit/kit/lib/community/places.js'
import { supabase } from '@platform-kit/kit/lib/supabase.js'
import { openDm } from '@platform-kit/kit/lib/spaces/api.js'
/* the wider network is offered only where the site federates (platformkit.config.js network.federate) */
const FEDERATES = !!(site.network && site.network.federate)

/* THE NETWORK ON SOMEBODY'S PAGE (the network module): how many follow them and whom they follow,
   following them, and what they posted that the reader may read. What may be read is the
   database's to say; the page only asks. */
const NETWORK = moduleOn('network')
/* other apps signing in is the site owner's choice (network.apps), off unless the config says so */
const APPS = NETWORK && !!(site.network && site.network.apps)
/* a site that lists following in community.hide draws no follow control or count (follows are kept) */
const FOLLOWING = showsFollowing((site.community || {}).hide)
const NP = computed(() => us('network').person.main)
const fillN = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const rel = ref(null)
const feed = ref(null)
const relBusy = ref(false)
const relErr = ref('')
const relMenu = ref(false)
const reportingPerson = ref(false)
const reportingPost = ref(null)
const itsMe = computed(() => !!(user.value && them.value && user.value.id === them.value.id))
/* MESSAGE THEM — where the two share a space whose direct messages are on and they have not declined
   them there (space_dm_where asks exactly the rules space_dm_open keeps); otherwise the page says so */
const SPACES = moduleOn('spaces')
const dmSpace = ref(null)
const dmKnown = ref(false)
async function loadDm(t) {
  dmSpace.value = null; dmKnown.value = false
  if (!SPACES || !isSignedIn.value || !t || (user.value && user.value.id === t.id)) return
  const { data } = await supabase.rpc('space_dm_where', { p_with: t.id })
  dmSpace.value = data || null; dmKnown.value = true
}
const dmBusy = ref(false)
async function message() {
  dmBusy.value = true
  try {
    const cid = await openDm(dmSpace.value, [them.value.id])
    if (!cid) { dmSpace.value = null; return }
    const { data } = await supabase.from('channels').select('slug, spaces(slug)').eq('id', cid).single()
    if (data && data.spaces) navigate(ROUTES.spaces + '/' + data.spaces.slug + '/' + data.slug)
  } finally { dmBusy.value = false }
}
async function loadNetwork(t) {
  rel.value = null; feed.value = null
  loadDm(t).catch(() => {})
  if (!NETWORK || !t) return
  rel.value = await networkPerson(t.id).catch(() => null)
  feed.value = authorFeed(t.id)
  feed.value.load(true)
}
async function act(fn, on) {
  if (!isSignedIn.value) { if (window.DLauth) window.DLauth.open(); return }
  relBusy.value = true; relErr.value = ''; relMenu.value = false
  try { await fn(them.value.id, on); rel.value = await networkPerson(them.value.id); if (fn === block) loadNetwork(them.value) }
  catch (e) { relErr.value = e.message || String(e) } finally { relBusy.value = false }
}

const W = computed(() => us('account').page.main)
const F = computed(() => us('account').fields.main)
const G = computed(() => us('awards').gallery.main)
const OF = computed(() => us('account').offers.main)
const TM = computed(() => (us('teams').mine || {}).main || {})
const fillW = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const moneyOf = (c, cur) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format((Number(c) || 0) / 100) } catch (e) { return '' } }
/* WHAT THEY SELL, if anything. The read is the same one the booking surface uses, narrowed to them:
   only live offerings, only where the site allows them at all, and only while they are on terms they
   have agreed to — none of which is a browser's to work out. */
const offers = ref([])

/* WHAT THEY HAVE DONE. The read answers nothing unless the profile is public (or it is their own),
   so the page need not decide that; what it decides is what to draw beside it — the ones still to
   earn, quietly, because a gallery that shows only what somebody has never says what else there is. */
const awards = ref([])
const locked = computed(() => {
  if (!awards.value.length && !(ALL || []).length) return []
  const got = new Set(awards.value.map((x) => x.slug))
  return (ALL || []).filter((x) => x.shown !== false && !got.has(x.slug)).sort((a, b) => (a.order || 99) - (b.order || 99))
})
/* the username in the path, or nothing — which means the reader's own settings */
const handle = computed(() => {
  const p = route.value || ''
  return p.startsWith(ROUTES.people + '/') ? decodeURIComponent(p.slice(ROUTES.people.length + 1).split('/')[0]) : ''
})
const mine = computed(() => !handle.value)

/* ----- somebody else's page ----- */
const them = ref(null)
const looking = ref(true)
watch(handle, async (h) => {
  if (!h) { them.value = null; looking.value = false; return }
  looking.value = true
  try {
    them.value = await personOf(h)
    awards.value = them.value ? await awardsOf(them.value.id) : []
    /* their own offerings, and their copies of the site's managed types — one list, because a
       reader choosing a time is not thinking about which of the two they are choosing from */
    offers.value = them.value
      ? [...(await managedOf(h).catch(() => [])), ...(await offeringsOf(h).catch(() => []))]
      : []
  } catch { them.value = null } finally { looking.value = false }
}, { immediate: true })
watch(them, (t) => {
  if (t) setHead({ title: t.name, description: t.about || '' })
  loadNetwork(t)
})

/* ----- the reader's own settings ----- */
const draft = ref(null)
const saving = ref(false)
const saved = ref(false)
const err = ref('')
const nameState = ref('')   /* '' | checking | free | taken | bad */

async function mineLoad() {
  if (!mine.value || !isSignedIn.value) return
  try { await loadMe(); draft.value = { ...(me.value || {}) }; awards.value = me.value ? await awardsOf(me.value.id) : [] }
  catch (e) { err.value = e.message || String(e) }
}
/* THE TEAMS THEY ARE IN — theirs, on their own account. A team is a group the site points work
   at, so somebody may be in one without ever having asked to be: the page says which and why, and
   leaving is not offered, because a rule that swept them in would sweep them back on the next pass
   and a button that undoes itself is worse than none. */
const teams = ref([])
async function teamsLoad() {
  if (!mine.value || !isSignedIn.value) { teams.value = []; return }
  try { teams.value = await myTeams() } catch (e) { teams.value = [] }
}
const joinedWord = (t) => (t.source === 'fill' ? TM.value['by-fill'] : t.source === 'invite' ? TM.value['by-invite'] : TM.value['by-manual'])
const joinedWhen = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) } catch (e) { return '' } }

/* where the site sells the network, whether this reader may follow anybody (network.access) — asked once
   who they are is known */
onMounted(async () => { await authSettled; mineLoad(); teamsLoad(); if (NETWORK) admission().catch(() => {}) })
watch([mine, isSignedIn], () => { mineLoad(); teamsLoad() })

/* a username is an address, so it is checked as it is typed rather than refused on save */
let tick = 0
watch(() => draft.value && draft.value.username, async (u) => {
  const want = String(u || '').trim().toLowerCase()
  if (!want) { nameState.value = ''; return }
  if (!usernameOk(want)) { nameState.value = 'bad'; return }
  if (me.value && want === me.value.username) { nameState.value = 'free'; return }
  nameState.value = 'checking'
  const n = ++tick
  try { const free = await nameFree(want); if (n === tick) nameState.value = free ? 'free' : 'taken' }
  catch { if (n === tick) nameState.value = '' }
})

const canSave = computed(() => !!draft.value && nameState.value !== 'taken' && nameState.value !== 'bad' && nameState.value !== 'checking')
async function save() {
  if (!draft.value || saving.value) return
  saving.value = true; err.value = ''; saved.value = false
  try {
    const d = draft.value
    await saveMe({
      username: String(d.username || '').trim().toLowerCase() || null,
      display_name: String(d.display_name || '').trim() || null,
      first_name: String(d.first_name || '').trim() || null,
      last_name: String(d.last_name || '').trim() || null,
      about: String(d.about || '').trim() || null,
      avatar: d.avatar || null,
      avatar_style: d.avatar_style || null,
      avatar_seed: d.avatar_seed || null,
      avatar_options: d.avatar_options && Object.keys(d.avatar_options).length ? d.avatar_options : null,
      public_profile: !!d.public_profile,
    })
    draft.value = { ...(me.value || {}) }
    saved.value = true
  } catch (e) { err.value = e.message || String(e) } finally { saving.value = false }
}
/* the picker writes into the draft; nothing is saved until they press save, so trying faces on
   costs nothing and leaving the page changes nothing */
const pickFace = ({ style, seed, options }) => {
  draft.value.avatar = null
  draft.value.avatar_style = style
  /* the seed the database resolved is the default, so choosing it back means choosing nothing */
  draft.value.avatar_seed = seed === (me.value && me.value.seed) ? null : seed
  draft.value.seed = seed
  /* and the parts they designed; nothing chosen is null rather than {}, so "I left it alone" and
     "I chose these" are different answers in the row as well as in the picker */
  draft.value.avatar_options = options && Object.keys(options).length ? options : null
}
async function upload(file) {
  err.value = ''
  try { draft.value.avatar = await uploadAvatar(file) } catch (e) { err.value = e.message || String(e) }
}
const clearFace = () => { draft.value.avatar = null }
</script>

<template>
  <SiteLayout>
    <div class="pp">
      <!-- SOMEBODY ELSE'S PAGE -->
      <template v-if="!mine">
        <div v-if="looking" class="pp-wait"><p>{{ W.looking }}</p></div>
        <article v-else-if="them" class="pp-person">
          <img class="pp-face" :src="faceOf(them)" alt="" width="128" height="128" />
          <h1>{{ them.name }}</h1>
          <p class="pp-handle">@{{ them.username }}</p>
          <p v-if="them.about" class="pp-about">{{ them.about }}</p>
      <!-- THE NETWORK: who follows them, following them, and the rest behind More — all in one row
           under who they are, beside what it acts on -->
      <div v-if="NETWORK && rel" class="pp-net">
        <template v-if="FOLLOWING">
          <span class="pp-net-n">{{ fillN(NP.followers, { n: rel.followers }) }}</span>
          <span class="pp-net-n">{{ fillN(NP['following-count'], { n: rel.following }) }}</span>
          <em v-if="rel.follows_you && !itsMe" class="pp-net-you">{{ NP['follows-you'] }}</em>
        </template>
        <template v-if="!itsMe">
          <button v-if="FOLLOWING && !rel.you_block && net.access.write" type="button" class="pp-net-follow" :class="{ on: rel.you_follow }" :disabled="relBusy" :aria-pressed="rel.you_follow"
            @click="act(follow, !rel.you_follow)">{{ rel.you_follow ? NP.following : NP.follow }}</button>
          <button v-if="dmKnown && dmSpace" type="button" class="pp-net-msg" :disabled="dmBusy" @click="message">{{ NP.message }}</button>
          <em v-else-if="dmKnown && !dmSpace" class="pp-net-nomsg">{{ fillN(NP['no-messages'], { name: them.name }) }}</em>
          <span v-if="isSignedIn" class="pp-net-more">
            <button type="button" class="pp-net-dots" :title="NP.more" :aria-label="NP.more" :aria-expanded="relMenu" @click="relMenu = !relMenu">
              <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="10" r="1.4" /><circle cx="10" cy="10" r="1.4" /><circle cx="15" cy="10" r="1.4" /></svg>
            </button>
            <span v-if="relMenu" class="pp-net-pop" role="menu">
              <button type="button" role="menuitem" @click="act(mute, !rel.you_mute)">{{ rel.you_mute ? NP.unmute : NP.mute }}</button>
              <button type="button" role="menuitem" @click="act(block, !rel.you_block)">{{ rel.you_block ? NP.unblock : NP.block }}</button>
              <button type="button" role="menuitem" @click="relMenu = false; reportingPerson = true">{{ NP.report }}</button>
            </span>
          </span>
        </template>
      </div>
      <p v-if="NETWORK && rel && rel.you_block" class="pp-net-note">{{ NP['blocked-note'] }}</p>
      <em v-if="relErr" class="pp-bad">{{ relErr }}</em>
      <!-- WHAT THEY POSTED that the reader may read -->
      <div v-if="NETWORK && feed && !(rel && rel.you_block)" class="pp-posts">
        <h2>{{ NP.posts }}</h2>
        <div v-if="feed.st.items.length" class="pp-posts-list">
          <NetPost v-for="p in feed.st.items" :key="p.id" :post="p" @report="(x) => reportingPost = x" @reply="(x) => navigate(ROUTES.feed + '/post/' + x.id)" />
        </div>
        <p v-else-if="!feed.st.loading" class="pp-posts-none">{{ NP['no-posts'] }}</p>
      </div>
      <!-- WHAT THEY OFFER. A page that says who somebody is and not what they sell is half a page,
           and an offering is published: its being here is the whole point of it being live. Booking
           happens where every booking happens — the same surface, so nothing is a second way in. -->
      <section v-if="offers.length" class="pp-offers">
        <h2>{{ OF.title }}</h2>
        <p class="pp-offers-line">{{ fillW(OF.line, { name: them.name }) }}</p>
        <ul>
          <li v-for="o in offers" :key="o.id">
            <b>{{ o.title }}</b>
            <span v-if="o.sub" class="pp-o-sub">{{ o.sub }}</span>
            <p v-if="o.about" class="pp-o-about">{{ o.about }}</p>
            <span class="pp-o-facts">{{ o.minutes }} {{ OF.minutes }} · {{ o.priceText || (o.price_cents > 0 ? moneyOf(o.price_cents, o.currency) : OF.free) }}</span>
            <a class="pp-o-book" :href="ROUTES.app + '/coaching'">{{ OF.book }}</a>
          </li>
        </ul>
      </section>
      <!-- WHAT THEY HAVE DONE. Shown on a public page because they made it public and because a
           badge is a thing somebody did; what they have NOT earned is shown quietly beside it,
           since a gallery that shows only what somebody has never says what else there is. -->
      <section v-if="awards.length || locked.length" class="pp-awards">
        <h2>{{ mine ? G['title-own'] : G.title }}</h2>
        <ul>
          <li v-for="x in awards" :key="x.slug">
            <a :href="ROUTES.awards + '/' + x.slug">
              <AwardBadge :award="x" :size="56" held />
              <b>{{ x.title }}</b>
            </a>
          </li>
          <li v-for="x in locked" :key="x.slug" class="is-locked">
            <a :href="ROUTES.awards + '/' + x.slug">
              <AwardBadge :award="x" :size="56" :held="false" />
              <b>{{ x.title }}</b>
            </a>
          </li>
        </ul>
      </section>
        </article>
        <div v-else class="pp-wait">
          <h1>{{ W['none-title'] }}</h1>
          <p>{{ W['none-line'] }}</p>
        </div>
      </template>

      <!-- THE READER'S OWN SETTINGS -->
      <template v-else-if="isSignedIn && draft">
        <header class="pp-head">
          <h1>{{ W.title }}</h1>
          <p>{{ W.line }}</p>
        </header>

        <section class="pp-card">
          <h2>{{ W['face-title'] }}</h2>
          <AvatarPicker
            :avatar="draft.avatar || ''" :style="draft.avatar_style || ''" :seed="draft.seed || ''"
            :options="draft.avatar_options || {}"
            @pick="pickFace" @upload="upload" @clear="clearFace" />
        </section>

        <section class="pp-card">
          <h2>{{ W['who-title'] }}</h2>
          <label class="pp-field">
            <span>{{ F['display-name'] }}</span>
            <input v-model="draft.display_name" type="text" maxlength="60" :placeholder="F['display-name-hint']" />
          </label>
          <div class="pp-two">
            <label class="pp-field"><span>{{ F['first-name'] }}</span><input v-model="draft.first_name" type="text" maxlength="60" /></label>
            <label class="pp-field"><span>{{ F['last-name'] }}</span><input v-model="draft.last_name" type="text" maxlength="60" /></label>
          </div>
          <p class="pp-note">{{ F['names-note'] }}</p>
          <label class="pp-field">
            <span>{{ F.about }}</span>
            <textarea v-model="draft.about" rows="3" maxlength="280"></textarea>
          </label>
        </section>

        <section class="pp-card">
          <h2>{{ W['page-title'] }}</h2>
          <label class="pp-field">
            <span>{{ F.username }}</span>
            <span class="pp-handlefield">
              <i>{{ F['username-prefix'] }}</i>
              <input v-model="draft.username" type="text" maxlength="39" autocapitalize="none" spellcheck="false" />
            </span>
            <em v-if="nameState === 'taken'" class="pp-bad">{{ F['username-taken'] }}</em>
            <em v-else-if="nameState === 'bad'" class="pp-bad">{{ F['username-bad'] }}</em>
            <em v-else-if="nameState === 'free' && draft.username">{{ F['username-free'] }}</em>
            <em v-else>{{ F['username-hint'] }}</em>
          </label>
          <label class="pp-switch">
            <input v-model="draft.public_profile" type="checkbox" :disabled="!draft.username" />
            <span>
              <b>{{ F.public }}</b>
              <i>{{ draft.username ? F['public-note'] : F['public-needs-name'] }}</i>
            </span>
          </label>
          <p v-if="draft.public_profile && draft.username" class="pp-note">
            <a :href="ROUTES.people + '/' + draft.username">{{ (F['public-at'] || '').replace('{url}', ROUTES.people + '/' + draft.username) }}</a>
          </p>
        </section>

        <!-- THE TEAMS THEY ARE IN. Read only: who is in a team is the site's to keep, and this says
             which and how they came to be there rather than pretending it is a setting. -->
        <section v-if="teams.length" class="pp-card">
          <h2>{{ TM.title }}</h2>
          <p class="pp-note">{{ TM.line }}</p>
          <ul class="pp-teams">
            <li v-for="t in teams" :key="t.slug">
              <b>{{ t.name }}</b>
              <i v-if="t.about">{{ t.about }}</i>
              <em>{{ joinedWord(t) }}<template v-if="t.joined_at"> · {{ (TM.since || '').replace('{when}', joinedWhen(t.joined_at)) }}</template></em>
            </li>
          </ul>
        </section>

        <!-- OTHER APPS: where Bluesky's app signs in, and with what (the network module) -->
        <NetJoin v-if="NETWORK && FEDERATES" :username="(me && me.username) || ''" @changed="mineLoad" />
        <NetApps v-if="APPS" :username="(me && me.username) || ''" />

        <div class="pp-bar">
          <button type="button" class="pp-go" :disabled="saving || !canSave" @click="save">{{ saving ? W.saving : W.save }}</button>
          <em v-if="saved" class="pp-saved">{{ W.saved }}</em>
          <em v-if="err" class="pp-bad">{{ err }}</em>
        </div>
      </template>

      <div v-else class="pp-wait">
        <h1>{{ W['signin-title'] }}</h1>
        <p>{{ W['signin-line'] }}</p>
      </div>
    </div>
    <SiteClose v-if="!mine" />
    <NetReport v-if="reportingPerson && them" :person="them.id" @close="reportingPerson = false" />
    <NetReport v-if="reportingPost" :post="reportingPost" @close="reportingPost = null" />
  </SiteLayout>
</template>

<style scoped>
.pp-teams { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px }
.pp-teams li { display: flex; flex-direction: column; gap: 2px; padding: 11px 13px; border: 1px solid var(--hair); border-radius: 12px; background: var(--card) }
.pp-teams b { font-size: 15px; font-weight: 600 }
.pp-teams i { font-style: normal; font-size: 13.5px; color: var(--ink2); line-height: 1.5 }
.pp-teams em { font-style: normal; font-size: 12px; color: var(--ink3) }
.pp { max-width: 680px; margin: 0 auto; padding: 54px 24px 90px }
.pp-head { margin: 0 0 26px; padding: 0; border: 0 }
.pp-head h1 { margin: 0 0 6px; font-family: var(--fd); font-size: clamp(30px, 4vw, 40px); font-weight: 700;
  letter-spacing: -.02em; color: var(--ink) }
.pp-head p { margin: 0; max-width: 56ch; font-size: 15px; line-height: 1.6; color: var(--ink2) }

.pp-card { margin: 0 0 18px; padding: 22px 24px; background: var(--paper); border: 1px solid var(--hair); border-radius: 16px }
.pp-card h2 { margin: 0 0 16px; font-family: var(--fd); font-size: 17px; font-weight: 700; letter-spacing: -.01em; color: var(--ink) }

.pp-field { display: block; margin: 0 0 14px }
.pp-field > span { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 700; letter-spacing: .04em;
  text-transform: uppercase; color: var(--ink3) }
.pp-field input[type=text], .pp-field textarea { box-sizing: border-box; width: 100%; font: inherit; font-size: 15px;
  color: var(--ink); background: color-mix(in srgb, var(--ink) 3%, var(--paper)); border: 1px solid var(--hair);
  border-radius: 10px; padding: 10px 12px; resize: vertical }
.pp-field input:focus-visible, .pp-field textarea:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 1px }
.pp-field em { display: block; margin-top: 5px; font-style: normal; font-size: 12.5px; color: var(--ink3) }
.pp-bad { color: #c8382f !important }
.pp-two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px }
.pp-note { margin: -6px 0 14px; font-size: 12.5px; line-height: 1.5; color: var(--ink3) }
/* a note that follows a switch is a line of its own, not one pulled up under a field */
.pp-switch + .pp-note { margin: 12px 0 0 27px }
.pp-handlefield { display: flex; align-items: center; gap: 0; border: 1px solid var(--hair); border-radius: 10px;
  background: color-mix(in srgb, var(--ink) 3%, var(--paper)); overflow: hidden }
.pp-handlefield i { font-style: normal; text-transform: none; letter-spacing: 0; font-family: var(--m);
  font-size: 14px; color: var(--ink3); padding: 10px 1px 10px 12px }
.pp-handlefield input[type=text] { flex: 1 1 auto; min-width: 0; width: auto;
  border: 0; border-radius: 0; background: transparent; padding-left: 2px }

.pp-switch { display: flex; gap: 11px; align-items: flex-start; margin-top: 4px; cursor: pointer }
.pp-switch input { margin-top: 3px }
.pp-switch b { display: block; font-size: 14.5px; font-weight: 700; color: var(--ink) }
.pp-switch i { display: block; margin-top: 2px; font-style: normal; font-size: 13px; line-height: 1.5; color: var(--ink3) }

.pp-bar { display: flex; align-items: center; gap: 14px; margin-top: 22px }
.pp-go { font: inherit; font-size: 14.5px; font-weight: 700; color: var(--paper); background: var(--ink);
  border: 0; border-radius: 10px; padding: 11px 22px; cursor: pointer }
.pp-go:disabled { opacity: .45; cursor: default }
.pp-saved { font-style: normal; font-size: 13px; color: var(--ink3) }

/* somebody else's page */
.pp-person { text-align: center; padding: 20px 0 40px }
.pp-face { border-radius: 26px; display: block; margin: 0 auto 20px;
  background: color-mix(in srgb, var(--ink) 5%, transparent) }
/* the site's h1 is capped at 16ch for a page's title; a name centred under a face is not one */
.pp-person h1 { max-width: none; margin: 0; font-family: var(--fd); font-size: clamp(28px, 4vw, 38px); font-weight: 700;
  letter-spacing: -.02em; color: var(--ink) }
.pp-handle { margin: 4px 0 0; font-family: var(--m); font-size: 13px; color: var(--ink3) }
.pp-about { margin: 18px auto 0; max-width: 50ch; font-size: 16px; line-height: 1.65; color: var(--ink2) }
.pp-awards { margin: 44px 0 0; text-align: left }
.pp-awards h2 { margin: 0 0 16px; font-family: var(--m); font-size: 11px; font-weight: 700; letter-spacing: .14em;
  text-transform: uppercase; color: var(--ink3); text-align: center }
.pp-awards ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 18px 14px;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)) }
.pp-awards a { display: grid; justify-items: center; gap: 8px; text-decoration: none; color: inherit }
.pp-awards b { font-size: 12px; font-weight: 650; line-height: 1.35; text-align: center; color: var(--ink2) }
.pp-awards li.is-locked b { color: var(--ink3) }
.pp-awards a:hover b { color: var(--ink) }

/* what they sell, in the page's own voice: a card each, the facts quiet, the way in plain */
.pp-offers { margin: 44px 0 0; text-align: left }
.pp-offers h2 { margin: 0 0 6px; font-family: var(--m); font-size: 11px; font-weight: 700; letter-spacing: .14em;
  text-transform: uppercase; color: var(--ink3); text-align: center }
.pp-offers-line { margin: 0 0 18px; font-size: 14px; color: var(--ink3); text-align: center }
.pp-offers ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)) }
.pp-offers li { display: flex; flex-direction: column; gap: 6px; padding: 18px 18px 16px; border: 1px solid var(--hair); border-radius: 14px; background: var(--card) }
.pp-offers b { font-family: var(--fd); font-size: 17px; font-weight: 600; line-height: 1.25; color: var(--ink) }
.pp-o-sub { font-size: 13.5px; color: var(--ink2) }
.pp-o-about { margin: 4px 0 0; font-size: 13.5px; line-height: 1.55; color: var(--ink3) }
.pp-o-facts { font-family: var(--m); font-size: 11.5px; color: var(--ink3); margin-top: auto; padding-top: 10px }
.pp-o-book { align-self: flex-start; font-size: 13.5px; padding: 8px 16px; border-radius: 999px; background: var(--ink); color: var(--paper); text-decoration: none }
.pp-o-book:hover { opacity: .88 }

/* the network, under who they are */
.pp-net { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px 14px; margin: 18px 0 0 }
.pp-net-n { font-size: 14px; color: var(--ink2) }
.pp-net-you { font-style: normal; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; color: var(--ink3); background: color-mix(in srgb, var(--ink) 6%, transparent) }
.pp-net-msg { font: inherit; font-size: 14px; font-weight: 700; padding: 8px 18px; border: 0; border-radius: 999px; background: transparent; color: var(--ink); box-shadow: inset 0 0 0 1px var(--hair); cursor: pointer }
.pp-net-msg:hover { background: color-mix(in srgb, var(--ink) 5%, transparent) }
.pp-net-msg:disabled { opacity: .5; cursor: default }
.pp-net-nomsg { font-style: normal; font-size: 13px; color: var(--ink3) }
.pp-net-follow { font: inherit; font-size: 14px; font-weight: 700; padding: 8px 20px; border: 0; border-radius: 999px; background: var(--ink); color: var(--paper); cursor: pointer }
.pp-net-follow.on { background: transparent; color: var(--ink); box-shadow: inset 0 0 0 1px var(--hair) }
.pp-net-follow:disabled { opacity: .5; cursor: default }
.pp-net-more { position: relative }
.pp-net-dots { display: grid; place-items: center; width: 36px; height: 36px; border: 1px solid var(--hair); border-radius: 999px; background: transparent; color: var(--ink2); cursor: pointer }
.pp-net-pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; display: flex; flex-direction: column; min-width: 160px; padding: 6px;
  border: 1px solid var(--hair); border-radius: 12px; background: var(--paper); box-shadow: 0 12px 32px -12px rgba(0, 0, 0, .28); text-align: left }
.pp-net-pop button { padding: 9px 12px; border: 0; border-radius: 8px; background: transparent; font: inherit; font-size: 14px; color: var(--ink); text-align: left; cursor: pointer }
.pp-net-pop button:hover { background: color-mix(in srgb, var(--ink) 6%, transparent) }
.pp-net-note { margin: 12px auto 0; max-width: 44ch; font-size: 13.5px; color: var(--ink3) }
.pp-posts { margin: 44px 0 0; text-align: left }
.pp-posts h2 { margin: 0 0 12px; font-family: var(--m); font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3); text-align: center }
.pp-posts-list { border: 1px solid var(--hair); border-radius: 16px; overflow: hidden; background: var(--paper) }
.pp-posts-list > :last-child { border-bottom: 0 }
.pp-posts-none { margin: 0; padding: 22px; border: 1px dashed var(--hair); border-radius: 14px; text-align: center; font-size: 14px; color: var(--ink3) }

.pp-wait { padding: 60px 0 80px; text-align: center }
.pp-wait h1 { margin: 0 0 8px; font-family: var(--fd); font-size: 28px; font-weight: 700; color: var(--ink) }
.pp-wait p { margin: 0; font-size: 15px; color: var(--ink3) }

@media (max-width: 560px) {
  .pp { padding: 34px 18px 70px }
  .pp-two { grid-template-columns: 1fr }
}
</style>

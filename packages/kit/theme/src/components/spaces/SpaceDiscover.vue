<script setup>
/*
 * A way in. The spaces a reader could be in, with what each would take — already theirs, included
 * with something they hold, or something to buy — and, on a link, the invitation somebody sent them.
 *
 * Nothing on this page reaches a space's contents: the read behind it (space_discover) answers a
 * name, a kind, the rule that fills it and how many people are in it, for the spaces a site marked
 * `discoverable` in their own files. A staff space is never here whatever anybody sets, because the
 * compile only ever sets that word on a community or a server.
 *
 * Buying it or holding the membership puts somebody in without this page doing anything: the
 * database enters them the moment their standing changes. So the button here is the store's, and
 * the only thing this page itself does is accept an invitation.
 *
 * Words from spaces.md (## discover).
 */
import { computed, ref, onMounted } from 'vue'
import MessageText from '../chat/MessageText.vue'
import { messageBlocks } from 'platformkit/lib/chat/markup.js'
import { us } from 'platformkit/lib/content.js'
import { ROUTES } from '../../router.js'
import { discover, lookInvite, acceptInvite, askToJoin } from 'platformkit/lib/spaces/api.js'
import { forms } from '#content'
import FormRun from '../forms/FormRun.vue'
import { isSignedIn } from 'platformkit/lib/auth.js'
import { products } from '#content'
import SpaceIcon from './SpaceIcon.vue'

const props = defineProps({ token: { type: String, default: '' } })
const emit = defineEmits(['joined'])
const W = computed(() => us('spaces').discover.main)
/* what kind of place it is, in the words the rail already uses for it */
const R = computed(() => us('spaces').rail.main)

const rows = ref([])
const invite = ref(null)
const busy = ref(false)
const err = ref('')
const loading = ref(true)

onMounted(async () => {
  try {
    if (props.token) invite.value = await lookInvite(props.token)
    rows.value = (await discover()) || []
  } catch (e) { err.value = e.message || String(e) } finally { loading.value = false }
})

/* what a space would take, in the site's own words rather than the rule's shape */
/* WHAT A SPACE WOULD TAKE, in the site's own words rather than the rule's shape.

   A fill may offer alternatives — a live membership, OR anyone on staff — and a person deciding
   whether to join does not want a truth table. So this says the ONE way in that is theirs to take:
   something they could buy before something only the site can give them (nobody can make themselves
   staff), and an invitation only when there is no other way at all. */
function wayIn(set) {
  if (set.tier) {
    const offer = products.find((p) => p.kind === 'membership' && p.tier === set.tier)
    return { rank: 1, word: (W.value['with-membership'] || '').replace('{name}', offer ? offer.title : set.tier), href: offer ? '/store/products/' + offer.sku : '/pricing' }
  }
  if (set.product) {
    const offer = products.find((p) => p.key === set.product)
    return { rank: 1, word: (W.value['buy-it'] || '').replace('{name}', offer ? offer.title : ''), href: offer ? '/store/products/' + offer.sku : null }
  }
  if (set.entitlement) return { rank: 0, word: W.value['with-any-membership'], href: '/pricing' }
  /* a role is not something anybody can give themselves, so it is never the way offered */
  return null
}
function takes(s) {
  if (s.mine) return { word: W.value.yours, href: null }
  const f = s.fill
  const sets = (Array.isArray(f) ? f : f && typeof f === 'object' ? [f] : []).filter((x) => x && Object.keys(x).length)
  const ways = sets.map(wayIn).filter(Boolean).sort((x, y) => x.rank - y.rank)
  return ways[0] || { word: W.value['by-invitation'], href: null }
}


async function accept() {
  busy.value = true; err.value = ''
  try {
    const r = await acceptInvite(props.token)
    invite.value = { ...(invite.value || {}), ...r }
    if (r && (r.state === 'joined' || r.state === 'good')) emit('joined', r.space)
  } catch (e) { err.value = e.message || String(e) } finally { busy.value = false }
}
const signIn = () => { try { window.DLauth.open({ intent: 'join' }) } catch { /* no modal */ } }

/* ------------------------------------------------------------------------------------------
   THE DOOR. A space may let anybody in, take an ask and open at once, or make them wait — and
   either of the last two may want a form answered and terms agreed. The page draws what the
   space declared; space_ask refuses anything the page got wrong, so a browser cannot walk past
   the terms by not drawing them. */
const door = ref(null)          /* the space being knocked on */
const note = ref('')
const agreed = ref(false)
/* the terms as blocks: paragraphs and the marks a message may wear */
const termsBlocks = computed(() => messageBlocks((door.value && door.value.joining && door.value.joining.terms) || ''))
const answered = ref(null)      /* the form response, once it is done */
const sent = ref('')            /* accepted | waiting, once it has gone */

const doorForm = computed(() => {
  const slug = door.value && door.value.joining && door.value.joining.form
  return slug ? forms.find((x) => x.slug === slug) || null : null
})
/* what the button says, and whether there is anything to say at all */
function doorOf(sp) {
  const j = (sp && sp.joining) || {}
  const how = j.how || 'none'
  if (sp.mine || how === 'none') return null
  if (sp.asked === 'waiting') return { state: 'waiting', word: W.value.waiting }
  if (sp.asked === 'refused') return { state: 'refused', word: W.value.refused }
  if (!isSignedIn.value) return { state: 'signin', word: W.value['sign-in-join'] }
  return {
    state: 'open', how,
    word: how === 'approve' ? W.value.ask : W.value.join,
    line: how === 'open' ? W.value['open-door'] : how === 'request' ? W.value['ask-door'] : W.value['approve-door'],
    /* a door with nothing to ask opens on the press; one with a form or terms opens the panel */
    straight: how !== 'approve' && !j.form && !j.terms && !j.question,
  }
}
function knock(sp) {
  const d = doorOf(sp)
  if (!d) return
  if (d.state === 'signin') return signIn()
  if (d.state !== 'open') return
  note.value = ''; agreed.value = false; answered.value = null; sent.value = ''; err.value = ''
  if (d.straight) { door.value = sp; return ask() }
  door.value = sp
}
async function ask() {
  const sp = door.value
  if (!sp || busy.value) return
  busy.value = true; err.value = ''
  try {
    const r = await askToJoin(sp.id, { note: note.value || null, response: answered.value, agreed: agreed.value })
    if (r && r.error) { err.value = W.value['err-' + r.error] || r.error; return }
    sent.value = (r && r.state) || 'accepted'
    /* the row changes under them either way: they are in, or they are waiting */
    sp.asked = sent.value
    if (sent.value === 'accepted') { sp.mine = true; sp.people = (sp.people || 0) + 1 }
  } catch (e) { err.value = e.message || String(e) } finally { busy.value = false }
}
const shut = () => { door.value = null }
</script>

<template>
  <section class="sv">
    <header class="sv-head">
      <h2>{{ W.title }}</h2>
      <p>{{ W.line }}</p>
    </header>

    <p v-if="err" class="sv-err">{{ err }}</p>

    <!-- an invitation, where somebody followed one -->
    <div v-if="token" class="sv-invite" :class="{ bad: invite && invite.state !== 'good' && invite.state !== 'joined' }">
      <SpaceIcon name="ticket" :size="18" />
      <template v-if="!invite"><p>{{ W.looking }}</p></template>
      <template v-else-if="invite.state === 'joined'">
        <div><b>{{ (W['joined'] || '').replace('{name}', invite.name || '') }}</b><span>{{ W['joined-line'] }}</span></div>
        <a class="sv-go" :href="ROUTES.spaces + '/' + invite.space">{{ W['go-in'] }}</a>
      </template>
      <template v-else-if="invite.state === 'good'">
        <div><b>{{ (W['invited'] || '').replace('{name}', invite.name || '') }}</b><span v-if="invite.mine">{{ W.already }}</span></div>
        <button v-if="isSignedIn" type="button" class="sv-go" :disabled="busy" @click="accept">{{ invite.mine ? W['go-in'] : W.accept }}</button>
        <button v-else type="button" class="sv-go" @click="signIn">{{ W['sign-in'] }}</button>
      </template>
      <template v-else><p>{{ W['state-' + invite.state] || W['state-unknown'] }}</p></template>
    </div>

    <ul v-if="rows.length" class="sv-list">
      <li v-for="s in rows" :key="s.id" :class="{ mine: s.mine }">
        <div class="sv-what">
          <b>{{ s.name }}</b>
          <span class="sv-count">{{ R['kind-' + s.kind] }} · {{ (W.people || '').replace('{n}', s.people) }}</span>
        </div>
        <span class="sv-takes">{{ takes(s).word }}</span>
        <a v-if="s.mine" class="sv-go" :href="ROUTES.spaces + '/' + s.slug">{{ W['go-in'] }}</a>
        <template v-else-if="doorOf(s)">
          <button v-if="doorOf(s).state === 'open' || doorOf(s).state === 'signin'" type="button" class="sv-go"
                  :disabled="busy" @click="knock(s)">{{ doorOf(s).word }}</button>
          <span v-else class="sv-quiet">{{ doorOf(s).word }}</span>
        </template>
        <a v-else-if="takes(s).href" class="sv-go" :href="takes(s).href">{{ W.how }}</a>
        <span v-else class="sv-quiet">{{ W['by-invitation'] }}</span>
      </li>
    </ul>
    <div v-else-if="!loading" class="su-none">
      <h3>{{ W.none }}</h3>
      <p>{{ W['none-line'] }}</p>
    </div>

    <!-- the door: what the space asks of somebody at it, and nothing more. Teleported, because the
         pane gives every child of its own a measure and scrolls, and a veil must do neither. -->
    <Teleport to="body">
    <div v-if="door" class="sv-veil" @click.self="shut">
      <div class="sv-door" role="dialog" aria-modal="true">
        <template v-if="sent">
          <h3>{{ sent === 'accepted' ? W['door-in'] : W.asked }}</h3>
          <p>{{ sent === 'accepted' ? W['joined-line'] : W['door-done'] }}</p>
          <div class="sv-acts">
            <a v-if="sent === 'accepted'" class="sv-go" :href="ROUTES.spaces + '/' + door.slug">{{ W['go-in'] }}</a>
            <button type="button" class="sv-quietbtn" @click="shut">{{ sent === 'accepted' ? W['door-cancel'] : W['go-in'] }}</button>
          </div>
        </template>
        <template v-else>
          <h3>{{ (W['door-title'] || '').replace('{name}', door.name) }}</h3>

          <!-- the form the space asks of anybody at its door -->
          <div v-if="doorForm && !answered" class="sv-form">
            <p class="sv-lbl">{{ W['door-form'] }}</p>
            <FormRun :form="doorForm" embed @complete="(r) => (answered = r.response)" />
          </div>

          <template v-else>
            <label v-if="door.joining.question || !doorForm" class="sv-field">
              <span>{{ door.joining.question || W['door-note'] }}</span>
              <textarea v-model="note" rows="3" maxlength="500" />
            </label>

            <div v-if="door.joining.terms" class="sv-terms">
              <p class="sv-lbl">{{ W['door-terms'] }}</p>
              <!-- THE MARKS A MESSAGE MAY WEAR, AND NOTHING ELSE. The terms are prose somebody
                   wrote in a file, and they read as prose: a bold line is bold rather than a line
                   with asterisks around it. It goes through the same renderer every message in
                   this product goes through — which escapes the text FIRST and then applies the
                   handful of marks it knows — so what a space declares still cannot draw html on
                   this page, which is the rule this replaces and not one it relaxes. -->
              <div class="sv-termsbody"><MessageText v-for="(blk, i) in termsBlocks" :key="i" :blocks="[blk]" /></div>
              <label class="sv-agree"><input type="checkbox" v-model="agreed" /><span>{{ W['door-agree'] }}</span></label>
            </div>

            <p v-if="err" class="sv-err">{{ err }}</p>
            <div class="sv-acts">
              <button type="button" class="sv-go" :disabled="busy" @click="ask">
                {{ door.joining.how === 'approve' ? W['door-send-ask'] : W['door-send'] }}
              </button>
              <button type="button" class="sv-quietbtn" @click="shut">{{ W['door-cancel'] }}</button>
            </div>
          </template>
        </template>
      </div>
    </div>
    </Teleport>
  </section>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; every class here says what it wants instead */
/* section.sv, not .sv: the page gives this element its own class too (sp-plain), and a
   parent's scoped style is injected after a child's — so a tie goes to the page, and this surface
   would lose both its padding and its scrolling to it. */
section.sv { box-sizing: border-box; min-width: 0; overflow-y: auto; margin: 0; padding: 32px 28px 48px; border: 0 }
/* one measure for everything on the page: heading, controls, lists and cards all start and end
   together. A control that belongs to a heading stays beside it rather than at the pane's edge. */
section.sv > * { max-width: var(--sp-measure, 860px) }
section.sv > .su-none { max-width: 620px }
.sv-head { margin: 0 0 20px; padding: 0; border: 0 }
.sv-head h2 { margin: 0 0 6px; font-size: 25px; font-weight: 800; letter-spacing: -.02em; color: var(--ink) }
.sv-head p { margin: 0; max-width: 62ch; font-size: 14.5px; line-height: 1.6; color: var(--ink2) }
.sv-err { margin: 0 0 14px; max-width: 62ch; font-size: 13.5px; color: #c8382f }

.sv-invite { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 13px; align-items: center;
  max-width: 660px; margin: 0 0 22px; padding: 15px 17px; color: var(--ink2);
  background: color-mix(in srgb, var(--accent) 7%, var(--paper));
  border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent); border-radius: 12px }
.sv-invite.bad { background: var(--paper); border-color: var(--hair) }
.sv-invite p { margin: 0; max-width: none; font-size: 13.5px }
.sv-invite b { display: block; font-size: 15px; font-weight: 700; color: var(--ink) }
.sv-invite span { font-size: 13px; color: var(--ink3) }

.sv-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)) }
.sv-list li { display: grid; grid-template-rows: auto auto 1fr auto; gap: 7px; align-content: start;
  padding: 16px 17px 15px; background: var(--paper); border: 1px solid var(--hair); border-radius: 13px }
.sv-list li.mine { border-color: color-mix(in srgb, var(--accent) 34%, transparent) }
.sv-what { min-width: 0 }
.sv-what b { display: block; font-size: 16px; font-weight: 750; letter-spacing: -.01em; color: var(--ink) }
.sv-count { display: block; font-size: 12px; color: var(--ink3) }
.sv-takes { font-size: 13px; line-height: 1.5; color: var(--ink2) }
.sv-quiet { font-size: 12.5px; color: var(--ink3) }
.sv-go { display: inline-flex; align-items: center; justify-content: center; justify-self: start; margin-top: 4px; font: inherit; font-size: 13px;
  font-weight: 700; color: var(--paper); text-decoration: none; background: var(--ink); border: 0; border-radius: 8px;
  padding: 7px 14px; cursor: pointer; white-space: nowrap }
.sv-go:disabled { opacity: .5; cursor: default }
.sv-none { margin: 0; max-width: 62ch; font-size: 13.5px; color: var(--ink3) }

/* the door, over the page: one card, what the space asks, nothing else */
/* teleported out of .sp-page, so it says its own face rather than inheriting the site's serif body */
.sv-veil { font-family: var(--spaces-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif);
  position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 20px;
  background: color-mix(in srgb, var(--ink) 34%, transparent); backdrop-filter: blur(3px) }
.sv-door { box-sizing: border-box; width: min(520px, 100%); max-height: 86vh; overflow-y: auto;
  padding: 22px 22px 20px; background: var(--paper); border: 1px solid var(--hair); border-radius: 16px;
  box-shadow: 0 30px 70px -28px #0000006e }
.sv-door h3 { margin: 0 0 6px; font-size: 19px; font-weight: 800; letter-spacing: -.015em; color: var(--ink) }
.sv-door > p { margin: 0 0 16px; font-size: 13.5px; line-height: 1.6; color: var(--ink2) }
.sv-lbl { margin: 0 0 7px; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--ink3) }
.sv-field { display: block; margin: 14px 0 0 }
.sv-field > span { display: block; margin-bottom: 6px; font-size: 13.5px; color: var(--ink2) }
.sv-field textarea { box-sizing: border-box; width: 100%; font: inherit; font-size: 14px; color: var(--ink);
  background: color-mix(in srgb, var(--ink) 3%, var(--paper)); border: 1px solid var(--hair); border-radius: 9px;
  padding: 9px 11px; resize: vertical }
.sv-field textarea:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 1px }
.sv-terms { margin: 16px 0 0 }
.sv-termsbody { white-space: pre-wrap; max-height: 190px; overflow-y: auto; padding: 11px 13px; font-size: 13px; line-height: 1.62; color: var(--ink2);
  background: color-mix(in srgb, var(--ink) 3%, var(--paper)); border: 1px solid var(--hair); border-radius: 10px }
.sv-agree { display: flex; gap: 8px; align-items: center; margin-top: 10px; font-size: 13.5px; color: var(--ink) }
.sv-form { margin: 14px 0 0 }
.sv-acts { display: flex; gap: 10px; align-items: center; margin-top: 18px }
.sv-quietbtn { font: inherit; font-size: 13px; color: var(--ink3); background: none; border: 0; padding: 7px 4px; cursor: pointer }
.sv-quietbtn:hover { color: var(--ink) }

@media (max-width: 760px) {
  section.sv { padding: 22px 16px 36px }
  .sv-list { grid-template-columns: minmax(0, 1fr) }
  .sv-invite { grid-template-columns: minmax(0, 1fr) }
}
</style>

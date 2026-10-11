<script setup>
/* a fact's word under its number: "{n} members" and "1 member" both say the noun alone, since the
   number stands over it */
const factWord = (w) => String(w || '').replace('{n}', '').replace(/^\s*1\s+/, '').trim()
/*
 * THE FRONT PAGE OF A COMMUNITY — what /spaces opens on.
 *
 * It used to drop somebody into whichever space happened to be first, on whichever room happened to
 * have the newest message: an address that meant nothing and a page nobody chose. A community's
 * front page answers one question — what is happening here, and where would I go next — and it
 * answers it before anybody has picked a room.
 *
 * Four things, in the order they are wanted:
 *   the band      the community's own colour, the greeting, and what is waiting — so the page opens
 *                 on something rather than on a sentence floating in cream
 *   the composer  a field, not a button. "Share something…" beside your own face is the strongest
 *                 invitation a community page can make, and a button labelled "Start something"
 *                 floating at the right of a heading is the weakest
 *   the feed      what has been said anywhere they can read, filtered to everything / unread /
 *                 their own spaces, each card carrying who, where, when and how many answered
 *   the aside     what is on, the spaces they are in, who is here
 *
 * On a phone it is one column and the feed leads, because a phone is read rather than surveyed.
 *
 * Everything here is already somewhere in the product; none of it is a second copy. The feed is one
 * read (space_everywhere), the calendar is the calendar store, the spaces are the ones already
 * loaded. Words: ## index in the spaces scope.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { onIdentity } from '@platform-kit/kit/lib/auth.js'
import { us } from '@platform-kit/kit/lib/content.js'
import { everywhere } from '@platform-kit/kit/lib/spaces/api.js'
import { tint } from '@platform-kit/kit/lib/tint.js'
import { loadCalendar, calendar, whenWord, clockOf } from '@platform-kit/kit/lib/spaces/calendar.js'
import { plainBody, titleOf, unreadOf, saidIn } from '@platform-kit/kit/lib/spaces/model.js'
import { settings } from '@platform-kit/kit/lib/spaces/settings.js'
import SpaceAvatar from './SpaceAvatar.vue'
import SpaceIcon from './SpaceIcon.vue'

const props = defineProps({
  spaces: { type: Array, default: () => [] },
  rows: { type: Array, default: () => [] },        /* the unread counters, per channel */
  people: { type: Array, default: () => [] },
  names: { type: Object, default: () => ({}) },
  me: { type: String, default: '' },
  myName: { type: String, default: '' },
  /* …and their record, so the composer wears the face they designed rather than one made from the name */
  myPerson: { type: Object, default: null },
})
const emit = defineEmits(['space', 'open', 'events', 'find', 'start', 'who'])

const W = computed(() => us('spaces').index.main)
const C = computed(() => us('spaces').calendar.main)
const P = computed(() => us('spaces').page.main)
const feed = ref([])
const loading = ref(true)
const now = Date.now()

/* what this front page is, for whoever is looking at it: everything they can see, and what is on.
   Wanted twice — when the page opens, and again when somebody signs in on it, since a guest's
   "everything" is empty and theirs is not. */
async function fill() {
  loading.value = true
  try { feed.value = (await everywhere(40)) || [] } catch { feed.value = [] } finally { loading.value = false }
  loadCalendar(null, { days: 60, limit: 12 })
}
onMounted(fill)
const offIdentity = onIdentity(() => fill())
onBeforeUnmount(offIdentity)

/* the hour, said as a person would say it */
const greeting = computed(() => {
  const h = new Date().getHours()
  const key = h < 12 ? 'greeting-morning' : h < 18 ? 'greeting-afternoon' : 'greeting-evening'
  const first = (props.myName || '').split(/\s+/)[0] || ''
  return String(W.value[key] || '').replace('{name}', first).replace(/[,;:\s]+$/, '')
})
/* nobody signed in: the band invites them in, and nothing offers to post in their name */
const guest = computed(() => !props.me)
const signIn = () => { if (window.DLauth) window.DLauth.open() }
const waiting = computed(() => (props.rows || []).reduce((n, r) => n + unreadOf(r), 0))
const line = computed(() => (!waiting.value ? W.value['line-quiet']
  : waiting.value === 1 ? W.value['line-one']
  : String(W.value['line-unread']).replace('{n}', waiting.value)))

/* THE COMMUNITY'S OWN COLOUR, made from its name. A site that has not uploaded a cover still gets a
   band that is ITS band and not a grey one, and two communities never look alike. The same rule
   draws a space's card below, so the band and the card agree. */
/* the rule that makes a colour out of a name is shared — the store asks the same question of a
   product with no photograph (lib/tint.js). */
const band = computed(() => tint((props.spaces[0] || {}).slug || (props.spaces[0] || {}).name || 'community'))
const rooms = computed(() => (props.rows || []).filter((r) => r.kind !== 'dm').length)
/* WHAT THE OWNER HAS SAID ABOUT THIS PAGE (content/community.md): its name and tagline, the picture
   behind its head, and which parts of it are drawn. Every one of those is a decision about how the
   place feels rather than about how the code is put together, so none of it is in the config and
   all of it is edited in the admin. */
const C2 = computed(() => settings())
const home = computed(() => C2.value.home)

const on = computed(() => (calendar.upcoming || []).slice(0, 4))
const here = computed(() => (props.people || []).slice(0, 8))
const more = computed(() => Math.max(0, (props.people || []).length - here.value.length))
const unreadIn = (id) => (props.rows || []).filter((r) => r.space === id).reduce((n, r) => n + unreadOf(r), 0)
const roomsIn = (id) => (props.rows || []).filter((r) => r.space === id && r.kind !== 'dm').length

/* HOW LONG AGO, in as few characters as it takes: a feed is scanned, and a card that says the full
   date makes a reader work out for themselves whether it is new. */
function ago(v) {
  const d = new Date(v)
  if (isNaN(d)) return ''
  const s = Math.max(0, (now - d.getTime()) / 1000)
  if (s < 60) return W.value['ago-now']
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  if (s < 604800) return Math.floor(s / 86400) + 'd'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/* WHAT A ROW SAYS. A person's line is its title or its first sentence. THE PLATFORM'S OWN line is
   not a sentence at all — it is an event and its facts on `meta`, worded from the events strings by
   saidIn, which is how every other surface draws one. Given only the body, this page showed an
   empty card attributed to "Someone", which is two wrongs: there is no someone, and there were
   words to show. */
const EV = computed(() => us('spaces').events || {})
const isSystem = (m) => m.kind === 'system' && !m.bot
const said = (m) => {
  if (m.kind === 'system') return saidIn({ ...m, kind: 'system' }, { names: props.names, words: EV.value, money: (v) => String(v ?? '') })
  return m.title ? m.title : titleOf({ body: m.body }, props.names, { max: 150 })
}
const replies = (n) => (n === 1 ? W.value['replies-one'] : String(W.value['replies-many']).replace('{n}', n))

/* WHAT THE FEED IS SHOWING. Everything is the default; Unread is what a room still owes them, which
   is the one filter anybody uses twice; Your spaces is for somebody in several, where the whole
   community at once is too much. Held here rather than remembered: a front page should open the
   same way every time. */
const SHOWS = ['all', 'unread', 'mine']
const show = ref('all')
const unreadRooms = computed(() => new Set((props.rows || []).filter((r) => unreadOf(r) > 0).map((r) => r.channel)))
const shown = computed(() => {
  let list = feed.value
  if (show.value === 'unread') list = list.filter((m) => unreadRooms.value.has(m.channel))
  else if (show.value === 'mine') list = list.filter((m) => (props.spaces || []).some((s) => s.id === m.space))
  /* a row with nothing in it is not news: a platform line whose event this site has no words for
     says nothing, and a card saying nothing is worse than one fewer card */
  return list.filter((m) => String(said(m) || '').trim())
})
</script>

<template>
  <div class="si">
    <!-- THE BAND. The page used to open on a sentence floating in the middle of a cream field. It
         opens on a head instead — but the surface's OWN dark, the rail's material carried across the
         top, not a marketing gradient: this is a place of work, and the one rule its chrome keeps is
         that it wears none of the site's accent. A faint tint made from the community's name is the
         only colour in it, so two communities do not look alike and neither looks like an advert.
         What it carries on the right is what a community page owes a newcomer: how many people are
         here, and how many rooms. -->
    <header class="si-band" :style="band">
      <!-- a cover somebody uploaded stands over the mesh; without one the mesh IS the answer -->
      <img v-if="C2.cover" class="si-cover-img" :src="C2.cover" alt="" aria-hidden="true" />
      <div class="si-bandin">
        <div class="si-bandsay">
          <p v-if="C2.name" class="si-eyebrow">{{ C2.name }}</p>
          <template v-if="guest">
            <h1>{{ C2.tagline || W['guest-title'] }}</h1>
            <p class="quiet">{{ W['guest-line'] }}</p>
            <button type="button" class="si-in-btn" @click="signIn">{{ W['guest-signin'] }}</button>
          </template>
          <h1 v-else-if="home.greeting">{{ greeting }}</h1>
          <h1 v-else-if="C2.tagline">{{ C2.tagline }}</h1>
          <p v-if="!guest && home.greeting" :class="{ quiet: !waiting }">{{ line }}</p>
          <p v-else-if="!guest && C2.tagline" class="quiet">{{ line }}</p>
        </div>
        <dl v-if="home.facts && people.length" class="si-facts">
          <div><dt>{{ people.length }}</dt><dd>{{ factWord(people.length === 1 ? W['members-one'] : W['members-many']) }}</dd></div>
          <div v-if="rooms"><dt>{{ rooms }}</dt><dd>{{ factWord(rooms === 1 ? W['rooms-one'] : W['rooms-many']) }}</dd></div>
        </dl>
      </div>
    </header>

    <div class="si-in">
      <div class="si-cols">
        <section class="si-feed">
          <!-- A FIELD, NOT A BUTTON. "Share something with the community…" beside your own face is
               the strongest invitation this page can make; a pill labelled "Start something" at the
               right of a heading is the weakest, and reads as a control rather than an offer. -->
          <button v-if="home.compose && !guest" type="button" class="si-compose" @click="emit('start')">
            <SpaceAvatar :name="myName || P.you" :person="myPerson" :size="36" />
            <span>{{ W.compose }}</span>
            <SpaceIcon name="pencil" :size="15" />
          </button>

          <div class="si-bar">
            <h2>{{ W.feed }}</h2>
            <div v-if="!guest" class="si-chips">
              <button
                v-for="o in SHOWS" :key="o" type="button" class="si-chip" :class="{ on: show === o }"
                :aria-pressed="show === o" @click="show = o">{{ W['show-' + o] }}</button>
            </div>
          </div>

          <p v-if="loading" class="si-quiet">{{ C.loading }}</p>
          <p v-else-if="!feed.length" class="si-quiet">{{ W['feed-none'] }}</p>
          <p v-else-if="!shown.length" class="si-quiet">{{ W['show-none'] }}</p>

          <ol v-else class="si-posts">
            <li v-for="m in shown" :key="m.id">
              <button type="button" class="si-post" :class="{ sys: isSystem(m) }" @click="emit('open', m.channel)">
                <!-- the platform's own line wears the surface's mark, not a face: nobody said it -->
                <span v-if="isSystem(m)" class="si-mark" aria-hidden="true">▣</span>
                <SpaceAvatar v-else :name="m.name || P.someone" :size="38" />
                <div class="si-post-body">
                  <div class="si-who">
                    <b v-if="!isSystem(m)">{{ m.name || P.someone }}</b>
                    <!-- where it was said as a CHIP: a reader scanning a feed is choosing a room as
                         much as a message, and "#the-books" in grey is not something to press -->
                    <em class="si-room">{{ m.room }}</em>
                    <span class="si-space">{{ m.space_name }}</span>
                    <span class="si-when">{{ ago(m.created_at) }}</span>
                  </div>
                  <p class="si-said">{{ said(m) }}</p>
                  <div v-if="m.replies" class="si-meta">
                    <SpaceIcon name="thread" :size="13" />{{ replies(m.replies) }}
                  </div>
                </div>
              </button>
            </li>
          </ol>
        </section>

        <aside class="si-aside">
          <div v-if="home.events" class="si-card">
            <div class="si-bar"><h2>{{ W.on }}</h2><button v-if="on.length" type="button" class="si-link" @click="emit('events')">{{ W['on-all'] }}</button></div>
            <p v-if="!on.length" class="si-quiet">{{ W['on-none'] }}</p>
            <ol v-else class="si-on">
              <li v-for="o in on" :key="o.id">
                <button type="button" class="si-onrow" @click="emit('events')">
                  <span class="si-date" :style="tint(o.slug || o.id)">
                    <b>{{ new Date(o.starts_at).getDate() }}</b>
                    <small>{{ new Date(o.starts_at).toLocaleString(undefined, { month: 'short' }) }}</small>
                  </span>
                  <span class="si-onwhat">
                    <b>{{ o.title }}</b>
                    <small>{{ whenWord(o.starts_at, now, { today: C.today, tomorrow: C.tomorrow }) }} · {{ clockOf(o.starts_at) }}</small>
                  </span>
                  <SpaceIcon class="si-go" name="fwd" :size="13" />
                </button>
              </li>
            </ol>
          </div>

          <div v-if="!guest" class="si-card">
            <div class="si-bar"><h2>{{ W.spaces }}</h2><button type="button" class="si-link" @click="emit('find')">{{ W.find }}</button></div>
            <p v-if="!spaces.length" class="si-quiet">{{ W['spaces-none'] }}</p>
            <ol v-else class="si-spaces">
              <li v-for="s in spaces" :key="s.id">
                <!-- a space is a PLACE, so its row wears its own colour rather than a grey square -->
                <button type="button" class="si-space-row" @click="emit('space', s.id)">
                  <span v-if="s.thumb || s.cover" class="si-cover is-pic"><img :src="s.thumb || s.cover" alt="" loading="lazy" /></span>
                  <span v-else class="si-cover" :style="tint(s.slug || s.name)">{{ (s.name || '?').trim().charAt(0) }}</span>
                  <span class="si-spacewhat">
                    <b>{{ s.name }}</b>
                    <small>{{ roomsIn(s.id) === 1 ? W['rooms-one'] : (W['rooms-many'] || '').replace('{n}', roomsIn(s.id)) }}</small>
                  </span>
                  <em v-if="unreadIn(s.id)" class="si-dot">{{ unreadIn(s.id) }}</em>
                </button>
              </li>
            </ol>
          </div>

          <div v-if="home.people && here.length" class="si-card">
            <div class="si-bar"><h2>{{ W.people }}</h2></div>
            <!-- faces WITH NAMES: a grid of initials tells a reader nothing about who is in the room,
                 and a community page whose people are anonymous is not a community page -->
            <ul class="si-faces">
              <!-- A FACE IS A WAY TO SOMEBODY. Pressing one opens their card beside the room, the
                   same card a name in a message opens — and the same one, so what a reader may see
                   of somebody is decided in one place and not per surface. -->
              <li v-for="p in here" :key="p.id">
                <button type="button" class="si-face" :aria-label="p.name" @click="emit('who', p.id)">
                  <SpaceAvatar :name="p.name" :person="p" :size="34" />
                  <span>{{ (p.name || '').split(/\s+/)[0] }}</span>
                </button>
              </li>
            </ul>
            <p v-if="more" class="si-quiet si-morepeople">{{ (W['people-more'] || '').replace('{n}', more) }}</p>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* the root is a scroller and nothing else: the page puts class="sp-plain" on it, which sets
   padding: 0 and wins on order, so anything visual here would be silently dropped */
.si { min-height: 0; overflow-y: auto; background: var(--paper) }

/* THE BAND: the community's own colour, its light coming from above, the greeting set in it. It is
   flush to the top and to both edges — a coloured band with a margin round it is a card, and this is
   the page's own head. */
/* THE HEAD. Not a two-stop gradient — a MESH: three lights of the community's own hue laid over
   the surface's dark, which is what makes a band read as a surface with depth rather than as a
   coloured rectangle, and what every product this is measured against does. The grain over the top
   is the same trick the landing's ground uses: a fine noise at four per cent kills the banding a
   large gradient shows on an ordinary screen, and is the difference between "a gradient" and "a
   material". A cover somebody uploads sits over all of it and needs none of this. */
.si-band { position: relative; color: #fff; overflow: hidden; isolation: isolate;
  background: var(--sp-rail) }
.si-band::before { content: ''; position: absolute; inset: 0;
  background:
    radial-gradient(90% 120% at 6% -10%, color-mix(in srgb, var(--a) 62%, transparent), transparent 58%),
    radial-gradient(70% 110% at 78% 120%, color-mix(in srgb, var(--b) 55%, transparent), transparent 62%),
    radial-gradient(120% 160% at 100% -40%, color-mix(in srgb, #fff 16%, transparent), transparent 55%),
    linear-gradient(158deg, var(--sp-side), var(--sp-rail)) }
/* the grain: an SVG turbulence, inline so it costs no request, at an opacity that is felt and not seen */
.si-band::after { content: ''; position: absolute; inset: 0; opacity: .045; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E") }
/* and a hairline of light where the band meets the page, so the join is a seam and not a cut */
.si-band { box-shadow: inset 0 -1px 0 rgb(255 255 255 / .07) }
/* a cover sits over the mesh and under the words, darkened at the foot so the words hold whatever
   the picture is: a light photograph must not be the reason a greeting cannot be read */
.si-cover-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0;
  -webkit-mask-image: linear-gradient(180deg, #000, #000); mask-image: linear-gradient(180deg, #000, #000) }
.si-band:has(.si-cover-img)::after { background:
  linear-gradient(180deg, rgb(0 0 0 / .18) 0%, rgb(0 0 0 / .62) 100%);
  opacity: 1; mix-blend-mode: normal; background-image: none }
/* the community's own name, small over the greeting — the page says where you are before it says hello */
.si-eyebrow { margin: 0 0 6px !important; font-family: var(--m); font-size: 10.5px; font-weight: 700;
  letter-spacing: .13em; text-transform: uppercase; color: rgb(255 255 255 / .6) !important }
.si-bandin { position: relative; z-index: 1; max-width: 1060px; margin: 0 auto; padding: 30px 28px 28px;
  display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; flex-wrap: wrap }
.si-bandsay { min-width: 0 }
.si-band h1 { font-family: var(--fd); font-size: 36px; font-weight: 760; letter-spacing: -.03em;
  line-height: 1.08; margin: 0 0 7px; color: #fff; text-wrap: balance }
.si-band p { margin: 0; font-size: 15px; color: rgb(255 255 255 / .82) }
.si-band p.quiet { color: rgb(255 255 255 / .62) }
/* the facts: a number and the thing it counts, set small under it — never a sentence */
.si-facts { display: flex; align-items: flex-end; gap: 26px; margin: 0; padding: 0 }
.si-facts div { display: grid; gap: 1px }
.si-facts dt { font-family: var(--fd); font-size: 22px; font-weight: 750; line-height: 1; color: #fff }
.si-facts dd { margin: 0; font-family: var(--m); font-size: 10px; font-weight: 600; letter-spacing: .09em;
  text-transform: uppercase; color: rgb(255 255 255 / .55) }

/* the page's body rises a little into the band, so the first card sits INTO the head rather than
   below a hard line — the one trick that makes a banded page read as one page */
.si-in { padding: 22px 28px 60px; position: relative; z-index: 1; container-type: inline-size }
/* IN A NARROW COLUMN (the social layout's middle, a small window) the cards go under what is said,
   two abreast while there is room, and the filters scroll rather than spill */
@container (max-width: 760px) {
  .si-in .si-cols { grid-template-columns: minmax(0, 1fr) }
  .si-cols .si-aside { position: static; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; align-items: start }
  .si-feed .si-bar { flex-wrap: wrap }
  .si-feed .si-chips { max-width: 100%; overflow-x: auto; scrollbar-width: none }
}
/* section.si-feed: the site's stylesheet pads every bare section */
section.si-feed { margin: 0; padding: 0; border: 0 }
.si-in-btn { margin-top: 16px; font: inherit; font-size: 15px; font-weight: 700; padding: 10px 22px; border: 0; border-radius: 999px; cursor: pointer;
  color: #12121a; background: linear-gradient(180deg, #fff, color-mix(in srgb, #fff 86%, var(--accent)));
  box-shadow: 0 10px 26px -12px rgba(0, 0, 0, .6), inset 0 -1px 0 rgba(0, 0, 0, .06); transition: transform .25s cubic-bezier(.2, .8, .2, 1), box-shadow .25s }
.si-in-btn:hover { transform: translateY(-1px); box-shadow: 0 14px 30px -12px rgba(0, 0, 0, .7) }
.si-cols { max-width: 1060px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1fr) 318px; gap: 26px; align-items: start }

.si-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 10px; padding: 0; border: 0 }
.si-bar h2 { font-family: var(--fd); font-size: 13px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: var(--ink3); margin: 0 }
.si-link { font: inherit; font-size: 13px; font-weight: 600; color: var(--sp-link); background: none; border: 0; padding: 0; cursor: pointer }
.si-link:hover { text-decoration: underline; text-underline-offset: 3px }
.si-quiet { color: var(--ink2); font-size: 14px; margin: 0 }

.si-compose { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px;
  width: 100%; text-align: left; font: inherit; font-size: 15px; color: var(--ink3);
  background: var(--card); border: 1px solid var(--hair); border-radius: 16px; padding: 13px 17px;
  margin: 0 0 22px; cursor: pointer;
  box-shadow: 0 1px 2px rgb(0 0 0 / .04), 0 1px 0 rgb(255 255 255 / .5) inset;
  transition: border-color .18s cubic-bezier(.2, .8, .2, 1), box-shadow .18s cubic-bezier(.2, .8, .2, 1) }
.si-compose:hover { border-color: color-mix(in srgb, var(--ink) 20%, transparent);
  box-shadow: 0 10px 26px -16px rgb(0 0 0 / .4), 0 1px 0 rgb(255 255 255 / .5) inset }

.si-chips { display: flex; align-items: center; gap: 5px }
.si-chip { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink3); background: transparent;
  border: 1px solid transparent; border-radius: 999px; padding: 4px 11px; cursor: pointer; white-space: nowrap }
.si-chip:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 6%, transparent) }
.si-chip.on { color: var(--ink); background: color-mix(in srgb, var(--ink) 9%, transparent) }

.si-posts { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px }
/* a CARD: a hairline, a whisper of a shadow at rest so it sits on the page rather than being drawn
   on it, and a real one on hover. The curve is the surface's own — one easing for everything that
   moves here, which is what keeps a page from feeling assembled out of parts. */
.si-post { width: 100%; text-align: left; font: inherit; display: grid; grid-template-columns: auto minmax(0, 1fr);
  gap: 14px; padding: 16px 18px; border: 1px solid var(--hair); border-radius: 16px;
  background: var(--card); cursor: pointer; color: var(--ink);
  box-shadow: 0 1px 2px rgb(0 0 0 / .04), 0 1px 0 rgb(255 255 255 / .5) inset;
  transition: border-color .18s cubic-bezier(.2, .8, .2, 1), transform .18s cubic-bezier(.2, .8, .2, 1), box-shadow .18s cubic-bezier(.2, .8, .2, 1) }
.si-post:hover { border-color: color-mix(in srgb, var(--ink) 16%, transparent); transform: translateY(-2px);
  box-shadow: 0 14px 34px -20px rgb(0 0 0 / .45), 0 1px 0 rgb(255 255 255 / .5) inset }
/* the platform's own line is quieter than a person's: it is context, not conversation */
.si-post.sys { background: color-mix(in srgb, var(--ink) 3%, var(--card)) }
.si-post.sys .si-said { font-size: 13.5px; color: var(--ink2) }
.si-mark { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 9px;
  font-size: 15px; color: var(--ink3); background: color-mix(in srgb, var(--ink) 7%, transparent) }
/* the feed arrives in a soft cascade rather than appearing whole — the same curve, the same beat as
   the chat's. Off where somebody has asked for less motion. */
.si-posts > li { animation: si-rise .42s cubic-bezier(.2, .8, .2, 1) both }
.si-posts > li:nth-child(1) { animation-delay: .02s } .si-posts > li:nth-child(2) { animation-delay: .06s }
.si-posts > li:nth-child(3) { animation-delay: .1s }  .si-posts > li:nth-child(4) { animation-delay: .14s }
.si-posts > li:nth-child(5) { animation-delay: .18s } .si-posts > li:nth-child(n+6) { animation-delay: .22s }
@keyframes si-rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@media (prefers-reduced-motion: reduce) { .si-posts > li { animation: none } .si-post { transition: none } }
.si-post-body { min-width: 0 }
.si-who { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; min-width: 0 }
.si-who b { font-size: 14px; font-weight: 700 }
/* the room as something to press rather than grey text after a hash */
.si-room { font-style: normal; font-size: 11.5px; font-weight: 650; color: var(--ink2);
  background: color-mix(in srgb, var(--ink) 7%, transparent); border-radius: 999px; padding: 2px 8px }
.si-space { font-size: 12.5px; color: var(--ink3) }
.si-when { margin-left: auto; font-family: var(--m); font-size: 11px; color: var(--ink3); white-space: nowrap }
.si-said { margin: 5px 0 0; font-size: 14.5px; line-height: 1.55; color: var(--ink);
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden }
.si-meta { display: inline-flex; align-items: center; gap: 5px; margin-top: 8px; font-size: 12.5px; color: var(--ink3) }

.si-aside { display: grid; gap: 16px; position: sticky; top: 12px }
.si-card { padding: 17px; border: 1px solid var(--hair); border-radius: 16px; background: var(--card);
  box-shadow: 0 1px 2px rgb(0 0 0 / .04), 0 1px 0 rgb(255 255 255 / .5) inset }
.si-on, .si-spaces { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px }
.si-onrow, .si-space-row { width: 100%; text-align: left; font: inherit; display: grid; align-items: center;
  gap: 11px; padding: 8px; margin: 0 -8px; border: 0; border-radius: 10px; background: none; cursor: pointer; color: var(--ink) }
.si-onrow { grid-template-columns: 42px minmax(0, 1fr) auto }
.si-space-row { grid-template-columns: auto minmax(0, 1fr) auto }
.si-onrow:hover, .si-space-row:hover { background: color-mix(in srgb, var(--ink) 5%, transparent) }
.si-go { color: var(--ink3); opacity: 0; transition: opacity .12s }
.si-onrow:hover .si-go { opacity: 1 }
/* the date block wears the event's own colour, as its card does on the board */
.si-date { display: grid; justify-items: center; padding: 4px 0; border-radius: 9px; color: #fff;
  background: linear-gradient(150deg, var(--a), var(--b)) }
.si-date b { font-size: 15px; font-weight: 750; line-height: 1.1 }
.si-date small { font-size: 9.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; opacity: .9 }
.si-onwhat, .si-spacewhat { display: grid; min-width: 0 }
.si-onwhat b, .si-spacewhat b { font-size: 13.5px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.si-onwhat small, .si-spacewhat small { font-size: 11.5px; color: var(--ink3) }
/* a space that has a picture wears it; one that has not keeps its coloured initial, which was
   never a placeholder — it is the space's own colour, made from its name */
.si-cover.is-pic { padding: 0; overflow: hidden; background: color-mix(in srgb, var(--ink) 6%, transparent) }
.si-cover.is-pic img { width: 100%; height: 100%; object-fit: cover; display: block }
.si-cover { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; color: #fff;
  font-family: var(--fd); font-size: 15px; font-weight: 750; line-height: 1;
  background: linear-gradient(150deg, var(--a), var(--b)) }
.si-dot { font-style: normal; font-size: 11px; font-weight: 700; min-width: 18px; text-align: center;
  padding: 2px 6px; border-radius: 999px; background: var(--sp-link); color: var(--paper) }

.si-faces { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px 6px }
.si-face { display: grid; justify-items: center; gap: 5px; width: 100%; padding: 4px 2px; font: inherit;
  background: none; border: 0; border-radius: 10px; cursor: pointer; color: inherit }
.si-face:hover { background: color-mix(in srgb, var(--ink) 6%, transparent) }
.si-faces li { display: grid; justify-items: center; gap: 5px; min-width: 0 }
.si-faces span { font-size: 11px; color: var(--ink3); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.si-morepeople { margin-top: 12px; font-size: 12.5px }

@media (max-width: 900px) {
  .si-bandin { padding: 26px 16px 24px }
  .si-band h1 { font-size: 25px }
  .si-in { padding: 18px 16px 48px }
  .si-cols { grid-template-columns: minmax(0, 1fr); gap: 20px }
  .si-aside { position: static }
  .si-when { margin-left: 0 }
}
</style>

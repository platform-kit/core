<script setup>
import { moduleOn } from '@platform-kit/kit/lib/modules.js'
import { ROUTES, STORE_ON, DOCS_ONLY, ACCOUNTS_ON, isPageRoute, appPath, QUIZ_PATH, APP_BASE } from '../router.js'
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { t, us } from '@platform-kit/kit/lib/content.js'
import { set as store } from '@platform-kit/kit/lib/store.js'
import CommandK from '../components/content/CommandK.vue'
import SiteMark from '../components/SiteMark.vue'
import { site as SITE_RAW, spaces as SPACES_RAW } from '#content'
/* the site's name, from content/site.md */
const SITE_NAME = ((Array.isArray(SITE_RAW) ? SITE_RAW[0] : SITE_RAW) || {}).name || 'Site'
import { user, isSignedIn, isAdmin, isStaff, isProvider, canAccess, plan, signOut, authSettled, userClass, memberTiers, myFace } from '@platform-kit/kit/lib/auth.js'
import { faceOf } from '@platform-kit/kit/lib/avatar.js'
import { openPortal } from '@platform-kit/kit/lib/commerce.js'
import { tierRank } from '@platform-kit/kit/lib/storefront.js'
import { unread, startUnreadWatch } from '@platform-kit/kit/lib/chat/unread.js'
import { inSpaces, waiting as spaceWaiting, startSpacesWatch } from '@platform-kit/kit/lib/spaces/nav.js'
import { unread as netUnread, startNetworkWatch } from '@platform-kit/kit/lib/network/nav.js'
import { count as bagCount, toggleCart } from '@platform-kit/kit/lib/cart.js'
import { links as SITE_LINKS, cta as SITE_CTA } from '#site/nav'
import { navLinks, seen } from '@platform-kit/kit/lib/nav.js'
import { themeNav } from '../lib/theme-nav.js'
import site, { modules } from '#site'   /* the site's header, when it says (platformkit.config.js nav) */
import { siteFooterOff } from '@platform-kit/kit/lib/chrome.js'
/* the foot of every page: the Footer section, drawn by the layout because it is chrome */
import LandingFooter from '../components/landing/LandingFooter.vue'

/*
 * THE HEADER'S LINKS, in three layers — the theme's own by rule, the site's config, and a nav in
 * content/site.md that an administrator edits. The most specific that exists is the WHOLE list;
 * lib/nav.js holds the rule and this file holds none of it.
 *
 * The theme's own: the library always, pricing where a page claims that route, the store while the
 * module is on. Each is a key under nav.* in the strings, so it stays translatable; a site's own
 * item carries its label instead, written in content/site.md, which is markdown like every other
 * word on the site.
 */
const THEME_LINKS = themeNav({ docsOnly: DOCS_ONLY, storeOn: STORE_ON, hasPricing: isPageRoute('/pricing'), routes: ROUTES })
/* an item pointing at a route no module answers is dropped here, once, for all three layers — so no
   layer can leave a dead link and no template has to remember to ask */
const answers = (href) => {
  const at = String(href || '').split(/[?#]/)[0]
  if (at === ROUTES.store || at.startsWith(ROUTES.store + '/')) return STORE_ON
  if (at === ROUTES.spaces || at.startsWith(ROUTES.spaces + '/')) return moduleOn('spaces')
  if (at === '/pricing') return isPageRoute('/pricing')
  return true
}
const SITE_NAV = ((Array.isArray(SITE_RAW) ? SITE_RAW[0] : SITE_RAW) || {}).nav
const ALL_LINKS = navLinks({ content: SITE_NAV, config: SITE_LINKS, theme: THEME_LINKS, answers })
/* who sees each one: declared on the item, read through the class ladder the rest of the platform
   already uses — never a rule invented in this template, which is how the community link came to be
   hidden from everybody who had not already joined it */
const LINKS = computed(() => ALL_LINKS.filter((l) => !l.cta && seen(l, {
  cls: userClass.value, tiers: memberTiers.value, rank: tierRank, staff: isStaff.value,
})))
const linkOn = (l) => l.prefix ? props.current.startsWith(l.href) : props.current === l.href
const linkWord = (l) => l.label || t('nav.' + l.key)
/* across the top, and behind the menu: every link is in exactly one of them, and the menu holds
   the overflow in written order even when the burger is not otherwise needed */
const headLinks = computed(() => LINKS.value.slice(0, shown.value))
const menuLinks = computed(() => (fit.value === 'menu' || narrow.value ? LINKS.value : LINKS.value.slice(shown.value)))
const menuNeeded = computed(() => fit.value === 'menu' || LINKS.value.length > shown.value)
/* the stylesheet's own floor: below it the links are hidden by CSS and the burger is drawn by CSS,
   so the modal must hold all of them however the measuring came out */
const narrow = ref(false)
/* the call to action: where it goes signed out and in, and its two labels' keys; the theme's default is the instrument
   where there is one, and none on a site with nothing that needs an account (a docs site has no "start here") */
const NAV_CTA = ALL_LINKS.find((l) => l.cta) || null
const CTA = NAV_CTA || SITE_CTA || (moduleOn('instrument') ? { href: QUIZ_PATH, hrefIn: APP_BASE, key: 'cta', keyIn: 'cta-in', prefix: ROUTES.diagnostics } : null)
const ctaHref = computed(() => CTA && ((isSignedIn.value && CTA.hrefIn) || CTA.href))
/* a site's own item says its label; one of the theme's names a string key */
const ctaLabel = computed(() => CTA && (CTA.label || t(isSignedIn.value && CTA.keyIn ? CTA.keyIn : CTA.key)))
const ctaOn = computed(() => !!CTA && props.current.startsWith(CTA.prefix || CTA.href))

/* the bag: a button in the header, with a count only when there is one */
const B = us('store').cart.ui

/* the account affordance: a sign-in link, or the user's initial with a small menu */
const A = us('auth').modal.buttons
const BILLING_LABEL = ((us('usage').page || {}).main || {})['billing-nav'] || 'Billing'
const acctOpen = ref(false)
const initial = computed(() => ((user.value && user.value.email) || '?').charAt(0).toUpperCase())
/* the face they designed, worn here. The initial stays as what shows before the profile has been
   read — a letter for a moment, never a letter instead of the face somebody made. */
const face = computed(() => (myFace.value ? faceOf(myFace.value) : ''))
/* the chat is a coach's or a member's — and anyone's with a message waiting,
   so a lapsed member still finds a coach's reply */
/* the coaching chat's own button, when the business answers coaching on the sheet rather than in
   the community (platformkit.config.js coaching.where). With it in the community there is one button
   for both, carrying one number, because it is one place to go. */
const chatOn = computed(() => moduleOn('coaching') && (site.coaching || {}).where !== 'spaces'
  && isSignedIn.value && (isProvider.value || canAccess('subscribed') || unread.value > 0))
/* THE WAY INTO THE COMMUNITY.
   This used to be offered to somebody already in a room and to nobody else, on the rule that a
   button going nowhere is worse than no button. That read it backwards: a site WITH a community
   was hiding it from everyone who had not joined one, so the only people who could find the way in
   were the people who had already found it.
   The default is the community itself. A site that declares a space anyone may discover shows the
   way in — signed in or not — and the surface's own join flow (knock, approve, the terms) does the
   rest. A site whose only rooms are private falls back to the old rule on its own, because there
   is genuinely nothing there for a visitor to walk into; and a site that would rather keep the
   link to members says so, once: platformkit.config.js `spaces.link: 'members'`. */
const OPEN_ROOM = (SPACES_RAW || []).some((s) => s && s.discoverable !== false)
const SPACE_LINK = ((site.spaces || {}).link || 'always')
/* ONE ANSWER TO "IS THE COMMUNITY IN THE HEADER". A site that names the community in its own nav
   has said where it goes and what it is called, so the theme's own affordance stands down rather
   than drawing it a second time — which is what happened the moment the demo declared a nav: the
   word in the links and the icon among the icons, both pointing at the same room. */
const NAV_HAS_SPACES = ALL_LINKS.some((l) => {
  const at = String(l.href || '').split(/[?#]/)[0]
  return at === ROUTES.spaces || at.startsWith(ROUTES.spaces + '/')
})
/* THE SOCIAL NETWORK's own button: the reader's timeline, with what has happened to them since they
   last looked. Offered to somebody signed in — a guest has no timeline — and its words are the
   theme's (network.md nav), so no site has to name it. */
const NW = computed(() => us('network').nav.main)
const networkOn = computed(() => moduleOn('network') && isSignedIn.value)
const spacesOn = computed(() => moduleOn('spaces') && !NAV_HAS_SPACES
  && ((SPACE_LINK === 'always' && OPEN_ROOM) || (isSignedIn.value && inSpaces.value)))
/*
 * THE HEADER FITS ITSELF.
 *
 * Every version of this was a number: collapse at 700, then at 1024 and 900, then — when the demo
 * grew a fifth link and a community icon and the search pill was drawn under the first link — at
 * 1320, and then a count of entries. Each one was a guess about a different site, and the guesses
 * keep being wrong because the width of this row is not a property of the window. It is the site's
 * NAME, the words it chose for its links, how many modules are on, whether somebody is signed in,
 * and the typeface the site picked in Settings — a site that chooses a wide heading face breaks a
 * fixed breakpoint the moment the webfont lands.
 *
 * So it measures. The row asks for the width it would need at the level it is on, compares it with
 * the room it has, and steps down until it fits: the search pill becomes the icon it already is on
 * a phone, then the links and the call to action go behind the burger. Nothing is a constant and
 * nothing has to be remembered when a site adds a link.
 *
 * The media queries in atlas.css stay as the floor: a prerendered page is read before this runs,
 * and a phone must be right in that first frame.
 */
const headEl = ref(null)
const fit = ref('full')
/* how many of the links are drawn across the top; the rest are in the menu, in the order written.
   Starts at every one of them, which is also what a prerendered page shows before any of this runs. */
const shown = ref(Infinity)
let fitting = false
/* what the row NEEDS: its flex children at their natural width (scrollWidth, so a group that clips
   still reports what it wanted) plus the gaps, against the room inside its padding */
function overflows(row) {
  const kids = [...row.children].filter((e) => e.offsetParent !== null)
  const cs = getComputedStyle(row)
  const gap = parseFloat(cs.columnGap) || 0
  const need = kids.reduce((n, e) => n + e.scrollWidth, 0) + gap * Math.max(0, kids.length - 1)
  const room = row.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
  return need > room
}
async function fitHead() {
  const row = headEl.value
  if (fitting || !row || typeof window === 'undefined') return
  fitting = true
  try {
    /* step one: everything, with the search as a pill */
    fit.value = 'full'
    shown.value = Infinity
    await nextTick()
    if (!overflows(row)) return
    /* step two: the pill becomes the icon it already is on a phone — about 140px back, and the
       shortcut still works */
    fit.value = 'compact'
    await nextTick()
    if (!overflows(row)) return
    /* step three: links move into the menu ONE AT A TIME, from the end, so a site with six links
       loses the sixth rather than all six. The order is the order they were written, which is the
       order they come back in as the window widens. */
    const n = LINKS.value.length
    for (let keep = n - 1; keep >= 0; keep--) {
      shown.value = keep
      await nextTick()
      if (!overflows(row)) return
    }
    /* and last the call to action, which is the only thing left to give */
    fit.value = 'menu'
    await nextTick()
  } finally { fitting = false }
}
/* is the stylesheet's own floor in force? Asked of the browser rather than repeated as 900 in a
   second place — the one number stays in atlas.css and this follows it. */
const seeNarrow = () => { narrow.value = typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches }
let ro = null
onMounted(() => {
  seeNarrow()
  fitHead()
  if (typeof ResizeObserver !== 'undefined' && headEl.value) { ro = new ResizeObserver(() => { seeNarrow(); fitHead() }); ro.observe(headEl.value) }
  /* a webfont landing changes every word in the row */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitHead).catch(() => {})
})
onUnmounted(() => { if (ro) ro.disconnect() })
/* and whenever what the row holds changes: the session settling, a badge arriving, a module's icon */
watch([authSettled, isSignedIn, spacesOn, chatOn, networkOn, () => LINKS.value.length], () => nextTick().then(fitHead))
/* an icon among the icons, or a word among the links — platformkit.config.js spaces.nav */
/* A WORD FOR A VISITOR, AN ICON FOR A MEMBER.
   The icon is a member's affordance: they know what the room is, they go there daily, and it
   carries the badge. It says nothing at all to somebody who has never been in the community — and
   now that the way in is offered to everyone by default, that is who is looking at it. So the
   default follows who the link is FOR: a word among the links while it is a way in, the icon once
   it is only offered to people already inside. A site that wants the other one says so
   (platformkit.config.js `spaces.nav`). */
const spacesWord = computed(() => {
  const said = (site.spaces || {}).nav
  if (said) return said === 'word'
  return SPACE_LINK === 'always' && OPEN_ROOM
})
/* the foot of every page, from Settings → Site settings. A site that has written none has none. */
const FOOTER = computed(() => {
  const f = ((Array.isArray(SITE_RAW) ? SITE_RAW[0] : SITE_RAW) || {}).footer
  return f && (f.about || (f.columns || []).length || f.legal || (f.social || []).length) ? f : null
})
startUnreadWatch()
startSpacesWatch()
if (moduleOn('network')) startNetworkWatch()
function openAuth() { if (window.DLauth) window.DLauth.open() }
async function doSignOut() { acctOpen.value = false; await signOut() }
function closeAcct(e) { if (acctOpen.value && !(e.target.closest && e.target.closest('.siteacct'))) acctOpen.value = false }
onMounted(() => document.addEventListener('click', closeAcct))
onUnmounted(() => document.removeEventListener('click', closeAcct))

const palette = ref(null)

/* the mobile nav menu: the links collapse behind a hamburger below 700px */
const menuOpen = ref(false)
function onKey(e) { if (e.key === 'Escape') menuOpen.value = false }
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

/* light/dark toggle: flips from whatever is effective now, remembers the choice */
const isDark = ref(
  document.documentElement.dataset.theme === 'dark' ||
  (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches),
)
function flipTheme() {
  isDark.value = !isDark.value
  const next = isDark.value ? 'dark' : 'light'
  document.documentElement.dataset.theme = next
  store('dl.theme', next)
}

/*
 * The chrome the public pages share: the gradient band, and a header carrying
 * the mark and one way through to the diagnostic.
 *
 * /concept keeps its own header — it is the working document, it needs the title
 * and the tab bar, and it sits behind a password rather than in the public site.
 */
const props = defineProps({
  /* the landing runs edge to edge and brings its own background, so the header
     sits transparently on top of it rather than on a paper strip of its own */
  transparent: { type: Boolean, default: false },
  /* the header floats over a dark full-bleed cover (an article hero), so its ink
     flips to light and it earns a soft scrim of its own for legibility */
  heroDark: { type: Boolean, default: false },
  /* the page that is currently open, so its own link is not offered again */
  current: { type: String, default: '' },
})
</script>

<template>
  <div class="band"></div>

  <header class="sitehead" :class="{ ontop: transparent, overimg: heroDark }">
    <!-- the buttons wait until who is here is known, then arrive together (auth.js authSettled) -->
    <div ref="headEl" class="sitehead-in" :class="{ settling: !authSettled }" :data-fit="fit">
      <div class="sitehead-left">
      <a class="brand sitebrand" :href="ROUTES.home" :aria-label="SITE_NAME + ' home'">
        <SiteMark />
        <span>{{ SITE_NAME }}</span>
      </a>

        <button type="button" class="sitesearch" aria-label="Search everything"
                @click="palette && palette.show()">
          <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
            <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7"/>
            <path d="M13.5 13.5 L17.5 17.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          </svg>
          <span>Search</span><kbd>&#8984;K</kbd>
        </button>
      </div>

      <nav class="sitenav">
        <a v-for="l in headLinks" :key="l.href + (l.key || l.label)" class="sitelink" :class="{ on: linkOn(l) }" :href="l.href">{{ linkWord(l) }}</a>
        <!-- THE COMMUNITY, AS A WORD. A site whose config says spaces.nav: 'word' draws it here among
             the links rather than as an icon among the icons — because a site whose community is the
             point of it should not hide it behind a glyph. The word is nav.spaces in the strings, so
             "Community", "Forum" or "The Guild" is a string change, never a code change. Either way the
             button carries ONE number: everything waiting — a direct message unread, a mention anywhere
             — because a header can hold one count honestly and three not at all. -->
        <a v-if="spacesOn && spacesWord" class="sitelink sitelink-badged" :class="{ on: current.startsWith(ROUTES.spaces) }" :href="ROUTES.spaces"
           :aria-label="t('nav.spaces') + (spaceWaiting ? ', ' + spaceWaiting : '')">
          {{ t('nav.spaces') }}<em v-if="spaceWaiting" class="sitelink-n">{{ spaceWaiting > 99 ? '99+' : spaceWaiting }}</em>
        </a>
        <!-- the pricing page is a landing page; unpublished, it has no route and no link -->
        <button type="button" class="sitetheme sitesearch-m" aria-label="Search everything"
                @click="palette && palette.show()">
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
            <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7"/>
            <path d="M13.5 13.5 L17.5 17.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          </svg>
        </button>
        <button type="button" class="sitetheme sitemode" :title="isDark ? t('nav.theme-light') : t('nav.theme-dark')"
                :aria-label="isDark ? t('nav.theme-light') : t('nav.theme-dark')" @click="flipTheme">
          <svg v-if="isDark" viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
            <circle cx="10" cy="10" r="4.2" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <path d="M10 1.6v2.2M10 16.2v2.2M1.6 10h2.2M16.2 10h2.2M4 4l1.6 1.6M14.4 14.4L16 16M16 4l-1.6 1.6M5.6 14.4L4 16" stroke="currentColor" stroke-width="1.5"/>
          </svg>
          <svg v-else viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
            <path d="M16.5 12.1A7 7 0 0 1 7.9 3.5a7 7 0 1 0 8.6 8.6Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          </svg>
        </button>
        <!-- the network: the reader's timeline, and how much has happened to them since they looked -->
        <a v-if="networkOn" class="sitetheme sitechat" :class="{ on: current.startsWith(ROUTES.feed) }" :href="ROUTES.feed" :title="NW.title" :aria-label="NW.title + (netUnread ? ', ' + netUnread + ' ' + NW.notes : '')">
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 9 10 3.5 16.5 9v7.5h-13z" /><path d="M8 16.5v-4h4v4" /></svg>
          <span v-if="netUnread" class="sitebag-n">{{ netUnread > 99 ? '99+' : netUnread }}</span>
        </a>
        <!-- the coaching chat: a coach's or a member's, with what awaits them -->
        <a v-if="chatOn" class="sitetheme sitechat" :class="{ on: current.startsWith(appPath('chat')) }" :href="appPath('chat')" :title="t('nav.chat')" :aria-label="t('nav.chat') + (unread ? ', ' + unread : '')">
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
            <path d="M3.5 5.5A2 2 0 0 1 5.5 3.5h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8.5L4.5 17v-3.5h1a2 2 0 0 1-2-2z" />
          </svg>
          <span v-if="unread" class="sitebag-n">{{ unread > 99 ? '99+' : unread }}</span>
        </a>
<!-- the community, as an icon: a site whose config asks for the word draws it above, beside the links -->
        <a v-if="spacesOn && !spacesWord" class="sitetheme sitechat" :class="{ on: current.startsWith(ROUTES.spaces) }" :href="ROUTES.spaces" :title="t('nav.spaces')" :aria-label="t('nav.spaces') + (spaceWaiting ? ', ' + spaceWaiting : '')">
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M10.6 6.8a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0M3 16.5v-1a3.5 3.5 0 0 1 3.5-3.5h3a3.5 3.5 0 0 1 3.5 3.5v1M13.4 4.6a2.6 2.6 0 0 1 0 4.4M17.5 16.5v-1a3.5 3.5 0 0 0-2.6-3.4" />
          </svg>
          <span v-if="spaceWaiting" class="sitebag-n">{{ spaceWaiting > 99 ? '99+' : spaceWaiting }}</span>
        </a>
        <!-- the bag shows only while there is something in it -->
        <button v-if="STORE_ON && bagCount" type="button" class="sitetheme sitebag" :title="B.open" :aria-label="B.open + (bagCount ? ', ' + bagCount + ' ' + (bagCount === 1 ? B.item : B.items) : '')" @click="toggleCart">
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 7h12l-1 10.5H5L4 7Z" /><path d="M7 7V5.5a3 3 0 0 1 6 0V7" stroke-linecap="round" />
          </svg>
          <span v-if="bagCount" class="sitebag-n">{{ bagCount }}</span>
        </button>
        <div v-if="isSignedIn" class="siteacct">
          <button type="button" class="sitetheme siteavatar" :title="A.account" :aria-label="A.account"
                  :class="{ 'siteavatar-face': face }"
                  :aria-expanded="acctOpen" @click="acctOpen = !acctOpen">
            <img v-if="face" :src="face" alt="" width="30" height="30" />
            <template v-else>{{ initial }}</template>
          </button>
          <div v-if="acctOpen" class="siteacct-menu" role="menu">
            <span class="siteacct-email">{{ user.email }}</span>
            <a class="siteacct-out siteacct-admin" role="menuitem" :href="ROUTES.account" @click="acctOpen = false">{{ A.account }}</a>
            <a class="siteacct-out siteacct-admin" :class="{ on: current === ROUTES.billing }" :aria-current="current === ROUTES.billing ? 'page' : undefined" role="menuitem" :href="ROUTES.billing" @click="acctOpen = false">{{ BILLING_LABEL }}</a>
            <a v-if="isStaff" class="siteacct-out siteacct-admin" role="menuitem" :href="ROUTES.admin" @click="acctOpen = false">{{ A.admin }}</a>
            <!-- a subscriber's billing: the portal (cards, invoices, cancel) -->
            <button v-if="plan" type="button" class="siteacct-out" role="menuitem" @click="acctOpen = false; openPortal()">{{ A.manage }}</button>
            <button type="button" class="siteacct-out" role="menuitem" @click="doSignOut">{{ A.signout }}</button>
          </div>
        </div>
        <!-- sign-in only where a module reads the account; a signed-in staff member keeps their menu anywhere -->
        <button v-else-if="ACCOUNTS_ON" type="button" class="sitecta" @click="openAuth">{{ A['btn-signin'] }}</button>
        <!-- signed out, the button starts a round; signed in, it is the door to the app -->
        <a v-if="CTA" class="sitecta" :class="{ on: ctaOn }" :href="ctaHref">
          {{ ctaLabel }}
        </a>
        <button type="button" class="sitetheme sitemenu-btn" :class="{ 'sitemenu-on': menuNeeded }" aria-label="Open menu"
                :aria-expanded="menuOpen" @click="menuOpen = true">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          </svg>
          <!-- on a phone the chat button lives in the menu, so the bar still says a message is waiting -->
          <span v-if="(chatOn && unread) || (spacesOn && spaceWaiting) || (networkOn && netUnread)" class="sitebag-n">{{ Math.min(99, (chatOn ? unread : 0) + (spacesOn ? spaceWaiting : 0) + (networkOn ? netUnread : 0)) }}{{ (chatOn ? unread : 0) + (spacesOn ? spaceWaiting : 0) + (networkOn ? netUnread : 0) > 99 ? '+' : '' }}</span>
        </button>
      </nav>
    </div>
  </header>

  <div v-if="menuOpen" class="navmodal" role="dialog" aria-label="Menu">
    <div class="navmodal-top">
      <a class="brand sitebrand" :href="ROUTES.home" :aria-label="SITE_NAME + ' home'" @click="menuOpen = false">
        <SiteMark />
        <span>{{ SITE_NAME }}</span>
      </a>
      <button type="button" class="navmodal-x" aria-label="Close menu" @click="menuOpen = false">
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <nav class="navmodal-links">
      <a v-for="l in menuLinks" :key="l.href + (l.key || l.label)" class="navmodal-link" :class="{ on: linkOn(l) }" :href="l.href" @click="menuOpen = false">{{ linkWord(l) }}</a>
      <a v-if="isSignedIn" class="navmodal-link" :class="{ on: current === ROUTES.billing }" :aria-current="current === ROUTES.billing ? 'page' : undefined" :href="ROUTES.billing" @click="menuOpen = false">{{ BILLING_LABEL }}</a>
      <a v-if="chatOn" class="navmodal-link" :class="{ on: current.startsWith(appPath('chat')) }" :href="appPath('chat')" @click="menuOpen = false"><span>{{ t('nav.chat') }}<span v-if="unread" class="sitebag-n sitebag-n-inline">{{ unread }}</span></span><svg class="navmodal-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 5.5A2 2 0 0 1 5.5 3.5h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8.5L4.5 17v-3.5h1a2 2 0 0 1-2-2z" /></svg></a>
      <a v-if="networkOn" class="navmodal-link" :class="{ on: current.startsWith(ROUTES.feed) }" :href="ROUTES.feed" @click="menuOpen = false"><span>{{ NW.title }}<span v-if="netUnread" class="sitebag-n sitebag-n-inline">{{ netUnread }}</span></span><svg class="navmodal-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 9 10 3.5 16.5 9v7.5h-13z" /><path d="M8 16.5v-4h4v4" /></svg></a>
      <a v-if="spacesOn" class="navmodal-link" :class="{ on: current.startsWith(ROUTES.spaces) }" :href="ROUTES.spaces" @click="menuOpen = false"><span>{{ t('nav.spaces') }}<span v-if="spaceWaiting" class="sitebag-n sitebag-n-inline">{{ spaceWaiting }}</span></span><svg class="navmodal-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.6 6.8a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0M3 16.5v-1a3.5 3.5 0 0 1 3.5-3.5h3a3.5 3.5 0 0 1 3.5 3.5v1M13.4 4.6a2.6 2.6 0 0 1 0 4.4M17.5 16.5v-1a3.5 3.5 0 0 0-2.6-3.4" /></svg></a>
      <button v-if="STORE_ON && bagCount" type="button" class="navmodal-link siteauth" @click="menuOpen = false; toggleCart()"><span>{{ B.title }}<span v-if="bagCount" class="sitebag-n sitebag-n-inline">{{ bagCount }}</span></span><svg class="navmodal-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h12l-1 10.5H5L4 7Z" /><path d="M7 7V5.5a3 3 0 0 1 6 0V7" stroke-linecap="round" /></svg></button>
      <!-- the theme, here on a phone, where the bar has no room for its button -->
      <button type="button" class="navmodal-link siteauth navmodal-theme" @click="flipTheme">
        <span>{{ isDark ? t('nav.theme-light') : t('nav.theme-dark') }}</span>
        <svg v-if="isDark" class="navmodal-ic" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="4.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 1.6v2.2M10 16.2v2.2M1.6 10h2.2M16.2 10h2.2M4 4l1.6 1.6M14.4 14.4L16 16M16 4l-1.6 1.6M5.6 14.4L4 16" stroke="currentColor" stroke-width="1.5"/></svg>
        <svg v-else class="navmodal-ic" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M16.5 12.1A7 7 0 0 1 7.9 3.5a7 7 0 1 0 8.6 8.6Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
      </button>
      <button v-if="!isSignedIn && ACCOUNTS_ON" type="button" class="navmodal-link siteauth" @click="menuOpen = false; openAuth()"><span>{{ A['btn-signin'] }}</span><svg class="navmodal-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="7" r="3.4" /><path d="M3.5 17.5a6.5 6.5 0 0 1 13 0" stroke-linecap="round" /></svg></button>
      <button v-else-if="isSignedIn" type="button" class="navmodal-link siteauth" @click="menuOpen = false; doSignOut()"><span>{{ A.signout }}</span><svg class="navmodal-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 16.5h3M12.5 13.5 16 10l-3.5-3.5M16 10H7.5" /></svg></button>
      <a v-if="CTA" class="navmodal-link cta" :class="{ on: ctaOn }" :href="ctaHref" @click="menuOpen = false">{{ ctaLabel }}</a>
    </nav>
  </div>

  <!-- every page arrives the same way: the content fades and rises in under the
       header, its blocks a beat apart (atlas.css, .pagein); the header itself stays put -->
  <!-- THE PAGE, AND THE FOOT OF IT.
       The two are one column so that a SHORT page still fills the screen and the footer sits at the
       bottom of it rather than half way up with a field of nothing under it. .pagein grows into
       whatever is left (flex: 1) and the footer is the last row; on a long page the column is
       simply taller than the viewport and nothing is stretched.
       The footer is CHROME — the same on the store, an article, the reader and the landing — so the
       layout draws it and no page has to remember to. A landing page whose own markdown names a
       Footer section draws that one instead, and says so (lib/chrome.js), or every such page would
       end in two. A site whose settings name no footer has none, which is what a docs site wants. -->
  <div class="pageshell">
    <div class="pagein" :key="current"><slot /></div>
    <LandingFooter v-if="FOOTER && !siteFooterOff" class="lproot sitefoot" v-bind="FOOTER" />
  </div>

  <CommandK ref="palette" />
</template>

<style scoped>
/* the bag button: the badge is red, and only there when the bag has something in it */
.sitebag, .sitechat { position: relative }
.sitechat { text-decoration: none }
.sitechat.on { color: var(--accent2); border-color: var(--accent2) }
.sitebag-n { position: absolute; top: -5px; right: -6px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center; font-family: var(--m); font-size: 10px; font-weight: 600; line-height: 1;
  color: #fff; background: #e5484d; border: 2px solid var(--paper); box-sizing: border-box }
.sitebag-n-inline { position: static; margin-left: 8px; vertical-align: middle }
/* the community as a WORD (spaces.nav: 'word'): a sitelink like the others, with the count beside it
   rather than pinned to a corner — a word has no corner, and a pill that follows the text keeps the
   link on the baseline the other links sit on. Same red as the icons' badge; one language for "waiting". */
.sitelink-badged { display: inline-flex; align-items: center; gap: 7px }
.sitelink-n { display: inline-grid; place-items: center; min-width: 16px; height: 16px; padding: 0 4px;
  font-family: var(--m); font-size: 9px; font-style: normal; font-weight: 600; letter-spacing: 0; line-height: 1;
  color: #fff; background: #e5484d; border-radius: 999px }
/* account: a sign-in link when signed out; the user's initial + a small menu when signed in */
/* the menu's button rows: the row's own type (.navmodal-link), never the button's — font: inherit once made these serif beside mono links */
.siteauth { cursor: pointer; background: none; border: 0; border-bottom: 1px solid var(--hair); color: inherit }
.siteacct { position: relative; display: inline-flex }
/*
 * THE ACCOUNT BUTTON IS ONE OF THE HEADER'S ROUND BUTTONS, so it wears .sitetheme like the search,
 * the theme switch, the chat, the bag and the menu, and carries only what is its own: the initial.
 *
 * It had its own copy of the box instead — the same 32px circle, written out a second time — and
 * the copy was equal until the header sat over a picture. There .sitetheme turns light so it can be
 * seen against the image, and nothing turned the account button light with it, so on exactly the
 * pages with a hero the one button that says who you are was the one you could not see. A rule
 * copied is a rule that stops being copied the first time the original changes.
 */
.siteavatar { font-family: var(--m); font-size: 12px; font-weight: 700 }
/* a face fills the chip edge to edge — the chip is the frame, so no padding and no second border */
.siteavatar-face { padding: 0; overflow: hidden }
.siteavatar-face img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: inherit }
.siteacct-menu { position: absolute; right: 0; top: calc(100% + 8px); min-width: 210px; background: var(--paper); color: var(--ink);
  border: 1px solid var(--hair); border-radius: 12px; padding: 8px; box-shadow: 0 18px 40px -20px #0009; z-index: 50 }
.siteacct-email { display: block; font-family: var(--m); font-size: 11px; color: var(--ink3); padding: 6px 10px 8px;
  border-bottom: 1px solid var(--hair); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.siteacct-out { display: block; width: 100%; text-align: left; font: inherit; font-size: 13.5px; color: var(--ink); background: none;
  border: 0; border-radius: 8px; padding: 8px 10px; cursor: pointer }
.siteacct-out:hover { background: color-mix(in srgb, var(--ink) 6%, transparent) }
.siteacct-out.on { background: color-mix(in srgb, var(--ink) 6%, transparent) }
.siteacct-admin { text-decoration: none; box-sizing: border-box }
</style>

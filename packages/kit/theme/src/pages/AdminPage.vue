<script setup>
/*
 * The content admin — local-dev only (App.vue gates the route on import.meta.env.DEV;
 * the API it talks to is a dev-server-only Vite middleware, build/admin-server.mjs).
 *
 * Left rail picks a content type or the strings editor. A collection shows every
 * markdown file in an AG Grid (search/filter/sort); a row opens a validated edit
 * drawer that writes the file directly. Velite re-embeds the write, so the rest of
 * the app reflects it live.
 */
import { moduleOn } from 'platformkit/lib/modules.js'
import { ref, reactive, computed, shallowRef, watch, onMounted, onBeforeUnmount, nextTick, defineAsyncComponent, provide } from 'vue'
import { AgGridVue } from 'ag-grid-vue3'
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community'
import { useAgGridTheme } from '../lib/agGridTheme.js'
import { route, navigate, ROUTES } from '../router.js'
import { CLOUD, CMS } from 'platformkit/lib/router.js'
import { isSignedIn, isAdmin, isStaff, isSupport, isProvider, mayEditContent, maySeeFigures, roleKnown, authSettled } from 'platformkit/lib/auth.js'
import { supabase } from 'platformkit/lib/supabase.js'
import MarkdownEditor from '../components/admin/MarkdownEditor.vue'
import PreviewPane from '../components/admin/PreviewPane.vue'
import MediaPicker from '../components/admin/MediaPicker.vue'
import { useMediaPick } from '../lib/admin/media-pick.js'
import PageBuilder from '../components/admin/PageBuilder.vue'
import ExperimentVariants from '../components/admin/ExperimentVariants.vue'
import ExperimentsAdmin from '../components/admin/ExperimentsAdmin.vue'
import StringsEditor from '../components/admin/StringsEditor.vue'
import ChapterEditor from '../components/admin/ChapterEditor.vue'
import CompanionEditor from '../components/admin/CompanionEditor.vue'
import TeamMembers from '../components/admin/TeamMembers.vue'
import SpanField from '../components/admin/SpanField.vue'
import { sections as SITE_SECTIONS } from '#site/admin'   /* the site's own sections (platformkit.config.js admin.sections) */
import AnalyticsAdmin from '../components/AnalyticsAdmin.vue'
import ContentAnalytics from '../components/ContentAnalytics.vue'
import FormAnalytics from '../components/FormAnalytics.vue'
import FunnelAnalytics from '../components/FunnelAnalytics.vue'
import ContentPiece from '../components/ContentPiece.vue'
import SiteMark from '../components/SiteMark.vue'
import { modules } from '#site'
import { site as SITE_RAW } from '#content'
const SITE_NAME = ((Array.isArray(SITE_RAW) ? SITE_RAW[0] : SITE_RAW) || {}).name || 'Site'
import PrintOrders from '../components/PrintOrders.vue'
import Orders from '../components/Orders.vue'
import Bookings from '../components/Bookings.vue'
import EmailsAdmin from '../components/admin/EmailsAdmin.vue'
import FunnelsAdmin from '../components/admin/FunnelsAdmin.vue'
import BlastsAdmin from '../components/admin/BlastsAdmin.vue'
import SupportAdmin from '../components/SupportAdmin.vue'
import CommentsAdmin from '../components/CommentsAdmin.vue'
import NetworkAdmin from '../components/NetworkAdmin.vue'
import PeopleAdmin from '../components/admin/PeopleAdmin.vue'
import PayoutsAdmin from '../components/admin/PayoutsAdmin.vue'
import CourseEnrollments from '../components/admin/CourseEnrollments.vue'
import PaymentsAdmin from '../components/admin/PaymentsAdmin.vue'
import SpacesAdmin from '../components/SpacesAdmin.vue'
import PushSettings from '../components/PushSettings.vue'
import ApiAdmin from '../components/ApiAdmin.vue'
import PublishingPage from '../components/PublishingPage.vue'
const MediaPage = defineAsyncComponent(() => import('../components/MediaPage.vue'))   /* VueFinder rides with this page alone */
import PrintAdmin from '../components/admin/PrintAdmin.vue'
import FormsAdmin from '../components/admin/FormsAdmin.vue'
/* the publisher calendar is a live-data surface and only ships with its module */
const SocialAdmin = moduleOn('social-publishing') ? defineAsyncComponent(() => import('../components/admin/SocialAdmin.vue')) : null
/* the content models' builder comes as its own chunk, and only with the module on */
const ModelsAdmin = moduleOn('models') ? defineAsyncComponent(() => import('../components/admin/ModelsAdmin.vue')) : null
import ModelLeaf from '../components/admin/ModelLeaf.vue'
import GroupField from '../components/admin/GroupField.vue'
import RowsField from '../components/admin/RowsField.vue'
import { links as CONFIG_NAV } from '#site/nav'
import { themeNav } from '../lib/theme-nav.js'
import TokensField from '../components/admin/TokensField.vue'
import FontsField from '../components/admin/FontsField.vue'
import NavField from '../components/admin/NavField.vue'
import AdminHead from '../components/admin/AdminHead.vue'
import OptionsField from '../components/admin/OptionsField.vue'
import StockField from '../components/admin/StockField.vue'
/* every colour the look names, read from the stylesheets at build time (build/tokens.mjs) so the
   form can never offer a list that has drifted from what the look actually states */
import LOOK_TOKEN_FILE from '#content/tokens.json'
import { look } from 'platformkit/lib/look.js'
/* the palette of the look this site wears; the first one where the site names none */
/* what this site would show having declared no header of its own: its config's, else the theme's.
   The same two layers SiteLayout falls through, from the same module, so the editor's promise and
   the header agree. */
const INHERITED_NAV = (Array.isArray(CONFIG_NAV) && CONFIG_NAV.length) ? CONFIG_NAV : themeNav({ storeOn: moduleOn('store') })
const LOOK_TOKENS = (LOOK_TOKEN_FILE && (LOOK_TOKEN_FILE[look.value] || Object.values(LOOK_TOKEN_FILE)[0])) || {}
import { checkEntry, shownHolds } from 'platformkit/lib/models/entry.js'
import { us, ug } from 'platformkit/lib/strings.js'
import FormResponses from '../components/admin/FormResponses.vue'
import { editionOf } from 'platformkit/lib/storefront.js'
import { printSpec, formatPrice, FORMATS } from 'platformkit/lib/print-offers.js'

import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import InputNumber from 'primevue/inputnumber'
import ToggleSwitch from 'primevue/toggleswitch'
import MultiSelect from 'primevue/multiselect'
import Select from 'primevue/select'
import AutoComplete from 'primevue/autocomplete'
import DatePicker from 'primevue/datepicker'
import Button from 'primevue/button'

ModuleRegistry.registerModules([AllCommunityModule])
const theme = useAgGridTheme()

/* full-screen editing — entire books need more than a drawer's width. The
   editor's toggle sets the preference; it is remembered across sessions. A
   single-file collection (a settings page) never uses it: see `fullscreen` below. */
const fsPref = ref(false)
try { fsPref.value = localStorage.getItem('dl.admin.fs') === '1' } catch (e) { /* private mode */ }
function toggleFS() { fsPref.value = !fsPref.value; try { localStorage.setItem('dl.admin.fs', fsPref.value ? '1' : '0') } catch (e) { /* private */ } }

/* the one client for the content pipe: every read and write of a file goes through it */
import pipe from '../lib/admin/api.js'
const API = '/__admin'
/* the enrichment runs (the Books grid's scripts) are the dev server's own endpoint, beside the pipe — a machine's work, none of it in cloud mode */
async function api(path, opts) {
  if (CLOUD) throw new Error('this runs from a checkout or the deploy, not the live admin')
  const r = await fetch(API + path, opts)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { issues: j.issues })
  return j
}

/* ---------------- collections ---------------- */
const collections = ref({})          /* key → config */
const items = ref([])
const loading = ref(false)
const loadError = ref('')

/* the view (a collection key or 'strings') and the file being edited both live in
   the path — /admin/books, /admin/books/tao-te-ching — so a refresh keeps its place */
const parsed = computed(() => {
  const rest = route.value.slice(ROUTES.admin.length).replace(/^\//, '')
  const [seg, ...rp] = rest.split('/')
  /* a content model's entries are their own view, models/<key> (/admin/models/<key>[/<slug>]); the builder is /admin/model[/<key>] */
  if (seg === 'models' && rp.length) return { view: 'models/' + rp[0], name: rp.slice(1).join('/') }
  if (seg === 'model') return { view: 'models', name: rp.join('/') || '__new' }
  return { view: seg || '', name: rp.join('/') }
})
/* One shell for every desk. In production (no CMS — neither the dev middleware nor cloud mode) the rail holds the
   views that read live data alone: the dashboards, Notifications, Support, and Sales' orders, print orders and
   bookings — nothing that needs the content pipe. A support agent, wherever, sees Notifications and Support and
   nothing else; a reader who is not on the staff sees the gate. */
const LIVE = !CMS
const LIVE_VIEWS = new Set(['analytics', 'content-analytics', 'form-analytics', 'funnel-analytics', 'notifications', 'api', 'support', 'comments', 'spaces', 'orders', 'print-orders', 'bookings', 'social', 'network', 'payments', 'course-enrollments'])
const socialAccess = ref(false)
const socialAccessKnown = ref(false)
const socialAccessError = ref(false)
let socialAccessRequest = 0
async function refreshSocialAccess() {
  const request = ++socialAccessRequest
  socialAccessError.value = false
  if (!authSettled.value || !isSignedIn.value || !moduleOn('social-publishing')) {
    socialAccess.value = false
    socialAccessKnown.value = authSettled.value
    return
  }
  socialAccessKnown.value = false
  const params = new URLSearchParams(window.location.search)
  if (params.get('invitation') === 'accepted') {
    const { error } = await supabase.functions.invoke('social', { body: { action: 'accept_invitation' } })
    if (request !== socialAccessRequest) return
    if (error) {
      console.error('social invitation acceptance failed', error.message)
      socialAccess.value = false
      socialAccessError.value = true
      socialAccessKnown.value = true
      return
    }
    params.delete('invitation')
    const query = params.toString()
    history.replaceState(history.state, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash)
  }
  const { data, error } = await supabase.rpc('social_has_access')
  if (request !== socialAccessRequest) return
  if (error) {
    console.error('social access lookup failed', error.code)
    socialAccess.value = false
    socialAccessError.value = true
  } else socialAccess.value = data === true
  socialAccessKnown.value = true
}
watch([authSettled, isSignedIn, () => route.value], refreshSocialAccess, { immediate: true })

/* WHAT EACH SECTION NEEDS, and the rail is the sections whose need this person meets. It was two
   hard-coded sets and "an administrator sees everything", which is why a coach had to be an
   administrator to answer a member and an editor had to be one to write an article. A section
   names a capability; the reads behind it ask the same one in the database, so the rail is a
   convenience and never the fence — an address typed by hand answers nothing either. */
const NEEDS = {
  /* anybody who runs any part of the site */
  notifications: 'staff',
  social: 'social',
  payments: 'admin',
  /* the desk */
  support: 'support',
  /* the figures — the dashboards, and nothing with a person's name in it. What was sold is NOT a
     dashboard: an order carries the buyer's name and the address a parcel goes to, so Orders, Print
     orders and Bookings need an administrator and the policies behind them still ask is_admin(). */
  analytics: 'figures', 'content-analytics': 'figures', 'form-analytics': 'figures', 'funnel-analytics': 'figures',
  /* WHAT AN EDITOR WRITES, named one by one. Everything not named here needs an administrator —
     the default is the strict one, because a section added later and forgotten should be out of
     an editor's reach rather than in it. Getting this the other way round let an editor see Sales. */
  articles: 'content', books: 'content', companions: 'content', wiki: 'content', docs: 'content',
  /* Pages is an editor's AND a coach's: a coach builds one page, their own, with the same builder,
     and the pipe fences them to the records whose owner is their username. The rail shows them the
     section; the server decides what is in it, which is the only place that decision is safe. */
  pages: 'content-or-own-page', ads: 'content', experiments: 'content',
  media: 'content', publishing: 'content', strings: 'content',
  courses: 'content',
}
const CONTENT = 'content'
const meets = (need) => {
  if (need === 'social') return socialAccessKnown.value && socialAccess.value
  if (!roleKnown.value) return true
  if (need === 'content-or-own-page') return mayEditContent.value || isProvider.value
  if (need === 'staff') return isStaff.value
  if (need === 'admin') return isAdmin.value
  if (need === 'support') return isSupport.value
  if (need === 'figures') return maySeeFigures.value
  if (need === CONTENT) return mayEditContent.value
  return isAdmin.value
}
const COLLECTION_VIEWS = computed(() => new Set(Object.keys(collections.value || {}).map((k) => k.replace(/^models\//, ''))))
const allowed = (k) => {
  if (!isSignedIn.value) return false
  if (roleKnown.value && !isStaff.value && !(k === 'social' && socialAccess.value)) return false
  /* everything else is decided by the group it sits in: Content and Marketing are an editor's —
     including a section the site registered into one of them — and a content model or a collection
     under no group at all is content too; Settings, Engagement, Forms and Sales need an administrator */
  const need = NEEDS[k] || GROUP_NEED[GROUP_OF[k]] || (!GROUP_OF[k] && COLLECTION_VIEWS.value.has(k) ? CONTENT : 'admin')
  if (!meets(need)) return false
  /* in production there is no CMS at all, so only the live-data sections exist */
  return LIVE ? LIVE_VIEWS.has(k) || k === 'people' : true
}
/* where the admin opens: the figures for anybody who may see them, the desk for an agent, and for
   somebody who writes, the first thing they write — never the browser's notification settings, which
   is where an editor used to land */
const homeView = computed(() => {
  const first = ['analytics', 'support'].find((k) => allowed(k))
  if (first) return first
  if (allowed('social')) return 'social'
  const content = ((navGroups.value.find((g) => g.key === 'content') || {}).items || []).filter((k) => !['models', 'media', 'publishing'].includes(k))
  return content[0] || ['notifications', 'people'].find((k) => allowed(k)) || 'support'
})
const gate = computed(() => {
  if (!isSignedIn.value) return 'signin'
  if (roleKnown.value && !isStaff.value && !socialAccessKnown.value) return 'social-check'
  if (socialAccessError.value && !isStaff.value) return 'social-error'
  if (roleKnown.value && !isStaff.value && socialAccessKnown.value && !socialAccess.value) return 'denied'
  return ''
})
const GW = (us('analytics').page || {}).head || {}
const AG = ((us('admin').gate || {}).social || {})
function openAuth() { if (window.DLauth) window.DLauth.open() }
/* `print-orders` was a page and is a filter: the old address still answers, as Orders */
const MOVED = { 'print-orders': 'orders' }
const view = computed(() => { const v = MOVED[parsed.value.view] || parsed.value.view; if (!v || (v === 'publishing' && !CLOUD) || !allowed(v)) return homeView.value; return v })   /* Publishing is cloud mode's; a view the desk does not offer opens the home view */
/* the generic grid and drawer draw a model with no editor of its own; a model with one (the forms, the funnels, the strings, the
   print editions, a site's tests…) is drawn by that editor below, and never by the drawer */
const col = computed(() => { const c = collections.value[view.value]; return c && !c.editor ? c : null })
/* the full-screen preference applies to drawer editors only: a settings page
   (a single-file collection) is already the main surface, so it ignores it and
   the preference is kept for the next book or article */
const fullscreen = computed(() => fsPref.value && !(col.value && col.value.single))
/* a single-file collection (Site settings, Storefront) is a settings page: its
   editor sits in the main area, not behind a grid and a drawer. Only the preview
   takes the whole screen. */
const inlineEditor = computed(() => !!(col.value && col.value.single && !previewing.value))
/* a content model's entries: the model as the check reads it (from the fields the server described), the
   entry's errors by field — required, the rules, unique against the rows in hand, shown-when honoured — shown
   under a field once it has been left, and the slug's source */
const MW = us('models')
const FW = (MW.drawer || {}).foot || {}   /* the drawer's footer: Save · Create · Delete · Cancel, and cloud mode's Save draft · Publish */
const modelOf = computed(() => {
  const c = col.value; if (!c || !c.model) return null
  const leaf = (g) => ({ key: g.key, label: g.label, kind: g.kind, required: !!g.required, rules: g.rules || [], model: g.options && g.options.startsWith('model:') ? g.options.slice(6) : undefined })
  return { fields: c.fields.filter((f) => f.kind).map((f) => ({ key: f.name, label: f.label, kind: f.kind, required: !!f.required, rules: f.rules || [], unique: !!f.unique, shown: f.shown || undefined, of: f.of || undefined, model: f.options && f.options.startsWith('model:') ? f.options.slice(6) : undefined, fields: (f.fields || []).map(leaf) })) }
})
const touched = reactive({})
const entryErrs = computed(() => {
  if (!modelOf.value || !drawer.value) return {}
  const siblings = items.value.filter((x) => x.name !== form.name).map((x) => x.data)
  const out = {}
  for (const e of checkEntry(modelOf.value, form.data, { siblings, words: MW })) { const k = e.field.split(/[.[]/)[0]; if (!out[k]) out[k] = e.message }
  return out
})
const fieldShown = (f) => !f.shown || shownHolds(f.shown, form.data)
const slugSource = computed(() => (col.value && col.value.model && col.value.model.slug !== 'title' ? col.value.model.slug : col.value && col.value.title))
async function renameEntry() {
  const W = (MW.drawer || {}).entry || {}
  const to = window.prompt(W['rename-prompt'], form.name); if (!to || to === form.name) return
  try {
    await pipe.rename(view.value, form.name, to)
    form.name = to; drawer.value = { create: false, name: to }; navigate(ROUTES.admin + '/' + view.value + '/' + to); await loadList()
  } catch (e) { saveError.value = e.message }
}
const savedMsg = ref('')
let savedTimer = null
const fill = (str, m) => String(str || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
function showSaved(word) { savedMsg.value = word || 'Saved.'; clearTimeout(savedTimer); savedTimer = setTimeout(() => { savedMsg.value = '' }, 3000) }
const inlineSlot = ref(null)   /* the element the editor teleports into; it exists only for a single-file collection */

/* the rail: four sections. A key is a collection (label and count from the
   server) or one of the three views with their own editors. Any collection not
   named here still appears, under Other, so a new content type is never lost. */
/* which module each view or collection belongs to: off in platformkit.config.js, it leaves the rail */
const MODULE_OF = { notifications: 'push', api: 'api', articles: 'articles', books: 'books', companions: 'books', wiki: 'wiki', docs: 'docs', ...Object.fromEntries(SITE_SECTIONS.filter((s) => s.module).map((s) => [s.key, s.module])), emails: 'emails', funnels: 'funnels', blasts: 'funnels', 'funnel-analytics': 'funnels', support: 'support', social: 'social-publishing', spaces: 'spaces', community: 'spaces', network: 'network', forms: 'forms', 'form-responses': 'forms', 'form-analytics': 'forms', storefront: 'store', products: 'store', collections: 'store', sessions: 'sessions', teams: 'sessions', providers: 'sessions', print: 'print', 'print-orders': 'print', orders: 'store', bookings: 'sessions', payouts: 'sessions', models: 'models', courses: 'courses', 'course-enrollments': 'courses' }
const modelWords = (us('models').admin || {}).page || {}
/* IS THE VIEW BEHIND THIS KEY AVAILABLE? A VIEW key, not a module id — `products` is a view and
   `store` is the module behind it (MODULE_OF). It was called moduleOn, which is the kit's own name
   for a different question, and a shadow like that is read by whoever comes next as the thing it is
   named after: converting two switch reads in this file to the kit's moduleOn bound them to this
   instead, and the admin would not load. */
const viewOn = (k) => (k.startsWith('models/') ? moduleOn('models') : !MODULE_OF[k] || moduleOn(MODULE_OF[k]))
/*
 * THE RAIL.
 *
 * A GROUP HAS A KEY AND A NAME, and they are different things: the key is identity — what the
 * permissions, the fold state and a site's own registration are keyed on — and the name is words,
 * which live in content/ui/admin.md like every other word in the product. They used to be one
 * literal doing both jobs, so rewording a group silently moved its permission.
 *
 * What is grouped with what, and why — each of these was wrong before:
 *
 *   PEOPLE ARE NOT A SETTING. Everyone with an account, the teams they are in and the providers
 *   who sell through the site are one subject and now one group. Settings keeps what is SET: the
 *   site's record, its words, this browser's push, the API's keys.
 *
 *   COMMENTS APPEARED TWICE, under one label, in two groups — the policy under Settings and the
 *   queue under Engagement, both reading "Comments". They sit together now and say which is which.
 *
 *   WHAT IS SOLD IS NOT WHAT WAS SOLD. Store is the catalogue — the front, the offers, the prices,
 *   the discounts, the printed editions, the booking types. Sales is the ledger: orders, print
 *   orders, bookings, payouts. Thirteen rows under one heading was the old Sales group, and its
 *   own comment admitted the split.
 *
 *   A LANDING PAGE IS CONTENT. Pages were under Marketing beside ads and experiments; they are
 *   files under content/ and are edited by the page builder like everything else in Content.
 *
 *   ENGAGEMENT MEANT TWO THINGS. Reaching people (emails, funnels, blasts, ads, experiments) is
 *   Marketing; people reaching each other or the desk (support, comments, spaces) is Community.
 */
const NAV = [
  { key: 'dashboard', items: ['analytics', 'content-analytics'] },
  { key: 'content', items: ['models', 'media', 'publishing', 'articles', 'books', 'wiki', 'docs', 'pages'] },   /* the machinery first — the builder, the library, and in cloud mode alone the drafts and where a publish goes (navGroups leaves Publishing out of a git-mode admin) — then the kinds; the content models' own rows close the group (navGroups) */
  { key: 'store', items: ['storefront', 'products', 'collections', 'prices', 'promotions', 'print', 'sessions'] },   /* what is for sale */
  { key: 'sales', items: ['orders', 'bookings', 'payouts'] },   /* and what was: every order and what became of it — the printed ones are a FILTER of it rather than a page, since a parcel from a printer and a parcel off a shelf are the same fact about one sale — what cal.com mirrored, and what is owed */
  { key: 'marketing', items: ['emails', 'funnels', 'ads', 'experiments'] },   /* reaching people, and the tests of it; a blast is a tab of Emails and the funnels' numbers a tab of Funnels */
  { key: 'forms', items: ['forms', 'form-responses', 'form-analytics'] },
  { key: 'courses', items: ['courses', 'course-enrollments'] },   /* the course builder is an editor's; who is enrolled, with names and addresses, an administrator's */
  { key: 'community', items: ['support', 'comments', 'community', 'network'] },   /* people reaching the desk, or each other; the policy is a tab of Comments and the spaces a tab of Community */
  { key: 'people', items: ['people', 'teams', 'providers'] },   /* everyone with an account, the teams they are in, and whoever sells through the site */
  { key: 'social', items: ['social'] },
  { key: 'settings', items: ['site', 'strings', 'notifications', 'api', 'payments'] },   /* what is SET, never what is read */
]
/* the group's NAME, from the words — falling back to the key so a group a site invents still
   reads as something rather than as nothing */
const secName = (k) => ((ug('admin', 'rail').sections || {})[k]) || k.replace(/(^|-)([a-z])/g, (_, d, c) => (d ? ' ' : '') + c.toUpperCase())
const RAILVIEWS = ug('admin', 'rail').views || {}
/* the rail's own chrome: the tag, the collapse's title, the heading over the stack's own link */
const CH = ug('admin', 'chrome').main || {}
/* the sentence under a page's title, where the page is drawn by this shell rather than a component */
const LEAD = ug('admin', 'leads').main || {}
const fillW = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const VIEWS = {
  ...RAILVIEWS,
  /* a page whose own strings file already names it keeps that name: one name, one place */
  payouts: ((us('payouts').page || {}).main || {}).title || RAILVIEWS.payouts,
  payments: ((us('payments').page || {}).main || {}).title || RAILVIEWS.payments,
  people: ((us('people').page || {}).main || {}).title || RAILVIEWS.people,
  media: ((us('media').page || {}).head || {}).rail || RAILVIEWS.media,
  publishing: ((us('publishing').page || {}).head || {}).rail || RAILVIEWS.publishing,
  ...Object.fromEntries(SITE_SECTIONS.map((s) => [s.key, RAILVIEWS[s.key] || s.label])),
}
/* the site's sections join the rail: under their group where it exists, else in a group of their own after the theme's */
const SITE_BY_KEY = Object.fromEntries(SITE_SECTIONS.map((s) => [s.key, s]))
for (const s of SITE_SECTIONS) {
  /* a site names a group by its key or by the name it reads under, since both have been written */
  const match = (x, want) => x.key === want || secName(x.key) === want
  const g = NAV.find((x) => match(x, s.sec))
  if (g) { if (!g.items.includes(s.key)) g.items.push(s.key); continue }
  const at = s.after ? NAV.findIndex((x) => match(x, s.after)) : -1   /* a new group goes after the one it names, else last */
  NAV.splice(at >= 0 ? at + 1 : NAV.length, 0, { key: s.sec, items: [s.key] })
}
/* WHICH GROUP EACH SECTION IS IN, and so what it needs — read once, after the site's sections have
   joined the rail. Naming every item would mean remembering to name the next one; the group already
   says what a thing is. */
/* The Spaces page is deliberately not among an editor's: it writes the rooms' files, but it also
   grants a capability to a named person and searches the membership by address, and those are
   administrators' acts (space_grant, space_find_people ask is_admin()). Keeping the room is done in
   the room, by whoever wears a space role that says so — never from here. */
/*
 * WHAT A GROUP NEEDS, keyed on the GROUP KEY and never on its name — a reworded group used to
 * change what it needed, silently.
 *
 * Marketing is not here any more. It used to carry CONTENT as a group, which was always
 * redundant — `pages`, `ads` and `experiments` each name their own need in NEEDS — and it is
 * now wrong besides, since the group also holds the emails, the funnels and the blasts, which are
 * an administrator's. A group need is only ever right where EVERY item in the group shares it.
 */
const GROUP_NEED = { content: CONTENT }
const GROUP_OF = Object.fromEntries(NAV.flatMap((g) => g.items.map((k) => [k, g.key])))

/* a companion is a book's own second file, so the admin shows the two collections as
   one rail item with two tabs (Books · Companions); the path still says which */
const TABBED = {
  books: ['books', 'companions'],
  comments: ['comments', 'comment-policy'],   /* the queue, and the rules it is judged by */
  community: ['community', 'spaces'],         /* the place, and the rooms in it */
  emails: ['emails', 'blasts'],               /* the designs, and what was sent through them */
  funnels: ['funnels', 'funnel-analytics'],   /* the campaigns, and what they did */
}
const tabsOf = (v) => Object.values(TABBED).find((t) => t.includes(v)) || null
const railKey = (v) => Object.keys(TABBED).find((k) => TABBED[k].includes(v)) || v
const navGroups = computed(() => {
  const named = new Set(NAV.flatMap((g) => g.items).concat(Object.values(TABBED).flat()))
  const groups = NAV.map((g) => ({ key: g.key, sec: secName(g.key), items: g.items.filter((k) => viewOn(k) && allowed(k) && (k !== 'publishing' || CLOUD) && (VIEWS[k] || collections.value[k])) })).filter((g) => g.items.length)
  /* one row per content model, closing the Content group after the built-in kinds, by the models' order (the server lists them by name) */
  const modelRows = LIVE || !mayEditContent.value ? [] : Object.keys(collections.value).filter((k) => k.startsWith('models/') && viewOn(k))
  const content = groups.find((g) => g.key === 'content')
  if (content && modelRows.length) content.items.push(...modelRows)
  const extra = LIVE || !mayEditContent.value ? [] : Object.keys(collections.value).filter((k) => !named.has(k) && !k.startsWith('models/') && !collections.value[k].core)
  if (extra.length) groups.push({ key: 'other', sec: secName('other'), items: extra })
  return groups
})
/* the rail's sections fold: the one the page is in stays open, the rest close — and a
   section opened by hand stays open until the page moves into another */
/* the rail folded to its icons — a choice kept per browser */
/* the rail starts folded on a narrow window (a phone) unless this browser has chosen otherwise */
const slim = ref((() => { try { const v = localStorage.getItem('dl.admin.rail'); return v ? v === 'slim' : matchMedia('(max-width: 760px)').matches } catch (e) { return false } })())
watch(slim, (v) => { try { localStorage.setItem('dl.admin.rail', v ? 'slim' : 'wide') } catch (e) { /* private mode */ } })
const openSec = ref('')
const secOf = (v) => { const g = navGroups.value.find((x) => x.items.includes(railKey(v))); return g ? g.key : '' }
/*
 * WHETHER THE PAGE SHOWING IS PART OF A SET, handed down rather than asked for. Every page draws
 * its head with AdminHead; a page in a set gets the tab row in place of its title without knowing
 * it is in one, which is what lets a set be declared HERE (TABBED) and nowhere else.
 */
const TABWORDS = ug('admin', 'rail').tabs || {}
const SETWORDS = ug('admin', 'rail').sets || {}
/* and the one line under a set's title, which reads the same on every tab of it */
const SETLEADS = ug('admin', 'leads').sets || {}
const tabLabel = (k) => TABWORDS[k] || navLabel(k)
provide('adminTabs', computed(() => {
  const t = tabsOf(view.value)
  if (!t) return null
  const set = railKey(view.value)
  return { tabs: t, on: view.value, label: tabLabel, count: navCount, pick, title: SETWORDS[set] || navLabel(set), lead: SETLEADS[set] || '' }
}))
watch([() => railKey(view.value), navGroups], ([k], [was]) => { if (k !== was || !openSec.value) openSec.value = secOf(view.value) }, { immediate: true })
const isOpen = (sec) => openSec.value === sec
const toggleSec = (sec) => { openSec.value = isOpen(sec) ? '' : sec }
const navLabel = (k) => VIEWS[k] || (collections.value[k] && collections.value[k].label) || k
/* cloud mode: how many drafts wait, on the Publishing item (refreshed after a save, a delete or a publish) */
const draftCount = ref(0)
async function countDrafts() { if (!CLOUD) return; try { const j = await pipe.drafts(); draftCount.value = (j.drafts || []).length } catch (e) { /* the count is a hint */ } }
const navCount = (k) => { if (k === 'publishing') return draftCount.value || null; const c = collections.value[k]; return c && !c.single && c.count != null ? c.count : null }

/* sidebar icons, keyed by collection */
const IC = {
  books: '<path d="M10 6C8.6 5 6.3 4.6 4.5 5v10c1.8-.4 4.1 0 5.5 1 1.4-1 3.7-1.4 5.5-1V5c-1.8-.4-4.1 0-5.5 1Z"/><path d="M10 6v10"/>',
  articles: '<path d="M5 4.8A1.8 1.8 0 0 1 6.8 3H12l4 4v8.2A1.8 1.8 0 0 1 14.2 17H6.8A1.8 1.8 0 0 1 5 15.2Z"/><path d="M12 3v4h4"/><path d="M8 11h5M8 14h4"/>',
  wiki: '<circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h13M10 3.5c2.2 2 2.2 11 0 13M10 3.5c-2.2 2-2.2 11 0 13"/>',
  docs: '<path d="M9 3.5h4l3 3v7A1.5 1.5 0 0 1 14.5 15h-5A1.5 1.5 0 0 1 8 13.5v-8A1.5 1.5 0 0 1 9 3.5Z"/><path d="M13 3.5v3h3"/><path d="M8 6.5H6.5A1.5 1.5 0 0 0 5 8v8.5A1.5 1.5 0 0 0 6.5 18h6A1.5 1.5 0 0 0 14 16.5V15"/>',
  media: '<rect x="3" y="4.5" width="14" height="11" rx="1.5"/><circle cx="7.2" cy="8.4" r="1.3"/><path d="M3.5 14l4.2-4 3.1 3 2.4-2.2 3.3 3.2"/>',   /* a picture */
  publishing: '<path d="M6 3.5v13"/><circle cx="6" cy="3.5" r="1.8"/><circle cx="6" cy="16.5" r="1.8"/><circle cx="14" cy="6.5" r="1.8"/><path d="M14 8.3c0 4-8 3-8 7"/>',   /* a branch */
  strings: '<path d="M3.5 5.5h6"/><path d="M6.7 5.5c0 3.5-1.6 6.6-3.2 8"/><path d="M4 9.5c.5 2 2.6 3.6 5 3.6"/><path d="M10.4 16.6l3.3-7 3.3 7"/><path d="M11.6 14.2h4"/>',
  analytics: '<path d="M4 16.5V11"/><path d="M10 16.5V5.5"/><path d="M16 16.5V9"/><path d="M2.5 16.5h15"/>',
  'content-analytics': '<path d="M3 16.5 8 10l3.5 3.5L17 6"/><path d="M13 6h4v4"/>',
  notifications: '<path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 1.5h-13z"/><path d="M8.5 17a1.5 1.5 0 0 0 3 0"/>',
  api: '<circle cx="7" cy="10" r="3"/><path d="M10 10h7M14 10v3M17 10v2"/>',
  'print-orders': '<path d="M3.5 7.5h13v7a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z"/><path d="M6 7.5V5a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 14 5v2.5"/><path d="M8 11h4"/>',
  orders: '<path d="M4 5.5h12l-1.2 7.5H5.6Z"/><path d="M4 5.5L3.4 3.5H2"/><circle cx="7" cy="16" r="1.2"/><circle cx="13.5" cy="16" r="1.2"/>',
  bookings: '<rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M3 8.5h14M7 3v3M13 3v3"/><path d="M7.5 12.5l1.8 1.8 3.4-3.6"/>',
  emails: '<rect x="3" y="5" width="14" height="10" rx="1.6"/><path d="M3.5 6l6.5 5 6.5-5"/>',
  funnels: '<path d="M3 4.5h14l-5.5 6.5v4l-3 1.5v-5.5Z"/>',
  blasts: '<path d="M3 10l14-6-4 13-3-5.5Z"/><path d="M10 11.5 17 4"/>',
  forms: '<rect x="3.5" y="3.5" width="13" height="13" rx="2"/><path d="M6.5 7.5h7M6.5 10.5h4"/><rect x="6.5" y="13" width="3" height="1.5" rx=".5"/>',
  models: '<path d="M10 3.5 16.5 7 10 10.5 3.5 7z"/><path d="M3.5 10.5 10 14l6.5-3.5"/><path d="M3.5 13.5 10 17l6.5-3.5"/>',
  entries: '<rect x="3.5" y="4" width="13" height="4" rx="1.2"/><rect x="3.5" y="11" width="13" height="4" rx="1.2"/><path d="M6 6h.01M6 13h.01"/>',
  courses: '<path d="M3 7.5 10 4l7 3.5-7 3.5-7-3.5Z"/><path d="M6 9.2v3.6c0 1 1.8 2.2 4 2.2s4-1.2 4-2.2V9.2"/><path d="M17 7.5v4"/>',   /* a mortarboard */
  'course-enrollments': '<circle cx="7.5" cy="7" r="2.3"/><path d="M3.5 15.5c0-2.3 1.8-3.8 4-3.8s4 1.5 4 3.8"/><path d="m12.5 9.5 1.6 1.6 3-3.4"/>',   /* a person, ticked */
  'form-responses': '<path d="M4 4.5h12v11H4z"/><path d="M7 8h6M7 11h6"/><path d="m5 15.5 2-2 2 2"/>',
  'form-analytics': '<path d="M3.5 16.5h13"/><path d="M6 13V9M10 13V5M14 13v-3"/>',
  'funnel-analytics': '<path d="M3.5 4.5h13"/><path d="M5 8.5h10"/><path d="M6.5 12.5h7"/><path d="M8 16.5h4"/>',   /* each step narrower than the one above */
  support: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v5a2.5 2.5 0 0 1-2.5 2.5H9l-3.5 3v-3h-.5A2.5 2.5 0 0 1 2.5 11.5v-5Z"/><path d="M7 8.5h6M7 11h3.5"/>',
  spaces: '<path d="M6.5 3.5 5 16.5M12 3.5l-1.5 13M3.5 7.5h13M3 12.5h13"/>',
  teams: '<circle cx="10" cy="7" r="2.4"/><path d="M5.6 16c0-2.4 2-4 4.4-4s4.4 1.6 4.4 4"/><circle cx="4.6" cy="8.4" r="1.7"/><circle cx="15.4" cy="8.4" r="1.7"/><path d="M2 14.6c0-1.7 1.2-2.8 2.6-2.8M18 14.6c0-1.7-1.2-2.8-2.6-2.8"/>',
  providers: '<path d="M10 3v14"/><path d="M13.5 6.2c-.6-.9-1.9-1.4-3.5-1.4-2 0-3.3.9-3.3 2.3 0 3.3 7 1.7 7 5 0 1.5-1.4 2.5-3.7 2.5-1.8 0-3.1-.6-3.8-1.6"/>',
  print: '<path d="M5 3.5h8l2.5 2.5v10.5H5Z"/><path d="M13 3.5V6h2.5"/><path d="M7.5 9h5M7.5 11.5h5M7.5 14h3"/>',
  ads: '<path d="M3.5 8v4h2.5l5.5 3.5v-11L6 8Z"/><path d="M14 7.5a3.6 3.6 0 0 1 0 5"/><path d="M16 5.5a6.4 6.4 0 0 1 0 9"/>',
  products: '<path d="M3.5 4h6l7 7-6 6-7-7Z"/><circle cx="7" cy="7.5" r="1.2"/>',
  storefront: '<path d="M3 8l1.2-4h11.6L17 8"/><path d="M3 8a2.3 2.3 0 0 0 4.6 0 2.4 2.4 0 0 0 4.8 0A2.3 2.3 0 0 0 17 8"/><path d="M4 10.5V17h12v-6.5"/><path d="M8 17v-4h4v4"/>',
  collections: '<rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.2"/><rect x="11" y="3.5" width="5.5" height="5.5" rx="1.2"/><rect x="3.5" y="11" width="5.5" height="5.5" rx="1.2"/><rect x="11" y="11" width="5.5" height="5.5" rx="1.2"/>',
  pages: '<rect x="3.5" y="3" width="13" height="14" rx="2"/><path d="M6.5 7h7M6.5 10h7M6.5 13h4"/>',
  companions: '<path d="M4 4.5h5.5a2 2 0 0 1 2 2v10a1.5 1.5 0 0 0-1.5-1.5H4Z"/><path d="M16 4.5h-4.5a2 2 0 0 0-2 2v10a1.5 1.5 0 0 1 1.5-1.5H16Z"/><path d="M6.5 8h2M6.5 10.5h2"/>',
  experiments: '<path d="M3.5 10h4"/><path d="M7.5 10c2.5 0 2.5-4.5 5-4.5h4"/><path d="M7.5 10c2.5 0 2.5 4.5 5 4.5h4"/><circle cx="14.5" cy="5.5" r="1.3"/><circle cx="14.5" cy="14.5" r="1.3"/>',
  sessions: '<circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.5 1.5"/>',
  site: '<circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h13"/><path d="M10 3.5c2.2 2 2.2 11 0 13"/><path d="M10 3.5c-2.2 2-2.2 11 0 13"/><path d="M5 6.5h10M5 13.5h10"/>',
  ...Object.fromEntries(SITE_SECTIONS.filter((s) => s.icon).map((s) => [s.key, s.icon])),
  'api-docs': '<path d="M7.5 4 5 10l2.5 6"/><path d="M12.5 4 15 10l-2.5 6"/><path d="M11 5.5 9 14.5"/>',   /* braces and a slash: a reference */
  studio: '<ellipse cx="10" cy="5.5" rx="6" ry="2.5"/><path d="M4 5.5v9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-9"/><path d="M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5"/>',
  /* ───── drawn for the rows that used to fall back to the generic square ───── */
  people: '<circle cx="10" cy="6.8" r="2.6"/><path d="M4.5 16.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/>',   /* one person */
  social: '<circle cx="6" cy="10" r="2"/><circle cx="14" cy="5" r="2"/><circle cx="14" cy="15" r="2"/><path d="m7.8 9.1 4.4-3.2M7.8 10.9l4.4 3.2"/>',   /* connected social channels */
  comments: '<path d="M3.5 5.5A1.5 1.5 0 0 1 5 4h7.5A1.5 1.5 0 0 1 14 5.5v4A1.5 1.5 0 0 1 12.5 11H7l-3.5 2.5Z"/><path d="M16.5 8v5.5A1.5 1.5 0 0 1 15 15h-1.5v2L10.5 15"/>',   /* two bubbles: a thread */
  network: '<path d="M3.5 9 10 3.5 16.5 9v7.5h-13z"/><path d="M8 16.5v-4h4v4"/>',   /* a house: the timeline every member has */
  'comment-policy': '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6A1.5 1.5 0 0 1 14.5 13H8l-4 3Z"/><path d="m7.2 8.4 1.8 1.8 3.8-4"/>',   /* what a comment has to pass */
  community: '<circle cx="10" cy="10" r="2.2"/><circle cx="4.5" cy="5.5" r="1.6"/><circle cx="15.5" cy="5.5" r="1.6"/><circle cx="4.5" cy="14.5" r="1.6"/><circle cx="15.5" cy="14.5" r="1.6"/><path d="M8.3 8.4 5.8 6.7M11.7 8.4l2.5-1.7M8.3 11.6l-2.5 1.7M11.7 11.6l2.5 1.7"/>',   /* a hub and the people on it */
  prices: '<rect x="3.5" y="3.5" width="13" height="13" rx="2"/><path d="M6.3 7.5h4M6.3 10.5h4M6.3 13.5h4"/><path d="M12.4 7.5h1.4M12.4 10.5h1.4M12.4 13.5h1.4"/>',   /* rows with a figure at the end of each */
  promotions: '<path d="M5.5 3.5h9a2 2 0 0 1 2 2V8a2 2 0 0 0 0 4v2.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V12a2 2 0 0 0 0-4V5.5a2 2 0 0 1 2-2Z"/><path d="m8 12 4-4"/><circle cx="8.2" cy="8.2" r=".9"/><circle cx="11.8" cy="11.8" r=".9"/>',   /* a torn coupon with a per-cent in it */
  payouts: '<path d="M3.5 6.5h13v8h-13z"/><circle cx="10" cy="10.5" r="2"/><path d="M3.5 9h1.5M15 12h1.5"/><path d="M6 4.5h8"/>',   /* a note paid out */
  default: '<rect x="4" y="4" width="12" height="12" rx="2.5"/>',
}
const icon = (k) => `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${IC[k] || (k.startsWith('models/') ? IC.entries : IC.default)}</svg>`

/* The local Supabase Studio, offered only when the admin is opened from this
   machine (localhost / loopback). It is the dev stack's own UI: from any other
   host — a phone on the LAN, a deployed build — the address means nothing. */
const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
const STUDIO_URL = import.meta.env.VITE_SUPABASE_STUDIO_URL || 'http://127.0.0.1:54323'
/*
 * THE DEVELOPERS' LINKS. Both leave this shell, so neither is a view and neither is in NAV.
 *
 *   Supabase Studio is the local stack's own UI and exists on this machine alone — from anywhere
 *   else the address is somebody's laptop, so it is offered only on localhost, only to an
 *   administrator, and never in the production admin.
 *
 *   The API reference is the site's own page (ROUTES.api: Scalar over the content API's OpenAPI
 *   document), so it is there wherever the site is — in development and in production both — for
 *   as long as the api module is on.
 */
const devLinks = computed(() => [
  ...(isLocalhost && !LIVE && isAdmin.value ? [{ key: 'studio', href: STUDIO_URL, out: true }] : []),
  ...(viewOn('api') && isStaff.value ? [{ key: 'api-docs', href: ROUTES.api, out: true }] : []),
])

/* canonical option lists for the constrained multi-selects (topics, concepts) */
const optionsCache = reactive({})
const groupedCache = reactive({})    /* the same options nested for PrimeVue's grouping */
async function loadOptions(key) {
  if (optionsCache[key]) return
  try {
    /* the hosts a booking type may name are accounts, read from the database (admin_hosts: every account that gives appointments) */
    const opts = key === 'hosts' ? ((await supabase.rpc('admin_hosts')).data || []).map((h) => ({ value: h.email, label: h.name ? `${h.name} · ${h.email}` : h.email })) : await pipe.options(key)
    optionsCache[key] = opts
    if (opts.some((o) => o.group)) {
      const map = {}, out = []
      for (const o of opts) { if (!map[o.group]) { map[o.group] = { group: o.group, items: [] }; out.push(map[o.group]) } map[o.group].items.push(o) }
      groupedCache[key] = out
    }
  } catch (e) { optionsCache[key] = [] }
}
const grouped = (key) => !!groupedCache[key]
/* a value the list no longer offers stays choosable, named for what it is */
/* the drawer's title: the title field — or, where that field picks from a list (a companion's
   book), the list's label for it rather than the slug */
const headTitle = computed(() => {
  if (!col.value) return ''
  const f = col.value.fields.find((x) => x.name === col.value.title)
  const v = form.data[col.value.title]
  if (f && f.options && v) { const o = msOptions(f.options).find((x) => x.value === v); if (o) return o.label }
  return v || form.data.title || form.name
})
const withCurrent = (opts, v) => (v && Array.isArray(opts) && !opts.some((o) => o.value === v || (o.items || []).some((x) => x.value === v))) ? opts.concat({ value: v, label: v + ' (no such option now)' }) : opts
const msOptions = (key) => groupedCache[key] || optionsCache[key] || []
/* the tag vocabulary, and whether a writer may add to it — see the field's comment in the drawer */
const freeTags = (key) => msOptions(key).some((o) => o && o.value === '__free__')
const tagChoices = (key) => msOptions(key).filter((o) => o && o.value !== '__free__')
const tagSuggestions = ref([])
const suggestTags = (e, f) => {
  const q = String((e && e.query) || '').trim().toLowerCase()
  const have = new Set((form.data[f.name] || []).map((v) => String(v).toLowerCase()))
  tagSuggestions.value = tagChoices(f.options).filter((o) => !have.has(String(o.value).toLowerCase()) && (!q || o.label.toLowerCase().includes(q))).map((o) => o.value)
}
async function loadCollections() {
  collections.value = await pipe.collections()
  const keys = new Set()
  for (const c of Object.values(collections.value)) for (const f of c.fields) if ((f.widget === 'multiselect' || f.widget === 'select' || f.widget === 'tags') && f.options) keys.add(f.options)
  await Promise.all([...keys].map(loadOptions))
}
async function loadList() {
  /* A SITE SECTION ONLY LOADS ITS OWN FILES IF IT HAS AN EDITOR TO LOAD THEM WITH. A section says
     where a thing sits in the rail; the screen may be its own component, or — when the site has
     registered a MODEL under the same key — the grid and drawer the admin draws from its fields,
     which is what every kit collection gets for nothing. This guard tested the section alone, so a
     placement-only section skipped the fetch and drew an empty grid beside a rail badge counting
     the files it would not ask for. */
  if (view.value === 'strings' || view.value === 'print') return
  if (SITE_BY_KEY[view.value] && SITE_BY_KEY[view.value].component) return   /* its editor loads its own files */
  if (['analytics', 'content-analytics', 'notifications', 'api', 'publishing', 'media', 'print-orders', 'orders', 'bookings', 'emails', 'funnels', 'blasts', 'support', 'comments', 'spaces', 'people', 'forms', 'form-responses', 'form-analytics', 'funnel-analytics', 'models', 'payouts', 'social', 'network'].includes(view.value)) return   /* the dashboards fetch their own data */
  loading.value = true; loadError.value = ''
  try { items.value = await pipe.items(view.value) }
  catch (e) { loadError.value = e.message; items.value = [] }
  finally { loading.value = false }
  /* the grid keeps its row nodes by id and redraws a cell only for a value it saw change: the File cell's mark (a draft come or gone) is drawn again outright */
  await nextTick(); if (gridApi.value) { try { gridApi.value.refreshCells({ columns: ['name'], force: true }) } catch (e) { /* the grid may be gone */ } }
  if (['pages', 'ads', 'experiments'].includes(view.value)) loadExperimentsIndex()
  if (['books', 'companions'].includes(view.value)) loadCompanionsIndex()
  if (view.value === 'books') attachRun()
  if (col.value && col.value.single && !drawer.value) {
    await openEdit(col.value.single)
    try { if (sessionStorage.getItem('dl.admin.saved') === view.value) { sessionStorage.removeItem('dl.admin.saved'); showSaved() } } catch (e) { /* private */ }
  }
}
function pick(v) { navigate(ROUTES.admin + '/' + v) }

/* ---------------- grid ---------------- */
const fmtCell = (p) => {
  const v = p.value
  if (Array.isArray(v)) return v.join(', ')
  if (v === true) return '✓'; if (v === false) return '—'
  if (v && typeof v === 'object') return JSON.stringify(v)
  return v ?? ''
}
const columnDefs = computed(() => {
  if (!col.value) return []
  /* only the fields flagged for the grid — the rest live in the edit drawer, so the
     table stays scannable and fits the width instead of overflowing */
  const fields = col.value.fields.filter((f) => f.grid)
  void companionsIndex.value   /* the Companion column reads the index; recompute when it loads */
  return [
    { field: 'name', headerName: 'File', pinned: 'left', flex: 1.4, minWidth: 190, valueGetter: (p) => (p.data && p.data.draft ? '\u0000' : '') + (p.data ? p.data.name : ''),   /* the draft mark is part of the value, so the cell redraws when it flips */
      valueGetter: (p) => p.data.name,
      cellRenderer: (p) => `${p.data && p.data.draft ? `<i class="ad-draftpill">${FW.draft}</i>` : ''}<span class="ad-file">${p.data ? p.data.name : ''}</span>` },
    ...fields.map((f) => {
      const base = { headerName: f.label.replace(/\s*\(.*\)$/, ''),
        valueGetter: (p) => p.data.data[f.name], valueFormatter: fmtCell }
      if (f.name === 'published') return { ...base, width: 110, valueGetter: (p) => p.data.data.published !== false }
      if (f.type === 'boolean') return { ...base, width: 110 }
      if (f.type === 'number') return { ...base, width: 96, type: 'numericColumn' }
      /* a select shows its choice's label, never the value the file holds */
      if (f.choices && f.choices.length) return { ...base, flex: 1, minWidth: 120, valueFormatter: (q) => { const c = f.choices.find((x) => x.value === q.value); return c ? c.label : fmtCell(q) } }
      return { ...base, flex: f.name === col.value.title ? 2 : 1.2, minWidth: 130 }
    }),
    /* a content model without a body has no words to count */
    ...(col.value.model && !col.value.body ? [] : [{ field: 'words', headerName: 'Words', width: 96, type: 'numericColumn' }]),
    /* books: what the two scripts have written, so a batch can be chosen by eye */
    ...(view.value === 'books' ? [
      { headerName: 'Intro', width: 90, valueGetter: (p) => !!(p.data.data.introduction && String(p.data.data.introduction).trim()), valueFormatter: fmtCell },
      { headerName: 'Companion', width: 118, valueGetter: (p) => { const c = compByBook[p.data.name]; return c ? (c.headings || 0) + ' / ' + (p.data.headings || 0) : '—' } },
    ] : []),
  ]
})
/* books are selectable (checkbox column, header selects all); other grids are not */
const rowSelection = computed(() => (view.value === 'books' ? { mode: 'multiRow', enableClickSelection: false } : undefined))
const getRowId = (p) => p.data.name
const gridApi = shallowRef(null)
const selected = ref([])
function onGridReady(e) { gridApi.value = e.api }
function onSelectionChanged(e) { selected.value = e.api.getSelectedRows().map((r) => r.name) }
const defaultColDef = { sortable: true, filter: true, resizable: true, floatingFilter: true }
function onRowClicked(e) {
  /* a click on the checkbox chooses the row for a batch; anywhere else opens it */
  if (e.event && e.event.target && e.event.target.closest && e.event.target.closest('.ag-selection-checkbox, .ag-checkbox')) return
  navigate(ROUTES.admin + '/' + view.value + '/' + e.data.name)
}

/* ---------------- the enrichment scripts, run on the chosen books ----------------
   build/companion.mjs (summaries, essence, quizzes, insight, premise) and
   build/introduce.mjs (the whole-book introduction) run in the dev server as a
   child process; the log streams into a panel under the bar and the list reloads
   when the run ends. One run at a time. */
const RUNS = {
  enrich: { label: 'Enrich', doing: 'Enriching', title: 'The whole pipeline: the map of the book, its introduction, then every chapter extracted, written and audited' },
  introduce: { label: 'Introduction only', doing: 'Writing introductions', title: 'Stops after the introduction' },
}
const job = ref(null)
const runForce = ref(false)
const runError = ref('')
const logEl = ref(null)
let poll = null
function stopPoll() { if (poll) { clearInterval(poll); poll = null } }
async function refreshJob() {
  if (!job.value) return
  try {
    const { jobs } = await api('/run?id=' + job.value.id)
    if (!jobs[0]) return
    const wasRunning = job.value.running
    job.value = jobs[0]
    await nextTick(); if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
    if (wasRunning && !job.value.running) { stopPoll(); await loadList() }
  } catch (e) { runError.value = e.message; stopPoll() }
}
function watchJob() { stopPoll(); if (job.value && job.value.running) poll = setInterval(refreshJob, 1500) }
async function startRun(script) {
  runError.value = ''
  if (!selected.value.length) return
  if (CLOUD) return await startJobs(script)
  try {
    job.value = (await api('/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ script, books: selected.value, force: runForce.value }) })).job
    watchJob()
  } catch (e) { runError.value = e.message }
}
/*
 * THE SAME BUTTON, WHERE THERE IS NO MACHINE. A dev server starts a process and streams its output;
 * a function cannot start a process, so the run is an AGENT RUN with a job — the same loop, the same
 * budget, the same cancel — and what it says as it goes is read back from its own steps.
 *
 * ONE BOOK, AND ONLY ONE. The library-wide pass stays a machine's: a run is one subject by the
 * database's own rule, and starting eleven of them from a button is eleven budgets nobody chose and
 * a bill nobody looked at first. The rule this project has about spending exists because of exactly
 * that, so the refusal is explicit and says where the pass is run instead.
 */
const cloudRuns = ref([])
async function startJobs(script) {
  const A = await import('platformkit/lib/agents/api.js')
  if (selected.value.length > 1) { runError.value = ENR().many || ''; return }
  const book = selected.value[0]
  const r = await A.job('enrich', book, { options: { stage: script === 'introduce' ? 'introduce' : 'all', force: runForce.value } })
  if (r.error) { runError.value = ENR()[r.error] || r.error; return }
  cloudRuns.value = [{ id: r.id, book, status: r.status || 'queued', spent: 0, steps: [], said: '', error: null }]
  watchCloud()
}
let cloudPoll = null
function watchCloud() {
  if (cloudPoll) clearInterval(cloudPoll)
  cloudPoll = setInterval(async () => {
    const A = await import('platformkit/lib/agents/api.js')
    let moving = false
    for (const r of cloudRuns.value) {
      const got = await A.progress(r.id); if (!got) continue
      Object.assign(r, { status: got.status, spent: Number(got.spent_cents) || 0, steps: got.steps || [], said: got.said || '', error: got.error })
      if (got.status === 'queued' || got.status === 'running') moving = true
    }
    if (!moving) { clearInterval(cloudPoll); cloudPoll = null; await loadList() }
  }, 2000)
}
async function stopCloud(id) { const A = await import('platformkit/lib/agents/api.js'); await A.stop(id) }
const money = (c) => '$' + (Number(c || 0) / 100).toFixed(2)
/* what a job has to show for itself: what it said as it went, or failing that a line per step with
   the stage it was for and what it cost. Built here rather than in the template, because a newline
   inside a template expression is an entity the compiler decodes into a broken string literal. */
function logOf(r) {
  if (r.said) return r.said + (r.error ? '\n\n' + r.error : '')
  const lines = (r.steps || []).map((x) => [x.request && x.request.stage ? x.request.stage : x.kind, x.error || '', x.cost_cents ? money(x.cost_cents) : ''].filter(Boolean).join('  '))
  if (r.error) lines.push('', r.error)
  return lines.join('\n') || '…'
}
/* the enrichment's own words — the theme's `models` scope, group `enrichment`, record `run` */
const ENR = () => ((us('models').enrichment || {}).run || {})

async function stopRun() {
  if (!job.value) return
  try { job.value = (await api('/run/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: job.value.id }) })).job } catch (e) { runError.value = e.message }
}
/* a run started before a reload is still going in the server: show it again */
async function attachRun() {
  if (job.value) return
  try { const { jobs } = await api('/run'); const live = jobs.find((j) => j.running); if (live) { job.value = live; watchJob() } } catch (e) { /* no runs */ }
}
const jobState = computed(() => {
  const j = job.value; if (!j) return ''
  const what = (RUNS[j.script] || {}).doing || j.script
  const n = j.books.length + ' book' + (j.books.length === 1 ? '' : 's')
  if (j.running) return what + ' for ' + n + '…'
  return j.code === 0 ? 'Finished — ' + n + ', see the log' : j.code === null ? 'Stopped' : 'Ended with an error (exit ' + j.code + ')'
})
onBeforeUnmount(stopPoll)

/* ---------------- the edit / create drawer ---------------- */
const drawer = ref(null)            /* { create, name } */
const form = reactive({ name: '', data: {}, content: '' })
const saving = ref(false)
const saveError = ref('')
const issues = ref([])

function blankData() {
  const d = {}
  /* published is on unless the file says otherwise — so a file with no key opens as
     published and stays so on save (the server writes the key only when it is false) */
  for (const f of col.value.fields) d[f.name] = f.widget === 'builder' || f.widget === 'variants' || f.type === 'list' ? [] : f.type === 'boolean' ? f.name === 'published' : ''
  /* a new experiment starts as a running page test — the common case */
  if (col.value.variants) { d.kind = 'page'; d.active = true }
  return d
}

/* which experiments this page or ad is a variant of — the strip in its drawer */
const experimentsIndex = ref([])
async function loadExperimentsIndex() {
  try { experimentsIndex.value = await pipe.items('experiments') } catch (e) { experimentsIndex.value = [] }
}
/* the companion a book has, for the strip in its drawer */
const companionsIndex = ref([])
let compByBook = {}
watch(companionsIndex, (list) => { compByBook = {}; for (const c of list) if (c.data && c.data.book) compByBook[c.data.book] = c }, { immediate: true })
async function loadCompanionsIndex() {
  try { companionsIndex.value = await pipe.items('companions') } catch (e) { companionsIndex.value = [] }
}
const companionOf = computed(() => {
  if (!drawer.value || drawer.value.create || view.value !== 'books') return null
  const c = companionsIndex.value.find((x) => x.data.book === form.name)
  const total = (form.content.match(/^# /gm) || []).length
  return { name: c ? c.name : null, chapters: c ? (c.headings || 0) : 0, total }
})
const memberships = computed(() => {
  if (!drawer.value || drawer.value.create || !['pages', 'ads'].includes(view.value)) return []
  const kind = view.value === 'ads' ? 'ad' : 'page'
  return experimentsIndex.value.filter((e) => (e.data.kind || 'page') === kind && (e.data.variants || []).some((v) => v.item === form.name))
    .map((e) => ({ name: e.name, title: e.data.title || e.name, key: e.data.variants.find((v) => v.item === form.name).key, active: e.data.active !== false, winner: e.data.winner || '' }))
})
async function openEdit(name) {
  saveError.value = ''; issues.value = []
  try {
    const f = await pipe.read(view.value, name)
    form.name = f.name
    form.data = { ...blankData(), ...f.data }
    form.content = f.content || ''
    initMedia()
    drawer.value = { create: false, name }
  } catch (e) { loadError.value = e.message; drawer.value = null }
}
function openNew() {
  saveError.value = ''; issues.value = []
  form.name = ''; form.data = blankData(); form.content = ''
  initMedia()
  for (const k in touched) delete touched[k]
  drawer.value = { create: true }
}
function closeDrawer() {
  bodyChapters.value = 0
  if (parsed.value.name) navigate(ROUTES.admin + '/' + view.value)
  else drawer.value = null
  previewOn.value = false; previewEntry.value = null; previewIssues.value = []
}

/* ---- the live preview ----
   The whole screen, in place of the editor, showing the unsaved draft as the
   site would: the form (fields, body, file name) is sent, debounced, to
   POST /__admin/preview, which runs it through the collection's velite schema
   and returns the entry the build would write, and the pane renders that with
   the site's own components. The last good entry stays up while the draft is
   invalid, with the schema's issues shown above it. */
const PREVIEWABLE = ['articles', 'wiki', 'docs', 'books', 'ads', 'products', 'collections', 'storefront', 'pages']
const previewOn = ref(false)
const previewable = computed(() => PREVIEWABLE.includes(view.value))
const previewing = computed(() => previewOn.value && previewable.value)
/* the preview fills the screen by default; beside the editor is an opt-in that sticks */
const previewSplit = ref((() => { try { return localStorage.getItem('dl.admin.pvsplit') === '1' } catch (e) { return false } })())
function toggleSplit() {
  previewSplit.value = !previewSplit.value
  try { localStorage.setItem('dl.admin.pvsplit', previewSplit.value ? '1' : '0') } catch (e) { /* private */ }
}
const previewEntry = ref(null)
/* the builder and the preview point at each other: the block being edited scrolls the preview to its section, a click on a section opens its block */
const previewFocus = ref(-1), builderPick = ref(-1)
const previewIssues = ref([])
const previewBusy = ref(false)
function togglePreview() { previewOn.value = !previewOn.value }
let pvTimer = null, pvSeq = 0
async function refreshPreview() {
  const my = ++pvSeq
  previewBusy.value = true
  try {
    /* a draft that does not compile is an ordinary state while typing: the pipe answers 200 with the issues */
    const j = await pipe.preview(view.value, form.name, { data: form.data, content: form.content })
    if (my !== pvSeq) return
    if (j.entry) { previewEntry.value = j.entry; previewIssues.value = [] }
    else previewIssues.value = j.issues || [{ path: '', message: j.error || 'Preview failed' }]
  } catch (e) {
    if (my === pvSeq) previewIssues.value = [{ path: '', message: String((e && e.message) || e) }]
  } finally {
    if (my === pvSeq) previewBusy.value = false
  }
}
function schedulePreview() {
  if (pvTimer) { clearTimeout(pvTimer); pvTimer = null }
  if (!drawer.value || !previewOn.value || !previewable.value) return
  pvTimer = setTimeout(refreshPreview, 350)
}
watch([() => form.name, () => form.content, () => JSON.stringify(form.data), previewOn, drawer], schedulePreview)

/* list fields are edited as one-per-line text */
function listText(name) { return (form.data[name] || []).join('\n') }
function setList(name, text) { form.data[name] = text.split('\n').map((s) => s.trim()).filter(Boolean) }
/* raw fields (e.g. media) are edited as JSON */
const rawText = reactive({})
const rawErr = reactive({})
function rawFor(name) {
  if (!(name in rawText)) rawText[name] = form.data[name] != null ? JSON.stringify(form.data[name], null, 2) : ''
  return rawText[name]
}
function setRaw(name, text) {
  rawText[name] = text; rawErr[name] = ''
  if (!text.trim()) { delete form.data[name]; return }
  try { form.data[name] = JSON.parse(text) } catch (e) { rawErr[name] = 'invalid JSON' }
}
/* image / file uploads: a file put under the model's folder of the library, or one chosen from it — the field holds the address either way */
const MF = us('media').page.field
const { choose: chooseMedia } = useMediaPick()
const uploading = reactive({})
async function onChoose(name) { const url = await chooseMedia('image'); if (url) form.data[name] = url }
async function onUpload(name, e) {
  const file = e.target.files && e.target.files[0]; e.target.value = ''
  if (!file) return
  uploading[name] = true; saveError.value = ''
  try {
    const r = await pipe.upload(view.value, file)
    form.data[name] = r.path
  } catch (err) { saveError.value = MF.failed.replace('{error}', err.message) }
  finally { uploading[name] = false }
}
function previewSrc(val) {
  if (!val) return ''
  if (/^https?:\/\//.test(val) || val.startsWith('/')) return val
  return pipe.assetUrl(view.value, val)
}
/* the path field is only for entering a URL — hide it once the value is a managed
   local/relative path (uploaded or pasted); Remove clears it and brings it back */
const showImgPath = (val) => !val || /^https?:\/\//.test(val)

/* date fields are stored as plain YYYY-MM-DD strings; the picker works in Dates */
/* a book's print block is edited on the Print editions page (PrintAdmin.vue), never here:
   the Books drawer shows what it is and opens it there */
const hcLine = (v) => { const s = printSpec(v); if (!s) return 'Not in print'; const on = FORMATS.filter((f) => s.formats[f]).map((f) => { const p = formatPrice(s, f, editionOf(form.name)); return f + (p ? ' $' + p : s.formats[f].markup != null ? ' $' + s.formats[f].markup + ' over' : '') }); return [on.join(', ') || 'no format', s.rights ? 'on sale' : 'no rights line'].join(' · ') }
function toDate(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null }
function toYMD(d) { if (!d) return ''; const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }

/* media (articles): a list of tracks. One track plays inline; two or more become a
   playlist. Frontmatter is a single object for one, an array for several. */
const mediaRows = ref([])
const AUDIO_RE = /\.(mp3|m4a|wav|aac|ogg|oga|flac)(\?|#|$)/i
const YT_RE = /(?:youtube\.com|youtu\.be)/i
const VIMEO_RE = /vimeo\.com/i
const isEmbed = (src) => YT_RE.test(src || '') || VIMEO_RE.test(src || '')
/* YouTube/Vimeo are video; otherwise fall back to the file extension */
const detectType = (src) => (isEmbed(src) ? 'video' : (AUDIO_RE.test(src || '') ? 'audio' : 'video'))
const providerLabel = (src, type) => (YT_RE.test(src || '') ? 'YouTube' : VIMEO_RE.test(src || '') ? 'Vimeo' : type === 'audio' ? 'audio' : 'video')
const toRow = (t) => (typeof t === 'string'
  ? { src: t, type: detectType(t), title: '', poster: '' }
  : { src: t.src || '', type: t.type || detectType(t.src), title: t.title || '', poster: t.poster || '' })
function initMedia() {
  const m = form.data.media
  mediaRows.value = Array.isArray(m) ? m.map(toRow) : (m ? [toRow(m)] : [])
  editing.value = -1
}
/* which track's edit panel is open; a track with no source yet is always open */
const editing = ref(-1)
const isEd = (i) => editing.value === i || !(mediaRows.value[i] && (mediaRows.value[i].src || '').trim())
function editTrack(i) { editing.value = editing.value === i ? -1 : i }
function addTrack() { mediaRows.value.push({ src: '', type: 'video', title: '', poster: '' }); editing.value = mediaRows.value.length - 1 }
function removeTrack(i) { mediaRows.value.splice(i, 1); if (editing.value >= i) editing.value = -1 }
/* the poster shown on a collapsed item: an explicit poster, else a YouTube thumb */
function ytId(src) { const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/.exec(src || ''); return m ? m[1] : '' }
function posterFor(t) { if (t.poster && t.poster.trim()) return t.poster.trim(); const id = ytId(t.src); return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : '' }
function trackLabel(t) { if (t.title && t.title.trim()) return t.title.trim(); const s = (t.src || '').split(/[?#]/)[0].split('/').pop(); return s || 'Untitled track' }
function serializeMedia() {
  const tracks = mediaRows.value.filter((r) => r.src.trim()).map((r) => {
    const t = { type: r.type || detectType(r.src), src: r.src.trim() }
    if (r.title.trim()) t.title = r.title.trim()
    if (r.poster.trim()) t.poster = r.poster.trim()
    return t
  })
  if (!tracks.length) delete form.data.media
  else form.data.media = tracks.length === 1 ? tracks[0] : tracks
}

const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
/* a body split into chapters wants the wide, two-column drawer */
const bodyChapters = ref(0)
/* the page builder says whether every section's form is valid */
const builderValid = ref(true)
async function save() {
  saving.value = true; saveError.value = ''; issues.value = []
  if (col.value.builder && !builderValid.value) { saveError.value = 'A section needs fixing — look for the red mark.'; saving.value = false; return }
  if (col.value.variants && !builderValid.value) { saveError.value = 'The variants need fixing — see the notes under them.'; saving.value = false; return }
  serializeMedia()
  const name = drawer.value.create ? (form.name || slug(form.data[slugSource.value] || '')) : form.name
  if (!name) { saveError.value = 'A file name is required.'; saving.value = false; return }
  if (Object.keys(rawErr).some((k) => rawErr[k])) { saveError.value = 'Fix the invalid JSON fields.'; saving.value = false; return }
  try {
    await pipe.save(view.value, name, { data: form.data, content: form.content }, { create: drawer.value.create })
    for (const k in rawText) delete rawText[k]
    if (col.value.single) {
      /* the settings page stays open. Velite re-embeds the file and Vite reloads the
         page a moment later, so the message rides across that reload */
      try { sessionStorage.setItem('dl.admin.saved', view.value) } catch (e) { /* private */ }
      showSaved()
      return
    }
    drawer.value = null
    if (parsed.value.name) navigate(ROUTES.admin + '/' + view.value)
    await loadList(); countDrafts()
  } catch (e) { saveError.value = e.message; issues.value = e.issues || [] }
  finally { saving.value = false }
}
/* cloud mode: this record saved (as a draft) and published — live, and to the repository as its own commit */
const publishing = ref(false)
async function publishOne() {
  const title = String(form.data[col.value.title || 'title'] || form.name || '')
  if (!confirm(fill(FW['publish-confirm'], { title }))) return
  publishing.value = true; saveError.value = ''; issues.value = []
  if (col.value.builder && !builderValid.value) { saveError.value = 'A section needs fixing — look for the red mark.'; publishing.value = false; return }
  serializeMedia()
  const name = drawer.value.create ? (form.name || slug(form.data[slugSource.value] || '')) : form.name
  if (!name) { saveError.value = 'A file name is required.'; publishing.value = false; return }
  try {
    await pipe.save(view.value, name, { data: form.data, content: form.content }, { create: drawer.value.create })
    for (const k in rawText) delete rawText[k]
    const r = await pipe.publish(view.value, name)
    if (r && r.push && r.push.error) { saveError.value = r.push.error }
    if (col.value.single) { showSaved(FW.published); return }
    drawer.value = null
    if (parsed.value.name) navigate(ROUTES.admin + '/' + view.value)
    await loadList(); countDrafts()
  } catch (e) { saveError.value = e.message; issues.value = e.issues || [] }
  finally { publishing.value = false }
}
async function del() {
  if (!confirm(`Delete ${form.name}? This removes the file.`)) return
  saving.value = true
  try {
    await pipe.remove(view.value, form.name)
    drawer.value = null
    if (parsed.value.name) navigate(ROUTES.admin + '/' + view.value)
    await loadList(); countDrafts()
  } catch (e) { saveError.value = e.message }
  finally { saving.value = false }
}

/* the path drives the view and the open editor */
watch(() => view.value, () => { drawer.value = null; loadList() })
watch(() => parsed.value.name, (name) => {
  if (name && col.value) openEdit(name)
  else if (!(drawer.value && drawer.value.create)) drawer.value = null
})
/* the session is restored asynchronously: the pipe (cloud mode's function wants the JWT) waits for it */
const settled = () => new Promise((r) => { if (authSettled.value) return r(); const stop = watch(authSettled, (v) => { if (v) { stop(); r() } }) })
onMounted(async () => {
  await settled()
  if (!LIVE && (mayEditContent.value || isProvider.value)) await loadCollections()   /* production has no content pipe: the live views fetch their own data */
  if (!LIVE && mayEditContent.value) countDrafts()
  if (!parsed.value.view) navigate(ROUTES.admin + '/' + homeView.value)
  await loadList()
  if (parsed.value.name && col.value) openEdit(parsed.value.name)
})
</script>

<template>
  <div class="ad" :class="{ 'ad-slim': slim }">
    <aside class="ad-rail">
      <div class="ad-brand">
        <a class="ad-home" href="/" :title="SITE_NAME + ' — the site'" @click.prevent="navigate('/')">
          <SiteMark class="ad-mark" :size="22" />
          <span class="ad-brandname ad-fade">{{ SITE_NAME }}</span>
        </a>
        <span class="ad-brandtag ad-fade">{{ CH.tag }}</span>
        <button type="button" class="ad-collapse" :title="slim ? CH.expand : CH.collapse" :aria-expanded="!slim" @click="slim = !slim">
          <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5l-5 5 5 5" /></svg>
        </button>
      </div>
      <nav class="ad-nav">
        <template v-for="g in navGroups" :key="g.key">
          <button type="button" class="ad-navsec ad-navfold" :class="{ open: isOpen(g.key) || slim, has: secOf(view) === g.key }" :aria-expanded="isOpen(g.key) || slim" :title="slim ? g.sec : ''" @click="!slim && toggleSec(g.key)">
            <span class="ad-fade">{{ g.sec }}</span>
            <svg class="ad-fade" viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 8l4 4 4-4" /></svg>
          </button>
          <!-- THE FOLD. The items stay in the tree and the GROUP grows, so it opens to whatever
               it holds rather than to a guessed height; `inert` keeps a closed group out of the
               tab order, which overflow alone would not. -->
          <div class="ad-navgroup" :class="{ open: isOpen(g.key) || slim }" :inert="!(isOpen(g.key) || slim) || undefined">
            <div class="ad-navinner">
              <button v-for="k in g.items" :key="k" type="button" class="ad-navitem" :class="{ on: railKey(view) === k }" :title="slim ? navLabel(k) : ''" @click="pick(k)">
                <span class="ad-navico" v-html="icon(k)" />
                <span class="ad-navlabel ad-fade">{{ navLabel(k) }}</span>
                <span v-if="navCount(k) != null" class="ad-navcount ad-fade">{{ navCount(k) }}</span>
              </button>
            </div>
          </div>
        </template>
        <template v-if="devLinks.length">
          <button type="button" class="ad-navsec ad-navfold" :class="{ open: isOpen('developers') || slim }" :aria-expanded="isOpen('developers') || slim" :title="slim ? secName('developers') : ''" @click="!slim && toggleSec('developers')">
            <span class="ad-fade">{{ secName('developers') }}</span>
            <svg class="ad-fade" viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 8l4 4 4-4" /></svg>
          </button>
          <div class="ad-navgroup" :class="{ open: isOpen('developers') || slim }" :inert="!(isOpen('developers') || slim) || undefined">
            <div class="ad-navinner">
              <a v-for="l in devLinks" :key="l.key" class="ad-navitem ad-navlink" :href="l.href" :target="l.out ? '_blank' : null" :rel="l.out ? 'noopener' : null" :title="slim ? navLabel(l.key) : ''">
                <span class="ad-navico" v-html="icon(l.key)" />
                <span class="ad-navlabel ad-fade">{{ navLabel(l.key) }}</span>
                <span class="ad-navext ad-fade" aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
        </template>
      </nav>
      <div class="ad-railfoot">
        <a class="ad-exit" href="/content" :title="slim ? 'Back to site' : ''">
          <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 10l5 5M6 10h9" /></svg>
          <span class="ad-fade">Back to site</span>
        </a>
      </div>
    </aside>

    <main class="ad-main">
      <!-- the gate: the desk is the staff's -->
      <div v-if="gate" class="ad-analytics"><div class="ad-gate"><h2>{{ gate === 'signin' ? GW['desk-signin-heading'] : gate === 'social-check' ? AG['check-heading'] : gate === 'social-error' ? AG['invitation-error-heading'] : GW['desk-denied-heading'] }}</h2><p>{{ gate === 'signin' ? GW['desk-signin-subtitle'] : gate === 'social-check' ? AG['check-subtitle'] : gate === 'social-error' ? AG['invitation-error-subtitle'] : GW['desk-denied-subtitle'] }}</p><button v-if="gate === 'signin'" type="button" class="ad-save" @click="openAuth">{{ GW['signin-cta'] }}</button></div></div>
      <template v-else>
      <!-- ============ a collection ============ -->
      <template v-if="col">
        <AdminHead :title="col.label">
          <!-- the line under a collection's title is a sentence saying what the page is for, from
               its own record in the admin's strings. It used to be the file count and the content
               PATH — "10 files in content/store/products" — which told an editor where the
               developer keeps things and nothing about the page. A model the strings do not name
               (a site's own) falls back to a plain count. -->
          <template v-if="LEAD[view] || !col.single" #sub>
            <span v-if="LEAD[view]" v-html="LEAD[view]" />
            <template v-else>{{ fillW(items.length === 1 ? CH.entry : CH.entries, { n: items.length }) }}</template>
          </template>
          <template v-if="!col.single" #actions>
            <button type="button" class="ad-new" @click="openNew">{{ fillW(CH.new, { name: col.label.replace(/s$/, '') }) }}</button>
          </template>
        </AdminHead>
        <p v-if="loadError" class="ad-err">{{ loadError }}</p>
        <!-- experiments: cards with results and actions, not a grid of files -->
        <ExperimentsAdmin v-if="col.variants" :items="items" @changed="loadList" />
        <!-- a single file's editor lands here (teleported from the drawer below) -->
        <div v-else-if="col.single" id="ad-inlineslot" ref="inlineSlot" class="ad-inlineslot" />
        <template v-else>
          <!-- books: choose rows with the checkboxes, then run a script on them -->
          <div v-if="view === 'books'" class="ad-batch">
            <span class="ad-batch-n">{{ selected.length ? selected.length + ' selected' : 'Tick books to run a script on them' }}</span>
            <button v-for="(r, k) in RUNS" v-if="moduleOn('enrichment')" :key="k" type="button" class="ad-batchbtn" :class="{ 'ad-batchsec': k !== 'enrich' }" :title="r.title || ''" :disabled="!selected.length || (job && job.running)" @click="startRun(k)">{{ r.label }}</button>
            <label class="ad-batch-force"><input type="checkbox" v-model="runForce"> rewrite what exists</label>
            <span class="ad-batch-sp" />
            <template v-if="job">
              <span class="ad-batch-state" :class="{ live: job.running, bad: !job.running && job.code !== 0 }"><i v-if="job.running" class="ad-batch-dot" />{{ jobState }}</span>
              <button v-if="job.running" type="button" class="ad-batchbtn ad-batchstop" @click="stopRun">Stop</button>
              <button v-else type="button" class="ad-batchclear" @click="job = null">Clear</button>
            </template>
            <!-- the same strip for a run with no machine behind it: where it is, and what it has spent -->
            <template v-for="r in cloudRuns" :key="r.id">
              <span class="ad-batch-state" :class="{ live: r.status === 'running' || r.status === 'queued', bad: r.status === 'failed' }">
                <i v-if="r.status === 'running' || r.status === 'queued'" class="ad-batch-dot" />{{ ENR()[r.status] || r.status }}
                <small v-if="r.spent"> · {{ (ENR().spent || '').replace('{amount}', money(r.spent)) }}</small>
              </span>
              <button v-if="r.status === 'running' || r.status === 'queued'" type="button" class="ad-batchbtn ad-batchstop" @click="stopCloud(r.id)">{{ ENR().stop }}</button>
              <button v-else type="button" class="ad-batchclear" @click="cloudRuns = []">{{ ENR().clear }}</button>
            </template>
            <span v-if="runError" class="ad-batch-state bad">{{ runError }}</span>
          </div>
          <pre v-if="job" ref="logEl" class="ad-batchlog">{{ job.log || '…' }}</pre>
          <!-- a job has no room to say anything in, so it says it here: a line per stage, and its cost -->
          <pre v-for="r in cloudRuns" :key="'log-' + r.id" class="ad-batchlog">{{ logOf(r) }}</pre>
          <div class="ad-grid">
            <AgGridVue class="ad-aggrid" :theme="theme" :row-data="items" :column-defs="columnDefs" :default-col-def="defaultColDef"
                       :row-selection="rowSelection" :get-row-id="getRowId"
                       :suppress-cell-focus="true" @row-clicked="onRowClicked" @grid-ready="onGridReady" @selection-changed="onSelectionChanged" />
          </div>
        </template>
      </template>

      <!-- ============ ui strings ============ -->
      <template v-else-if="view === 'strings'">
        <AdminHead :title="navLabel('strings')"><template #sub><span v-html="LEAD['strings']" /></template></AdminHead>
        <StringsEditor dir="ui" />
      </template>

      <!-- ============ the print editions: every book in print, and the files it makes ============ -->
      <template v-else-if="view === 'print'">
        <AdminHead :title="navLabel('print')"><template #sub><span v-html="LEAD['print']" /></template></AdminHead>
        <PrintAdmin :book="parsed.name" @open="navigate(ROUTES.admin + '/print/' + $event)" @back="navigate(ROUTES.admin + '/print')" />
      </template>

      <!-- ============ the site's own sections (#site/admin) ============ -->
      <template v-else-if="SITE_BY_KEY[view] && SITE_BY_KEY[view].component">
        <!-- a site's own section is worded like every other page: its title and its line come from
             the admin's strings under its key, and the registration carries no English of its own -->
        <AdminHead :title="VIEWS[view] || SITE_BY_KEY[view].label"><template v-if="LEAD[view]" #sub><span v-html="LEAD[view]" /></template></AdminHead>
        <component :is="SITE_BY_KEY[view].component" :name="parsed.name" />
      </template>

      <!-- ============ analytics & KPIs — the same dashboard that ships to prod ============ -->
      <div v-else-if="view === 'analytics'" class="ad-analytics">
        <AnalyticsAdmin />
      </div>
      <div v-else-if="view === 'content-analytics'" class="ad-analytics">
        <ContentPiece v-if="parsed.name" :kind="parsed.name.split('/')[0]" :id="parsed.name.split('/').slice(1).join('/')" @back="navigate(ROUTES.admin + '/content-analytics')" @open="navigate(ROUTES.admin + '/content-analytics/' + $event.kind + '/' + $event.id)" />
        <ContentAnalytics v-else @open="navigate(ROUTES.admin + '/content-analytics/' + $event.kind + '/' + $event.id)" />
      </div>
      <div v-else-if="view === 'funnel-analytics'" class="ad-analytics">
        <FunnelAnalytics :kind="parsed.name.startsWith('blast/') ? 'blast' : 'funnel'" :name="parsed.name.replace(/^blast\//, '')" @open="navigate(ROUTES.admin + '/funnel-analytics/' + ($event.kind === 'blast' ? 'blast/' : '') + $event.name)" @back="navigate(ROUTES.admin + '/funnel-analytics')" @edit="navigate(ROUTES.admin + ($event.kind === 'blast' ? '/blasts/' : '/funnels/') + $event.name)" />
      </div>
      <div v-else-if="view === 'form-analytics'" class="ad-analytics">
        <FormAnalytics :name="parsed.name" @open="navigate(ROUTES.admin + '/form-analytics/' + $event)" @back="navigate(ROUTES.admin + '/form-analytics')" @responses="navigate(ROUTES.admin + '/form-responses')" />
      </div>
      <div v-else-if="view === 'notifications'" class="ad-analytics">
        <PushSettings />
      </div>
      <div v-else-if="view === 'api'" class="ad-analytics">
        <ApiAdmin />
      </div>
      <div v-else-if="view === 'social'" class="ad-analytics">
        <SocialAdmin />
      </div>
      <div v-else-if="view === 'media'" class="ad-analytics ad-media">
        <MediaPage />
      </div>
      <div v-else-if="view === 'publishing'" class="ad-analytics">
        <PublishingPage @published="draftCount = 0" />
      </div>
      <div v-else-if="view === 'print-orders'" class="ad-analytics">
        <PrintOrders />
      </div>
      <div v-else-if="view === 'orders'" class="ad-analytics">
        <Orders />
      </div>
      <div v-else-if="view === 'bookings'" class="ad-analytics">
        <Bookings />
      </div>
      <template v-else-if="view === 'funnels'">
        <FunnelsAdmin :name="parsed.name" @open="navigate(ROUTES.admin + '/funnels/' + $event)" @back="navigate(ROUTES.admin + '/funnels')" @analytics="navigate(ROUTES.admin + '/funnel-analytics/' + $event)" />
      </template>
      <template v-else-if="view === 'blasts'">
        <BlastsAdmin :name="parsed.name" @open="navigate(ROUTES.admin + '/blasts/' + $event)" @back="navigate(ROUTES.admin + '/blasts')" @analytics="navigate(ROUTES.admin + '/funnel-analytics/blast/' + $event)" />
      </template>
      <div v-else-if="view === 'spaces'" class="ad-analytics">
        <SpacesAdmin />
      </div>

      <div v-else-if="view === 'support'" class="ad-analytics">
        <SupportAdmin :name="parsed.name" @open="navigate(ROUTES.admin + '/support/' + $event)" />
      </div>

      <!-- every comment on the site, for whoever is responsible for all of them. The desk's own
           queue is what is WAITING on the conversations no room owns; this is the whole of it. -->
      <div v-else-if="view === 'network'" class="ad-analytics">
        <NetworkAdmin />
      </div>
      <div v-else-if="view === 'comments'" class="ad-analytics">
        <CommentsAdmin />
      </div>

      <div v-else-if="view === 'payouts'" class="ad-analytics">
        <PayoutsAdmin />
      </div>
      <div v-else-if="view === 'course-enrollments'" class="ad-analytics">
        <CourseEnrollments />
      </div>
      <div v-else-if="view === 'payments'" class="ad-analytics">
        <PaymentsAdmin />
      </div>
      <div v-else-if="view === 'people'" class="ad-analytics">
        <PeopleAdmin />
      </div>
      <template v-else-if="view === 'models'">
        <ModelsAdmin :name="parsed.name" @open="navigate(ROUTES.admin + '/model/' + ($event === '__new' ? '' : $event))" @back="navigate(ROUTES.admin + '/models')" />
      </template>
      <template v-else-if="view === 'forms'">
        <FormsAdmin :name="parsed.name" @open="navigate(ROUTES.admin + '/forms/' + $event)" @back="navigate(ROUTES.admin + '/forms')" />
      </template>
      <template v-else-if="view === 'form-responses'">
        <FormResponses :name="parsed.name" @open="navigate(ROUTES.admin + '/form-responses/' + $event)" @back="navigate(ROUTES.admin + '/form-responses')" />
      </template>
      <template v-else-if="view === 'emails'">
        <AdminHead :title="navLabel('emails')"><template #sub><span v-html="LEAD['emails']" /></template></AdminHead>
        <EmailsAdmin />
      </template>
          </template>
    </main>

    <!-- ============ edit / create drawer ============ -->
    <Teleport :to="inlineSlot || 'body'" :disabled="!(inlineEditor && inlineSlot)" :key="inlineEditor && inlineSlot ? 'inline' : 'overlay'">
    <div v-if="drawer && col" class="ad-veil" :class="{ 'ad-veil-fs': fullscreen || (previewing && !previewSplit), 'ad-inline': inlineEditor }" @click.self="!fullscreen && !previewing && !inlineEditor && closeDrawer()">
      <div class="ad-editor" :class="[fullscreen ? 'ad-fs' : 'ad-drawer', { 'ad-pv': previewing, 'ad-split': previewing && previewSplit, 'ad-builder': !!(col.builder || col.variants || bodyChapters > 0) }]">
        <!-- the editor stays mounted behind a full-screen preview, so the cursor
             and the undo history are where they were on the way back -->
        <div v-show="!previewing || previewSplit" class="ad-edcol">
        <header class="ad-dhead">
          <div class="ad-dhead-l">
            <b>{{ drawer.create ? 'New ' + col.label.replace(/s$/, '') : headTitle }}</b>
            <code v-if="!drawer.create" class="ad-dhead-file">{{ form.name }}</code>
            <button v-if="!drawer.create && col.model && !col.single" type="button" class="ad-fsbtn ad-rename" @click="renameEntry">{{ ((MW.drawer || {}).entry || {}).rename }}</button>
          </div>
          <div class="ad-dhead-r">
            <button v-if="previewable" type="button" class="ad-fsbtn ad-pvbtn" :class="{ on: previewOn }" :aria-pressed="previewOn"
                    :title="previewOn ? 'Hide live preview' : 'Show live preview'" @click="togglePreview">
              <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z" /><circle cx="10" cy="10" r="2.4" />
              </svg>
              <span>Preview</span>
            </button>
            <button v-if="!col.single" type="button" class="ad-fsbtn" :title="fullscreen ? 'Exit full screen' : 'Full screen'" @click="toggleFS">
              <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path v-if="!fullscreen" d="M7.5 3H3v4.5M12.5 3H17v4.5M7.5 17H3v-4.5M12.5 17H17v-4.5" />
                <path v-else d="M3 7.5h4.5V3M17 7.5h-4.5V3M3 12.5h4.5V17M17 12.5h-4.5V17" />
              </svg>
            </button>
            <button v-if="!inlineEditor" type="button" class="ad-x" @click="closeDrawer">×</button>
          </div>
        </header>
        <div class="ad-dwrap">
          <div class="ad-fields">
          <div v-if="drawer.create && col.model" class="ad-f">
            <span>{{ ((MW.drawer || {}).entry || {}).slug }} <small> — {{ ((MW.drawer || {}).entry || {})['slug-help'] }}</small></span>
            <input v-model="form.name" type="text" :placeholder="slug(form.data[slugSource] || '')" />
          </div>
          <div v-else-if="drawer.create" class="ad-f">
            <span>File name <small>(a-z, 0-9, dashes; nesting with /)</small></span>
            <input v-model="form.name" type="text" :placeholder="'auto from title'" />
          </div>

          <div v-if="companionOf" class="ad-expstrip ad-compstrip">
            <div class="ad-expstrip-row">
              <span class="ad-expstrip-key">{{ companionOf.name ? companionOf.chapters + '/' + companionOf.total : '—' }}</span>
              <span class="ad-expstrip-txt"><template v-if="companionOf.name">Companion covers <b>{{ companionOf.chapters }} of {{ companionOf.total }}</b> chapters</template><template v-else>No companion yet — summaries, quizzes and the insight live there</template></span>
              <button v-if="companionOf.name" type="button" class="ad-expstrip-go" @click="navigate(ROUTES.admin + '/companions/' + companionOf.name)">Open companion ↗</button>
              <button v-else type="button" class="ad-expstrip-go" @click="navigate(ROUTES.admin + '/companions')">Companions ↗</button>
            </div>
          </div>
          <div v-if="memberships.length" class="ad-expstrip">
            <div v-for="m in memberships" :key="m.name" class="ad-expstrip-row">
              <span class="ad-expstrip-key">{{ m.key }}</span>
              <span class="ad-expstrip-txt">Variant <b>{{ m.key }}</b> of <b>{{ m.title }}</b>
                <em v-if="m.winner">— ended, winner {{ m.winner }}</em><em v-else-if="!m.active">— paused</em><em v-else>— running</em></span>
              <button type="button" class="ad-expstrip-go" @click="navigate(ROUTES.admin + '/experiments')">Open experiment ↗</button>
            </div>
          </div>

          <div v-for="f in col.fields.filter((x) => x.widget !== 'builder' && x.widget !== 'variants' && x.widget !== 'none' && fieldShown(x))" :key="f.name" class="ad-f" :class="{ 'ad-half': f.half }" @focusout="touched[f.name] = true">
            <span>{{ f.label }}<em v-if="f.required">required</em><small v-if="f.help"> — {{ f.help }}</small></span>
            <ModelLeaf v-if="f.kind === 'markdown' || f.kind === 'datetime' || f.kind === 'file'" :field="f" v-model="form.data[f.name]" :col="view" />
            <GroupField v-else-if="f.widget === 'group'" :fields="f.fields || []" v-model="form.data[f.name]" :col="view" />
            <RowsField v-else-if="f.widget === 'rows'" :field="f" v-model="form.data[f.name]" :col="view" />
            <!-- every colour the look names, read from the stylesheet at build time -->
            <TokensField v-else-if="f.widget === 'tokens'" v-model="form.data[f.name]" :tokens="LOOK_TOKENS" />
            <FontsField v-else-if="f.widget === 'fonts'" v-model="form.data[f.name]" />
            <NavField v-else-if="f.widget === 'nav'" v-model="form.data[f.name]" :inherited="INHERITED_NAV" />
            <!-- THE SHAPES A THING IS SOLD IN. The options are rows; the variants under them are
                 derived and only the few things that differ are editable, so nobody types a key. -->
            <OptionsField v-else-if="f.widget === 'options'" v-model="form.data[f.name]" :form="form.data" :name="form.name" @patch="(p) => Object.assign(form.data, p)" />
            <!-- how many are left: the rows, not the file — the model strips it on every save -->
            <StockField v-else-if="f.widget === 'stock'" :form="form.data" />
            <!-- A SPAN is a number and a unit, never "30d" typed into a box: the funnels editor has
                 drawn one that way since it existed, and a model asking for the same thing should
                 get the same control rather than a field that teaches its grammar. -->
            <SpanField v-else-if="f.widget === 'span'" v-model="form.data[f.name]" />
            <InputText v-if="f.readonly" :model-value="form.data[f.name] || '— assigned on save'" readonly class="ad-ro" fluid />
            <!-- A COLOUR: the swatch and the value beside it. Seven fields across the models asked
                 for this widget and none of them drew anything, so a colour was a field with a
                 label and no control under it. -->
            <div v-else-if="f.widget === 'colour'" class="ad-col">
              <input type="color" :value="form.data[f.name] || '#000000'" :aria-label="f.label" @input="form.data[f.name] = $event.target.value" />
              <InputText v-model="form.data[f.name]" fluid placeholder="#000000" />
              <button v-if="form.data[f.name]" type="button" class="ad-imgrm" @click="form.data[f.name] = ''">{{ MF.remove }}</button>
            </div>
            <InputText v-else-if="f.widget === 'string'" v-model="form.data[f.name]" fluid :type="f.kind === 'url' ? 'url' : f.kind === 'email' ? 'email' : 'text'" />
            <DatePicker v-else-if="f.widget === 'date'" :modelValue="toDate(form.data[f.name])"
                        @update:modelValue="form.data[f.name] = toYMD($event)"
                        dateFormat="yy-mm-dd" showIcon showButtonBar iconDisplay="input" fluid />
            <Select v-else-if="f.widget === 'select'" v-model="form.data[f.name]" :options="withCurrent(f.choices || msOptions(f.options), form.data[f.name])" optionLabel="label" optionValue="value" :filter="!f.choices"
                    :placeholder="'Select ' + f.label.toLowerCase()" showClear fluid />
            <Textarea v-else-if="f.widget === 'text'" v-model="form.data[f.name]" rows="3" autoResize fluid />
            <InputNumber v-else-if="f.widget === 'number'" v-model="form.data[f.name]" :useGrouping="false" fluid showButtons />
            <ToggleSwitch v-else-if="f.widget === 'boolean'" v-model="form.data[f.name]" />
            <MultiSelect v-else-if="f.widget === 'multiselect'" v-model="form.data[f.name]"
                         :options="f.choices || msOptions(f.options)" optionLabel="label" optionValue="value"
                         :optionGroupLabel="grouped(f.options) ? 'group' : undefined" :optionGroupChildren="grouped(f.options) ? 'items' : undefined"
                         filter :maxSelectedLabels="1" :selectedItemsLabel="'{0} ' + f.label.toLowerCase() + ' selected'"
                         :showToggleAll="false" :placeholder="'Select ' + f.label.toLowerCase()" fluid />
            <!--
              TAGS: what a piece is about, chosen from the site's own vocabulary (content/tags.md).
              The list carries the answer to whether a writer may invent one — the options endpoint
              answers a `__free__` entry beside the tags — so the control is the vocabulary's own
              switch read here, never a second setting on the field that could disagree with it.
              Off, it is a picker and nothing else, which is what stops one tag becoming two
              spellings of itself; on, it suggests from the list and takes what is typed.
            -->
            <MultiSelect v-else-if="f.widget === 'tags' && f.options && !freeTags(f.options)" v-model="form.data[f.name]"
                         :options="tagChoices(f.options)" optionLabel="label" optionValue="value"
                         filter :maxSelectedLabels="4" :showToggleAll="false"
                         :placeholder="'Select ' + f.label.toLowerCase()" fluid />
            <AutoComplete v-else-if="f.widget === 'tags'" v-model="form.data[f.name]" multiple :typeahead="false" fluid
                          :suggestions="tagSuggestions" @complete="suggestTags($event, f)"
                          :placeholder="(form.data[f.name] || []).length ? '' : 'type and press Enter'" />
            <AutoComplete v-else-if="f.widget === 'list'" v-model="form.data[f.name]" multiple :typeahead="false" fluid
                          :placeholder="(form.data[f.name] || []).length ? '' : 'type and press Enter'" />
            <div v-else-if="f.widget === 'image'" class="ad-img">
              <span v-if="form.data[f.name]" class="ad-imgprev"><img :src="previewSrc(form.data[f.name])" alt="" /></span>
              <div class="ad-imgctl">
                <div class="ad-imgrow">
                  <label class="ad-imgbtn">
                    <input type="file" accept="image/*" hidden @change="onUpload(f.name, $event)" />
                    {{ uploading[f.name] ? MF.uploading : (form.data[f.name] ? MF.replace : MF['upload-image']) }}
                  </label>
                  <button type="button" class="ad-imgbtn" @click="onChoose(f.name)">{{ MF.choose }}</button>
                  <button v-if="form.data[f.name]" type="button" class="ad-imgrm" @click="form.data[f.name] = ''">{{ MF.remove }}</button>
                </div>
                <InputText v-if="showImgPath(form.data[f.name])" v-model="form.data[f.name]" class="ad-imgpath" fluid :placeholder="MF.paste" />
              </div>
            </div>
            <div v-else-if="f.widget === 'media'" class="ad-media">
              <div v-for="(t, i) in mediaRows" :key="i" class="ad-mitem" :class="{ editing: isEd(i) }">
                <div class="ad-mitem-row" @click="!isEd(i) && editTrack(i)">
                  <span class="ad-mthumb">
                    <img v-if="posterFor(t)" :src="posterFor(t)" alt="" @error="$event.target.remove()" />
                    <svg v-else viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                      <polygon v-if="isEmbed(t.src) || t.type === 'video'" points="7 4 20 12 7 20" fill="currentColor" stroke="none" />
                      <g v-else><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></g>
                    </svg>
                  </span>
                  <div class="ad-mmain">
                    <div class="ad-mtitle">{{ trackLabel(t) }}</div>
                    <div class="ad-msub">
                      <span class="ad-mbadge" :class="isEmbed(t.src) ? 'is-embed' : 'is-' + t.type">{{ providerLabel(t.src, t.type) }}</span>
                      <span class="ad-murl" :class="{ empty: !t.src }">{{ t.src || 'no source yet' }}</span>
                    </div>
                  </div>
                  <div class="ad-mactions">
                    <button type="button" class="ad-micon" :title="editing === i ? 'Done' : 'Edit'" @click.stop="editTrack(i)">
                      <svg v-if="editing === i" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7" /></svg>
                      <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </button>
                    <button type="button" class="ad-micon rm" title="Remove" @click.stop="removeTrack(i)">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>
                <div v-if="isEd(i)" class="ad-medit">
                  <div class="ad-medit-f">
                    <label>Source URL</label>
                    <input v-model="t.src" type="text" placeholder="https://…  file, YouTube or Vimeo URL" @input="t.type = detectType(t.src)" />
                  </div>
                  <div class="ad-medit-2">
                    <div class="ad-medit-f"><label>Title</label><input v-model="t.title" type="text" placeholder="optional" /></div>
                    <div class="ad-medit-f"><label>Poster image</label><input v-model="t.poster" type="text" placeholder="optional URL" /></div>
                  </div>
                  <div class="ad-medit-foot">
                    <button v-if="!isEmbed(t.src)" type="button" class="ad-tracktype" :class="'is-' + t.type" title="Switch audio / video"
                            @click="t.type = t.type === 'audio' ? 'video' : 'audio'">{{ t.type }}</button>
                    <span v-else class="ad-tracktype is-embed">{{ providerLabel(t.src, t.type) }}</span>
                    <button type="button" class="ad-mdone" :disabled="!(t.src || '').trim()" @click="editing = -1">Done</button>
                  </div>
                </div>
              </div>
              <div class="ad-mediabar">
                <button type="button" class="ad-madd" @click="addTrack">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
                  Add media
                </button>
                <span v-if="mediaRows.length" class="ad-mediahint">{{ mediaRows.length === 1 ? 'one track — plays inline' : mediaRows.length + ' tracks — playlist' }}</span>
              </div>
            </div>
            <div v-else-if="f.widget === 'print'" class="ad-hc">
              <span class="ad-hcline">{{ hcLine(form.data[f.name]) }}</span>
              <button type="button" class="ad-hcgo" :disabled="!form.name" @click="navigate(ROUTES.admin + '/print/' + form.name)">Open the print edition ↗</button>
            </div>
            <template v-else-if="f.widget === 'raw'">
              <textarea :value="rawFor(f.name)" rows="5" class="ad-mono" placeholder="JSON" @input="setRaw(f.name, $event.target.value)" />
              <em v-if="rawErr[f.name]" class="ad-fielderr">{{ rawErr[f.name] }}</em>
            </template>
            <em v-if="entryErrs[f.name] && (touched[f.name] || issues.length)" class="ad-fielderr">{{ entryErrs[f.name] }}</em>
          </div>

          <ul v-if="issues.length" class="ad-issues">
            <li v-for="(i, n) in issues" :key="n"><code>{{ i.path || '(root)' }}</code> {{ i.message }}</li>
          </ul>
          <p v-if="saveError && !issues.length" class="ad-err">{{ saveError }}</p>
          <!-- WHO IS IN A TEAM sits under the team's own fields and is not one of them: the file is
               the declaration, the members are rows, and the panel writes only the rows. -->
          <TeamMembers v-if="view === 'teams'" :team="form.name || ''" :saved="!drawer.create" />
          </div>

          <div v-if="col.builder" class="ad-bodywrap ad-builderwrap">
            <div class="ad-bodylabel">Sections — the page, top to bottom</div>
            <PageBuilder :key="(drawer.name || 'new') + '@' + view" v-model="form.data[col.builder]" :compact="!fullscreen" :pick="builderPick" @valid="builderValid = $event" @focus="previewFocus = $event" />
          </div>
          <div v-else-if="col.variants" class="ad-bodywrap ad-builderwrap ad-variantswrap">
            <div class="ad-bodylabel">Variants — what each shows, and how visitors are split</div>
            <ExperimentVariants :key="(drawer.name || 'new') + '@' + view" v-model="form.data[col.variants]" :kind="form.data.kind || 'page'" :winner="form.data.winner || ''" @valid="builderValid = $event" />
            <template v-if="col.body">
              <div class="ad-bodylabel ad-noteslabel">{{ col.bodyLabel }}</div>
              <MarkdownEditor :key="'notes:' + (drawer.name || 'new') + '@' + view" v-model="form.content" compact />
            </template>
          </div>
          <!-- a companion is edited as what it is — the book's chapters, each a summary, an
               essence and a quiz — never as markdown, so its grammar is the editor's to keep -->
          <div v-else-if="view === 'companions'" class="ad-bodywrap ad-builderwrap">
            <CompanionEditor :key="(drawer.name || 'new') + '@' + view" v-model="form.content" :book="form.data.book || ''" :compact="!fullscreen" @chapters="bodyChapters = $event" />
          </div>
          <div v-else-if="col.body" class="ad-bodywrap" :class="{ 'ad-builderwrap': bodyChapters > 0 }">
            <div class="ad-bodylabel">{{ col.bodyLabel }}</div>
            <ChapterEditor :key="(drawer.name || 'new') + '@' + view" v-model="form.content" :compact="!fullscreen" @chapters="bodyChapters = $event" />
          </div>
        </div>
        <footer class="ad-dfoot">
          <button type="button" class="ad-save" :class="{ 'ad-savedraft': CLOUD }" :disabled="saving || publishing" @click="save">{{ saving ? FW.saving : (CLOUD ? FW['save-draft'] : (drawer.create ? FW.create : FW.save)) }}</button>
          <button v-if="CLOUD" type="button" class="ad-save ad-publish" :disabled="saving || publishing" @click="publishOne">{{ publishing ? FW.publishing : FW.publish }}</button>
          <button v-if="!drawer.create && !col.single" type="button" class="ad-del" :disabled="saving || publishing" @click="del">{{ FW.delete }}</button>
          <button v-if="!inlineEditor" type="button" class="ad-cancel" @click="closeDrawer">{{ FW.cancel }}</button>
          <span v-if="savedMsg" class="ad-msg">{{ savedMsg }}</span>
        </footer>
        </div>
        <PreviewPane v-if="previewing" class="ad-preview" :col="view" :entry="previewEntry" :issues="previewIssues" :busy="previewBusy"
                     :split="previewSplit" :focus="previewFocus" @close="previewOn = false" @toggle-split="toggleSplit" @pick="builderPick = $event" />
      </div>
    </div>
    </Teleport>
    <MediaPicker />
  </div>
</template>

<style scoped>
/* the rail folds to its icons (ad-slim): the column eases from 244 to 64px and every word in
   it fades and gives up its width in the same motion; the icons stay where they are, so
   nothing jumps. Remembered per browser. */
.ad { display: grid; grid-template-columns: 244px 1fr; min-height: 100vh; background: var(--paper); color: var(--ink); transition: grid-template-columns .32s cubic-bezier(.2, .8, .2, 1) }
.ad.ad-slim { grid-template-columns: 64px 1fr }
.ad-rail { background: var(--wash); border-right: 1px solid var(--hair); display: flex; flex-direction: column;
  position: sticky; top: 0; height: 100vh; box-sizing: border-box; overflow: hidden }
.ad-fade { transition: opacity .22s cubic-bezier(.2, .8, .2, 1), max-width .32s cubic-bezier(.2, .8, .2, 1); max-width: 200px; white-space: nowrap; overflow: hidden }
.ad-slim .ad-fade { opacity: 0; max-width: 0; pointer-events: none }
/* one left edge for the rail: the mark, every section head, every item's icon and the exit arrow start 22px in
   (the nav's 12px gutter + a row's 10px padding); collapsed, every row is the same 40px box, its icon centred */
.ad-brand { display: flex; align-items: center; gap: 9px; padding: 17px 12px 17px 22px; border-bottom: 1px solid var(--hair); position: relative }
.ad-slim .ad-brand { padding: 17px 0 17px 21px }
.ad-brandtag { margin-left: auto }
.ad-home { display: inline-flex; align-items: center; gap: 9px; min-width: 0; color: inherit; text-decoration: none; border-radius: 8px }   /* a long site name gives way before the tag does */ .ad-home:hover .ad-brandname { color: var(--accent2) }
.ad-collapse { flex: none; margin-left: 4px; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--hair); border-radius: 7px; background: var(--paper); color: var(--ink3); cursor: pointer; transition: transform .32s cubic-bezier(.2, .8, .2, 1), color .15s }
.ad-collapse:hover { color: var(--ink) }
.ad-slim .ad-collapse { position: absolute; right: -13px; top: 50%; transform: translateY(-50%) rotate(180deg); z-index: 3 }
.ad-slim .ad-rail { overflow: visible }
.ad-slim .ad-nav { overflow: visible }
.ad-slim .ad-navfold { padding: 0; margin: 8px 0 4px; height: 1px; background: var(--hair); border-radius: 0; pointer-events: none }
.ad-slim .ad-navfold:first-child { display: none }   /* a rule right under the brand's own would double it */
.ad-slim .ad-navitem { justify-content: center; padding: 10px 0; gap: 0 }
.ad-slim .ad-exit { padding: 7px 0; justify-content: center; gap: 0 }
/* a count pill or an arrow collapses whole: min-width and padding would otherwise keep it wide and push the icon off centre */
.ad-slim .ad-fade { min-width: 0; padding-inline: 0; margin-inline: 0 }
.ad-brandname { font-weight: 700; font-size: 14px; letter-spacing: -.01em; color: var(--ink); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ad-brandtag { margin-left: auto; flex: none; font-family: var(--m); font-size: 9px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--accent2); border: 1px solid var(--hair); border-radius: 999px; padding: 2px 8px }
.ad-nav { flex: 1; overflow-y: auto; padding: 12px 12px; display: flex; flex-direction: column; gap: 2px }
.ad-navsec { font-family: var(--m); font-size: 9.5px; letter-spacing: .16em; text-transform: uppercase; color: var(--ink3); margin: 14px 10px 6px }
.ad-navsec:first-child { margin-top: 2px }
/* a section's head folds its items; the arrow turns; the one the page is in is marked */
.ad-navfold { display: flex; align-items: center; justify-content: space-between; width: 100%; box-sizing: border-box; background: transparent; border: 0; padding: 6px 10px; margin: 8px 0 2px; border-radius: 8px; cursor: pointer; font: inherit; font-family: var(--m); font-size: 9.5px; letter-spacing: .16em; text-transform: uppercase; color: var(--ink3) }
.ad-navfold:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); color: var(--ink2) }
.ad-navfold.has { color: var(--ink2) }
.ad-navfold svg { transition: transform .26s cubic-bezier(.2, .8, .2, 1); opacity: .7 } .ad-navfold.open svg { transform: rotate(180deg) }
/*
 * THE FOLD OPENS TO WHAT IT HOLDS. A grid row from 0fr to 1fr animates to the content's own
 * height, so a group of three and a group of eight each take the same time and neither is given
 * a guessed max-height that clips the ninth row the day somebody adds one.
 */
.ad-navgroup { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .26s cubic-bezier(.2, .8, .2, 1) }
.ad-navgroup.open { grid-template-rows: 1fr }
.ad-navinner { overflow: hidden; min-height: 0 }
/* and the rows arrive a beat after the fold rather than with it, so the eye follows the opening
   and then reads — one curve for the whole rail */
.ad-navgroup .ad-navitem { opacity: 0; transform: translateY(-5px); transition: opacity .18s ease, transform .22s cubic-bezier(.2, .8, .2, 1) }
.ad-navgroup.open .ad-navitem { opacity: 1; transform: none; transition-delay: .07s }
/* slim: the groups are always open and the heading is a hair rule, so nothing should move */
.ad-slim .ad-navgroup, .ad-slim .ad-navgroup .ad-navitem { transition: none }
@media (prefers-reduced-motion: reduce) {
  .ad-navgroup, .ad-navgroup .ad-navitem, .ad-navfold svg { transition: none }
  .ad-navgroup .ad-navitem { opacity: 1; transform: none }
}
.ad-navitem { display: flex; align-items: center; gap: 11px; width: 100%; text-align: left; font: inherit; font-size: 14px;
  color: var(--ink2); background: none; border: 0; border-radius: 9px; padding: 9px 10px; box-sizing: border-box; cursor: pointer }
.ad-navitem:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink) }
.ad-navico { display: inline-flex; color: var(--ink3); flex: none }
.ad-navitem:hover .ad-navico { color: var(--ink2) }
.ad-navlabel { flex: 1; min-width: 0 }
.ad-navcount { font-family: var(--m); font-size: 11px; color: var(--ink3);
  background: color-mix(in srgb, var(--ink) 8%, transparent); border-radius: 999px; padding: 1px 8px; min-width: 22px; text-align: center }
.ad-navitem.on { background: color-mix(in srgb, var(--accent2) 15%, transparent); color: var(--accent2); font-weight: 600 }
/* an outbound link dressed as a nav item, with a small "leaves the admin" mark */
.ad-navlink { text-decoration: none; color: inherit }
.ad-navext { font-family: var(--m); font-size: 12px; color: var(--ink3) }
.ad-navitem.on .ad-navico { color: var(--accent2) }
.ad-navitem.on .ad-navcount { color: var(--accent2); background: color-mix(in srgb, var(--accent2) 20%, transparent) }
.ad-railfoot { border-top: 1px solid var(--hair); padding: 10px 12px }
.ad-exit { display: inline-flex; align-items: center; gap: 8px; font-family: var(--m); font-size: 11.5px; letter-spacing: .04em;
  color: var(--ink3); text-decoration: none; padding: 7px 10px; border-radius: 8px; width: 100%; box-sizing: border-box }
.ad-exit:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 6%, transparent) }

/* the main column is exactly the viewport tall and never scrolls itself; the grid
   (or the strings body) takes the leftover space and scrolls inside, so the table
   always fills down to a comfortable bottom margin instead of floating at the top */
.ad-main { height: 100vh; box-sizing: border-box; padding: 26px 30px 30px; min-width: 0; display: flex; flex-direction: column; overflow: hidden }
.ad-head { flex: none; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin: 0 0 20px }
.ad-head h1 { font-family: var(--fd); font-weight: 600; font-size: 27px; margin: 0 }
/* two collections that are one thing to the admin: tabs where the title would be */
.ad-tabs { display: inline-flex; gap: 2px; padding: 3px; background: var(--wash); border: 1px solid var(--hair); border-radius: 10px }
.ad-tabs button { display: inline-flex; align-items: center; gap: 8px; font-family: var(--fd); font-weight: 600; font-size: 16px; color: var(--ink3); background: none; border: 0; border-radius: 7px; padding: 6px 14px; cursor: pointer; transition: color .12s, background .12s }
.ad-tabs button:hover { color: var(--ink) }
.ad-tabs button.on { color: var(--ink); background: var(--paper); box-shadow: 0 1px 2px #0000001a, 0 0 0 1px var(--hair) }
.ad-tabcount { font-family: var(--m); font-weight: 500; font-size: 11px; color: var(--ink3); background: color-mix(in srgb, var(--ink3) 14%, transparent); border-radius: 999px; padding: 1px 7px }
.ad-tabs button.on .ad-tabcount { color: var(--ink2) }
.ad-head p { margin: 4px 0 0; color: var(--ink3); font-size: 13px }
.ad-head code, .ad-strkey-h code { font-family: var(--m); font-size: 12px; color: var(--ink2) }
.ad-new { font: inherit; font-size: 13px; font-weight: 600; color: var(--paper); background: var(--ink); border: 0; border-radius: 999px; padding: 9px 18px; cursor: pointer; white-space: nowrap }
.ad-new:hover { opacity: .9 }
.ad-batch { flex: none; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: -6px 0 12px; padding: 8px 12px; border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 8%, var(--paper)); border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--hair)); font-size: 12.5px; color: var(--ink2) }
.ad-batch-n { font-family: var(--m); font-size: 12px; color: var(--ink2); min-width: 90px }
.ad-batchbtn { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--paper); background: var(--ink); border: 0; border-radius: 999px; padding: 6px 14px; cursor: pointer; white-space: nowrap }
.ad-batchbtn:hover { opacity: .9 } .ad-batchbtn:disabled { opacity: .35; cursor: default }
.ad-batchsec { color: var(--ink); background: none; border: 1px solid var(--ink3) } .ad-batchsec:hover { border-color: var(--ink) }
.ad-batchstop { background: #b3261e }
.ad-batch-force { display: inline-flex; align-items: center; gap: 6px; color: var(--ink3); cursor: pointer } .ad-batch-force input { margin: 0 }
.ad-batch-sp { flex: 1 }
.ad-batch-state { display: inline-flex; align-items: center; gap: 7px; color: var(--ink2) } .ad-batch-state.bad { color: #b3261e }
.ad-batch-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent2); animation: ad-pulse 1.2s ease-in-out infinite }
@keyframes ad-pulse { 0%, 100% { opacity: .35 } 50% { opacity: 1 } }
.ad-batchclear { font: inherit; font-size: 12px; color: var(--accent2); background: none; border: 0; padding: 0; cursor: pointer } .ad-batchclear:hover { text-decoration: underline }
.ad-batchlog { flex: none; max-height: 200px; overflow: auto; margin: 0 0 12px; padding: 10px 12px; border-radius: 10px; background: var(--ink); color: var(--paper); font-family: var(--m); font-size: 12px; line-height: 1.5; white-space: pre-wrap }
.ad-grid { flex: 1; min-height: 0; display: flex }
.ad-aggrid { flex: 1; min-height: 0; width: 100% }
.ad-grid :deep(.ad-file) { font-family: var(--m); font-size: 12.5px; color: var(--accent2) }
.ad-grid :deep(.ag-row) { cursor: pointer }
.ad-grid :deep(.ad-draftpill) { display: inline-block; margin-right: 8px; font-style: normal; font-family: var(--m); font-size: 9.5px; line-height: 1.5; letter-spacing: .12em; text-transform: uppercase; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--accent2); color: var(--accent2); vertical-align: 1px }
.ad-err { color: #b3402e; font-size: 13.5px }

/* editor — a right drawer, or full screen for long bodies */
.ad-veil { position: fixed; inset: 0; z-index: 60; background: #0a0d0b5c; backdrop-filter: blur(3px); display: flex; justify-content: flex-end }
.ad-veil-fs { background: var(--paper); backdrop-filter: none }
/* the settings page: the same editor, in flow inside the main area */
.ad-inlineslot { flex: 1; min-height: 0; display: flex }
.ad-veil.ad-inline { position: static; inset: auto; z-index: auto; background: none; backdrop-filter: none; flex: 1; min-height: 0; width: 100% }
.ad-veil.ad-inline .ad-editor { flex: 1; min-height: 0 }
.ad-veil.ad-inline .ad-drawer { width: 100%; max-width: none; border: 1px solid var(--hair); border-radius: 14px; box-shadow: none; overflow: hidden }
.ad-veil.ad-inline .ad-dhead { background: var(--wash) }
.ad-veil.ad-inline .ad-fields { max-width: 760px }
/* the editor is a column (head, form, foot). The live preview takes the whole
   screen in its place — the site at its real width, breakpoints and all — and
   the column waits behind it, still mounted. */
.ad-editor { background: var(--paper); display: flex; flex-direction: row }
.ad-edcol { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0 }
.ad-drawer { width: 560px; max-width: 96vw; border-left: 1px solid var(--hair); box-shadow: -20px 0 60px -30px #00000080 }
.ad-fs { width: 100vw; height: 100vh }
.ad-editor.ad-pv { width: 100vw; max-width: none; height: 100vh; border: 0; box-shadow: none }
.ad-preview { flex: 1; min-width: 0 }
/* split (opt-in): the editor keeps its width, the preview takes the rest */
.ad-drawer.ad-split { width: min(1240px, 96vw); height: auto; border-left: 1px solid var(--hair) }
/* a builder collection: the builder is the main surface, so the drawer is wide and the fields sit beside it */
.ad-drawer.ad-builder { width: min(1120px, 96vw) }
.ad-drawer.ad-builder .ad-dwrap { display: grid; grid-template-columns: minmax(0, 1fr) 340px; overflow: hidden; padding: 0 }
.ad-drawer.ad-builder .ad-fields { order: 1; overflow-y: auto; border-left: 1px solid var(--hair); background: var(--wash) }
.ad-drawer.ad-builder .ad-bodywrap { order: 0; min-height: 0; overflow: hidden; padding: 18px 20px }
/* beside the live preview the builder keeps the room it needs; the fields narrow */
.ad-drawer.ad-builder.ad-split { width: min(1560px, 98vw) }
.ad-drawer.ad-builder.ad-split .ad-edcol { flex: 0 0 760px }
.ad-drawer.ad-builder.ad-split .ad-dwrap { grid-template-columns: minmax(0, 1fr) 280px }
.ad-builderwrap { display: flex; flex-direction: column; min-height: 0 }
.ad-fs .ad-builderwrap { max-width: 860px }
/* an experiment's variants scroll as a whole, notes beneath them */
.ad-drawer.ad-builder .ad-variantswrap { overflow-y: auto }
.ad-noteslabel { margin-top: 26px }
/* the strip on a page or ad that is a variant of an experiment */
.ad-expstrip { display: flex; flex-direction: column; gap: 6px; margin-bottom: 4px }
.ad-expstrip-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 8%, var(--paper)); border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--hair)); font-size: 12.5px; color: var(--ink2) }
.ad-expstrip-key { flex: 0 0 auto; font-family: var(--m); font-weight: 600; font-size: 12px; color: var(--paper); background: var(--accent2); border-radius: 6px; padding: 2px 7px }
.ad-expstrip-txt { flex: 1; min-width: 0 } .ad-expstrip-txt b { color: var(--ink); font-weight: 600 } .ad-expstrip-txt em { font-style: normal; color: var(--ink3) }
.ad-expstrip-go { flex: 0 0 auto; font: inherit; font-size: 12px; color: var(--accent2); background: none; border: 0; padding: 0; cursor: pointer; white-space: nowrap }
.ad-expstrip-go:hover { text-decoration: underline }
.ad-drawer.ad-split .ad-edcol { flex: 0 0 560px }
.ad-split .ad-preview { border-left: 1px solid var(--hair) }
.ad-fs.ad-split .ad-preview { flex: 0 0 46% }
.ad-fs.ad-split .ad-dwrap { grid-template-columns: minmax(0, 1fr) 300px }
.ad-fs.ad-split .ad-bodywrap { max-width: none }
.ad-fsbtn.ad-pvbtn { width: auto; padding: 0 10px 0 8px; gap: 6px; font: inherit; font-size: 12.5px }
.ad-fsbtn.ad-pvbtn.on { color: var(--accent2); border-color: var(--accent2); background: color-mix(in srgb, var(--accent2) 10%, transparent) }
.ad-dhead { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 20px; border-bottom: 1px solid var(--hair); flex: none }
.ad-dhead-l { display: flex; align-items: baseline; gap: 10px; min-width: 0 }
.ad-dhead b { font-family: var(--fd); font-weight: 600; font-size: 16px; letter-spacing: -.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ad-dhead-file { font-family: var(--m); font-size: 11px; color: var(--ink3); flex: none; white-space: nowrap }
.ad-rename { margin-left: 10px; font-size: 12px }
.ad-dhead-r { display: flex; align-items: center; gap: 6px; flex: none }
.ad-fsbtn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; color: var(--ink2); background: none; border: 1px solid var(--hair); border-radius: 8px; cursor: pointer }
.ad-fsbtn:hover { color: var(--ink); border-color: var(--ink3) }
.ad-x { font: inherit; font-size: 22px; line-height: 1; color: var(--ink3); background: none; border: 0; cursor: pointer; padding: 0 4px }
.ad-x:hover { color: var(--ink) }
/* drawer: fields then body, one scrolling column */
.ad-dwrap { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: auto }
.ad-fields { padding: 22px 22px; display: flex; flex-direction: column }
/* fields the schema marks half sit two to a row */
.ad-fields { flex-flow: row wrap; column-gap: 12px } .ad-fields > * { width: 100% } .ad-fields > .ad-half { width: calc(50% - 6px) }
.ad-bodywrap { display: flex; flex-direction: column; padding: 0 20px 20px }
.ad-bodylabel { font-family: var(--m); font-size: 11px; letter-spacing: .04em; color: var(--ink3); margin: 0 0 6px }
.ad-drawer .ad-bodywrap { min-height: 360px }
.ad-drawer .ad-bodywrap .md { flex: 1; min-height: 0 }
/* full screen: body on the left (the main surface), metadata on the right */
.ad-fs .ad-dwrap { display: grid; grid-template-columns: minmax(0, 1fr) 400px; overflow: hidden; padding: 0 }
.ad-fs .ad-bodywrap { order: 0; min-height: 0; overflow: hidden; padding: 22px 26px; width: 100%; max-width: 940px; margin: 0 auto; box-sizing: border-box }
.ad-fs .ad-bodywrap .md { flex: 1; min-height: 0 }
.ad-fs .ad-fields { order: 1; overflow-y: auto; border-left: 1px solid var(--hair); background: var(--wash) }
.ad-f { display: block; margin: 0 0 18px }
.ad-hc { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border: 1px solid var(--hair); border-radius: 10px; background: var(--wash); font-size: 13px; color: var(--ink2); text-transform: capitalize }
.ad-hcgo { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--accent2); background: none; border: 0; cursor: pointer; white-space: nowrap; text-transform: none } .ad-hcgo:disabled { opacity: .5; cursor: default }
.ad-f .ad-ro { font-family: var(--m); color: var(--ink3); background: var(--wash); cursor: default }
/* the field label — the :not() spares PrimeVue component roots that are also a
   direct <span> child (DatePicker, AutoComplete): forcing display:block on them
   collapses their fluid flex layout (the DatePicker input shrinks to width:1%) */
.ad-f > span:not([class*="p-"]) { display: block; font-family: var(--m); font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--ink2); margin-bottom: 7px }
.ad-f > span em { color: var(--ink3); font-style: normal; margin-left: 7px; font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em;
  background: color-mix(in srgb, var(--ink) 7%, transparent); border-radius: 999px; padding: 2px 6px; vertical-align: 1px }
.ad-f > span small { text-transform: none; letter-spacing: 0; color: var(--ink3); opacity: .85 }
/* only the plain (non-PrimeVue) inputs in the custom widgets get this base style */
.ad-f input[type=text]:not([class*="p-"]), .ad-f input[type=number]:not([class*="p-"]), .ad-f textarea:not([class*="p-"]) {
  width: 100%; box-sizing: border-box; font: inherit; font-size: 14px; color: var(--ink);
  background: var(--card); border: 1px solid var(--hair); border-radius: 9px; padding: 9px 12px }
.ad-f input:not([class*="p-"]):focus, .ad-f textarea:not([class*="p-"]):focus { outline: 2px solid var(--accent2); outline-offset: 0; border-color: transparent }
/* AutoComplete (free-tag fields): the entry input sits in its own <li> with
   flex:1 1 auto, which forces it onto a phantom empty second row; give it a small
   flex-basis so it tucks in beside the chips and the box hugs its content */
.ad-f :deep(.p-autocomplete-input-multiple) { gap: 5px; padding: 5px 7px }
.ad-f :deep(.p-autocomplete-input-chip) { flex: 1 1 4rem; min-width: 4rem }
.ad-mono { font-family: var(--m) !important; font-size: 12.5px !important; line-height: 1.6 }
.ad-check { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: var(--ink2) }
.ad-check input { width: auto }
.ad-fielderr { color: #b3402e; font-size: 12px; font-style: normal; display: block; margin-top: 4px }
/* image / file upload widget */
/* a colour: the swatch, the value, and a way to say "none" */
.ad-col { display: flex; align-items: center; gap: 10px }
.ad-col input[type=color] { width: 38px; height: 34px; flex: none; padding: 2px; cursor: pointer;
  background: var(--paper); border: 1px solid var(--hair); border-radius: 8px }
.ad-img { display: flex; gap: 14px; align-items: flex-start }
.ad-imgprev { flex: none; width: 64px; height: 86px; border-radius: 7px; overflow: hidden; background: var(--wash); border: 1px solid var(--hair) }
.ad-imgprev img { width: 100%; height: 100%; object-fit: cover; display: block }
.ad-imgctl { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px }
.ad-imgrow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px }
.ad-imgbtn { font: inherit; font-size: 13px; color: var(--ink); background: var(--card); border: 1px solid var(--hair);
  border-radius: 8px; padding: 8px 15px; cursor: pointer; white-space: nowrap }
.ad-imgbtn:hover { border-color: var(--ink3) }
.ad-imgrm { font: inherit; font-size: 12px; color: var(--ink3); background: none; border: 0; cursor: pointer }
.ad-imgrm:hover { color: #b3402e }
.ad-imgpath { font-family: var(--m) !important; font-size: 12px !important }
/* media (articles): each track is a media item — a preview + summary that reads at
   a glance, with an edit panel that only unfolds while you're editing it */
.ad-media { display: flex; flex-direction: column; gap: 8px }
.ad-mitem { border: 1px solid var(--hair); border-radius: 11px; background: var(--card); transition: border-color .12s, box-shadow .12s }
.ad-mitem.editing { border-color: color-mix(in srgb, var(--accent2) 45%, var(--hair));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent2) 9%, transparent) }
.ad-mitem-row { display: flex; align-items: center; gap: 11px; padding: 9px 10px }
.ad-mitem:not(.editing) .ad-mitem-row { cursor: pointer }
.ad-mthumb { flex: none; width: 46px; height: 46px; border-radius: 8px; overflow: hidden; background: var(--wash);
  border: 1px solid var(--hair); display: flex; align-items: center; justify-content: center; color: var(--ink3) }
.ad-mthumb img { width: 100%; height: 100%; object-fit: cover; display: block }
.ad-mmain { flex: 1; min-width: 0 }
.ad-mtitle { font-size: 13.5px; font-weight: 500; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.ad-msub { display: flex; align-items: center; gap: 7px; margin-top: 3px; min-width: 0 }
.ad-mbadge { flex: none; font-family: var(--m); font-size: 9px; letter-spacing: .07em; text-transform: uppercase;
  border-radius: 999px; padding: 2px 7px; border: 1px solid var(--hair); color: var(--ink3) }
.ad-mbadge.is-audio { color: var(--accent2); border-color: color-mix(in srgb, var(--accent2) 40%, transparent) }
.ad-mbadge.is-video { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent) }
.ad-mbadge.is-embed { color: var(--ink2); background: color-mix(in srgb, var(--ink) 7%, transparent); border-color: transparent }
.ad-murl { font-family: var(--m); font-size: 11px; color: var(--ink3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0 }
.ad-murl.empty { font-style: italic; opacity: .7 }
.ad-mactions { flex: none; display: flex; align-items: center; gap: 2px }
.ad-micon { width: 29px; height: 29px; display: inline-flex; align-items: center; justify-content: center;
  color: var(--ink3); background: none; border: 0; border-radius: 7px; cursor: pointer }
.ad-micon:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink) }
.ad-micon.rm:hover { color: #b3402e; background: #b3402e14 }
.ad-mitem.editing .ad-micon:not(.rm) { color: var(--accent2) }
/* edit panel */
.ad-medit { display: flex; flex-direction: column; gap: 9px; padding: 2px 12px 12px; border-top: 1px solid var(--hair) }
.ad-medit-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 9px }
.ad-medit-f label { display: block; font-family: var(--m); font-size: 9.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--ink3); margin: 0 0 4px }
.ad-medit input { width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; color: var(--ink);
  background: var(--paper); border: 1px solid var(--hair); border-radius: 8px; padding: 8px 10px }
.ad-medit input:focus { outline: 2px solid var(--accent2); outline-offset: 0; border-color: transparent }
.ad-medit-foot { display: flex; align-items: center; gap: 10px; margin-top: 1px }
.ad-tracktype { flex: none; font-family: var(--m); font-size: 10px; letter-spacing: .07em; text-transform: uppercase;
  border: 1px solid var(--hair); border-radius: 999px; padding: 5px 12px; cursor: pointer; background: none }
.ad-tracktype.is-audio { color: var(--accent2); border-color: color-mix(in srgb, var(--accent2) 45%, transparent) }
.ad-tracktype.is-video { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent) }
.ad-tracktype.is-embed { color: var(--ink2); background: color-mix(in srgb, var(--ink) 8%, transparent); border-color: var(--hair); cursor: default }
.ad-mdone { margin-left: auto; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--paper); background: var(--ink);
  border: 0; border-radius: 999px; padding: 6px 17px; cursor: pointer }
.ad-mdone:disabled { opacity: .4; cursor: default }
.ad-mediabar { display: flex; align-items: center; gap: 12px; margin-top: 2px }
.ad-madd { display: inline-flex; align-items: center; gap: 7px; font: inherit; font-size: 13px; color: var(--ink);
  background: none; border: 1px dashed var(--hair); border-radius: 10px; padding: 9px 15px; cursor: pointer }
.ad-madd:hover { border-color: var(--ink3); border-style: solid; background: var(--card) }
.ad-madd svg { color: var(--ink3) }
.ad-mediahint { font-family: var(--m); font-size: 11px; color: var(--ink3) }
.ad-issues { margin: 4px 0 0; padding: 12px 14px; list-style: none; background: #b3402e14; border: 1px solid #b3402e40; border-radius: 10px }
.ad-issues li { font-size: 13px; color: #8a2f22; margin: 0 0 4px }
.ad-issues code { font-family: var(--m); font-size: 12px }
.ad-dfoot { display: flex; align-items: center; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--hair); flex: none }
.ad-save { font: inherit; font-size: 14px; font-weight: 600; color: var(--paper); background: var(--ink); border: 0; border-radius: 999px; padding: 10px 22px; cursor: pointer }
.ad-save:disabled { opacity: .5 }
/* cloud mode: Save draft is the quiet one, Publish the one in the accent */
.ad-save.ad-savedraft { background: transparent; color: var(--ink); border: 1px solid var(--hair) }
.ad-save.ad-publish { background: var(--accent2); color: var(--paper) }
.ad-del { font: inherit; font-size: 13px; color: #b3402e; background: none; border: 1px solid #b3402e55; border-radius: 999px; padding: 9px 16px; cursor: pointer }
.ad-del:hover { background: #b3402e; color: #fff }
.ad-cancel { margin-left: auto; font: inherit; font-size: 13px; color: var(--ink3); background: none; border: 0; cursor: pointer }

/* strings */
.ad-analytics { flex: 1; min-height: 0; overflow-y: auto; margin: 0 -30px; padding: 0 30px }
@media (max-width: 760px) { .ad-main { padding: 16px 12px 20px } .ad-analytics { margin: 0 -12px; padding: 0 12px } }
.ad-gate { max-width: 520px; margin: 80px auto; text-align: center; padding: 34px 28px; border: 1px solid var(--hair); border-radius: 18px; background: var(--card) }
.ad-gate h2 { font-family: var(--fd); font-weight: 600; font-size: 24px; margin: 0 0 8px } .ad-gate p { color: var(--ink2); margin: 0 0 16px }
.ad-msg { font-size: 13px; color: var(--ink2) }
</style>

<!-- Unscoped: the DatePicker popup is teleported to <body>, out of reach of the
     scoped rules above. The app's global `table{min-width:920px}` and
     `th,td{padding:14px 16px}` (atlas.css, for the matrix tables) otherwise bleed
     into the calendar grid and blow it up to full-screen. Rein it back to its own size. -->
<style>
.p-datepicker-panel table { min-width: 0; width: auto; font-size: .82rem; border-collapse: collapse }
.p-datepicker-panel th, .p-datepicker-panel td { padding: 0; border: 0; vertical-align: middle }
</style>

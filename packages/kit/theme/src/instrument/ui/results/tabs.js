/*
 * The /app shell's tabs — the theme's registry. Each tab names the module it belongs to, so a module
 * switched off in platformkit.config.js takes its tab with it. The kit's modules bring three: the
 * reader's accomplishments, the sessions' coaching page and the coaching chat. A site adds its own
 * through the config (`app.tabs`, a module reached as #site/app, exporting `tabs` — each
 * { key, module?, component, start?, on?, first? } — and, when the sheet's results are gated behind a
 * confirmed address, `answered()`): a site's readings might be five such tabs. A tab's words come from
 * its labels record (content/app/results.md `## labels`, tab and card) unless it carries its own.
 *
 *   key      the page's slug under /app and its labels record
 *   module   instrument | reader | sessions | coaching | … (a module switch in the config)
 *   component  the page
 *   start    for a page that can start a round: the round kind for what the page emits
 *   on       () => whether the tab shows now (a reading with nothing to read, say); default the labels record
 *   first    true: the tab sits before the kit's (a site's readings lead)
 */
import { defineAsyncComponent } from 'vue'
import site, { modules } from '#site'
import { isProvider } from 'platformkit/lib/auth.js'
import { tabs as SITE_TABS } from '#site/app'
import { ug } from '../strings.js'
import CoachingPage from './CoachingPage.vue'
import TrophiesPage from './TrophiesPage.vue'
const ChatPage = defineAsyncComponent(() => import('./ChatPage.vue'))

export const KIT_TABS = [
  { key: 'trophies', module: 'reader', component: TrophiesPage },
  /* COACHING LIVES IN ONE PLACE (coaching.where; openspec: coaching-in-one-place). Where it is the
     community, a member's conversation and sessions are their coaching place there, and a tab here
     onto either would be a second door onto one thing. Somebody who gives sessions keeps Coaching here
     as well as having the place there: their hours, offerings and earnings live on it. */
  { key: 'coaching', module: 'sessions', on: () => (site.coaching || {}).where !== 'spaces' || isProvider.value, component: CoachingPage },
  { key: 'chat', module: 'coaching', on: () => (site.coaching || {}).where !== 'spaces', component: ChatPage },
]
/* the kit tabs' words and switches: `## tabs / ### <key>` in the sheet strings (label, card, published) */
const W = ug('sheet', 'tabs')
const rec = (k) => W[k] || {}
const published = (t) => !/^(false|no|off|0)$/i.test(String(rec(t.key).published ?? '').trim())
/* a tab is drawn when its module is on, its own switch says so, and the words have not turned it
   off. the on hook used to REPLACE the published check rather than stand beside it, so a tab with a
   condition of its own could not be unpublished in the strings. */
const on = (t) => (!t.module || modules[t.module] !== false) && (!t.on || t.on()) && published(t)
const word = (t) => ({ label: rec(t.key).label || t.key, card: rec(t.key).card || rec(t.key).label || t.key, ...t })

/* the tabs to show now: the site's that lead, the kit's, the site's that follow */
export function resolveTabs() {
  const site = SITE_TABS.filter(on), kit = KIT_TABS.filter(on)
  return [...site.filter((t) => t.first), ...kit, ...site.filter((t) => !t.first)].map(word)
}

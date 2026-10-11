/*
 * WHO THE COMMUNITY LINK IS FOR.
 *
 * The header used to offer the way into the community to somebody already in a room and to nobody
 * else, on the rule that a button going nowhere is worse than no button. That read it backwards: a
 * site WITH a community was hiding it from everyone who had not joined one, so the only people who
 * could find the way in were the people who had already found it.
 *
 * Two defaults changed, and both are decided by whether there is a room a visitor could walk into
 * — which `spacesOf` cannot see, so it stops inventing them and the layout decides:
 *   - the link is shown to everyone (`link: 'always'`), unless a site says `members`;
 *   - it is a WORD among the links while it is a way in, and the icon (a member's affordance, with
 *     the badge) once it is only offered to people already inside.
 *
 * This pins the config half and the rule the layout applies, so neither default can drift back by
 * somebody normalising an unset key again — which is exactly how the first one was lost.
 */
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { spacesOf } from './site.mjs'
import { navLinks, navSource, seen } from '../src/lib/nav.js'

let pass = 0
const eq = (what, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a !== b) { console.error(`  ✖ ${what}\n      got  ${a}\n      want ${b}`); process.exitCode = 1 } else pass++
}

/* an unset key stays unset: the default is not this file's to decide */
eq('no spaces key', spacesOf({}), { nav: undefined, link: 'always' })
eq('empty spaces block', spacesOf({ spaces: {} }), { nav: undefined, link: 'always' })
/* what a site actually said is carried, both ways round */
eq('nav: word', spacesOf({ spaces: { nav: 'word' } }), { nav: 'word', link: 'always' })
eq('nav: icon', spacesOf({ spaces: { nav: 'icon' } }), { nav: 'icon', link: 'always' })
eq('nav: nonsense', spacesOf({ spaces: { nav: 'sideways' } }), { nav: undefined, link: 'always' })
/* keeping the link to members is the opt-in, never the default */
eq('link: members', spacesOf({ spaces: { link: 'members' } }), { nav: undefined, link: 'members' })
eq('link: always', spacesOf({ spaces: { link: 'always' } }), { nav: undefined, link: 'always' })
eq('link: nonsense', spacesOf({ spaces: { link: 'sometimes' } }), { nav: undefined, link: 'always' })
eq('both', spacesOf({ spaces: { nav: 'icon', link: 'members' } }), { nav: 'icon', link: 'members' })

/* the rule SiteLayout applies over that, kept here beside the config it reads */
const shows = (cfg, rooms, signedIn, inRoom) => {
  const s = spacesOf(cfg)
  const open = rooms.some((r) => r.discoverable !== false)
  return (s.link === 'always' && open) || (signedIn && inRoom)
}
const word = (cfg, rooms) => {
  const s = spacesOf(cfg)
  if (s.nav) return s.nav === 'word'
  return s.link === 'always' && rooms.some((r) => r.discoverable !== false)
}
const OPEN = [{ discoverable: true }]
const PRIVATE = [{ discoverable: false }]

eq('a visitor sees an open community', shows({}, OPEN, false, false), true)
eq('a visitor sees no private room', shows({}, PRIVATE, false, false), false)
eq('a member of a private room still sees it', shows({}, PRIVATE, true, true), true)
eq('members-only hides it from a visitor', shows({ spaces: { link: 'members' } }, OPEN, false, false), false)
eq('members-only still shows it to a member', shows({ spaces: { link: 'members' } }, OPEN, true, true), true)
eq('no rooms at all, nobody sees it', shows({}, [], false, false), false)

eq('a way in is a word', word({}, OPEN), true)
eq('a private room keeps the icon', word({}, PRIVATE), false)
eq('a site that asked for the icon gets it', word({ spaces: { nav: 'icon' } }, OPEN), false)
eq('a site that asked for the word gets it', word({ spaces: { nav: 'word' } }, PRIVATE), true)


/* ─────────────────────────────────────────────────────────────────────────────
 * THE HEADER'S LINKS: three layers, most specific whole, and who sees each one.
 *
 * The layers are the theme's own by rule, the site's config, and a nav in content/site.md that an
 * administrator edits. Merging was considered and rejected — a merged list has no answer to "remove
 * the third item", which is the thing that prompted the change.
 */
const THEME = [{ key: 'content', href: '/content', prefix: true }, { key: 'store', href: '/store' }]
const CONFIG = [{ key: 'content', href: '/content' }, { key: 'pricing', href: '/pricing' }]
const CONTENT = [{ label: 'The books', href: '/content' }, { label: 'Members', href: '/app', see: 'paid' }]
const hrefs = (l) => l.map((x) => x.href).join(' ')

eq('no layer but the theme', hrefs(navLinks({ theme: THEME })), '/content /store')
eq('the config beats the theme', hrefs(navLinks({ config: CONFIG, theme: THEME })), '/content /pricing')
eq('content beats both', hrefs(navLinks({ content: CONTENT, config: CONFIG, theme: THEME })), '/content /app')
eq('an empty content nav is not a choice', hrefs(navLinks({ content: [], config: CONFIG, theme: THEME })), '/content /pricing')
eq('nothing merges', navLinks({ content: CONTENT, config: CONFIG, theme: THEME }).length, 2)

/* an item with nowhere to go, or nothing to say, is not one */
eq('no href', navLinks({ content: [{ label: 'Nowhere' }] , theme: THEME }).length, 0)
eq('no words', navLinks({ content: [{ href: '/x' }], theme: THEME }).length, 0)

/* a module that is off takes its links with it, whichever layer wrote them */
const noStore = (href) => !String(href).startsWith('/store')
eq('the theme loses its store link', hrefs(navLinks({ theme: THEME, answers: noStore })), '/content')
eq('a site loses one too', hrefs(navLinks({ content: [{ label: 'Shop', href: '/store' }, { label: 'Read', href: '/content' }], answers: noStore })), '/content')

/* at most one call to action, the first that says so */
const two = [{ label: 'A', href: '/a', cta: true }, { label: 'B', href: '/b', cta: true }]
eq('one call to action', navLinks({ content: two }).map((l) => l.cta).join(','), 'true,false')

/* which layer it came from, for an editor that would rather show what is there than an empty box */
eq('source: theme', navSource({}), 'theme')
eq('source: config', navSource({ config: CONFIG }), 'config')
eq('source: content', navSource({ content: CONTENT, config: CONFIG }), 'content')

/* WHO SEES IT — the ladder is a minimum and monotonic, guest is the one exact state */
const item = (see) => ({ label: 'x', href: '/x', see })
const who = (see, cls, extra) => seen(item(see), { cls, ...(extra || {}) })

eq('no audience: everyone', who(undefined, 'guest'), true)
eq('paid hides from a guest', who('paid', 'guest'), false)
eq('paid hides from a signed-in reader', who('paid', 'authenticated'), false)
eq('paid shows to a buyer', who('paid', 'paid'), true)
eq('paid also shows to a subscriber', who('paid', 'subscribed'), true)
eq('subscribed hides from a buyer', who('subscribed', 'paid'), false)
eq('authenticated hides from a guest', who('authenticated', 'guest'), false)
eq('authenticated shows to a subscriber', who('authenticated', 'subscribed'), true)
/* guest is exact: a minimum would leave a Sign in item on the page for everybody */
eq('guest shows to a guest', who('guest', 'guest'), true)
eq('guest hides once signed in', who('guest', 'authenticated'), false)
eq('guest hides from a subscriber', who('guest', 'subscribed'), false)
/* the staff */
eq('staff hides from a member', who('staff', 'subscribed', { staff: false }), false)
eq('staff shows to staff', who('staff', 'guest', { staff: true }), true)
/* a tier, and a higher rank clearing a lower bar */
const rank = (t) => ({ member: 1, patron: 2 }[t] || 0)
eq('a tier shows to its own', who('tier:member', 'subscribed', { tiers: ['member'], rank }), true)
eq('a tier shows to a higher rank', who('tier:member', 'subscribed', { tiers: ['patron'], rank }), true)
eq('a tier hides from a lower rank', who('tier:patron', 'subscribed', { tiers: ['member'], rank }), false)
eq('a tier hides from nobody in one', who('tier:member', 'subscribed', { tiers: [], rank }), false)
/* nonsense is nothing, never a lock */
eq('an unknown audience is everyone', who('sideways', 'guest'), true)
eq('an empty tier is nothing', who('tier:', 'guest'), true)


/* ---- THE EDITOR'S TWO LISTS ----
 * The Header panel never asks anybody to type a path or a rung, which means both lists are the
 * server's and both must be right: a path a module does not answer would 404 the moment the
 * module was switched off, and a tier written by hand would be a rung nobody can spell. These
 * read the real lists from the real site.
 */
{
  const { registry, optionList } = await import('./models/index.mjs')
  const models = await registry(process.cwd())
  const records = (dir) => {
    const root = path.join(process.cwd(), dir)
    if (!fs.existsSync(root)) return []
    return fs.readdirSync(root).filter((file) => file.endsWith('.md'))
      .map((file) => matter(fs.readFileSync(path.join(root, file), 'utf8')).data)
  }

  const links = await optionList(models, 'nav-links', process.cwd())
  eq('the link list is not empty', links.length > 0, true)
  eq('every link has a value, a label and a group', links.every((o) => o.value && o.label && o.group), true)
  eq('home is offered', links.some((o) => o.value === '/'), true)
  /* the sections, never every entry — a select holding every article is not a select */
  eq('no entry page is offered', links.every((o) => !/^\/content\/(articles|books|wiki|docs)\/.+/.test(o.value)), true)
  eq('a path is offered once', new Set(links.map((o) => o.value)).size === links.length, true)
  /* the site's own pages come through, so a header may point at one; an empty docs fixture has none */
  const pageRoutes = records('content/pages').filter((page) => page.route).map((page) => page.route)
  const offeredPageRoutes = links.filter((o) => o.group === 'Your pages').map((o) => o.value)
  eq('the site\'s declared pages are offered', pageRoutes.every((route) => links.some((o) => o.value === route)), true)
  eq('no undeclared site page is offered', offeredPageRoutes.every((route) => pageRoutes.includes(route)), true)

  const sees = await optionList(models, 'nav-see', process.cwd())
  eq('everyone is first, and is the empty value', sees[0] && sees[0].value === '' && !!sees[0].label, true)
  /* every rung of the one ladder, said in words rather than in its slug */
  for (const rung of ['guest', 'authenticated', 'paid', 'subscribed', 'staff']) {
    eq('the ladder offers ' + rung, sees.some((o) => o.value === rung), true)
  }
  eq('no label is a bare slug', sees.every((o) => o.label !== o.value), true)
  /* a tier is offered by its real name, so nobody has to know it is written tier:<slug> */
  const tierNames = new Set(records('content/store/products').map((product) => product.tier).filter(Boolean))
  const tiers = sees.filter((o) => String(o.value).startsWith('tier:'))
  eq('this site\'s tiers are offered by name', tiers.length === tierNames.size && tiers.every((o) => tierNames.has(String(o.value).slice(5)) && !o.label.includes('tier:')), true)
}

console.log(process.exitCode ? `✖ site-nav: ${pass} passed, some failed` : `✔ site-nav: ${pass} checks`)

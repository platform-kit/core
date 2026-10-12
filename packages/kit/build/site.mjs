/* The site as the kit reads it: platformkit.config.js in the site's root (cwd), with defaults filled.
   No Vite here — the build scripts, the Node-side #site modules and the Vite plugin all read this. */
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { DEPLOYMENT_DEFAULTS, modeOf } from './modes.mjs'
import { MODULES } from './modules/kit.mjs'
import { readManifests } from './modules/manifest.mjs'
import { inferenceOf } from './inference-config.mjs'

/*
 * THE RESOLVED MODULE SET. The manifests are the kit's own for now; a site's own module joins them
 * here (see the change's task 4.1) and nothing downstream changes when it does — which is the whole
 * point of resolving them in ONE place rather than each caller doing the dance itself.
 *
 * `keys` is what makes a typo catchable. `modules.stor !== false` reads `undefined !== false` and
 * switches a module ON, silently, which is the quietest way a switch can lie. A reader that knows
 * the declared set can refuse a name nobody declares, and that is why the keys travel to the
 * browser beside the config.
 */
export function resolveModules(root = process.cwd()) {
  const { modules, faults } = readManifests(MODULES.map((m) => ({ manifest: m, where: 'the kit' })))
  if (faults.length) throw new Error('the module manifests are malformed:\n  ' + faults.join('\n  '))
  return modules
}

export async function loadSite(root = process.cwd()) {
  /* the query defeats the module cache, so a restart reads the file as it is now */
  const mod = await import(/* @vite-ignore */ pathToFileURL(path.join(root, 'platformkit.config.js')).href + '?t=' + Date.now())
  const c = mod.default || mod
  const manifests = resolveModules(root)
  return { root, ...c, manifests, moduleKeys: [...manifests.keys()], looks: c.looks || {}, modules: c.modules || {}, deployment: deploymentOf(c), defaultLook: c.defaultLook || Object.keys(c.looks || {})[0] || 'classic', languages: c.languages || ['en'] }
}

/*
 * WHICH OF THE THREE SHAPES THIS SITE IS (build/modes.mjs says what each shape carries).
 *
 * Three fields, not one `mode` word, because two of them have an owner other than this file:
 * `content` is overridden per run (CONTENT_STORE=cloud npm run dev is how cloud mode is tested at
 * all) and `repo` must be settable by an administrator at runtime — the config is code, changing it
 * needs a deploy, and a cloud-only deployment is defined by never deploying again, so its operator
 * has no checkout to edit. Every field defaults to what a site already did, so a site that says
 * nothing is the site it was.
 */
/*
 * WHAT THE STORE IS REGISTERED WITH. `store.suppliers` and `store.kinds` in
 * platformkit.config.js, each a module path the site owns. A shop that adds neither says
 * nothing and gets the kit’s — which is every shop until one needs a bindery.
 */
export const storeOf = (c) => ({ suppliers: ((c.store || {}).suppliers) || null, kinds: ((c.store || {}).kinds) || null })

export const deploymentOf = (c) => ({ ...DEPLOYMENT_DEFAULTS, ...(c.deployment || {}) })

export const usageOf = (c) => {
  const autoTopUp = c.usage?.autoTopUp
  if (autoTopUp != null && (!autoTopUp || typeof autoTopUp !== 'object' || Array.isArray(autoTopUp))) {
    throw new Error('usage.autoTopUp must be a group of fields')
  }
  const packKeys = autoTopUp?.packKeys == null ? [] : autoTopUp.packKeys
  if (!Array.isArray(packKeys) || packKeys.some((key) => typeof key !== 'string' || !/^[0-9a-f]{8}$/.test(key))) {
    throw new Error('usage.autoTopUp.packKeys must be stable eight-character offer keys')
  }
  if (new Set(packKeys).size !== packKeys.length) throw new Error('usage.autoTopUp.packKeys cannot repeat an offer key')
  const operationsSource = c.usage?.operations ?? {}
  if (!operationsSource || typeof operationsSource !== 'object' || Array.isArray(operationsSource)) {
    throw new Error('usage.operations must map stable operation IDs to billing policies')
  }
  const operations = {}
  for (const [id, policy] of Object.entries(operationsSource)) {
    if (!/^[a-z][a-z0-9_.:-]{0,95}$/.test(id)) throw new Error(`usage.operations key "${id}" must be a stable operation ID`)
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      throw new Error(`usage.operations.${id} must be a group of fields`)
    }
    if (policy.mode === 'site-funded') {
      if (policy.offerKey != null) throw new Error(`usage.operations.${id}: site-funded policy cannot name an offer`)
      if (policy.markup != null) throw new Error(`usage.operations.${id}: site-funded policy cannot set reader markup`)
    } else if (policy.mode === 'offer') {
      if (typeof policy.offerKey !== 'string' || !/^[0-9a-f]{8}$/.test(policy.offerKey)) {
        throw new Error(`usage.operations.${id}.offerKey must be a stable eight-character offer key`)
      }
    } else {
      throw new Error(`usage.operations.${id}.mode must be site-funded or offer`)
    }
    const normalized = { mode: policy.mode, ...(policy.offerKey ? { offerKey: policy.offerKey } : {}) }
    if (policy.markup != null) {
      const markup = Number(policy.markup)
      if (!Number.isFinite(markup) || markup <= 0 || Math.round(markup * 1_000_000) < 1 ||
          !Number.isSafeInteger(Math.round(markup * 1_000_000))) {
        throw new Error(`usage.operations.${id}.markup must be a positive multiplier`)
      }
      normalized.markup_micros = Math.round(markup * 1_000_000)
    }
    operations[id] = normalized
  }
  return {
    autoTopUp: { enabled: autoTopUp?.enabled === true, packKeys: [...packKeys] },
    ...(Object.keys(operations).length ? { operations } : {}),
  }
}

export { inferenceOf }

/*
 * THE ONE PLACE THE SHAPE IS ANSWERED. Nothing else may read CONTENT_STORE, cloud.json or a key to
 * decide it for itself: a shape worked out in five places is a shape that disagrees with itself in
 * four of them, which is the whole reason build/modes.mjs exists.
 *
 * The declaration is the truth and the environment fills in what it is allowed to: CONTENT_STORE
 * chooses the store for this run, and `repo` may be answered by the administrator's settings, which
 * a caller with a database passes in. A stray backend key beside `backend: false` is a mistake and
 * not an override — the checks refuse it rather than quietly deploying a shape nobody asked for.
 */
export function deploymentShape(site, env = process.env, settings = null) {
  const d = site && site.deployment ? site.deployment : DEPLOYMENT_DEFAULTS
  const content = env.CONTENT_STORE === 'cloud' ? 'rows' : env.CONTENT_STORE ? 'files' : d.content
  /* an administrator may take the repository out of the cycle, or put it back, with no checkout */
  const repo = settings && typeof settings.repo === 'boolean' ? settings.repo : d.repo
  const backend = d.backend !== false
  if (!backend && content === 'rows') {
    throw new Error('A static deployment cannot use row-backed content. Set deployment.backend: true to deploy Supabase.')
  }
  return { backend, content, repo: backend ? repo : false, mode: modeOf({ backend, repo }) }
}

export const contentStoreMode = (shape) => shape.content === 'rows' ? 'cloud' : 'git'

export function assertAdminCmsShape(site, shape) {
  if (site?.admin?.models && shape.backend && shape.content !== 'rows') {
    throw new Error('This site registers admin models, but this deployment resolves content to files. Use deployment.content: "rows" or CONTENT_STORE=cloud.')
  }
}

/* the contracts a site's modules fill (platformkit.config.js instrument.module, recommendations.module): each name with its default as source */
export const INSTRUMENT = { Instrument: 'null', TYPEN: '{}', DOMAINS: '[]', LEVELS: '{}', CHS: '[]', LV: '[]', LVN: '{}', ARCH: '{}', STATEMENTS: '[]', cellName: "(a, l) => a + ' · ' + l" }
/*
 * `invites` is whether the site can EARN recommendations for somebody who has none — a diagnostic
 * to take, a survey, anything that would fill the lane other than waiting for them to read more.
 *
 * It decides whether Recommended For You is offered while it is empty. The kit's answer is no: an
 * empty lane behind a control promising one reads as broken rather than as not earned yet. A site
 * that can earn them says so, and then the empty view is not empty — it carries the invitation.
 */
/*
 * `signals` is WHAT A SITE KNOWS ABOUT THIS READER, and never a finished list. It answers
 * `{ has, text, themeTags, prescribed }` — words to rank against, tags that matter to them, and
 * hrefs to put at the top — and the kit merges it with what the reader's own history says
 * (lib/interests.js, over my_interests) before ranking anything.
 *
 * It replaced `recommendedBooks`, which handed back a finished lane, and a finished lane is what
 * makes composition impossible: two of them cannot be merged without one winning, so a site that
 * registered one silently took the whole view and the kit's own half of it — everything the reader
 * had read and bought — counted for nothing. `readerProfile` went the same way: it existed only
 * because the ranking needed a sentence about the reader and the kit had none to write. It writes
 * its own now (lib/rank.js, profileText), out of the reader's own tags.
 */
export const RECOMMENDATIONS = { signals: '() => null', readerSignals: '() => null', topicByKey: '() => null', invites: '() => false' }
/* the panels a site puts on the private half of a member's card. The kit cannot know what a business
   means by what somebody has read or scored, so it draws what the site registered and nothing else;
   a site that registers none has a card with a public half and no more. */
export const MEMBER = { panels: '[]' }
/* optional staff Desk sources registered by the site */
export const DESK = { sources: '[]' }
/*
 * THE SITE'S OWN PERMISSION RULES, run after the kit's. One export, `rules(identity, { can, cannot })`,
 * over @casl/ability's builder — so a site adds a rule, narrows one, or revokes one without editing
 * the kit. A site that registers none gets the kit's rules and nothing else, which is every site
 * today. The default is a function that adds nothing, so the ability is built the same way either
 * way and no caller asks whether there is one.
 */
export const PERMISSIONS = { rules: '() => {}' }
export const deskSourcesOf = (c) => ({ sources: ((c.spaces || {}).deskSources) || null })
/* THE SOCIAL NETWORK'S DECLARATION (platformkit.config.js `network`): whether the site federates —
   offers its members a public, portable identity on the wider atproto network — and where it reads
   the world outside from and asks to be crawled by. Off unless said: a site is a private network
   until it decides otherwise. */
/* HOW THE COMMUNITY IS LAID OUT — the owner's choice, never the features': `chat` (the default) is the
   spaces area as it always was, the network's Feed and Notifications in its column where both are on;
   `social` is the social-network layout, every community feature in its middle column. Which features
   exist stays the modules'; what anybody may read or do is the same in both. */
/* forYou: Explore as a For You grid of photo and video posts — off unless the site turns it on.
   hide: what this site does not use, taken out of view only (nothing stored or allowed changes):
   following, saved, drafts, tickets. Nothing by default; a name it does not know refuses the build. */
const COMMUNITY_HIDE = ['following', 'saved', 'drafts', 'tickets']
export const communityOf = (c) => {
  const m = c.community || {}
  const hide = Array.isArray(m.hide) ? m.hide.map(String) : []
  const odd = hide.filter((h) => !COMMUNITY_HIDE.includes(h))
  if (odd.length) throw new Error(`community.hide: ${odd.map((h) => '"' + h + '"').join(', ')} is not something a site can hide — the choices are ${COMMUNITY_HIDE.join(', ')}`)
  return { layout: m.layout === 'social' ? 'social' : 'chat', forYou: m.forYou === true, hide: [...new Set(hide)], places: placesOf(m.places), path: pathOf(m.path),
    /* members choose which spaces reach their Home (Pin to Home) — off: every space they are in does */
    pinning: m.pinning === true,
    /* the places that carry an entry rule (community.access, places[].access): their keys alone — the
       rules themselves are compiled into the database (network-access.mjs), which alone answers whether
       THIS reader enters */
    gated: gatedOf(m) }
}
const GATED_PLACES = ['events', 'messages', 'notifications']
function gatedOf(m) {
  const a = m.access && typeof m.access === 'object' && !Array.isArray(m.access) ? m.access : {}
  const odd = Object.keys(a).filter((k) => !GATED_PLACES.includes(k))
  if (odd.length) throw new Error(`community.access: ${odd.map((k) => '"' + k + '"').join(', ')} is not a place a rule can be set on — the choices are ${GATED_PLACES.join(', ')} (Home is network.access; a registered place carries its own access)`)
  return [...Object.keys(a).filter((k) => a[k] != null), ...(Array.isArray(m.places) ? m.places.filter((p) => p && p.access != null).map((p) => String(p.key)) : [])]
}
/*
 * A PLACE IN THE COMMUNITY, by registration (openspec: community-places-by-registration): a row of the
 * social navigation's first section after the kit's own, its page at /feed/<key> (and under it), and the
 * old addresses it takes over. { key, word, icon, component, wide?, shows?, claims? }:
 *   word     a key of ## rail in the spaces strings (a site adds it in its own spaces.md)
 *   shows    'signed-in' (the default) or 'everyone'
 *   claims   addresses that forward to it, with what follows them; '!/x' keeps one out
 * A key the community already uses, or an address two places claim, is refused here.
 */
/* THE COMMUNITY'S BASE ADDRESS (community.path): /feed unless the site names its own — one segment,
   and not one the site already answers on */
const TAKEN_PATHS = ['/app', '/content', '/admin', '/store', '/spaces', '/a', '/c', '/form', '/to', '/book', '/cart', '/support', '/embed', '/api', '/docs', '/account', '/v1']
export function pathOf(v) {
  if (v == null || v === '') return '/feed'
  const p = String(v)
  if (!/^\/[a-z][a-z0-9-]*$/.test(p)) throw new Error(`community.path: "${p}" is one segment from the root, like /community`)
  if (TAKEN_PATHS.includes(p)) throw new Error(`community.path: "${p}" is an address the site already answers on`)
  return p
}
export const COMMUNITY_RESERVED = ['net', 'net-explore', 'net-notes', 'index', 'events', 'coaching', 'dms', 'messages', 'mentions', 'threads',
  'saved', 'drafts', 'my-tickets', 'unreads', 'discover', 'people', 'keeping', 'channel', 'post', 'explore', 'notifications',
  'support', 'tickets', 'clients', 'comments', 'social-comments', 'social-dms', 'social-messages', 'work']
/* the kit's own claims, so a site's cannot take them (Coaching's, where coaching lives in the community) */
const KIT_CLAIMS = ['/app/coaching']
export function placesOf(list) {
  if (list == null) return []
  if (!Array.isArray(list)) throw new Error('community.places: a list of places — { key, word, icon, component }')
  const seen = new Set(), claimed = new Map(KIT_CLAIMS.map((c) => [c, 'coaching']))
  return list.map((x, i) => {
    const at = `community.places[${i}]`
    if (!x || typeof x !== 'object') throw new Error(`${at}: a place is { key, word, icon, component }`)
    const key = String(x.key || '')
    if (!/^[a-z][a-z0-9-]*$/.test(key)) throw new Error(`${at}: key "${key}" is a lower-case slug`)
    if (COMMUNITY_RESERVED.includes(key)) throw new Error(`${at}: "${key}" is a place the community already has`)
    if (seen.has(key)) throw new Error(`${at}: "${key}" is registered twice`)
    seen.add(key)
    if (!x.component || typeof x.component !== 'string') throw new Error(`${at}: component is the path of the place's page (./src/….vue)`)
    const claims = (x.claims || []).map(String)
    for (const c of claims) {
      const bare = c.replace(/^!/, '')
      if (!bare.startsWith('/')) throw new Error(`${at}: a claim is an address, "${c}" is not`)
      if (c.startsWith('!')) continue
      if (claimed.has(bare)) throw new Error(`${at}: "${bare}" is claimed by "${claimed.get(bare)}" already`)
      claimed.set(bare, key)
    }
    return { key, word: String(x.word || key), icon: String(x.icon || 'star'), component: x.component, wide: x.wide === true,
      shows: x.shows === 'everyone' ? 'everyone' : 'signed-in', claims }
  })
}
export const networkOf = (c) => {
  const n = c.network || {}
  return {
    federate: n.federate === true,
    /* other apps — Bluesky's, any atproto client — signing in to read and post: off unless the site
       owner turns it on, so a community stays on its own website by default */
    apps: n.apps === true,
    /* who takes part, where the site sells it or limits it: which grants exist and the offer that
       sells them. Whether THIS reader is admitted is the database's answer (network_admitted), never this */
    access: n.access && typeof n.access === 'object' ? { read: !!n.access.read, write: !!n.access.write, join: n.access.join ? String(n.access.join) : null, plans: n.access.plans ? String(n.access.plans) : null } : null,
    appview: String(n.appview || 'https://api.bsky.app').replace(/\/+$/, ''),
    relay: String(n.relay || 'https://bsky.network').replace(/\/+$/, ''),
  }
}
/* what the browser may know: no paths */
export const publicSite = (c) => ({ name: c.name, theme: c.theme, modules: c.modules, deployment: deploymentOf(c), looks: Object.keys(c.looks), defaultLook: c.defaultLook, languages: c.languages, api: apiOf(c), spaces: spacesOf(c), coaching: coachingOf(c), network: networkOf(c), community: communityOf(c) })
/* how the community shows in the site's header. A site whose community is the point of it wants the
   word — "Community", "Forum", "The Guild" — and a site where it is one thing among many wants the
   icon back. The WORD itself is never here: it is nav.spaces in the strings, like every other visible
   string, so the config says only which of the two, and a site changes the word by changing the string.
   Either way the button carries one number — what is waiting (waitingOf), not three counts. */
/* WHERE A MEMBER TALKS TO A COACH. The same conversation, the same tables, the same policies — the
   only question is which surface a business puts it in, and running both is worse than either: two
   inboxes for one thread, two badges for one unread line, and a member who answers in the wrong one.
   'app' is the sheet's own Chat tab (the kit's default, and the only answer for a site with no
   community); 'spaces' moves it into the community surface beside everything else the person is
   already reading, and takes the tab, the header's chat button and the route with it. Nothing about
   WHO may write to a coach changes either way: that is the entitlement, and it is checked in RLS. */
/* THE FACE A PERSON HAS WHEN THEY HAVE NOT CHOSEN ONE. Two letters in a coloured square is what
   every product does before it has thought about it, and a directory of them reads as a spreadsheet.
   DiceBear draws a face from the person's own id — the same face every time, on every device, with
   nothing fetched from anybody's CDN — and the kit ships one collection: notionists-neutral, which
   is human without being cute and reads on cream and on navy alike. A site names another, or passes
   the collection's own options, and gets that instead. The licence metadata DiceBear writes into
   each SVG is the attribution its collections ask for, so it is never stripped. */
export const avatarsOf = (c) => ({
  /* patchwork, not a face: see lib/avatar.js. A site may name another, and answers for it. */
  style: String((c.avatars && c.avatars.style) || 'patchwork'),
  /* the framing and the grounds the kit draws them on: the styles frame themselves, so nothing is scaled, and the six pastels are DiceBear's own — a person
     gets the same one every time, which is what makes a wall of faces scannable from further away
     than a face is legible. A site passing its own options replaces these outright. */
  options: (c.avatars && c.avatars.options) || { backgroundColor: ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf', 'c7f0d8'] },
})
/* THE HEADER A SITE SHIPS AS CODE — the middle of three layers (the theme's own by rule, this,
   then content/site.md, which an administrator edits). Normalised into the one item shape
   lib/nav.js resolves, so the three layers are the same thing and only their source differs.
   `cta` was a record of its own beside `links` and stays readable as one: a site that wrote
   { links, cta } gets its call to action as the last item, marked. Nothing here decides a
   default: an unset nav stays unset, and the layout picks the layer — the lesson from spacesOf,
   which answered 'icon' for a site that had said nothing and hid a real default two layers up. */
export const navOf = (c) => {
  const n = c.nav || {}
  const links = Array.isArray(n.links) ? n.links.map((l) => ({
    key: l.key, label: l.label, href: l.href, icon: l.icon, prefix: !!l.prefix, see: l.see, cta: false,
  })) : null
  if (!n.cta) return links
  /* the call to action carries two of everything — where it goes signed out and in, and a label for
     each — which no other item needs; it is kept whole beside the links rather than flattened. */
  return links
}
/* the call to action, as a site wrote it: { href, hrefIn?, key, keyIn?, prefix? } or nothing */
export const ctaOf = (c) => ((c.nav && c.nav.cta) || null)
/* WHERE COACHING LIVES (openspec: coaching-in-one-place): the results sheet ('app', the default) or
   the community ('spaces') — the chat and the booking together, one switch. `chat` is its former name,
   from when it moved the chat alone, and is read as the same setting. */
export const coachingOf = (c) => {
  const m = c.coaching || {}
  return { where: (m.where || m.chat) === 'spaces' ? 'spaces' : 'app', requireAuthToBook: m.requireAuthToBook !== false }
}
export const pipeSiteConfigSource = (c) => `/* what the site's config says, for the pipe's copy in the function (the #site import) */
export const modules = ${JSON.stringify(c.modules || {})}
export const name = ${JSON.stringify(c.name || '')}
export const languages = ${JSON.stringify(c.languages || ['en'])}
export const theme = ${JSON.stringify(c.theme || '')}
export const api = ${JSON.stringify(c.api || {})}
export const network = ${JSON.stringify(c.network || {})}
export const coaching = ${JSON.stringify(coachingOf(c))}
export const usage = ${JSON.stringify(usageOf(c))}
export const inference = ${JSON.stringify(inferenceOf(c))}
`
/* WHAT THE SITE SAID, and nothing invented. This used to answer 'icon' for a site that had said
   nothing, which is a default decided in the wrong place: whether the word or the icon is right
   depends on WHO the link is for, and that depends on whether there is a room a visitor could
   walk into — which this file cannot see and the layout can. An unset key stays unset.
   The second half is the link itself: 'always' (the default — a site with a community shows the
   way into it) or 'members', which keeps it to somebody already in a room. It was the other way
   round until a site with a community was found to be hiding it from everyone who had not
   joined one, so the only people who could find the way in were the people already inside. */
export const spacesOf = (c) => ({
  nav: (c.spaces && (c.spaces.nav === 'word' || c.spaces.nav === 'icon')) ? c.spaces.nav : undefined,
  link: (c.spaces && c.spaces.link === 'members') ? 'members' : 'always',
})
/* the content API's public settings: the space id (the site's slug unless the config says) and whether Delivery is public */
export const apiOf = (c) => ({ space: String((c.api && c.api.space) || String(c.name || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')), public: !(c.api && c.api.public === false) })

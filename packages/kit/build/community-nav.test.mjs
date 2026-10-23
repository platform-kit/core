/* THE COMMUNITY'S NAVIGATION, AS ONE LIST (openspec: streamline-social-layout, community-layouts).
   For every kind of person and every configuration: the social layout's two sections, the Inbox as
   one row (Direct Messages and the queues) whose count is the sum, Explore only where For You is on, Saved, Drafts and a
   customer's tickets only while they hold something and only where the site has not hidden them,
   every place the chat layout offers reachable from the social layout, and the fold rule. Pure:
   no stack, no browser. */
import { socialPlaces, chatNavigation, chatPlaces, reachOf, HIDEABLE, QUEUES, showsFollowing, spaceOpen, roomsOf, frontOf, foldOf, coachingPlace, spaceItems, spaceTabbed, forwardOf, socialSpacesHome, lockedPlaces } from '../src/lib/community/places.js'
import { communityOf } from './site.mjs'
import { communityAccessOf, accessOf } from './network-access.mjs'

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const keys = (p) => p.first.flatMap((x) => (x.group ? x.rows.map((r) => r.key) : [x.key]))
/* the Inbox where somebody answers a queue; their Direct Messages, inside it or standing alone */
const inboxOf = (p) => p.first.find((x) => x.group) || null
const dmsOf = (p) => { const i = inboxOf(p); return i ? i.rows.find((r) => r.key === 'dms') : p.first.find((x) => x.key === 'dms') }
const slotOf = (p) => p.first.findIndex((x) => x.group || x.key === 'dms')

const PEOPLE = {
  guest: { signedIn: false },
  'guest with public sessions': { signedIn: false, coaching: true },
  member: { signedIn: true, counts: { dms: 2, notes: 3 } },
  'member with a coach and a ticket': { signedIn: true, coaching: true, counts: { dms: 1, coaching: 2, tickets: 1, saved: 3, drafts: 1 } },
  coach: { signedIn: true, work: [{ key: 'clients', count: 4 }], counts: {} },
  'support agent': { signedIn: true, work: [{ key: 'support', count: 2 }, { key: 'tickets', count: 3 }], counts: {} },
  admin: { signedIn: true, work: [{ key: 'support', count: 2 }, { key: 'tickets', count: 3 }, { key: 'clients', count: 1 }, { key: 'comments', count: 0 }, { key: 'social-comments', count: 5 }, { key: 'social-dms', count: 1 }], counts: { unreads: 4 } },
}
const CONFIGS = {
  'spaces and network': { network: true, events: true },
  'spaces and network, For You on': { network: true, events: true, forYou: true },
  'spaces alone': { network: false, events: true },
  'everything hidden': { network: true, events: true, hide: HIDEABLE },
}

for (const [cname, cfg] of Object.entries(CONFIGS)) {
  for (const [who, person] of Object.entries(PEOPLE)) {
    const ctx = { ...cfg, ...person }
    const p = socialPlaces(ctx)
    const at = `${who}, ${cname}`
    /* two sections: the first is the list; nothing else stands in it */
    ok(`${at}: no More, Profile or Post in the navigation`, !p.first.some((x) => ['more', 'profile', 'post', 'threads', 'unreads', 'discover'].includes(x.key)))
    ok(`${at}: Home first`, p.first[0].key === (cfg.network ? 'net' : 'index'))
    ok(`${at}: Explore only where For You is on`, p.first.some((x) => x.key === 'net-explore') === !!(cfg.forYou && cfg.network))
    ok(`${at}: Direct Messages and Notifications only for somebody signed in`, !!dmsOf(p) === !!person.signedIn && p.first.some((x) => x.word === 'notifications') === !!person.signedIn)
    /* the Inbox: one row, the sum, the queues in order then Direct Messages, for whoever answers one;
       somebody who answers none has Direct Messages alone, never a fold of one row */
    const queues = (person.work || [])
    const inbox = inboxOf(p)
    ok(`${at}: an Inbox only for whoever answers a queue`, !!inbox === (!!person.signedIn && queues.length > 0))
    if (inbox) {
      ok(`${at}: the Inbox's count is Direct Messages and the queues together`, inbox.count === queues.reduce((s, w) => s + w.count, 0) + ((person.counts || {}).dms || 0), String(inbox.count))
      ok(`${at}: the Inbox unfolds to a row per queue in order, then Direct Messages last`, inbox.rows.map((r) => r.key).join() === [...QUEUES.filter((k) => queues.some((w) => w.key === k)), 'dms'].join())
      ok(`${at}: Direct Messages is not also a row of its own`, !p.first.some((x) => x.key === 'dms'))
    }
    /* with no queue there is nothing to unfold: the Inbox is one row, and it opens Direct Messages */
    if (person.signedIn && !queues.length) {
      const row = p.first.find((x) => x.key === 'dms')
      ok(`${at}: with no queue, the Inbox is a plain row that opens Direct Messages`, !!row && !row.group && row.word === 'inbox' && row.icon === 'inbox')
    }
    /* Saved, Drafts, a customer's tickets: only while they hold something, never where hidden */
    const hidden = new Set(cfg.hide || [])
    for (const [key, word, count] of [['saved', 'saved', 'saved'], ['drafts', 'drafts', 'drafts'], ['my-tickets', 'tickets', 'tickets']]) {
      const has = (person.counts || {})[count] > 0
      ok(`${at}: ${key} shown exactly while it holds something and is not hidden`, p.first.some((x) => x.key === key) === (has && !!person.signedIn && !hidden.has(word)))
    }
    /* Direct Messages counts direct messages */
    const dms = dmsOf(p)
    if (dms) ok(`${at}: Direct Messages counts direct messages`, dms.count === ((person.counts || {}).dms || 0))
    const co = p.first.find((x) => x.key === 'coaching')
    const hasCoachingPlace = !!ctx.coaching || (ctx.signedIn && ((person.counts || {}).coaching || 0) > 0)
    ok(`${at}: Coaching is a place whenever public sessions or a coaching conversation are available`,
      !!co === hasCoachingPlace && (!co || co.count === ((person.counts || {}).coaching || 0)))
    if (co && dms) ok(`${at}: Coaching sits just before the Inbox`, p.first.indexOf(co) === slotOf(p) - 1)
    /* the order: Home (Explore), Events, Coaching, the Inbox (or Direct Messages), Notifications */
    const order = p.first.map((x) => (x.group ? 'dms' : x.key)).filter((k) => ['events', 'coaching', 'dms', 'net-notes', 'mentions'].includes(k))
    const want = ['events', 'coaching', 'dms', 'net-notes', 'mentions'].filter((k) => order.includes(k))
    ok(`${at}: Home, Events, Coaching, the Inbox, Notifications in that order`, order.join() === want.join(), order.join())
    /* every chat place is reachable here, or the site chose to hide it, or it is empty */
    const here = new Set(keys(p).concat(['spaces', 'browse-spaces']))
    const chat = chatNavigation(ctx)
    ok(`${at}: chat navigation matches the social destinations and Home behavior`,
      JSON.stringify(chat.first) === JSON.stringify(p.first))
    ok(`${at}: Home is one destination, and uses the network timeline when enabled`,
      chat.first[0].key === (cfg.network ? 'net' : 'index')
        && chat.first[0].word === 'home'
        && !(cfg.network && chat.first.some((place) => place.key === 'index' || place.word === 'feed')))
    for (const k of chatPlaces(ctx)) {
      const word = k === 'my-tickets' ? 'tickets' : k
      const empty = ['saved', 'drafts', 'my-tickets'].includes(k) && !((person.counts || {})[k === 'my-tickets' ? 'tickets' : k] > 0)
      const reach = here.has(k) || (reachOf(k, ctx) && here.has(reachOf(k, ctx))) || hidden.has(word) || empty
      ok(`${at}: the chat layout's ${k} has a home`, reach)
    }
    ok(`${at}: Coaching is reachable from chat for public sessions or an existing conversation`,
      chatPlaces(ctx).includes('coaching') === hasCoachingPlace)
  }
}

/* the order the Inbox's queues unfold in, as James set it (2026-10-08) */
ok('the Inbox queues unfold clients, comments, support chat, support tickets, social messages, social comments', QUEUES.join() === 'clients,comments,support,tickets,social-dms,social-comments', QUEUES.join())

/* following, hidden or not */
ok('nothing is hidden by default: following shows', showsFollowing(undefined) && showsFollowing([]))
ok('community.hide following takes it away', !showsFollowing(['following']))

/* the fold rule */
ok('the space being read is unfolded', spaceOpen('a', 'a', []))
ok('another space is folded', !spaceOpen('b', 'a', []))
ok('a space opened by hand stays unfolded', spaceOpen('b', 'a', ['b']))

/* what a space opens on, and what it unfolds to (openspec: remove-space-about-tab) */
const room = (id, space, mode = 'stream', extra = {}) => ({ id, space_id: space, mode, ...extra })
const CH = [
  room('dm1', 'one', 'stream', { kind: 'dm' }),
  room('f1', 'one', 'feed'),
  room('old', 'one', 'stream', { archived_at: '2026-10-08' }),
  room('g', 'many'), room('o', 'many'), room('f2', 'many', 'feed'),
  room('c', 'chat'),
  room('x', 'nofeed'), room('y', 'nofeed', 'forum'),
]
ok('a space of one feed opens on it', frontOf('one', CH)?.id === 'f1')
ok('a space of one feed unfolds to nothing', foldOf('one', CH).length === 0)
ok('a direct message and an archived room are not rooms', roomsOf('one', CH).map((c) => c.id).join() === 'f1')
ok('a space of one chat room opens on it and unfolds to nothing', frontOf('chat', CH)?.id === 'c' && !foldOf('chat', CH).length)
ok('a space with a feed and rooms opens on its feed', frontOf('many', CH)?.id === 'f2')
ok('and unfolds to them, feed first, the rest in order', foldOf('many', CH).map((c) => c.id).join() === 'f2,g,o')
ok('a space with no feed opens on its first room', frontOf('nofeed', CH)?.id === 'x' && foldOf('nofeed', CH).length === 2)
ok('a space with no room the reader sees opens on nothing (People)', frontOf('none', CH) === null && !foldOf('none', CH).length)

/* a space's places in the navigation, or its tabs (openspec: space-places-in-the-nav) */
const items = (id, o) => spaceItems(id, CH, o).map((x) => x.key).join()
ok('a space of several rooms unfolds to them, then People', items('many') === 'f2,g,o,people')
ok('with events, Events comes before People', items('many', { events: true }) === 'f2,g,o,events,people')
ok('a keeper has Moderation last', items('many', { events: true, keeps: true }) === 'f2,g,o,events,people,keeping')
ok('a space of several rooms has no tabs', !spaceTabbed('many', CH) && !spaceTabbed('nofeed', CH))
ok('a space of one room or one feed keeps its tabs, and unfolds to nothing', spaceTabbed('one', CH) && spaceTabbed('chat', CH) && items('one', { events: true }) === '')

/* a reader's coaching place (openspec: coaching-in-one-place) */
const cp = (x) => coachingPlace({ where: 'spaces', signedIn: true, chatOn: true, sessionsOn: true, ...x })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
ok('a member has Chat and Sessions', same(cp({ mayChat: true }), { chat: true, sessions: true }))
ok('a free reader has Sessions alone', same(cp({ mayChat: false }), { chat: false, sessions: true }))
ok('a paid session week or a line waiting opens Chat', same(cp({ mayChat: true }), { chat: true, sessions: true }))
ok('a coach who may chat has Chat and Sessions — giving sessions takes nothing away', same(cp({ coach: true, mayChat: true }), { chat: true, sessions: true }))
ok('a coach with nothing to chat about has Sessions', same(cp({ coach: true, mayChat: false }), { chat: false, sessions: true }))
ok('a coach with sessions off and nothing to chat about has no place', cp({ coach: true, mayChat: false, sessionsOn: false }) === null)
ok('signed out, the public Sessions place remains without Chat', same(cp({ signedIn: false }), { chat: false, sessions: true }))
ok('signed out with sessions off has no coaching place', cp({ signedIn: false, sessionsOn: false }) === null)
ok('with coaching on the sheet, there is no place', cp({ where: 'app', mayChat: true }) === null)
ok('with sessions off, a member has Chat alone', same(cp({ mayChat: true, sessionsOn: false }), { chat: true, sessions: false }))
ok('with sessions off and nothing to chat, there is no place', cp({ mayChat: false, sessionsOn: false }) === null)
ok('with the coaching module off, Sessions alone', same(cp({ mayChat: true, chatOn: false }), { chat: false, sessions: true }))

/* registered places and their claims (openspec: community-places-by-registration) */
const REG = [{ key: 'journal', icon: 'pencil', word: 'journal', shows: 'signed-in' }, { key: 'open', icon: 'star', word: 'open', shows: 'everyone' }]
const withReg = socialPlaces({ network: true, events: true, signedIn: true, places: REG, counts: { places: { journal: 3 } } })
const keysR = withReg.first.map((x) => x.key)
ok('registered places come after Messages and before Notifications, in the order given', keysR.indexOf('journal') === keysR.indexOf('dms') + 1 && keysR.indexOf('open') === keysR.indexOf('journal') + 1 && keysR.indexOf('net-notes') === keysR.indexOf('open') + 1, keysR.join())
ok('a registered place carries its count', withReg.first.find((x) => x.key === 'journal').count === 3)
ok('a guest sees only the places registered for everyone', socialPlaces({ network: true, signedIn: false, places: REG }).first.filter((x) => x.place).map((x) => x.key).join() === 'open')
const CL = [{ key: 'coaching', claims: ['/app/coaching'] }, { key: 'diagnostics', claims: ['/app', '!/app/call', '!/app/voice'] }]
ok('a claimed address forwards to its place', forwardOf('/app', CL) === '/feed/diagnostics')
ok('what follows the claim follows it', forwardOf('/app/quiz/teachings', CL) === '/feed/diagnostics/quiz/teachings' && forwardOf('/app/accomplishments/', CL) === '/feed/diagnostics/accomplishments')
ok('the longest claim wins', forwardOf('/app/coaching', CL) === '/feed/coaching')
ok('an address kept out stays where it is', forwardOf('/app/call/abc', CL) === null && forwardOf('/app/voice/x', CL) === null)
ok('an address nothing claims gives null', forwardOf('/store', CL) === null && forwardOf('/apple', CL) === null)
ok('the bare spaces home follows the configured social community path', socialSpacesHome('/spaces', 'social', '/spaces', '/community') === '/community')
ok('space detail URLs stay at /spaces/<slug>, and the chat layout keeps its spaces home',
  socialSpacesHome('/spaces/quiet-room', 'social', '/spaces', '/community') === '/spaces/quiet-room'
    && socialSpacesHome('/spaces', 'chat', '/spaces', '/community') === '/spaces')

/* WHO ENTERS EACH PLACE (openspec: community-access-by-entitlement) */
const LK = socialPlaces({ network: true, events: true, signedIn: true, places: REG, locked: ['home', 'events', 'messages', 'notifications', 'journal'], counts: { dms: 4, notes: 2, places: { journal: 3 } } })
const lk = (k) => LK.first.find((x) => x.key === k)
ok('a locked place keeps its row', ['net', 'events', 'dms', 'net-notes', 'journal'].every((k) => lk(k)))
ok('a locked place is marked, with nothing counted', ['net', 'events', 'dms', 'net-notes', 'journal'].every((k) => lk(k).locked && !lk(k).count))
ok('a place with no rule is not locked', !lk('open').locked)
ok('nothing is locked until the database has said so', lockedPlaces({}).length === 0 && lockedPlaces({ home: true, admitted: { events: true } }).length === 0)
ok('the database\'s refusals become the locked list', lockedPlaces({ home: false, admitted: { events: false, messages: true, notifications: false } }).join() === 'home,events,notifications')
ok('the gated places reach the browser by key alone', communityOf({ community: { access: { events: { tier: 'a' } }, places: [{ key: 'journal', component: './x.vue', access: { tier: 'a' } }] } }).gated.join() === 'events,journal')
let threw = ''
try { communityOf({ community: { access: { coaching: { tier: 'a' } } } }) } catch (e) { threw = e.message }
ok('a rule on a place that keeps no rows of its own refuses the build', /coaching/.test(threw), threw)
const CAT = { offers: [{ kind: 'membership', sku: 'm1', key: 'k1', tier: 't1' }, { kind: 'membership', sku: 'm2', key: 'k2', tier: 't2' }] }
const ca = communityAccessOf({ community: { access: { events: { tier: ['t1', 't2'] } } } }, process.cwd(), { catalog: CAT })
ok('a rule may name several tiers', !ca.faults.length && JSON.stringify(ca.rules.events) === JSON.stringify([{ tier: ['t1', 't2'] }]), JSON.stringify(ca))
const cb = communityAccessOf({ community: { access: { events: { tier: ['t1', 'nope'] } } } }, process.cwd(), { catalog: CAT })
ok('a tier no membership declares is named, alone', cb.faults.length === 1 && /"nope"/.test(cb.faults[0]), cb.faults.join())
ok('no rule writes no row', communityAccessOf({ community: {} }, process.cwd(), { catalog: CAT }).rules === null)
const na = accessOf({ network: { access: { read: { tier: 't1' }, plans: 'pricing' } } }, process.cwd(), { catalog: CAT })
ok('the plans page is an address on the site', na.faults.some((m) => /plans/.test(m)))

console.log(`community-nav: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

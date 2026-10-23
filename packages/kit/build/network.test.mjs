/* The network's arithmetic, src/lib/network/model.js — pure, so the pages and this file read the
   same rules: what an answer may be read by, how a page of the timeline joins the last, how a thread
   hangs together, how a post's words become text and links (never markup), and a like pressed
   before the database answers. Who may READ is the database's, proven by network-db.test.mjs. */
import { AUDIENCES, rankOf, answerAudiences, defaultAudience, itemKey, joinPages, cursorOf, threadOf, segmentsOf, agoOf, toggled, postOfMessage, peopleIn } from '../src/lib/network/model.js'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('\nNETWORK\n')

/* ---- the audience never widens */
ok('everyone is wider than here', rankOf('everyone') > rankOf('here') && rankOf('nonsense') === 0)
ok('a fresh post may go to either', eq(answerAudiences(null), AUDIENCES))
ok('an answer to an everyone post may go to either', eq(answerAudiences({ audience: 'everyone' }), ['everyone', 'here']))
ok('an answer to a post for the people here may only stay here', eq(answerAudiences({ audience: 'here' }), ['here']))
ok('a space\'s message is answered in the space, not on the network', eq(answerAudiences({ kind: 'space', audience: 'space' }), []))
ok('an answer starts on its parent\'s audience', defaultAudience({ audience: 'everyone' }) === 'everyone' && defaultAudience({ audience: 'here' }) === 'here')
ok('a fresh post starts where the site says', defaultAudience(null, 'here') === 'here' && defaultAudience(null, 'everyone') === 'everyone')

/* ---- pages of the timeline */
const t = (kind, id, at, by) => ({ kind, [kind === 'space' ? 'message_id' : 'post_id']: id, at, reposted_by: by || null })
const page1 = [t('post', 'a', '2026-10-07T10:00:00Z'), t('repost', 'b', '2026-10-07T09:00:00Z', 'u2'), t('space', 'm', '2026-10-07T08:00:00Z')]
ok('a post and its repost are two items', itemKey(t('post', 'b', 'x')) !== itemKey(t('repost', 'b', 'x', 'u2')))
const joined = joinPages(page1, [t('space', 'm', '2026-10-07T08:00:00Z'), t('post', 'c', '2026-10-07T07:00:00Z'), t('post', 'z', '2026-10-07T11:00:00Z')])
ok('a further page adds nothing twice', joined.length === 5)
ok('…and stays newest first', joined.every((x, i) => i === 0 || new Date(joined[i - 1].at) >= new Date(x.at)))
ok('the next page starts at the oldest shown', cursorOf(page1) === '2026-10-07T08:00:00Z' && cursorOf([]) === null)

/* ---- a thread */
const P = (id, parent, at) => ({ id, reply_parent_id: parent, created_at: at })
const root = P('r', null, '2026-10-07T00:00:00Z')
const replies = [P('b', 'r', '2026-10-07T02:00:00Z'), P('a', 'r', '2026-10-07T01:00:00Z'), P('a1', 'a', '2026-10-07T03:00:00Z'), P('lost', 'gone', '2026-10-07T04:00:00Z')]
const th = threadOf(root, replies)
ok('a thread opens on its root', th[0].post.id === 'r' && th[0].depth === 0)
ok('answers hang under what they answer, oldest first', eq(th.map((x) => x.post.id), ['r', 'a', 'a1', 'b', 'lost']), th.map((x) => x.post.id).join(','))
ok('…indented by depth', eq(th.map((x) => x.depth), [0, 1, 2, 1, 1]))
ok('an answer whose parent is out of reach hangs off the root', th.find((x) => x.post.id === 'lost').depth === 1)
const deep = [P('1', 'r', '1'), P('2', '1', '2'), P('3', '2', '3'), P('4', '3', '4'), P('5', '4', '5'), P('6', '5', '6')]
ok('indent stops at its depth and the run goes on flat', Math.max(...threadOf(root, deep, 3).map((x) => x.depth)) === 3)
ok('no root, no thread', eq(threadOf(null, replies), []))

/* ---- words: text and links, never markup */
const segs = segmentsOf('see https://example.com/a?b=1. and <b>bold</b> (http://x.org)')
ok('a link is cut out of the words', segs.some((s) => s.kind === 'link' && s.href === 'https://example.com/a?b=1'))
ok('…without the full stop that ends the sentence', !segs.some((s) => s.kind === 'link' && s.href.endsWith('.')))
ok('…or the bracket that closes it', segs.some((s) => s.kind === 'link' && s.href === 'http://x.org'))
ok('…and shown without its scheme', segs.find((s) => s.kind === 'link').text === 'example.com/a?b=1')
ok('markup stays words', segs.some((s) => s.kind === 'text' && s.text.includes('<b>bold</b>')))
ok('the words come back whole', segs.map((s) => s.kind === 'link' ? s.href : s.text).join('') === 'see https://example.com/a?b=1. and <b>bold</b> (http://x.org)')
ok('no words, nothing', eq(segmentsOf(''), []))
ok('a javascript: address is not a link', !segmentsOf('javascript:alert(1)').some((s) => s.kind === 'link'))

/* ---- time, in the browser's own words */
const now = Date.parse('2026-10-07T12:00:00Z')
ok('a moment ago is said by the browser', agoOf('2026-10-07T11:59:50Z', now, 'en').length > 0)
ok('minutes, hours and days are told apart', agoOf('2026-10-07T11:55:00Z', now, 'en') !== agoOf('2026-10-07T07:00:00Z', now, 'en') && agoOf('2026-10-05T12:00:00Z', now, 'en').length > 0)
ok('a date further back is a date', /Sep/.test(agoOf('2026-09-01T12:00:00Z', now, 'en')))
ok('nonsense is nothing', agoOf('not a date', now) === '')

/* ---- pressed before the database answers */
const post = { id: 'p', like_count: 2, repost_count: 0, liked: false }
ok('a like moves the count at once', toggled(post, 'like', true).like_count === 3 && toggled(post, 'like', true).liked === true)
ok('pressing what is already pressed changes nothing', toggled({ ...post, liked: true }, 'like', true).like_count === 2)
ok('a count never goes below nothing', toggled({ id: 'p', repost_count: 0, reposted: true }, 'repost', false).repost_count === 0)

/* ---- a space's message drawn as a post */
const m = postOfMessage({ id: 'm', author_id: 'u', body: 'hello', created_at: 'x', reply_count: 2, channel_slug: 'feed' }, { id: 's', slug: 'cohort', name: 'Cohort' })
ok('a space\'s message reads as a post of the space', m.kind === 'space' && m.audience === 'space' && m.space.name === 'Cohort' && m.text === 'hello')
ok('the people of a set of posts, once each', eq(peopleIn([{ author_id: 'a' }, { author_id: 'a' }, { author_id: 'b' }], ['c', null]).sort(), ['a', 'b', 'c']))

/* ---- OTHER APPS SIGNING IN: the site owner's choice, off unless the config says so */
{
  const { clientAllowed } = await import('../supabase/functions/_shared/atproto/ids.js')
  const { networkOf, communityOf, coachingOf, placesOf, pathOf } = await import('./site.mjs')
  ok('a config that says nothing lets no other app in', networkOf({}).apps === false && networkOf({ network: { apps: 'yes' } }).apps === false)
  ok('apps: true lets them in', networkOf({ network: { apps: true } }).apps === true)
  {
    const { spread } = await import('../src/lib/network/model.js')
    const rows = ['a', 'a', 'a', 'a', 'b', 'c', 'a', 'd'].map((author_id, i) => ({ id: String(i), author_id }))
    const out = spread(rows)
    const windows = out.map((_, i) => out.slice(i, i + 6))
    ok('For You never shows one person more than twice in six', windows.every((w) => ['a', 'b', 'c', 'd'].every((p) => w.filter((r) => r.author_id === p).length <= 2)) || out.slice(-2).every((r) => r.author_id === 'a'), out.map((r) => r.author_id).join(''))
    ok('…keeping every tile, the best first', out.length === rows.length && out[0].id === '0')
    const one = spread([1, 2, 3].map((i) => ({ id: String(i), author_id: 'z' })))
    ok('…and giving way only when everything left is one person\'s', one.map((r) => r.id).join() === '1,2,3')
  }
  ok('For You is off unless the config says true', communityOf({}).forYou === false && communityOf({ community: { forYou: 'yes' } }).forYou === false && communityOf({ community: { forYou: true } }).forYou === true)
  ok('nothing is hidden unless the config says so', communityOf({}).hide.length === 0 && communityOf({ community: { hide: ['following', 'saved'] } }).hide.join() === 'following,saved')
  let refused = ''; try { communityOf({ community: { hide: ['following', 'likes'] } }) } catch (e) { refused = e.message }
  ok('…and a name it does not know refuses the build, naming it', /"likes"/.test(refused))
  ok('members do not pin spaces to Home unless the site turns pinning on', communityOf({}).pinning === false && communityOf({ community: { pinning: true } }).pinning === true)
  /* the community's base address */
  const badPath = (v) => { try { pathOf(v); return false } catch (e) { return true } }
  ok('the community lives at /feed unless the site names its own', communityOf({}).path === '/feed' && communityOf({ community: { path: '/community' } }).path === '/community')
  ok('a path of more than one segment, or one the site already answers on, is refused', badPath('/a/b') && badPath('community') && badPath('/store') && badPath('/app'))
  /* a place in the community, by registration (openspec: community-places-by-registration) */
  const refuses = (list) => { try { placesOf(list); return false } catch (e) { return true } }
  const pl = placesOf([{ key: 'journal', word: 'journal', icon: 'pencil', component: './src/J.vue', claims: ['/app', '!/app/call'] }])
  ok('a registered place is read with its defaults', pl.length === 1 && pl[0].key === 'journal' && pl[0].shows === 'signed-in' && pl[0].wide === false && pl[0].claims.join() === '/app,!/app/call')
  ok('no places of a site\'s own unless the config registers some', communityOf({ modules: { courses: false } }).places.length === 0)
  ok('…the kit\'s Courses is the one place it brings, where courses are on', communityOf({}).places.map((p) => p.key).join() === 'courses')
  ok('a key the community already uses is refused', refuses([{ key: 'events', component: './x.vue' }]) && refuses([{ key: 'coaching', component: './x.vue' }]))
  ok('a place with no page is refused', refuses([{ key: 'journal' }]))
  ok('two places claiming one address are refused, and so is the kit’s own claim', refuses([{ key: 'a', component: './a.vue', claims: ['/x'] }, { key: 'b', component: './b.vue', claims: ['/x'] }]) && refuses([{ key: 'a', component: './a.vue', claims: ['/app/coaching'] }]))
  ok('coaching lives on the sheet unless the config says the community', coachingOf({}).where === 'app' && coachingOf({ coaching: { where: 'elsewhere' } }).where === 'app' && coachingOf({ coaching: { where: 'spaces' } }).where === 'spaces')
  ok('coaching.chat is read as its former name', coachingOf({ coaching: { chat: 'spaces' } }).where === 'spaces')
  ok('the layout is chat unless the config says social', communityOf({}).layout === 'chat' && communityOf({ community: { layout: 'nonsense' } }).layout === 'chat' && communityOf({ community: { layout: 'social' } }).layout === 'social')
  ok('grants reach the browser as which exist, never as rules', JSON.stringify(networkOf({ network: { access: { read: [{ tier: 'x' }], join: 'pass' } } }).access) === JSON.stringify({ read: true, write: false, join: 'pass', plans: null }))
  ok('…and the plans page with them, where the site names one', networkOf({ network: { access: { read: [{ tier: 'x' }], plans: '/pricing' } } }).access.plans === '/pricing')
  const off = { apps: false, federate: false }
  ok('with apps off, signing in is refused', !clientAllowed('com.atproto.server.createSession', off) && !clientAllowed('com.atproto.server.createAppPassword', off) && !clientAllowed('com.atproto.server.refreshSession', off))
  ok('…and so is every read an app would make, a space’s feed among them', ['app.bsky.feed.getTimeline', 'app.bsky.actor.getProfile', 'app.bsky.feed.getFeedSkeleton', 'app.bsky.feed.getFeedGenerators', 'com.atproto.repo.getRecord'].every((n) => !clientAllowed(n, off)))
  ok('…while the site may still describe itself', clientAllowed('com.atproto.server.describeServer', off))
  ok('a site that federates still answers relays with apps off', clientAllowed('com.atproto.sync.subscribeRepos', { apps: false, federate: true }) && clientAllowed('com.atproto.repo.getRecord', { apps: false, federate: true }) && !clientAllowed('com.atproto.server.createSession', { apps: false, federate: true }))
  ok('with apps on, everything is asked of the guards as before', clientAllowed('com.atproto.server.createSession', { apps: true }) && clientAllowed('app.bsky.feed.getTimeline', { apps: true }))
}

console.log(`network: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

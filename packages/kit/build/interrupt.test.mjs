/* What may interrupt a reader, and who has the corner. Two things in this kit put themselves over a
   page uninvited — an ad and the support chat — and they occupy the same one. These are the rules
   they both ask, so neither has to know about the other. */
import { mayInterrupt, newPageView, claimCorner, releaseCorner, cornerHolder, cornerFree, QUIET } from '../src/lib/interrupt.js'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }

console.log('\nINTERRUPT\n')

/* --- where nothing may appear --- */
for (const p of ['/admin', '/admin/support', '/app', '/app/chat', '/app/quiz/teachings', '/spaces', '/spaces/the-team/general',
  '/feed', '/feed/notifications', '/p/example',
  '/__preview', '/__share/default', '/api', '/form/a-form', '/to/a-form', '/book/one-to-one', '/cart/c/abc',
  '/checkout/hyperswitch', '/support']) {
  ok('nothing over ' + p, mayInterrupt(p) === false)
}
for (const p of ['/', '/content', '/content/articles/one', '/content/books/tao-te-ching', '/store', '/store/products/x', '/pricing']) {
  ok('something may appear on ' + p, mayInterrupt(p) === true)
}
ok('a path that is not a path is never interrupted', mayInterrupt('') === false && mayInterrupt(null) === false && mayInterrupt('nonsense') === false)
ok('a page merely beginning with a quiet word is not quiet', mayInterrupt('/applications') === true && mayInterrupt('/apps') === true)
ok('and /spaces-of-the-sea is a page like any other', mayInterrupt('/spaces-of-the-sea') === true)
ok('the quiet list is the one the module publishes', QUIET.includes('/admin') && QUIET.includes('/app') && QUIET.includes('/spaces') && QUIET.includes('/feed') && QUIET.includes('/p') && QUIET.includes('/checkout/'))
ok('the configured community prefix is quiet', mayInterrupt('/community/coaching', ['/community']) === false)
ok('a configured community prefix does not catch a neighboring route', mayInterrupt('/community-life/story', ['/community']) === true)
ok('a custom community path is quiet', mayInterrupt('/our-community/social/notifications', ['/our-community']) === false)
ok('invalid custom prefixes are ignored', mayInterrupt('/pricing', [null, 'community', 3]) === true)

/* --- the corner belongs to one of them --- */
newPageView('/store')
ok('the corner starts free', cornerFree() === true)
ok('the first to ask takes it', claimCorner('ad') === true && cornerHolder() === 'ad')
ok('the other is refused', claimCorner('chat') === false)
ok('and asking twice is fine', claimCorner('ad') === true)
newPageView('/store')
ok('the same page is not a new page view', cornerHolder() === 'ad')
newPageView('/pricing')
ok('somewhere else is', cornerFree() === true)
ok('so the other may have it there', claimCorner('chat') === true && claimCorner('ad') === false)
releaseCorner('ad')
ok('giving back what you do not hold changes nothing', cornerHolder() === 'chat')
releaseCorner('chat')
ok('a dismissed thing frees the corner for the rest of the page', cornerFree() === true)
ok('and then either may take it', claimCorner('ad') === true)

console.log('\ninterrupt: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)

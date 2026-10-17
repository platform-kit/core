/* When a usage payment raises the site-wide banner, and where the banner keeps off
   (src/lib/usage-alert.js). Pinned by npm test. */
import { alertFor, mayShowUsageAlert, NEEDS_CUSTOMER } from '../src/lib/usage-alert.js'

let pass = 0, fail = 0
const ok = (msg, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg) } }

ok('verification required raises the banner', alertFor(['requires_action']) === 'requires_action')
ok('a failed payment raises the banner', alertFor(['failed']) === 'failed')
ok('verification is said before a failure', alertFor(['failed', 'requires_action']) === 'requires_action')
ok('a processing payment needs nothing from the customer', alertFor(['pending']) === null)
ok('processing beside a failure still raises it', alertFor(['pending', 'failed']) === 'failed')
ok('no open payment, no banner', alertFor([]) === null)
ok('a signed-out visitor (no answer) gets no banner', alertFor(null) === null && alertFor(undefined) === null)
ok('the server answers with one status', alertFor('requires_action') === 'requires_action')
ok('only the two statuses need the customer', NEEDS_CUSTOMER.join() === 'requires_action,failed')

for (const path of ['/', '/store', '/billing', '/app', '/spaces/general', '/admin', '/c/articles/a-post'])
  ok(`shown on ${path}`, mayShowUsageAlert(path))
for (const path of ['/checkout/', '/checkout/hyperswitch', '/embed/comments/x', '/__preview', '/__preview/page', '/__share/card'])
  ok(`kept off ${path}`, !mayShowUsageAlert(path))
ok('a prefix only matches a whole segment', mayShowUsageAlert('/__previews-are-pages'))
ok('a path that is not one is refused', !mayShowUsageAlert('') && !mayShowUsageAlert('checkout'))

console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} checks passed (the usage payment banner)`)
process.exit(fail ? 1 : 0)

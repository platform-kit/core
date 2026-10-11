import fs from 'node:fs'
import { coachingOf, pipeSiteConfigSource, publicSite } from './site.mjs'
import { guestEmail, guestSessionSku, mayBookAsGuest } from '../supabase/functions/_shared/sessions/guest-booking.js'

let pass = 0, fail = 0
const ok = (name, condition) => {
  if (condition) pass++
  else { fail++; console.log('  FAIL  ' + name) }
}

console.log('\nGUEST SESSION BOOKING\n')

ok('the coaching auth policy defaults to requiring sign-in', coachingOf({}).requireAuthToBook === true)
ok('only an explicit false opts into guest booking', coachingOf({ coaching: { requireAuthToBook: false } }).requireAuthToBook === false &&
  coachingOf({ coaching: { requireAuthToBook: 'false' } }).requireAuthToBook === true)
ok('the existing coaching location and auth policy are resolved together',
  JSON.stringify(coachingOf({ coaching: { where: 'spaces', requireAuthToBook: false } })) === JSON.stringify({ where: 'spaces', requireAuthToBook: false }))
ok('the public site config exposes the resolved policy',
  publicSite({ looks: {}, coaching: { requireAuthToBook: false } }).coaching.requireAuthToBook === false)
ok('the assembled function config receives the server-side policy',
  pipeSiteConfigSource({ coaching: { requireAuthToBook: false } }).includes('export const coaching = {"where":"app","requireAuthToBook":false}'))

ok('guest booking requires both site opt-in and a public session rule',
  mayBookAsGuest(false, 'anyone') && mayBookAsGuest(false, 'guest')
    && !mayBookAsGuest(true, 'anyone') && !mayBookAsGuest(false, 'authenticated')
    && !mayBookAsGuest(false, 'tier-1') && !mayBookAsGuest(false, ['tier-1', 'tier-2']))
ok('guest emails are trimmed and normalized before validation',
  guestEmail('  Reader+session@Example.COM ') === 'reader+session@example.com'
    && guestEmail('not-an-email') === null && guestEmail('') === null && guestEmail(null) === null)
const offerOf = (sku) => sku === 'public-session' ? { kind: 'session' } : sku === 'book' ? { kind: 'book' } : null
ok('guest Checkout accepts one eligible paid-session offer with a selected booking',
  guestSessionSku([{ sku: 'public-session', quantity: 1 }], { event: 'one-on-one', start: '2030-01-01T10:00:00Z' }, false, offerOf) === 'public-session')
ok('guest Checkout refuses absent booking details, mixed lines, multiple units, and non-session offers',
  guestSessionSku([{ sku: 'public-session' }], null, false, offerOf) === null
    && guestSessionSku([{ sku: 'public-session' }, { sku: 'book' }], {}, false, offerOf) === null
    && guestSessionSku([{ sku: 'public-session', quantity: 2 }], {}, false, offerOf) === null
    && guestSessionSku([{ sku: 'book' }], {}, false, offerOf) === null
    && guestSessionSku([{ sku: 'public-session' }], {}, true, offerOf) === null)
const commerceSchema = fs.readFileSync(new URL('../supabase/schemas/40-commerce.sql', import.meta.url), 'utf8')
const sessionSchema = fs.readFileSync(new URL('../supabase/schemas/55-sessions.sql', import.meta.url), 'utf8')
ok('session purchases do not receive the generic paid-class entitlement before email verification',
  /p\.kind is distinct from 'session'/.test(commerceSchema) && /or verified\)/.test(commerceSchema))
ok('email claiming compares normalized addresses and waits for verification for session rows',
  /lower\(btrim\(email\)\) = lower\(btrim\(addr\)\)/.test(commerceSchema)
    && /if verified then\s+update public\.bookings/.test(commerceSchema))
ok('paid booking fulfillment is uniquely claimed per Checkout Session and hidden from clients',
  /CREATE TABLE IF NOT EXISTS "public"\."booking_checkout_fulfilments"[\s\S]*?CONSTRAINT "booking_checkout_fulfilments_pkey" PRIMARY KEY \("checkout_session_id"\)/.test(sessionSchema)
    && /REVOKE ALL ON TABLE "public"\."booking_checkout_fulfilments" FROM PUBLIC, "anon", "authenticated"/.test(sessionSchema))

console.log(`\nguest session booking: ${pass} passed${fail ? `, ${fail} FAILED` : ''}\n`)
process.exit(fail ? 1 : 0)

/*
 * ONE LIST, TWO KINDS OF RECORD.
 *
 * A site's booking types are files; a provider's offerings are rows. The surface a reader chooses
 * from shows them together, because somebody picking a time is not thinking about which of the two
 * kinds of record they are choosing from — and everything downstream of that choice deals with one
 * shape, so a booking is a booking.
 *
 * This pins the shape itself, which is the thing the browser and the functions must never disagree
 * about: a list that offers a session the judge will refuse, or a price the checkout does not know
 * of, is what a second copy of this would eventually produce.
 *
 * What the database and the served functions do with it is build/providers-db.test.mjs.
 */
import { OFFERING, isOffering, offeringId, offeringType, whereOf, WHERES } from '../supabase/functions/_shared/sessions/offering.js'
import { admits } from '../supabase/functions/_shared/sessions/admits.js'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }

console.log('\nBOOKING · OFFERINGS AS TYPES\n')

const row = { id: '0b7e1a2c-1111-4222-8333-444455556666', slug: 'a-walk', title: 'A walk and a talk', minutes: 45, price_cents: 0, currency: 'usd', where: 'place', place: 'Vondelpark, Amsterdam' }
const t = offeringType(row, { hostEmail: 'coach@example.com' })

/* --- the address --- */
ok('an offering is addressed by its row, never by its name', t.event === OFFERING + row.id)
ok('which is recognisable', isOffering(t.event) && offeringId(t.event) === row.id)
ok('and a declared type is not an offering', !isOffering('one-on-one') && offeringId('one-on-one') === null)
ok('nor is nothing at all', !isOffering(null) && !isOffering(undefined) && !isOffering(''))
/* THE WHOLE POINT of the id: two providers may each call theirs the same thing, and a provider may
   call theirs what a site's own type is called, and nothing collides */
const twin = offeringType({ ...row, id: 'aaaaaaaa-1111-4222-8333-444455556666' }, {})
ok('two offerings with one name are two addresses', twin.event !== t.event && twin.slug === t.slug)

/* --- the shape the judge and the scheduler see --- */
ok('the site\'s own scheduler books it', t.scheduler === 'native')
ok('its host is whose it is', t.hosts.join() === 'coach@example.com')
ok('a provider with no address on file has no host, rather than a wrong one', offeringType(row, {}).hosts.length === 0)
ok('it lasts what it says', t.duration === 45)
ok('an offering with no length falls back to an hour', offeringType({ ...row, minutes: null }, {}).duration === 60)
ok('it is for anybody who can reach the page', t.requires === 'anyone' && t.below === null)
ok('and carries no allowance of its own', t.weekly === 0 && t.monthly === 0)
/* the judge is the SAME judge: what it says about this shape is what it says about a file's */
ok('the judge admits a guest to it', admits(t, { tiers: [], rank: 0, signed: false, ranks: {} }))
ok('and a member', admits(t, { tiers: ['tier-3'], rank: 3, signed: true, ranks: { 'tier-3': 3 } }))

/* --- free and paid --- */
ok('a free one is not a paid session', t.sku === null)
const paid = offeringType({ ...row, price_cents: 9000 }, {})
ok('a priced one is, and its sku is its own address', paid.sku === OFFERING + row.id)
ok('so the credit and the checkout key on the same thing', paid.sku === paid.event)
ok('a price of nothing is free, not a sku', offeringType({ ...row, price_cents: 0 }, {}).sku === null)

/* --- where it happens: THE SAME FIVE WORDS a booking type uses --- */
ok('five words and no more', WHERES.join() === 'none,video,link,place,phone')
ok('somewhere in person keeps its address', t.where.kind === 'place' && t.where.address === 'Vondelpark, Amsterdam')
ok('a link keeps its url', whereOf({ where: 'link', place: 'https://example.test/room' }).url === 'https://example.test/room')
ok('a phone keeps its number', whereOf({ where: 'phone', place: '+31 20 000 0000' }).number === '+31 20 000 0000')
ok('a room on this site says so', whereOf({ where: 'video' }).kind === 'video')
/* the word this table used to hold, which made an offering in a room happen nowhere */
ok('a word that is not one of the five is nowhere in particular', whereOf({ where: 'room' }).kind === 'none')
ok('and nothing at all is too', whereOf({}).kind === 'none' && whereOf(null).kind === 'none')

/* --- it never carries what a site's own type carries --- */
ok('it seats one, because a provider sets no group', t.seats === 0)
ok('it records nothing of itself', t.record === false)
ok('and it is not on cal.com', t.username === null)

console.log('\n  ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''))
if (fail) process.exit(1)

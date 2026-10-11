/*
 * WHO A BOOKING TYPE IS FOR, pinned — the one rule both sides of the gate ask
 * (_shared/sessions/admits.js: the app's picker and the judge the functions run before anything is
 * booked). Two sides of a gate that disagree are not a gate, so there is one rule and this is it.
 *
 * The case that matters most: TIERS ARE NOT A LADDER unless you ask for one. A single slug is the
 * shorthand for "that tier and every higher rank"; a LIST is exactly those tiers and the ranks are
 * never consulted — which is the only way to say "tier-1, tier-2 and tier-3" without claiming
 * something about which of them outranks which. `npm test` runs it.
 */
import assert from 'node:assert/strict'
import { admits, rankOf } from '../supabase/functions/_shared/sessions/admits.js'

let n = 0, bad = 0
const ok = (name, cond) => { n++; if (!cond) { bad++; console.log('  FAIL', name) } }

const RANKS = { bronze: 10, silver: 20, gold: 30 }
const who = (tiers, signed = true) => ({ tiers, signed, ranks: RANKS })
const nobody = { tiers: [], signed: false, ranks: RANKS }
const signedOnly = { tiers: [], signed: true, ranks: RANKS }

ok('anyone admits everybody', admits({ requires: 'anyone' }, nobody) && admits({ requires: 'anyone' }, who(['gold'])))
ok('guest is somebody with no membership', admits({ requires: 'guest' }, nobody) && admits({ requires: 'guest' }, signedOnly) && !admits({ requires: 'guest' }, who(['bronze'])))
ok('authenticated is signed in with no membership', !admits({ requires: 'authenticated' }, nobody) && admits({ requires: 'authenticated' }, signedOnly) && !admits({ requires: 'authenticated' }, who(['bronze'])))

/* the shorthand: one slug, and the ranks decide */
ok('one slug admits that tier', admits({ requires: 'silver' }, who(['silver'])))
ok('…and every higher rank', admits({ requires: 'silver' }, who(['gold'])))
ok('…and nothing below it', !admits({ requires: 'silver' }, who(['bronze'])))
ok('…and nobody with no membership', !admits({ requires: 'silver' }, signedOnly))

/* THE LIST: exactly those, and the ranks are never asked */
ok('a list admits each tier it names', ['bronze', 'silver', 'gold'].every((t) => admits({ requires: ['bronze', 'silver', 'gold'] }, who([t]))))
ok('a list of one admits that tier alone, whatever outranks it',
  admits({ requires: ['silver'] }, who(['silver'])) && !admits({ requires: ['silver'] }, who(['gold'])))
ok('a list naming the low tiers does not admit the high one — no ladder is implied',
  admits({ requires: ['bronze', 'silver'] }, who(['bronze'])) && !admits({ requires: ['bronze', 'silver'] }, who(['gold'])))
ok('a list admits somebody holding any one of several tiers', admits({ requires: ['gold'] }, who(['bronze', 'gold'])))
ok('an empty list admits nobody', !admits({ requires: [] }, who(['gold'])))

/* the cap */
ok('below hides it from that tier and up', !admits({ requires: 'anyone', below: 'silver' }, who(['gold'])) && !admits({ requires: 'anyone', below: 'silver' }, who(['silver'])))
ok('…and leaves it for everybody under it', admits({ requires: 'anyone', below: 'silver' }, who(['bronze'])) && admits({ requires: 'anyone', below: 'silver' }, nobody))
ok('below caps a list too', !admits({ requires: ['bronze', 'gold'], below: 'gold' }, who(['gold'])))

/* a rank read off what somebody holds */
ok('a rank is the highest tier held', rankOf(['bronze', 'gold'], RANKS) === 30 && rankOf([], RANKS) === 0)
ok('a tier the site does not declare ranks nothing', rankOf(['unknown'], RANKS) === 0)

/*
 * A FOURTH TIER. The spec says a new membership file with its own tier and rank is picked up by
 * the store band, the pricing page, the chat's promised reply time and the session allowances
 * "with no code change" — and it was verified by reading the code and believing it.
 *
 * Reading is not enough here, because the failure is silent in the worst way: a site adds a tier,
 * everything still renders, and the new tier simply does not admit anybody to the sessions its
 * members paid for. Nothing errors. So this asks the ONE rule both sides of the gate ask, with a
 * tier the kit has never heard of, and requires that it behaves like any other.
 */
{
  /* ranks as a site would declare them: three it already has, and a fourth above them */
  const RANKS = { 'tier-1': 1, 'tier-2': 2, 'tier-3': 3, 'inner-circle': 4 }
  const holder = (tiers) => ({ signed: true, tiers, ranks: RANKS })

  ok(admits({ requires: 'inner-circle' }, holder(['inner-circle'])) === true,
    'a new tier admits its own members with no code change')
  ok(admits({ requires: 'tier-2' }, holder(['inner-circle'])) === true,
    'and outranks the tiers below it, because the rank is read from the files')
  ok(admits({ requires: 'inner-circle' }, holder(['tier-3'])) === false,
    'and a lower tier is not admitted to it')
  /* a list stays exactly those tiers — adding a fourth must not quietly join every list */
  ok(admits({ requires: ['tier-1', 'tier-2'] }, holder(['inner-circle'])) === false,
    'a new tier does not join a list it was not named in, whatever its rank')
  /* a tier nobody declared has no rank, so it cannot outrank anything by accident */
  ok(admits({ requires: 'tier-2' }, holder(['not-a-declared-tier'])) === false,
    'a tier no membership declares admits nobody')
  /* and the cap reads the new tier too: somebody at or above it is not offered what is below */
  ok(admits({ requires: 'tier-1', below: 'inner-circle' }, holder(['inner-circle'])) === false,
    'a cap named against the new tier holds')
  ok(rankOf(['inner-circle'], RANKS) === 4 && rankOf(['nonsense'], RANKS) === 0,
    'a declared tier has its rank and an undeclared one has none')
}

console.log(`${bad ? '✖' : '✔'} tiers: ${n - bad}/${n} checks`)
if (bad) process.exit(1)

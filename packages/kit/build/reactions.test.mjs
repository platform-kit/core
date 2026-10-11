/*
 * VOTES AND REACTIONS, the arithmetic. Two claims are worth a test on fixed numbers rather than a
 * paragraph:
 *
 *   `best` IS NOT `top`. A raw score rewards whatever was seen most — 40 up and 30 down outranks
 *   9 up and 1 down although the first is disputed and the second is liked. A confidence bound
 *   asks "how good is this at worst", and puts the second above the first. The difference is the
 *   whole reason both orders exist, and a system with only one of them is a system where the
 *   loudest thread wins.
 *
 *   The DEFAULTS are reactions on, votes off — everywhere, for a comment subject and for a room
 *   alike, and neither inherits from the other.
 *
 * What the database does with all of it is build/reactions-db.test.mjs against the local stack.
 */
import { bestOf, heatOf, scoreOf, ORDERS, ordersFor, sortComments, voteAfter } from '../src/lib/comments/model.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }

console.log('\nREACTIONS AND VOTES\n')

/* --- best is not top --- */
const liked = { id: 'liked', up: 9, down: 1, created_at: '2026-09-01T10:00:00.000Z' }
const argued = { id: 'argued', up: 40, down: 30, created_at: '2026-09-02T10:00:00.000Z' }
ok('top is the raw score', scoreOf(argued) === 10 && scoreOf(liked) === 8)
ok('top puts the argued one first', sortComments([liked, argued], 'top')[0].id === 'argued')
ok('best puts the liked one first', sortComments([liked, argued], 'best')[0].id === 'liked')
ok('best is a proportion, not a count', bestOf(liked) > bestOf(argued), bestOf(liked) + ' vs ' + bestOf(argued))
ok('nothing voted on is not liked', bestOf({ up: 0, down: 0 }) === 0)
ok('one vote is weaker than ten of the same shape',
  bestOf({ up: 1, down: 0 }) < bestOf({ up: 10, down: 0 }))

/* --- controversial: many votes, close to even --- */
ok('an even split of many is the most argued over',
  heatOf({ up: 20, down: 19 }) > heatOf({ up: 39, down: 1 }))
ok('two people disagreeing is not a controversy',
  heatOf({ up: 1, down: 1 }) < heatOf({ up: 20, down: 19 }))
ok('everybody agreeing is not one either', heatOf({ up: 40, down: 0 }) === 0)
ok('controversial puts the split first',
  sortComments([{ id: 'agreed', up: 40, down: 0 }, { id: 'split', up: 20, down: 19 }], 'controversial')[0].id === 'split')

/* --- what a reader may choose --- */
ok('five orders where there are votes', ORDERS.length === 5 && ordersFor(true).length === 5)
ok('an order nothing can compute is not offered', ordersFor(false).join(' ') === 'oldest newest')
ok('oldest is first, and so the default', ORDERS[0] === 'oldest')
ok('an unknown order falls back to oldest',
  sortComments([argued, liked], 'whatever').map((r) => r.id).join(' ') === 'liked argued')

/* --- one per person --- */
ok('a vote replaces itself and never doubles', voteAfter(1, -1) === -1 && voteAfter(-1, 1) === 1)
ok('pressing the same twice leaves none', voteAfter(-1, -1) === 0)

/* --- the defaults, read off the declaration itself rather than restated here --- */
const sql = (f) => readFileSync(fileURLToPath(new URL('../supabase/schemas/' + f, import.meta.url)), 'utf8')
const comments = sql('97-comments.sql')
const spaces = sql('90-spaces.sql')
ok('a comment subject takes reactions by default', /"votes" boolean DEFAULT false NOT NULL/.test(comments))
ok('and not votes', /"reactions" boolean DEFAULT true NOT NULL/.test(comments))
ok('a room takes reactions by default', /"reactions" boolean DEFAULT true NOT NULL/.test(spaces))
ok('and not votes', /"votes" boolean DEFAULT false NOT NULL/.test(spaces))
ok('the two are set apart: a channel reads no comment setting and the reverse',
  !/comment_subjects/.test(spaces.split('CREATE TABLE IF NOT EXISTS "public"."channels"')[1].split('\n);')[0]))

/* --- one rule, two surfaces --- */
const pair = sql('99-reactions.sql')
ok('who may cast one is written once', (pair.match(/CREATE OR REPLACE FUNCTION "public"\."signal_may"/g) || []).length === 1)
ok('and takes the surface', /signal_may"\("p_surface" "text", "p_target" "uuid", "p_what" "text"\)/.test(pair))
ok('both surfaces go through it',
  /signal_may"\("surface", "target_id", 'reactions'\)/.test(pair) && /signal_may"\("surface", "target_id", 'votes'\)/.test(pair))
ok('a vote is one row per person', /"votes_pkey" PRIMARY KEY \("surface", "target_id", "user_id"\)/.test(pair))
ok('a reaction is one row per emoji', /"reactions_pkey" PRIMARY KEY \("surface", "target_id", "user_id", "emoji"\)/.test(pair))
ok('nothing is ordered or hidden by a score in the database',
  !/order by[\s\S]{0,80}(vote|score)/i.test(pair))

console.log('\nreactions: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)

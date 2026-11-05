/*
 * THE SHAPE OF A CONVERSATION, and what holds one back — the pure half, so this file and the page
 * read the same arithmetic. What the database actually does with it (the policies, the hold, the
 * one read) is build/comments-db.test.mjs against the local stack.
 *
 * The two claims worth writing a test for: a reply four deep keeps its real depth and is DRAWN at
 * the surface's, saying who it answers; and the flagged list matches whole words, so "Scunthorpe"
 * is not held by "cunt" — which is the mistake every naive filter makes and the reason a moderator
 * stops reading the queue.
 */
import { commentsOf, policyOf, wordsOf, sweepable, shape as shapeRow, POLICY } from './comments-push.mjs'
import { embedAllowed } from '../src/lib/comments/model.js'
import { treeOf, shape, sortComments, flaggedWord, holdsFor, reactionsOf, voteAfter, voteTally, stateOf } from '../src/lib/comments/model.js'

let pass = 0, fail = 0
const ok = (name: any, cond: any, detail?: any) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }

console.log('\nCOMMENTS\n')

const at = (n: any) => '2026-09-0' + n + 'T10:00:00.000Z'
const line = (id: any, parent: any, name: any, n: any) => ({ id, parent, name, created_at: at(n), body: id, up: 0, down: 0 })

/* --- a four-deep reply keeps its depth --- */
const deepRows = [line('a', null, 'Ada', 1), line('b', 'a', 'Bo', 2), line('c', 'b', 'Cy', 3), line('d', 'c', 'Di', 4)]
// @ts-expect-error TS2345, from the conversion: Argument of type '{ id: any; parent: any; name: any; created_at: string; body: any; up: number; down: number; }[]' is not assignable to para
const tree = treeOf(deepRows)
ok('one root', tree.length === 1 && tree[0].id === 'a')
ok('the depth is kept', tree[0].kids[0].kids[0].kids[0].id === 'd')

const drawn = (rows: any, opts: any) => shape(rows, opts).map((l: any) => (l.fold ? 'fold:' + l.hidden : l.id + '@' + l.indent + (l.answers ? '←' + l.answers.name : '')))

ok('at depth 3 it nests', drawn(deepRows, { depth: 3, collapse: 20 }).join(' ') === 'a@0 b@1 c@2 d@3')
ok('at depth 1 it is one run, each naming who it answers',
  drawn(deepRows, { depth: 1, collapse: 20 }).join(' ') === 'a@0 b@1 c@1←Bo d@1←Cy')
ok('a reply the indent still speaks for says nothing',
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ id: any; parent: any; name: any; created_at: string; body: any; up: number; down: number; }[]' is not assignable to para
  shape(deepRows, { depth: 3, collapse: 20 }).every((l: any) => l.fold || !l.answers))
ok('past the stop, a reply says whose comment it answers',
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ id: any; parent: any; name: any; created_at: string; body: any; up: number; down: number; }[]' is not assignable to para
  shape(deepRows, { depth: 2, collapse: 20 }).find((l: any) => l.id === 'd').answers.name === 'Cy')

/* --- a long run folds, and says how many --- */
const many = [line('r', null, 'Ada', 1), ...Array.from({ length: 9 }, (_, i) => line('k' + i, 'r', 'K' + i, 2))]
// @ts-expect-error TS2345, from the conversion: Argument of type '{ id: any; parent: any; name: any; created_at: string; body: any; up: number; down: number; }[]' is not assignable to para
const folded = shape(many, { depth: 3, collapse: 4 })
ok('four are shown', folded.filter((l: any) => !l.fold && l.id !== 'r').length === 4)
ok('the rest are behind one control saying how many', folded.filter((l: any) => l.fold).length === 1 && folded.find((l: any) => l.fold).hidden === 5)
// @ts-expect-error TS2345, from the conversion: Argument of type '{ id: any; parent: any; name: any; created_at: string; body: any; up: number; down: number; }[]' is not assignable to para
ok('opening it shows them all', shape(many, { depth: 3, collapse: 4, open: ['r'] }).filter((l: any) => l.fold).length === 0)
// @ts-expect-error TS2345, from the conversion: Argument of type '{ id: any; parent: any; name: any; created_at: string; body: any; up: number; down: number; }[]' is not assignable to para
ok('a run no longer than the count does not fold', shape(many, { depth: 3, collapse: 9 }).some((l: any) => l.fold) === false)

/* --- a withdrawn parent keeps its children --- */
const gone = [{ ...line('p', null, 'Ada', 1), body: null, deleted_at: at(2) }, line('q', 'p', 'Bo', 3)]
ok('a withdrawn comment is still a parent', drawn(gone, { depth: 3, collapse: 9 }).join(' ') === 'p@0 q@1')
ok('and reads as removed', stateOf(gone[0]) === 'removed' && stateOf(gone[1]) === 'live')
ok('a waiting comment reads as waiting', stateOf({ state: 'waiting' }) === 'waiting')

/* --- an orphan is not lost --- */
ok('a reply whose parent is off this page is drawn as its own line',
  drawn([line('x', 'nowhere', 'Ada', 1)], { depth: 3, collapse: 9 }).join(' ') === 'x@0')
// @ts-expect-error TS2322, from the conversion: Type '{ id: string; parent: string; created_at: string; }' is not assignable to type 'never'.
ok('a loop cannot hang the draw', shape([{ id: 'l1', parent: 'l2', created_at: at(1) }, { id: 'l2', parent: 'l1', created_at: at(2) }], {}).length === 2)

/* --- the order is over the roots; a reply never leaves its parent --- */
const scored = [
  { ...line('lo', null, 'Ada', 1), up: 1, down: 0 },
  { ...line('hi', null, 'Bo', 2), up: 9, down: 1 },
  line('re', 'lo', 'Cy', 3),
]
// @ts-expect-error TS2345, from the conversion: Argument of type '{ id: any; parent: any; name: any; created_at: string; body: any; up: number; down: number; }[]' is not assignable to para
ok('oldest is the default order', sortComments(scored, 'oldest').map((r: any) => r.id).join(' ') === 'lo hi re')
// @ts-expect-error TS2345, from the conversion: Argument of type '{ id: any; parent: any; name: any; created_at: string; body: any; up: number; down: number; }[]' is not assignable to para
ok('newest turns the roots around', sortComments(scored, 'newest').map((r: any) => r.id).join(' ') === 'hi lo re')
ok('a reply stays with what it answers whatever the order',
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ id: any; parent: any; name: any; created_at: string; body: any; up: number; down: number; }[]' is not assignable to para
  shape(sortComments(scored, 'newest'), { depth: 3, collapse: 9 }).map((l: any) => l.id).join(' ') === 'hi lo re')

/* --- the flagged list: whole words, never substrings --- */
const WORDS = ['damn', 'cunt', 'free vbucks']
// @ts-expect-error TS2345, from the conversion: Argument of type 'string[]' is not assignable to parameter of type 'never[]'. Type 'string' is not assignable to type 'never'.
ok('a whole word matches', flaggedWord('oh damn that is good', WORDS) === 'damn')
// @ts-expect-error TS2345, from the conversion: Argument of type 'string[]' is not assignable to parameter of type 'never[]'. Type 'string' is not assignable to type 'never'.
ok('the case does not matter', flaggedWord('DAMN.', WORDS) === 'damn')
// @ts-expect-error TS2345, from the conversion: Argument of type 'string[]' is not assignable to parameter of type 'never[]'. Type 'string' is not assignable to type 'never'.
ok('punctuation either side is not part of the word', flaggedWord('(damn)', WORDS) === 'damn')
// @ts-expect-error TS2345, from the conversion: Argument of type 'string[]' is not assignable to parameter of type 'never[]'. Type 'string' is not assignable to type 'never'.
ok('Scunthorpe is not a slur', flaggedWord('I am from Scunthorpe', WORDS) === null)
// @ts-expect-error TS2322, from the conversion: Type 'string' is not assignable to type 'never'.
ok('nor is an assassin', flaggedWord('the assassin waited', ['ass']) === null)
// @ts-expect-error TS2345, from the conversion: Argument of type 'string[]' is not assignable to parameter of type 'never[]'. Type 'string' is not assignable to type 'never'.
ok('a phrase matches as a phrase', flaggedWord('get free vbucks here', WORDS) === 'free vbucks')
ok('an empty list holds nothing', flaggedWord('damn', []) === null)
// @ts-expect-error TS2322, from the conversion: Type 'string' is not assignable to type 'never'.
ok('a regular expression in the list is not one', flaggedWord('a.c', ['a.c']) === 'a.c' && flaggedWord('abc', ['a.c']) === null)

/* --- who waits, and why --- */
ok('nothing waits by default', holdsFor({ approval: 'none', body: 'hello' }) === null)
ok('everything waits where the surface says all', (holdsFor({ approval: 'all', body: 'hello' }) as any).why === 'standing')
ok('a trusted author does not wait', holdsFor({ approval: 'trusted', body: 'hello', trusted: true }) === null)
ok('an unknown one does', (holdsFor({ approval: 'trusted', body: 'hello', trusted: false }) as any).why === 'standing')
ok('a flagged word holds a trusted author too',
  // @ts-expect-error TS2322, from the conversion: Type 'string[]' is not assignable to type 'never[]'. Type 'string' is not assignable to type 'never'.
  (holdsFor({ approval: 'trusted', body: 'damn', words: WORDS, trusted: true }) as any).why === 'word')
ok('and names the word, to whoever may see the hold',
  // @ts-expect-error TS2322, from the conversion: Type 'string[]' is not assignable to type 'never[]'. Type 'string' is not assignable to type 'never'.
  (holdsFor({ approval: 'none', body: 'damn', words: WORDS }) as any).word === 'damn')

/* --- what came back with each line --- */
ok('reactions come back most first',
  reactionsOf({ re: { '👍': 2, '🎉': 5 }, mine_re: ['🎉'] }).map((r) => r.emoji + r.n + (r.mine ? '*' : '')).join(' ') === '🎉5* 👍2')
ok('an emoji nobody left is not a row', reactionsOf({ re: { '👍': 0 } }).length === 0)
ok('no reactions is no rows', reactionsOf({}).length === 0)

/* --- a vote is one row, and changing your mind is the same row --- */
ok('casting up from nothing is up', voteAfter(0, 1) === 1)
ok('casting the opposite replaces it', voteAfter(1, -1) === -1)
ok('casting the same again withdraws it', voteAfter(1, 1) === 0 && voteAfter(-1, -1) === 0)
const tally = voteTally({ up: 4, down: 1, my_vote: 1 }, -1)
ok('the tally moves both ways at once', tally.up === 3 && tally.down === 2 && tally.my_vote === -1)
ok('withdrawing takes one off and adds none', JSON.stringify(voteTally({ up: 4, down: 1, my_vote: 1 }, 0)) === JSON.stringify({ up: 3, down: 1, my_vote: 0 }))
ok('a tally never goes below nothing', voteTally({ up: 0, down: 0, my_vote: 0 }, 0).up === 0)

/* --- the site's policy, and a record that differs from it --- */
const OFF = policyOf({})
const SITE = policyOf({ allow: 'members', approval: 'trusted', votes: true, depth: 1, collapse: 3, flagged: ['damn'] })

// @ts-expect-error TS2345, from the conversion: Argument of type '{ allow: any; approval: any; votes: any; reactions: any; depth: any; collapse: any; flagged: string[]; domains: string[]; 
ok('what ships is off', OFF.allow === 'off' && commentsOf(null, OFF) === null)
ok('reactions on and votes off by default', OFF.reactions === true && OFF.votes === false)
ok('a record that says nothing takes the site\'s answer',
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ allow: any; approval: any; votes: any; reactions: any; depth: any; collapse: any; flagged: string[]; domains: string[]; 
  commentsOf(null, SITE).allow === 'members' && commentsOf(null, SITE).approval === 'trusted')
ok('turning a library on is one file: nothing in the record changed',
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ allow: any; approval: any; votes: any; reactions: any; depth: any; collapse: any; flagged: string[]; domains: string[]; 
  commentsOf(undefined, SITE).votes === true && commentsOf(undefined, SITE).depth === 1)
ok('one record may differ, field by field',
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ allow: any; approval: any; votes: any; reactions: any; depth: any; collapse: any; flagged: string[]; domains: string[]; 
  commentsOf({ allow: 'everyone' }, SITE).allow === 'everyone' && commentsOf({ allow: 'everyone' }, SITE).approval === 'trusted')
// @ts-expect-error TS2345, from the conversion: Argument of type '{ allow: any; approval: any; votes: any; reactions: any; depth: any; collapse: any; flagged: string[]; domains: string[]; 
ok('and the rest of the site does not move', commentsOf(null, SITE).allow === 'members')
// @ts-expect-error TS2345, from the conversion: Argument of type '{ allow: any; approval: any; votes: any; reactions: any; depth: any; collapse: any; flagged: string[]; domains: string[]; 
ok('off in a block is off whatever the site says', commentsOf({ allow: 'off', space: 'x' }, SITE) === null)
// @ts-expect-error TS2345, from the conversion: Argument of type '{ allow: any; approval: any; votes: any; reactions: any; depth: any; collapse: any; flagged: string[]; domains: string[]; 
ok('the bare word is off too', commentsOf('off', SITE) === null && commentsOf(false, SITE) === null)
// @ts-expect-error TS2345, from the conversion: Argument of type '{ allow: any; approval: any; votes: any; reactions: any; depth: any; collapse: any; flagged: string[]; domains: string[]; 
ok('a word is the allow and nothing else', commentsOf('hosts', SITE).allow === 'hosts' && commentsOf('hosts', SITE).votes === true)
// @ts-expect-error TS2345, from the conversion: Argument of type '{ allow: any; approval: any; votes: any; reactions: any; depth: any; collapse: any; flagged: string[]; domains: string[]; 
ok('a record naming a room keeps it', commentsOf({ allow: 'members', space: 'p', channel: 'b' }, SITE).channel === 'b')
// @ts-expect-error TS2345, from the conversion: Argument of type '{ allow: any; approval: any; votes: any; reactions: any; depth: any; collapse: any; flagged: string[]; domains: string[]; 
ok('a nonsense allow falls back rather than inventing one', commentsOf({ allow: 'maybe' }, SITE).allow === 'members')
// @ts-expect-error TS2345, from the conversion: Argument of type '{ allow: any; approval: any; votes: any; reactions: any; depth: any; collapse: any; flagged: string[]; domains: string[]; 
ok('a depth out of range falls back', commentsOf({ depth: 99 }, SITE).depth === 1 && commentsOf({ depth: 2 }, SITE).depth === 2)
ok('the row carries the answer and not the question',
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ allow: any; approval: any; votes: any; reactions: any; depth: any; collapse: any; flagged: string[]; domains: string[]; 
  Object.keys(shapeRow(commentsOf(null, SITE))).join(' ') === 'allow approval votes reactions depth collapse')
// @ts-expect-error TS2345, from the conversion: Argument of type '{ allow: any; approval: any; votes: any; reactions: any; depth: any; collapse: any; flagged: string[]; domains: string[]; 
ok('and never the word list, which no browser may read', (shapeRow(commentsOf(null, SITE)) as any).flagged === undefined)
ok('the words are a list however they were written',
  wordsOf('damn, free vbucks').join('|') === 'damn|free vbucks' && wordsOf(['a', ' b ']).join('|') === 'a|b')
ok('and nothing is shipped by the platform', POLICY.flagged.length === 0)

/* --- where the embed may be drawn --- */
const SELF = 'https://example.com'
ok('a site that named no domain has not decided against anywhere', embedAllowed('https://anything.test', [], SELF))
// @ts-expect-error TS2322, from the conversion: Type 'string' is not assignable to type 'never'.
ok('a named domain is allowed', embedAllowed('https://example.com', ['example.com'], SELF))
ok('and so are its subdomains, which is what somebody writing example.com means',
  // @ts-expect-error TS2322, from the conversion: Type 'string' is not assignable to type 'never'.
  embedAllowed('https://www.example.com', ['example.com'], SELF) && embedAllowed('https://a.b.example.com', ['example.com'], SELF))
// @ts-expect-error TS2322, from the conversion: Type 'string' is not assignable to type 'never'.
ok('somebody else is not', !embedAllowed('https://evil.test', ['example.com'], SELF))
// @ts-expect-error TS2322, from the conversion: Type 'string' is not assignable to type 'never'.
ok('and neither is a name that merely ends the same way', !embedAllowed('https://notexample.com', ['example.com'], SELF))
// @ts-expect-error TS2322, from the conversion: Type 'string' is not assignable to type 'never'.
ok('an entry pasted as a url is forgiven', embedAllowed('https://example.com', ['https://example.com/blog/'], SELF))
// @ts-expect-error TS2322, from the conversion: Type 'string' is not assignable to type 'never'.
ok('and one with a port', embedAllowed('https://example.com', ['example.com:443'], SELF))
// @ts-expect-error TS2322, from the conversion: Type 'string' is not assignable to type 'never'.
ok('an ancestor nobody could read is refused where there is a list', !embedAllowed('', ['example.com'], SELF))
ok('but not where there is none, since a list of nothing refuses nothing', embedAllowed('', [], SELF))
// @ts-expect-error TS2322, from the conversion: Type 'string' is not assignable to type 'never'.
ok('the site itself is always allowed', embedAllowed(SELF, ['example.com'], SELF))
/* the whole reason this compares ORIGINS: in development the site and the page framing it are both
   localhost, and comparing hosts let every local page through a list that should have refused it */
ok('a local page framing a local site is still somebody else',
  // @ts-expect-error TS2322, from the conversion: Type 'string' is not assignable to type 'never'.
  !embedAllowed('http://localhost:8899', ['example.com'], 'http://localhost:5173'))

/* --- what the sweep may remove, which is a question about destroying data --- */
const WANT = [{ kind: 'page', subject: '*' }, { kind: 'article', subject: 'listening-back' }]
// @ts-expect-error TS2345, from the conversion: Argument of type '{ kind: string; subject: string; }[]' is not assignable to parameter of type 'never[]'. Type '{ kind: string; subject: str
ok('a record the files still declare stays', !sweepable({ kind: 'article', subject: 'listening-back' }, WANT))
// @ts-expect-error TS2345, from the conversion: Argument of type '{ kind: string; subject: string; }[]' is not assignable to parameter of type 'never[]'. Type '{ kind: string; subject: str
ok('a record no file declares any more goes', sweepable({ kind: 'article', subject: 'deleted' }, WANT))
/* THE ONE THAT DESTROYED DATA: an open kind's subjects are made at runtime by an embed, no file
   will ever declare them, and the sweep owned them — so every projection run deleted every
   conversation an embed had started, and a deploy would have done it silently. */
ok('a conversation an embed started is nobody\'s file and not the sweep\'s to remove',
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ kind: string; subject: string; }[]' is not assignable to parameter of type 'never[]'. Type '{ kind: string; subject: str
  !sweepable({ kind: 'page', subject: '/content/articles/listening-back' }, WANT))
ok('but a kind the site has stopped declaring open loses its wildcard',
  // @ts-expect-error TS2322, from the conversion: Type '{ kind: string; subject: string; }' is not assignable to type 'never'.
  sweepable({ kind: 'page', subject: '*' }, [{ kind: 'article', subject: 'listening-back' }]))
// @ts-expect-error TS2345, from the conversion: Argument of type '{ kind: string; subject: string; }[]' is not assignable to parameter of type 'never[]'. Type '{ kind: string; subject: str
ok('and with the kind still open the wildcard stays', !sweepable({ kind: 'page', subject: '*' }, WANT))
// @ts-expect-error TS2345, from the conversion: Argument of type '{ kind: string; subject: string; }[]' is not assignable to parameter of type 'never[]'. Type '{ kind: string; subject: str
ok('a row with no kind is not swept by accident', !sweepable({}, WANT))

console.log('\ncomments: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)

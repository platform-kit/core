/* What a transcript is made of (src/lib/speech/transcript.js): what to show while somebody is still
   speaking, what to keep once they have stopped, and how to say it as a sentence. Recognition hands
   the same words back again and again as it makes up its mind, so these rules are the difference
   between a readable note and a stream of repeated guesses. Nothing here touches a browser. */
import { readResults, showing, tidy, asSentence, caption } from '../src/lib/speech/transcript.js'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }

console.log('\nTRANSCRIPT\n')

/* a recognition event's results, as the browser shapes them */
const R = (...items) => items.map(([t, isFinal]) => ({ 0: { transcript: t }, isFinal, length: 1 }))

const a = readResults(R(['hello there ', true], ['how are ', false]))
ok('what is settled and what is still a guess are kept apart', a.done === 'hello there ' && a.saying === 'how are ', JSON.stringify(a))
ok('nothing said is nothing either way', JSON.stringify(readResults([])) === JSON.stringify({ done: '', saying: '' }))
ok('every final piece is kept, in order', readResults(R(['one ', true], ['two ', true])).done === 'one two ')
ok('a run can be read from part way in', readResults(R(['old ', true], ['new ', true]), 1).done === 'new ')

ok('what is on screen is what is settled then what is guessed', showing('hello there', 'how are') === 'hello there how are')
ok('and nothing extra when there is no guess', showing('hello there', '') === 'hello there')
ok('nor when there is nothing at all', showing('', '') === '')

ok('one space between words', tidy('hello   there  you') === 'hello there you')
ok('none at the ends', tidy('  hello  ') === 'hello')
ok('and never before a full stop', tidy('hello , there .') === 'hello, there.')

ok('a transcript is opened with a capital and closed with a stop', asSentence('hello there') === 'Hello there.')
ok('a stop it already has is not doubled', asSentence('hello there.') === 'Hello there.')
ok('nor a question mark', asSentence('are you there?') === 'Are you there?')
ok('nothing said is nothing written', asSentence('   ') === '')
ok('a capital it already has is left alone', asSentence('I said so') === 'I said so.')
/* punctuation is never invented: putting a comma where somebody did not say one is putting words in
   their mouth, and this text is shown as theirs */
ok('the words between are exactly the words', asSentence('one two three four') === 'One two three four.')

ok('a caption is the last few words', caption('one two three four five', 3) === 'three four five')
ok('and all of them when there are few', caption('one two', 5) === 'one two')
ok('and nothing when there is nothing', caption('', 5) === '')

console.log(`\n  ${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)

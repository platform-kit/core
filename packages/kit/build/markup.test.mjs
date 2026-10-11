/* What a person may write in a message — the marks every chat surface in the product offers, and
   the ones it deliberately does not. The parser returns parts and never html, so this is also the
   check that nothing a person types can become markup. */
import { inlineParts, messageBlocks, plainMarkup } from '../src/lib/chat/markup.js'

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
/* a compact reading of the parts: the text, with its marks in brackets */
const said = (body) => messageBlocks(body).map((b) => b.kind + ':' + b.lines
  .map((parts) => parts.map((p) => (p.kind === 'link' ? '<' + p.href + '|' + p.text + '>' : p.text) + (p.marks.length ? '[' + p.marks.join('') + ']' : '')).join('')).join(' / ')).join(' | ')

/* --- the marks people already type --- */
ok('bold', said('a **b** c') === 'p:a b[b] c')
ok('italic, either way it is written', said('*a*') === 'p:a[i]' && said('_a_') === 'p:a[i]')
ok('struck through', said('~~a~~') === 'p:a[s]')
ok('code', said('`a`') === 'p:a[code]')
ok('marks nest', said('**a *b* c**') === 'p:a [b]b[bi] c[b]')
ok('and a mark is not doubled by nesting itself', said('**a **b** c**').includes('[b]'))

/* --- and what is NOT a mark --- */
ok('a lone asterisk is an asterisk', said('nothing ** here') === 'p:nothing ** here')
ok('an empty pair is two asterisks', said('** **') === 'p:** **')
ok('what is in code is not a mark', said('`**a**`') === 'p:**a**[code]')
ok('a heading is not a heading: a message is one person talking', said('# hello') === 'p:# hello')
ok('an image tag is somebody typing brackets', said('![x](y)').includes('!'))
ok('nothing ever becomes html', JSON.stringify(messageBlocks('<b>x</b> & "y"')).includes('<b>x</b>'))

/* --- a line that means something on its own --- */
ok('a run of bullets is one list', said('- one\n- two') === 'ul:one / two')
ok('a run of quoted lines is one quotation', said('> a\n> b') === 'quote:a / b')
ok('a list ends where the prose begins', said('- one\nafter') === 'ul:one | p:after')
ok('prose keeps its own newlines', said('a\nb') === 'p:a / b')

/* --- an address --- */
ok('a bare address is a link', said('see https://x.test/a b') === 'p:see <https://x.test/a|https://x.test/a> b')
ok('a www address is given its scheme', said('www.x.test') === 'p:<https://www.x.test|www.x.test>')
ok('a written link keeps its words', said('[the page](https://x.test)') === 'p:<https://x.test|the page>')
ok('a full stop after an address is not part of it', said('at https://x.test.') === 'p:at <https://x.test|https://x.test>.')
ok('an address inside a mark keeps the mark', said('**https://x.test**') === 'p:<https://x.test|https://x.test>[b]')

/* --- the words without the marks --- */
ok('a preview says the words and none of the punctuation', plainMarkup('**bold** and `code`') === 'bold and code')
ok('a preview of a list is its items', plainMarkup('- one\n- two') === 'one\ntwo')
ok('nothing is nothing', plainMarkup('') === '' && messageBlocks('').length === 0 && inlineParts('').length === 0)
ok('a body that is not a string is not a crash', plainMarkup(null) === '' && plainMarkup(undefined) === '')

console.log('\nmarkup: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)

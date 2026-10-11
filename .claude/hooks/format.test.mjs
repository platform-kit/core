/*
 * THE REPLY-SHAPE HOOK, PROVED. A guard on how an answer is written is worth nothing if it fires
 * on the wrong answers: one that blocked a two-line 'done, tests green' would be turned off within
 * the day, and one that passed a thousand-word report with the decision buried in it would be
 * there for nothing. Both directions are checked here.
 *
 *   node .claude/hooks/format.test.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
const S = '/var/folders/l0/s2gjydd90hs4l81f_wf2mdbr0000gn/T/'
let pass = 0, fail = 0
const check = (name, text, want, active = false) => {
  const t = S + '/t.jsonl'
  fs.writeFileSync(t, JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text }] } }) + '\n')
  const out = execFileSync('node', ['.claude/hooks/format.mjs', 'stop'], { input: JSON.stringify({ transcript_path: t, stop_hook_active: active }), encoding: 'utf8' })
  const blocked = out.includes('"block"')
  if (blocked === want) { pass++; console.log('  ok  ' + name) }
  else { fail++; console.log('  FAIL ' + name + ' — ' + (blocked ? 'blocked' : 'passed') + ', wanted ' + (want ? 'blocked' : 'passed') + (out ? '\n      ' + out.slice(0, 200) : '')) }
}

check('a short reply passes', 'Done.\nTests are green.', false)
check('exactly four lines passes', 'a\nb\nc\nd', false)
check('five lines with no summary is blocked', 'a\nb\nc\nd\ne', true)
check('five lines with a bottom line passes', 'a\nb\nc\nd\n**Bottom line:** it works.', false)
check('a summary at the top only is blocked', '**Summary:** it works.\n' + Array.from({length:30},(_,i)=>'line '+i).join('\n'), true)
check('a long reply around a code block passes', 'Here it is.\n```\n' + Array.from({length:40},(_,i)=>'code '+i).join('\n') + '\n```\nThat is all.', false)
check('a decision buried in prose is blocked', Array.from({length:12},(_,i)=>'line '+i).join('\n') + '\nWhether the theme should ship a palette is your call.\n**Bottom line:** it works.', true)
check('a decision under its own heading passes', Array.from({length:12},(_,i)=>'line '+i).join('\n') + '\nWhether the theme should ship a palette is your call.\n**Bottom line:** it works.\n## Decisions for you\n- ship a palette?', false)
check('no decision owed needs no decision list', Array.from({length:12},(_,i)=>'line '+i).join('\n') + '\n**Bottom line:** it all works, nothing for you to decide.', false)
check('never blocks twice', 'a\nb\nc\nd\ne', false, true)
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n')
process.exit(fail ? 1 : 0)

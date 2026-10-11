#!/usr/bin/env node
/*
 * THE REPLY'S SHAPE, ENFORCED RATHER THAN REMEMBERED.
 *
 * James asked for a bottom line on any answer over four lines, with the decisions that are HIS
 * separated into their own list at the end. That was first written down as a memory, which is
 * advisory: it is read when it is recalled, and a long autonomous run is exactly the situation
 * where a long technical narrative gets written and the one thing he has to act on ends up buried
 * in the middle of it. A rule that matters only when the agent remembers it is not a rule.
 *
 * So it is a Stop hook. The turn cannot end while the last reply is long and has no bottom line:
 * the agent is handed back what is missing and writes it. Structural, in the same way the docs
 * guard is — and for the same reason, which is that both were being missed.
 *
 * WHAT IS CHECKED, and deliberately nothing more:
 *   · a reply over THRESHOLD lines of prose carries a bottom line — a heading or an opening
 *     phrase that plainly says "here is the short version"
 *   · that it comes near the END, because a summary in the middle is not a bottom line
 *   · that decisions for James, if the reply says there are any, are under their own heading
 *     rather than mixed into the summary
 *
 * WHAT IS NOT CHECKED: whether the summary is any good, whether it is plain English, whether the
 * decisions are the right ones. A hook cannot judge that and should not pretend to. It catches the
 * omission, which is the failure that actually happens.
 *
 * It never loops: `stop_hook_active` means the agent has already been sent back once for this, and
 * the second pass is allowed through whatever it says. A guard that can block twice can block for
 * ever, and a turn that cannot end is worse than a reply with no summary.
 *
 *   echo '{"transcript_path":"…"}' | node .claude/hooks/format.mjs stop
 */
import fs from 'node:fs'

const mode = process.argv[2] || 'stop'
if (mode !== 'stop') process.exit(0)

let input = {}
try {
  input = JSON.parse(await new Promise((r) => {
    let s = ''
    process.stdin.on('data', (d) => (s += d))
    process.stdin.on('end', () => r(s || '{}'))
  }))
} catch { process.exit(0) }

/* sent back once already: never loop */
if (input.stop_hook_active) process.exit(0)

const T = input.transcript_path
if (!T || !fs.existsSync(T)) process.exit(0)

/* the last thing the agent actually SAID — the final assistant turn's text, tool calls excluded */
let said = ''
try {
  const rows = fs.readFileSync(T, 'utf8').trim().split('\n')
  for (let i = rows.length - 1; i >= 0; i--) {
    let row
    try { row = JSON.parse(rows[i]) } catch { continue }
    const m = row && row.message
    if (!m || m.role !== 'assistant') continue
    const text = []
    for (const part of [].concat(m.content || [])) {
      if (typeof part === 'string') text.push(part)
      else if (part && part.type === 'text' && part.text) text.push(part.text)
    }
    if (text.length) { said = text.join('\n'); break }
    /* an assistant row of tool calls alone is not a reply — keep looking back */
  }
} catch { process.exit(0) }

if (!said.trim()) process.exit(0)

/*
 * HOW LONG IS LONG. Blank lines and the insides of fenced code blocks are not prose: a reply that
 * is four sentences around a twenty-line snippet is a short reply, and counting the snippet would
 * make the hook fire on exactly the answers that need no summary.
 */
const THRESHOLD = 4
const rows = said.split('\n')
let fenced = false
const prose = []
for (const r of rows) {
  if (/^\s*```/.test(r)) { fenced = !fenced; continue }
  if (fenced) continue
  if (r.trim()) prose.push(r)
}
if (prose.length <= THRESHOLD) process.exit(0)

const body = prose.join('\n')
const tail = prose.slice(-Math.max(6, Math.ceil(prose.length / 3))).join('\n')

/* a bottom line: said as a heading, or as an opening phrase that plainly announces the short version */
const BOTTOM = /(^|\n)\s*#{0,6}\s*\**\s*(bottom line|in short|the short version|summary|to summarise|to sum up)\b/i
const DECISIONS = /(^|\n)\s*#{0,6}\s*\**\s*(decisions?|your call|for you to decide|needs? your decision|what I need from you)\b/i

const missing = []
if (!BOTTOM.test(body)) missing.push('a plain-English bottom line — a short summary of everything that matters, in words that carry no jargon')
else if (!BOTTOM.test(tail)) missing.push('the bottom line at the END of the reply — a summary in the middle is not a bottom line')

/* only ask for the decisions list where the reply itself says a decision is owed: a report with
   nothing for James to decide should not be made to invent one */
const OWED = /\b(your call|decision for James|decision for you|up to you|needs? a decision|I did not want to guess|blocked on (you|James)|whether .{0,60}\bshould\b)/i
if (OWED.test(body) && !DECISIONS.test(tail)) {
  missing.push('the decisions separated into their own list at the very END — this reply says something is James’s to decide, and it is mixed into the prose where it will be missed')
}

if (!missing.length) process.exit(0)

console.log(JSON.stringify({
  decision: 'block',
  reason:
    'Reply shape: this answer is ' + prose.length + ' lines and is missing:\n' +
    missing.map((m) => '  · ' + m).join('\n') +
    '\nRewrite the reply with it. Keep the detail you have already written — add the summary, do not' +
    ' replace the answer with one. If nothing is James’s to decide, say so in a line rather than' +
    ' leaving him to work it out.',
}))
process.exit(0)

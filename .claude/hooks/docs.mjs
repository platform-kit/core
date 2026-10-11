/*
 * The agent's docs guard — the harness side of "the docs never drift from the code". Three hooks in
 * .claude/settings.json call this with a mode, and it calls packages/kit/build/docs-check.mjs:
 *
 *   touched   PostToolUse on Edit/Write: after a file is changed, the pages that describe it are put in
 *             front of the agent as context, so updating them is part of the same change — and a file in a
 *             documented surface that no docs-site page names is said to be undocumented, on the spot.
 *   commit    PreToolUse on Bash: a `git commit` is refused (exit 2, the faults on stderr) while a changed
 *             source has a page that was not touched, or a reference page disagrees with the code.
 *   stop      Stop: the turn cannot end while the working tree holds such a fault — the agent is sent back
 *             to fix it (once; a second stop with the same faults passes, so it can never loop).
 *   session   SessionStart: whatever the docs and the code disagree on is put in front of the agent as the
 *             session opens — including a row of the overview's "what it replaces" table that James edited,
 *             which is an instruction to propose a change, never drift to correct.
 *
 * The check runs from the repository root, whatever directory the tool ran in. Read-only but for its
 * output; it never edits a page itself.
 */
import fs from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mode = process.argv[2]
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHECK = path.join(ROOT, 'packages', 'kit', 'build', 'docs-check.mjs')
let input = {}
try { input = JSON.parse(await new Promise((r) => { let s = ''; process.stdin.on('data', (d) => (s += d)); process.stdin.on('end', () => r(s || '{}')) })) } catch {}
const run = (args) => spawnSync(process.execPath, [CHECK, ...args, '--json'], { cwd: ROOT, encoding: 'utf8' })
const parse = (r) => { try { return JSON.parse((r.stdout || '').trim().split('\n').pop()) } catch { return { ok: true, faults: [] } } }
const lines = (faults) => faults.map((f) => `  ${f.page}: ${f.why}`).join('\n')

if (mode === 'touched') {
  const file = input.tool_input && (input.tool_input.file_path || input.tool_input.notebook_path)
  if (!file) process.exit(0)
  const rel = path.relative(ROOT, path.resolve(file))
  if (rel.startsWith('..') || /^(sites\/docs\/content\/docs|docs)\//.test(rel)) process.exit(0)   /* a doc itself, or outside the repo */
  const r = parse(run(['--touched', rel]))
  if (r.orphan) { console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `Docs guard: ${rel} is in a documented surface and NO docs-site page names it. The docs site (sites/docs/content/docs) is the canonical documentation — write its page there (a guide, and the reference page when routes, fields or variables are involved) or add the file to the page that describes it, in this same change; the commit is refused until a page names it.${r.pages && r.pages.length ? ' (' + r.pages.join(', ') + ' name the directory and so list it — listing is not documenting it.)' : ''}` } })); process.exit(0) }
  if (!r.pages || !r.pages.length) process.exit(0)
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `Docs guard: ${rel} is described by ${r.pages.join(', ')}. Those pages are part of this change — update whatever they say that is no longer true, in this same change (or set their reviewed: date if, having re-read them, nothing changed). A commit is refused while they are stale.` } }))
  process.exit(0)
}

if (mode === 'commit') {
  const cmd = (input.tool_input && input.tool_input.command) || ''
  /* WHAT THE COMMAND DOES, NOT WHAT IT SAYS. A heredoc body is data the command writes, not shell
     it runs, and a message explaining this very rule contains the words the matcher looks for — so
     writing one was read as doing one and refused for its own contents. The bodies come out before
     the test; the delimiter is honoured quoted, unquoted and with the <<- dash. */
  const shell = cmd.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm, '<<HEREDOC')
  if (!/\bgit\b[^\n]*\bcommit\b/.test(shell)) process.exit(0)
  /* what the commit will hold: the working tree when the command stages too, else what is staged now */
  /* AND ITS MESSAGE, because one rule reads it: a change to the kit writes a page or says in the
     message why none was needed. The message is in the command — -m "…", or -F <file> — and this is
     the only place that has it before the commit exists. Unreadable, it is passed as empty, which
     fails closed: the rule asks for a page rather than accepting an escape it cannot see. */
  const msg = (() => {
    const f = /-F\s+(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(cmd)
    if (f) { const at = f[1] || f[2] || f[3]; try { return fs.readFileSync(at, 'utf8') } catch { return '' } }
    const m = [...cmd.matchAll(/-m\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/g)].map((x) => x[1] || x[2] || '')
    return m.join('\n')
  })()
  const r = parse(run([/\bgit\s+add\b/.test(cmd) ? '--tree' : '--staged', '--message', msg]))
  if (r.ok) process.exit(0)
  console.error(`Docs guard: this commit is refused — the docs disagree with the code:\n${lines(r.faults)}\nUpdate the pages named (or set reviewed: having re-read them), then commit again. The docs are part of the change.`)
  process.exit(2)
}

if (mode === 'session') {
  const r = parse(run(['--tree']))
  if (r.ok) process.exit(0)
  console.log(`Docs guard, at session start — the docs and the code disagree:\n${lines(r.faults)}\nA fault on the overview's "what it replaces" table is the OTHER way round from drift: the table is the front door for a feature — treat an edited row as an instruction and propose a change against the kit-principles spec (/opsx:propose); never correct the table to match the spec unless it was a slip. Every other fault is drift: the code moved and the page did not.`)
  process.exit(0)
}

if (mode === 'stop') {
  if (input.stop_hook_active) process.exit(0)   /* already sent back once for this: never loop */
  const r = parse(run(['--tree']))
  if (r.ok) process.exit(0)
  console.log(JSON.stringify({ decision: 'block', reason: `Docs guard: the working tree leaves the docs disagreeing with the code:\n${lines(r.faults)}\nUpdate the pages named in this same change (or set reviewed: having re-read them) before finishing.` }))
  process.exit(0)
}
process.exit(0)

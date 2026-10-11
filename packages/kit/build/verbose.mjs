/*
 * HOW MUCH A RUN SAYS.
 *
 * A deploy's log is the only diagnostic a deploy box has, and it is worth nothing when it is too
 * long to be kept. Render drops a burst rather than truncating it tidily, and the plan — a
 * declaration of three hundred functions, most of them re-emitted because their bodies were
 * reformatted when the migrations became a declaration — arrives as one burst of thousands of
 * lines. What went missing with it, on the one deploy where it mattered, was the failure: the log
 * ended in the middle of a function body and there was nothing after it to read.
 *
 * So a script here says WHAT HAPPENED and not how, unless it is asked. Quiet is not less honest,
 * and what quiet may never abbreviate is the part somebody has to act on: a refusal, a destructive
 * statement, an error, and the counts that say how much there was. What goes is the body of what
 * succeeded — which is, on a good deploy, all of it.
 *
 * Asked for by `PLATFORMKIT_VERBOSE=1` in the environment (a deploy box sets it for one release
 * when something has gone wrong) or `--verbose` on a command that takes one. A command a person
 * typed to SEE something — `platformkit migrate --plan` — is verbose by its own nature and does
 * not wait to be asked twice.
 */
export function verbose(env = process.env, argv = process.argv) {
  if (/^(1|true|yes|on)$/i.test(String(env.PLATFORMKIT_VERBOSE ?? ''))) return true
  if (/^(0|false|no|off)$/i.test(String(env.PLATFORMKIT_VERBOSE ?? ''))) return false
  return argv.slice(2).includes('--verbose')
}

/* the one read at import, for a script that has no reason to ask twice */
export const VERBOSE = verbose()

/*
 * A LIST IN A LOG HAS A LENGTH. Ten lines of a hundred is a sample somebody can read; a hundred is
 * a burst that takes the lines after it with it. Verbose prints the lot, because that is what it
 * was asked for.
 */
export function some(lines, n = 8, verb = VERBOSE) {
  const l = lines.filter((x) => x != null && String(x).trim())
  if (verb || l.length <= n) return l
  return [...l.slice(0, n), `… and ${l.length - n} more (PLATFORMKIT_VERBOSE=1 for all of them)`]
}

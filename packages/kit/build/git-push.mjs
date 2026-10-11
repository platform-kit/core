/*
 * A file committed and pushed from a script — the registry of what a printer holds for us
 * (content/store/print.json), the spoken books' store — so what a build box learns lands in the
 * repository the moment it is learnt. A person's machine pushes with its own credentials; a build
 * box takes a token from the environment (`<PREFIX>_GITHUB_TOKEN`, else GITHUB_TOKEN / GH_TOKEN —
 * a fine-grained token with Contents: read and write on this repository) and reaches GitHub
 * through a one-off url carrying it: never in git config, never printed.
 *
 *   commitAndPush({ paths, message, mode, prefix })   mode: '1' commits and pushes, 'local' commits
 */
import { execFileSync } from 'node:child_process'

export function commitAndPush({ paths, message, mode, prefix = 'PRINT', cwd = process.cwd(), branch, name, email, log = console.log }) {
  mode = String(mode || '').trim().toLowerCase()
  if (!mode || mode === '0' || mode === 'false') return false
  const TOKEN = (process.env[prefix + '_GITHUB_TOKEN'] || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim()
  const blank = (s) => (TOKEN ? String(s).split(TOKEN).join('***') : String(s))
  const git = (args, quiet = false) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'pipe'] }).trim()
  let changed
  try { changed = git(['status', '--porcelain', '--', ...paths]) } catch (e) { log('not a git checkout, nothing committed: ' + blank(e.message)); return false }
  if (!changed) return false
  const ident = ['-c', 'user.name=' + (name || process.env[prefix + '_COMMIT_NAME'] || 'platformkit build'), '-c', 'user.email=' + (email || process.env[prefix + '_COMMIT_EMAIL'] || 'build@platformkit.local')]
  try { git(['add', '--', ...paths]); git([...ident, 'commit', '--quiet', '-m', message, '--', ...paths]); log(`committed ${paths.join(', ')}`) } catch (e) { log('commit failed: ' + blank(e.message || e)); return false }
  if (mode === 'local') return true
  const to = (() => {
    let url = 'origin'
    try { url = git(['remote', 'get-url', 'origin'], true) || 'origin' } catch { /* the name still works */ }
    if (!TOKEN) return 'origin'
    const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url)
    return m ? `https://x-access-token:${TOKEN}@github.com/${m[1]}.git` : 'origin'
  })()
  const br = branch || process.env[prefix + '_COMMIT_BRANCH'] || 'main'
  try { git(['push', to, 'HEAD:' + br]); log(`pushed to ${br}${TOKEN ? ' with the token from the environment' : ''}`) } catch (e) { log(`push to ${br} failed (${blank(e.message || e)}); the commit stays local`) }
  return true
}

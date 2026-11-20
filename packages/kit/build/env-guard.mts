/*
 * A SITE'S SECRETS NEVER REACH ITS REPOSITORY, whether or not the site has a .gitignore.
 *
 * A site's `.env` holds its payment, mail and API keys. A site repository is the site's own, and
 * nothing guarantees its .gitignore names `.env` — a new site, a hand-made one, or one whose
 * .gitignore was trimmed would commit every key with the first `git add .`. So the kit does not
 * rely on it, and does two things wherever it runs in a site:
 *
 *   1. It writes the rule into the clone's own `.git/info/exclude` — git's per-clone ignore file,
 *      which no .gitignore can override or forget. `git add .` and `git add -A` then pass over
 *      `.env` and `.env.*` (but `.env.example`, which is meant to be committed) in every clone the
 *      kit has run in.
 *   2. It refuses to run while such a file is TRACKED. An ignore rule cannot stop `git add -f`, so
 *      a file forced in, or committed before the rule existed, stops every command — build, test,
 *      deploy, dev — until it is taken out of git. A committed secret therefore never deploys.
 *
 * Outside a git repository there is nothing to guard, and nothing is done.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const MARK = '# platformkit: a site\'s secrets stay out of git (build/env-guard.mts)'
export const RULES = ['.env', '.env.*', '!.env.example']

const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' })

/* is this the name of a secrets file: .env or .env.<anything>, but not .env.example */
export const isSecretsFile = (file: string) => {
  const base = path.basename(file)
  return (base === '.env' || base.startsWith('.env.')) && base !== '.env.example'
}

/* writes the rule into the clone's exclude file once; answers whether the folder is in a git repository at all */
export function excludeSecrets(site: string): boolean {
  if (git(site, ['rev-parse', '--is-inside-work-tree']).stdout.trim() !== 'true') return false
  const rel = git(site, ['rev-parse', '--git-path', 'info/exclude']).stdout.trim()
  const file = path.resolve(site, rel)
  const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  if (!now.includes(MARK)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${now}${now && !now.endsWith('\n') ? '\n' : ''}${MARK}\n${RULES.join('\n')}\n`)
  }
  return true
}

/* the secrets files git tracks under this folder, as paths relative to it */
export function trackedSecrets(site: string): string[] {
  const r = git(site, ['ls-files', '-z', '--', '.'])
  if (r.status !== 0) return []
  return r.stdout.split('\0').filter(Boolean).filter(isSecretsFile)
}

/* both, and the message to stop on; null when the site is safe to run */
export function guardEnv(site: string): string | null {
  if (!excludeSecrets(site)) return null
  const tracked = trackedSecrets(site)
  if (!tracked.length) return null
  return `✖ ${tracked.join(', ')} ${tracked.length === 1 ? 'is' : 'are'} committed to this site's repository, and ${tracked.length === 1 ? 'it holds' : 'they hold'} the site's keys.\n` +
    `  Take ${tracked.length === 1 ? 'it' : 'them'} out of git (the file${tracked.length === 1 ? '' : 's'} stay${tracked.length === 1 ? 's' : ''} on disk):  git rm --cached ${tracked.map((f) => JSON.stringify(f)).join(' ')}\n` +
    `  If ${tracked.length === 1 ? 'it was' : 'they were'} ever pushed, rotate every key ${tracked.length === 1 ? 'it' : 'they'} held: removing a file does not remove it from history.`
}

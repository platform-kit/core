/*
 * A SITE'S .env STAYS OUT OF ITS REPOSITORY, with no .gitignore at all (build/env-guard.mts).
 *
 * Each case is a fresh git repository in a temporary folder with NO .gitignore, so whatever keeps
 * the file out is the kit's doing and nothing the site wrote.
 *
 *   node packages/kit/build/env-guard.test.mts
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { guardEnv, excludeSecrets, isSecretsFile } from './env-guard.mjs'

let n = 0, bad = 0
const t = (name: string, fn: () => void) => { n++; try { fn(); console.log('  ok  ', name) } catch (e: any) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 6).join('\n    ')) } }
const git = (cwd: string, ...a: string[]) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' })
const repo = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-env-guard-'))
  git(d, 'init', '-q')
  fs.writeFileSync(path.join(d, 'platformkit.config.js'), 'export default {}\n')
  fs.writeFileSync(path.join(d, '.env'), 'STRIPE_SECRET_KEY=sk_test_x\n')
  fs.writeFileSync(path.join(d, '.env.dev'), 'X=1\n')
  fs.writeFileSync(path.join(d, '.env.example'), 'STRIPE_SECRET_KEY=\n')
  return d
}
const staged = (d: string) => git(d, 'diff', '--cached', '--name-only').stdout.split('\n').filter(Boolean).sort()

console.log('\nA SITE\'S .env STAYS OUT OF ITS REPOSITORY\n')

t('which names are secrets files', () => {
  assert.deepEqual(['.env', '.env.dev', '.env.local', 'sub/.env', '.env.example', 'env.js', '.envrc'].map(isSecretsFile),
    [true, true, true, true, false, false, false])
})

t('with no .gitignore, git add -A passes over .env and .env.* and keeps .env.example', () => {
  const d = repo()
  assert.equal(guardEnv(d), null)
  git(d, 'add', '-A')
  assert.deepEqual(staged(d), ['.env.example', 'platformkit.config.js'])
})

t('the rule is written once, however often the kit runs', () => {
  const d = repo()
  excludeSecrets(d); excludeSecrets(d); guardEnv(d)
  const text = fs.readFileSync(path.join(d, '.git', 'info', 'exclude'), 'utf8')
  assert.equal(text.split('platformkit: a site').length - 1, 1)
})

t('a .env forced into git stops the kit, and names the way out', () => {
  const d = repo()
  guardEnv(d)
  git(d, 'add', '-f', '.env'); git(d, 'commit', '-qm', 'oops')
  const refused = guardEnv(d)
  assert.ok(refused && refused.includes('.env') && refused.includes('git rm --cached'), String(refused))
  git(d, 'rm', '-q', '--cached', '.env'); git(d, 'commit', '-qm', 'out')
  assert.equal(guardEnv(d), null)
  assert.ok(fs.existsSync(path.join(d, '.env')), 'the file itself stays on disk')
})

t('a folder outside git is left alone', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-env-guard-nogit-'))
  fs.writeFileSync(path.join(d, '.env'), 'X=1\n')
  assert.equal(guardEnv(d), null)
  assert.ok(!fs.existsSync(path.join(d, '.git')))
})

console.log(`\n${n - bad}/${n} passed\n`)
if (bad) process.exit(1)

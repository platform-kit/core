#!/usr/bin/env node
/*
 * Where cloud mode publishes to, declared rather than clicked: platformkit.config.js's
 * `cloud: { repo, branch }` written to supabase/functions/_shared/cloud.json, which the admin
 * function reads when it is asked where the pushes go.
 *
 * THREE STATES, AND THEY ARE DIFFERENT. A repository means git is in the cycle: a publish pushes a
 * commit and the commit rebuilds the site. `repo: false` means git is OUT of it, deliberately — a
 * database and a host and nothing else. Nothing declared means neither has been decided, and the
 * admin asks for a repository, which is how it has always been.
 *
 * The third is configuration rather than something inferred from whether a token happens to be set,
 * because the case that has to be safe is a token that WAS set and is now gone: infer it and the
 * moment somebody clears a bad token the export decides the repository is out of the cycle — or,
 * worse, that it is in it and every file is missing, which is how content gets deleted.
 *
 * The repository and the branch are CONFIGURATION — a fresh deployment from the folder should
 * already know where it publishes, and a setting somebody has to re-type after every deploy is a
 * setting in the wrong place. The token is not: a token is a secret, it stays in app_settings, and
 * nothing here ever reads or writes one.
 *
 *   node build/cloud-config.mjs          # write cloud.json
 *   node build/cloud-config.mjs --check  # check only (platformkit test)
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { loadSite } from './site.mjs'

const ROOT = process.cwd()
const OUT = 'supabase/functions/_shared/cloud.json'
const check = process.argv.includes('--check')
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const BRANCH = /^[A-Za-z0-9._\/-]{1,120}$/

export async function cloudConfig({ check: only = false } = {}) {
  const site = await loadSite(ROOT)
  const c = site.cloud || {}
  const faults = []
  /* `repo: false` is the declaration that there is no repository; anything else is a name or nothing */
  const off = c.repo === false
  const repo = off ? '' : String(c.repo || '').trim()
  const branch = String(c.branch || '').trim() || 'main'
  if (repo && !REPO.test(repo)) faults.push(`cloud.repo "${repo}" is not owner/name`)
  if (off && c.branch) faults.push('cloud.branch says where to push, and cloud.repo is false — remove one')
  if (!BRANCH.test(branch)) faults.push(`cloud.branch "${branch}" is not a branch name`)
  if (faults.length) { console.error('✖ cloud:\n  ' + faults.join('\n  ')); process.exitCode = 1; return null }

  const out = { repo, branch, declared: !!repo, off }
  const text = JSON.stringify(out, null, 2) + '\n'
  const path = join(ROOT, OUT)
  if (only) {
    const had = existsSync(path) ? readFileSync(path, 'utf8') : ''
    if (had !== text) { console.error(`✖ cloud: ${OUT} is not what platformkit.config.js says — run node build/cloud-config.mjs`); process.exitCode = 1; return null }
    console.log(`✔ cloud: ${repo ? repo + '#' + branch : off ? 'no repository — git is out of the cycle' : 'no repository declared — the admin asks for one'}`)
    return out
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  console.log(`${OUT} ← ${repo ? repo + '#' + branch : off ? 'no repository (git out of the cycle)' : 'nothing declared'}`)
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) await cloudConfig({ check })

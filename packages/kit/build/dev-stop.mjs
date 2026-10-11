#!/usr/bin/env node
/* `platformkit stop`: everything this checkout's dev runs started, live or not — the runs, their
   sites' servers, their stacks and the front door. Whose a process is, and how it is stopped, is
   dev-owner.mjs, which a starting run uses too to take over from one that ended without cleaning up. */
import fs from 'node:fs'
import path from 'node:path'
import { sites, workspaceRoot } from './sites.mjs'
import { composeName, readRuns, stopCompose, stopPortRecords, stopRun, stopSupabase } from './dev-owner.mjs'
import { platformkitRuntimePath } from './runtime-paths.mjs'

const root = workspaceRoot(process.cwd())
const stateDir = platformkitRuntimePath(root, 'dev')
const runsDir = path.join(stateDir, 'runs')
let failures = 0
const report = {
  log: (message) => console.log(message),
  out: (text) => process.stdout.write(text),
  warn: (message) => console.error(message),
  error: (message) => { console.error(message); failures++ },
}

/* each refusal is reported (and counted) where it happens */
async function stopLegacyStacks() {
  const managed = []
  for (const site of sites(root)) {
    if (fs.existsSync(path.join(site.directory, 'supabase', 'config.toml'))) managed.push(site.directory)
  }
  if (fs.existsSync(path.join(root, 'supabase', 'config.toml'))) managed.push(root)
  if (fs.existsSync(stateDir)) {
    for (const name of fs.readdirSync(stateDir)) {
      if (!name.startsWith('workspace-') && name !== 'single') continue
      const base = path.join(stateDir, name)
      if (name === 'single') {
        for (const site of fs.readdirSync(base)) managed.push(path.join(base, site))
      } else {
        for (const site of fs.readdirSync(base)) managed.push(path.join(base, site))
      }
    }
  }
  for (const workdir of new Set(managed)) {
    if (!fs.existsSync(path.join(workdir, 'supabase', 'config.toml'))) continue
    stopSupabase(root, workdir, report)
  }
}

for (const run of readRuns(root, report)) await stopRun(root, run, report)
await stopPortRecords(root, report)
await stopLegacyStacks()
stopCompose(root, composeName(root), report)

if (!fs.existsSync(runsDir) || fs.readdirSync(runsDir).length === 0) {
  console.log(failures ? 'Dev cleanup finished with errors.' : 'No active managed dev process records remain.')
}
process.exitCode = failures ? 1 : 0

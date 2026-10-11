/*
 * WHOSE IS THIS PROCESS? — the one place the dev tooling decides whether a server, a run or a
 * container belongs to THIS checkout's dev runs, and the one way they are stopped.
 *
 * Two callers ask. `platformkit stop` (dev-stop.mjs) stops everything this checkout's dev runs
 * started, live or not. A starting `npm run dev` (dev.mjs, dev-workspace.mjs) takes over from a run
 * that ended without cleaning up — a closed terminal, a kill — and stops only what such a run left;
 * a run that is still alive is left alone, and the existing port guard refuses a second.
 *
 * Nothing is signalled that cannot be proved ours: a process is a run when it is the pid its record
 * names and started when the record says (or, for an older record, its environment carries the
 * run's id), and a server is a run's when it is a
 * Vite whose working directory is the site's and whose ancestors are a dev.mjs in that site. A port
 * held by anything else — another project, an editor's forward — is reported and never touched.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { sites } from './sites.mjs'
import { processStart, stopStack } from './dev-runtime.mjs'
import { platformkitRuntimePath } from './runtime-paths.mjs'

export function processCommand(pid) {
  try {
    return execFileSync('ps', ['eww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

export function processCwd(pid) {
  try {
    const output = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return output.split('\n').find((line) => line.startsWith('n'))?.slice(1) || ''
  } catch {
    return ''
  }
}

export function parentPid(pid) {
  const result = spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' })
  return result.status === 0 ? Number(result.stdout.trim()) : 0
}

export function alive(pid) {
  try { process.kill(pid, 0); return true }
  catch (error) { return error.code === 'EPERM' }
}

/* the pids listening on a port; null when the port could not be inspected */
export function listeningPids(port, report) {
  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
  if (result.error) {
    report.error(`Cannot inspect legacy dev port ${port}: ${result.error.message}`)
    return null
  }
  if (result.status === 1) return []
  if (result.status !== 0) {
    report.error(`Cannot inspect legacy dev port ${port}${result.stderr ? `: ${result.stderr.trim()}` : ''}`)
    return null
  }
  return [...new Set(result.stdout.trim().split('\n').map(Number).filter(Number.isInteger))]
}

/* the pid and its ancestors, nearest first, as far as eight levels */
function ancestry(pid) {
  const chain = []
  let current = pid
  for (let depth = 0; depth < 8 && current > 1; depth++) { chain.push(current); current = parentPid(current) }
  return chain
}

export function managedDevAncestor(pid, siteDirectory) {
  for (const current of ancestry(pid)) {
    if (processCommand(current).includes('packages/kit/build/dev.mjs') && path.resolve(processCwd(current)) === path.resolve(siteDirectory)) return current
  }
  return 0
}

export function waitForExit(pid, timeout = 8000) {
  const until = Date.now() + timeout
  return new Promise((resolve) => {
    const check = () => {
      if (!alive(pid)) return resolve(true)
      if (Date.now() >= until) return resolve(false)
      setTimeout(check, 100)
    }
    check()
  })
}

export const composeName = (root) => `platformkit-dev-${createHash('sha256').update(root).digest('hex').slice(0, 10)}`

/* is the checkout's front door up? the published port, or '' when it is not */
export function composeRunning(root, projectName) {
  if (!fs.existsSync(path.join(root, 'deploy', 'nginx', 'docker-compose.yml'))) return null
  const result = spawnSync('docker', ['ps', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.Ports}}'], { encoding: 'utf8' })
  if (result.status !== 0 || !result.stdout.trim()) return null
  return (result.stdout.match(/:(\d+)->/) || [])[1] || ''
}

export function stopCompose(root, projectName, report) {
  const composeFile = path.join(root, 'deploy', 'nginx', 'docker-compose.yml')
  if (!fs.existsSync(composeFile)) return true
  const result = spawnSync('docker', ['compose', '-f', composeFile, '--project-name', projectName, '--profile', 'dev', 'down', '--remove-orphans'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.status === 0) { report.log(`Stopped front door ${projectName} (containers removed; volumes preserved)`); return true }
  if (result.error?.code === 'ENOENT') return true
  report.error(`Could not stop front door ${projectName}${result.stderr ? `: ${result.stderr.trim()}` : ''}`)
  return false
}

export function stopSupabase(root, workdir, report) {
  if (!fs.existsSync(path.join(workdir, 'supabase', 'config.toml'))) return true
  const result = stopStack(workdir, root)
  if (result.status === 0) {
    report.out(result.stdout || '')
    report.log(`Stopped Supabase project in ${path.relative(root, workdir) || '.'}`)
    return true
  }
  report.error(`Could not stop Supabase project in ${workdir}${result.stderr ? `: ${result.stderr.trim()}` : ''}`)
  return false
}

/* the records of this checkout's runs; an unreadable or foreign one is reported and skipped */
export function readRuns(root, report) {
  const runsDir = platformkitRuntimePath(root, 'dev', 'runs')
  if (!fs.existsSync(runsDir)) return []
  const runs = []
  for (const filename of fs.readdirSync(runsDir).filter((name) => name.endsWith('.json'))) {
    const file = path.join(runsDir, filename)
    let record
    try { record = JSON.parse(fs.readFileSync(file, 'utf8')) }
    catch (error) { report.error(`Ignoring unreadable dev-run record ${file}: ${error.message}`); continue }
    if (record.root !== root || !Number.isInteger(record.pid) || typeof record.runId !== 'string') {
      report.error(`Ignoring invalid or foreign dev-run record ${file}`)
      continue
    }
    runs.push({ file, record })
  }
  return runs
}

/*
 * A RUN'S STATE. `live` — its process is alive, is the run (the same pid started at the moment its
 * record says; a record from before that was kept, by its environment carrying the run's id)
 * and still has whoever started it. `abandoned` — alive and the run, but re-parented to init: the
 * terminal or the npm that started it is gone, and nobody can stop it with Ctrl+C any more. `gone`
 * — its process has exited. `reused` — the pid now belongs to something else, never signalled.
 */
export function runState(record) {
  if (!alive(record.pid)) return 'gone'
  const same = record.started
    ? processStart(record.pid) === record.started
    : processCommand(record.pid).includes(`PLATFORMKIT_DEV_RUN_ID=${record.runId}`)
  if (!same) return 'reused'
  return parentPid(record.pid) === 1 ? 'abandoned' : 'live'
}

/*
 * A RUN'S SITE SERVERS. A workspace run starts one dev.mjs per site with its own id in the child's
 * environment (PLATFORMKIT_DEV_PARENT_RUN_ID), which `ps` shows. When the run is gone they stop
 * themselves — and stopping takes a while, since each stops its Supabase stack — so whoever takes
 * over must let them finish before touching the same stacks and folders, or it starts a stack one
 * of them is still stopping.
 */
export function runChildren(runId) {
  let listing = ''
  try { listing = execFileSync('ps', ['axeww', '-o', 'pid=,command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }) }
  catch { return [] }
  return listing.split('\n')
    /* the site servers themselves (started with --single), never what they started in turn — a
       `supabase stop` inherits the id too, and must not be interrupted */
    .filter((line) => /\s--single(\s|$)/.test(line) && line.includes(`PLATFORMKIT_DEV_PARENT_RUN_ID=${runId}`))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
    .filter((pid) => Number.isInteger(pid) && pid !== process.pid)
}

/* signal them (a server already stopping ignores a second signal) and wait for each to finish */
export async function stopChildren(runId, report, { patience = 120000 } = {}) {
  const pids = runChildren(runId)
  if (!pids.length) return 0
  report.log(`Waiting for ${pids.length} server(s) of an earlier run to finish stopping`)
  for (const pid of pids) try { process.kill(pid, 'SIGTERM') } catch { /* gone */ }
  for (const pid of pids) {
    if (await waitForExit(pid, patience)) continue
    report.error(`An earlier run's server (PID ${pid}) did not finish stopping; stopping it outright`)
    try { process.kill(pid, 'SIGKILL') } catch { /* gone */ }
    await waitForExit(pid, 5000)
  }
  return pids.length
}

/* stop a run's own process (when it is the run) and everything its record names */
export async function stopRun(root, { file, record }, report, { signal = true } = {}) {
  let ok = true
  const state = runState(record)
  if (state === 'live' || state === 'abandoned') {
    if (!signal) return false
    report.log(`Stopping PlatformKit ${record.kind || 'dev'} run (PID ${record.pid})`)
    try { process.kill(record.pid, 'SIGTERM') }
    catch (error) { if (error.code !== 'ESRCH') { report.error(`Could not signal PID ${record.pid}: ${error.message}`); return false } }
    if (!await waitForExit(record.pid)) {
      report.error(`Managed dev run PID ${record.pid} did not stop; leaving its record for a safe retry`)
      return false
    }
  } else if (state === 'reused') {
    report.warn(`PID ${record.pid} no longer matches its recorded run; not signaling it`)
  }
  /* the run's site servers finish stopping before their stacks and folders are touched */
  await stopChildren(record.runId, report)
  for (const workdir of record.supabaseWorkdirs || []) {
    if (!path.resolve(workdir).startsWith(platformkitRuntimePath(root, 'dev') + path.sep)) {
      report.error(`Ignoring Supabase workdir outside managed dev state: ${workdir}`)
      ok = false
      continue
    }
    if (!stopSupabase(root, workdir, report)) ok = false
  }
  if (record.composeProjectName && !stopCompose(root, record.composeProjectName, report)) ok = false
  if (record.runtimeBase && path.resolve(record.runtimeBase).startsWith(platformkitRuntimePath(root, 'dev', 'workspace-'))) {
    fs.rmSync(record.runtimeBase, { recursive: true, force: true })
  }
  fs.rmSync(file, { force: true })
  return ok
}

/*
 * THE SERVERS A PORT FILE NAMES. Each `<site>.port` is a Vite a run started; one still answering
 * is stopped when it is provably that site's Vite (its working directory, its command) — through
 * its dev.mjs when it has one, so the run's own cleanup runs — unless `keep(pid)` says a living run
 * owns it. Returns what was stopped, as "<site> (<port>)".
 */
export async function stopPortRecords(root, report, { keep = () => false } = {}) {
  const stateDir = platformkitRuntimePath(root, 'dev')
  const stopped = []
  if (!fs.existsSync(stateDir)) return stopped
  const knownSites = sites(root)
  for (const filename of fs.readdirSync(stateDir).filter((name) => name.endsWith('.port'))) {
    const file = path.join(stateDir, filename)
    const port = Number(fs.readFileSync(file, 'utf8').trim())
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      report.error(`Ignoring invalid legacy dev port record ${file}`)
      continue
    }
    const siteName = filename.slice(0, -'.port'.length)
    const siteDirectory = knownSites.find((site) => site.name === siteName)?.directory
      || (siteName === process.env.PLATFORMKIT_ROOT_SITE ? root : path.join(root, 'sites', siteName))
    const pids = listeningPids(port, report)
    if (!pids) continue
    if (pids.some((pid) => ancestry(pid).some(keep))) continue
    let safeToRemove = pids.length === 0
    let signalled = false
    for (const pid of pids) {
      const cwd = processCwd(pid)
      const command = processCommand(pid)
      if (path.resolve(cwd || '.') !== path.resolve(siteDirectory) || !/\bvite\b/i.test(command)) {
        report.error(`Port ${port} is held by PID ${pid}, but it is not a verifiable PlatformKit Vite process; not signaling it`)
        continue
      }
      const owner = managedDevAncestor(pid, siteDirectory)
      const target = owner || pid
      report.log(`Stopping legacy PlatformKit dev process (PID ${target}, port ${port})`)
      signalled = true
      try { process.kill(target, 'SIGTERM') }
      catch (error) { if (error.code !== 'ESRCH') { report.error(`Could not signal PID ${target}: ${error.message}`); continue } }
      if (!await waitForExit(target)) {
        report.error(`Legacy dev process PID ${target} did not stop; leaving its port record for a safe retry`)
        continue
      }
      const remaining = listeningPids(port, report)
      if (remaining?.length) {
        for (const listener of remaining) {
          if (listener === target) continue
          if (path.resolve(processCwd(listener) || '.') !== path.resolve(siteDirectory) || !/\bvite\b/i.test(processCommand(listener))) {
            report.error(`Port ${port} is now held by unrelated PID ${listener}; not signaling it`)
            continue
          }
          try { process.kill(listener, 'SIGTERM') }
          catch (error) { if (error.code !== 'ESRCH') report.error(`Could not signal PID ${listener}: ${error.message}`) }
          if (!await waitForExit(listener)) report.error(`Legacy dev process PID ${listener} did not stop`)
        }
        safeToRemove = !(listeningPids(port, report) || []).length
      } else safeToRemove = true
    }
    if (safeToRemove && signalled) stopped.push(`${siteName} (${port})`)
    if (safeToRemove) fs.rmSync(file, { force: true })
  }
  return stopped
}

/*
 * TAKING OVER, before a run starts: whatever a gone or abandoned run of this checkout left — its
 * own process, its sites' servers, its stacks, its front door — is stopped; a living run and
 * everything under it is left alone (the port guard then refuses a second, as it always has).
 * Returns what was stopped, for one line, and the living runs.
 */
export async function takeOver(root, report) {
  /* only the wait is said while it happens — it can take a minute — and the rest in one line after */
  const quiet = { log: (message) => { if (message.startsWith('Waiting for')) report.say?.(message) }, out() {}, warn() {}, error: report.error }
  const stopped = []
  const live = []
  for (const run of readRuns(root, quiet)) {
    if (run.record.pid === process.pid) continue
    const state = runState(run.record)
    if (state === 'live') { live.push(run.record); continue }
    if (await stopRun(root, run, quiet)) stopped.push(state === 'abandoned' ? `an abandoned ${run.record.kind || 'dev'} run (PID ${run.record.pid})` : `what a ${run.record.kind || 'dev'} run left`)
  }
  const livePids = new Set(live.map((record) => record.pid))
  stopped.push(...await stopPortRecords(root, quiet, { keep: (pid) => livePids.has(pid) }))
  /* the front door is named from the checkout, so it is this checkout's; up with no living
     workspace run to own it, it is a leftover */
  if (!live.some((record) => record.kind === 'workspace')) {
    const name = composeName(root)
    const port = composeRunning(root, name)
    if (port !== null && stopCompose(root, name, quiet)) stopped.push(`the front door${port ? ` (${port})` : ''}`)
  }
  return { stopped, live }
}

export const takeOverLine = (stopped) => `Stopped what an earlier dev run left behind: ${stopped.join(', ')}.`

/*
 * A RUN'S CHILD WATCHES ITS RUN. Whoever started this process is its parent; when that parent goes
 * — a kill no handler can catch, a crash — the process is re-parented and `process.ppid` changes.
 * Checked every two seconds, so a dead run's servers outlive it by that at most. `parentPid` is the
 * pid the run said it has (PLATFORMKIT_DEV_PARENT_PID), so a child started after its run already died
 * stops at once rather than watching init. Nothing more is asked of the parent: a process's ppid
 * equals a pid only while that process lives, and a run's id is not in its own environment as `ps`
 * shows it (it is set after the run starts), so checking for it stopped every site two seconds in.
 */
export function watchParent(onGone, every = 2000, { parentPid = process.ppid } = {}) {
  const expectedPid = Number.isInteger(parentPid) && parentPid > 1 ? parentPid : process.ppid
  const timer = setInterval(() => {
    if (process.ppid !== expectedPid) { clearInterval(timer); onGone() }
  }, every)
  timer.unref()
  return () => clearInterval(timer)
}

import fs from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { platformkitRuntimePath } from './runtime-paths.mjs'

export function stableProjectId(siteConfig, siteSlug) {
  const projectId = siteConfig?.dev?.projectId || `pk_${siteSlug.replaceAll('-', '_')}_local`
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(projectId)) {
    throw new Error(`dev.projectId must be 1–63 lowercase letters, digits, underscores, or hyphens: ${projectId}`)
  }
  return projectId
}

export function createRunRecord(root, details) {
  const runId = randomBytes(16).toString('hex')
  const directory = platformkitRuntimePath(root, 'dev', 'runs')
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, `${process.pid}.json`)
  /* the pid and when it started name the process: a pid alone can be reused by something else */
  const record = { ...details, pid: process.pid, started: processStart(process.pid), runId, root: path.resolve(root) }
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  return {
    runId,
    update(next) {
      const current = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (current.runId === runId) fs.writeFileSync(file, JSON.stringify({ ...current, ...next }, null, 2) + '\n')
    },
    remove() {
      try {
        const current = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (current.runId === runId) fs.rmSync(file, { force: true })
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    },
  }
}

export function copyRuntimeSupabaseProject({ source, runtimeRoot, projectId }) {
  const sourceSupabase = path.join(source, 'supabase')
  const configPath = path.join(sourceSupabase, 'config.toml')
  if (!fs.existsSync(configPath)) throw new Error(`site has no supabase/config.toml: ${source}`)
  const runtimeSupabase = path.join(runtimeRoot, 'supabase')
  const runtimeConfig = path.join(runtimeSupabase, 'config.toml')
  const config = fs.readFileSync(configPath, 'utf8')
  const matches = config.match(/^project_id\s*=\s*"[^"]*"\s*$/gm) || []
  if (matches.length !== 1) throw new Error('Supabase config must declare exactly one project_id')
  if (fs.existsSync(runtimeConfig)) {
    fs.writeFileSync(runtimeConfig, fs.readFileSync(runtimeConfig, 'utf8').replace(
      /^project_id\s*=\s*"[^"]*"\s*$/m,
      `project_id = "${projectId}"`,
    ))
    return runtimeRoot
  }
  fs.mkdirSync(runtimeSupabase, { recursive: true })
  for (const entry of fs.readdirSync(sourceSupabase, { withFileTypes: true })) {
    if (entry.name === 'config.toml') continue
    const sourcePath = path.join(sourceSupabase, entry.name)
    const targetPath = path.join(runtimeSupabase, entry.name)
    if (entry.name === 'functions') fs.symlinkSync(sourcePath, targetPath, 'dir')
    else fs.cpSync(sourcePath, targetPath, { recursive: true, dereference: true })
  }
  fs.writeFileSync(path.join(runtimeSupabase, 'config.toml'), config.replace(
    /^project_id\s*=\s*"[^"]*"\s*$/m,
    `project_id = "${projectId}"`,
  ))
  return runtimeRoot
}

/*
 * A SERVER AND EVERYTHING IT STARTS, AS ONE. Vite and the function server are started through
 * `npx`, which starts the real process as its own child; a signal to npx alone left the real one
 * listening. So each is started in a process group of its own and the group is signalled.
 */
export function spawnGroup(command, args, options = {}) {
  return spawn(command, args, { ...options, detached: process.platform !== 'win32' })
}

export function signalGroup(child, signal = 'SIGTERM') {
  if (process.platform !== 'win32' && child.pid) {
    try { process.kill(-child.pid, signal); return }
    catch (error) { if (error.code !== 'ESRCH') throw error; return }
  }
  try { child.kill(signal) } catch { /* gone */ }
}

/* when a process started, as ps says it — with the pid, what identifies it */
export function processStart(pid) {
  const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

/*
 * STOPPING A STACK WITHOUT HANGING. The Supabase CLI does not fail when the stream its output goes
 * to has nobody reading it — a dev run whose terminal closed, or whose parent was killed — it spins
 * at full CPU and never finishes (seen holding two cores for half an hour). So its output is always
 * captured here, never handed the run's own streams, and it is given two minutes at most; the
 * caller prints what it said if it still has somewhere to print.
 */
export function stopStack(workdir, cwd = process.cwd()) {
  return spawnSync('npx', ['supabase', 'stop', ...(workdir ? ['--workdir', workdir] : [])], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
    killSignal: 'SIGKILL',
  })
}

/* a run whose reader has gone must not die of it: a write to a closed stream is dropped */
export function quietOnClosedStreams() {
  for (const stream of [process.stdout, process.stderr]) stream.on('error', () => {})
}

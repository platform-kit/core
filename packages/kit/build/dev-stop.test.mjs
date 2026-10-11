import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'platformkit-stop-')))
const stopScript = fileURLToPath(new URL('./dev-stop.mjs', import.meta.url))
const runs = path.join(fixture, 'node_modules', '.cache', 'platformkit', 'dev', 'runs')
const siteDir = path.join(fixture, 'sites', 'alpha')
fs.mkdirSync(siteDir, { recursive: true })
fs.mkdirSync(path.join(fixture, 'packages', 'kit'), { recursive: true })
fs.mkdirSync(runs, { recursive: true })
const runStop = () => new Promise((resolve, reject) => {
  const runner = spawn(process.execPath, [stopScript], { cwd: fixture, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  runner.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  runner.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  runner.once('error', reject)
  runner.once('exit', (status) => resolve({ status, stdout, stderr }))
})

try {
  const token = 'owned-run-token-for-test'
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    env: { ...process.env, PLATFORMKIT_DEV_RUN_ID: token },
    stdio: 'ignore',
  })
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  const childExit = new Promise((resolve) => child.once('exit', resolve))
  fs.writeFileSync(path.join(runs, `${child.pid}.json`), JSON.stringify({
    root: fixture,
    pid: child.pid,
    runId: token,
    kind: 'test',
    supabaseWorkdirs: [],
  }))
  const stopped = await runStop()
  assert.equal(stopped.status, 0, stopped.stderr)
  assert.match(stopped.stdout, new RegExp(`Stopping PlatformKit test run \\(PID ${child.pid}\\)`))
  await childExit

  const legacyEntry = path.join(siteDir, 'vite.mjs')
  fs.writeFileSync(legacyEntry, "import http from 'node:http'; const server = http.createServer(); server.listen(0, '127.0.0.1', () => console.log(server.address().port))\n")
  const legacy = spawn(process.execPath, [legacyEntry], { cwd: siteDir, stdio: ['ignore', 'pipe', 'ignore'] })
  let output = ''
  legacy.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk })
  const legacyReady = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('legacy Vite fixture did not listen')), 5000)
    legacy.stdout.on('data', () => {
      const port = Number(output.trim().split('\n').at(-1))
      if (port) { clearTimeout(timeout); resolve(port) }
    })
    legacy.once('error', reject)
  })
  const legacyExit = new Promise((resolve) => legacy.once('exit', resolve))
  fs.writeFileSync(path.join(fixture, 'node_modules', '.cache', 'platformkit', 'dev', 'alpha.port'), `${legacyReady}\n`)
  const legacyStop = await runStop()
  assert.equal(legacyStop.status, 0, legacyStop.stderr)
  assert.match(legacyStop.stdout, new RegExp(`legacy PlatformKit dev process .*port ${legacyReady}`))
  await legacyExit

  fs.writeFileSync(path.join(runs, `${process.pid}.json`), JSON.stringify({
    root: fixture,
    pid: process.pid,
    runId: 'not-this-process',
    kind: 'unrelated',
    supabaseWorkdirs: [],
  }))
  const unrelated = await runStop()
  assert.equal(unrelated.status, 0, unrelated.stderr)
  assert.match(unrelated.stderr, new RegExp(`PID ${process.pid} no longer matches`))
  assert.doesNotThrow(() => process.kill(process.pid, 0), 'a reused or unrelated PID is never signaled')
  console.log('dev-stop: 2 passed')
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}

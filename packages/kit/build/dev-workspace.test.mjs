import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { prepareRuntimeProject, runtimeSupabaseConfig, runWorkspace } from './dev-workspace.mjs'
import { signalGroup, spawnGroup, stableProjectId } from './dev-runtime.mjs'
import { takeOver } from './dev-owner.mjs'

const note = (message) => console.log(`dev-workspace: ${message}`)
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'platformkit-dev-workspace-'))
let pass = 0
const git = (cwd, args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `${args.join(' ')} failed:\n${result.stderr}`)
  return result.stdout.trim()
}

async function test(name, run) {
  await run()
  pass++
  note(`✓ ${name}`)
}

const sourceConfig = `project_id = "source"

[api]
port = 54321

[db]
port = 54322
shadow_port = 54320

[db.pooler]
port = 54329

[studio]
port = 54323

[local_smtp]
port = 54324

[analytics]
port = 54327

[edge_runtime]
inspector_port = 8083

[auth]
site_url = "http://localhost:5173"
additional_redirect_urls = ["http://localhost:*", "http://*.localhost:*"]
`

try {
  await test('stable Supabase project IDs default to site slugs and allow exact configured overrides', () => {
    assert.equal(stableProjectId({}, 'example-site'), 'pk_example_site_local')
    assert.equal(stableProjectId({}, 'my-site'), 'pk_my_site_local')
    assert.equal(stableProjectId({ dev: { projectId: 'pk_custom_local' } }, 'example-site'), 'pk_custom_local')
    assert.notEqual(stableProjectId({}, 'alpha'), stableProjectId({}, 'beta'))
    assert.throws(() => stableProjectId({ dev: { projectId: 'Not Valid' } }, 'example-site'), /dev\.projectId/)
  })

  await test('runtime Supabase configs isolate projects and allocate every host service port', async () => {
    const source = path.join(fixture, 'source')
    fs.mkdirSync(path.join(source, 'supabase', 'functions'), { recursive: true })
    fs.mkdirSync(path.join(source, 'supabase', 'schemas'), { recursive: true })
    fs.writeFileSync(path.join(source, 'supabase', 'config.toml'), sourceConfig)
    fs.mkdirSync(path.join(source, 'supabase', 'templates'), { recursive: true })
    fs.writeFileSync(path.join(source, 'supabase', 'templates', 'magic-link.html'), '<a>sign in</a>')
    fs.writeFileSync(path.join(source, 'supabase', 'data.sql'), 'select 1;')
    const reserved = new Set()
    const first = await prepareRuntimeProject({
      source, runtimeRoot: path.join(fixture, 'runtime-one'), siteName: 'alpha',
      projectId: 'pk-alpha-test1', domain: 'localhost', frontDoorPort: 8080, reservedPorts: reserved,
    })
    const second = await prepareRuntimeProject({
      source, runtimeRoot: path.join(fixture, 'runtime-two'), siteName: 'beta',
      projectId: 'pk-beta-test2', domain: 'localhost', frontDoorPort: 8080, reservedPorts: reserved,
    })
    assert.equal(first.ports.length, 8)
    assert.equal(second.ports.length, 8)
    assert.equal(new Set([...first.ports, ...second.ports]).size, 16, 'service ports do not collide between stacks')
    assert.equal(fs.readFileSync(path.join(source, 'supabase', 'config.toml'), 'utf8'), sourceConfig, 'the committed config stays unchanged')
    for (const [runtime, expectedId, name] of [[first, 'pk-alpha-test1', 'alpha'], [second, 'pk-beta-test2', 'beta']]) {
      const config = fs.readFileSync(path.join(runtime.runtimeRoot, 'supabase', 'config.toml'), 'utf8')
      assert.match(config, new RegExp(`project_id = "${expectedId}"`))
      const auth = config.split('[auth]')[1].split('\n[')[0]
      const origin = `http://${name}.localhost:8080`
      assert.match(auth, new RegExp(`site_url = "${origin.replaceAll('.', '\\.')}"`))
      const redirects = JSON.parse(auth.match(/additional_redirect_urls = (\[[^\]]*\])/)[1])
      assert.ok(redirects.includes(origin), `${name} callback origin is explicitly allowed`)
      assert.ok(redirects.includes('http://*.localhost:*'), 'configured redirect patterns are preserved')
      const configuredPorts = [...config.matchAll(/^\s*(?:port|shadow_port|inspector_port)\s*=\s*(\d+)/gm)].map((match) => Number(match[1]))
      assert.deepEqual(configuredPorts, runtime.ports)
      assert.ok(fs.lstatSync(path.join(runtime.runtimeRoot, 'supabase', 'functions')).isSymbolicLink(), 'functions follow the source tree')
      assert.equal(fs.lstatSync(path.join(runtime.runtimeRoot, 'supabase', 'templates')).isSymbolicLink(), false, 'Supabase config path targets stay inside the runtime project')
      assert.equal(fs.readFileSync(path.join(runtime.runtimeRoot, 'supabase', 'templates', 'magic-link.html'), 'utf8'), '<a>sign in</a>')
      assert.equal(fs.readFileSync(path.join(runtime.runtimeRoot, 'supabase', 'data.sql'), 'utf8'), 'select 1;')
    }
  })

  await test('runtime config changes only service ports, project identity, and the auth return URL', () => {
    const ports = [20001, 20002, 20003, 20004, 20005, 20006, 20007, 20008]
    const config = runtimeSupabaseConfig(sourceConfig, {
      siteName: 'alpha', projectId: 'pk-alpha-test', domain: 'localhost', frontDoorPort: 8123, ports,
    })
    const origin = 'http://alpha.localhost:8123'
    assert.match(config, /site_url = "http:\/\/alpha\.localhost:8123"/)
    assert.ok(JSON.parse(config.match(/additional_redirect_urls = (\[[^\]]*\])/)[1]).includes(origin))
    assert.match(config, /project_id = "pk-alpha-test"/)
    assert.deepEqual([...config.matchAll(/^\s*(?:port|shadow_port|inspector_port)\s*=\s*(\d+)/gm)].map((match) => Number(match[1])), ports)
    const withoutRedirects = runtimeSupabaseConfig(sourceConfig.replace(/^additional_redirect_urls.*\n/m, ''), {
      siteName: 'alpha', projectId: 'pk-alpha-test', domain: 'localhost', frontDoorPort: 8123, ports,
    })
    assert.ok(JSON.parse(withoutRedirects.match(/additional_redirect_urls = (\[[^\]]*\])/)[1]).includes(origin))
    assert.throws(() => runtimeSupabaseConfig(sourceConfig, {
      siteName: 'bad_name', projectId: 'pk-bad', domain: 'localhost', frontDoorPort: 8123, ports,
    }), /invalid runtime Supabase site name/)
  })

  await test('workspace startup tells operators to fetch registered sites before attempting to start them', async () => {
    const root = path.join(fixture, 'unfetched-site-fixture')
    fs.mkdirSync(path.join(root, 'packages', 'kit'), { recursive: true })
    fs.mkdirSync(path.join(root, 'sites'), { recursive: true })
    fs.mkdirSync(path.join(root, 'sites', 'external'), { recursive: true })
    fs.writeFileSync(path.join(root, 'platformkit.sites.json'), JSON.stringify({
      version: 1,
      sites: [{ name: 'sample-site', remote: 'https://example.invalid/site.git', ref: 'a'.repeat(40) }],
    }))
    await assert.rejects(
      runWorkspace({ root, env: { PLATFORMKIT_DEFAULT_SITE: 'sample-site', PLATFORMKIT_ROOT_SITE: '', PLATFORMKIT_SITES: '' } }),
      /default site "sample-site" is registered but not fetched; run "platformkit sites fetch sample-site"/,
    )
  })

  if (process.argv[2] === '--workspace-worker') {
    await runWorkspaceWorker(process.argv[3])
  } else if (process.argv[2] === '--workspace-failure-worker') {
    await runWorkspaceFailureWorker(process.argv[3])
  } else if (process.argv[2] === '--held-worker') {
    await runHeldWorker(process.argv[3], process.argv[4])
  } else {
    await test('workspace startup routes synthetic sites and cleans up on shutdown', async () => {
      const root = path.join(fixture, 'sites-fixture')
      const selected = ['alpha', 'beta']
      fs.mkdirSync(path.join(root, 'packages', 'kit'), { recursive: true })
      fs.mkdirSync(path.join(root, 'sites'), { recursive: true })
      const registrations = []
      for (const name of selected) {
        const directory = path.join(root, 'sites', 'external', name)
        fs.mkdirSync(directory, { recursive: true })
        fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: `@fixture/${name}`, type: 'module' }))
        fs.writeFileSync(path.join(directory, 'platformkit.config.js'), `export default { name: '${name}', deployment: { backend: false } }\n`)
        git(directory, ['init', '-q'])
        git(directory, ['config', 'user.name', 'PlatformKit Test'])
        git(directory, ['config', 'user.email', 'platformkit-test@example.invalid'])
        git(directory, ['add', '.'])
        git(directory, ['commit', '-qm', `create ${name}`])
        registrations.push({ name, remote: `https://example.invalid/${name}.git`, ref: git(directory, ['rev-parse', 'HEAD']) })
      }
      fs.writeFileSync(path.join(root, 'platformkit.sites.json'), JSON.stringify({ version: 1, sites: registrations }))
      const worker = spawn(process.execPath, [fileURLToPath(import.meta.url), '--workspace-worker', root], { stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      worker.stdout.on('data', (chunk) => { output += chunk })
      worker.stderr.on('data', (chunk) => { output += chunk })
      const result = await new Promise((resolve) => worker.once('exit', (code, signal) => resolve({ code, signal })))
      assert.equal(result.code, 0, `${output}\nworker signal: ${result.signal}`)
      assert.match(output, /alpha\.localhost:/)
      assert.match(output, /beta\.localhost:/)
      const portDir = path.join(root, 'node_modules', '.cache', 'platformkit', 'dev')
      assert.deepEqual(fs.existsSync(portDir) ? fs.readdirSync(portDir).filter((name) => name.endsWith('.port')) : [], [])
      assert.deepEqual(fs.existsSync(portDir) ? fs.readdirSync(portDir).filter((name) => name.startsWith('workspace-')) : [], [])
    })

    await test('partial startup failure stops started children and removes runtime files', async () => {
      const root = path.join(fixture, 'sites-failure-fixture')
      for (const name of ['alpha', 'beta']) {
        const directory = path.join(root, 'sites', name)
        fs.mkdirSync(directory, { recursive: true })
        fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: `@fixture/${name}`, type: 'module' }))
        fs.writeFileSync(path.join(directory, 'platformkit.config.js'), `export default { name: '${name}', deployment: { backend: false } }\n`)
      }
      const worker = spawn(process.execPath, [fileURLToPath(import.meta.url), '--workspace-failure-worker', root], { stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      worker.stdout.on('data', (chunk) => { output += chunk })
      worker.stderr.on('data', (chunk) => { output += chunk })
      const result = await new Promise((resolve) => worker.once('exit', (code, signal) => resolve({ code, signal })))
      assert.equal(result.code, 1, `${output}\nworker signal: ${result.signal}`)
      assert.match(output, /beta dev server exited during startup/)
      const portDir = path.join(root, 'node_modules', '.cache', 'platformkit', 'dev')
      assert.deepEqual(fs.existsSync(portDir) ? fs.readdirSync(portDir).filter((name) => name.endsWith('.port')) : [], [])
      assert.deepEqual(fs.existsSync(portDir) ? fs.readdirSync(portDir).filter((name) => name.startsWith('workspace-')) : [], [])
      assert.equal(fs.existsSync(path.join(root, '.front-door-started')), false, 'front door is not started after a child fails')
      const port = Number(fs.readFileSync(path.join(root, '.alpha-port'), 'utf8'))
      assert.equal(await acceptsConnections(port), false, 'the already-started site server is stopped')
    })
    /* RESTARTING ALWAYS WORKS (dev-restarts-cleanly): a run stops its servers however it ends, and a
       new run takes over from one that ended without cleaning up */
    await test('a server started through a wrapper (as npx starts Vite) is stopped with its group', async () => {
      /* the wrapper starts the real server as its own child and stays, as npx does; a signal to the
         wrapper alone used to leave the real one listening */
      const inner = "require('node:http').createServer((q, r) => r.end('vite')).listen(0, '127.0.0.1', function () { console.log(this.address().port) })"
      const wrapper = `const c = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(inner)}], { stdio: ['ignore', 'inherit', 'ignore'] }); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`
      const group = spawnGroup(process.execPath, ['-e', wrapper], { stdio: ['ignore', 'pipe', 'ignore'] })
      const port = await new Promise((resolve) => group.stdout.once('data', (chunk) => resolve(Number(String(chunk).trim()))))
      assert.equal(await acceptsConnections(port), true)
      signalGroup(group, 'SIGTERM')   /* what dev.mjs sends at shutdown; the wrapper ignores it, the server does not */
      const until = Date.now() + 3000
      while (Date.now() < until && await acceptsConnections(port)) await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(await acceptsConnections(port), false, 'the real server behind the wrapper is stopped with it')
      signalGroup(group, 'SIGKILL')
    })

    await test('a closed terminal (SIGHUP) stops the run, its servers, its port files and its record', async () => {
      const root = heldFixture('hup')
      const { code, output } = await startHeld(root, 'hup').exited
      assert.equal(code, 0, output)
      const ports = vitePorts(output)
      assert.equal(ports.length, 2, output)
      for (const port of ports) assert.equal(await acceptsConnections(port), false, 'a site server outlived its run')
      assert.deepEqual(stateFiles(root), [])
    })

    await test('a killed run (SIGKILL) takes its servers with it, and the next start takes over its record', async () => {
      const root = heldFixture('kill')
      const held = startHeld(root, 'hold')
      const output = await held.ready
      const ports = vitePorts(output)
      assert.equal(ports.length, 2, output)
      held.worker.kill('SIGKILL')
      await held.exited
      const until = Date.now() + 5000
      while (Date.now() < until && (await Promise.all(ports.map(acceptsConnections))).some(Boolean)) await new Promise((resolve) => setTimeout(resolve, 200))
      for (const port of ports) assert.equal(await acceptsConnections(port), false, 'a site server outlived a killed run by more than five seconds')
      assert.ok(stateFiles(root).some((name) => name.startsWith('runs/')), 'the killed run left its record (nothing could remove it)')
      const again = await startHeld(root, 'hup').exited
      assert.equal(again.code, 0, again.output)
      assert.match(again.output, /Stopped what an earlier dev run left behind: what a workspace run left/)
      assert.deepEqual(stateFiles(root), [])
    })

    await test('a start straight after a kill waits for the dying run’s servers to finish stopping', async () => {
      const root = heldFixture('restart')
      const held = startHeld(root, 'hold')
      await held.ready
      held.worker.kill('SIGKILL')
      await held.exited
      const again = await startHeld(root, 'hup').exited
      assert.equal(again.code, 0, again.output)
      assert.match(again.output, /Waiting for 2 server\(s\) of an earlier run to finish stopping/)
      assert.match(again.output, /Stopped what an earlier dev run left behind: what a workspace run left/)
      assert.deepEqual(stateFiles(root), [])
    })

    await test('take-over stops an abandoned run and a leftover Vite, and never touches a port that is not ours', async () => {
      const root = heldFixture('abandoned')
      const token = 'abandoned-run-token'
      /* a run whose starter is gone: re-parented to init, still carrying its run id */
      const launch = `const c = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', env: { ...process.env, PLATFORMKIT_DEV_RUN_ID: '${token}' } }); c.unref(); console.log(c.pid)`
      const starter = spawn(process.execPath, ['-e', launch], { stdio: ['ignore', 'pipe', 'ignore'] })
      let starterOut = ''
      starter.stdout.on('data', (chunk) => { starterOut += chunk })
      await new Promise((resolve) => starter.once('exit', resolve))
      const abandoned = Number(starterOut.trim())
      const runs = path.join(root, 'node_modules', '.cache', 'platformkit', 'dev', 'runs')
      fs.mkdirSync(runs, { recursive: true })
      fs.writeFileSync(path.join(runs, `${abandoned}.json`), JSON.stringify({ root, pid: abandoned, runId: token, kind: 'workspace', supabaseWorkdirs: [] }))
      /* a Vite the abandoned run's site left listening */
      const alpha = path.join(root, 'sites', 'alpha')
      fs.writeFileSync(path.join(alpha, 'vite.mjs'), "import http from 'node:http'; const s = http.createServer((q, r) => r.end('alpha')); s.listen(0, '127.0.0.1', () => console.log(s.address().port))\n")
      const vite = spawn(process.execPath, ['vite.mjs'], { cwd: alpha, stdio: ['ignore', 'pipe', 'ignore'] })
      const vitePort = await new Promise((resolve) => vite.stdout.once('data', (chunk) => resolve(Number(String(chunk).trim()))))
      fs.writeFileSync(path.join(root, 'node_modules', '.cache', 'platformkit', 'dev', 'alpha.port'), `${vitePort}\n`)
      /* something else entirely on the port beta's record names */
      const other = http.createServer((q, r) => r.end('not ours'))
      await new Promise((resolve) => other.listen(0, '127.0.0.1', resolve))
      const otherPort = other.address().port
      fs.writeFileSync(path.join(root, 'node_modules', '.cache', 'platformkit', 'dev', 'beta.port'), `${otherPort}\n`)
      const said = []
      const { stopped, live } = await takeOver(root, { error: (message) => said.push(message) })
      assert.deepEqual(live, [])
      assert.ok(stopped.includes(`an abandoned workspace run (PID ${abandoned})`), stopped.join(' | '))
      assert.ok(stopped.includes(`alpha (${vitePort})`), stopped.join(' | '))
      assert.equal(await acceptsConnections(vitePort), false, 'the leftover Vite is stopped')
      assert.throws(() => process.kill(abandoned, 0), /ESRCH/, 'the abandoned run is stopped')
      assert.equal(await acceptsConnections(otherPort), true, 'a server that is not ours is never signalled')
      assert.ok(said.some((line) => line.includes('not a verifiable PlatformKit Vite process')), said.join(' | '))
      other.close()
    })

    await test('a living run is left alone, and a second start is refused as before', async () => {
      const root = heldFixture('two')
      const first = startHeld(root, 'hold')
      await first.ready
      const second = await startHeld(root, 'hup').exited
      assert.equal(second.code, 1, second.output)
      assert.match(second.output, /already has a dev server on port \d+; stop it before starting the workspace/)
      assert.doesNotMatch(second.output, /Stopped what an earlier dev run left behind/)
      first.worker.kill('SIGTERM')
      const { code, output } = await first.exited
      assert.equal(code, 0, `the first run stops cleanly afterwards\n${output}`)
      assert.deepEqual(stateFiles(root), [])
    })
  }
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}

function heldFixture(name) {
  const root = path.join(fixture, `held-${name}`)
  for (const site of ['alpha', 'beta']) {
    const directory = path.join(root, 'sites', site)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: `@fixture/${site}`, type: 'module' }))
    fs.writeFileSync(path.join(directory, 'platformkit.config.js'), `export default { name: '${site}', deployment: { backend: false } }\n`)
  }
  return fs.realpathSync(root)
}

/* what is left under the PlatformKit dev cache: port files, runtime folders and run records */
function stateFiles(root) {
  const dir = path.join(root, 'node_modules', '.cache', 'platformkit', 'dev')
  if (!fs.existsSync(dir)) return []
  const runs = fs.existsSync(path.join(dir, 'runs')) ? fs.readdirSync(path.join(dir, 'runs')).map((name) => `runs/${name}`) : []
  return [...fs.readdirSync(dir).filter((name) => name.endsWith('.port') || name.startsWith('workspace-')), ...runs]
}

function vitePorts(output) {
  return [...output.matchAll(/Vite (\d+)/g)].map((match) => Number(match[1]))
}

function startHeld(root, mode) {
  const worker = spawn(process.execPath, [fileURLToPath(import.meta.url), '--held-worker', root, mode], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let onReady
  const ready = new Promise((resolve) => { onReady = resolve })
  const take = (chunk) => {
    output += chunk
    if (/shared front door on port/.test(output) && vitePorts(output).length >= 2) onReady(output)
  }
  worker.stdout.on('data', take)
  worker.stderr.on('data', take)
  const exited = new Promise((resolve) => worker.once('exit', (code, signal) => { onReady(output); resolve({ code, signal, output }) }))
  return { worker, ready, exited }
}

async function runHeldWorker(root, mode) {
  const devScript = path.join(root, 'fake-held-dev.mjs')
  const owner = new URL('./dev-owner.mjs', import.meta.url).href
  fs.writeFileSync(devScript, `import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { watchParent } from '${owner}'
const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1])
const site = path.basename(process.cwd())
const portDir = path.join(path.resolve(process.cwd(), '../..'), 'node_modules', '.cache', 'platformkit', 'dev')
fs.mkdirSync(portDir, { recursive: true })
const portFile = path.join(portDir, site + '.port')
fs.writeFileSync(portFile, String(port) + '\\n')
const server = http.createServer((req, res) => res.end(site))
server.listen(port, '0.0.0.0')
/* stopping takes a moment, as a real one stopping its stack does */
let stopping = false
const stop = () => { if (stopping) return; stopping = true; server.closeAllConnections(); server.close(() => setTimeout(() => { fs.rmSync(portFile, { force: true }); process.exit(0) }, 1500)) }
process.on('SIGTERM', stop)
process.on('SIGHUP', stop)
watchParent(stop, 2000, {
  parentPid: Number(process.env.PLATFORMKIT_DEV_PARENT_PID),
})
setInterval(() => {}, 1000)
`)
  const proxy = {
    server: null,
    async start({ port, domain, sites }) {
      this.server = http.createServer((request, response) => {
        const site = sites.find(({ name }) => request.headers.host?.split(':')[0] === `${name}.${domain}`)
        if (!site) { response.writeHead(404); response.end(); return }
        const target = Number(fs.readFileSync(path.join(root, 'node_modules', '.cache', 'platformkit', 'dev', `${site.name}.port`), 'utf8'))
        const upstream = http.request({ host: '127.0.0.1', port: target, path: request.url, method: request.method, headers: { ...request.headers, connection: 'close' } }, (res) => {
          response.writeHead(res.statusCode || 502, res.headers)
          res.pipe(response)
        })
        upstream.on('error', () => { response.writeHead(502); response.end() })
        request.pipe(upstream)
      })
      await new Promise((resolve) => this.server.listen(port, '127.0.0.1', resolve))
      if (mode === 'hup') setTimeout(() => process.kill(process.pid, 'SIGHUP'), 500)
    },
    async stop() {
      if (this.server?.listening) { this.server.closeAllConnections(); await new Promise((resolve) => this.server.close(resolve)) }
    },
  }
  await runWorkspace({
    root,
    args: ['--front-door-port:auto'],
    env: { ...process.env, PLATFORMKIT_SITES: 'alpha,beta', PLATFORMKIT_ROOT_SITE: '', PLATFORMKIT_DOMAIN: 'localhost' },
    devScript,
    frontDoorAdapter: proxy,
    assembleSite: async () => {},
  })
}

async function runWorkspaceWorker(root) {
  const devScript = path.join(fixture, 'fake-dev.mjs')
  fs.writeFileSync(devScript, `import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1])
const site = path.basename(process.cwd())
let workspace = process.cwd()
while (!fs.existsSync(path.join(workspace, 'packages', 'kit'))) {
  const parent = path.dirname(workspace)
  if (parent === workspace) throw new Error('workspace root not found')
  workspace = parent
}
const portDir = path.join(workspace, 'node_modules', '.cache', 'platformkit', 'dev')
fs.mkdirSync(portDir, { recursive: true })
const portFile = path.join(portDir, site + '.port')
fs.writeFileSync(portFile, String(port) + '\\n')
const server = http.createServer((req, res) => {
  if (req.url === '/__platformkit/site-meta') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      projectName: site === 'alpha' ? 'Alpha Project' : '',
      title: site[0].toUpperCase() + site.slice(1) + ' home',
      description: site + ' description',
      image: '/share/' + site + '.png',
    }))
    return
  }
  res.end(site)
})
server.listen(port, '0.0.0.0')
process.on('SIGTERM', () => server.close(() => { fs.rmSync(portFile, { force: true }); process.exit(0) }))
`)

  const frontDoor = {
    server: null,
    async start({ port, domain, sites, directoryPort }) {
      this.server = http.createServer((request, response) => {
        const site = sites.find(({ name }) => request.headers.host?.split(':')[0] === `${name}.${domain}`)
        const rootHost = request.headers.host?.split(':')[0] === domain
        if (!site && !rootHost) { response.writeHead(404); response.end(); return }
        const targetPort = rootHost
          ? directoryPort
          : Number(fs.readFileSync(path.join(root, 'node_modules', '.cache', 'platformkit', 'dev', `${site.name}.port`), 'utf8'))
        const upstream = http.request({ host: '127.0.0.1', port: targetPort, path: request.url, method: request.method, headers: request.headers }, (res) => {
          response.writeHead(res.statusCode || 502, res.headers)
          res.pipe(response)
        })
        upstream.on('error', () => { response.writeHead(502); response.end() })
        request.pipe(upstream)
      })
      await new Promise((resolve) => this.server.listen(port, '127.0.0.1', resolve))
      const response = await requestText(port, `${domain}:${port}`)
      this.rootHtml = response.body
      assert.equal(response.status, 200)
      setTimeout(() => process.kill(process.pid, 'SIGTERM'), 1500)
    },
    async stop() {
      if (this.server?.listening) await new Promise((resolve) => this.server.close(resolve))
    },
  }

  await runWorkspace({
    root,
    args: ['--front-door-port:auto'],
    env: { ...process.env, PLATFORMKIT_SITES: 'alpha,beta', PLATFORMKIT_ROOT_SITE: '', PLATFORMKIT_DOMAIN: 'localhost' },
    devScript,
    frontDoorAdapter: frontDoor,
    assembleSite: async () => {},
  })
  assert.match(frontDoor.rootHtml, /Your local sites/)
  assert.match(frontDoor.rootHtml, /<h2>Alpha Project<\/h2>/)
  assert.match(frontDoor.rootHtml, /<h2>beta<\/h2>/)
  assert.doesNotMatch(frontDoor.rootHtml, /Alpha home|Beta home|alpha description|beta description/)
  assert.match(frontDoor.rootHtml, /http:\/\/alpha\.localhost:\d+\/share\/alpha\.png/)
  assert.equal(frontDoor.rootHtml.match(/class="site-card"/g)?.length, 2, 'only the two selected sites are listed')
  assert.notEqual(process.exitCode, 1, 'workspace shutdown completes successfully')
}

function requestText(port, host) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/', headers: { host } }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => resolve({ status: response.statusCode, body }))
    })
    request.once('error', reject)
  })
}

async function runWorkspaceFailureWorker(root) {
  const devScript = path.join(fixture, 'fake-failing-dev.mjs')
  fs.writeFileSync(devScript, `import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
const site = path.basename(process.cwd())
const port = Number(process.argv[process.argv.indexOf('--port') + 1])
const workspace = path.resolve(process.cwd(), '../..')
if (site === 'beta') {
  setTimeout(() => process.exit(17), 50)
} else {
  fs.writeFileSync(path.join(workspace, '.alpha-port'), String(port))
  const portDir = path.join(workspace, 'node_modules', '.cache', 'platformkit', 'dev')
  fs.mkdirSync(portDir, { recursive: true })
  fs.writeFileSync(path.join(portDir, site + '.port'), String(port) + '\\n')
  const server = http.createServer((_req, res) => { res.end(site) })
  server.listen(port, '0.0.0.0')
  process.on('SIGTERM', () => server.close(() => process.exit(0)))
}
`)

  await runWorkspace({
    root,
    args: ['--front-door-port:auto'],
    env: { ...process.env, PLATFORMKIT_SITES: 'alpha,beta', PLATFORMKIT_ROOT_SITE: '', PLATFORMKIT_DOMAIN: 'localhost' },
    devScript,
    frontDoorAdapter: { async start() { fs.writeFileSync(path.join(root, '.front-door-started'), '') }, async stop() {} },
    assembleSite: async () => {},
  })
}

function acceptsConnections(port) {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, timeout: 500 }, (response) => {
      response.resume()
      resolve(true)
    })
    request.once('error', () => resolve(false))
    request.once('timeout', () => { request.destroy(); resolve(false) })
  })
}

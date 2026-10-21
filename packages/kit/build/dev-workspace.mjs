import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { connect, createServer } from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { createDevDirectoryServer } from './dev-directory.mjs'
import { deploymentShape, loadSite } from './site.mjs'
import { defaultSite, sites as discoverSites } from './sites.mjs'
import { createRunRecord, quietOnClosedStreams, stableProjectId, stopStack } from './dev-runtime.mjs'
import { portRequest, resolvePort } from './dev-ports.mjs'
import { takeOver, takeOverLine, watchParent } from './dev-owner.mjs'
import { platformkitRuntimePath } from './runtime-paths.mjs'

const KIT = path.dirname(fileURLToPath(import.meta.url))
const DEV = path.join(KIT, 'dev.mjs')
const COMPOSE = (root) => path.join(root, 'deploy', 'nginx', 'docker-compose.yml')
const PORT_LINE = /^(\s*)(port|shadow_port|inspector_port)\s*=\s*(\d+)(\s*(?:#.*)?)$/gm
const DNS_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i

function option(args, name, fallback) {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

function say(message) {
  console.log(`\x1b[36m›\x1b[0m ${message}`)
}

function tcpConnects(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.setTimeout(250)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error', () => resolve(false))
  })
}

async function canBind(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen({ host: '0.0.0.0', port, exclusive: true }, () => {
      server.close((error) => resolve(!error))
    })
  })
}

export async function findFreePort(start, reserved = new Set()) {
  for (let port = start; port < 65536; port++) {
    /* claimed before the checks, which await: two sites prepared at once would otherwise both see a port free and
       both take it (the end-to-end run's two stacks were both given 40000…). A busy port stays claimed — it is busy. */
    if (reserved.has(port)) continue
    reserved.add(port)
    if (await tcpConnects(port) || !await canBind(port)) continue
    return port
  }
  throw new Error(`no free port remains at or above ${start}`)
}

function setAuthSiteUrl(config, url) {
  let section = ''
  let siteUrlIndex = -1
  let hasRedirectUrl = false
  const lines = config.split('\n').map((line, index) => {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (header) section = header[1]
    if (section !== 'auth') return line
    if (/^\s*site_url\s*=/.test(line)) {
      siteUrlIndex = index
      const updated = line.replace(/=\s*".*"\s*$/, `= "${url}"`)
      if (updated === line) throw new Error('Supabase auth site_url must be a quoted string')
      return updated
    }
    if (/^\s*additional_redirect_urls\s*=/.test(line)) {
      const match = line.match(/^(\s*additional_redirect_urls\s*=\s*)(\[[^\]]*\])(\s*(?:#.*)?)$/)
      if (!match) throw new Error('Supabase auth additional_redirect_urls must be a single-line array')
      let allowed
      try { allowed = JSON.parse(match[2]) }
      catch { throw new Error('Supabase auth additional_redirect_urls must contain a valid string array') }
      if (!Array.isArray(allowed) || allowed.some((entry) => typeof entry !== 'string')) {
        throw new Error('Supabase auth additional_redirect_urls must contain a valid string array')
      }
      hasRedirectUrl = true
      if (!allowed.includes(url)) allowed.push(url)
      return `${match[1]}${JSON.stringify(allowed)}${match[3]}`
    }
    return line
  })
  if (siteUrlIndex < 0) throw new Error('Supabase config must declare auth.site_url')
  if (!hasRedirectUrl) lines.splice(siteUrlIndex + 1, 0, `additional_redirect_urls = ${JSON.stringify([url])}`)
  return lines.join('\n')
}

export function runtimeSupabaseConfig(config, { siteName, projectId, domain, frontDoorPort, ports }) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(siteName)) throw new Error(`invalid runtime Supabase site name: ${siteName}`)
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(projectId)) throw new Error(`invalid runtime Supabase project id: ${projectId}`)
  if (!DNS_NAME.test(domain)) throw new Error(`invalid workspace domain: ${domain}`)
  if (!Number.isInteger(frontDoorPort) || frontDoorPort < 1 || frontDoorPort > 65535) throw new Error(`invalid front-door port: ${frontDoorPort}`)
  if (!Array.isArray(ports) || ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535) || new Set(ports).size !== ports.length) throw new Error('runtime Supabase ports must be distinct valid port numbers')

  const projectMatches = config.match(/^project_id\s*=\s*"[^"]*"\s*$/gm) || []
  if (projectMatches.length !== 1) throw new Error('Supabase config must declare exactly one project_id')
  const portMatches = [...config.matchAll(PORT_LINE)]
  if (portMatches.length !== ports.length) throw new Error(`expected ${portMatches.length} runtime Supabase ports, got ${ports.length}`)

  let portIndex = 0
  let output = config.replace(PORT_LINE, (_line, indent, key, _value, suffix) => `${indent}${key} = ${ports[portIndex++]}${suffix}`)
  output = output.replace(/^project_id\s*=\s*"[^"]*"\s*$/m, `project_id = "${projectId}"`)
  return setAuthSiteUrl(output, `http://${siteName}.${domain}:${frontDoorPort}`)
}

export async function prepareRuntimeProject({ source, runtimeRoot, siteName, projectId, domain, frontDoorPort, reservedPorts, portStart = 20000 }) {
  const sourceSupabase = path.join(source, 'supabase')
  const configPath = path.join(sourceSupabase, 'config.toml')
  if (!fs.existsSync(configPath)) throw new Error(`site ${siteName} has no supabase/config.toml`)

  const runtimeSupabase = path.join(runtimeRoot, 'supabase')
  fs.mkdirSync(runtimeSupabase, { recursive: true })
  for (const entry of fs.readdirSync(sourceSupabase, { withFileTypes: true })) {
    if (entry.name === 'config.toml') continue
    const sourcePath = path.join(sourceSupabase, entry.name)
    const targetPath = path.join(runtimeSupabase, entry.name)
    if (entry.name === 'functions') {
      fs.symlinkSync(sourcePath, targetPath, 'dir')
    } else {
      fs.cpSync(sourcePath, targetPath, { recursive: true, dereference: true })
    }
  }

  const originalConfig = fs.readFileSync(configPath, 'utf8')
  const portCount = [...originalConfig.matchAll(PORT_LINE)].length
  const ports = []
  /* the dev runs start at 20000; the end-to-end runs at their own range (build/e2e.mjs), so neither takes the other's */
  for (let index = 0; index < portCount; index++) ports.push(await findFreePort(portStart, reservedPorts))
  const config = runtimeSupabaseConfig(originalConfig, {
    siteName, projectId, domain, frontDoorPort, ports,
  })
  fs.writeFileSync(path.join(runtimeSupabase, 'config.toml'), config)
  return { runtimeRoot, ports, projectId }
}

function runSync(command, args, { cwd, env }) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status ?? result.signal}`)
}

function createComposeFrontDoor({ root, projectName, env }) {
  const composeFile = COMPOSE(root)
  const common = ['compose', '-f', composeFile, '--project-name', projectName, '--profile', 'dev']
  return {
    start() {
      runSync('docker', [...common, 'up', '--build', '--detach', 'dev-front-door'], { cwd: root, env })
    },
    stop() {
      runSync('docker', [...common, 'down', '--remove-orphans'], { cwd: root, env })
    },
  }
}

function requestHost(port, host) {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/',
      headers: { host },
      timeout: 1500,
    }, (res) => {
      res.resume()
      resolve(res.statusCode || null)
    })
    req.once('error', () => resolve(null))
    req.once('timeout', () => { req.destroy(); resolve(null) })
    req.end()
  })
}

async function waitForSites(siteList, domain, frontDoorPort, children, timeout = 90000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const exited = children.find(({ child, error }) => error || child.exitCode !== null || child.signalCode !== null)
    if (exited) throw new Error(`${exited.site.name} dev server exited before the front door became ready${exited.error ? `: ${exited.error.message}` : ''}`)
    const statuses = await Promise.all(siteList.map((site) => requestHost(frontDoorPort, `${site.name}.${domain}`)))
    if (statuses.every((status) => status !== null && status < 502)) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`the development front door did not become ready on port ${frontDoorPort}`)
}

function pipeOutput(child, name) {
  for (const stream of ['stdout', 'stderr']) {
    let buffer = ''
    child[stream].on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) (stream === 'stdout' ? process.stdout : process.stderr).write(`\x1b[2m[${name}]\x1b[0m ${line}\n`)
    })
    child[stream].on('end', () => {
      if (buffer) (stream === 'stdout' ? process.stdout : process.stderr).write(`\x1b[2m[${name}]\x1b[0m ${buffer}\n`)
    })
  }
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  signalChild(child, 'SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ])
  if (child.exitCode === null && child.signalCode === null) {
    signalChild(child, 'SIGKILL')
    await new Promise((resolve) => child.once('exit', resolve))
  }
}

function signalChild(child, signal) {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
  if (child.exitCode === null && child.signalCode === null) child.kill(signal)
}

function cleanupStack(runtimeRoot) {
  if (!fs.existsSync(path.join(runtimeRoot, 'supabase', 'config.toml'))) return
  const stopped = stopStack(runtimeRoot, runtimeRoot)
  if (stopped.stdout) process.stdout.write(stopped.stdout)
  if (stopped.error || stopped.status !== 0) {
    console.error(`workspace cleanup: could not stop Supabase project in ${runtimeRoot}`)
  }
}

export async function runWorkspace({
  root = process.cwd(),
  args = [],
  env = process.env,
  devScript = DEV,
  frontDoorAdapter,
  assembleSite,
} = {}) {
  root = path.resolve(root)
  const settings = { ...loadEnv('development', root, 'PLATFORMKIT_'), ...env }
  const domain = settings.PLATFORMKIT_DOMAIN || 'localhost'
  if (!DNS_NAME.test(domain)) throw new Error(`PLATFORMKIT_DOMAIN "${domain}" is not a valid domain name`)
  const siteList = String(settings.PLATFORMKIT_SITES || '').trim()
    ? discoverSites(root, settings)
    : [defaultSite(root, settings)]
  if (!siteList.length) throw new Error('no workspace sites selected; set PLATFORMKIT_DEFAULT_SITE, or use PLATFORMKIT_SITES for an explicit multi-site selection')
  const unfetched = siteList.filter((site) => site.fetched === false)
  if (unfetched.length) {
    throw new Error(`registered site checkout${unfetched.length === 1 ? '' : 's'} not fetched: ${unfetched.map(({ name }) => `"${name}" (run "platformkit sites fetch ${name}")`).join(', ')}`)
  }
  if (frontDoorAdapter && (typeof frontDoorAdapter.start !== 'function' || typeof frontDoorAdapter.stop !== 'function')) throw new Error('frontDoorAdapter must provide start() and stop()')

  /* what a run that ended without cleaning up left — a closed terminal, a kill — is stopped first,
     so its ports are free again; a living run is left alone and the port guard below refuses */
  const { stopped } = await takeOver(root, { error: (message) => console.error(message), say })
  if (stopped.length) say(takeOverLine(stopped))

  const reservedPorts = new Set()
  const viteOption = portRequest(args, '--port', 'auto')
  const baseVitePort = viteOption.auto ? 5173 : viteOption.port
  const vitePorts = new Map()
  for (const site of siteList) vitePorts.set(site.name, await findFreePort(baseVitePort, reservedPorts))
  const frontDoorPort = await resolvePort(args, '--front-door-port', 3000, {
    available: async (port) => await canBind(port) && !await tcpConnects(port),
    findFree: (start) => findFreePort(start, reservedPorts),
  })
  reservedPorts.add(frontDoorPort)
  const directoryPort = await findFreePort(5300, reservedPorts)
  const runToken = `${process.pid}-${randomBytes(3).toString('hex')}`
  const runtimeBase = platformkitRuntimePath(root, 'dev', `workspace-${runToken}`)
  const runtimeProjects = new Map()
  const preparedSites = []
  const composeProjectName = `platformkit-dev-${createHash('sha256').update(root).digest('hex').slice(0, 10)}`
  quietOnClosedStreams()
  const runRecord = createRunRecord(root, { kind: 'workspace', composeProjectName, runtimeBase, supabaseWorkdirs: [] })
  process.on('exit', () => runRecord.remove())
  process.env.PLATFORMKIT_DEV_RUN_ID = runRecord.runId
  const appEnv = {
    ...process.env,
    ...settings,
    PLATFORMKIT_DOMAIN: domain,
    PLATFORMKIT_ROOT_SITE: settings.PLATFORMKIT_ROOT_SITE || '',
    PLATFORMKIT_SITES: siteList.map(({ name }) => name).join(','),
    PLATFORMKIT_APEX: '',
    PLATFORMKIT_DEV_DIRECTORY: '1',
    PLATFORMKIT_DEV_DIRECTORY_PORT: String(directoryPort),
    DEV_FRONT_DOOR_PORT: String(frontDoorPort),
    PLATFORMKIT_DEV_RUN_ID: runRecord.runId,
  }
  const portFlags = new Set(['--port', '--front-door-port', '--port:auto', '--front-door-port:auto'])
  const passArgs = args.filter((arg, index) => !portFlags.has(arg) && !portFlags.has(args[index - 1]))
  let composeAttempted = false
  let shuttingDown = false
  const children = []
  let directoryServer = null
  const docker = frontDoorAdapter || createComposeFrontDoor({
    root,
    projectName: composeProjectName,
    env: appEnv,
  })

  try {
    for (const site of siteList) {
      const portFile = platformkitRuntimePath(root, 'dev', `${site.name}.port`)
      if (fs.existsSync(portFile)) {
        const prior = Number(fs.readFileSync(portFile, 'utf8').trim())
        if (Number.isInteger(prior) && await tcpConnects(prior)) throw new Error(`${site.name} already has a dev server on port ${prior}; stop it before starting the workspace`)
        fs.rmSync(portFile, { force: true })
      }

      if (assembleSite) await assembleSite(site, appEnv)
      else {
        const assembled = spawnSync(process.execPath, [path.join(KIT, 'assemble.mjs')], {
          cwd: site.directory,
          env: appEnv,
          stdio: 'inherit',
        })
        if (assembled.error) throw assembled.error
        if (assembled.status !== 0) throw new Error(`Supabase assembly failed for site ${site.name}`)
      }

      const siteConfig = await loadSite(site.directory)
      const shape = deploymentShape(siteConfig, appEnv)
      let supabaseWorkdir = null
      if (shape.backend && !args.includes('--no-stack')) {
        fs.mkdirSync(runtimeBase, { recursive: true })
        const runtimeRoot = path.join(runtimeBase, site.name)
        const projectId = stableProjectId(siteConfig, site.name)
        const runtime = await prepareRuntimeProject({
          source: site.directory,
          runtimeRoot,
          siteName: site.name,
          projectId,
          domain,
          frontDoorPort,
          reservedPorts,
        })
        supabaseWorkdir = runtimeRoot
        runtimeProjects.set(site.name, runtimeRoot)
      }
      preparedSites.push({ ...site, shape, supabaseWorkdir })
    }
    runRecord.update({ supabaseWorkdirs: [...runtimeProjects.values()] })

    const childFlags = passArgs.filter((arg) => ['--no-functions', '--no-start', '--no-stack'].includes(arg))
    for (const site of preparedSites) {
      const childArgs = [
        devScript,
        '--single',
        '--port', String(vitePorts.get(site.name)),
        '--front-door-port', String(frontDoorPort),
        ...childFlags,
      ]
      if (site.supabaseWorkdir) childArgs.push('--supabase-workdir', site.supabaseWorkdir)
      const childEnv = appEnv
      childEnv.PLATFORMKIT_DEV_PARENT_RUN_ID = runRecord.runId
      childEnv.PLATFORMKIT_DEV_PARENT_PID = String(process.pid)
      const child = spawn(process.execPath, childArgs, {
        cwd: site.directory,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      })
      pipeOutput(child, site.name)
      const record = { site, child, error: null }
      child.on('error', (error) => {
        record.error = error
        if (!shuttingDown) console.error(`[${site.name}] ${error.message}`)
      })
      children.push(record)
    }

    const deadline = Date.now() + 180000
    for (const { site, child } of children) {
      const portFile = platformkitRuntimePath(root, 'dev', `${site.name}.port`)
      while (Date.now() < deadline) {
        const record = children.find((candidate) => candidate.child === child)
        if (record?.error || child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`${site.name} dev server exited during startup${record?.error ? `: ${record.error.message}` : ''}`)
        }
        if (fs.existsSync(portFile) && Number(fs.readFileSync(portFile, 'utf8').trim()) === vitePorts.get(site.name) && await tcpConnects(vitePorts.get(site.name))) break
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      if (Date.now() >= deadline) throw new Error(`${site.name} Vite server did not become ready`)
    }

    composeAttempted = true
    directoryServer = createDevDirectoryServer({
      sites: preparedSites,
      ports: Object.fromEntries(vitePorts),
      domain,
      frontDoorPort,
    })
    await new Promise((resolve, reject) => {
      directoryServer.once('error', reject)
      directoryServer.listen(directoryPort, '0.0.0.0', resolve)
    })

    await docker.start({ port: frontDoorPort, domain, sites: siteList, directoryPort })
    await waitForSites(siteList, domain, frontDoorPort, children)
    say(`Workspace sites are running through the shared front door on port ${frontDoorPort}:`)
    for (const site of preparedSites) say(`  ${site.name.padEnd(14)} http://${site.name}.${domain}:${frontDoorPort}  ·  Vite ${vitePorts.get(site.name)}${site.supabaseWorkdir ? ' · isolated Supabase' : site.shape.backend ? ' · no stack' : ' · no backend'}${site.dirty ? ' · local changes' : ''}`)
    say('Stop with Ctrl+C or `platformkit stop`; this run will stop its child servers, stacks and front door.')

    let onSignal
    const signal = new Promise((resolve) => {
      onSignal = resolve
      process.once('SIGINT', onSignal)
      process.once('SIGTERM', onSignal)
      process.once('SIGHUP', onSignal)
    })
    /* a parent that goes without a signal (a kill no handler can catch) ends the run too */
    const unwatch = watchParent(() => onSignal())
    let onUnexpectedExit
    const unexpectedExit = new Promise((resolve, reject) => {
      onUnexpectedExit = ({ site, child }) => {
        if (!shuttingDown) reject(new Error(`${site.name} dev server exited (code ${child.exitCode ?? 'signal'})`))
      }
      for (const record of children) record.child.on('exit', () => onUnexpectedExit(record))
    })
    try { await Promise.race([signal, unexpectedExit]) }
    finally {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      process.off('SIGHUP', onSignal)
      unwatch()
      for (const { child } of children) child.removeAllListeners('exit')
    }
  } catch (error) {
    console.error(`workspace dev: ${error.message}`)
    process.exitCode = 1
  } finally {
    shuttingDown = true
    if (directoryServer?.listening) {
      directoryServer.closeAllConnections()
      await new Promise((resolve) => directoryServer.close(resolve))
    }
    if (directoryServer) await directoryServer.closeResources()
    for (const { child } of children) await stopChild(child)
    if (composeAttempted) {
      try { await docker.stop() }
      catch (error) { console.error(`workspace cleanup: ${error.message}`); process.exitCode = 1 }
    }
    for (const runtimeRoot of runtimeProjects.values()) cleanupStack(runtimeRoot)
    for (const site of siteList) {
      const portFile = platformkitRuntimePath(root, 'dev', `${site.name}.port`)
      if (fs.existsSync(portFile) && Number(fs.readFileSync(portFile, 'utf8').trim()) === vitePorts.get(site.name)) fs.rmSync(portFile, { force: true })
    }
    if (fs.existsSync(runtimeBase)) fs.rmSync(runtimeBase, { recursive: true, force: true })
    runRecord.remove()
  }
}

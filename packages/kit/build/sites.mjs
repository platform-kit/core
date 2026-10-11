import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const COMMIT = /^[a-f0-9]{40}$/i

export function workspaceRoot(start = process.cwd()) {
  let dir = path.resolve(start)
  while (true) {
    if (fs.existsSync(path.join(dir, 'sites')) && fs.existsSync(path.join(dir, 'packages', 'kit'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(start)
    dir = parent
  }
}

export function platformKitWorkspaceRoot(start = process.cwd()) {
  const root = workspaceRoot(start)
  return fs.existsSync(path.join(root, 'sites')) && fs.existsSync(path.join(root, 'packages', 'kit'))
    ? root
    : null
}

function validateName(name, where) {
  if (!DNS_LABEL.test(name)) throw new Error(`${where}: "${name}" is not a legal DNS label (use lowercase letters, digits, and interior hyphens; at most 63 characters)`)
}

function validateRemote(remote, where = 'site remote') {
  if (typeof remote !== 'string' || !remote.trim() || /[\s\u0000-\u001f]/.test(remote)) {
    throw new Error(`${where} must be an HTTPS, SSH, or local file Git URL`)
  }
  if (/^git@[^:/\s]+:[^\s]+$/.test(remote)) return remote
  let parsed
  try { parsed = new URL(remote) }
  catch { throw new Error(`${where} must be an HTTPS, SSH, or local file Git URL`) }
  if (!['https:', 'ssh:', 'file:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${where} must be an HTTPS, SSH, or local file Git URL without embedded credentials`)
  }
  return remote
}

function validateCommit(ref, where = 'site revision') {
  if (typeof ref !== 'string' || !COMMIT.test(ref)) throw new Error(`${where} must be a full 40-character commit SHA`)
  return ref.toLowerCase()
}

export function managedSitesRoot(root) {
  return path.join(path.resolve(root), 'sites', 'external')
}

export function managedSitesRegistry(root) {
  return path.join(path.resolve(root), 'platformkit.sites.json')
}

function within(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

function validateRegistry(registry, file) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry) || registry.version !== 1 || !Array.isArray(registry.sites)) {
    throw new Error(`site registry ${file} must be an object with version 1 and a sites array`)
  }
  const names = new Set()
  for (const site of registry.sites) {
    if (!site || typeof site !== 'object' || Array.isArray(site)) throw new Error(`site registry ${file} contains an invalid site entry`)
    validateName(site.name, `site registry ${file}`)
    validateRemote(site.remote, `site registry ${file} remote for ${site.name}`)
    validateCommit(site.ref, `site registry ${file} revision for ${site.name}`)
    if (names.has(site.name)) throw new Error(`site registry ${file} contains duplicate site "${site.name}"`)
    names.add(site.name)
  }
  return registry
}

export function readSiteRegistry(root) {
  const file = managedSitesRegistry(root)
  if (!fs.existsSync(file)) return { version: 1, sites: [] }
  let registry
  try { registry = JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (error) { throw new Error(`could not read site registry ${file}: ${error.message}`) }
  return validateRegistry(registry, file)
}

function writeSiteRegistry(root, registry) {
  const file = managedSitesRegistry(root)
  validateRegistry(registry, file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, { flag: 'wx' })
  try { fs.renameSync(temporary, file) }
  catch (error) {
    fs.rmSync(temporary, { force: true })
    throw new Error(`could not update site registry ${file}: ${error.message}`)
  }
}

function git(args, { cwd, operation, env = process.env }) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error) throw new Error(`${operation}: ${result.error.message}`)
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`${operation} failed${detail ? `: ${detail}` : ` (git exited ${result.status ?? result.signal})`}`)
  }
  return result.stdout.trim()
}

function checkoutPath(root, name) {
  return path.join(managedSitesRoot(root), name)
}

function assertManagedPath(root, destination) {
  const sitesRoot = path.join(path.resolve(root), 'sites')
  const managedRoot = managedSitesRoot(root)
  if (!within(root, managedRoot) || !within(managedRoot, destination)) {
    throw new Error(`managed site checkout path escapes the workspace: ${destination}`)
  }
  if (fs.existsSync(sitesRoot) && fs.lstatSync(sitesRoot).isSymbolicLink()) {
    throw new Error(`managed site parent directory must not be a symbolic link: ${sitesRoot}`)
  }
  if (fs.existsSync(managedRoot) && fs.lstatSync(managedRoot).isSymbolicLink()) {
    throw new Error(`managed site directory must not be a symbolic link: ${managedRoot}`)
  }
}

function ensureNoTrackedCollision(root, name) {
  const local = path.join(path.resolve(root), 'sites', name)
  if (fs.existsSync(local)) throw new Error(`site "${name}" already exists in the workspace at ${local}; choose a different managed name`)
  if (process.env.PLATFORMKIT_ROOT_SITE === name && fs.existsSync(path.join(path.resolve(root), 'platformkit.config.js'))) {
    throw new Error(`site "${name}" is already registered as the workspace root site`)
  }
}

function siteEntry(root, name, remote, ref) {
  const directory = checkoutPath(root, name)
  return { name, remote, ref, directory, dist: path.join(directory, 'dist'), root: false, managed: true, fetched: true }
}

export function siteGitUrlVariable(name) {
  validateName(name, 'site name')
  return `PLATFORMKIT_SITE_${siteEnvSuffix(name)}_GIT_URL`
}

export function gitEnvironmentForRemote(remote, env = process.env) {
  const scopedEnv = { ...env }
  delete scopedEnv.PLATFORMKIT_GITHUB_TOKEN
  delete scopedEnv.GITHUB_TOKEN
  delete scopedEnv.GH_TOKEN
  if (!remote.startsWith('https://')) return scopedEnv
  const parsed = new URL(remote)
  const token = env.PLATFORMKIT_GITHUB_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com' || !token) return scopedEnv
  if (/[\r\n]/.test(token)) throw new Error('GitHub token environment variable must not contain newlines')
  const rawCount = env.GIT_CONFIG_COUNT
  if (rawCount !== undefined && !/^\d+$/.test(rawCount)) throw new Error('GIT_CONFIG_COUNT must be a non-negative integer when using a GitHub token')
  const count = rawCount === undefined ? 0 : Number(rawCount)
  if (!Number.isSafeInteger(count)) throw new Error('GIT_CONFIG_COUNT must be a non-negative integer when using a GitHub token')
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
  return {
    ...scopedEnv,
    GIT_CONFIG_COUNT: String(count + 2),
    [`GIT_CONFIG_KEY_${count}`]: 'http.https://github.com/.extraheader',
    [`GIT_CONFIG_VALUE_${count}`]: '',
    [`GIT_CONFIG_KEY_${count + 1}`]: 'http.https://github.com/.extraheader',
    [`GIT_CONFIG_VALUE_${count + 1}`]: header,
  }
}

function verifyManagedCheckout(root, registration) {
  const { name, remote, ref } = registration
  const directory = checkoutPath(root, name)
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error(`managed site checkout must not be a symbolic link: ${directory}`)
  const top = git(['rev-parse', '--show-toplevel'], { cwd: directory, operation: `verify checkout for site "${name}"` })
  if (path.resolve(top) !== fs.realpathSync(directory)) throw new Error(`managed site path is not the root of its Git checkout: ${directory}`)
  const actual = git(['rev-parse', 'HEAD'], { cwd: directory, operation: `read current revision for site "${name}"` })
  if (actual !== ref) throw new Error(`managed site "${name}" is at ${actual}, but its registered pin is ${ref}; update the registration with "platformkit sites update ${name} --ref <commit>"`)
  const dirty = Boolean(git(['status', '--porcelain=v1', '--untracked-files=all'], { cwd: directory, operation: `check local changes in site "${name}"` }))
  return { ...siteEntry(root, name, remote, ref), dirty }
}

export function fetchSite(root, { name, remote, ref, env = process.env }) {
  root = path.resolve(root)
  validateName(name, 'site name')
  const registry = readSiteRegistry(root)
  const registered = registry.sites.find((site) => site.name === name)
  const remoteValue = remote || registered?.remote || env[siteGitUrlVariable(name)]
  if (!remoteValue) throw new Error(`site "${name}" needs --url <git-url> or ${siteGitUrlVariable(name)}`)
  remote = validateRemote(remoteValue)
  ref = validateCommit(ref || registered?.ref)
  if (registered && (registered.remote !== remote || registered.ref !== ref)) {
    throw new Error(`site "${name}" is already registered with a different remote or pin; use "platformkit sites update ${name} --ref <commit>" to change its pin`)
  }
  ensureNoTrackedCollision(root, name)
  const destination = checkoutPath(root, name)
  assertManagedPath(root, destination)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  if (fs.existsSync(destination)) throw new Error(`managed site checkout already exists at ${destination} but is not registered; inspect it before removing or registering it`)
  try {
    git(['clone', '--no-checkout', remote, destination], { operation: `fetch site "${name}"`, env: gitEnvironmentForRemote(remote, env) })
    git(['checkout', '--detach', ref], { cwd: destination, operation: `check out ${ref} for site "${name}"` })
    const actual = git(['rev-parse', 'HEAD'], { cwd: destination, operation: `read fetched revision for site "${name}"` })
    if (actual !== ref) throw new Error(`site "${name}" resolved to ${actual}, not the requested commit ${ref}`)
    if (!fs.existsSync(path.join(destination, 'package.json')) || !fs.existsSync(path.join(destination, 'platformkit.config.js'))) {
      throw new Error(`site "${name}" at ${ref} must contain package.json and platformkit.config.js`)
    }
    if (!registered) {
      registry.sites.push({ name, remote, ref })
      writeSiteRegistry(root, registry)
    }
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true })
    throw error
  }
  return siteEntry(root, name, remote, ref)
}

export function updateSite(root, { name, ref, env = process.env }) {
  root = path.resolve(root)
  validateName(name, 'site name')
  ref = validateCommit(ref)
  const registry = readSiteRegistry(root)
  const index = registry.sites.findIndex((site) => site.name === name)
  if (index < 0) throw new Error(`site "${name}" is not registered; fetch it first with "platformkit sites fetch ${name} [--url <git-url>] --ref <commit>"`)
  const registration = registry.sites[index]
  const destination = checkoutPath(root, name)
  assertManagedPath(root, destination)
  if (!fs.existsSync(destination) || !fs.statSync(destination).isDirectory()) {
    throw new Error(`site "${name}" is registered but not fetched; run "platformkit sites fetch ${name}"`)
  }
  if (fs.lstatSync(destination).isSymbolicLink()) throw new Error(`managed site checkout must not be a symbolic link: ${destination}`)
  const top = git(['rev-parse', '--show-toplevel'], { cwd: destination, operation: `verify checkout for site "${name}"` })
  if (path.resolve(top) !== fs.realpathSync(destination)) throw new Error(`managed site path is not the root of its Git checkout: ${destination}`)
  const dirty = git(['status', '--porcelain=v1', '--untracked-files=all'], { cwd: destination, operation: `check local changes in site "${name}"` })
  if (dirty) throw new Error(`refusing to update site "${name}" because its checkout has local changes; preserve or resolve them first:\n${dirty}`)
  const current = git(['rev-parse', 'HEAD'], { cwd: destination, operation: `read current revision for site "${name}"` })
  if (current !== registration.ref) throw new Error(`refusing to update site "${name}": checkout is at ${current}, but its registered pin is ${registration.ref}`)

  git(['fetch', '--no-tags', 'origin', ref], { cwd: destination, operation: `fetch revision ${ref} for site "${name}"`, env: gitEnvironmentForRemote(registration.remote, env) })
  const resolvesToCommit = spawnSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd: destination, encoding: 'utf8', stdio: 'ignore' })
  if (resolvesToCommit.error) throw new Error(`could not verify revision ${ref} for site "${name}": ${resolvesToCommit.error.message}`)
  if (resolvesToCommit.status !== 0) throw new Error(`revision ${ref} is not available as a commit in site "${name}"`)
  for (const entry of ['package.json', 'platformkit.config.js']) {
    const result = spawnSync('git', ['cat-file', '-e', `${ref}:${entry}`], { cwd: destination, encoding: 'utf8', stdio: 'ignore' })
    if (result.error) throw new Error(`could not verify ${entry} in revision ${ref} for site "${name}": ${result.error.message}`)
    if (result.status !== 0) throw new Error(`revision ${ref} for site "${name}" does not contain ${entry}`)
  }
  git(['checkout', '--detach', ref], { cwd: destination, operation: `update site "${name}" to ${ref}` })
  const actual = git(['rev-parse', 'HEAD'], { cwd: destination, operation: `read updated revision for site "${name}"` })
  if (actual !== ref) throw new Error(`site "${name}" resolved to ${actual}, not the requested commit ${ref}`)
  registry.sites[index] = { ...registration, ref }
  writeSiteRegistry(root, registry)
  return siteEntry(root, name, registration.remote, ref)
}

export function sites(root = process.cwd(), env = process.env) {
  root = path.resolve(root)
  const found = []

  if (env.PLATFORMKIT_ROOT_SITE && fs.existsSync(path.join(root, 'platformkit.config.js'))) {
    validateName(env.PLATFORMKIT_ROOT_SITE, 'PLATFORMKIT_ROOT_SITE')
    found.push({
      name: env.PLATFORMKIT_ROOT_SITE,
      directory: root,
      dist: path.join(root, 'dist'),
      root: true,
    })
  }

  const directory = path.join(root, 'sites')
  if (fs.existsSync(directory)) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const siteDir = path.join(directory, entry.name)
      if (!fs.existsSync(path.join(siteDir, 'package.json'))) continue
      validateName(entry.name, `site directory ${path.relative(root, siteDir)}`)
      found.push({ name: entry.name, directory: siteDir, dist: path.join(siteDir, 'dist'), root: false, fetched: true, managed: false })
    }
  }

  const registry = readSiteRegistry(root)
  for (const registered of registry.sites) {
    const local = found.find((site) => site.name === registered.name)
    if (local) throw new Error(`site "${registered.name}" is both in the tracked sites directory and the managed site registry`)
    const directory = checkoutPath(root, registered.name)
    assertManagedPath(root, directory)
    if (fs.existsSync(directory)) {
      if (fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory()) {
        throw new Error(`managed site checkout is not a directory: ${directory}`)
      }
      const config = path.join(directory, 'platformkit.config.js')
      const packageJson = path.join(directory, 'package.json')
      if (!fs.existsSync(config) || !fs.existsSync(packageJson)) {
        throw new Error(`registered checkout "${registered.name}" is incomplete at ${directory}; expected package.json and platformkit.config.js`)
      }
      found.push(verifyManagedCheckout(root, registered))
    } else {
      found.push({
        name: registered.name,
        directory,
        dist: path.join(directory, 'dist'),
        root: false,
        managed: true,
        fetched: false,
        remote: registered.remote,
        ref: registered.ref,
      })
    }
  }

  const names = new Set()
  for (const site of found) {
    if (names.has(site.name)) throw new Error(`site name "${site.name}" is declared more than once`)
    names.add(site.name)
  }

  if (String(env.PLATFORMKIT_SITES || '').trim()) {
    const selected = String(env.PLATFORMKIT_SITES).split(',').map((name) => name.trim()).filter(Boolean)
    for (const name of selected) {
      validateName(name, 'PLATFORMKIT_SITES')
      if (!names.has(name)) throw new Error(`PLATFORMKIT_SITES names "${name}", but no such site exists in this checkout`)
    }
    return found.filter((site) => selected.includes(site.name))
  }

  return found
}

export function defaultSite(root = process.cwd(), env = process.env) {
  root = path.resolve(root)
  const value = String(env.PLATFORMKIT_DEFAULT_SITE || 'sites/docs').trim()
  if (!value) throw new Error('PLATFORMKIT_DEFAULT_SITE must name a site or provide a site path')
  const available = sites(root, { ...env, PLATFORMKIT_SITES: '' })
  const pathSelection = path.isAbsolute(value) || value.startsWith(`.${path.sep}`) || value.includes(path.sep)
  if (!pathSelection) validateName(value, 'PLATFORMKIT_DEFAULT_SITE')
  const selected = pathSelection
    ? available.find((site) => path.resolve(site.directory) === path.resolve(root, value)) || {
        name: path.basename(path.resolve(root, value)),
        directory: path.resolve(root, value),
        dist: path.join(path.resolve(root, value), 'dist'),
        root: false,
        fetched: true,
        managed: false,
      }
    : available.find((site) => site.name === value)
  if (!selected) {
    throw new Error(`default site "${value}" was not found; set PLATFORMKIT_DEFAULT_SITE to a site name or path`)
  }
  if (selected.fetched === false) {
    throw new Error(`default site "${value}" is registered but not fetched; run "platformkit sites fetch ${value}"`)
  }
  if (!fs.existsSync(path.join(selected.directory, 'package.json')) || !fs.existsSync(path.join(selected.directory, 'platformkit.config.js'))) {
    if (!env.PLATFORMKIT_DEFAULT_SITE && pathSelection) {
      throw new Error('default site "docs" was not found; expected a site at sites/docs')
    }
    throw new Error(`default site "${value}" has no platformkit.config.js at ${selected.directory}`)
  }
  return selected
}

export function siteNameFor(root, directory = process.cwd(), env = process.env) {
  root = path.resolve(root)
  directory = path.resolve(directory)
  const relative = path.relative(root, directory)
  if (!relative) return fs.existsSync(path.join(root, 'platformkit.config.js')) ? env.PLATFORMKIT_ROOT_SITE || null : null
  const parts = relative.split(path.sep)
  if (parts[0] === 'sites' && parts[1]) return parts[1] === 'external' ? parts[2] || null : parts[1]
  const managed = path.relative(managedSitesRoot(root), directory).split(path.sep)
  if (managed.length === 1 && managed[0] && !managed[0].startsWith('..')) return managed[0]
  return null
}

export function siteEnvSuffix(name) {
  return name.toUpperCase().replace(/-/g, '_')
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    const root = workspaceRoot(process.cwd())
    const args = process.argv.slice(2)
    const [action, name, ...options] = args
    const parseOptions = (allowed) => {
      const parsed = {}
      for (let index = 0; index < options.length; index += 2) {
        const key = options[index]
        const value = options[index + 1]
        if (!allowed.includes(key)) throw new Error(`unknown sites option "${key}"`)
        if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`)
        if (parsed[key]) throw new Error(`${key} may be provided only once`)
        parsed[key] = value
      }
      return parsed
    }
    if (action === 'fetch') {
      if (!name) {
        throw new Error('usage: platformkit sites fetch <name> [--url <git-url>] [--ref <40-character-commit>]')
      }
      const parsed = parseOptions(['--url', '--ref'])
      const registry = readSiteRegistry(root)
      const registered = registry.sites.find((site) => site.name === name)
      const ref = parsed['--ref'] || registered?.ref
      if (!ref) throw new Error(`site "${name}" needs --ref <40-character-commit> unless it already has a registered pin`)
      const fetched = fetchSite(root, { name, remote: parsed['--url'], ref })
      console.log(`Fetched ${fetched.name} at ${fetched.ref}\n  ${fetched.directory}\n  Run npm ci in the checkout to install its dependencies.`)
    } else if (action === 'update') {
      if (!name) {
        throw new Error('usage: platformkit sites update <name> --ref <40-character-commit>')
      }
      const parsed = parseOptions(['--ref'])
      const ref = parsed['--ref']
      if (!ref) throw new Error('updating a site requires --ref <40-character-commit>')
      const updated = updateSite(root, { name, ref })
      console.log(`Updated ${updated.name} to ${updated.ref}\n  ${updated.directory}`)
    } else {
      if (action && action !== '--json') throw new Error(`unknown sites action "${action}"`)
      if (name || options.length) throw new Error('usage: platformkit sites [--json]')
      const result = sites(root)
      if (args.includes('--json')) console.log(JSON.stringify(result, null, 2))
      else for (const site of result) {
        if (site.fetched === false) console.log(`${site.name}\t${path.relative(root, site.directory)}\tnot fetched (${site.ref})\tRun: platformkit sites fetch ${site.name}`)
        else console.log(`${site.name}\t${path.relative(root, site.directory) || '.'}\t${site.managed ? `${site.ref}${site.dirty ? ' (local changes)' : ''}` : path.relative(root, site.dist)}`)
      }
    }
  } catch (error) {
    console.error(`✖ sites: ${error.message}`)
    process.exitCode = 1
  }
}

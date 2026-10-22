import crypto from 'node:crypto'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

/* one package, the engine with its theme inside it, from packages/kit */
const PACKAGES = ['platformkit']
const SOURCE_DIR = { platformkit: 'kit' }
const RECEIPT = 'node_modules/.cache/platformkit/source-install.json'
const CORE_REPOSITORY = 'https://github.com/platform-kit/core'

function gitOutput(sourceRoot, ...args) {
  const result = spawnSync('git', args, { cwd: sourceRoot, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

function canonicalRepository(value) {
  if (typeof value !== 'string') return null
  if (value.toLowerCase() === 'github:platform-kit/core') return CORE_REPOSITORY
  const scp = /^git@github\.com:([^?#]+)$/i.exec(value)
  if (scp) return `https://github.com/${scp[1].replace(/\.git$/, '').replace(/\/+$/, '')}`.toLowerCase()
  try {
    const url = new URL(value.replace(/^git\+/, ''))
    if (url.hostname.toLowerCase() !== 'github.com' || url.username || url.password) return null
    return `${url.origin}${url.pathname.replace(/\.git$/, '').replace(/\/+$/, '')}`.toLowerCase()
  } catch {
    return null
  }
}

export function platformKitPackageHash(root) {
  const hash = crypto.createHash('sha256')
  return hashPackageTree(root, hash)
}

function hashPackageTree(root, hash, includedFiles = null) {
  const included = includedFiles === null ? null : new Set(includedFiles)
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const file = path.join(dir, entry.name)
      const relative = path.relative(root, file).split(path.sep).join('/')
      if (entry.isSymbolicLink()) {
        if (included && !included.has(relative)) continue
        hash.update(relative)
        hash.update('\0link\0')
        hash.update(fs.readlinkSync(file))
      }
      if (entry.isDirectory()) visit(file)
      else if (!entry.isSymbolicLink() && (!included || included.has(relative))) {
        hash.update(relative)
        hash.update('\0')
        hash.update(fs.readFileSync(file))
      }
    }
  }
  visit(root)
  return hash.digest('hex')
}

function sourcePackageHash(root) {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--silent'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error) throw new Error(`could not inspect the npm package at ${root}: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`could not inspect the npm package at ${root}${result.stderr.trim() ? `: ${result.stderr.trim()}` : ''}`)
  }
  let packages
  try {
    packages = JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`could not read the npm package file list at ${root}: ${error.message}`)
  }
  const files = packages.length === 1 && Array.isArray(packages[0]?.files)
    ? packages[0].files.map(({ path: file }) => file)
    : null
  if (!files || files.some((file) => typeof file !== 'string' || path.isAbsolute(file) || file.split('/').includes('..'))) {
    throw new Error(`npm returned an invalid package file list for ${root}`)
  }
  return hashPackageTree(root, crypto.createHash('sha256'), files)
}

function writeReceipt(site, sourceRoot) {
  const packages = {}
  for (const name of PACKAGES) {
    const sourceDirectory = path.join(sourceRoot, 'packages', SOURCE_DIR[name])
    const directory = path.join(site, 'node_modules', ...name.split('/'))
    const sourceManifest = JSON.parse(fs.readFileSync(path.join(sourceDirectory, 'package.json'), 'utf8'))
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
    if (sourceManifest.name !== name || manifest.name !== name || manifest.version !== sourceManifest.version) {
      throw new Error(`installed PlatformKit package ${name} has an invalid package manifest`)
    }
    const installedHash = platformKitPackageHash(directory)
    if (installedHash !== sourcePackageHash(sourceDirectory)) {
      throw new Error(`installed PlatformKit package ${name} differs from its source checkout`)
    }
    packages[name] = { version: manifest.version, sha256: installedHash }
  }

  const sourceRef = gitOutput(sourceRoot, 'rev-parse', '--verify', 'HEAD')
  const rootManifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'))
  const declaredRepository = typeof rootManifest.repository === 'string' ? rootManifest.repository : rootManifest.repository?.url
  const sourceUrl = canonicalRepository(declaredRepository)
    || canonicalRepository(gitOutput(sourceRoot, 'remote', 'get-url', 'origin'))
  const sourceClean = sourceRef === null
    || gitOutput(sourceRoot, 'status', '--porcelain', '--', 'packages/kit') === ''
  const treeHash = crypto.createHash('sha256')
  for (const name of PACKAGES) treeHash.update(`${name}\0${packages[name].sha256}\0`)
  const receipt = {
    schema: 1,
    source: { ref: sourceRef, url: sourceUrl, clean: sourceClean, treeSha256: treeHash.digest('hex') },
    packages,
  }
  const file = path.join(site, RECEIPT)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
  try { fs.renameSync(temporary, file) }
  catch (error) {
    fs.rmSync(temporary, { force: true })
    throw new Error(`could not record the PlatformKit source installation: ${error.message}`)
  }
  return receipt
}

export function installPlatformKitSource(site, sourceRoot, { env = process.env } = {}) {
  for (const name of PACKAGES) {
    if (!fs.existsSync(path.join(sourceRoot, 'packages', SOURCE_DIR[name], 'package.json'))) {
      throw new Error(`PlatformKit source checkout is missing packages/${SOURCE_DIR[name]}`)
    }
  }
  const result = spawnSync('npm', [
    'install',
    '--no-save',
    '--install-links',
    '--package-lock=false',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    `file:${path.join(sourceRoot, 'packages', 'kit')}`,
  ], { cwd: site, stdio: 'inherit', env })
  if (result.error) throw new Error(`could not install PlatformKit from its source checkout: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`PlatformKit source installation failed${result.status === null ? '' : ` (npm exited ${result.status})`}`)
  const receipt = writeReceipt(site, sourceRoot)
  console.log(`PlatformKit installed from source${receipt.source.ref ? ` at ${receipt.source.ref}` : ''}.`)
  return receipt
}

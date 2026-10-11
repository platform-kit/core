import crypto from 'node:crypto'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const PACKAGES = ['@platform-kit/kit', '@platform-kit/movable-types']
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
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const file = path.join(dir, entry.name)
      const relative = path.relative(root, file).split(path.sep).join('/')
      if (entry.isSymbolicLink()) {
        hash.update(relative)
        hash.update('\0link\0')
        hash.update(fs.readlinkSync(file))
      }
      if (entry.isDirectory()) visit(file)
      else if (!entry.isSymbolicLink()) {
        hash.update(relative)
        hash.update('\0')
        hash.update(fs.readFileSync(file))
      }
    }
  }
  visit(root)
  return hash.digest('hex')
}

function writeReceipt(site, sourceRoot) {
  const packages = {}
  for (const name of PACKAGES) {
    const sourceDirectory = path.join(sourceRoot, 'packages', name.split('/').at(-1))
    const directory = path.join(site, 'node_modules', ...name.split('/'))
    const sourceManifest = JSON.parse(fs.readFileSync(path.join(sourceDirectory, 'package.json'), 'utf8'))
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
    if (sourceManifest.name !== name || manifest.name !== name || manifest.version !== sourceManifest.version) {
      throw new Error(`installed PlatformKit package ${name} has an invalid package manifest`)
    }
    const installedHash = platformKitPackageHash(directory)
    if (installedHash !== platformKitPackageHash(sourceDirectory)) {
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
    || gitOutput(sourceRoot, 'status', '--porcelain', '--', 'packages/kit', 'packages/movable-types') === ''
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
    if (!fs.existsSync(path.join(sourceRoot, 'packages', name.split('/').at(-1), 'package.json'))) {
      throw new Error(`PlatformKit source checkout is missing packages/${name.split('/').at(-1)}`)
    }
  }
  const result = spawnSync('npm', [
    'install',
    '--no-save',
    '--package-lock=false',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    `file:${path.join(sourceRoot, 'packages', 'kit')}`,
    `file:${path.join(sourceRoot, 'packages', 'movable-types')}`,
  ], { cwd: site, stdio: 'inherit', env })
  if (result.error) throw new Error(`could not install PlatformKit from its source checkout: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`PlatformKit source installation failed${result.status === null ? '' : ` (npm exited ${result.status})`}`)
  const receipt = writeReceipt(site, sourceRoot)
  console.log(`PlatformKit installed from source${receipt.source.ref ? ` at ${receipt.source.ref}` : ''}.`)
  return receipt
}

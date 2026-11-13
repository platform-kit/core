import crypto from 'node:crypto'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

/* one package, the engine with its theme inside it, from packages/kit */
const PACKAGES = ['platformkit']
const SOURCE_DIR: any = { platformkit: 'kit' }
const RECEIPT = 'node_modules/.cache/platformkit/source-install.json'
const CORE_REPOSITORY = 'https://github.com/platform-kit/core'

/* only the checkout's own repository speaks for it: a copy inside a site's git work tree must not report the site's commit */
function gitOutput(sourceRoot: string, ...args: any[]) {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: sourceRoot, encoding: 'utf8' })
  if (top.status !== 0 || fs.realpathSync(top.stdout.trim()) !== fs.realpathSync(sourceRoot)) return null
  const result = spawnSync('git', args, { cwd: sourceRoot, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

function canonicalRepository(value: string|null) {
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

export function platformKitPackageHash(root: string) {
  const hash = crypto.createHash('sha256')
  return hashPackageTree(root, hash)
}

function hashPackageTree(root: string, hash: crypto.Hash, includedFiles: Iterable<unknown>|null|undefined = null) {
  const included = includedFiles === null ? null : new Set(includedFiles)
  const visit = (dir: any) => {
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

function sourcePackageHash(root: string) {
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
  } catch (error: any) {
    throw new Error(`could not read the npm package file list at ${root}: ${error.message}`)
  }
  const files = packages.length === 1 && Array.isArray(packages[0]?.files)
    ? packages[0].files.map(({ path: file }: any) => file)
    : null
  if (!files || files.some((file: string) => typeof file !== 'string' || path.isAbsolute(file) || file.split('/').includes('..'))) {
    throw new Error(`npm returned an invalid package file list for ${root}`)
  }
  return hashPackageTree(root, crypto.createHash('sha256'), files)
}

function writeReceipt(site: string, sourceRoot: string, { sourceClean: cleanBefore }: any = {}) {
  const packages: any = {}
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
  /* read before the compile where there is one: its output beside the sources is untracked, and is not a change */
  const sourceClean = cleanBefore ?? (sourceRef === null
    || gitOutput(sourceRoot, 'status', '--porcelain', '--', 'packages/kit') === '')
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
  catch (error: any) {
    fs.rmSync(temporary, { force: true })
    throw new Error(`could not record the PlatformKit source installation: ${error.message}`)
  }
  return receipt
}

/* Where a site declares platformkit from GitHub, npm has put the whole Core checkout at node_modules/platformkit, the folder
   the kit installs into: the install would delete its own source. So the checkout's kit is copied aside first. */
export function sourceInsideSite(site: string, sourceRoot: string) {
  const nodeModules = path.join(fs.realpathSync(site), 'node_modules')
  return fs.realpathSync(sourceRoot).startsWith(nodeModules + path.sep)
}

function stageSource(site: string, sourceRoot: string) {
  const staged = path.join(fs.realpathSync(site), 'node_modules', '.cache', 'platformkit', 'core')
  fs.rmSync(staged, { recursive: true, force: true })
  fs.mkdirSync(path.join(staged, 'packages'), { recursive: true })
  fs.copyFileSync(path.join(sourceRoot, 'package.json'), path.join(staged, 'package.json'))
  fs.cpSync(path.join(sourceRoot, 'packages', 'kit'), path.join(staged, 'packages', 'kit'), {
    recursive: true,
    filter: (source) => path.basename(source) !== 'node_modules',
  })
  return staged
}

export function installPlatformKitSource(site: string, sourceRoot: string, options: { env?: NodeJS.ProcessEnv } = {}) {
  if (!sourceInsideSite(site, sourceRoot)) return installFrom(site, sourceRoot, options)
  const staged = stageSource(site, sourceRoot)
  try { return installFrom(site, staged, options) }
  finally { fs.rmSync(staged, { recursive: true, force: true }) }
}

function installFrom(site: string, sourceRoot: string, { env = process.env } = {}) {
  for (const name of PACKAGES) {
    if (!fs.existsSync(path.join(sourceRoot, 'packages', SOURCE_DIR[name], 'package.json'))) {
      throw new Error(`PlatformKit source checkout is missing packages/${SOURCE_DIR[name]}`)
    }
  }
  /* the kit's TypeScript, compiled beside itself first: Node never strips types inside node_modules, and this install runs
     no scripts, so prepack's compile would not happen (build/compile.mjs). A checkout from before the kit had any has none. */
  const kitDir = path.join(sourceRoot, 'packages', 'kit')
  const compiler = path.join(kitDir, 'build', 'compile.mjs')
  const sourceClean = gitOutput(sourceRoot, 'rev-parse', '--verify', 'HEAD') === null
    || gitOutput(sourceRoot, 'status', '--porcelain', '--', 'packages/kit') === ''
  if (fs.existsSync(compiler)) {
    const compiled = spawnSync(process.execPath, [compiler], { cwd: kitDir, stdio: 'inherit', env })
    if (compiled.status !== 0) throw new Error('PlatformKit source installation failed: its TypeScript did not compile')
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
  /* the receipt compares the installed package with the checkout, so it is taken while the compiled files are beside the
     sources, and they are removed after it */
  /* a source inside node_modules is an install copy, not a workspace: the CLI running from it still imports its compiled files */
  const cleanUp = () => { if (fs.existsSync(compiler) && !kitDir.split(path.sep).includes('node_modules')) spawnSync(process.execPath, [compiler, '--clean'], { cwd: kitDir, stdio: 'ignore', env }) }
  let receipt
  try {
    if (result.error) throw new Error(`could not install PlatformKit from its source checkout: ${result.error.message}`)
    if (result.status !== 0) throw new Error(`PlatformKit source installation failed${result.status === null ? '' : ` (npm exited ${result.status})`}`)
    receipt = writeReceipt(site, sourceRoot, { sourceClean })
  } finally { cleanUp() }
  console.log(`PlatformKit installed from source${receipt.source.ref ? ` at ${receipt.source.ref}` : ''}.`)
  return receipt
}

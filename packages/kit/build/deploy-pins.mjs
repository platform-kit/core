import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { platformKitPackageHash } from './source-install.mjs'

/* one package: the engine with its theme inside it */
const PACKAGES = ['platformkit']
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const INTEGRITY = /^sha(?:1|256|384|512)-[A-Za-z0-9+/]+={0,2}$/
const COMMIT = /^[a-f0-9]{40}$/i
const HASH = /^[a-f0-9]{64}$/i
const SOURCE_RECEIPT = 'node_modules/.cache/platformkit/source-install.json'

function normalizedSourceUrl(value) {
  if (typeof value !== 'string') return null
  if (value.toLowerCase() === 'github:platform-kit/core') return 'https://github.com/platform-kit/core'
  const scp = /^git@github\.com:([^?#]+)$/.exec(value)
  if (scp) return `https://github.com/${scp[1].replace(/\.git$/, '').replace(/\/+$/, '')}`.toLowerCase()
  try {
    const url = new URL(value.replace(/^git\+/, ''))
    if (url.hostname.toLowerCase() !== 'github.com' || url.username || url.password) return null
    return `${url.origin}${url.pathname.replace(/\.git$/, '').replace(/\/+$/, '')}`.toLowerCase()
  } catch {
    return null
  }
}

function readJson(file, label, errors) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    errors.push(`${label}: ${error.code === 'ENOENT' ? 'file is missing' : `could not be read (${error.message})`}`)
    return null
  }
}

export function platformKitPins(root = process.cwd()) {
  const errors = []
  const manifest = readJson(path.join(root, 'package.json'), 'package.json', errors)
  const lock = readJson(path.join(root, 'package-lock.json'), 'package-lock.json', errors)
  const pins = []

  if (!manifest || !lock) return { errors, pins }

  const rootLock = lock.packages?.['']
  if (!rootLock || !lock.packages || ![2, 3].includes(lock.lockfileVersion)) {
    errors.push('package-lock.json: expected an npm lockfile v2 or v3 with package records')
    return { errors, pins }
  }

  for (const name of PACKAGES) {
    const declared = manifest.dependencies?.[name]
    if (typeof declared !== 'string' || !EXACT_VERSION.test(declared)) {
      errors.push(`package.json: ${name} must be a direct dependency pinned to an exact release version`)
      continue
    }

    const lockedRoot = rootLock.dependencies?.[name]
    if (lockedRoot !== declared) {
      errors.push(`package-lock.json: root dependency ${name} is ${lockedRoot ?? 'missing'}, expected ${declared}`)
      continue
    }

    const entry = lock.packages[`node_modules/${name}`]
    if (!entry || entry.link === true || entry.version !== declared) {
      errors.push(`package-lock.json: ${name} must resolve to the published version ${declared}, not a workspace or local link`)
      continue
    }
    if (typeof entry.resolved !== 'string' || !entry.resolved.startsWith('https://')) {
      errors.push(`package-lock.json: ${name}@${declared} must resolve from an HTTPS package registry`)
      continue
    }
    if (typeof entry.integrity !== 'string' || !INTEGRITY.test(entry.integrity)) {
      errors.push(`package-lock.json: ${name}@${declared} must include a valid package integrity hash`)
      continue
    }

    pins.push({ name, version: declared })
  }

  return { errors, pins }
}

export function assertPlatformKitPins(root = process.cwd()) {
  const { errors, pins } = platformKitPins(root)
  if (errors.length) {
    throw new Error(`PlatformKit package pins are not deployable:\n${errors.map((error) => `  - ${error}`).join('\n')}`)
  }
  return pins
}

export function platformKitSourceInstall(root = process.cwd()) {
  const errors = []
  const manifest = readJson(path.join(root, 'package.json'), 'package.json', errors)
  const receipt = readJson(path.join(root, SOURCE_RECEIPT), SOURCE_RECEIPT, errors)
  if (!manifest || !receipt) return { errors, source: null }
  if (receipt.schema !== 1) errors.push(`${SOURCE_RECEIPT}: unsupported receipt schema`)
  if (receipt.source?.ref !== null && receipt.source?.ref !== undefined && !COMMIT.test(receipt.source.ref)) {
    errors.push(`${SOURCE_RECEIPT}: source commit must be a full SHA`)
  }
  if (!COMMIT.test(receipt.source?.ref || '') && !HASH.test(receipt.source?.treeSha256 || '')) {
    errors.push(`${SOURCE_RECEIPT}: source must record a commit or package-tree hash`)
  }
  if (normalizedSourceUrl(receipt.source?.url) !== 'https://github.com/platform-kit/core') {
    errors.push(`${SOURCE_RECEIPT}: source must be the public PlatformKit Core repository`)
  }
  if (receipt.source?.clean !== true) errors.push(`${SOURCE_RECEIPT}: source package directories were not clean at install time`)

  for (const name of PACKAGES) {
    const declared = manifest.dependencies?.[name]
    const record = receipt.packages?.[name]
    if (typeof declared !== 'string' || !EXACT_VERSION.test(declared)) {
      errors.push(`package.json: ${name} must declare an exact version matching the source-installed package`)
      continue
    }
    if (!record || record.version !== declared || !HASH.test(record.sha256 || '')) {
      errors.push(`${SOURCE_RECEIPT}: ${name} does not match its declared version or has no valid content hash`)
      continue
    }
    const directory = path.join(root, 'node_modules', ...name.split('/'))
    try {
      const installed = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
      if (installed.name !== name || installed.version !== declared || platformKitPackageHash(directory) !== record.sha256) {
        errors.push(`node_modules: ${name} differs from the recorded source installation`)
      }
    } catch (error) {
      errors.push(`node_modules: ${name} could not be verified (${error.message})`)
    }
  }
  const treeHash = HASH.test(receipt.source?.treeSha256 || '') ? receipt.source.treeSha256 : null
  if (treeHash) {
    const expected = crypto.createHash('sha256')
    for (const name of PACKAGES) {
      const record = receipt.packages?.[name]
      if (!record || !HASH.test(record.sha256 || '')) break
      expected.update(`${name}\0${record.sha256}\0`)
    }
    if (expected.digest('hex') !== treeHash) errors.push(`${SOURCE_RECEIPT}: package-tree hash does not match its package records`)
  }
  return { errors, source: errors.length ? null : receipt.source }
}

export function assertPlatformKitForDeploy(root = process.cwd()) {
  const releases = platformKitPins(root)
  if (!releases.errors.length) return { kind: 'release', packages: releases.pins }

  const source = platformKitSourceInstall(root)
  if (!source.errors.length) return { kind: 'source', source: source.source }
  throw new Error(`PlatformKit installation is not deployable:\n${[
    ...releases.errors.map((error) => `  - ${error}`),
    ...source.errors.map((error) => `  - ${error}`),
  ].join('\n')}`)
}

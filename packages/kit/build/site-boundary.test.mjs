import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { workspaceRoot } from './sites.mjs'

const ROOT = workspaceRoot(process.cwd())
const forbidden = /site-brand-reference-sentinel/gi
const textExtensions = new Set(['.md', '.yaml', '.yml', '.json', '.js', '.mjs', '.toml', '.conf'])
const skipDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage'])

function filesUnder(directory, relative = '') {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const childRelative = path.join(relative, entry.name)
    const child = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (skipDirectories.has(entry.name)) continue
      files.push(...filesUnder(child, childRelative))
    } else if (entry.isFile() && textExtensions.has(path.extname(entry.name))) {
      files.push(child)
    }
  }
  return files
}

const maintainedPaths = [
  'AGENTS.md',
  'README.md',
  'package.json',
  'package-lock.json',
  '.gitignore',
  '.gitattributes',
  '.prettierignore',
  '.dockerignore',
  'deploy/README.md',
  'deploy',
  'openspec/config.yaml',
  'docs',
  'sites/docs/content/docs',
  'sites/brochure',
  'sites/club',
  'sites/demo',
  'packages/kit',
  'openspec/specs',
  'openspec/changes',
  '.github',
  '.devcontainer',
]

const missing = maintainedPaths.filter((relative) => !fs.existsSync(path.join(ROOT, relative)))
assert.deepEqual(missing, [], 'maintained PlatformKit documentation and configuration roots must exist')

const scannedFiles = maintainedPaths.flatMap((relative) => {
  const full = path.join(ROOT, relative)
  return fs.statSync(full).isDirectory() ? filesUnder(full, relative) : [full]
}).filter((file) => path.basename(file) !== 'site-boundary.test.mjs')
const matches = scannedFiles.flatMap((file) => {
  const content = fs.readFileSync(file, 'utf8')
  return [...content.matchAll(forbidden)].map((match) => {
    const line = content.slice(0, match.index).split('\n').length
    return `${path.relative(ROOT, file)}:${line}`
  })
})
assert.deepEqual(matches, [], 'current PlatformKit-owned material must not identify a downstream site')
assert.match('site-brand-reference-sentinel', forbidden, 'the boundary scanner must recognize its sentinel')

const workspace = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
assert.deepEqual(workspace.workspaces, [
  'packages/*',
  'sites/brochure',
  'sites/club',
  'sites/demo',
  'sites/docs',
], 'PlatformKit workspaces must contain packages and generic fixtures only')

for (const document of ['PURPOSE.md', 'FEATURES.md']) {
  assert.equal(
    fs.existsSync(path.join(ROOT, 'docs', document)),
    true,
    `${document} must describe PlatformKit in the Core repository`,
  )
}

for (const document of ['TODO.md', 'SHEET.md', 'MODEL.md']) {
  assert.equal(
    fs.existsSync(path.join(ROOT, 'docs', document)),
    false,
    `${document} is product documentation and belongs to its site repository`,
  )
}

console.log(`site-boundary: ${scannedFiles.length} maintained files checked`)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { installPlatformKitSource } from './source-install.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'platformkit-source-cli-'))
const source = path.join(fixture, 'core')
const site = path.join(fixture, 'site')
const gitSource = path.join(fixture, 'github-source')

try {
  fs.mkdirSync(path.join(source, 'packages', 'kit'), { recursive: true })
  fs.mkdirSync(path.join(source, 'packages', 'movable-types'), { recursive: true })
  fs.mkdirSync(site, { recursive: true })
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: '@platform-kit/workspace' }))
  fs.writeFileSync(path.join(source, 'packages', 'kit', 'package.json'), JSON.stringify({
    name: '@platform-kit/kit',
    version: '0.1.0',
    type: 'module',
  }))
  fs.writeFileSync(path.join(source, 'packages', 'movable-types', 'package.json'), JSON.stringify({
    name: '@platform-kit/movable-types',
    version: '0.1.0',
    type: 'module',
    dependencies: { '@platform-kit/kit': '0.1.0' },
  }))
  const manifestPath = path.join(site, 'package.json')
  const manifest = '{"name":"fixture-site","private":true}\n'
  fs.writeFileSync(manifestPath, manifest)

  installPlatformKitSource(site, source)

  assert.equal(fs.readFileSync(manifestPath, 'utf8'), manifest)
  assert.equal(fs.existsSync(path.join(site, 'package-lock.json')), false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(site, 'node_modules', '@platform-kit', 'kit', 'package.json'), 'utf8')).name, '@platform-kit/kit')
  assert.equal(JSON.parse(fs.readFileSync(path.join(site, 'node_modules', '@platform-kit', 'movable-types', 'package.json'), 'utf8')).name, '@platform-kit/movable-types')
  const themeManifest = path.join(site, 'node_modules', '@platform-kit', 'movable-types', 'package.json')
  const kitManifest = createRequire(themeManifest).resolve('@platform-kit/kit/package.json')
  assert.equal(JSON.parse(fs.readFileSync(kitManifest, 'utf8')).name, '@platform-kit/kit')

  const workspace = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(workspace.repository, 'github:platform-kit/core')
  assert.equal(workspace.bin.platformkit, './packages/kit/bin/platformkit.mjs')
  const help = spawnSync(process.execPath, [path.join(root, 'packages', 'kit', 'bin', 'platformkit.mjs'), '--help'], { cwd: site, encoding: 'utf8' })
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /platformkit/)

  fs.mkdirSync(path.join(gitSource, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(gitSource, 'package.json'), JSON.stringify({
    name: 'platformkit-source-fixture',
    version: '1.0.0',
    bin: { platformkit: './bin/platformkit.mjs' },
  }))
  const fixtureBin = path.join(gitSource, 'bin', 'platformkit.mjs')
  fs.writeFileSync(fixtureBin, '#!/usr/bin/env node\nconsole.log("github source CLI works")\n')
  fs.chmodSync(fixtureBin, 0o755)
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: gitSource, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  git('init', '--quiet')
  git('config', 'user.name', 'PlatformKit Test')
  git('config', 'user.email', 'platformkit-test@example.invalid')
  git('add', '.')
  git('commit', '--quiet', '-m', 'source fixture')
  const npx = spawnSync('npx', ['--yes', `--package=git+file://${gitSource}`, 'platformkit'], {
    cwd: site,
    encoding: 'utf8',
    env: { ...process.env, npm_config_offline: 'true' },
  })
  assert.equal(npx.status, 0, npx.stderr)
  assert.match(npx.stdout, /github source CLI works/)
  console.log('source-cli: passed')
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { installPlatformKitSource } from './source-install.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'platformkit-source-cli-'))
const source = path.join(fixture, 'core')
const site = path.join(fixture, 'site')
const gitSource = path.join(fixture, 'github-source')

try {
  fs.mkdirSync(path.join(source, 'packages', 'kit'), { recursive: true })
  fs.mkdirSync(path.join(source, 'packages', 'kit', 'theme', 'src'), { recursive: true })
  fs.mkdirSync(path.join(source, 'sites'), { recursive: true })
  fs.mkdirSync(site, { recursive: true })
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: '@platform-kit/workspace' }))
  fs.writeFileSync(path.join(source, 'packages', 'kit', 'package.json'), JSON.stringify({
    name: 'platformkit',
    version: '0.1.0',
    type: 'module',
    exports: { './theme/*': './theme/src/*', './*': './*' },
  }))
  /* the theme inside the one package */
  fs.writeFileSync(path.join(source, 'packages', 'kit', 'theme', 'src', 'theme.js'), 'export default { name: "movable-types" }\n')
  for (const file of [
    'packages/kit/bin/platformkit.mjs',
    'packages/kit/build/source-install.mjs',
    'packages/kit/build/sites.mjs',
    'packages/kit/build/verbose.mjs',
  ]) {
    const destination = path.join(source, file)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(root, file), destination)
  }
  const dependency = path.join(fixture, 'fixture-dependency')
  fs.mkdirSync(dependency, { recursive: true })
  fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ name: 'fixture-dependency', version: '1.0.0', type: 'module', exports: './index.js' }))
  fs.writeFileSync(path.join(dependency, 'index.js'), 'export const value = "site dependency resolved"\n')
  fs.writeFileSync(
    path.join(source, 'packages', 'kit', 'build', 'deploy.mjs'),
    'import { value } from "fixture-dependency"\nconsole.log(import.meta.url)\nconsole.log(value)\n',
  )
  const manifestPath = path.join(site, 'package.json')
  const manifest = `${JSON.stringify({
    name: 'fixture-site',
    private: true,
    dependencies: { 'fixture-dependency': `file:${dependency}` },
  })}\n`
  fs.writeFileSync(manifestPath, manifest)
  fs.writeFileSync(path.join(site, 'platformkit.config.js'), 'export default {}\n')

  installPlatformKitSource(site, source)

  assert.equal(fs.readFileSync(manifestPath, 'utf8'), manifest)
  assert.equal(fs.existsSync(path.join(site, 'package-lock.json')), false)
  /* one package, platformkit, with the theme inside it */
  assert.equal(JSON.parse(fs.readFileSync(path.join(site, 'node_modules', 'platformkit', 'package.json'), 'utf8')).name, 'platformkit')
  assert.ok(fs.existsSync(createRequire(manifestPath).resolve('platformkit/theme/theme.js')), 'the theme resolves as platformkit/theme')

  const workspace = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(workspace.repository, 'github:platform-kit/core')
  assert.equal(workspace.bin.platformkit, './packages/kit/bin/platformkit.mjs')
  const noViteLoader = path.join(fixture, 'no-vite-loader.mjs')
  fs.writeFileSync(noViteLoader, `
import { registerHooks } from 'node:module'
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'vite') throw new Error('unexpected Vite dependency')
    return nextResolve(specifier, context)
  },
})
`)
  const help = spawnSync(process.execPath, [path.join(root, 'packages', 'kit', 'bin', 'platformkit.mjs'), '--help'], {
    cwd: site,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${pathToFileURL(noViteLoader).href}`].filter(Boolean).join(' '),
    },
  })
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /platformkit/)

  const deploy = spawnSync(process.execPath, [path.join(source, 'packages', 'kit', 'bin', 'platformkit.mjs'), 'deploy'], {
    cwd: site,
    encoding: 'utf8',
  })
  assert.equal(deploy.status, 0, deploy.stderr)
  assert.ok(deploy.stdout.includes(pathToFileURL(fs.realpathSync(path.join(site, 'node_modules', 'platformkit', 'build', 'deploy.mjs'))).href), deploy.stdout)
  assert.match(deploy.stdout, /site dependency resolved/)

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

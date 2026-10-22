import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { platformKitWorkspaceRoot } from './sites.mjs'

const KIT = (file) => fileURLToPath(new URL('../' + file, import.meta.url))
const ROOT_PACKAGE = fileURLToPath(new URL('../../../package.json', import.meta.url))
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'platformkit-workspace-root-'))
const installedFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'platformkit-installed-cli-'))
const env = { ...process.env }
const git = (cwd, args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}
for (const key of ['PLATFORMKIT_DEFAULT_SITE', 'PLATFORMKIT_DOMAIN', 'PLATFORMKIT_ROOT_SITE', 'PLATFORMKIT_SITES']) delete env[key]
fs.mkdirSync(path.join(fixture, 'packages', 'kit'), { recursive: true })
fs.mkdirSync(path.join(fixture, 'sites', 'reader-site'), { recursive: true })
fs.writeFileSync(path.join(fixture, 'sites', 'reader-site', 'package.json'), '{"name":"@fixture/reader-site"}\n')
fs.mkdirSync(path.join(fixture, 'sites', 'docs'), { recursive: true })
fs.writeFileSync(path.join(fixture, 'sites', 'docs', 'package.json'), JSON.stringify({
  name: '@fixture/docs',
  scripts: { 'check-cwd': 'node -e "console.log(process.cwd())"' },
}))
fs.writeFileSync(path.join(fixture, 'sites', 'docs', 'platformkit.config.js'), 'export default {}\n')
fs.writeFileSync(path.join(fixture, 'sites', 'reader-site', 'platformkit.config.js'), 'export default {}\n')
fs.writeFileSync(path.join(fixture, 'sites', 'reader-site', 'package.json'), JSON.stringify({
  name: '@fixture/reader-site',
  scripts: { 'check-cwd': 'node -e "console.log(process.cwd())"' },
}))

try {
  assert.equal(platformKitWorkspaceRoot(path.dirname(ROOT_PACKAGE)), path.dirname(ROOT_PACKAGE))
  const installedKitBin = path.join(installedFixture, 'node_modules', 'platformkit', 'bin')
  fs.mkdirSync(installedKitBin, { recursive: true })
  assert.equal(platformKitWorkspaceRoot(installedKitBin), null)

  const rootScripts = JSON.parse(fs.readFileSync(ROOT_PACKAGE, 'utf8')).scripts
  assert.equal(rootScripts.dev, 'platformkit dev')
  assert.equal(rootScripts.sites, 'platformkit sites')
  assert.match(rootScripts['docs:dev'], /--workspace @platform-kit\/docs/)
  for (const [command, script] of Object.entries(rootScripts)) {
    if (['dev', 'sites', 'docs:dev', 'prepare'].includes(command)) continue
    assert.doesNotMatch(script, /@[^/]+\/site|sites\//, `${command} must not require a particular site`)
  }

  const sites = spawnSync(process.execPath, [KIT('bin/platformkit.mjs'), 'sites', '--json'], {
    cwd: fixture, env, encoding: 'utf8',
  })
  assert.equal(sites.status, 0, sites.stderr)
  const discovered = JSON.parse(sites.stdout)
  assert.deepEqual(discovered.map(({ name, directory }) => [name, directory]), [
    ['docs', path.join(fs.realpathSync(fixture), 'sites', 'docs')],
    ['reader-site', path.join(fs.realpathSync(fixture), 'sites', 'reader-site')],
  ])

  const defaultScript = spawnSync(process.execPath, [KIT('bin/platformkit.mjs'), 'site-run', 'check-cwd'], {
    cwd: fixture, env, encoding: 'utf8',
  })
  assert.equal(defaultScript.status, 0, defaultScript.stderr)
  assert.equal(defaultScript.stdout.trim().split('\n').at(-1), path.join(fs.realpathSync(fixture), 'sites', 'docs'))

  const selectedEnv = { ...env, PLATFORMKIT_DEFAULT_SITE: 'reader-site' }
  const selectedScript = spawnSync(process.execPath, [KIT('bin/platformkit.mjs'), 'site-run', 'check-cwd'], {
    cwd: fixture, env: selectedEnv, encoding: 'utf8',
  })
  assert.equal(selectedScript.status, 0, selectedScript.stderr)
  assert.equal(selectedScript.stdout.trim().split('\n').at(-1), path.join(fs.realpathSync(fixture), 'sites', 'reader-site'))

  const explicitScript = spawnSync(process.execPath, [KIT('bin/platformkit.mjs'), 'site-run', 'check-cwd', '--site', 'sites/docs'], {
    cwd: fixture, env: selectedEnv, encoding: 'utf8',
  })
  assert.equal(explicitScript.status, 0, explicitScript.stderr)
  assert.equal(explicitScript.stdout.trim().split('\n').at(-1), path.join(fs.realpathSync(fixture), 'sites', 'docs'))

  const managed = path.join(fixture, 'sites', 'external', 'external-site')
  fs.mkdirSync(managed, { recursive: true })
  fs.writeFileSync(path.join(managed, 'package.json'), JSON.stringify({
    name: '@fixture/external-site',
    scripts: { 'check-cwd': 'node -e "console.log(process.cwd())"' },
  }))
  fs.writeFileSync(path.join(managed, 'platformkit.config.js'), 'export default {}\n')
  git(managed, ['init', '--quiet'])
  git(managed, ['add', 'package.json', 'platformkit.config.js'])
  const commit = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { cwd: managed, encoding: 'utf8' })
  assert.equal(commit.status, 0, commit.stderr)
  const ref = git(managed, ['rev-parse', 'HEAD'])
  fs.writeFileSync(path.join(fixture, 'platformkit.sites.json'), JSON.stringify({
    version: 1,
    sites: [{ name: 'external-site', remote: 'https://example.invalid/site.git', ref }],
  }))
  const fetchedScript = spawnSync(process.execPath, [KIT('bin/platformkit.mjs'), 'site-run', 'check-cwd'], {
    cwd: fixture, env: { ...env, PLATFORMKIT_DEFAULT_SITE: 'external-site' }, encoding: 'utf8',
  })
  assert.equal(fetchedScript.status, 0, fetchedScript.stderr)
  assert.equal(fetchedScript.stdout.trim().split('\n').at(-1), fs.realpathSync(managed))

  fs.writeFileSync(path.join(fixture, 'platformkit.sites.json'), JSON.stringify({
    version: 1,
    sites: [{ name: 'missing-site', remote: 'https://example.invalid/site.git', ref: 'a'.repeat(40) }],
  }))
  const unfetchedScript = spawnSync(process.execPath, [KIT('bin/platformkit.mjs'), 'site-run', 'check-cwd'], {
    cwd: fixture, env: { ...env, PLATFORMKIT_DEFAULT_SITE: 'missing-site' }, encoding: 'utf8',
  })
  assert.equal(unfetchedScript.status, 1)
  assert.match(unfetchedScript.stderr, /default site "missing-site" is registered but not fetched; run "platformkit sites fetch missing-site"/)

  fs.rmSync(path.join(fixture, 'sites'), { recursive: true, force: true })
  const dev = spawnSync(process.execPath, [KIT('bin/platformkit.mjs'), 'dev'], {
    cwd: fixture, env, encoding: 'utf8',
  })
  assert.equal(dev.status, 1, dev.stdout)
  assert.match(dev.stderr, /default site "docs" was not found/)
  assert.doesNotMatch(dev.stderr, /holds no platformkit\.config\.js/)

  const build = spawnSync(process.execPath, [KIT('bin/platformkit.mjs'), 'build'], {
    cwd: fixture, env, encoding: 'utf8',
  })
  assert.equal(build.status, 1, build.stdout)
  assert.match(build.stderr, /default site "docs" was not found/)
  console.log('workspace-root: 8 passed')
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
  fs.rmSync(installedFixture, { recursive: true, force: true })
}

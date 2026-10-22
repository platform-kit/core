import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertPlatformKitForDeploy, assertPlatformKitPins, platformKitPins } from './deploy-pins.mjs'
import { installPlatformKitSource } from './source-install.mjs'

/* one package: the engine with its theme inside it */
const names = ['platformkit']

function writeFixture(root, { versions = ['0.1.0', '0.1.0'], rootVersions = versions, lockVersions = versions, resolved = true, linked = false } = {}) {
  const dependencies = Object.fromEntries(names.map((name, index) => [name, versions[index]]))
  const lockedDependencies = Object.fromEntries(names.map((name, index) => [name, rootVersions[index]]))
  const packages = Object.fromEntries(names.map((name, index) => [
    `node_modules/${name}`,
    {
      version: lockVersions[index],
      ...(resolved ? { resolved: `https://registry.npmjs.org/${encodeURIComponent(name)}/-/${name.split('/').at(-1)}-${lockVersions[index]}.tgz` } : {}),
      integrity: 'sha512-cGxhdGZvcm1raXQ=',
      ...(linked ? { link: true } : {}),
    },
  ]))

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies }, null, 2))
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
    name: 'site-fixture',
    lockfileVersion: 3,
    packages: {
      '': { dependencies: lockedDependencies },
      ...packages,
    },
  }, null, 2))
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'platformkit-deploy-pins-'))
try {
  writeFixture(root)
  assert.deepEqual(assertPlatformKitPins(root), names.map((name) => ({ name, version: '0.1.0' })))
  assert.deepEqual(assertPlatformKitForDeploy(root), {
    kind: 'release',
    packages: names.map((name) => ({ name, version: '0.1.0' })),
  })

  fs.rmSync(path.join(root, 'package-lock.json'))
  assert.match(platformKitPins(root).errors.join('\n'), /package-lock\.json: file is missing/)

  const refusedDeploy = spawnSync(process.execPath, [fileURLToPath(new URL('./deploy.mjs', import.meta.url))], {
    cwd: root,
    env: { ...process.env, DEPLOY: '1', CI: '' },
    encoding: 'utf8',
  })
  assert.equal(refusedDeploy.status, 1)
  assert.match(refusedDeploy.stderr, /PlatformKit installation is not deployable/)
  assert.match(refusedDeploy.stderr, /package-lock\.json: file is missing/)
  assert.doesNotMatch(refusedDeploy.stdout, /Deploying to Supabase|npx supabase/)

  writeFixture(root, { versions: ['^0.1.0', '0.1.0'] })
  assert.match(platformKitPins(root).errors.join('\n'), /platformkit must be a direct dependency pinned to an exact release version/)

  writeFixture(root, { versions: ['0.1.1', '0.1.0'], rootVersions: ['0.1.0', '0.1.0'], lockVersions: ['0.1.0', '0.1.0'] })
  assert.match(platformKitPins(root).errors.join('\n'), /root dependency platformkit is 0\.1\.0, expected 0\.1\.1/)

  writeFixture(root, { lockVersions: ['0.1.1', '0.1.0'] })
  assert.match(platformKitPins(root).errors.join('\n'), /platformkit must resolve to the published version 0\.1\.0/)

  writeFixture(root, { linked: true })
  assert.match(platformKitPins(root).errors.join('\n'), /platformkit must resolve to the published version 0\.1\.0/)

  writeFixture(root, { resolved: false })
  assert.match(platformKitPins(root).errors.join('\n'), /platformkit@0\.1\.0 must resolve from an HTTPS package registry/)

  const source = path.join(root, 'source')
  fs.rmSync(path.join(root, 'node_modules'), { recursive: true, force: true })
  fs.mkdirSync(path.join(source, 'packages', 'kit'), { recursive: true })
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
    name: '@platform-kit/workspace',
    repository: 'github:platform-kit/core',
  }))
  for (const [index, name] of names.entries()) {
    const packageDirectory = path.join(source, 'packages', 'kit')
    fs.writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify({ name, version: '0.1.0' }))
    fs.writeFileSync(path.join(packageDirectory, 'index.js'), `export const fixture = ${index}\n`)
  }
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git(['init', '-q'])
  git(['config', 'user.name', 'PlatformKit Test'])
  git(['config', 'user.email', 'platformkit-test@example.invalid'])
  git(['remote', 'add', 'origin', 'https://github.com/platform-kit/core.git'])
  git(['add', '.'])
  git(['commit', '-qm', 'source fixture'])
  const sourceRef = git(['rev-parse', 'HEAD'])
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'site-fixture',
    dependencies: Object.fromEntries(names.map((name) => [name, '0.1.0'])),
  }))
  fs.rmSync(path.join(root, 'package-lock.json'), { force: true })
  const receipt = installPlatformKitSource(root, source)
  assert.equal(receipt.source.ref, sourceRef)
  assert.equal(receipt.source.clean, true)
  assert.deepEqual(assertPlatformKitForDeploy(root), { kind: 'source', source: receipt.source })

  const installedFile = path.join(root, 'node_modules', 'platformkit', 'index.js')
  fs.appendFileSync(installedFile, '// changed after setup\n')
  assert.throws(() => assertPlatformKitForDeploy(root), /platformkit differs from the recorded source installation/)

  console.log('deploy-pins.test.mjs: passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

/*
 * ONE PACKAGE (openspec: kit-cli, "PlatformKit is one package, run from npm or from GitHub"). PlatformKit is published as
 * `platformkit`, the engine with its default theme inside it, from this one repository. This holds it:
 *
 *   - no import, dependency or configuration outside history names the two retired packages;
 *   - the package npm would publish carries the command and the theme;
 *   - the command runs from the packed package, unpacked beside the workspace's dependencies.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KIT = path.resolve(HERE, '..')
const ROOT = path.resolve(KIT, '../..')
let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + String(detail).trim().split('\n').slice(0, 12).join('\n        ') : '')) } }

/* the retired names, outside history (the changes OpenSpec keeps, and the lockfile npm writes) */
const old = ['@platform-kit/' + 'kit', '@platform-kit/' + 'movable-types', 'packages/' + 'movable-types']
const grep = spawnSync('git', ['grep', '-n', '-I', ...old.flatMap((o) => ['-e', o]), '--', '.', ':!package-lock.json', ':!openspec/changes/**'], { cwd: ROOT, encoding: 'utf8' })
ok('no import, dependency or configuration names the retired packages', grep.status === 1 && !grep.stdout.trim(), grep.stdout)

const manifest = JSON.parse(fs.readFileSync(path.join(KIT, 'package.json'), 'utf8'))
ok('the package is platformkit', manifest.name === 'platformkit')
ok('…with its command', manifest.bin && manifest.bin.platformkit === './bin/platformkit.mjs', JSON.stringify(manifest.bin))
ok('…and the theme exported as platformkit/theme', manifest.exports && manifest.exports['./theme'] && manifest.exports['./theme/*'], JSON.stringify(Object.keys(manifest.exports || {})))

/* what npm would publish */
const packDir = path.join(ROOT, 'node_modules', '.cache', 'platformkit', 'one-package-test')
fs.rmSync(packDir, { recursive: true, force: true }); fs.mkdirSync(packDir, { recursive: true })
const pack = spawnSync('npm', ['pack', '--json', '--pack-destination', packDir], { cwd: KIT, encoding: 'utf8', maxBuffer: 1 << 26 })
let packed = null
try { packed = JSON.parse(pack.stdout)[0] } catch { /* below */ }
ok('npm packs it', pack.status === 0 && !!packed, (pack.stderr || '').slice(-600))
if (packed) {
  const files = new Set(packed.files.map((f) => f.path))
  ok('…with the command', files.has('bin/platformkit.mjs'))
  ok('…the theme', files.has('theme/src/main.js') && files.has('theme/src/theme.js'))
  /* unpacked inside the workspace, so it resolves its dependencies from the workspace's node_modules as an installed copy would from its own */
  const tar = spawnSync('tar', ['-xzf', path.join(packDir, packed.filename), '-C', packDir], { encoding: 'utf8' })
  ok('…and unpacks', tar.status === 0, tar.stderr)
  const help = spawnSync(process.execPath, [path.join(packDir, 'package', 'bin', 'platformkit.mjs'), '--help'], { cwd: packDir, encoding: 'utf8' })
  ok('the command runs from the packed package', help.status === 0 && /\bdev\b/.test(help.stdout), (help.stdout || '') + (help.stderr || ''))
}
fs.rmSync(packDir, { recursive: true, force: true })

console.log(fail ? `one-package: ${fail} failed, ${pass} passed` : `one-package: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)

/*
 * THE END-TO-END RUN'S CONTAINER (openspec: e2e-runs-in-a-container). Every end-to-end test runs inside an image built
 * for the run (docker/e2e.Dockerfile), never in the developer's checkout:
 *
 *   1. the build context is the project's files exactly as git lists them — tracked and new, never what .gitignore
 *      names (node_modules, builds, caches, generated data, settings) — with each fetched site's the same way and the
 *      site registry, streamed to `docker build` as a tar;
 *   2. the image installs the packages from scratch (npm ci) with Node and the browser pinned;
 *   3. a container of it starts with a Docker daemon of its own, so every stack the run starts lives inside it;
 *      the settings files (.env) are mounted read-only, never built into the image;
 *   4. the script runs inside (`docker exec`), its output streamed, its exit code returned; its logs are copied out to
 *      node_modules/.cache/platformkit/e2e/ and the container is removed, with everything in it — unless --keep.
 *
 * build/e2e.mjs and build/e2e-runner.test.mjs call runInContainer() before anything else; inside the container
 * (PLATFORMKIT_E2E_IN_CONTAINER=1) it returns and they run. Nothing here needs an installed package, so a fresh CI
 * machine needs only Node and Docker.
 *
 *   node build/e2e-container.mjs --install-fetched   (the image's build step: a fetched site's own dependencies)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sites as registeredSites, workspaceRoot } from './sites.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DOCKERFILE = path.join(HERE, '..', 'docker', 'e2e.Dockerfile')
const WORK = '/work'
const REGISTRY = 'platformkit.sites.json'
/* what the run reads from the environment it is started in; nothing else of the host's environment goes in */
const PASS = /^(STRIPE_SECRET_KEY|STRIPE_PUBLISHABLE_KEY|VITE_STRIPE_PUBLISHABLE_KEY|BROWSER_WAIT_MS|PLATFORMKIT_E2E_[A-Z_]+|PROBE_[A-Z_]+)$/

export const inContainer = () => process.env.PLATFORMKIT_E2E_IN_CONTAINER === '1'

const die = (m) => { console.error(`\n\x1b[31m✖\x1b[0m ${m}\n`); process.exit(1) }
const say = (m) => console.log(`\x1b[2m[e2e]\x1b[0m ${m}`)
const docker = (a, opts = {}) => spawnSync('docker', a, { encoding: 'utf8', ...opts })

/* the sites outside the workspace's own git: fetched checkouts under sites/external, each its own repository */
const fetchedSites = (root) => registeredSites(root).filter((s) => s.fetched !== false && s.directory.startsWith(path.join(root, 'sites', 'external') + path.sep) && fs.existsSync(s.directory))

function gitFiles(dir) {
  const r = spawnSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 })
  if (r.status !== 0) die(`could not list the files of ${dir} — the run's image is built from the files git lists:\n${r.stderr}`)
  return r.stdout.split('\0').filter(Boolean)
}

/* every file the image is built from, relative to the project root */
function contextFiles(root) {
  const files = gitFiles(root)
  for (const s of fetchedSites(root)) { const rel = path.relative(root, s.directory); files.push(...gitFiles(s.directory).map((f) => path.join(rel, f))) }
  if (fs.existsSync(path.join(root, REGISTRY))) files.push(REGISTRY)
  const dockerfile = path.relative(root, DOCKERFILE)
  if (!files.includes(dockerfile)) files.push(dockerfile) // the kit installed as a package, under node_modules
  /* a tracked file deleted in the working tree is not there to send */
  return [...new Set(files)].filter((f) => { try { fs.lstatSync(path.join(root, f)); return true } catch { return false } })
}

/* the settings files the run reads — the workspace's and every site's — mounted read-only at the same place */
function settingsMounts(root) {
  const dirs = [root, ...registeredSites(root).map((s) => s.directory)]
  const out = []
  for (const d of new Set(dirs)) {
    if (!fs.existsSync(d)) continue
    for (const f of fs.readdirSync(d)) if (/^\.env(\..+)?$/.test(f) && f !== '.env.example' && fs.statSync(path.join(d, f)).isFile()) out.push(['-v', `${path.join(d, f)}:${path.posix.join(WORK, path.relative(root, d).split(path.sep).join('/'), f)}:ro`])
  }
  return out.flat()
}

function buildImage(root, image) {
  const list = path.join(os.tmpdir(), `platformkit-e2e-${process.pid}.files`)
  const files = contextFiles(root)
  fs.writeFileSync(list, files.join('\0') + '\0')
  say(`building the test image from ${files.length} files (git's list: no node_modules, builds, caches or settings)`)
  const darwin = process.platform === 'darwin'
  return new Promise((resolve) => {
    const tar = spawn('tar', ['-c', '-f', '-', ...(darwin ? ['--no-mac-metadata', '--no-xattrs'] : []), '--null', '-T', list], { cwd: root, env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: ['ignore', 'pipe', 'inherit'] })
    const build = spawn('docker', ['build', '-f', path.relative(root, DOCKERFILE).split(path.sep).join('/'), '-t', image, '-'], { stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, DOCKER_BUILDKIT: '1' } })
    tar.stdout.pipe(build.stdin)
    build.on('exit', (code) => { fs.rmSync(list, { force: true }); resolve(code === 0) })
  })
}

/*
 * Runs `script` (a file in the project) with `args` inside the run's container, and exits with its code. Inside the
 * container it returns at once, and the caller runs.
 */
export async function runInContainer(script, args) {
  if (inContainer()) return
  const root = workspaceRoot(process.cwd())
  const keep = args.includes('--keep')
  if (spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 20000 }).status !== 0) die('Docker is not answering — the end-to-end run builds its image and runs in Docker (start Docker, or restart OrbStack)')
  const inside = (p) => {
    const rel = path.relative(root, p)
    if (rel.startsWith('..') || path.isAbsolute(rel)) die(`${p} is not in the project, and the run sees only the project's files`)
    return path.posix.join(WORK, rel.split(path.sep).join('/'))
  }
  /* a path argument names the same file inside */
  const mapped = args.map((a) => (path.isAbsolute(a) && fs.existsSync(a) ? inside(a) : a))
  const id = path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + crypto.createHash('sha1').update(root).digest('hex').slice(0, 8)
  const name = `platformkit-e2e-${id}`
  const image = `platformkit-e2e:${id}`

  /* one run per checkout: an earlier run's container (kept, or left by a crash) goes first */
  docker(['rm', '-f', name])
  if (!(await buildImage(root, image))) die('the test image would not build (the output above says why)')

  const run = docker(['run', '-d', '--privileged', '--name', name, '-v', `${name}-docker:/var/lib/docker`, ...settingsMounts(root), image])
  if (run.status !== 0) die(`the test container would not start:\n${run.stderr}`)
  const remove = () => { if (!keep) docker(['rm', '-f', name]) }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { docker(['rm', '-f', name]); process.exit(130) })

  const env = Object.entries(process.env).filter(([k]) => PASS.test(k)).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  const cwd = (() => { const rel = path.relative(root, process.cwd()); return rel.startsWith('..') ? WORK : path.posix.join(WORK, rel.split(path.sep).join('/')) })()
  /* the daemon is up before the script starts: the container's own entry waits for it, an exec does not */
  const wait = 'i=0; until docker info >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 120 ] && { echo "the container\'s Docker daemon did not start" >&2; tail -20 /var/log/dockerd.log >&2; exit 1; }; sleep 1; done; exec "$@"'
  const code = await new Promise((resolve) => {
    const p = spawn('docker', ['exec', ...env, '-w', cwd, name, 'sh', '-c', wait, 'sh', 'node', inside(path.resolve(script)), ...mapped], { stdio: 'inherit' })
    p.on('exit', (c) => resolve(c ?? 1))
  })

  /* the run's logs, out where they always were */
  const logs = path.join(root, 'node_modules', '.cache', 'platformkit', 'e2e')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'platformkit-e2e-logs-'))
  fs.mkdirSync(logs, { recursive: true })
  docker(['cp', `${name}:${WORK}/node_modules/.cache/platformkit/e2e/.`, out])
  for (const f of fs.readdirSync(out)) if (f.endsWith('.log')) fs.copyFileSync(path.join(out, f), path.join(logs, f))
  fs.rmSync(out, { recursive: true, force: true })
  if (keep) say(`kept: the container ${name}, with every stack in it — docker exec -it ${name} bash; docker rm -f ${name} removes it`)
  remove()
  process.exit(code)
}

/* the image's build step: what a fetched site needs beyond the workspace's install, at the version its package.json asks */
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)) && process.argv.includes('--install-fetched')) {
  const root = workspaceRoot(process.cwd())
  const extra = new Set()
  for (const s of fetchedSites(root)) {
    const deps = JSON.parse(fs.readFileSync(path.join(s.directory, 'package.json'), 'utf8')).dependencies || {}
    for (const [dep, range] of Object.entries(deps)) if (dep !== 'platformkit' && !fs.existsSync(path.join(root, 'node_modules', dep)) && !fs.existsSync(path.join(s.directory, 'node_modules', dep))) extra.add(`${dep}@${range}`)
  }
  if (extra.size) {
    console.log(`installing what the fetched sites need beyond the workspace: ${[...extra].join(', ')}`)
    const r = spawnSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', ...extra], { cwd: root, stdio: 'inherit' })
    process.exit(r.status ?? 1)
  }
}

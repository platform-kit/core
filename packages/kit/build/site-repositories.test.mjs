import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defaultSite, fetchSite, gitEnvironmentForRemote, readSiteRegistry, siteGitUrlVariable, siteNameFor, sites, updateSite } from './sites.mjs'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'platformkit-site-repositories-'))
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const git = (cwd, args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `${args.join(' ')} failed:\n${result.stderr}`)
  return result.stdout.trim()
}

let pass = 0
const test = (name, run) => {
  run()
  pass++
  console.log(`site-repositories: ✓ ${name}`)
}

try {
  test('the machine-local registry and managed checkouts are gitignored', () => {
    const ignored = spawnSync('git', ['check-ignore', '--no-index', '-v', 'platformkit.sites.json', 'sites/external/sample-site'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    assert.equal(ignored.status, 0, ignored.stderr || ignored.stdout)
    assert.match(ignored.stdout, /platformkit\.sites\.json/)
    assert.match(ignored.stdout, /sites\/external/)
  })

  const root = path.join(fixture, 'workspace')
  const source = path.join(fixture, 'source')
  const remote = path.join(fixture, 'site.git')
  fs.mkdirSync(path.join(root, 'packages', 'kit'), { recursive: true })
  fs.mkdirSync(source, { recursive: true })
  fs.writeFileSync(path.join(source, 'package.json'), '{"name":"@fixture/site","type":"module"}\n')
  fs.writeFileSync(path.join(source, 'platformkit.config.js'), 'export default {}\n')
  git(source, ['init', '-q'])
  git(source, ['config', 'user.name', 'PlatformKit Test'])
  git(source, ['config', 'user.email', 'platformkit-test@example.invalid'])
  git(source, ['add', '.'])
  git(source, ['commit', '-qm', 'first site revision'])
  const first = git(source, ['rev-parse', 'HEAD'])
  fs.writeFileSync(path.join(source, 'revision.txt'), 'second\n')
  git(source, ['add', '.'])
  git(source, ['commit', '-qm', 'second site revision'])
  const second = git(source, ['rev-parse', 'HEAD'])
  git(fixture, ['clone', '-q', '--bare', source, remote])
  const fileRemote = new URL(`file://${remote}`).href

  test('fetch registers an exact revision without adding tracked workspace files', () => {
    const fetched = fetchSite(root, { name: 'sample-site', remote: fileRemote, ref: first })
    assert.equal(fetched.ref, first)
    assert.equal(git(fetched.directory, ['rev-parse', 'HEAD']), first)
    assert.deepEqual(readSiteRegistry(root), { version: 1, sites: [{ name: 'sample-site', remote: fileRemote, ref: first }] })
    assert.equal(sites(root).find(({ name }) => name === 'sample-site').directory, fetched.directory)
    assert.equal(siteNameFor(root, fetched.directory), 'sample-site')
    assert.deepEqual(fs.readdirSync(root).sort(), ['packages', 'platformkit.sites.json', 'sites'])
  })

  test('fetch reads a per-site URL from the environment and keeps GitHub credentials out of the registry', () => {
    const urlVariable = siteGitUrlVariable('env-site')
    const token = 'fixture-secret-token'
    const env = { ...process.env, [urlVariable]: fileRemote, PLATFORMKIT_GITHUB_TOKEN: token }
    const fetched = fetchSite(root, { name: 'env-site', ref: first, env })
    const registration = readSiteRegistry(root).sites.find((site) => site.name === 'env-site')
    assert.equal(fetched.remote, fileRemote)
    assert.equal(registration.remote, fileRemote)
    assert.equal(JSON.stringify(registration).includes(token), false)
    assert.equal(gitEnvironmentForRemote(fileRemote, env).PLATFORMKIT_GITHUB_TOKEN, undefined)
    const authenticated = gitEnvironmentForRemote('https://github.com/example/private.git', env)
    const configIndex = Number(env.GIT_CONFIG_COUNT || 0)
    assert.equal(authenticated[`GIT_CONFIG_VALUE_${configIndex}`], '')
    const header = authenticated[`GIT_CONFIG_VALUE_${configIndex + 1}`]
    assert.match(header, /AUTHORIZATION: basic/)
    assert.equal(header.includes(token), false)
    assert.equal(authenticated.PLATFORMKIT_GITHUB_TOKEN, undefined)
    const gitConfig = spawnSync('git', ['config', '--get-all', 'http.https://github.com/.extraheader'], { encoding: 'utf8', env: authenticated })
    assert.equal(gitConfig.status, 0, gitConfig.stderr)
    assert.equal(gitConfig.stdout.trim().split('\n').at(-1), header)
  })

  test('an update changes the checkout and its pin only to the requested commit', () => {
    const updated = updateSite(root, { name: 'sample-site', ref: second })
    assert.equal(git(updated.directory, ['rev-parse', 'HEAD']), second)
    assert.equal(readSiteRegistry(root).sites[0].ref, second)
  })

  test('a registered checkout can be fetched again at its current pin and missing sites are listed explicitly', () => {
    const registeredDirectory = path.join(root, 'sites', 'external', 'sample-site')
    fs.rmSync(registeredDirectory, { recursive: true, force: true })
    const missing = sites(root).find(({ name }) => name === 'sample-site')
    assert.equal(missing.fetched, false)
    assert.equal(missing.ref, second)
    const fetched = fetchSite(root, { name: 'sample-site' })
    assert.equal(git(fetched.directory, ['rev-parse', 'HEAD']), second)
    assert.equal(readSiteRegistry(root).sites[0].ref, second)
  })

  test('a dirty checkout is refused without changing its worktree or registered pin', () => {
    const directory = path.join(root, 'sites', 'external', 'sample-site')
    const untracked = path.join(directory, 'local.txt')
    fs.writeFileSync(untracked, 'keep me\n')
    assert.throws(() => updateSite(root, { name: 'sample-site', ref: first }), /refusing to update.*local changes/)
    assert.equal(git(directory, ['rev-parse', 'HEAD']), second)
    assert.equal(fs.readFileSync(untracked, 'utf8'), 'keep me\n')
    assert.equal(readSiteRegistry(root).sites[0].ref, second)
  })

  test('an unavailable commit fails without changing the checkout or pin', () => {
    const directory = path.join(root, 'sites', 'external', 'sample-site')
    fs.rmSync(path.join(directory, 'local.txt'))
    const unavailable = 'f'.repeat(40)
    assert.throws(() => updateSite(root, { name: 'sample-site', ref: unavailable }), /fetch revision .* failed|not available as a commit/)
    assert.equal(git(directory, ['rev-parse', 'HEAD']), second)
    assert.equal(readSiteRegistry(root).sites[0].ref, second)
  })

  test('registry and pin validation reject malformed and credential-bearing entries', () => {
    assert.throws(() => fetchSite(root, { name: 'Bad_Name', remote: fileRemote, ref: first }), /legal DNS label/)
    assert.throws(() => fetchSite(root, { name: 'other-site', remote: fileRemote, ref: 'main' }), /full 40-character commit SHA/)
    assert.throws(() => fetchSite(root, { name: 'other-site', remote: 'https://user:secret@example.invalid/site.git', ref: first }), /without embedded credentials/)
    const registryPath = path.join(root, 'platformkit.sites.json')
    fs.writeFileSync(registryPath, JSON.stringify({ version: 1, sites: [{ name: 'bad_name', remote: fileRemote, ref: first }] }))
    assert.throws(() => readSiteRegistry(root), /not a legal DNS label/)
    fs.rmSync(registryPath)
  })

  test('a failed initial fetch leaves neither a registered pin nor a partial checkout', () => {
    const name = 'missing-site'
    assert.throws(() => fetchSite(root, { name, remote: fileRemote, ref: 'f'.repeat(40) }))
    assert.equal(fs.existsSync(path.join(root, 'sites', 'external', name)), false)
    assert.equal(readSiteRegistry(root).sites.some((site) => site.name === name), false)
  })

  test('the default site accepts a path or name and falls back to sites/docs', () => {
    for (const name of ['docs', 'brochure']) {
      const directory = path.join(root, 'sites', name)
      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(path.join(directory, 'package.json'), '{"name":"@fixture/site"}\n')
      fs.writeFileSync(path.join(directory, 'platformkit.config.js'), 'export default {}\n')
    }
    const docs = path.join(root, 'sites', 'docs')
    const brochure = path.join(root, 'sites', 'brochure')
    assert.equal(defaultSite(root, {}).directory, docs)
    assert.equal(defaultSite(root, { PLATFORMKIT_DEFAULT_SITE: 'docs' }).directory, docs)
    assert.equal(defaultSite(root, { PLATFORMKIT_DEFAULT_SITE: 'sites/brochure' }).directory, brochure)
    const linked = path.join(fixture, 'linked-site')
    fs.mkdirSync(linked)
    fs.writeFileSync(path.join(linked, 'package.json'), '{"name":"@fixture/linked-site"}\n')
    fs.writeFileSync(path.join(linked, 'platformkit.config.js'), 'export default {}\n')
    assert.equal(defaultSite(root, { PLATFORMKIT_DEFAULT_SITE: linked }).directory, linked)
  })


  test('a checkout ahead of its pin runs and is reported; it re-pins forward once pushed; anything else is refused', () => {
    const at = fetchSite(root, { name: 'ahead-site', remote: fileRemote, ref: first })
    git(at.directory, ['config', 'user.name', 'PlatformKit Test'])
    git(at.directory, ['config', 'user.email', 'platformkit-test@example.invalid'])
    git(at.directory, ['checkout', '-q', '-b', 'work'])
    fs.writeFileSync(path.join(at.directory, 'local.txt'), 'worked on here first\n')
    git(at.directory, ['add', '.'])
    git(at.directory, ['commit', '-qm', 'a local commit, not pushed'])
    const local = git(at.directory, ['rev-parse', 'HEAD'])
    const listed = sites(root).find(({ name }) => name === 'ahead-site')
    assert.equal(listed.ahead, 1)
    assert.equal(listed.ref, first)
    /* a pin the local commit is not part of would strand it */
    assert.throws(() => updateSite(root, { name: 'ahead-site', ref: second }), /would be left behind/)
    assert.equal(git(at.directory, ['rev-parse', 'HEAD']), local)
    /* pushed, it pins forward with the checkout untouched */
    git(at.directory, ['push', '-q', fileRemote, 'work'])
    const repinned = updateSite(root, { name: 'ahead-site', ref: local })
    assert.equal(repinned.ref, local)
    assert.equal(git(at.directory, ['rev-parse', 'HEAD']), local)
    assert.equal(sites(root).find(({ name }) => name === 'ahead-site').ahead, 0)
    /* a checkout off the pin's line is refused */
    git(at.directory, ['checkout', '-q', '--orphan', 'elsewhere'])
    git(at.directory, ['commit', '-qm', 'an unrelated line'])
    assert.throws(() => sites(root), /neither its registered pin .* nor a commit on top of it/)
    git(at.directory, ['checkout', '-q', '--detach', local])
  })
  console.log(`site-repositories: ${pass} passed`)
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}

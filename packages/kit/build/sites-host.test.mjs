import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sites, siteNameFor, siteEnvSuffix, workspaceRoot } from './sites.mjs'
import { configureHosts, renderHostConfig, renderSiteIncludes } from './hosts.mjs'
import { platformkitRuntimePath } from './runtime-paths.mjs'

const ROOT = workspaceRoot(process.cwd())
const KIT = (file) => fileURLToPath(new URL('../' + file, import.meta.url))
let pass = 0
const test = (name, run) => {
  run()
  pass++
}

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'platformkit-sites-'))
try {
  fs.mkdirSync(path.join(fixture, 'packages', 'kit'), { recursive: true })
  fs.mkdirSync(path.join(fixture, 'sites', 'docs'), { recursive: true })
  fs.mkdirSync(path.join(fixture, 'sites', 'demo'), { recursive: true })
  fs.mkdirSync(path.join(fixture, 'sites', 'not-a-site'), { recursive: true })
  fs.writeFileSync(path.join(fixture, 'platformkit.config.js'), 'export default {}\n')
  fs.writeFileSync(path.join(fixture, 'sites', 'docs', 'package.json'), '{}')
  fs.writeFileSync(path.join(fixture, 'sites', 'demo', 'package.json'), '{}')
  fs.writeFileSync(path.join(fixture, 'sites', 'not-a-site', 'README.md'), '')

  test('root and package sites are discovered in stable name order', () => {
    assert.deepEqual(sites(fixture, { PLATFORMKIT_ROOT_SITE: 'sample' }).map(({ name, root }) => [name, root]), [
      ['sample', true], ['demo', false], ['docs', false],
    ])
  })
  test('root sites stay absent unless explicitly named', () => {
    assert.deepEqual(sites(fixture, {}).map(({ name }) => name), ['demo', 'docs'])
  })
  test('a workspace without a root site config does not register a named root site', () => {
    fs.rmSync(path.join(fixture, 'platformkit.config.js'))
    assert.deepEqual(sites(fixture, { PLATFORMKIT_ROOT_SITE: 'sample' }).map(({ name }) => name), ['demo', 'docs'])
    assert.equal(siteNameFor(fixture, fixture, { PLATFORMKIT_ROOT_SITE: 'sample' }), null)
    fs.writeFileSync(path.join(fixture, 'platformkit.config.js'), 'export default {}\n')
  })
  test('the selected site list narrows the checkout', () => {
    assert.deepEqual(sites(fixture, { PLATFORMKIT_ROOT_SITE: 'sample', PLATFORMKIT_SITES: 'docs,sample' }).map(({ name }) => name), ['sample', 'docs'])
  })
  test('an empty optional site filter leaves development discovery unrestricted', () => {
    assert.deepEqual(sites(fixture, { PLATFORMKIT_SITES: '' }).map(({ name }) => name), ['demo', 'docs'])
  })
  test('invalid directory names are refused rather than skipped', () => {
    fs.mkdirSync(path.join(fixture, 'sites', 'bad_name'), { recursive: true })
    fs.writeFileSync(path.join(fixture, 'sites', 'bad_name', 'package.json'), '{}')
    assert.throws(() => sites(fixture, {}), /sites\/bad_name.*not a legal DNS label/)
    fs.rmSync(path.join(fixture, 'sites', 'bad_name'), { recursive: true, force: true })
  })
  test('unknown selected sites are named', () => {
    assert.throws(() => sites(fixture, { PLATFORMKIT_SITES: 'missing' }), /PLATFORMKIT_SITES names "missing"/)
  })
  test('the root cannot duplicate a subsite name', () => {
    assert.throws(() => sites(fixture, { PLATFORMKIT_ROOT_SITE: 'demo' }), /site name "demo" is declared more than once/)
  })
  test('site names map predictably to environment-variable suffixes', () => {
    assert.equal(siteEnvSuffix('docs-preview'), 'DOCS_PREVIEW')
  })
  test('site names resolve from the checkout root and its site directories', () => {
    assert.equal(siteNameFor(fixture, path.join(fixture, 'sites', 'docs'), {}), 'docs')
    assert.equal(siteNameFor(fixture, fixture, { PLATFORMKIT_ROOT_SITE: 'sample' }), 'sample')
    assert.equal(siteNameFor(fixture, fixture, {}), null)
  })
  test('workspace root is found from inside a site', () => {
    assert.equal(workspaceRoot(path.join(fixture, 'sites', 'docs')), fixture)
  })
  test('platformkit sites reads the shared function', () => {
    const env = { ...process.env }
    delete env.PLATFORMKIT_ROOT_SITE
    env.PLATFORMKIT_SITES = 'brochure,demo,docs'
    const cli = spawnSync(process.execPath, [KIT('bin/platformkit.mjs'), 'sites', '--json'], { cwd: ROOT, env, encoding: 'utf8' })
    assert.equal(cli.status, 0, cli.stderr)
    const entries = JSON.parse(cli.stdout)
    assert.deepEqual(entries.map(({ name }) => name), ['brochure', 'demo', 'docs'])
    assert.equal(entries.find(({ name }) => name === 'docs').directory, path.join(ROOT, 'sites', 'docs'))
    assert.equal(entries.find(({ name }) => name === 'docs').dist, path.join(ROOT, 'sites', 'docs', 'dist'))
  })
  test('an unset domain preserves the legacy nginx template byte for byte', () => {
    const template = fs.readFileSync(path.join(ROOT, 'deploy/nginx/templates/default.conf.template'), 'utf8')
    const result = configureHosts({ root: fixture, domain: '', legacyTemplate: path.join(ROOT, 'deploy/nginx/templates/default.conf.template') })
    assert.equal(result.changed, false)
    assert.equal(result.config, template)
  })
  test('the localhost auth allow-list accepts site subdomains', () => {
    for (const configPath of ['sites/demo/supabase/config.toml']) {
      const config = fs.readFileSync(path.join(ROOT, configPath), 'utf8')
      assert.match(config, /"http:\/\/\*\.localhost"/, `${configPath} permits subdomain callbacks`)
      assert.match(config, /"http:\/\/\*\.localhost\/\*\*"/, `${configPath} permits callback paths`)
      assert.match(config, /"http:\/\/\*\.localhost:\*"/, `${configPath} permits the selected front-door port`)
      assert.match(config, /"http:\/\/\*\.localhost:\*\/\*\*"/, `${configPath} permits callback paths on the selected port`)
    }
  })
  test('files mode creates one isolated server block per selected site and a named apex', () => {
    const selected = [
      { name: 'demo', backend: true },
      { name: 'docs', backend: false },
      { name: 'sample', root: true, backend: true },
    ]
    const config = renderHostConfig({
      sites: selected,
      domain: 'platformkit.test',
      apex: 'sample',
      env: { SUPABASE_URL_DEMO: 'https://demo-project.supabase.co', SUPABASE_URL_SAMPLE: 'https://root-project.supabase.co' },
    })
    assert.equal(config, fs.readFileSync(KIT('build/fixtures/sites-host.files.conf'), 'utf8'), 'files mode matches its three-site snapshot')
    for (const name of ['demo', 'docs', 'sample']) assert.ok(config.includes(`server_name ${name}.platformkit.test`), `${name} has its own host`)
    assert.ok(config.includes('server_name sample.platformkit.test platformkit.test;'), 'the named site also answers the apex')
    assert.ok(config.includes('server_name www.platformkit.test;') && config.includes('$scheme://sample.platformkit.test$request_uri'), 'www redirects to the named apex')
    assert.ok(config.includes('root /srv/sites/demo;') && config.includes('root /srv/sites/docs;'), 'each site has an independent document root')
    assert.ok(!config.includes('brochure.platformkit.test'), 'an unselected site cannot answer')
    const demoBlock = config.slice(config.indexOf('server_name demo.platformkit.test'), config.indexOf('server_name docs.platformkit.test'))
    assert.ok(demoBlock.includes('rewrites.demo.inc') && !demoBlock.includes('rewrites.docs.inc'), 'a host includes only its own rewrite file')
    assert.ok(!config.includes('rewrites.docs.inc'), 'the no-backend docs host has no Supabase rewrite include')
  })
  test('an unnamed apex and www are explicitly refused', () => {
    const config = renderHostConfig({ sites: [{ name: 'demo', backend: false }], domain: 'platformkit.test' })
    assert.ok(config.includes('server_name platformkit.test www.platformkit.test;\n  return 404;'))
  })
  test('the explicit proxy-mode development opt-in serves only the unqualified root host', () => {
    const config = renderHostConfig({
      sites: [{ name: 'demo', backend: false }],
      domain: 'localhost',
      mode: 'proxy',
      ports: { demo: 5173 },
      env: { PLATFORMKIT_DEV_DIRECTORY: '1', PLATFORMKIT_DEV_DIRECTORY_PORT: '5300' },
    })
    assert.match(config, /server_name localhost;\s+location \/\s+\{\s+proxy_pass http:\/\/host\.docker\.internal:5300;/)
    assert.match(config, /server_name www\.localhost;\s+return 404;/)
    assert.match(config, /server_name demo\.localhost;/)
    assert.match(config, /proxy_pass http:\/\/host\.docker\.internal:5173;/)
  })
  test('proxy mode accepts selected fetched sites absent from the front-door image', () => {
    const portFile = platformkitRuntimePath(fixture, 'dev', 'dharmalab-site.port')
    fs.mkdirSync(path.dirname(portFile), { recursive: true })
    fs.writeFileSync(portFile, '5176\n')
    const result = configureHosts({
      root: fixture,
      output: path.join(fixture, 'conf'),
      templateDir: path.join(fixture, 'templates'),
      env: {
        PLATFORMKIT_DOMAIN: 'localhost',
        PLATFORMKIT_SITES: 'docs,dharmalab-site',
        PLATFORMKIT_SITES_MODE: 'proxy',
      },
    })
    assert.match(result.config, /server_name dharmalab-site\.localhost;/)
    assert.match(result.config, /proxy_pass http:\/\/host\.docker\.internal:5176;/)
  })
  test('the development directory opt-in cannot change file-mode or default production apex behavior', () => {
    const env = { PLATFORMKIT_DEV_DIRECTORY: '1', PLATFORMKIT_DEV_DIRECTORY_PORT: '5300' }
    const files = renderHostConfig({ sites: [{ name: 'demo', backend: false }], domain: 'platformkit.test', env })
    const proxyWithoutOptIn = renderHostConfig({
      sites: [{ name: 'demo', backend: false }],
      domain: 'platformkit.test',
      mode: 'proxy',
      ports: { demo: 5173 },
      env: {},
    })
    assert.doesNotMatch(files, /server_name platformkit\.test;\s+location \//)
    assert.match(files, /server_name platformkit\.test www\.platformkit\.test;\s+return 404;/)
    assert.match(proxyWithoutOptIn, /server_name platformkit\.test www\.platformkit\.test;\s+return 404;/)
    assert.throws(() => renderHostConfig({
      sites: [{ name: 'demo', backend: false }],
      domain: 'localhost',
      mode: 'proxy',
      env: { PLATFORMKIT_DEV_DIRECTORY: '1', PLATFORMKIT_DEV_DIRECTORY_PORT: 'invalid' },
    }), /PLATFORMKIT_DEV_DIRECTORY_PORT must be a valid port/)
  })
  test('a package site can serve the workspace apex', () => {
    const config = renderHostConfig({
      sites: [{ name: 'demo', backend: true }],
      domain: 'example.test',
      apex: 'demo',
      env: { SUPABASE_URL_DEMO: 'https://project.supabase.co' },
    })
    assert.ok(config.includes('server_name demo.example.test example.test;'))
    assert.ok(config.includes('root /srv/sites/demo;'))
    assert.ok(!config.includes('root /srv/sites/.'))
  })
  test('TLS is used only with a certificate pair and www follows the selected apex', () => {
    const config = renderHostConfig({
      sites: [{ name: 'demo', backend: false }],
      domain: 'platformkit.test',
      apex: 'demo',
      tls: true,
    })
    assert.ok(config.includes('listen 443 ssl;') && config.includes('/etc/nginx/certs/fullchain.pem'))
    assert.ok(config.includes('return 301 https://demo.platformkit.test$request_uri;'))
    const plain = renderHostConfig({ sites: [{ name: 'demo', backend: false }], domain: 'platformkit.test' })
    assert.ok(!plain.includes('listen 443 ssl;'))
  })
  test('invalid host names and an apex outside the published set are rejected', () => {
    assert.throws(() => renderHostConfig({ sites: [{ name: 'demo' }], domain: 'https://localhost' }), /not a valid domain name/)
    assert.throws(() => renderHostConfig({ sites: [{ name: 'demo' }], domain: 'localhost', apex: 'missing' }), /not in the selected site list/)
  })
  test('files mode requires an explicit publish list', () => {
    assert.throws(() => configureHosts({
      root: fixture,
      env: { PLATFORMKIT_DOMAIN: 'platformkit.test', PLATFORMKIT_SITES_MODE: 'files' },
    }), /files mode requires PLATFORMKIT_SITES/)
  })
  test('the runtime files host writes isolated rewrites and copies the chosen site dist', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'platformkit-file-host-'))
    try {
      const dist = path.join(root, 'sites', 'demo', 'dist')
      const templates = path.join(root, 'templates')
      const output = path.join(root, 'conf')
      const sitesOutput = path.join(root, 'static')
      fs.mkdirSync(dist, { recursive: true })
      fs.mkdirSync(templates, { recursive: true })
      fs.writeFileSync(path.join(root, 'sites', 'demo', 'package.json'), '{}')
      fs.writeFileSync(path.join(dist, 'index.html'), '<main>demo</main>')
      fs.writeFileSync(path.join(templates, 'rewrites.demo.inc.template'), 'proxy_pass ${SUPABASE_URL}/functions/v1/content/;\ninclude /etc/nginx/conf.d/functions-proxy.inc;\n')
      fs.writeFileSync(path.join(templates, 'functions-proxy.inc.template'), 'proxy_set_header Host ${SUPABASE_HOST};\n')
      const result = configureHosts({
        root,
        output,
        templateDir: templates,
        sitesOutput,
        env: { PLATFORMKIT_DOMAIN: 'platformkit.test', PLATFORMKIT_SITES: 'demo', SUPABASE_URL_DEMO: 'https://demo.supabase.co' },
      })
      assert.ok(result.config.includes('server_name demo.platformkit.test;'))
      assert.equal(fs.readFileSync(path.join(output, 'rewrites.demo.inc'), 'utf8'), 'proxy_pass https://demo.supabase.co/functions/v1/content/;\ninclude /etc/nginx/conf.d/functions-proxy.demo.inc;\n')
      assert.equal(fs.readFileSync(path.join(output, 'functions-proxy.demo.inc'), 'utf8'), 'proxy_set_header Host demo.supabase.co;\n')
      assert.equal(fs.readFileSync(path.join(sitesOutput, 'demo', 'index.html'), 'utf8'), '<main>demo</main>')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
  test('a named root site uses the legacy root rewrite template for its isolated backend include', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'platformkit-root-host-'))
    try {
      const dist = path.join(root, 'dist')
      const templates = path.join(root, 'templates')
      const output = path.join(root, 'conf')
      const sitesOutput = path.join(root, 'static')
      fs.mkdirSync(dist, { recursive: true })
      fs.mkdirSync(path.join(root, 'sites'), { recursive: true })
      fs.mkdirSync(templates, { recursive: true })
      fs.writeFileSync(path.join(root, 'platformkit.config.js'), 'export default {}\n')
      fs.writeFileSync(path.join(dist, 'index.html'), '<main>root</main>')
      fs.writeFileSync(path.join(templates, 'rewrites.inc.template'), 'proxy_pass ${SUPABASE_URL}/functions/v1/content/;\ninclude /etc/nginx/conf.d/functions-proxy.inc;\n')
      fs.writeFileSync(path.join(templates, 'functions-proxy.inc.template'), 'proxy_set_header Host ${SUPABASE_HOST};\n')
      const result = configureHosts({
        root,
        output,
        templateDir: templates,
        sitesOutput,
        rootDist: dist,
        env: {
          PLATFORMKIT_DOMAIN: 'platformkit.test',
          PLATFORMKIT_ROOT_SITE: 'sample',
          PLATFORMKIT_SITES: 'sample',
          SUPABASE_URL_SAMPLE: 'https://root-project.supabase.co',
        },
      })
      assert.ok(result.config.includes('include /etc/nginx/conf.d/rewrites.sample.inc;'))
      assert.equal(fs.readFileSync(path.join(output, 'rewrites.sample.inc'), 'utf8'), 'proxy_pass https://root-project.supabase.co/functions/v1/content/;\ninclude /etc/nginx/conf.d/functions-proxy.sample.inc;\n')
      assert.equal(fs.readFileSync(path.join(output, 'functions-proxy.sample.inc'), 'utf8'), 'proxy_set_header Host root-project.supabase.co;\n')
      assert.equal(fs.readFileSync(path.join(sitesOutput, 'sample', 'index.html'), 'utf8'), '<main>root</main>')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
  test('a missing site Supabase URL fails before rendering its server', () => {
    assert.throws(() => renderHostConfig({
      sites: [{ name: 'demo', backend: true }],
      domain: 'localhost',
      env: {},
    }), /site demo requires SUPABASE_URL_DEMO/)
  })
  test('proxy mode forwards the HMR websocket and explains a site without a port', () => {
    const config = renderHostConfig({
      sites: [{ name: 'demo' }, { name: 'docs' }, { name: 'sample', root: true }],
      domain: 'platformkit.test',
      apex: 'sample',
      mode: 'proxy',
      ports: { demo: 5199 },
    })
    assert.equal(config, fs.readFileSync(KIT('build/fixtures/sites-host.proxy.conf'), 'utf8'), 'proxy mode matches its three-site snapshot')
    assert.ok(config.includes('proxy_pass http://host.docker.internal:5199;'))
    assert.ok(config.includes('proxy_set_header Upgrade $http_upgrade;') && config.includes('proxy_buffering off;'))
    assert.ok(config.includes('docs.platformkit.test is not running') && config.includes('Run npm run dev in sites/docs.'))
    assert.ok(!config.includes('SUPABASE_URL_'), 'the development proxy needs no production backend URLs')
  })
  test('site-specific rewrite and proxy includes cannot name another backend', () => {
    const rewriteTemplate = 'proxy_pass ${SUPABASE_URL}/functions/v1/content/;\ninclude /etc/nginx/conf.d/functions-proxy.inc;\n'
    const proxyTemplate = 'proxy_set_header Host ${SUPABASE_HOST};\nproxy_set_header X-Forwarded-Proto $scheme;\n'
    const demo = renderSiteIncludes({ name: 'demo', url: 'https://demo.supabase.co', rewriteTemplate, proxyTemplate })
    const docs = renderSiteIncludes({ name: 'docs', url: 'https://docs.supabase.co', rewriteTemplate, proxyTemplate })
    assert.ok(demo.rewrite.includes('https://demo.supabase.co/functions/v1/content/'))
    assert.ok(demo.rewrite.includes('functions-proxy.demo.inc') && demo.proxy.includes('Host demo.supabase.co'))
    assert.ok(docs.rewrite.includes('https://docs.supabase.co/functions/v1/content/'))
    assert.ok(docs.proxy.includes('Host docs.supabase.co'))
    assert.ok(!demo.rewrite.includes('docs.supabase.co') && !docs.rewrite.includes('demo.supabase.co'))
  })
  test('kit and theme code never scope a cookie to a parent domain', () => {
    const sourceFiles = []
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name)
        if (entry.isDirectory()) visit(target)
        else if (/\.(?:js|mjs|ts|vue)$/.test(entry.name)) sourceFiles.push(target)
      }
    }
    for (const directory of ['packages/kit/src', 'packages/movable-types/src']) visit(path.join(ROOT, directory))
    const parentDomain = /\bdomain\s*=\s*\.?[a-z0-9.-]+/i
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8')
      if (/(?:document\.cookie|set-cookie|cookieStore|setCookie)/i.test(content)) {
        assert.ok(!parentDomain.test(content), `${path.relative(ROOT, file)} scopes a cookie to a domain`)
      }
    }
  })
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}

console.log(`sites-host: ${pass} passed`)

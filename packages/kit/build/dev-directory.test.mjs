import assert from 'node:assert/strict'
import http from 'node:http'
import { createDevDirectoryServer, renderDirectoryHtml } from './dev-directory.mjs'
import { resolveHead, resolveSiteHomeHead } from '../src/lib/seo-head.js'

const copy = {
  heading: 'Your Projects',
  subtitle: 'Each project is hosted on its own subdomain.',
  open: 'Open site',
  preview: 'Preview of {site}',
  unavailable: 'Site preview unavailable.',
}
let pass = 0
const test = async (name, run) => {
  await run()
  pass++
  console.log(`dev-directory: ✓ ${name}`)
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server.address().port
}

async function close(server) {
  if (!server?.listening) return
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}

try {
  await test('root SEO resolution uses the page title and description with the site image base', () => {
    const head = resolveHead(
      { title: 'Welcome', description: 'A site intro', image: '/share/home.png', path: '/' },
      { name: 'Alpha', url: 'https://alpha.example/' },
      '/share/default.png',
    )
    assert.deepEqual(head, {
      title: 'Welcome · Alpha',
      description: 'A site intro',
      url: 'https://alpha.example/',
      image: 'https://alpha.example/share/home.png',
    })
  })

  await test('fallback SEO resolution uses the site tagline, description, and image before the generated default', () => {
    const siteHead = resolveHead(
      { path: '/' },
      { name: 'Alpha', tagline: 'A local project', description: 'Site description', image: '/brand.png' },
      '/share/default.png',
    )
    assert.deepEqual(siteHead, {
      title: 'Alpha — A local project',
      description: 'Site description',
      url: '',
      image: '/brand.png',
    })
    const defaultHead = resolveHead({ path: '/' }, { name: 'Beta' }, '/share/default.png')
    assert.equal(defaultHead.title, 'Beta')
    assert.equal(defaultHead.image, '/share/default.png')
  })

  await test('root metadata uses homepage SEO overrides and the docs-only index SEO fallback', () => {
    const pageHead = resolveSiteHomeHead({
      site: { name: 'Alpha', url: 'https://alpha.example' },
      pages: [{ route: '/', title: 'Landing title', seoTitle: 'Search title', description: 'Homepage description', image: '/share/home.png' }],
    })
    assert.deepEqual(pageHead, {
      title: 'Search title · Alpha',
      description: 'Homepage description',
      url: 'https://alpha.example/',
      image: 'https://alpha.example/share/home.png',
    })
    const docsHead = resolveSiteHomeHead({
      site: { name: 'Docs' },
      ui: [{ scope: 'pages', groups: { seo: { docs: { title: 'Documentation', description: 'Read the docs.' } } } }],
      modules: {
        docs: true,
        articles: false,
        books: false,
        wiki: false,
        store: false,
        memberships: false,
        sessions: false,
        coaching: false,
        support: false,
        instrument: false,
        recommendations: false,
      },
    })
    assert.deepEqual(docsHead, {
      title: 'Documentation · Docs',
      description: 'Read the docs.',
      url: '',
      image: '/share/default.png',
    })
  })

  await test('cards show project names, keep fallback names, and display only the artwork and title', () => {
    const html = renderDirectoryHtml({
      domain: 'localhost',
      port: 8123,
      copy,
      sites: [
        { name: 'alpha', metadata: { projectName: '  Alpha Project  ', title: 'Alpha SEO title', description: 'Alpha description', url: 'https://alpha.example/', image: 'https://alpha.example/share/default.png' } },
        { name: 'beta', metadata: { projectName: '  ', title: 'Beta SEO title', description: 'Beta description', url: 'https://beta.example/', image: 'https://images.example.net/beta.png' } },
        { name: 'gamma', error: true },
      ],
    })
    assert.match(html, /<h2>Alpha Project<\/h2>/)
    assert.match(html, /<h2>beta<\/h2>/)
    assert.match(html, /<h2>gamma<\/h2>/)
    assert.match(html, /<img class="preview-image" src="\/__platformkit\/preview\/alpha\.png"/)
    assert.match(html, /href="http:\/\/alpha\.localhost:8123\/"/)
    assert.match(html, /src="https:\/\/images\.example\.net\/beta\.png"/)
    assert.match(html, /href="http:\/\/beta\.localhost:8123\/"/)
    assert.match(html, /aria-label="Site preview unavailable\."/)
    assert.match(html, /aria-label="Open site: Alpha Project"/)
    assert.doesNotMatch(html, /Alpha SEO title|Beta SEO title|Alpha description|Beta description/)
    assert.doesNotMatch(html, /class="description"|class="open-link"/)
    assert.doesNotMatch(html, /alpha\.example\/share\/default\.png/)
  })

  await test('same-origin metadata and cached raster share previews are served by the directory', async () => {
    const metadataSite = http.createServer((request, response) => {
      if (request.url !== '/__platformkit/site-meta') {
        response.writeHead(404).end()
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        projectName: 'Selected Project',
        title: 'Selected home',
        description: 'The selected site',
        url: 'https://selected.example/',
        image: '/share/default.png',
      }))
    })
    const sitePort = await listen(metadataSite)
    let activeCaptures = 0
    let maxActiveCaptures = 0
    const directory = createDevDirectoryServer({
      sites: [{ name: 'selected' }, { name: 'secondary' }],
      ports: { selected: sitePort, secondary: sitePort },
      domain: 'localhost',
      frontDoorPort: 8181,
      capturePreview: async (url) => {
        assert.equal(url, `http://127.0.0.1:${sitePort}/__share/default`)
        activeCaptures++
        maxActiveCaptures = Math.max(maxActiveCaptures, activeCaptures)
        await new Promise((resolve) => setTimeout(resolve, 10))
        activeCaptures--
        return Buffer.from('rendered-png')
      },
    })
    try {
      const directoryPort = await listen(directory)
      const response = await fetch(`http://127.0.0.1:${directoryPort}/__platformkit/sites.json`)
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), [{
        name: 'selected',
        metadata: {
          projectName: 'Selected Project',
          title: 'Selected home',
          description: 'The selected site',
          url: 'https://selected.example/',
          image: '/share/default.png',
        },
        error: false,
        url: 'http://selected.localhost:8181/',
      }, {
        name: 'secondary',
        metadata: {
          projectName: 'Selected Project',
          title: 'Selected home',
          description: 'The selected site',
          url: 'https://selected.example/',
          image: '/share/default.png',
        },
        error: false,
        url: 'http://secondary.localhost:8181/',
      }])
      const page = await fetch(`http://127.0.0.1:${directoryPort}/`)
      assert.doesNotMatch(page.headers.get('content-security-policy'), /frame-src/)
      assert.match(await page.text(), /src="\/__platformkit\/preview\/selected\.png"/)
      const [firstPreview, secondaryPreview] = await Promise.all([
        fetch(`http://127.0.0.1:${directoryPort}/__platformkit/preview/selected.png`),
        fetch(`http://127.0.0.1:${directoryPort}/__platformkit/preview/secondary.png`),
      ])
      const cachedPreview = await fetch(`http://127.0.0.1:${directoryPort}/__platformkit/preview/selected.png`)
      assert.equal(firstPreview.status, 200)
      assert.equal(firstPreview.headers.get('content-type'), 'image/png')
      assert.deepEqual(Buffer.from(await firstPreview.arrayBuffer()), Buffer.from('rendered-png'))
      assert.deepEqual(Buffer.from(await secondaryPreview.arrayBuffer()), Buffer.from('rendered-png'))
      assert.deepEqual(Buffer.from(await cachedPreview.arrayBuffer()), Buffer.from('rendered-png'))
      assert.equal(maxActiveCaptures, 1)
      assert.equal((await fetch(`http://127.0.0.1:${directoryPort}/__platformkit/preview/unknown.png`)).status, 404)
    } finally {
      await close(directory)
      await close(metadataSite)
    }
  })
} catch (error) {
  console.error(error)
  process.exitCode = 1
}

if (!process.exitCode) console.log(`dev-directory: ${pass} passed`)

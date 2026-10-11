import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFile } from './strings-io.mjs'
import { context as browserContext, launch as launchBrowser } from './browser.mjs'

const KIT = path.dirname(fileURLToPath(import.meta.url))
const UI_FILE = path.resolve(KIT, '../../movable-types/src/content/ui/site-directory.md')
const CSS_FILE = path.join(KIT, 'dev-directory.css')
const PREVIEW_WIDTH = 1200
const PREVIEW_HEIGHT = 675
const PREVIEW_CACHE_MS = 2000
const PREVIEW_PATH = '/__platformkit/preview/'

const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char])

function words() {
  const groups = parseFile(UI_FILE).groups
  const directory = groups.directory
  if (!directory) throw new Error('theme site-directory strings have no directory group')
  return Object.fromEntries(Object.entries(directory).map(([key, fields]) => [key, fields.text || '']))
}

function interpolate(value, fields) {
  return String(value || '').replace(/\{([a-z-]+)\}/g, (_match, key) => fields[key] || '')
}

function resolveLocalImage(image, localOrigin, canonicalUrl) {
  if (!image) return ''
  try {
    const local = new URL(localOrigin)
    const resolved = new URL(image, localOrigin)
    if (!['http:', 'https:'].includes(resolved.protocol)) return ''
    try {
      const canonical = new URL(canonicalUrl)
      if (resolved.host === canonical.host) {
        resolved.protocol = local.protocol
        resolved.host = local.host
      }
    } catch {}
    return resolved.href
  } catch {
    return ''
  }
}

function isDefaultShareImage(image) {
  if (!image) return false
  try {
    return new URL(image, 'http://localhost').pathname === '/share/default.png'
  } catch {
    return false
  }
}

export function renderDirectoryHtml({ sites, domain, port, copy }) {
  const cards = sites.map(({ name, metadata, error }) => {
    const title = typeof metadata?.projectName === 'string' && metadata.projectName.trim()
      ? metadata.projectName.trim()
      : name
    const siteUrl = `http://${name}.${domain}:${port}/`
    const defaultShare = !error && isDefaultShareImage(metadata?.image)
    const image = error || defaultShare ? '' : resolveLocalImage(metadata?.image, siteUrl, metadata?.url)
    const preview = image
      ? `<img class="preview-image" src="${escapeHtml(image)}" alt="${escapeHtml(interpolate(copy.preview, { site: title }))}" loading="lazy">`
      : defaultShare
        ? `<img class="preview-image" src="${escapeHtml(`/__platformkit/preview/${name}.png`)}" alt="${escapeHtml(interpolate(copy.preview, { site: title }))}" loading="eager">`
      : `<div class="preview-empty" role="img" aria-label="${escapeHtml(copy.unavailable)}"></div>`
    return `<article class="site-card">
  <a class="site-card-link" href="${escapeHtml(siteUrl)}" aria-label="${escapeHtml(copy.open)}: ${escapeHtml(title)}">
    <div class="preview">${preview}</div>
    <div class="card-copy">
      <h2>${escapeHtml(title)}</h2>
    </div>
  </a>
</article>`
  }).join('\n')
  const heading = escapeHtml(copy.heading)
  const subtitle = escapeHtml(copy.subtitle)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${heading}</title>
  <link rel="stylesheet" href="/__platformkit/directory.css">
</head>
<body>
  <main class="directory">
    <header class="directory-heading">
      <h1>${heading}</h1>
      <p class="subtitle">${subtitle}</p>
    </header>
    <section class="site-grid" aria-label="${heading}">
      ${cards}
    </section>
  </main>
</body>
</html>
`
}

async function metadataFor(site, port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/__platformkit/site-meta`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) throw new Error(`site metadata returned HTTP ${response.status}`)
    const result = await response.json()
    if (!result || typeof result.title !== 'string' || typeof result.description !== 'string' || typeof result.image !== 'string') {
      throw new Error('site metadata response has an invalid shape')
    }
    const projectName = typeof result.projectName === 'string' ? result.projectName.trim() : ''
    return { name: site.name, metadata: { ...result, projectName: projectName || site.name }, error: false }
  } catch (error) {
    console.error(`workspace site directory: metadata for ${site.name} is unavailable: ${error.message}`)
    return { name: site.name, metadata: null, error: true }
  }
}

async function captureShareCard(url, getBrowser) {
  const browser = await getBrowser()
  const context = await browserContext(browser, {
    viewport: { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  })
  try {
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-share] > *:not(.sh-missing)')
    await page.evaluate(() => document.fonts.ready)
    await page.waitForFunction(() => [...document.images].every((image) => image.complete))
    await page.waitForTimeout(250)
    return await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT },
    })
  } finally {
    await context.close()
  }
}

export function createDevDirectoryServer({ sites, ports, domain, frontDoorPort, capturePreview }) {
  const directoryCopy = words()
  const copy = {
    heading: directoryCopy.heading,
    subtitle: directoryCopy.subtitle,
    open: directoryCopy.open,
    preview: directoryCopy.preview,
    unavailable: directoryCopy.unavailable,
  }
  if (Object.values(copy).some((value) => !value)) throw new Error('theme site-directory strings are incomplete')

  let browserPromise
  const getBrowser = () => browserPromise ||= launchBrowser({ headless: true })
  const capture = capturePreview || ((url) => captureShareCard(url, getBrowser))
  const previewCache = new Map()
  const pendingPreviews = new Map()
  let captureQueue = Promise.resolve()
  function captureInOrder(url) {
    const pending = captureQueue.then(() => capture(url))
    captureQueue = pending.then(() => undefined, () => undefined)
    return pending
  }
  async function previewFor(site) {
    const cached = previewCache.get(site.name)
    if (cached && Date.now() - cached.createdAt < PREVIEW_CACHE_MS) return cached.image
    if (pendingPreviews.has(site.name)) return pendingPreviews.get(site.name)

    const port = ports[site.name]
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`site ${site.name} has no valid Vite port for its share preview`)
    }
    const pending = Promise.resolve()
      .then(() => captureInOrder(`http://127.0.0.1:${port}/__share/default`))
      .then((image) => {
        if (!Buffer.isBuffer(image) || image.length === 0) {
          throw new Error(`site ${site.name} returned an empty share preview`)
        }
        previewCache.set(site.name, { image, createdAt: Date.now() })
        return image
      })
      .finally(() => pendingPreviews.delete(site.name))
    pendingPreviews.set(site.name, pending)
    return pending
  }

  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' })
      response.end()
      return
    }
    if (pathname === '/__platformkit/directory.css') {
      response.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' })
      response.end(fs.readFileSync(CSS_FILE))
      return
    }
    if (pathname.startsWith(PREVIEW_PATH)) {
      const file = pathname.slice(PREVIEW_PATH.length)
      const name = file.endsWith('.png') ? file.slice(0, -4) : ''
      const site = sites.find((entry) => entry.name === name)
      if (!site) {
        response.writeHead(404)
        response.end()
        return
      }
      try {
        const image = await previewFor(site)
        response.writeHead(200, {
          'content-type': 'image/png',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        response.end(request.method === 'HEAD' ? undefined : image)
      } catch (error) {
        console.error(`workspace site directory: share preview for ${site.name} failed: ${error.message}`)
        response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
        response.end(request.method === 'HEAD' ? undefined : 'Share preview could not be rendered.')
      }
      return
    }
    if (pathname !== '/' && pathname !== '/__platformkit/sites.json') {
      response.writeHead(404)
      response.end()
      return
    }

    const entries = await Promise.all(sites.map((site) => metadataFor(site, ports[site.name])))
    if (pathname === '/__platformkit/sites.json') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify(entries.map((entry) => ({
        ...entry,
        url: `http://${entry.name}.${domain}:${frontDoorPort}/`,
      }))))
      return
    }
    const html = renderDirectoryHtml({ sites: entries, domain, port: frontDoorPort, copy })
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': `default-src 'none'; img-src http: https:; style-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
    })
    response.end(request.method === 'HEAD' ? undefined : html)
  })
  server.closeResources = async () => {
    if (!browserPromise) return
    try {
      const browser = await browserPromise
      await browser.close()
    } catch (error) {
      console.error(`workspace site directory: browser shutdown failed: ${error.message}`)
    }
  }
  return server
}

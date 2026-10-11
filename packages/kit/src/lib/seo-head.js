const imageOf = (image) => (typeof image === 'string' ? image : image && image.src) || ''

export function resolveHead({ title = '', description = '', image = '', path = null } = {}, site = {}, defaultImage = '') {
  const base = String(site.url || '').replace(/\/+$/, '')
  const url = path != null && base ? base + (path === '/' ? '/' : path) : ''
  const selectedImage = imageOf(image) || imageOf(site.image) || defaultImage
  return {
    title: title ? `${title} · ${site.name || 'Site'}` : (site.tagline ? `${site.name || 'Site'} — ${site.tagline}` : (site.name || 'Site')),
    description: (description || site.description || '').slice(0, 300),
    url,
    image: selectedImage && selectedImage.startsWith('/') && base ? base + selectedImage : selectedImage,
  }
}

export function resolveSiteHomeHead({ site, pages = [], ui = [], modules = {} } = {}, defaultImage = '/share/default.png') {
  const page = pages.find((entry) => entry.route === '/')
  if (page) {
    return resolveHead({
      title: page.seoTitle || (page.route === '/' ? '' : page.title),
      description: page.description,
      image: page.image || defaultImage,
      path: page.route || '/',
    }, site, defaultImage)
  }

  const on = (name) => modules[name] !== false
  const accounts = ['store', 'memberships', 'sessions', 'coaching', 'support', 'instrument', 'recommendations'].some(on)
  const docsOnly = on('docs') && !['articles', 'books', 'wiki'].some(on) && !accounts
  const index = docsOnly ? 'docs' : 'hub'
  const pagesWords = ui.find((entry) => entry.scope === 'pages')
  const indexWords = pagesWords && pagesWords.groups && pagesWords.groups.seo && pagesWords.groups.seo[index]
  return resolveHead({
    title: (indexWords && indexWords.title) || '',
    description: (indexWords && indexWords.description) || '',
    path: docsOnly ? '/docs' : '/content',
  }, site, defaultImage)
}

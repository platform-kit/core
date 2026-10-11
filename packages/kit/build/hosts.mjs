import fs from 'node:fs'
import path from 'node:path'
import { sites as discoverSites, siteEnvSuffix } from './sites.mjs'
import { platformkitRuntimePath } from './runtime-paths.mjs'

const DNS_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/

const crawlerMap = `# WHICH AGENTS GET THE PRERENDERED PAGE.
map $http_user_agent $is_crawler {
  default 0;
  "~*(googlebot|bingbot|duckduckbot|baiduspider|yandex(bot)?)"                 1;
  "~*(slackbot|discordbot|twitterbot|facebookexternalhit|linkedinbot)"         1;
  "~*(whatsapp|telegrambot|pinterest|redditbot|applebot|mastodon)"             1;
  "~*(embedly|quora link preview|showyoubot|outbrain|vkshare|skypeuripreview)" 1;
}
`

const connectionMap = `map $http_upgrade $connection_upgrade {
  default upgrade;
  '' close;
}
`

const validPort = (value) => {
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
}

function missingSitePage(site, domain) {
  const location = site.root ? '.' : `sites/${site.name}`
  return `location / {
  default_type text/html;
  add_header Retry-After 5 always;
  return 503 "<!doctype html><html><head><title>${site.name} is not running</title></head><body><h1>${site.name}.${domain} is not running</h1><p>Run npm run dev in ${location}.</p></body></html>";
}`
}

function fileLocations(site) {
  const includes = []
  if (site.backend !== false) includes.push(`  include /etc/nginx/conf.d/rewrites.${site.name}.inc;`)
  includes.push(`  include /etc/nginx/conf.d/prerender.inc;`)
  return `  root /srv/sites/${site.name};
  index index.html;

  location ~* \\.(js|css|woff2?|png|jpe?g|webp|svg|gif|ico|mp3|wasm)$ { expires 1y; add_header Cache-Control "public, immutable"; try_files $uri =404; }
  location = /index.html { add_header Cache-Control "no-cache"; }

${includes.join('\n')}

  location @page {
    error_page 418 = @prerender;
    if ($is_crawler) { return 418; }
    try_files /index.html =404;
  }
  location / { try_files $uri $uri/index.html @page; }`
}

function proxyLocations(site, domain, port) {
  if (!port) return missingSitePage(site, domain)
  const upstream = `http://host.docker.internal:${port}`
  return `  location / {
    proxy_pass ${upstream};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_buffering off;
    proxy_read_timeout 120s;
  }`
}

function directoryProxyLocations(port) {
  return `  location / {
    proxy_pass http://host.docker.internal:${port};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_buffering off;
    proxy_read_timeout 15s;
  }`
}

function rewriteTemplateFor(templateDir, site) {
  const named = path.join(templateDir, `rewrites.${site.name}.inc.template`)
  return fs.existsSync(named) || !site.root ? named : path.join(templateDir, 'rewrites.inc.template')
}

export function renderHostConfig({
  sites: siteList,
  domain,
  apex = '',
  mode = 'files',
  ports = {},
  env = process.env,
  legacy = '',
  tls = false,
}) {
  if (!domain) return legacy
  if (!DNS_NAME.test(domain)) throw new Error(`PLATFORMKIT_DOMAIN "${domain}" is not a valid domain name`)
  if (!['files', 'proxy'].includes(mode)) throw new Error(`PLATFORMKIT_SITES_MODE must be "files" or "proxy", not "${mode}"`)
  if (!Array.isArray(siteList) || !siteList.length) throw new Error('no sites are selected for this host')

  const names = new Set()
  for (const site of siteList) {
    if (!site || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(site.name || '')) throw new Error(`site "${site?.name}" is not a legal DNS label`)
    if (names.has(site.name)) throw new Error(`site "${site.name}" is listed more than once`)
    names.add(site.name)
  }
  if (apex && !names.has(apex)) throw new Error(`PLATFORMKIT_APEX names "${apex}", which is not in the selected site list`)

  const out = [crawlerMap]
  if (mode === 'proxy') out.push(connectionMap)
  const directoryEnabled = mode === 'proxy' && env.PLATFORMKIT_DEV_DIRECTORY === '1'
  const directoryPort = directoryEnabled ? validPort(env.PLATFORMKIT_DEV_DIRECTORY_PORT) : null
  if (directoryEnabled && !directoryPort) throw new Error('PLATFORMKIT_DEV_DIRECTORY_PORT must be a valid port')

  for (const site of siteList) {
    const port = mode === 'proxy' ? validPort(ports[site.name]) : null
    if (mode === 'proxy' && ports[site.name] && !port) throw new Error(`the port for ${site.name} is not valid`)
    if (mode === 'files' && site.backend !== false) {
      const variable = `SUPABASE_URL_${siteEnvSuffix(site.name)}`
      if (!env[variable]) throw new Error(`site ${site.name} requires ${variable}`)
      let address
      try { address = new URL(env[variable]) } catch { throw new Error(`site ${site.name}: ${variable} must be an absolute http(s) URL`) }
      if (!['http:', 'https:'].includes(address.protocol) || address.pathname !== '/' || address.search || address.hash) throw new Error(`site ${site.name}: ${variable} must be an absolute http(s) origin`)
    }

    const serverNames = [`${site.name}.${domain}`]
    if (apex === site.name) serverNames.push(domain)
    const body = mode === 'files' ? fileLocations(site) : proxyLocations(site, domain, port)
    out.push(`server {
  listen 80;${tls ? '\n  listen 443 ssl;\n  ssl_certificate /etc/nginx/certs/fullchain.pem;\n  ssl_certificate_key /etc/nginx/certs/privkey.pem;' : ''}
  server_name ${serverNames.join(' ')};

${body}
}`)
  }

  if (apex) {
    out.push(`server {
  listen 80;${tls ? '\n  listen 443 ssl;\n  ssl_certificate /etc/nginx/certs/fullchain.pem;\n  ssl_certificate_key /etc/nginx/certs/privkey.pem;' : ''}
  server_name www.${domain};
  return 301 ${tls ? 'https' : '$scheme'}://${apex}.${domain}$request_uri;
}`)
  } else {
    if (directoryEnabled) {
      out.push(`server {
  listen 80;${tls ? '\n  listen 443 ssl;\n  ssl_certificate /etc/nginx/certs/fullchain.pem;\n  ssl_certificate_key /etc/nginx/certs/privkey.pem;' : ''}
  server_name ${domain};

${directoryProxyLocations(directoryPort)}
}`)
      out.push(`server {
  listen 80;${tls ? '\n  listen 443 ssl;\n  ssl_certificate /etc/nginx/certs/fullchain.pem;\n  ssl_certificate_key /etc/nginx/certs/privkey.pem;' : ''}
  server_name www.${domain};
  return 404;
}`)
    } else out.push(`server {
  listen 80;${tls ? '\n  listen 443 ssl;\n  ssl_certificate /etc/nginx/certs/fullchain.pem;\n  ssl_certificate_key /etc/nginx/certs/privkey.pem;' : ''}
  server_name ${domain} www.${domain};
  return 404;
}`)
  }
  out.push(`server {
  listen 80 default_server;${tls ? '\n  listen 443 ssl default_server;\n  ssl_certificate /etc/nginx/certs/fullchain.pem;\n  ssl_certificate_key /etc/nginx/certs/privkey.pem;' : ''}
  server_name _;
  return 404;
}`)
  return out.join('\n\n') + '\n'
}

export function renderSiteIncludes({ name, url, rewriteTemplate, proxyTemplate }) {
  const parsed = new URL(url)
  const supabaseUrl = url.replace(/\/+$/, '')
  return {
    rewrite: rewriteTemplate
      .replaceAll('${SUPABASE_URL}', supabaseUrl)
      .replaceAll('/etc/nginx/conf.d/functions-proxy.inc', `/etc/nginx/conf.d/functions-proxy.${name}.inc`),
    proxy: proxyTemplate.replaceAll('${SUPABASE_HOST}', parsed.host),
  }
}

export function configureHosts({
  root,
  env = process.env,
  output = '/etc/nginx/conf.d',
  templateDir = '/etc/nginx/templates',
  legacyTemplate = path.join(templateDir, 'default.conf.template'),
  sitesOutput = '/srv/sites',
  rootDist = '/usr/share/nginx/html',
}) {
  const domain = env.PLATFORMKIT_DOMAIN || ''
  if (!domain) return { changed: false, config: fs.readFileSync(legacyTemplate, 'utf8') }

  const mode = env.PLATFORMKIT_SITES_MODE || 'files'
  if (mode === 'files' && !String(env.PLATFORMKIT_SITES || '').trim()) throw new Error('files mode requires PLATFORMKIT_SITES to explicitly name the sites being published')
  const selectedProxySites = mode === 'proxy' && String(env.PLATFORMKIT_SITES || '').trim()
    ? String(env.PLATFORMKIT_SITES).split(',').map((name) => ({ name: name.trim(), root: false }))
    : discoverSites(root, env)
  const siteList = selectedProxySites.map((site) => ({
    ...site,
    backend: fs.existsSync(rewriteTemplateFor(templateDir, site)),
  }))
  const ports = {}
  for (const site of siteList) {
    const portFile = platformkitRuntimePath(root, 'dev', `${site.name}.port`)
    if (fs.existsSync(portFile)) ports[site.name] = fs.readFileSync(portFile, 'utf8').trim()
  }

  const tls = fs.existsSync('/etc/nginx/certs/fullchain.pem') && fs.existsSync('/etc/nginx/certs/privkey.pem')
  const generated = renderHostConfig({
    sites: siteList,
    domain,
    apex: env.PLATFORMKIT_APEX || '',
    mode,
    ports,
    env,
    tls,
  })

  fs.mkdirSync(output, { recursive: true })
  if (mode === 'files') {
    for (const site of siteList) {
      const source = site.root ? rootDist : site.dist
      if (!fs.existsSync(source)) throw new Error(`site ${site.name} has no built files at ${source}`)
      const target = path.join(sitesOutput, site.name)
      fs.mkdirSync(target, { recursive: true })
      fs.cpSync(source, target, { recursive: true, force: true })
    }
  }

  for (const site of siteList.filter((entry) => mode === 'files' && entry.backend)) {
    const variable = `SUPABASE_URL_${siteEnvSuffix(site.name)}`
    const url = env[variable]
    const include = renderSiteIncludes({
      name: site.name,
      url,
      rewriteTemplate: fs.readFileSync(rewriteTemplateFor(templateDir, site), 'utf8'),
      proxyTemplate: fs.readFileSync(path.join(templateDir, 'functions-proxy.inc.template'), 'utf8'),
    })
    fs.writeFileSync(path.join(output, `rewrites.${site.name}.inc`), include.rewrite)
    fs.writeFileSync(path.join(output, `functions-proxy.${site.name}.inc`), include.proxy)
  }
  fs.writeFileSync(path.join(output, 'default.conf'), generated)
  return { changed: true, config: generated, sites: siteList, tls }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    const root = process.argv[process.argv.indexOf('--root') + 1] || process.cwd()
    const result = configureHosts({ root })
    if (!result.changed) console.log('hosts: domain unset — keeping the single-site nginx config')
    else {
      console.log(`hosts: wrote ${result.sites.length} ${process.env.PLATFORMKIT_SITES_MODE || 'files'} site host(s)`)
      if (!result.tls) console.log('hosts: no certificate pair at /etc/nginx/certs — serving plain HTTP')
    }
  } catch (error) {
    console.error(`✖ hosts: ${error.message}`)
    process.exitCode = 1
  }
}

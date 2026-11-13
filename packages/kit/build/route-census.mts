/*
 * The route census: which page a site shows at each address.
 *
 * It asks the site's page table (#site/page-tests, which the kit's Vite plugin composes from core's pages and
 * every enabled module's) which page each address shows, through Vite for the site, so the site's module
 * switches, content pages and registered routes all apply. The record (build/fixtures/route-census.json) was
 * first taken from the page chain App.vue held before the table replaced it (commit d7961283), and is what any
 * change to how pages are chosen must reproduce; build/module-routes.test.mts compares the two.
 *
 * Run `node build/route-census.mts --write` from the workspace root to record it again, which is
 * only right when a page is meant to move.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKSPACE = path.resolve(KIT, '../..')
export const CENSUS_SITES = ['demo', 'docs', 'brochure', 'club']
export const CENSUS_FILE = path.join(KIT, 'build/fixtures/route-census.json')

export type Census = Record<string, Record<string, string>>

/* the addresses worth asking about on a site: every route the kit names, one level under each, the
   special shapes the chain tests for, every content page, every registered site route, and two that
   nothing claims */
function addresses(r: any): string[] {
  const out = new Set<string>()
  for (const v of Object.values(r.ROUTES) as string[]) { out.add(v); out.add(v === '/' ? '/x' : v + '/x') }
  out.add(r.ROUTES.diagnostics + '/call/x'); out.add(r.ROUTES.diagnostics + '/voice/x')
  out.add(r.ROUTES.cart + '/c/x'); out.add(r.ROUTES.embed + '/comments'); out.add(r.ROUTES.embed + '/comments/x')
  for (const k of r.ENTRY_KEYS) out.add(r.ROUTES.entries + '/' + k + '/x')
  for (const p of r.PAGE_ROUTES) out.add(p)
  for (const s of ['/stockists', '/stockists/x']) out.add(s)
  out.add('/nothing-claims-this'); out.add('/nothing/claims/this')
  return [...out].sort()
}

/* the census of one site, in dev (CMS on) and as built (CMS on only for a cloud site) */
export async function censusOf(site: string): Promise<Record<string, string>> {
  const root = path.join(WORKSPACE, 'sites', site)
  const prev = process.cwd()
  process.chdir(root)
  /* the site's content built once, fresh, so a stale .velite never decides the census */
  const { build } = await import('velite')
  await build({ watch: false, clean: false, quiet: true } as any)
  process.env.PLATFORMKIT_CONTENT_DONE = '1'
  const { createServer } = await import('vite')
  const server = await createServer({ configFile: path.join(root, 'vite.config.ts'), root, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error' })
  try {
    const r = await server.ssrLoadModule('platformkit/lib/router.js')
    const { PAGE_TESTS } = await server.ssrLoadModule('#site/page-tests')
    const { pageAt } = await server.ssrLoadModule('platformkit/lib/pages.js')
    const out: Record<string, string> = {}
    for (const [mode, cms] of [['dev', true], ['build', !!r.CLOUD]] as const) {
      for (const a of addresses(r)) {
        const p = pageAt(PAGE_TESTS, a, { CMS: cms, DEV: mode === 'dev' })
        out[`${mode} ${a}`] = !p ? '(none)' : p.name === 'site-route' ? 'site-route:' + (r.siteRouteOf(a)?.path ?? '?') : p.name
      }
    }
    return out
  } finally {
    await server.close()
    process.chdir(prev)
  }
}

export async function census(): Promise<Census> {
  const all: Census = {}
  for (const s of CENSUS_SITES) all[s] = await censusOf(s)
  return all
}

if (process.argv.includes('--write')) {
  const c = await census()
  fs.mkdirSync(path.dirname(CENSUS_FILE), { recursive: true })
  fs.writeFileSync(CENSUS_FILE, JSON.stringify(c, null, 2) + '\n')
  console.log('route census written: ' + Object.entries(c).map(([s, r]) => `${s} ${Object.keys(r).length}`).join(', '))
  process.exit(0)
}

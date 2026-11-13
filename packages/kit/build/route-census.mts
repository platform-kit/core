/*
 * The route census: which page a site shows at each address.
 *
 * It reads the page chain in theme/src/App.vue as written (each branch's component and its v-if
 * condition, in order) and evaluates the conditions against the real router, loaded through Vite
 * for the site, so the site's module switches, content pages and registered routes all apply. The
 * recorded census (build/fixtures/route-census.json) is what any change to how pages are chosen must
 * reproduce; build/module-routes.test.mts compares the two.
 *
 * Run `node build/route-census.mts --write` from the workspace root to record it again, which is
 * only right when a page is meant to move.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKSPACE = path.resolve(KIT, '../..')
export const CENSUS_SITES = ['demo', 'docs', 'brochure', 'club']
export const CENSUS_FILE = path.join(KIT, 'build/fixtures/route-census.json')

type Branch = { page: string, test: string | null, isExpr?: string }
export type Census = Record<string, Record<string, string>>

/* the page chain: the run of v-if / v-else-if / v-else siblings that begins with the first branch */
export function pageChain(source: string): { branches: Branch[], consts: [string, string][] } {
  const { descriptor } = parse(source)
  const nodes: any[] = (descriptor.template?.ast?.children || []).filter((n: any) => n.type === 1)
  const branches: Branch[] = []
  let started = false
  for (const n of nodes) {
    const dir = (name: string) => n.props.find((p: any) => p.type === 7 && p.name === name)
    const ifd = dir('if'), elseIf = dir('else-if'), els = dir('else')
    if (!started) { if (!ifd) continue; started = true }
    else if (!elseIf && !els) break
    const is = n.tag === 'component' ? n.props.find((p: any) => p.type === 7 && p.name === 'bind' && p.arg?.content === 'is')?.exp?.content : undefined
    branches.push({ page: n.tag, test: (ifd || elseIf)?.exp?.content ?? null, isExpr: is })
    if (els) break
  }
  /* the script's top-level consts, each page constant reduced to whether it exists */
  const script = descriptor.scriptSetup?.content || ''
  const consts: [string, string][] = []
  for (const m of script.matchAll(/^const ([A-Za-z_$][\w$]*) = (.+)$/gm)) {
    consts.push([m[1], m[2].replace(/defineAsyncComponent\(\(\) => import\([^)]*\)\)/g, 'true')])
  }
  return { branches, consts }
}

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

/* what the chain shows at one address, under one scope */
export function pageAt(branches: Branch[], scope: Record<string, any>, route: string): string {
  const names = Object.keys(scope)
  const run = (expr: string) => Function(...names, 'route', `return (${expr})`)(...names.map((n) => scope[n]), route)
  for (const b of branches) {
    if (b.test !== null && !run(b.test)) continue
    if (b.page === 'component' && b.isExpr) { const c = run(b.isExpr.replace(/\.component$/, '')); return 'site-route:' + (c?.path ?? '?') }
    return b.page
  }
  return '(none)'
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
    const m = await server.ssrLoadModule('platformkit/lib/modules.js')
    const { branches, consts } = pageChain(fs.readFileSync(path.join(KIT, 'theme/src/App.vue'), 'utf8'))
    const out: Record<string, string> = {}
    for (const [mode, cms] of [['dev', true], ['build', r.CLOUD]] as const) {
      const scope: Record<string, any> = { ...r, moduleOn: m.moduleOn, CMS: cms, DEV: mode === 'dev' }
      for (const [name, expr] of consts) {
        try { scope[name] = Function(...Object.keys(scope), `return (${expr})`)(...Object.values(scope)) } catch { /* not a page constant */ }
      }
      for (const a of addresses(r)) out[`${mode} ${a}`] = pageAt(branches, scope, a)
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

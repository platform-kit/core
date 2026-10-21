/* A site's own payment provider, end to end through the real path and no kit change (openspec: payment-providers):
   a copy of the demo registers an adapter in a module of its own (platformkit.config.js build.modules), keeps the
   adapter beside its functions (db/functions/_shared), and selects it. The assembly serves that adapter and no
   other; the deploy check asks for the secret it declares; and a site naming a provider nobody registered is
   refused by name, with no Stripe fallback. */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE = path.resolve(HERE, '../../..')
const DEMO = path.join(WORKSPACE, 'sites', 'demo')
const WORK = path.join(WORKSPACE, 'node_modules', '.cache', 'platformkit', 'site-payment-provider-test')
let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + String(detail).trim().split('\n').slice(-8).join('\n        ') : '')) } }

const generated = /(^|\/)(node_modules|dist|\.velite|\.platformkit|\.vite|\.content-collections)(\/|$)/
fs.rmSync(WORK, { recursive: true, force: true })
fs.cpSync(DEMO, WORK, { recursive: true, filter: (src) => { const rel = path.relative(DEMO, src).split(path.sep).join('/'); return !generated.test(rel) && !(rel.startsWith('supabase/') && rel !== 'supabase/config.toml') && !/^\.env/.test(rel) } })

/* the site's own module and adapter */
fs.mkdirSync(path.join(WORK, 'modules'), { recursive: true })
fs.writeFileSync(path.join(WORK, 'modules', 'acme-pay.mjs'), `export default {
  key: 'acme-pay', what: 'Payments through Acme, the site\\'s own processor',
  needs: 'a payment is taken by a server, so it needs the backend',
  static: false, git: true, cloud: true,
  owns: { env: ['ACME_PAY_KEY'] },
  paymentProviders: [{ id: 'acme-pay', adapter: 'acme-pay.ts', capabilities: ['checkout.one-time', 'customer.create'], secrets: ['ACME_PAY_KEY'], webhookPath: '/functions/v1/payment-provider-webhook' }],
}
`)
fs.mkdirSync(path.join(WORK, 'db', 'functions', '_shared'), { recursive: true })
fs.writeFileSync(path.join(WORK, 'db', 'functions', '_shared', 'acme-pay.ts'), `/* a site-owned adapter: the published contract, nothing of the kit's changed */
export function createPaymentProvider(secrets: Record<string, string>) {
  return { id: 'acme-pay', capabilities: ['checkout.one-time', 'customer.create'], key: secrets.ACME_PAY_KEY }
}
`)
const config = path.join(WORK, 'platformkit.config.js')
const original = fs.readFileSync(config, 'utf8')
const withSite = (provider) => {
  let s = original.replace(/export default \{/, `export default {\n  payments: { provider: '${provider}' },`)
  /* into the site's own list of modules where it has one, so nothing it registers is displaced */
  s = /\bbuild:\s*\{\s*modules:\s*\[/.test(s) ? s.replace(/(\bbuild:\s*\{\s*modules:\s*\[)/, "$1'./modules/acme-pay.mjs', ")
    : /\bbuild:\s*\{/.test(s) ? s.replace(/\bbuild:\s*\{/, "build: { modules: ['./modules/acme-pay.mjs'],")
    : s.replace(/export default \{/, "export default {\n  build: { modules: ['./modules/acme-pay.mjs'] },")
  fs.writeFileSync(config, s)
}
const assemble = () => { const r = spawnSync(process.execPath, [path.join(HERE, 'assemble.mjs')], { cwd: WORK, encoding: 'utf8' }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') } }

/* 1. registered and selected */
withSite('acme-pay')
{
  const a = assemble()
  ok('a site\'s own provider assembles', a.status === 0, a.out)
  const reg = path.join(WORK, 'supabase', 'functions', '_shared', 'payment-provider-registry.ts')
  const src = fs.existsSync(reg) ? fs.readFileSync(reg, 'utf8') : ''
  ok('…the functions are served through its adapter', /from '\.\/acme-pay\.ts'/.test(src), src.slice(0, 400))
  ok('…and not through Stripe\'s', !/stripe-payment-provider\.ts/.test(src), src.slice(0, 400))
  ok('…the adapter is the site\'s own file, beside its functions', fs.existsSync(path.join(WORK, 'supabase', 'functions', '_shared', 'acme-pay.ts')))
  /* the deploy check, against the site as loaded */
  const check = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { loadSite } = await import(${JSON.stringify(pathToFileURL(path.join(HERE, 'site.mjs')).href)})
    const { moduleSet } = await import(${JSON.stringify(pathToFileURL(path.join(HERE, 'steps.mjs')).href)})
    const { checkDeploy } = await import(${JSON.stringify(pathToFileURL(path.join(HERE, 'deploy-checks.mjs')).href)})
    const site = await loadSite(process.cwd()); const modules = await moduleSet(site)
    const none = { offers: [{ sku: 'thing', kind: 'good' }], printed: [], sessions: [], pricingSkus: [], funnels: [] }
    const r = checkDeploy({}, none, site.modules, [], null, [], modules, site)
    console.log(JSON.stringify({ missing: r.missing || [], wrong: r.wrong || [] }))`], { cwd: WORK, encoding: 'utf8' })
  let verdict = null; try { verdict = JSON.parse((check.stdout || '').trim().split('\n').pop()) } catch { /* below */ }
  ok('the deploy check asks for the secret the site\'s provider declares', !!verdict && JSON.stringify(verdict.missing).includes('ACME_PAY_KEY'), (check.stdout || '') + (check.stderr || ''))
}

/* 2. a provider nobody registered */
fs.writeFileSync(config, original.replace(/export default \{/, "export default {\n  payments: { provider: 'nope-pay' },"))
{
  const a = assemble()
  ok('a site naming an unregistered provider is refused', a.status !== 0, a.out)
  ok('…naming it', /nope-pay/.test(a.out), a.out)
  const reg = path.join(WORK, 'supabase', 'functions', '_shared', 'payment-provider-registry.ts')
  ok('…with no Stripe fallback written', !fs.existsSync(reg) || !/nope-pay/.test(fs.readFileSync(reg, 'utf8')) && a.status !== 0)
}

fs.rmSync(WORK, { recursive: true, force: true })
console.log(fail ? `site-payment-provider: ${fail} failed, ${pass} passed` : `site-payment-provider: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)

/* THE SITE RUNS ON ITS OWN CODE.
 *
 * This project serves several APIs shaped like other products, so that somebody else's client works
 * against it by changing a base URL. Those products' clients are driven in the tests — that is the
 * only way to know the compatibility is real — and they are installed for exactly that reason.
 *
 * None of them may be imported by anything that runs. A drop-in is written so that OTHER people's
 * code can talk to us; ours talks to itself in first-party code. A vendor client in the bundle or in
 * a function is either a needless dependency or, worse, this project reaching its own door through
 * somebody else's idea of it.
 *
 * The line is not "no third-party package": Stripe, LiveKit, nodemailer, web-push and the printers
 * are real outside services and their clients belong. It is "no client of a product we stand in
 * for", which is the list below.
 */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const KIT = path.resolve(HERE, '..')
const REPO = path.resolve(KIT, '..', '..')

/* the client of every product this project stands in for */
const VENDOR = [
  'contentful',
  'contentful-management',
  '@typeform/api-client',
  '@shopify/storefront-api-client',
  '@figuro/chatwoot-sdk',
  '@calcom/sdk',
  'posthog-js',
]
/* what runs: the packages' source and the Edge Functions of the kit and of every site in the repo */
const RUNTIME = [
  'packages/kit/src',
  'packages/kit/supabase/functions',
  'packages/movable-types/src',
  'src',
  'sites/demo/src',
  'sites/docs/src',
  'db/functions',
]
const CODE = /\.(m?[jt]s|vue)$/
const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = path.join(dir, name)
    const s = fs.statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (CODE.test(name)) out.push(p)
  }
  return out
}

let pass = 0, fail = 0
const ok = (name, fn) => { try { fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + (e && e.message ? e.message.split('\n').join('\n    ') : e)) } }

const files = RUNTIME.flatMap((d) => walk(path.join(REPO, d)))
ok('there is runtime code to check', () => assert.ok(files.length > 200, files.length + ' files'))

ok('nothing that runs imports the client of a product we stand in for', () => {
  const found = []
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    for (const v of VENDOR) {
      /* an import, a require, or a dynamic import of the bare name or a path inside it */
      const re = new RegExp(`(?:from|import|require)\\s*\\(?\\s*['"\`]${v.replace(/[/@-]/g, '\\$&')}(?:/[^'"\`]*)?['"\`]`)
      if (re.test(src)) found.push(path.relative(REPO, f) + ' → ' + v)
    }
  }
  assert.deepEqual(found, [], 'a drop-in is for other people\'s code:\n    ' + found.join('\n    '))
})

ok('and none of them is a runtime dependency of any package', () => {
  const wrong = []
  for (const f of ['package.json', 'packages/kit/package.json', 'packages/movable-types/package.json', 'sites/demo/package.json', 'sites/docs/package.json']) {
    const p = path.join(REPO, f)
    if (!fs.existsSync(p)) continue
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    for (const v of VENDOR) if (j.dependencies && j.dependencies[v]) wrong.push(f + ' → ' + v)
  }
  assert.deepEqual(wrong, [], 'they are installed to be driven by tests, so they are devDependencies:\n    ' + wrong.join('\n    '))
})

ok('the tests do drive them, so the list is not dead weight', () => {
  const tests = walk(path.join(KIT, 'build')).filter((f) => f.endsWith('.test.mjs'))
  const driven = new Set()
  for (const f of tests) {
    const src = fs.readFileSync(f, 'utf8')
    for (const v of VENDOR) if (src.includes(`'${v}'`)) driven.add(v)
  }
  const never = VENDOR.filter((v) => !driven.has(v))
  assert.deepEqual(never, [], 'a client nothing drives proves nothing — drive it or drop it: ' + never.join(', '))
})

console.log('\nfirst-party: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const buildRoot = path.dirname(fileURLToPath(import.meta.url))
const kitRoot = path.dirname(buildRoot)
const test = (file) => path.join(buildRoot, file)
const steps = [
  ['provider registry and capability declarations', 'node', [test('payment-providers.test.mjs')]],
  ['Hyperswitch API and webhook contract', 'node', [test('hyperswitch-payment-provider.test.mjs')]],
  ['Hyperswitch billing periods and rounding', 'node', [test('hyperswitch-billing.test.mjs')]],
  ['Stripe adapter contract', 'deno', ['test', path.join(buildRoot, 'stripe-payment-provider.test.ts')]],
  ['Hyperswitch adapter contract', 'deno', ['run', path.join(buildRoot, 'hyperswitch-payment-provider-adapter.test.ts')]],
]

for (const [label, command, args] of steps) {
  console.log(`\n▸ ${label}`)
  const result = spawnSync(command, args, { cwd: kitRoot, stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) {
    console.error(`\n✗ ${label} failed`)
    process.exit(result.status ?? 1)
  }
}

console.log('\n✔ payment-provider adapter contract checks passed')

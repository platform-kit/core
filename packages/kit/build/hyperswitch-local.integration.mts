import { readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'

const [environmentFile] = process.argv.slice(2)
if (!environmentFile) {
  throw new Error('Usage: node build/hyperswitch-local.integration.mjs /path/to/private.env-or.json')
}

const resolvedEnvironmentFile = path.resolve(environmentFile)
const environmentContents = readFileSync(resolvedEnvironmentFile, 'utf8')
const configuration = resolvedEnvironmentFile.endsWith('.json')
  ? JSON.parse(environmentContents)
  : parseEnv(environmentContents)
const baseUrl = new URL(configuration.HYPERSWITCH_BASE_URL)
if (baseUrl.protocol === 'http:' && baseUrl.hostname === 'host.docker.internal' &&
    baseUrl.pathname === '/' && !baseUrl.search && !baseUrl.hash) {
  configuration.HYPERSWITCH_BASE_URL = `http://127.0.0.1${baseUrl.port ? `:${baseUrl.port}` : ''}`
}
const normalizedBaseUrl = new URL(configuration.HYPERSWITCH_BASE_URL)
if (normalizedBaseUrl.protocol !== 'http:' || normalizedBaseUrl.hostname !== '127.0.0.1' ||
    normalizedBaseUrl.pathname !== '/' || normalizedBaseUrl.search || normalizedBaseUrl.hash) {
  throw new Error('The local integration test accepts only a loopback HTTP origin at 127.0.0.1.')
}

const names = [
  'HYPERSWITCH_BASE_URL',
  'HYPERSWITCH_API_KEY',
  'HYPERSWITCH_PROFILE_ID',
  'HYPERSWITCH_PUBLISHABLE_KEY',
  'HYPERSWITCH_WEBHOOK_SECRET',
]
const optionalNames = ['HYPERSWITCH_CLIENT_URL']
for (const name of names) {
  if (typeof configuration[name] !== 'string' || !configuration[name]) {
    throw new Error(`The local integration configuration is missing ${name}.`)
  }
}

const allowEnv = [...names, ...optionalNames].join(',')
const port = normalizedBaseUrl.port || '80'
const testPath = fileURLToPath(new URL('./hyperswitch-local.integration.test.ts', import.meta.url))
const result = spawnSync('deno', [
  'run',
  `--allow-net=127.0.0.1:${port}`,
  `--allow-env=${allowEnv}`,
  testPath,
], {
  env: {
    ...process.env,
    ...Object.fromEntries(names.map((name) => [name, configuration[name]])),
    ...Object.fromEntries(optionalNames
      .filter((name) => typeof configuration[name] === 'string' && configuration[name])
      .map((name) => [name, configuration[name]])),
  },
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exitCode = result.status ?? 1

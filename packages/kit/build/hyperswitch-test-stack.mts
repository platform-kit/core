import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const source = process.env.HYPERSWITCH_SOURCE_DIR
if (!source) {
  throw new Error('Set HYPERSWITCH_SOURCE_DIR to a Hyperswitch checkout before starting the test stack.')
}

const sourceDir = path.resolve(source)
const baseCompose = path.join(sourceDir, 'docker-compose.yml')
const developmentCompose = path.join(sourceDir, 'docker-compose-development.yml')
for (const composeFile of [baseCompose, developmentCompose]) {
  if (!fs.existsSync(composeFile)) {
    throw new Error(`The Hyperswitch source checkout is missing ${path.basename(composeFile)}.`)
  }
}

const action = process.argv[2] || 'up'
if (!['up', 'down', 'ps'].includes(action)) {
  throw new Error('Use the test stack action "up", "down", or "ps".')
}

const port = process.env.PLATFORMKIT_HYPERSWITCH_TEST_PORT || '18323'
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error('PLATFORMKIT_HYPERSWITCH_TEST_PORT must be a valid TCP port.')
}

const project = process.env.PLATFORMKIT_HYPERSWITCH_TEST_PROJECT || 'platformkit-hyperswitch-test'
if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) {
  throw new Error('PLATFORMKIT_HYPERSWITCH_TEST_PROJECT contains invalid characters.')
}

const overlay = fileURLToPath(new URL('./hyperswitch-v2-test.compose.yml', import.meta.url))
const composeArgs = [
  'compose',
  '--project-name', project,
  '-f', baseCompose,
  '-f', developmentCompose,
  '-f', overlay,
  action,
]
if (action === 'up') composeArgs.push('--detach', '--wait', '--wait-timeout', '3600', 'hyperswitch-server')

const result = spawnSync('docker', composeArgs, {
  env: { ...process.env, PLATFORMKIT_HYPERSWITCH_TEST_PORT: port },
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1

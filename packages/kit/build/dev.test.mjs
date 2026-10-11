import assert from 'node:assert/strict'
import { connect } from 'node:net'
import { portRequest, resolvePort } from './dev-ports.mjs'
import { signalGroup, spawnGroup } from './dev-runtime.mjs'

let pass = 0
const test = async (name, run) => {
  await run()
  pass++
  console.log(`dev: ✓ ${name}`)
}

function acceptsConnections(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.setTimeout(250)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error', () => resolve(false))
  })
}

await test('single-site public port defaults to 3000 and a numeric choice is exact', () => {
  assert.deepEqual(portRequest([], '--port', 3000), { auto: false, port: 3000 })
  assert.deepEqual(portRequest(['--port', '4312'], '--port', 3000), { auto: false, port: 4312 })
})

await test('automatic port search requires the explicit auto option', async () => {
  for (const args of [['--port:auto'], ['--port', 'auto']]) {
    assert.deepEqual(portRequest(args, '--port', 3000), { auto: true, port: null })
    assert.equal(await resolvePort(args, '--port', 3000, {
      available: async () => false,
      findFree: async (start) => start + 3,
    }), 3003)
  }
})

await test('an occupied default port fails rather than selecting another port', async () => {
  await assert.rejects(
    resolvePort([], '--front-door-port', 3000, {
      available: async () => false,
      findFree: async () => 3001,
    }),
    /--front-door-port 3000 is unavailable/,
  )
})

await test('invalid ports are refused', () => {
  assert.throws(() => portRequest(['--port', '70000'], '--port', 3000), /integer from 1 to 65535/)
})

await test('stopping a single-site process group closes its Vite listener', async () => {
  const script = `
    const http = require('node:http')
    const server = http.createServer((req, res) => res.end('vite'))
    server.listen(0, '127.0.0.1', () => console.log(server.address().port))
    process.on('SIGTERM', () => server.close(() => process.exit(0)))
    setInterval(() => {}, 1000)
  `
  const child = spawnGroup(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] })
  let output = ''
  let timer
  try {
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('fake Vite did not become ready')), 5000)
      timer = timeout
      child.stdout.on('data', (chunk) => {
        output += chunk
        const port = Number(output.trim())
        if (Number.isInteger(port) && port > 0) { clearTimeout(timeout); resolve(port) }
      })
      child.once('error', reject)
      child.once('exit', (code) => reject(new Error(`process group exited before Vite was ready (${code})`)))
    })
    assert.equal(await acceptsConnections(port), true, 'the Vite listener started')
    signalGroup(child)
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('single-site process group did not stop')), 3000)
      child.once('exit', () => { clearTimeout(timeout); resolve() })
    })
    const deadline = Date.now() + 3000
    while (Date.now() < deadline && await acceptsConnections(port)) await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(await acceptsConnections(port), false, 'the Vite listener stopped with its process group')
  } finally {
    clearTimeout(timer)
    signalGroup(child, 'SIGKILL')
  }
})

if (!process.exitCode) console.log(`dev: ${pass} passed`)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const bootstrap = fs.readFileSync(path.join(ROOT, '.devcontainer', 'post-create.sh'), 'utf8')
assert.doesNotMatch(bootstrap, /sites\/[^/]+\/\.env(?:\.example)?/)
assert.match(bootstrap, /node packages\/kit\/build\/tts\/setup\.mjs/)
console.log('bootstrap-env: site-neutral bootstrap verified')

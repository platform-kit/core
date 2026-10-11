import assert from 'node:assert/strict'
import path from 'node:path'
import { platformkitCacheRoot, platformkitRuntimePath } from './runtime-paths.mjs'

const root = path.resolve('/tmp/platformkit-runtime-path-test')
assert.equal(platformkitCacheRoot(root), path.join(root, 'node_modules', '.cache', 'platformkit'))
assert.equal(platformkitRuntimePath(root, 'dev', 'runs'), path.join(root, 'node_modules', '.cache', 'platformkit', 'dev', 'runs'))
console.log('runtime-paths: passed')

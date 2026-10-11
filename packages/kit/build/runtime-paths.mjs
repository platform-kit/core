import path from 'node:path'

export function platformkitCacheRoot(root) {
  return path.join(path.resolve(root), 'node_modules', '.cache', 'platformkit')
}

export function platformkitRuntimePath(root, ...parts) {
  return path.join(platformkitCacheRoot(root), ...parts)
}

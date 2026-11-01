import path from 'node:path'

export function platformkitCacheRoot(root: any) {
  return path.join(path.resolve(root), 'node_modules', '.cache', 'platformkit')
}

export function platformkitRuntimePath(root: any, ...parts: any[]) {
  return path.join(platformkitCacheRoot(root), ...parts)
}

import path from 'node:path'

export function platformkitCacheRoot(root: string) {
  return path.join(path.resolve(root), 'node_modules', '.cache', 'platformkit')
}

export function platformkitRuntimePath(root: string, ...parts: any[]) {
  return path.join(platformkitCacheRoot(root), ...parts)
}

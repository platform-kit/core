/*
 * A SITE'S OWN CONFIG, IN TYPESCRIPT OR JAVASCRIPT (openspec: typescript-throughout). platformkit.config.ts wins where both
 * are there. Node strips a site's TypeScript itself, since a site's files are not in node_modules; velite and Vite read
 * their own configs in either language.
 */
import path from 'node:path'

/* the content pipe copies site.mjs into the functions, and the pipe holds no filesystem (content-kinds.test.mjs) */
const exists = (file: string): boolean => globalThis.process.getBuiltinModule('node:fs').existsSync(file)

export const siteFile = (root: string, stem = 'platformkit.config'): string => {
  const ts = path.join(root, stem + '.ts')
  return exists(ts) ? ts : path.join(root, stem + '.js')
}
export const hasSiteConfig = (root: string): boolean => exists(siteFile(root))

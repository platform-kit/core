/*
 * WHAT A SITE WRITES, TYPED (openspec: typescript-throughout).
 *
 * A site's platformkit.config.js is a default export of one object. `defineSite` returns it unchanged — it exists so
 * an editor knows what the object may hold, and so `tsc` refuses a mistyped key in a site written in TypeScript:
 *
 *   import { defineSite } from 'platformkit/config.mjs'
 *   export default defineSite({ name: 'Northlight Press', modules: { store: true, print: false } })
 *
 * A module a site declares of its own is written with `defineModule` (build/modules/manifest.mts has its shape), and
 * named in `build.modules`; its switch sits in `modules` beside the kit's. The deeper keys a module reads (community, spaces, store and the rest) are
 * described on the configuration page of the docs and checked where they are read; here they are open records.
 */
import type { ModuleDeclaration } from '../build/modules/manifest.mjs'

/* the kit's own switches; a site's module adds a key of its own */
export type KitModuleKey =
  | 'articles' | 'books' | 'wiki' | 'docs' | 'store' | 'memberships' | 'sessions' | 'coaching' | 'support'
  | 'social-publishing' | 'spaces' | 'space-encryption' | 'network' | 'events' | 'courses' | 'forms' | 'funnels'
  | 'emails' | 'push' | 'models' | 'api' | 'bots' | 'copilot' | 'instrument' | 'recommendations' | 'print' | 'tts'
  | 'enrichment' | 'translation'

/* a switch is on unless it says false; a name nobody declares is refused when the site is loaded */
export type Modules = Partial<Record<KitModuleKey, boolean>> & Record<string, boolean>

/* the three shapes a deployment comes in: static (no backend), git (content in files) and cloud (content in rows) */
export interface Deployment {
  backend?: boolean
  content?: 'files' | 'rows'
  repo?: boolean
}

/* where a site keeps its own part of the data layer, beside the kit's (assemble.mjs) */
export interface DataPaths {
  schemas?: string
  rows?: string
  functions?: string
  seed?: string
  /* the port base the site's local stack is given */
  ports?: number
}

export interface BuildSettings {
  /* the site's own module manifests, as module paths, each exporting one (or a list) by default */
  modules?: string[]
  /* the site's own build steps, as module paths */
  steps?: string[]
  /* the site's own tests, run by `platformkit test` */
  tests?: string[]
  [key: string]: unknown
}

export interface SiteConfig {
  name: string
  /* the theme package, `platformkit/theme` unless the site has its own */
  theme?: string
  modules?: Modules
  deployment?: Deployment
  data?: DataPaths
  build?: BuildSettings
  languages?: string[]
  looks?: Record<string, unknown>
  defaultLook?: string
  collections?: Record<string, unknown>
  nav?: Record<string, unknown>
  routes?: unknown
  landing?: unknown
  app?: Record<string, unknown>
  admin?: Record<string, unknown>
  analytics?: Record<string, unknown>
  api?: Record<string, unknown>
  avatars?: Record<string, unknown>
  cloud?: Record<string, unknown>
  coaching?: Record<string, unknown>
  community?: Record<string, unknown>
  courses?: Record<string, unknown>
  dev?: Record<string, unknown>
  enrichment?: Record<string, unknown>
  instrument?: Record<string, unknown>
  network?: Record<string, unknown>
  overrides?: Record<string, unknown>
  payments?: Record<string, unknown>
  recommendations?: Record<string, unknown>
  spaces?: Record<string, unknown>
  store?: Record<string, unknown>
  webhooks?: SiteWebhook[]
}

/* a subscription the deployment ships already wired (build/webhooks-config.mjs); a secret is named, never written */
export type SiteWebhook =
  | { kind: 'content'; name: string; url: string; topics?: string[] }
  | { kind: 'form'; form: string; tag: string; url: string; secret?: `env:${string}` }
  | { kind: 'scheduling'; url: string; triggers?: string[]; secret?: `env:${string}` }
  | { kind: 'support'; url: string; subscriptions?: string[] }

export function defineSite<C extends SiteConfig>(config: C): C {
  return config
}

export function defineModule<M extends ModuleDeclaration>(module: M): M {
  return module
}

export type { ModuleDeclaration }

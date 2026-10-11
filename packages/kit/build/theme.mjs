/* The theme as the kit reads it: the manifest the theme package exports as <theme>/theme.js, its
   src directory, and its component registry — every .vue under src by file name (unique by the
   theme's contract; `loadTheme` refuses a theme where two share one). A site's overrides
   (platformkit.config.js `overrides: { Name: './src/overrides/Name.vue' }`) key into that registry:
   the Vite plugin answers any import of the theme's <Name>.vue with the site's file, wherever the
   import is written — so a theme's own imports need no registry indirection, and an override file
   that imports the component it replaces gets the original, to wrap it. No Vite here. */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))

export async function loadTheme(c) {
  const name = (c && c.theme) || '@platform-kit/movable-types'
  /* resolved from the site's root, the way Node resolves a package for it (createRequire, so Node 18 serves too) */
  const file = createRequire(path.join((c && c.root) || process.cwd(), 'package.json')).resolve(name + '/theme.js')
  const m = (await import(/* @vite-ignore */ file)).default
  const src = path.dirname(file)
  const abs = (p) => path.resolve(src, p)
  const components = {}
  for (const f of walk(src)) {
    if (!f.endsWith('.vue')) continue
    const n = path.basename(f, '.vue')
    if (components[n]) throw new Error(`theme ${name}: two components named ${n} — ${path.relative(src, components[n])} and ${path.relative(src, f)}; names are the registry and must be unique`)
    components[n] = f
  }
  return { package: name, ...m, src, main: abs(m.main || './main.js'), design: abs(m.design || './looks/design.css'), strings: abs(m.strings || './content/ui'), skills: abs(m.skills || './content/skills'), schemas: abs(m.schemas || './components/landing/schemas.js'), probe: m.probe || { allow: [] }, components }
}

/* the site's overrides resolved against the registry: { Name: absolute path }; an unknown name is refused, so a typo never misses silently */
export function resolveOverrides(c, theme) {
  const out = {}
  for (const [n, p] of Object.entries((c && c.overrides) || {})) {
    if (!theme.components[n]) throw new Error(`platformkit.config.js overrides: the theme has no component named ${n}`)
    const f = path.resolve(c.root, p)
    if (!fs.existsSync(f)) throw new Error(`platformkit.config.js overrides: ${n} → ${p} is not a file`)
    out[n] = f
  }
  return out
}

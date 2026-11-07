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

// @ts-expect-error TS7023, from the conversion: 'walk' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))

export async function loadTheme(c: { theme: any; root: any }) {
  const name = (c && c.theme) || 'platformkit/theme'
  /* resolved from the site's root, the way Node resolves a package for it (createRequire, so Node 18 serves too) */
  /* theme.js as a theme package ships it, or — the kit's own theme in the workspace — the TypeScript it is compiled from */
  const req = createRequire(path.join((c && c.root) || process.cwd(), 'package.json'))
  let file: string
  try { file = req.resolve(name + '/theme.js') } catch (e) { try { file = req.resolve(name + '/theme.ts') } catch { throw e } }
  const m = (await import(/* @vite-ignore */ file)).default
  const src = path.dirname(file)
  /* a path the manifest names as the site has it (.js); in the workspace, a .js not there is its .ts */
  const abs = (p: string) => { const a = path.resolve(src, p); const t = a.replace(/\.(m?)js$/, '.$1ts'); return !fs.existsSync(a) && t !== a && fs.existsSync(t) ? t : a }
  const components: any = {}
  for (const f of walk(src)) {
    if (!f.endsWith('.vue')) continue
    const n = path.basename(f, '.vue')
    if (components[n]) throw new Error(`theme ${name}: two components named ${n} — ${path.relative(src, components[n])} and ${path.relative(src, f)}; names are the registry and must be unique`)
    components[n] = f
  }
  return { package: name, ...m, src, main: abs(m.main || './main.js'), design: abs(m.design || './looks/design.css'), strings: abs(m.strings || './content/ui'), skills: abs(m.skills || './content/skills'), schemas: abs(m.schemas || './components/landing/schemas.js'), probe: m.probe || { allow: [] }, components }
}

/* the site's overrides resolved against the registry: { Name: absolute path }; an unknown name is refused, so a typo never misses silently */
export function resolveOverrides(c: { overrides: any; root: string }, theme: { components: { [x: string]: any } }) {
  const out: any = {}
  for (const [n, p] of Object.entries((c && c.overrides) || {})) {
    if (!theme.components[n]) throw new Error(`platformkit.config.js overrides: the theme has no component named ${n}`)
    // @ts-expect-error TS2345, from the conversion: Argument of type 'unknown' is not assignable to parameter of type 'string'.
    const f = path.resolve(c.root, p)
    if (!fs.existsSync(f)) throw new Error(`platformkit.config.js overrides: ${n} → ${p} is not a file`)
    out[n] = f
  }
  return out
}

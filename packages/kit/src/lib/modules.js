/*
 * IS THIS MODULE ON? — one reading, and a mistyped name is refused rather than obeyed.
 *
 * A switch was read as `modules.store !== false`, written out wherever anybody needed it: forty
 * times across fourteen files in the browser alone, plus the build's own copies. Every one of them
 * is correct, and the convention has one fault that no amount of care fixes —
 *
 *   modules.stor !== false   →   undefined !== false   →   TRUE
 *
 * A typo does not switch a module off or raise an error. It switches it ON, silently, and the
 * feature ships to a site that asked for it to be gone. That is the quietest way a switch can lie,
 * and it is the same fault in the same shape as a build step gated on a module nobody declares —
 * which `loadSteps` now refuses outright rather than reporting.
 *
 * So this refuses too, and for the same reason: a name nobody declares is a bug in the code, not a
 * configuration somebody chose. It throws at the call rather than answering false, because
 * answering false would hide a real feature instead of a fake one, and a module missing with no
 * explanation is harder to find than a stack trace naming the typo.
 *
 * WHERE THE DECLARED SET COMES FROM. `#site` carries it beside the config: the plugin writes
 * `moduleKeys` from the manifests `loadSite` resolved, so the browser knows exactly what the build
 * knew. Under Node's fallback for `#site` there may be no such list, and then nothing is refused —
 * an empty set means "this is not the plugin's `#site`", never "no module exists".
 */
import { modules, moduleKeys } from '#site'

const DECLARED = new Set(moduleKeys || [])

/* on unless the config says false — the one reading */
export const moduleOn = (key) => {
  if (DECLARED.size && !DECLARED.has(key))
    throw new Error(`no module is called \`${key}\` — it is asked about here and no manifest declares it. Did you mean one of: ${[...DECLARED].join(', ')}?`)
  return modules[key] !== false
}

/* the same question of several at once: is ANY of them on */
export const anyModuleOn = (keys) => keys.some((k) => moduleOn(k))

/* what a site actually declares, for a surface that lists the modules rather than asking about one */
export const declaredModules = () => [...DECLARED]

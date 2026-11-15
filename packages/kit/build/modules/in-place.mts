/* the kit's ordered lists keep a moved module's place by its key (openspec: modules-as-packages); no Node here, since an Edge Function reads the content models through it */
/*
 * An ordered list in which a moved module is named by key: 'courses' stands for every entry that module contributes
 * there, and 'events#events-push' for one entry by its own key, where a module's entries stood apart from each other.
 * Every entry a module contributes is placed exactly once.
 */
export function inPlace<T>(list: Array<T | string>, byModule: Record<string, T[]>, what: string): T[] {
  const named = list.filter((e): e is string => typeof e === 'string')
  for (const k of Object.keys(byModule)) if (!named.some((e) => e === k || e.startsWith(k + '#'))) throw new Error(`modules/${k}/ contributes ${what} the list does not place: add '${k}' where its ${what} belong`)
  const keyOf = (x: any) => (x && typeof x === 'object' ? x.key : undefined)
  const placed = new Set<T>()
  const out = list.flatMap((e) => {
    if (typeof e !== 'string') return [e]
    const [k, one] = e.split('#')
    const all = byModule[k]
    if (!all) throw new Error(`the list of ${what} names '${e}', whose folder contributes none`)
    const elsewhere = new Set(named.filter((n) => n.startsWith(k + '#')).map((n) => n.split('#')[1]))
    const pick = one ? all.filter((x) => keyOf(x) === one) : all.filter((x) => !elsewhere.has(keyOf(x)))
    if (one && !pick.length) throw new Error(`the list of ${what} names '${e}', which modules/${k}/ does not contribute`)
    for (const x of pick) placed.add(x)
    return pick
  })
  for (const [k, all] of Object.entries(byModule)) for (const x of all) if (!placed.has(x)) throw new Error(`modules/${k}/ contributes ${what} '${keyOf(x)}' that the list does not place`)
  return out
}

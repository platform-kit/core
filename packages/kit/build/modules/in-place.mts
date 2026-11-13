/* the kit's ordered lists keep a moved module's place by its key (openspec: modules-as-packages); no Node here, since an Edge Function reads the content models through it */
/* an ordered list in which a moved module is named by key: each key replaced by that module's entries for the point */
export function inPlace<T>(list: Array<T | string>, byModule: Record<string, T[]>, what: string): T[] {
  for (const k of Object.keys(byModule)) if (!list.includes(k)) throw new Error(`modules/${k}/ contributes ${what} the list does not place: add '${k}' where its ${what} belong`)
  return list.flatMap((e) => {
    if (typeof e !== 'string') return [e]
    if (!byModule[e]) throw new Error(`the list of ${what} names '${e}', whose folder contributes none`)
    return byModule[e]
  })
}

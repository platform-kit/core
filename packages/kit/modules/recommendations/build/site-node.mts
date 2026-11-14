/* #site/recommendations under Node: the contract's defaults (the site knows nothing of the reader) */
export const signals = (): unknown => null
export const readerSignals = (): Record<string, any> | null => null
export const topicByKey = (_kind: string, _key: string): { slug: string } | null => null
/* the kit does not offer an empty lane: see RECOMMENDATIONS in build/site.mjs */
export const invites = () => false

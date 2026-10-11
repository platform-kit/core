/* #site/recommendations under Node: the contract's defaults (the site knows nothing of the reader) */
export const signals = () => null
export const readerSignals = () => null
export const topicByKey = () => null
/* the kit does not offer an empty lane: see RECOMMENDATIONS in build/site.mjs */
export const invites = () => false

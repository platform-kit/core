/*
 * Enrichment, as the build and the functions reach it (openspec: modules-as-packages): the pipeline of stages and where a
 * stage's result is kept. agent-run walks the stages inside a run through this door.
 */
export { pipeline, Paused } from './pipeline.mjs'
export { runCache, fileCache } from './cache.mjs'

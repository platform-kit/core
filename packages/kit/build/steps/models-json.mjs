/* The content models' JSON: dist/data/models/<key>.json for every model with JSON on (build/models.mjs --json) */
export default {
  key: 'models-json', title: "The models' JSON", phase: 'site', module: 'models',
  inputs: ['content/models/**'],
  run: ({ script }) => script('models.mjs', ['--json']),
}

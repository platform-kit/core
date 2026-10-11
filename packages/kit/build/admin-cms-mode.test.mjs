import { assertAdminCmsShape, contentStoreMode, deploymentShape } from './site.mjs'

let passed = 0
const test = (name, run) => {
  run()
  passed++
  console.log(`admin-cms-mode: ✓ ${name}`)
}

const site = { admin: { models: './build/admin-models.mjs' } }

test('row-backed content maps to the CMS-enabled build flag', () => {
  if (contentStoreMode({ content: 'rows' }) !== 'cloud') throw new Error('row-backed content must build as cloud mode')
  assertAdminCmsShape(site, { backend: true, content: 'rows' })
})

test('file-backed production content is refused for a site requiring the CMS', () => {
  let error
  try { assertAdminCmsShape(site, { backend: true, content: 'files' }) } catch (caught) { error = caught }
  if (!error || !/admin models/.test(error.message)) throw new Error('expected a clear CMS-mode refusal')
})

test('static deployments and sites without a CMS requirement remain valid', () => {
  assertAdminCmsShape(site, { backend: false, content: 'files' })
  assertAdminCmsShape({}, { backend: true, content: 'files' })
  if (contentStoreMode({ content: 'files' }) !== 'git') throw new Error('file-backed content must build as git mode')
})

test('a static deployment cannot be compiled with the row-backed CMS flag', () => {
  let error
  try {
    deploymentShape({ deployment: { backend: false, content: 'files', repo: false } }, { CONTENT_STORE: 'cloud' })
  } catch (caught) { error = caught }
  if (!error || !/static deployment cannot use row-backed content/.test(error.message)) {
    throw new Error('expected row-backed content to be refused for static output')
  }
})

console.log(`admin-cms-mode: ${passed} passed`)

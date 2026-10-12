import { s } from 'velite'
import { checkAll } from './models.mjs'

const { faults, report } = await checkAll(process.cwd(), { s })
if (faults.length) {
  console.error('✖ models:\n  ' + faults.join('\n  '))
  process.exit(1)
}
if (process.argv.includes('--check')) {
  for (const model of report) {
    console.log(`  ${model.key}${model.published ? '' : ' (unpublished)'}: ${model.fields} field(s), ${model.entries} entr${model.entries === 1 ? 'y' : 'ies'} — ${model.deliver.join(', ')}`)
  }
}
console.log(`✔ models: ${report.length} model(s)`)

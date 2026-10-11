/*
 * THE STOCKISTS, COMPILED — the press's own build step.
 *
 * `module: 'stockists'` is the whole of the gating: `whyOff` in the kit's steps.mjs reads it
 * against the resolved module set, which includes this site's own, so the step runs when the
 * switch is on and stops when it is off with nothing else said anywhere. A step naming a module no
 * manifest declares is refused at load, so a typo here stops the build rather than quietly making
 * the step unconditional.
 *
 * It reads content/stockists/*.md and writes the list the page draws, with the distributor the
 * deployment names. Frontmatter only — a shop is a name, a place and a link.
 */
import { writeFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const field = (text, key) => {
  const m = text.match(new RegExp('^' + key + ':\\s*(.*)$', 'm'))
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : ''
}

export default {
  key: 'stockists',
  title: 'The stockists',
  phase: 'prepare',
  module: 'stockists',
  inputs: ['content/stockists/**'],
  needs: { env: ['STOCKISTS_DISTRIBUTOR'] },
  run: async () => {
    const root = process.cwd()
    const dir = path.join(root, 'content/stockists')
    const shops = []
    if (existsSync(dir)) {
      for (const n of (await readdir(dir)).filter((x) => x.endsWith('.md')).sort()) {
        const raw = await readFile(path.join(dir, n), 'utf8')
        const body = raw.replace(/^---[\s\S]*?---\n?/, '').trim()
        shops.push({ slug: n.slice(0, -3), name: field(raw, 'name'), where: field(raw, 'where'), url: field(raw, 'url'), note: body })
      }
    }
    const out = path.join(root, '.velite')
    await mkdir(out, { recursive: true })
    await writeFile(path.join(out, 'stockists.json'), JSON.stringify({
      /* the wholesaler the shops order through; absent, the page says to ask the shop */
      distributor: process.env.STOCKISTS_DISTRIBUTOR || null,
      shops,
    }, null, 2) + '\n')
    console.log(`  the stockists: ${shops.length}`)
  },
}

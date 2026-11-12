/* TWO END-TO-END RUNS OF ONE CHECKOUT, SIDE BY SIDE (openspec: e2e-runs-side-by-side). A run takes the first slot no live
   run holds, and its containers, volumes and image cache are that slot's (build/e2e-container.mjs). What is checked here
   is the claim itself, over lock files in a folder of the test's own: a second run takes the next slot, a slot whose
   process is gone is taken over, a live one never is, and a run gives back only its own. In npm test. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { takeSlot } from './e2e-container.mjs'

let pass = 0, fail = 0
const ok = (msg: string, cond: unknown, detail: unknown = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-e2e-slots-'))
const lock = (n: number) => path.join(dir, `platformkit-e2e-x-${n}.lock`)

try {
  const a = takeSlot('x', dir)
  ok('a run alone takes slot 0, whose names are the checkout\'s own', a.n === 0, a.n)
  const b = takeSlot('x', dir)
  ok('a second run while it goes takes slot 1', b.n === 1, b.n)

  /* a run that crashed: its lock names a process that is gone */
  a.release()
  ok('a run gives its slot back when it ends', !fs.existsSync(lock(0)))
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout
  fs.writeFileSync(lock(0), dead)
  const c = takeSlot('x', dir)
  ok('a slot whose run is gone is taken over', c.n === 0, c.n)
  c.release()

  /* a live run of another process keeps its slot */
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' })
  fs.writeFileSync(lock(0), String(other.pid))
  const d = takeSlot('x', dir)
  ok('a slot a live run holds is never taken', d.n === 2, d.n)
  d.release(); b.release()
  ok('…and a run gives back only its own', fs.readFileSync(lock(0), 'utf8') === String(other.pid))
  other.kill()
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
console.log(fail ? `e2e-slots: ${fail} failed, ${pass} passed` : `e2e-slots: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)

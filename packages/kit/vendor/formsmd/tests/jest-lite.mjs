/* The few Jest matchers forms.md's own tests use, so those tests run under plain Node as they were written
   (the `require`s turned into imports, nothing else). Registered tests run on `run()`; each failure names the case. */
import assert from 'node:assert/strict'
const tests = []
export const test = (name, fn) => tests.push({ name, fn })
const matchObject = (a, b) => { if (typeof b !== 'object' || b === null) return a === b; if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((x, i) => matchObject(a[i], x)); return Object.keys(b).every((k) => matchObject(a && a[k], b[k])) }
export const expect = (got) => ({
  toBe: (want) => assert.strictEqual(got, want),
  toEqual: (want) => assert.deepStrictEqual(got, want),
  toStrictEqual: (want) => assert.deepStrictEqual(got, want),
  toMatchObject: (want) => assert.ok(matchObject(got, want), `expected ${JSON.stringify(got)} to match ${JSON.stringify(want)}`),
  toBeTruthy: () => assert.ok(got),
  toBeFalsy: () => assert.ok(!got),
  toContain: (x) => assert.ok(typeof got === 'string' ? got.includes(x) : got.includes(x), `expected to contain ${x}`),
  toHaveLength: (n) => assert.strictEqual(got.length, n),
  toThrow: (msg) => assert.throws(got, msg ? (e) => String(e && e.message !== undefined ? e.message : e).includes(msg) : undefined),
})
/* a whitespace-insensitive html normaliser standing in for the `beautify` package one test compared <option> lists with */
export const beautify = (html) => String(html).replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim()
export async function run(label) {
  let bad = 0
  for (const t of tests) { try { await t.fn() } catch (e) { bad++; console.log('  FAIL', label + ':', t.name, '\n   ', String(e.message || e).split('\n')[0]) } }
  const n = tests.length; tests.length = 0
  return { n, bad }
}

/*
 * THE DATABASE TYPES ARE THE SCHEMA'S (build/db-types.mjs): generated afresh in a throwaway Postgres and compared with
 * the file the kit carries. It needs Docker, so it runs in the end-to-end run (E2E_ALSO), once, on the first site.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generate, nullableArgs } from './db-types.mjs'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'functions', '_shared', 'database.types.ts')

test('a database function takes null for any argument', () => {
  const out = nullableArgs('type D = { Functions: { f: { Args: { a: string; b?: number }; Returns: Json } } }')
  assert.match(out, /a: string \| null/)
  assert.match(out, /b\?: number \| null/)
  assert.equal(nullableArgs(out), out)
})

test('a column a trigger fills is optional to insert', () => {
  const out = nullableArgs('type D = { Tables: { space_messages: { Row: { seq: number }; Insert: { seq: number; body: string } } } }')
  assert.match(out, /Insert: \{ seq\?: number; body: string \}/)
  assert.match(out, /Row: \{ seq: number \}/)
})

const site = process.env.PLATFORMKIT_TEST_SITE || ''
test('the file is what the schema gives', { skip: process.env.PLATFORMKIT_E2E !== '1' ? 'it needs Docker: the end-to-end run checks it' : site && site !== 'club' ? 'not on this site: club checks it' : false }, async () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), await generate(), 'run platformkit db-types')
})

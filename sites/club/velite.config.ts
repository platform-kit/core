import { defineConfig } from 'velite'
import { kitConfig } from 'platformkit/build/velite.mjs'

export default defineConfig(await kitConfig())

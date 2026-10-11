import { defineConfig } from 'velite'
import { kitConfig } from '@platform-kit/kit/build/velite.mjs'

export default defineConfig(await kitConfig())

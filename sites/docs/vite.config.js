import { defineConfig } from 'vite'
import { platformkit } from '@platform-kit/kit/vite'

export default defineConfig(async () => ({ plugins: [await platformkit()] }))

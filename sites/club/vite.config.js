import { defineConfig } from 'vite'
import { platformkit } from 'platformkit/vite'

export default defineConfig(async () => ({ plugins: [await platformkit()] }))

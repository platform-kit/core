#!/bin/sh
# Lay out dist/ for Apache: the SPA at the root with its rewrites.
set -eu
cd "$(dirname "$0")/../.."

site_root="$(node --input-type=module -e '
  import { loadEnv } from "vite"
  import { defaultSite, workspaceRoot } from "./packages/kit/build/sites.mjs"
  const root = workspaceRoot(process.cwd())
  const env = { ...loadEnv("development", root, "PLATFORMKIT_"), ...process.env }
  process.stdout.write(defaultSite(root, env).directory)
')"

npm run build
cp deploy/apache/htaccess-root "$site_root/dist/.htaccess"

echo "$site_root/dist/ is ready."

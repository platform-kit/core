# The selected site's static build (sites/docs/dist by default) served with the rewrites the
# site needs to the project's Edge Functions — deploy/_redirects is the one list; templates/rewrites.inc.template here
# is generated from it by packages/kit/build/rewrites.mjs (never edited by hand).
#
#   npm run build                                  the selected site, from the repository's root
#   docker build -f deploy/nginx/Dockerfile -t site .
#   docker run -p 8080:80 -e SUPABASE_URL=https://<ref>.supabase.co site
#
# Set SITE_DIST to another site's dist directory when building a different site.
# SUPABASE_URL is the project's address, the same name the _redirects file uses (http://host.docker.internal:54321 for
# a local stack); the entrypoint derives SUPABASE_HOST from it for the Host header. nginx's own image fills the
# templates from the environment at start.
# THE HOST MAP, AS JAVASCRIPT. Its modules are TypeScript in the kit, and Alpine's own Node is built without TypeScript, so
# the official Node image strips their types once, here, and writes each under the .mjs name its importers already use.
FROM node:22-alpine AS hostmap
WORKDIR /hostmap
COPY packages/kit/build/hosts.mts packages/kit/build/sites.mts packages/kit/build/runtime-paths.mts packages/kit/build/site-file.mts packages/kit/build/is-main.mjs ./
RUN node -e "const fs=require('fs'),{stripTypeScriptTypes}=require('node:module');for(const f of fs.readdirSync('.'))if(f.endsWith('.mts'))fs.writeFileSync(f.slice(0,-4)+'.mjs',stripTypeScriptTypes(fs.readFileSync(f,'utf8')))" && rm ./*.mts

FROM nginx:1.27-alpine AS base
RUN apk add --no-cache nodejs
COPY deploy/nginx/templates/ /etc/nginx/templates/
COPY deploy/nginx/15-supabase-host.envsh /docker-entrypoint.d/15-supabase-host.envsh
COPY deploy/nginx/30-hosts.sh /docker-entrypoint.d/30-hosts.sh
COPY deploy/nginx/40-prerender.sh /docker-entrypoint.d/40-prerender.sh
COPY --from=hostmap /hostmap/ /workspace/packages/kit/build/
COPY sites/ /workspace/sites/
RUN chmod +x /docker-entrypoint.d/15-supabase-host.envsh /docker-entrypoint.d/30-hosts.sh /docker-entrypoint.d/40-prerender.sh
# the templates land in conf.d: default.conf the server, the .inc files what it includes (nginx loads *.conf alone)
ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/conf.d
EXPOSE 80

FROM base AS dev

FROM base AS site
ARG SITE_DIST=sites/docs/dist
COPY ${SITE_DIST}/ /usr/share/nginx/html/

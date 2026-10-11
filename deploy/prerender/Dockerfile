# The prerender sidecar: one Chrome that answers a crawler with rendered html and photographs the
# app's own share card. Run beside the site in a CLOUD deployment only — a static or git-backed
# site bakes both at build time and starts nothing (deploy/nginx/docker-compose.yml).
#
#   docker compose -f deploy/nginx/docker-compose.yml --profile cloud up
#
# The image is Playwright's, so the browser and its libraries are already there and pinned together.
FROM mcr.microsoft.com/playwright:v1.55.0-noble
WORKDIR /app
ENV NODE_ENV=production
COPY deploy/prerender/server.mjs ./server.mjs
# playwright is the only dependency, and the base image carries the browsers
RUN npm init -y >/dev/null && npm install playwright@1.55.0 --no-audit --no-fund
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]

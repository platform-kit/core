ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-slim

RUN apt-get update -qq \
  && apt-get install --no-install-recommends -y ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY agent.mts protocol.mts providers.mts ./

ENV NODE_ENV=production
USER node
CMD ["node", "agent.mts", "start"]

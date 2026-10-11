# The one environment this project is developed and built in. Everything the
# scripts need is here, so nothing depends on the machine that happens to host
# the container: Node 22 (the app, the build, the admin), ffmpeg (the spoken
# books are encoded with it), Chromium's system libraries (the prerender and
# the share images run a headless browser), and the CPU is all the text-to-
# speech engine wants (onnxruntime-node). Python is not needed anywhere.
FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ARG NODE_MAJOR=22
ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg ffmpeg git \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Chromium's shared libraries, installed once at image level so `playwright
# install chromium` in post-create needs no root and no apt
RUN npx --yes playwright@1.63.0 install-deps chromium && rm -rf /root/.npm

USER vscode

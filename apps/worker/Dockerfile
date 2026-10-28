FROM node:22-bookworm-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.8 prune @weft/worker --docker

FROM base AS deps
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile --prod

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
  INSTALL_CACHE_DIR=/var/lib/weft/installs
WORKDIR /repo
COPY --from=deps /repo/ .
COPY --from=prune /repo/out/full/ .
RUN mkdir -p /var/lib/weft/installs && chown -R node:node /var/lib/weft
WORKDIR /repo/apps/worker
USER node
ENTRYPOINT ["tini", "--"]
CMD ["node", "src/main.ts"]

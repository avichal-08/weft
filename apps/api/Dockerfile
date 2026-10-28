FROM node:22-bookworm-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.8 prune @weft/api --docker

FROM base AS deps
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile --prod

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps /repo/ .
COPY --from=prune /repo/out/full/ .
WORKDIR /repo/apps/api
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/server.ts"]

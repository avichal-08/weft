FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN git config --system safe.directory '*' \
  && git config --system user.name weft \
  && git config --system user.email weft@localhost \
  && git config --system init.defaultBranch main \
  && corepack enable

ENV COREPACK_HOME=/opt/corepack \
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  CI=1 \
  NO_COLOR=1

RUN corepack install --global pnpm@latest yarn@stable \
  && pnpm --version >/dev/null \
  && yarn --version >/dev/null \
  && chmod -R a+rX /opt/corepack

RUN mkdir /workspace && chown node:node /workspace
WORKDIR /workspace
USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]

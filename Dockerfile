# syntax=docker/dockerfile:1
# Build context: the repo root (the image needs `shared` and the workspace lockfile).
#   docker build -f backend/Dockerfile .
# One image for both processes: `node dist/main.js` (api) and `node dist/worker.js` (worker).

FROM node:24-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# Package manifests only, so the install layer is rebuilt on dependency changes, not on code edits
FROM base AS manifests
COPY . /src
RUN cd /src && mkdir /out && cp pnpm-lock.yaml pnpm-workspace.yaml package.json /out/ \
 && find . -name package.json -not -path '*/node_modules/*' -mindepth 2 \
    | while read -r f; do mkdir -p "/out/$(dirname "$f")" && cp "$f" "/out/$f"; done

FROM base AS build
COPY --from=manifests /out .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter backend...
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter backend... build \
 && pnpm --filter backend deploy --prod --store-dir /pnpm/store /prod

FROM node:24-alpine
ENV NODE_ENV=production TZ=UTC
WORKDIR /app
COPY --from=build --chown=node:node /prod .
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

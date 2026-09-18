# Builds the client bundle and the server bundle, then runs one Node process that serves
# both (static files and WebSocket) on $PORT. See README "Deployment".
FROM node:22-alpine AS build
# Build identity, baked into both bundles and their build-info.json (docs/OPERATIONS.md).
ARG GAME_VERSION
ARG SOURCE_REVISION
ENV GAME_VERSION=$GAME_VERSION SOURCE_REVISION=$SOURCE_REVISION
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
# Runtime defaults (docs/OPERATIONS.md). Match records and finished journals go to the two
# volumes so a restart or a rollback keeps them; secrets (ADMIN_TOKEN) and the origin list
# come from the environment at run time, never from the image.
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/client STATE_DIR=/app/state JOURNAL_DIR=/app/journals \
    LOG_LEVEL=info INVARIANT_CHECKS=critical SHUTDOWN_TIMEOUT_MS=10000
COPY --from=build /app/apps/server/dist/server.js /app/apps/server/dist/build-info.json ./
COPY --from=build /app/apps/client/dist ./client
RUN mkdir -p /app/state /app/journals && chown -R node:node /app/state /app/journals
VOLUME ["/app/state", "/app/journals"]
EXPOSE 8080
USER node
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:8080/readyz || exit 1
CMD ["node", "server.js"]

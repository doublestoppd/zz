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
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/client
COPY --from=build /app/apps/server/dist/server.js /app/apps/server/dist/build-info.json ./
COPY --from=build /app/apps/client/dist ./client
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.js"]

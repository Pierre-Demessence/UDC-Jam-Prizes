# syntax=docker/dockerfile:1

# The API runs on Node's native TypeScript support, which needs >= 23.6, so the
# image is Node 24.
FROM node:24-bookworm-slim AS toolchain

# better-sqlite3 ships no prebuilt binary for Node 24, so npm falls back to
# node-gyp and needs a compiler. It lives in this stage only: neither the build
# nor the runtime image carries a toolchain.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

FROM toolchain AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build

WORKDIR /app

COPY . .
RUN npm run build

# Drops the devDependencies (vite, TypeScript, ESLint, Vitest) without touching
# the already-compiled better-sqlite3 binary.
FROM deps AS runtime-deps

RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only. package.json comes along too: it carries
# "type": "module", which is what makes Node read the server's .ts files as ESM.
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY package.json ./

# The API runs from source: server/index.ts needs server/, and db.ts resolves the
# migrations folder relative to itself, so drizzle/ must sit beside it. The
# client is already built into dist/.
COPY --from=build /app/dist ./dist
COPY server ./server
COPY drizzle ./drizzle

# Matches the uid/gid the manifests run as, so the SQLite file on the mounted
# volume is written by the same user every time.
RUN groupadd --system --gid 1001 app \
  && useradd --system --uid 1001 --gid 1001 --no-create-home app
USER 1001

ENV PORT=3001
EXPOSE 3001

CMD ["node", "server/index.ts"]

# syntax=docker/dockerfile:1.7

FROM node:24.13.1-trixie-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build

COPY src ./src
COPY tsconfig.json tsdown.config.ts ./
RUN pnpm run build

FROM base AS prod-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM node:24.13.1-trixie AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV LUNA_HOME=/home/node/.luna

WORKDIR /app

RUN gosu node git config --global user.name "Luna" && gosu node git config --global user.email "luna@s2n.tech"
RUN npm install --global @openai/codex@0.106.0

COPY --from=build /app/dist ./dist
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY templates ./templates
COPY entrypoint.sh /usr/local/bin/

ENTRYPOINT ["entrypoint.sh"]
CMD ["./dist/index.mjs"]

# syntax=docker/dockerfile:1.7

FROM oven/bun:latest AS deps
WORKDIR /app
COPY bun.lock package.json tsconfig.json ./
RUN bun install --ci --production

FROM oven/bun:latest AS runtime
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# postinstall vendors these into static/; they are gitignored, so take the
# copies the deps stage produced.
COPY --from=deps /app/static/htmx.min.js /app/static/idiomorph-ext.min.js ./static/

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# No volume: Lunch Money is the store.
CMD ["bun", "run", "main.ts"]

# Stage 1: install production dependencies
FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS deps
RUN apk upgrade --no-cache && apk add --no-cache python3 make g++
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Stage 2: build
FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS builder
RUN apk upgrade --no-cache && apk add --no-cache python3 make g++
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci
COPY shared/ ./shared/
COPY server/ ./server/
RUN cd server && npm run build

# Stage 3: runtime
FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS runner
RUN apk upgrade --no-cache && \
    rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx
WORKDIR /app
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=builder /app/server/dist ./server/dist
RUN mkdir -p server/dist/server/public/uploads
COPY server/docker-entrypoint.sh ./server/docker-entrypoint.sh
RUN chmod +x server/docker-entrypoint.sh
RUN chown -R node:node /app/server
USER node
WORKDIR /app/server
ENTRYPOINT ["./docker-entrypoint.sh"]

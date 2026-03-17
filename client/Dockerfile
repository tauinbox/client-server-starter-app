# Stage 1: build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY mock-server/package.json ./mock-server/
RUN npm ci --workspace=client --ignore-scripts
COPY shared/ ./shared/
COPY client/ ./client/
ARG COMMIT_HASH=unknown
ARG BASE_HREF=/nexus/
ENV PATH=/app/node_modules/.bin:$PATH
RUN cd client && COMMIT_HASH=$COMMIT_HASH NODE_OPTIONS="--max-old-space-size=2048" npm run build -- --base-href $BASE_HREF

# Stage 2: runtime
FROM nginx:1.28-alpine AS runner
RUN apk upgrade --no-cache && \
    apk upgrade --no-cache \
        --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main \
        zlib && \
    mkdir -p /var/cache/nginx /tmp/nginx && \
    chown -R nginx:nginx /var/cache/nginx /tmp/nginx /usr/share/nginx/html && \
    sed -i 's|/run/nginx.pid|/tmp/nginx/nginx.pid|' /etc/nginx/nginx.conf
COPY --from=builder /app/client/dist/client/browser /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
USER nginx
EXPOSE 8080

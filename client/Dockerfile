# Stage 1: build
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS builder
WORKDIR /app
COPY client/package*.json ./client/
RUN cd client && npm ci --ignore-scripts
COPY shared/ ./shared/
COPY client/ ./client/
ARG COMMIT_HASH=unknown
ARG BASE_HREF=/nexus/
RUN cd client && COMMIT_HASH=$COMMIT_HASH NODE_OPTIONS="--max-old-space-size=2048" npm run build -- --base-href $BASE_HREF

# Stage 2: runtime
FROM nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236 AS runner
# The stock image pins nginx and its dynamic modules to an exact revision; the modules
# (none are loaded for static SPA serving) require cmd:nginx=<exact> and lag the core
# security revision, blocking nginx upgrades. Drop them so apk can move nginx to the
# latest patched revision from the stable repo.
RUN apk del nginx-module-acme nginx-module-geoip nginx-module-image-filter nginx-module-njs nginx-module-xslt && \
    apk upgrade --no-cache && \
    apk add --no-cache --upgrade nginx && \
    mkdir -p /var/cache/nginx /tmp/nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx /tmp/nginx /usr/share/nginx/html && \
    sed -i 's|/run/nginx.pid|/tmp/nginx/nginx.pid|' /etc/nginx/nginx.conf
# CVE_PATCHES_START
RUN apk upgrade --no-cache \
    --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main \
    libcrypto3 libssl3
# CVE_PATCHES_END
COPY --from=builder /app/client/dist/client/browser /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
USER nginx
EXPOSE 8080

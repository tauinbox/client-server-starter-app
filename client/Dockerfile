# Stage 1: build
FROM node:22-alpine AS builder
WORKDIR /app
COPY client/package*.json ./client/
RUN cd client && npm ci --ignore-scripts
COPY shared/ ./shared/
COPY client/ ./client/
ARG COMMIT_HASH=unknown
RUN cd client && COMMIT_HASH=$COMMIT_HASH NODE_OPTIONS="--max-old-space-size=2048" npm run build -- --base-href /nexus/

# Stage 2: runtime
FROM nginx:1.28-alpine AS runner
RUN apk upgrade --no-cache && \
    mkdir -p /var/cache/nginx /tmp/nginx && \
    chown -R nginx:nginx /var/cache/nginx /tmp/nginx /usr/share/nginx/html && \
    sed -i 's|/run/nginx.pid|/tmp/nginx/nginx.pid|' /etc/nginx/nginx.conf
COPY --from=builder /app/client/dist/client/browser /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
USER nginx
EXPOSE 8080

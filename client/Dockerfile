# Stage 1: build
FROM node:24-alpine@sha256:fb71d01345f11b708a3553c66e7c74074f2d506400ea81973343d915cb64eef0 AS builder
WORKDIR /app
COPY client/package*.json ./client/
RUN cd client && npm ci --ignore-scripts
COPY shared/ ./shared/
COPY client/ ./client/
ARG COMMIT_HASH=unknown
ARG BASE_HREF=/nexus/
RUN cd client && COMMIT_HASH=$COMMIT_HASH NODE_OPTIONS="--max-old-space-size=2048" npm run build -- --base-href $BASE_HREF

# Stage 2: runtime
FROM nginx:1.31-alpine@sha256:8b1e78743a03dbb2c95171cc58639fef29abc8816598e27fb910ed2e621e589a AS runner
RUN apk upgrade --no-cache && \
    mkdir -p /var/cache/nginx /tmp/nginx && \
    chown -R nginx:nginx /var/cache/nginx /tmp/nginx /usr/share/nginx/html && \
    sed -i 's|/run/nginx.pid|/tmp/nginx/nginx.pid|' /etc/nginx/nginx.conf
COPY --from=builder /app/client/dist/client/browser /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
USER nginx
EXPOSE 8080

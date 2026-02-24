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
FROM nginx:1.27-alpine AS runner
RUN mkdir -p /var/cache/nginx /var/run && \
    chown -R nginx:nginx /var/cache/nginx /var/run /usr/share/nginx/html
COPY --from=builder /app/client/dist/client/browser /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
USER nginx
EXPOSE 8080

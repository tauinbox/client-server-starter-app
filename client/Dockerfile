# Stage 1: build
FROM node:22-alpine AS builder
WORKDIR /app
COPY client/package*.json ./client/
RUN cd client && npm ci --ignore-scripts
COPY shared/ ./shared/
COPY client/ ./client/
RUN cd client && NODE_OPTIONS="--max-old-space-size=2048" npm run build -- --base-href /nexus/

# Stage 2: runtime
FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/client/dist/client/browser /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

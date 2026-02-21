# Stage 1: build
FROM node:18-alpine AS builder
WORKDIR /app
COPY client/package*.json ./client/
RUN cd client && npm ci
COPY shared/ ./shared/
COPY client/ ./client/
RUN cd client && npm run build -- --base-href /nexus/

# Stage 2: runtime
FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/client/dist/client/browser /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

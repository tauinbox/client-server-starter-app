# Stage 1: install production dependencies
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS deps
RUN apk upgrade --no-cache && apk add --no-cache python3 make g++
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Stage 2: build
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS builder
RUN apk upgrade --no-cache && apk add --no-cache python3 make g++
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci
COPY shared/ ./shared/
COPY server/ ./server/
RUN cd server && npm run build

# Stage 3: IP geolocation database (DB-IP Lite, CC BY 4.0, https://db-ip.com).
# A release appears early in each month, so the previous month is the fallback.
# A failed download leaves the directory empty: the server then shows no
# session location, and a third-party outage cannot block a deploy.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS geoip
WORKDIR /geoip
RUN set -o pipefail; \
    this_month=$(date -u +%Y-%m); \
    last_month=$(date -u -d "@$(( $(date -u -d "${this_month}-01" +%s) - 86400 ))" +%Y-%m); \
    for month in "$this_month" "$last_month"; do \
      if wget -qO- "https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz" \
          | gunzip > dbip-city-lite.mmdb; then \
        echo "GeoIP database: dbip-city-lite-${month}"; exit 0; \
      fi; \
    done; \
    rm -f dbip-city-lite.mmdb; \
    echo "WARNING: GeoIP database not downloaded; session locations are disabled"

# Stage 4: runtime
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runner
RUN apk upgrade --no-cache && \
    rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx
WORKDIR /app
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=builder /app/server/dist ./server/dist
COPY --from=geoip /geoip ./server/geoip
ENV GEOIP_DB_PATH=/app/server/geoip/dbip-city-lite.mmdb
RUN mkdir -p server/dist/server/public/uploads
COPY server/docker-entrypoint.sh ./server/docker-entrypoint.sh
RUN chmod +x server/docker-entrypoint.sh
RUN chown -R node:node /app/server
USER node
WORKDIR /app/server
ENTRYPOINT ["./docker-entrypoint.sh"]

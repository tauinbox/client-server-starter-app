#!/bin/sh
set -e

echo "Running database migrations..."
node_modules/.bin/typeorm migration:run -d dist/server/src/postgres-data-source.js

echo "Starting application..."
exec node dist/server/src/main

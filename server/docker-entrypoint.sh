#!/bin/sh
set -e

echo "Running the boot steps (migrations, admin seed)..."
node dist/server/src/run-boot-steps.js

echo "Starting application..."
exec node dist/server/src/main

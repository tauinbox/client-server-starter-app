#!/bin/sh
set -e

echo "Running the boot steps (migrations, admin seed)..."
node dist/server/src/run-boot-steps.js

echo "Starting application..."
# The server logs in with the roles of its data sources. The password of the
# administrator stays with the boot steps.
exec env -u DB_PASSWORD node dist/server/src/main

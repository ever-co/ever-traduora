#!/bin/sh
set -ex

# This Entrypoint used inside Docker Compose only

# For SQLite, no need to wait for database server
if [ "$TR_DB_TYPE" = "better-sqlite3" ] || [ "$TR_DB_TYPE" = "sqlite3" ]; then
    echo "Using SQLite database, skipping database server wait..."
else
    # For other database types, wait for connection
    export WAIT_HOSTS=$TR_DB_HOST:$TR_DB_PORT
    ./wait
fi

exec node src/main.js
#!/bin/sh
set -ex

# This Entrypoint used inside Docker Compose only

export WAIT_HOSTS=$TR_DB_HOST:$TR_DB_PORT

# in Docker Compose we should wait other services start
./wait

exec node src/main.js

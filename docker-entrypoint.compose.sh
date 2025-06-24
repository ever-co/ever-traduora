#!/bin/sh
set -ex

# This Entrypoint used inside Docker Compose only

# Pour SQLite, pas besoin d'attendre un serveur de base de données
if [ "$TR_DB_TYPE" = "better-sqlite3" ]; then
    echo "Using SQLite database, skipping database server wait..."
else
    # Pour d'autres types de DB, attendre la connexion
    export WAIT_HOSTS=$TR_DB_HOST:$TR_DB_PORT
    ./wait
fi

exec node src/main.js
#!/bin/sh

set -e

bin/install-deps.sh

yarn concurrently "cd api && yarn start" "cd webapp && yarn start"

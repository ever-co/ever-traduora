#!/bin/sh

set -e

bin/install-deps.sh

# Cleanup
[ -e dist ] && rm -r dist

# Build webapp
cd webapp && yarn build:prod

# Build api
cd ../api && yarn build:prod
cp -r node_modules ../dist/

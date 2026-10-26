#!/bin/sh

set -e

yarn
# --frozen-lockfile: the image must install exactly what webapp/yarn.lock and api/yarn.lock pin (owner 2026-10-26);
# a lock that no longer matches package.json now fails the build instead of re-resolving silently.
cd webapp && yarn install --frozen-lockfile
cd ../api && yarn install --frozen-lockfile

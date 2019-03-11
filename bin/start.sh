#!/bin/sh

set -e

cd dist
exec node src/main.js

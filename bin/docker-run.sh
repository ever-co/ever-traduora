#!/bin/sh

set -e

# The image runs in production mode, which requires TR_SECRET: reuse yours, or generate one for this run
# (sign-ins then do not survive the next run)
TR_SECRET="${TR_SECRET:-$(openssl rand -hex 32)}"
export TR_SECRET

docker run -it -p 8080:8080 -e TR_SECRET everco/ever-traduora:latest

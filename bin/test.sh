#!/bin/sh

set -e

cd api && yarn test && yarn test:e2e

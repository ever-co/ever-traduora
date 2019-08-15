#!/bin/sh

set -e

cd api && yarn test:ci

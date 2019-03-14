#!/bin/sh

set -e

yarn
cd webapp && yarn
cd ../api && yarn

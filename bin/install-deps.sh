#!/bin/sh

set -e

cd webapp && yarn
cd ../api && yarn

#!/bin/bash

# usage: bin/version.sh 1.2.3

# Hint:
#   Before releasing you may directly invoke this script.
#   If versions are defined according to the passed release,
#   this script is just serving as a verification step.

set -e

if [[ $1 == "" ]]; then
    echo "No release version set"
    exit 1
fi

RELEASE=$1

# sets the version in package.json
#   `npm version` takes care of ensuring a valid semver version,
#   or a semver'ish version starting with a zero
function version {
    cd $1 > /dev/null
    echo "Setting version in $1/package.json"
    npm version $RELEASE --allow-same-version --git-tag-version false
    cd - > /dev/null
}

version .
version api
version webapp

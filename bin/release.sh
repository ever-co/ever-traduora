#!/bin/bash
# usage: bin/release.sh 1.2.3

set -e

# Check prerequisites

## no jq? -> https://stedolan.github.io/jq/
command -v jq || echo "Please make sure jq is executable"

## ./bin/version.sh 1.2.3
./bin/version.sh $1

if ! [[ -z $(git status -s) ]]; then
    echo "You have uncommited or staged changes on git, please commit them or stash them"
    exit 1
fi

TAGS_FOUND=$(jq -r --slurp 'reduce .[] as $item ([]; . += ["\($item.version)"] ) | unique | join(", ")' \
    package.json \
    api/package.json \
    webapp/package.json \
)

if ! [[ "$TAGS_FOUND" == "$RELEASE" ]]; then
    echo "package.json version and release version provided should be equal"
    echo "Found: $TAGS_FOUND - expected $RELEASE"
    exit 1
fi

echo "Running checks"
bin/check.sh

echo "Tagging and pushing release to upstream"
git tag $RELEASE -m "Release $RELEASE, please check the changelog for more details"
git push origin master --follow-tags

echo "Successfully pushed release $RELEASE to upstream"

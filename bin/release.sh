#!/bin/bash
# usage: bin/release.sh 1.2.3

set -e

RELEASE=$1

function isGitClean {
    if ! [[ -z $(git status -s) ]]; then
        echo "You have uncommited or staged changes on git, please commit them or stash them"
        return 1
    fi
    return 0
}

function displayVersioningHint {
    echo "Versions altered, you may fix this by running the following:"
    echo ""
    echo "  git add -u && git commit --amend --no-edit -a && bin/release.sh $RELEASE "
    echo ""
    echo "When preparing a new release, you can edit all package.json files at once via"
    echo ""
    echo "  bin/version.sh $RELEASE"
}

# Check prerequisites
isGitClean || exit 1

## ./bin/version.sh 1.2.3
(./bin/version.sh $RELEASE)

# Check prerequisites
isGitClean || (displayVersioningHint && exit 1)

echo "Running checks"
bin/check.sh

echo "Tagging and pushing release to upstream"
git tag $RELEASE -m "Release $RELEASE, please check the changelog for more details"
git push origin master --follow-tags

echo "Successfully pushed release $RELEASE to upstream"

#!/bin/bash

set -e

DOCKER_REPO=traduora/traduora

docker build -t "$DOCKER_REPO:latest" .

if [[ $RELEASE != "" ]]; then
    echo $DOCKER_PASSWORD | docker login -u $DOCKER_USER --password-stdin

    echo "Releasing docker image: $DOCKER_REPO with latest tag"
    docker push "$DOCKER_REPO:latest"

    echo "Releasing docker image: $DOCKER_REPO with tag: $RELEASE"
    docker tag "$DOCKER_REPO:latest" $DOCKER_REPO:$RELEASE
    docker push "$DOCKER_REPO:$RELEASE"
fi

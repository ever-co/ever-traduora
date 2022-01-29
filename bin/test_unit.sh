#!/bin/bash

set -e

export TERM=xterm

function pprint() {
  local s=("$@") b w
  for l in "${s[@]}"; do
    ((w<${#l})) && { b="$l"; w="${#l}"; }
  done
  tput setaf 3
  echo "-${b//?/-}-"
  for l in "${s[@]}"; do
    printf '%s%*s%s\n' "$(tput setaf 2)" "-$w" "$l"
  done
  tput setaf 3
  echo "-${b//?/-}-"
  tput sgr 0
}

pprint "Installing dependencies if needed"
bin/install-deps.sh

pprint "Running Unit Tests" "Ensure you are running a local MySQL with a database called 'tr_e2e'"
cd api && yarn test

pprint "All Unit Tests passed!"

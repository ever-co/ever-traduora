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

pprint "Applying code format"
yarn fmt

if ! [[ -z $(git status -s) ]]; then
    echo "You have uncommited changes on git or you might need to apply formatting to your source code (yarn fmt)"
    exit 1
fi

pprint "Linting API code"
cd api && yarn lint

pprint "Linting webapp code"
cd ../webapp && yarn lint

pprint "Running unit and e2e tests" "Ensure you are running a local MySQL with a database called 'tr_e2e'"
cd .. && bin/test.sh

pprint "All checks passed!"

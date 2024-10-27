---
id: contributing
title: Contributing
sidebar_label: Contributing
---

First of all, thank you for your interest in contributing! Any kind of contribution to Traduora is more than welcome. Below you'll find some guidance on how to help with the project.

## Running Traduora locally with hot code reload

Assuming you have MySQL 5.7 running locally with a database called `tr_dev`, username `root` and empty password, from the project's root directory run the following:

```sh
bin/start-dev.sh
```

Once ready, the API will be listening on `:8080` and the webapp on `:4200`.

## Ways to help:

The starting point would be to get familiar with our product and the existing codebase, and know your way around. Read the docs, run it locally and generally get a feel for the product.

If you want to help out, there are lots of ways, for example:

- Working on new features
- Improving existing features
- Fixing bugs
- Helping with docs
- Telling your friends

## Review Process for this Repo

When you submit a pull request, it goes through the review process outlined below. We aim to start reviewing pull requests in this repo the week they are submitted, but the length of time to complete the process will vary depending on the pull request.

### Step 1: checking with the community

We recommend you to check the open issues and PRs on GitHub before working on your changes, there might already be some previous work on the same topic and you might want to be up to date.

### Step 2: working on your changes

Simply follow the next steps:

- Fork the project.
- Create a new branch.
- Make your changes and write tests when practical.
- Commit your changes to the new branch.
- Send a pull request, it will be reviewed shortly.

### Step 3: submit your PR

After a PR is submitted, a core committer will start reviewing your pull request and either give feedback or approve the PR. Any comments should be addressed before the pull request is merged.

Also please note that if the PR is a major change, the merge is likely to be postponed until the next release cycle.

### Step 4: merging your PR

General requirements for merging:

1. Run checks with `bin/check.sh` (it will also auto format files).
1. The PR must be approved by a core committer before merging.
1. If there are any API changes, the documentation must be also updated.
1. Anyone wishing to contribute to the <https://github.com/ever-co/ever-traduora> project must read & sign our [Contributor License Agreement](https://cla-assistant.io/traduora/traduora).
1. Any relevant changes should have an entry in the [changelog](changelog.md) (you can add an entry under the `next` section).

Once your PR is merged into `master`, it will eventually land on the next release of Traduora.  
Once again, thank you for contributing, we really appreciate it!

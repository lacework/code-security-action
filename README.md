<img src="https://techally-content.s3-us-west-1.amazonaws.com/public-content/lacework_logo_full.png" width="600">

# Lacework Code Security for GitHub Actions

This repository contains a GitHub Action for using Lacework's code security offering on your code. In order for the code in this repository to run, you must be a Lacework customer that has been opted into the beta of our code security program. Please contact Lacework support for more information.

## Usage

### Creating secrets

Before attempting to run this action, you should add three secrets `LW_ACCOUNT_NAME`, `LW_API_KEY` and `LW_API_SECRET` to your GitHub repository (or, better yet, your GitHub organization so they can be shared accross all your repositories). The value for these secrets can be obtained by following the instructions [here](https://docs.lacework.com/console/api-access-keys) to create an API key and then download it.

### On pull requests

To run an analysis on PRs that highlights new alerts, create a file called `.github/workflows/code-analysis-pr.yml` with this content:

```yaml
on:
  pull_request:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

env:
  LW_ACCOUNT_NAME: ${{ secrets._LW_ACCOUNT_NAME }}
  LW_API_KEY: ${{ secrets.LW_API_KEY }}
  LW_API_SECRET: ${{ secrets.LW_API_SECRET }}

name: Lacework Code Security (PR)
jobs:
  run-analysis:
    runs-on: ubuntu-20.04
    name: Run analysis
    strategy:
      matrix:
        target: [new, old]
    steps:
      - name: Checkout repository
        uses: actions/checkout@v3
        with:
          fetch-depth: 2
      - name: Checkout old
        if: ${{ matrix.target == 'old' }}
        run: git checkout HEAD^1
      - name: Analyze
        uses: lacework/code-security-action@v1
        with:
          target: ${{ matrix.target }}
          tools: sca # Comma-separated list of tool(s) to use for scanning. Current options are sca
  display-results:
    runs-on: ubuntu-20.04
    name: Display results
    needs:
      - run-analysis
    steps:
      - name: Results
        id: code-analysis
        uses: lacework/code-security-action@v1
        with:
          tools: sca # Should be the same list of tools as above.
          token: ${{ secrets.GITHUB_TOKEN }}
```

### On push

To run an analysis on pushes that logs alerts, create a file called `.github/workflows/code-analysis-push.yml` with this content:

```yaml
on:
  push:
    branches: [main]

env:
  LW_ACCOUNT_NAME: ${{ secrets.LW_ACCOUNT_NAME }}
  LW_API_KEY: ${{ secrets.LW_API_KEY }}
  LW_API_SECRET: ${{ secrets.LW_API_SECRET }}

name: Lacework Code Security (Push)
jobs:
  run-analysis:
    runs-on: ubuntu-20.04
    name: Run analysis
    steps:
      - name: Checkout repository
        uses: actions/checkout@v3
      - name: Analyze
        uses: lacework/code-security-action@v1
        with:
          target: push
          tools: sca # Comma-separated list of tool(s) to use for scanning. Current options are sca
```

## License

The code contained in this repository is released as open-source under the Apache 2.0 license. However, the underlying analysis tools are subject to their own licensing conditions. Thus, you will not be able to use the code found here without having purchased the Lacework code security offering.

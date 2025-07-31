![Forticnapp Logo](lacework_FTNT_logo.png?raw=true)

# FortiCNAPP Code Security for GitHub Actions

This repository contains a GitHub Action for using FortiCNAPP's code security offering on your code. In order for the code in this repository to run, you must be a FortiCNAPP customer. Please contact Fortinet support for more information.

## Usage

### Creating secrets

Before attempting to run this action, you should add three secrets `LW_ACCOUNT_NAME`, `LW_API_KEY` and `LW_API_SECRET` to your GitHub repository (or, better yet, your GitHub organization so they can be shared accross all your repositories). The value for these secrets can be obtained by following the instructions [here](https://docs.lacework.com/console/api-access-keys) to create an API key and then download it.

### Running on pull requests

To run an analysis on pull requests that highlights new alerts, create a file called `.github/workflows/lacework-code-security-pr.yml` with this content:

```yaml
on:
  - pull_request

permissions:
  contents: read
  pull-requests: write

env:
  LW_ACCOUNT_NAME: ${{ secrets.LW_ACCOUNT_NAME }}
  LW_API_KEY: ${{ secrets.LW_API_KEY }}
  LW_API_SECRET: ${{ secrets.LW_API_SECRET }}

name: Lacework Code Security (PR)
jobs:
  run-analysis:
    runs-on: ubuntu-latest
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
  display-results:
    runs-on: ubuntu-latest
    name: Display results
    needs:
      - run-analysis
    steps:
      - name: Results
        id: code-analysis
        uses: lacework/code-security-action@v1
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```

### Running on push or in scheduled mode

To run an analysis on pushes or on a scheduled fashion and upload findings to the Lacework UI, create a file called `.github/workflows/lacework-code-security-push.yml` with this content:

```yaml
on:
  push:
    # Run the scan on evey push in main
    branches: [main]
    # Run the scan evey day at 7:00am
    schedule:
      - cron: '0 7 * * *'
    # To manually trigger scans from the GitHub UI
    workflow_dispatch:

env:
  LW_ACCOUNT_NAME: ${{ secrets.LW_ACCOUNT_NAME }}
  LW_API_KEY: ${{ secrets.LW_API_KEY }}
  LW_API_SECRET: ${{ secrets.LW_API_SECRET }}

name: Lacework Code Security (Push)
jobs:
  run-analysis:
    runs-on: ubuntu-latest
    name: Run analysis
    steps:
      - name: Checkout repository
        uses: actions/checkout@v3
      - name: Analyze
        uses: lacework/code-security-action@v1
        with:
          target: push
```

## License

The code contained in this repository is released as open-source under the Apache 2.0 license. However, the underlying analysis tools are subject to their own licensing conditions. Thus, you will not be able to use the code found here without having purchased the FortiCNAPP code security offering.

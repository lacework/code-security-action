<img src="https://techally-content.s3-us-west-1.amazonaws.com/public-content/lacework_logo_full.png" width="600">

# Lacework Code Analysis GitHub Action

Github Action for using Lacework's code analysis.

## Usage

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
  LW_ACCOUNT_NAME: ${{ secrets.LW_ACCOUNT_CAT }}
  LW_API_KEY: ${{ secrets.LW_API_KEY_CAT }}
  LW_API_SECRET: ${{ secrets.LW_API_SECRET_CAT }}

name: Lacework Code Analysis (PR)
jobs:
  run-analysis:
    runs-on: ubuntu-22.04
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
        uses: lacework-dev/code-analysis-action@v0.1
        with:
          target: ${{ matrix.target }}
          tools: sca # Comma-separated list of tool(s) to use for scanning. Current options are sca and sast.
          # If using the SAST tool, uncomment the line below and point it to a built JAR for your project
          # jar: target
  display-results:
    runs-on: ubuntu-22.04
    name: Display results
    needs:
      - run-analysis
    steps:
      - name: Results
        uses: lacework-dev/code-analysis-action@v0.1
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```

### On push

To run an analysis on pushes that logs alerts, create a file called `.github/workflows/code-analysis-push.yml` with this content:

```yaml
on:
  push:
    branches: [main]

env:
  LW_ACCOUNT_NAME: ${{ secrets.LW_ACCOUNT_CAT }}
  LW_API_KEY: ${{ secrets.LW_API_KEY_CAT }}
  LW_API_SECRET: ${{ secrets.LW_API_SECRET_CAT }}

name: Lacework Code Analysis (Push)
jobs:
  run-analysis:
    runs-on: ubuntu-22.04
    name: Run analysis
    steps:
      - name: Checkout repository
        uses: actions/checkout@v3
      - name: Analyze
        uses: lacework-dev/code-analysis-action@v0.1
        with:
          target: push
          tools: sca # Comma-separated list of tool(s) to use for scanning. Current options are sca and sast.
          # If using the SAST tool, uncomment the line below and point it to a built JAR for your project
          # jar: target
```

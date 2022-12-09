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
        target: [merge, parent]
    steps:
      - name: Checkout repository
        uses: actions/checkout@v3
        with:
          fetch-depth: 2
      - name: Checkout parent
        if: ${{ matrix.target == 'parent' }}
        run: git checkout HEAD^1
      - name: Build
        run: mvn package # Replace as needed to build your code
      - name: Analyze
        uses: lacework-dev/code-analysis-action@v0.1
        with:
          jar: target # Replace as needed to point to a JAR or folder of JARs to scan
          target: ${{ matrix.target }}
  display-results:
    runs-on: ubuntu-22.04
    name: Display results
    needs:
      - run-analysis
    steps:
      - name: Results
        uses: lacework-dev/code-analysis-action@v0.1
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
      - name: Build
        run: mvn package # Replace as needed to build your code
      - name: Analyze
        uses: lacework-dev/code-analysis-action@v0.1
        with:
          jar: target # Replace as needed to point to a JAR or folder of JARs to scan
          target: push
```

/**
 * GitHub Actions workflow templates for `prosecheck init`.
 *
 * Each builder takes a `sarif` flag. When true, the workflow outputs SARIF,
 * uploads it to GitHub Code Scanning, and still fails the workflow on errors.
 */

function prosecheckStep(args: string, sarif: boolean): string {
  if (!sarif) {
    return `      - name: Run prosecheck
        run: npx prosecheck lint ${args}
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}`;
  }

  // Capture exit code so SARIF uploads even on failure, then re-fail
  return `      - name: Run prosecheck
        id: prosecheck
        run: |
          set +e
          npx prosecheck lint ${args} --format sarif > prosecheck.sarif 2>&1
          echo "exit_code=$?" >> "$GITHUB_OUTPUT"
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
      - name: Upload SARIF
        if: always() && hashFiles('prosecheck.sarif') != ''
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: prosecheck.sarif
          category: prosecheck
      - name: Check result
        if: always()
        run: exit \${{ steps.prosecheck.outputs.exit_code }}`;
}

function permissions(sarif: boolean): string {
  if (!sarif) return '';
  return `    permissions:
      security-events: write\n`;
}

function preamble(sarif: boolean): string {
  return `    runs-on: ubuntu-latest
${permissions(sarif)}    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm install -g @anthropic-ai/claude-code`;
}

export function buildFullWorkflow(sarif: boolean): string {
  return `name: Prosecheck
on: [pull_request]

jobs:
  prosecheck:
${preamble(sarif)}
${prosecheckStep('--last-run-read 0', sarif)}
`;
}

export function buildIncrementalPrWorkflow(sarif: boolean): string {
  return `name: Prosecheck (incremental)
on: [pull_request]

jobs:
  prosecheck:
${preamble(sarif)}
${prosecheckStep('--last-run-read 1', sarif)}
`;
}

export function buildMergeQueueWorkflow(sarif: boolean): string {
  return `name: Prosecheck (merge queue)
on:
  merge_group:

jobs:
  prosecheck:
${preamble(sarif)}
${prosecheckStep('--last-run-read 0', sarif)}
`;
}

export const WORKFLOW_HASH_CHECK = `name: Prosecheck (hash check)
on: [pull_request]

jobs:
  check-hash:
    runs-on: ubuntu-latest
    steps:
      # Checkout the PR head commit, not the merge commit.
      # pull_request events default to a merge of PR + target, which
      # changes file contents and breaks the committed content hash.
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - name: Verify prosecheck was run
        run: npx prosecheck lint --hash-check
`;

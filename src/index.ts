import { error, getInput, info, setOutput, warning } from '@actions/core'
import { appendFileSync, existsSync } from 'fs'
import {
  postCommentIfInPr,
  resolveExistingCommentIfFound,
  uploadArtifact,
} from './actions'
import {
  codesecRun,
  getActionRef,
  getMsSinceStart,
  getOptionalEnvVariable,
  getRequiredEnvVariable,
  getRunUrl,
  readMarkdownFile,
  telemetryCollector,
} from './util'

// Constants for old Lacework CLI flow - kept for reference when re-enabling
// const scaSarifReport = 'scaReport/output.sarif'
// const scaReport = 'sca.sarif'
// const scaLWJSONReport = 'scaReport/output-lw.json'
// const scaDir = 'scaReport'

async function runAnalysis() {
  const target = getInput('target')

  let currBranch = getOptionalEnvVariable('GITHUB_HEAD_REF', '')
  if (currBranch !== '') {
    // running on a PR
    if (target == 'old') {
      process.env['LW_CODESEC_GIT_BRANCH'] = getOptionalEnvVariable('GITHUB_BASE_REF', '')
    } else {
      process.env['LW_CODESEC_GIT_BRANCH'] = currBranch
    }
  }

  info('Analyzing ' + target)
  telemetryCollector.addField('tools', 'sca')
  const toUpload: string[] = []

  // Run codesec Docker scanner
  // targetScan: 'new'/'old' for PR mode, 'scan' for push mode (uploads to Lacework UI)
  var targetScan = target
  if (target == 'push') {
    targetScan = 'scan'
  }
  await codesecRun('scan', true, true, targetScan)

  // TODO: Copy SARIF from codesec results to expected location for artifact upload
  // The codesec scanner outputs to scan-results/sca/sca-{target}.sarif
  // For now, keeping the old Lacework CLI flow commented below as fallback

  /*
   * OLD LACEWORK CLI FLOW - Commented out, to be removed once codesec is fully tested
   *
   * var args = ['sca', 'scan', '.', '-o', scaDir, '--formats', 'sarif,lw-json', '--deployment', 'ci']
   * if (target === 'push') { args.push('--save-results') }
   * if (debug()) { args.push('--debug') }
   * await callLaceworkCli(...args)
   * args = [scaSarifReport, scaReport]
   * await callCommand('cp', ...args)
   * toUpload.push(scaReport)
   */

  // Placeholder: upload the SARIF from codesec results
  // TODO: Update this path once codesec output location is finalized
  const scaSarifFromCodesec = `scan-results/sca/sca-${targetScan}.sarif`
  if (existsSync(scaSarifFromCodesec)) {
    toUpload.push(scaSarifFromCodesec)
  }

  const uploadStart = Date.now()
  const artifactPrefix = getInput('artifact-prefix')
  if (artifactPrefix !== '') {
    await uploadArtifact(artifactPrefix + '-results-' + target, ...toUpload)
  } else {
    await uploadArtifact('results-' + target, ...toUpload)
  }
  telemetryCollector.addField('duration.upload-artifacts', (Date.now() - uploadStart).toString())
  setOutput(`${target}-completed`, true)
}

async function displayResults() {
  info('Displaying results')

  // Use codesec compare - expects scan-results/sca/sca-{new,old}.sarif to exist
  // These are produced by the previous scan steps with target='new' and target='old'
  const scaOldExists = existsSync('scan-results/sca/sca-old.sarif')
  const scaNewExists = existsSync('scan-results/sca/sca-new.sarif')

  if (!scaOldExists || !scaNewExists) {
    throw new Error(
      `SARIF files not found for comparison. old=${scaOldExists}, new=${scaNewExists}`
    )
  }

  // Run codesec compare mode
  await codesecRun('compare', false, false)

  // Read the merged comparison output
  const mergedOutput = 'scan-results/compare/merged-compare.md'
  if (!existsSync(mergedOutput)) {
    throw new Error(`Comparison output not found at ${mergedOutput}`)
  }

  const message = readMarkdownFile(mergedOutput)

  // Check if there are new violations (non-zero count in "Found N new potential violations")
  const hasViolations = /Found\s+[1-9]\d*\s+/.test(message)

  if (hasViolations && getInput('token').length > 0) {
    info('Posting comment to GitHub PR as there were new issues introduced')
    const commentUrl = await postCommentIfInPr(message)
    if (commentUrl !== undefined) {
      setOutput('posted-comment', commentUrl)
    }
  } else {
    // No new violations or no token - resolve existing comment if found
    await resolveExistingCommentIfFound()
  }

  setOutput('display-completed', true)

  /*
   * OLD FLOW - Commented out, to be removed once codesec is fully tested
   *
   * const downloadStart = Date.now()
   * const artifactOld = await downloadArtifact('results-old')
   * const artifactNew = await downloadArtifact('results-new')
   * const sarifFileOld = path.join(artifactOld, scaReport)
   * const sarifFileNew = path.join(artifactNew, scaReport)
   * const compareMessage = await compareResults(sarifFileOld, sarifFileNew)
   * if (compareMessage.length > 0 && getInput('token').length > 0) {
   *   await postCommentIfInPr(compareMessage)
   * }
   */
}

async function main() {
  telemetryCollector.addField('duration.install', getMsSinceStart())
  telemetryCollector.addField('version', getActionRef())
  telemetryCollector.addField('url', getRunUrl())
  telemetryCollector.addField('repository', getRequiredEnvVariable('GITHUB_REPOSITORY'))
  if (getInput('target') !== '') {
    telemetryCollector.addField('run-type', 'analysis')
    await runAnalysis()
  } else {
    telemetryCollector.addField('run-type', 'display')
    await displayResults()
  }
}

main()
  .catch((e) => {
    telemetryCollector.addError('error', e)
    error(e.message) // TODO: Use setFailed once we want failures to be fatal
  })
  .finally(async () => {
    telemetryCollector.addField('metadata.integration', 'github')
    telemetryCollector.addField('duration.total', getMsSinceStart())
    await telemetryCollector.report().catch((err) => {
      warning('Failed to report telemetry: ' + err.message)
    })
    appendFileSync(getRequiredEnvVariable('GITHUB_ENV'), 'LACEWORK_WROTE_TELEMETRY=true\n')
  })

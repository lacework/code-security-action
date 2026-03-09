import { error, getInput, info, setOutput, warning } from '@actions/core'
import { appendFileSync, existsSync, mkdirSync } from 'fs'
import * as path from 'path'
import {
  downloadArtifact,
  postCommentIfInPr,
  resolveExistingCommentIfFound,
  uploadArtifact,
} from './actions'
import {
  callCommand,
  codesecRun,
  getActionRef,
  getMsSinceStart,
  getOptionalEnvVariable,
  getRequiredEnvVariable,
  getRunUrl,
  readMarkdownFile,
  telemetryCollector,
} from './util'

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
  const resultsPath = await codesecRun('scan', true, true, targetScan)

  // Upload SCA SARIF from the returned results path
  const scaSarifFile = path.join(resultsPath, 'sca', `sca-${targetScan}.sarif`)
  if (existsSync(scaSarifFile)) {
    info(`Found SCA SARIF file to upload: ${scaSarifFile}`)
    toUpload.push(scaSarifFile)
  } else {
    info(`SCA SARIF file not found at: ${scaSarifFile}`)
  }

  // Upload IAC JSON from the returned results path
  const iacJsonFile = path.join(resultsPath, 'iac', `iac-${targetScan}.json`)
  if (existsSync(iacJsonFile)) {
    info(`Found IAC JSON file to upload: ${iacJsonFile}`)
    toUpload.push(iacJsonFile)
  } else {
    info(`IAC JSON file not found at: ${iacJsonFile}`)
  }

  const uploadStart = Date.now()
  const artifactPrefix = getInput('artifact-prefix')
  const artifactName =
    artifactPrefix !== '' ? artifactPrefix + '-results-' + target : 'results-' + target
  info(`Uploading artifact '${artifactName}' with ${toUpload.length} file(s)`)
  await uploadArtifact(artifactName, ...toUpload)
  telemetryCollector.addField('duration.upload-artifacts', (Date.now() - uploadStart).toString())
  setOutput(`${target}-completed`, true)
}

async function displayResults() {
  info('Displaying results')

  // Download artifacts from previous jobs
  const artifactOld = await downloadArtifact('results-old')
  const artifactNew = await downloadArtifact('results-new')

  // Create local scan-results directory for compare
  mkdirSync('scan-results/sca', { recursive: true })
  mkdirSync('scan-results/iac', { recursive: true })

  // Copy SCA SARIF files from artifacts to expected location for compare
  info('Copying SCA files from artifacts')
  info(`  Old SARIF: ${path.join(artifactOld, 'scan-results/sca/sca-old.sarif')}`)
  await callCommand(
    'cp',
    path.join(artifactOld, 'scan-results/sca/sca-old.sarif'),
    'scan-results/sca/sca-old.sarif'
  )
  info(`  New SARIF: ${path.join(artifactNew, 'scan-results/sca/sca-new.sarif')}`)
  await callCommand(
    'cp',
    path.join(artifactNew, 'scan-results/sca/sca-new.sarif'),
    'scan-results/sca/sca-new.sarif'
  )

  // Copy IAC JSON files from artifacts to expected location for compare
  info('Checking for IAC files in artifacts')
  const iacOldPath = path.join(artifactOld, 'scan-results/iac/iac-old.json')
  const iacNewPath = path.join(artifactNew, 'scan-results/iac/iac-new.json')
  info(`  Old IAC: ${iacOldPath} (exists: ${existsSync(iacOldPath)})`)
  info(`  New IAC: ${iacNewPath} (exists: ${existsSync(iacNewPath)})`)
  if (existsSync(iacOldPath) && existsSync(iacNewPath)) {
    info('  Copying IAC files')
    await callCommand('cp', iacOldPath, 'scan-results/iac/iac-old.json')
    await callCommand('cp', iacNewPath, 'scan-results/iac/iac-new.json')
  } else {
    info('  IAC files not found in artifacts, skipping IAC compare')
  }

  // Verify SCA files exist (required)
  const scaOldExists = existsSync('scan-results/sca/sca-old.sarif')
  const scaNewExists = existsSync('scan-results/sca/sca-new.sarif')

  if (!scaOldExists || !scaNewExists) {
    throw new Error(
      `SARIF files not found for comparison. old=${scaOldExists}, new=${scaNewExists}`
    )
  }

  // Run codesec compare mode
  await codesecRun('compare', true, true)

  // Read the comparison output
  // merged-compare.md exists when both SCA and IAC comparisons succeed
  // sca-compare.md exists when only SCA comparison succeeds (partial)
  const mergedOutput = 'scan-results/compare/merged-compare.md'
  const scaOutput = 'scan-results/compare/sca-compare.md'

  let message: string
  if (existsSync(mergedOutput)) {
    info('Using merged comparison output')
    message = readMarkdownFile(mergedOutput)
  } else if (existsSync(scaOutput)) {
    info('Using SCA-only comparison output (partial)')
    message = readMarkdownFile(scaOutput)
  } else {
    throw new Error(`Comparison output not found. Tried: ${mergedOutput}, ${scaOutput}`)
  }

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

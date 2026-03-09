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

  // Check and copy files for each scanner type
  const scaAvailable = await prepareScannerFiles('sca', artifactOld, artifactNew)
  const iacAvailable = await prepareScannerFiles('iac', artifactOld, artifactNew)

  // Need at least one scanner to compare
  if (!scaAvailable && !iacAvailable) {
    info('No scanner files available for comparison. Nothing to compare.')
    setOutput('display-completed', true)
    return
  }

  // Run codesec compare mode with available scanners
  await codesecRun('compare', iacAvailable, scaAvailable)

  // Read comparison output - check all possible outputs
  const outputs = [
    'scan-results/compare/merged-compare.md',
    'scan-results/compare/sca-compare.md',
    'scan-results/compare/iac-compare.md',
  ]

  let message: string | null = null
  for (const output of outputs) {
    if (existsSync(output)) {
      info(`Using comparison output: ${output}`)
      message = readMarkdownFile(output)
      break
    }
  }

  if (!message) {
    info('No comparison output produced. No changes detected.')
    setOutput('display-completed', true)
    return
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

async function prepareScannerFiles(
  scanner: 'sca' | 'iac',
  artifactOld: string,
  artifactNew: string
): Promise<boolean> {
  const ext = scanner === 'sca' ? 'sarif' : 'json'
  const oldPath = path.join(artifactOld, 'scan-results', scanner, `${scanner}-old.${ext}`)
  const newPath = path.join(artifactNew, 'scan-results', scanner, `${scanner}-new.${ext}`)

  const oldExists = existsSync(oldPath)
  const newExists = existsSync(newPath)

  if (!oldExists || !newExists) {
    info(`${scanner.toUpperCase()} files not found for compare. old=${oldExists}, new=${newExists}`)
    return false
  }

  info(`Copying ${scanner.toUpperCase()} files for compare`)
  await callCommand('cp', oldPath, path.join('scan-results', scanner, `${scanner}-old.${ext}`))
  await callCommand('cp', newPath, path.join('scan-results', scanner, `${scanner}-new.${ext}`))
  return true
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

import { error, getInput, info, setOutput } from '@actions/core'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import * as path from 'path'
import {
  downloadArtifact,
  postCommentIfInPr,
  resolveExistingCommentIfFound,
  uploadArtifact,
} from './actions'
import { callCommand, runCodesec, getOptionalEnvVariable, readMarkdownFile } from './util'

// Global scanner toggles - set to false to disable a scanner globally
const enableScaRunning = true
const enableIacRunning = false // TODO: change to true when ready

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
  const toUpload: string[] = []

  // Run codesec Docker scanner
  // targetScan: 'new'/'old' for PR mode, 'scan' for push mode (should upload results to db)
  var targetScan = target
  if (target == 'push') {
    targetScan = 'scan'
  }
  const resultsPath = await runCodesec('scan', enableIacRunning, enableScaRunning, targetScan)

  // Upload SCA SARIF from the returned results path
  if (enableScaRunning) {
    const scaSarifFile = path.join(resultsPath, 'sca', `sca-${targetScan}.sarif`)
    if (existsSync(scaSarifFile)) {
      info(`Found SCA SARIF file to upload: ${scaSarifFile}`)
      toUpload.push(scaSarifFile)

      // Copy SARIF to code-scanning-path for backward compatibility
      const codeScanningPath = getInput('code-scanning-path')
      if (codeScanningPath) {
        info(`Copying SARIF to code-scanning-path: ${codeScanningPath}`)
        copyFileSync(scaSarifFile, codeScanningPath)
      }
    } else {
      info(`SCA SARIF file not found at: ${scaSarifFile}`)
    }
  }

  // Upload IAC JSON from the returned results path
  if (enableIacRunning) {
    const iacJsonFile = path.join(resultsPath, 'iac', `iac-${targetScan}.json`)
    if (existsSync(iacJsonFile)) {
      info(`Found IAC JSON file to upload: ${iacJsonFile}`)
      toUpload.push(iacJsonFile)
    } else {
      info(`IAC JSON file not found at: ${iacJsonFile}`)
    }
  }

  const artifactPrefix = getInput('artifact-prefix')
  const artifactName =
    artifactPrefix !== '' ? artifactPrefix + '-results-' + target : 'results-' + target
  info(`Uploading artifact '${artifactName}' with ${toUpload.length} file(s)`)
  await uploadArtifact(artifactName, ...toUpload)
  setOutput(`${target}-completed`, true)
}

async function displayResults() {
  info('Displaying results')

  // Download artifacts from previous jobs
  const artifactOld = await downloadArtifact('results-old')
  const artifactNew = await downloadArtifact('results-new')

  // Create local scan-results directory for compare
  if (enableScaRunning) {
    mkdirSync('scan-results/sca', { recursive: true })
  }
  if (enableIacRunning) {
    mkdirSync('scan-results/iac', { recursive: true })
  }

  // Check and copy files for each scanner type
  const scaAvailable =
    enableScaRunning && (await prepareScannerFiles('sca', artifactOld, artifactNew))
  const iacAvailable =
    enableIacRunning && (await prepareScannerFiles('iac', artifactOld, artifactNew))

  // Need at least one scanner to compare
  if (!scaAvailable && !iacAvailable) {
    info('No scanner files available for comparison. Nothing to compare.')
    setOutput('display-completed', true)
    return
  }

  // Run codesec compare mode with available scanners
  await runCodesec('compare', enableIacRunning && iacAvailable, enableScaRunning && scaAvailable)

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
  if (getInput('target') !== '') {
    await runAnalysis()
  } else {
    await displayResults()
  }
}

main()
  .catch((e) => {
    error(e.message) // TODO: Use setFailed once we want failures to be fatal
  })
  .finally(async () => {})

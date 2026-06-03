import * as cache from '@actions/cache'
import { error, getInput, info, setOutput } from '@actions/core'
import { copyFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import * as path from 'path'
import {
  downloadArtifact,
  postCommentIfInPr,
  resolveExistingCommentIfFound,
  uploadArtifact,
} from './actions'
import {
  callCommand,
  runCodesec,
  getModifiedFiles,
  getOptionalEnvVariable,
  readMarkdownFile,
  shouldRunIaCScanner,
} from './util'
import { simpleGit } from 'simple-git'

// Global scanner toggles - set to false to disable a scanner globally
const enableScaRunning = true
let enableIacRunning = false

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

  // Only pass modified files for PR "new" scans — this optimises scanning to only changed files
  let modifiedFiles: string | undefined
  if (currBranch !== '' && target === 'new') {
    modifiedFiles = await getModifiedFiles()
    if (modifiedFiles) {
      info(`Modified files for optimised scanning: ${modifiedFiles}`)
    }
  }

  // Skip the IaC scan if there no IaC-related files have been modified in the PR
  if (modifiedFiles && target == 'new') {
    if (shouldRunIaCScanner(modifiedFiles)) {
      enableIacRunning = true
    }
  }

  // Create scan-results directory
  const resultsPath = path.join(process.cwd(), 'scan-results')

  // Cache the analysis results when scanning the target branch
  let cacheHit = false
  const commit = (await simpleGit().revparse(['HEAD'])).trim()
  let cacheKey = `codesec-${commit}`
  if (targetScan === 'old') {
    const restored = await cache.restoreCache([resultsPath], cacheKey)
    if (restored) {
      info(`Cache hit for ${cacheKey} — skipping scan`)
      cacheHit = true
    } else {
      info(`Cache miss for ${cacheKey} — running scan`)
    }
  }

  if (!cacheHit) {
    let success = await runCodesec(
      'scan',
      enableIacRunning,
      enableScaRunning,
      resultsPath,
      targetScan,
      modifiedFiles
    )
    if (success && targetScan !== 'new') {
      // Save the analysis results when not scanning the PR source branch
      try {
        await cache.saveCache([resultsPath], cacheKey)
        info(`Saved analysis results for ${cacheKey}`)
      } catch (e) {
        info(`Failed to save cache for ${cacheKey}: ${(e as Error).message}`)
      }
    }
  } else {
    // Cache restored — rename files to match current targetScan if needed
    const possibleNames = ['old', 'scan']
    if (enableScaRunning) {
      const scaDir = path.join(resultsPath, 'sca')
      for (const name of possibleNames) {
        const existing = path.join(scaDir, `sca-${name}.sarif`)
        if (existsSync(existing) && name !== targetScan) {
          renameSync(existing, path.join(scaDir, `sca-${targetScan}.sarif`))
          break
        }
      }
    }
    if (enableIacRunning) {
      const iacDir = path.join(resultsPath, 'iac')
      for (const name of possibleNames) {
        const existing = path.join(iacDir, `iac-${name}.json`)
        if (existsSync(existing) && name !== targetScan) {
          renameSync(existing, path.join(iacDir, `iac-${targetScan}.json`))
          break
        }
      }
    }
  }

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

  const artifactName = 'results-' + target
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
  const resultsPath = path.join(process.cwd(), 'scan-results')
  await runCodesec(
    'compare',
    enableIacRunning && iacAvailable,
    enableScaRunning && scaAvailable,
    resultsPath
  )

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

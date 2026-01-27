import { error, getInput, info, setOutput, warning } from '@actions/core'
import { appendFileSync, existsSync, readFileSync } from 'fs'
import {
  downloadArtifact,
  postCommentIfInPr,
  resolveExistingCommentIfFound,
  uploadArtifact,
} from './actions'
import {
  callLaceworkCli,
  debug,
  generateUILink,
  getActionRef,
  getMsSinceStart,
  getOptionalEnvVariable,
  getRequiredEnvVariable,
  getRunUrl,
  telemetryCollector,
} from './util'

import path from 'path'

const artifactPrefix = getInput('artifact-prefix')
const sarifReportPath = getInput('code-scanning-path')
const comparisonMarkdownPath = 'comparison.md'

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

  // command to print both sarif and lwjson formats
  var args = [
    'sca',
    'scan',
    '.',
    '--formats',
    'sarif',
    '--output',
    sarifReportPath,
    '--deployment',
    'ci',
  ]
  if (target === 'push') {
    args.push('--save-results')
  }
  if (debug()) {
    args.push('--debug')
  }
  await callLaceworkCli(...args)
  toUpload.push(sarifReportPath)

  const uploadStart = Date.now()

  await uploadArtifact(getArtifactName(target), ...toUpload)

  telemetryCollector.addField('duration.upload-artifacts', (Date.now() - uploadStart).toString())
  setOutput(`${target}-completed`, true)
}

export async function compareResults(oldReport: string, newReport: string): Promise<string> {
  const args = [
    'sca',
    'compare',
    '--old',
    oldReport,
    '--new',
    newReport,
    '--output',
    sarifReportPath,
    '--markdown',
    comparisonMarkdownPath,
    '--markdown-variant',
    'GitHub',
    '--deployment',
    'ci',
  ]
  const uiLink = generateUILink()
  if (uiLink) args.push(...['--ui-link', uiLink])
  if (debug()) args.push('--debug')

  await callLaceworkCli(...args)
  await uploadArtifact(getArtifactName('compare'), sarifReportPath, comparisonMarkdownPath)

  return existsSync(comparisonMarkdownPath) ? readFileSync(comparisonMarkdownPath, 'utf8') : ''
}

async function displayResults() {
  info('Displaying results')
  const downloadStart = Date.now()
  const artifactOld = await downloadArtifact(getArtifactName('old'))
  const artifactNew = await downloadArtifact(getArtifactName('new'))
  telemetryCollector.addField(
    'duration.download-artifacts',
    (Date.now() - downloadStart).toString()
  )
  const sarifFileOld = path.join(artifactOld, sarifReportPath)
  const sarifFileNew = path.join(artifactNew, sarifReportPath)

  var compareMessage: string
  if (existsSync(sarifFileOld) && existsSync(sarifFileNew)) {
    compareMessage = await compareResults(sarifFileOld, sarifFileNew)
  } else {
    throw new Error('SARIF file not found')
  }

  const commentStart = Date.now()
  if (compareMessage.length > 0 && getInput('token').length > 0) {
    info('Posting comment to GitHub PR as there were new issues introduced:')
    if (getInput('footer') !== '') {
      compareMessage += '\n\n' + getInput('footer')
    }
    info(compareMessage)
    const commentUrl = await postCommentIfInPr(compareMessage)
    if (commentUrl !== undefined) {
      setOutput('posted-comment', commentUrl)
    }
  } else {
    await resolveExistingCommentIfFound()
  }
  telemetryCollector.addField('duration.comment', (Date.now() - commentStart).toString())
  setOutput(`display-completed`, true)
}

function getArtifactName(target: string): string {
  var artifactName = 'results-'
  if (artifactPrefix !== '') {
    artifactName = artifactPrefix + '-' + artifactName
  }
  return artifactName + target
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

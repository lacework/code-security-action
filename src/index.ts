import { error, getInput, info, setOutput } from '@actions/core'
import { existsSync, readFileSync } from 'fs'
import {
  downloadArtifact,
  postCommentIfInPr,
  resolveExistingCommentIfFound,
  uploadArtifact,
} from './actions'
import { callLaceworkCli, debug, generateUILink, getOptionalEnvVariable } from './util'

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
  var args = ['scan', '.', '--formats', 'sarif', '--output', sarifReportPath, '--deployment', 'ci']
  if (target === 'push') {
    args.push('--save-results')
  }
  if (debug()) {
    args.push('--debug')
  }
  await callLaceworkCli(...args)
  toUpload.push(sarifReportPath)

  await uploadArtifact(getArtifactName(target), ...toUpload)
  setOutput(`${target}-completed`, true)
}

export async function compareResults(oldReport: string, newReport: string): Promise<string> {
  const args = [
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

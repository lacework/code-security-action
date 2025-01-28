import { error, getInput, info, setOutput, warning } from '@actions/core'
import { appendFileSync, existsSync } from 'fs'
import {
  downloadArtifact,
  postCommentIfInPr,
  resolveExistingCommentIfFound,
  uploadArtifact,
} from './actions'
import { downloadKeys, trustedKeys } from './keys'
import { compareResults, createPRs, printResults } from './tool'
import {
  autofix,
  callCommand,
  callLaceworkCli,
  debug,
  getActionRef,
  getMsSinceStart,
  getOptionalEnvVariable,
  getRequiredEnvVariable,
  getRunUrl,
  getWorkingDirectory,
  telemetryCollector,
} from './util'

const scaSarifReport = 'scaReport/output.sarif'
const scaReport = 'sca.sarif'
const scaLWJSONReport = 'scaReport/output-lw.json'
const scaDir = 'scaReport'

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
  const indirectDeps = getInput('eval-indirect-dependencies')
  const toUpload: string[] = []

  await downloadKeys()
  const workingDirectory = getWorkingDirectory()
  // command to print both sarif and lwjson formats
  var args = [
    'sca',
    'scan',
    '--save-results',
    '-o',
    scaDir,
    '--formats',
    'sarif,lw-json',
    '--deployment',
    'ci',
    '--keyring',
    trustedKeys,
    '--secret',
    workingDirectory,
  ]
  args.push(getWorkingDirectory())
  if (indirectDeps.toLowerCase() === 'false') {
    args.push('--eval-direct-only')
  }
  if (debug()) {
    args.push('--debug')
  }
  if (autofix()) {
    args.push('--fix-suggestions')
  }
  await callLaceworkCli(...args)
  // make a copy of the sarif file
  args = [scaSarifReport, scaReport]
  await callCommand('cp', ...args)

  await printResults('sca', scaReport)
  if (autofix()) {
    await createPRs(scaLWJSONReport)
  }
  toUpload.push(scaReport)

  const uploadStart = Date.now()
  await uploadArtifact('results-' + target, ...toUpload)
  telemetryCollector.addField('duration.upload-artifacts', (Date.now() - uploadStart).toString())
  setOutput(`${target}-completed`, true)
}

async function displayResults() {
  info('Displaying results')
  const downloadStart = Date.now()
  await downloadArtifact('results-old')
  await downloadArtifact('results-new')
  telemetryCollector.addField(
    'duration.download-artifacts',
    (Date.now() - downloadStart).toString()
  )
  const issuesByTool: { [tool: string]: string } = {}
  if (existsSync(`results-old/${scaReport}`) && existsSync(`results-new/${scaReport}`)) {
    issuesByTool['sca'] = await compareResults(
      'sca',
      `results-old/${scaReport}`,
      `results-new/${scaReport}`
    )
  }
  const commentStart = Date.now()
  if (Object.values(issuesByTool).some((x) => x.length > 0) && getInput('token').length > 0) {
    info('Posting comment to GitHub PR as there were new issues introduced:')
    let message = `Lacework Code Security found potential new issues in this PR.`
    for (const [, issues] of Object.entries(issuesByTool)) {
      if (issues.length > 0) {
        message += issues
      }
    }
    if (getInput('footer') !== '') {
      message += '\n\n' + getInput('footer')
    }
    info(message)
    const commentUrl = await postCommentIfInPr(message)
    if (commentUrl !== undefined) {
      setOutput('posted-comment', commentUrl)
    }
  } else {
    await resolveExistingCommentIfFound()
  }
  telemetryCollector.addField('duration.comment', (Date.now() - commentStart).toString())
  setOutput(`display-completed`, true)
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

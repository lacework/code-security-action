import { error, getInput, info, setOutput, warning } from '@actions/core'
import { existsSync, appendFileSync } from 'fs'
import {
  downloadArtifact,
  postCommentIfInPr,
  resolveExistingCommentIfFound,
  uploadArtifact,
} from './actions'
import { compareResults, createPR, printResults } from './tool'
import {
  autofix,
  callLaceworkCli,
  debug,
  getActionRef,
  getMsSinceStart,
  getOrDefault,
  getRequiredEnvVariable,
  getRunUrl,
  telemetryCollector,
} from './util'
import { downloadKeys, trustedKeys } from './keys'
import { simpleGit, SimpleGitOptions } from 'simple-git'

const scaSarifReport = 'scaReport/output.sarif'
const sastReport = 'sast.sarif'
const scaLWJSONReport = 'scaReport/output-lw.json'
const scaDir = 'scaReport'

// test pr creation
const options: Partial<SimpleGitOptions> = {
  baseDir: process.cwd(),
  binary: 'git',
  maxConcurrentProcesses: 6,
  trimmed: false,
}
//

async function runAnalysis() {
  const target = getInput('target')
  info('Analyzing ' + target)
  const tools = (getInput('tools') || 'sca')
    .toLowerCase()
    .split(',')
    .map((x) => x.trim())
    .sort()
  telemetryCollector.addField('tools', tools.join(','))
  appendFileSync(getRequiredEnvVariable('GITHUB_ENV'), `LACEWORK_TOOLS=${tools.join(',')}\n`)
  const indirectDeps = getInput('eval-indirect-dependencies')
  const toUpload: string[] = []
  const classpath = getInput('classpath') || getOrDefault('classes', '.')
  if (tools.includes('sca')) {
    await downloadKeys()

    // test pr creation

    // let newBranch: string = 'Fix_for_aleluia'
    // const git = simpleGit(options)
    // await git.init()
    // await git.addConfig('user.name', 'CodeSec Bot')
    // await git.addConfig('user.email', 'codesec-eng@lacework.com')
    // // get current branch
    // let currBranch = getRequiredEnvVariable('GITHUB_HEAD_REF')
    // info('current branch name: ' + currBranch)
    // // create a new branch for the specified fix from currBranch
    // await git.checkoutLocalBranch(newBranch)

    // await git.add('.').commit('branch created successfuly').push('origin', newBranch)

    //
    //

    // command to print both sarif and lwjson formats
    var args = [
      'sca',
      'git',
      '.',
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
    ]
    if (indirectDeps.toLowerCase() === 'false') {
      args.push('--eval-direct-only')
    }
    if (debug()) {
      args.push('--debug')
    }
    if (autofix()) {
      args.push('--fix-suggestions')
    }
    info('got here')
    await callLaceworkCli(...args)
    // add autofix check here?
    info('got here')
    await printResults('sca', scaSarifReport)
    // func - generate pr
    if (autofix()) {
      // call function to parse JSON and generate automated pr for each fix id
      await createPR(scaLWJSONReport)
    }
    toUpload.push(scaSarifReport)
  }
  if (tools.includes('sast')) {
    var args = [
      'sast',
      'scan',
      '--save-results',
      '--classpath',
      classpath,
      '--sources',
      getOrDefault('sources', '.'),
      '-o',
      sastReport,
      '--deployment',
      'ci',
    ]
    if (debug()) {
      args.push('--debug')
    }
    await callLaceworkCli(...args)
    await printResults('sast', sastReport)
    toUpload.push(sastReport)
  }
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
  if (existsSync(`results-old/${scaSarifReport}`) && existsSync(`results-new/${scaSarifReport}`)) {
    issuesByTool['sca'] = await compareResults(
      'sca',
      `results-old/${scaSarifReport}`,
      `results-new/${scaSarifReport}`
    )
  }
  if (existsSync(`results-old/${sastReport}`) && existsSync(`results-new/${sastReport}`)) {
    issuesByTool['sast'] = await compareResults(
      'sast',
      `results-old/${sastReport}`,
      `results-new/${sastReport}`
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
    if (typeof e === 'string') {
      telemetryCollector.addField('error', e)
    } else if (e instanceof Error) {
      telemetryCollector.addField('error', e.message)
    } else {
      telemetryCollector.addField('error', 'Unknown error')
    }
    error(e.message) // TODO: Use setFailed once we want failures to be fatal
  })
  .finally(async () => {
    telemetryCollector.addField('duration.total', getMsSinceStart())
    await telemetryCollector.report().catch((err) => {
      warning('Failed to report telemetry: ' + err.message)
    })
    appendFileSync(getRequiredEnvVariable('GITHUB_ENV'), 'LACEWORK_WROTE_TELEMETRY=true\n')
  })

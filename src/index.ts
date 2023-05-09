import { error, getInput, info, setOutput } from '@actions/core'
import { existsSync } from 'fs'
import {
  downloadArtifact,
  postCommentIfInPr,
  resolveExistingCommentIfFound,
  uploadArtifact,
} from './actions'
import { compareResults, printResults } from './tool'
import { callLaceworkCli, debug, getOrDefault } from './util'

const scaReport = 'sca.sarif'
const sastReport = 'sast.sarif'

async function runAnalysis() {
  const target = getInput('target')
  info('Analyzing ' + target)
  const tools = (getInput('tools') || 'sca').toLowerCase().split(',')
  const indirectDeps = getInput('eval-indirect-dependencies')
  const toUpload: string[] = []
  if (tools.includes('sca')) {
    var args = [
      'sca',
      'git',
      '.',
      '--save-results',
      '-o',
      scaReport,
      '--formats',
      'sarif',
      '--deployment',
      'ci',
    ]
    if (indirectDeps.toLowerCase() === 'false') {
      args.push('--eval-direct-only')
    }
    if (debug()) {
      args.push('--debug')
    }
    info(await callLaceworkCli(...args))
    await printResults('sca', scaReport)
    toUpload.push(scaReport)
  }
  if (tools.includes('sast')) {
    var args = [
      'sast',
      'scan',
      '--save-results',
      '--classes',
      getOrDefault('classes', '.'),
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
    info(await callLaceworkCli(...args))
    await printResults('sast', sastReport)
    toUpload.push(sastReport)
  }
  await uploadArtifact('results-' + target, ...toUpload)
  setOutput(`${target}-completed`, true)
}

async function displayResults() {
  info('Displaying results')
  await downloadArtifact('results-old')
  await downloadArtifact('results-new')
  const issuesByTool: { [tool: string]: string } = {}
  if (existsSync(`results-old/${scaReport}`) && existsSync(`results-new/${scaReport}`)) {
    issuesByTool['sca'] = await compareResults(
      'sca',
      `results-old/${scaReport}`,
      `results-new/${scaReport}`
    )
  }
  if (existsSync(`results-old/${sastReport}`) && existsSync(`results-new/${sastReport}`)) {
    issuesByTool['sast'] = await compareResults(
      'sast',
      `results-old/${sastReport}`,
      `results-new/${sastReport}`
    )
  }
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
  setOutput(`display-completed`, true)
}

async function main() {
  if (getInput('target') !== '') {
    await runAnalysis()
  } else {
    await displayResults()
  }
}

main().catch(
  (err) => error(err.message) // TODO: Use setFailed once we want failures to be fatal
)

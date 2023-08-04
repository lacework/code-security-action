import { info, startGroup, endGroup, error } from '@actions/core'
import { context } from '@actions/github'
import { existsSync, readFileSync } from 'fs'
import { callCommand, callLaceworkCli, debug, getRequiredEnvVariable } from './util'
import { Log } from 'sarif'
import { LWJSON } from './lw-json'
import { getPrApi } from './actions'
import { simpleGit, SimpleGitOptions } from 'simple-git'

export async function printResults(tool: string, sarifFile: string) {
  startGroup(`Results for ${tool}`)
  let foundSomething = false
  const results: Log = JSON.parse(readFileSync(sarifFile, 'utf8'))
  for (const run of results.runs) {
    if (Array.isArray(run.results) && run.results.length > 0) {
      foundSomething = true
      info('Found ' + run.results?.length + ' results using ' + tool)
      for (const vuln of run.results) {
        info(JSON.stringify(vuln, null, 2))
      }
    }
  }
  if (!foundSomething) {
    info(`No ${tool} issues were found`)
  }
  endGroup()
}

export function splitStringAtFirstSlash(inputString: string | undefined): [string, string] {
  if (inputString != null) {
    const [firstPart, secondPart] = inputString.split('/', 2)
    return [firstPart, secondPart]
  }
  return ['', '']
}

export const options: Partial<SimpleGitOptions> = {
  baseDir: process.cwd(),
  binary: 'git',
  maxConcurrentProcesses: 6,
  trimmed: false,
}

export async function prForFixSuggestion(
  jsonFile: string,
  fixId: string,
  repoOwner: string,
  repoName: string,
  originBranch: string,
  artifactName: string,
  newVersion: string
) {
  let newBranch: string = 'SCA_fix_for_' + fixId
  const git = simpleGit(options)
  await git.init()
  await git.addConfig('user.name', 'CodeSec Bot')
  await git.addConfig('user.email', 'codesec-eng@lacework.com')
  // get current branch (different in name from the originBranch but same in functionality - github being weird)
  let currBranch = getRequiredEnvVariable('GITHUB_HEAD_REF')
  // create a new branch for the specified fix from currBranch
  await git.checkoutLocalBranch(newBranch)
  var patchReport = 'patchSummary.md'

  // push branch to remote
  // await git
  //   .add('.')
  //   .rm(['--cached', 'scaReport/output-lw.json'])
  //   .rm(['--cached', 'scaReport/output.sarif'])
  //   .commit('Branch for ' + fixId + ' created successfully.')
  //   .push('origin', newBranch)

  // create command to run on branch
  var args = ['sca', 'patch', '.', '--sbom', jsonFile, '--fix-id', fixId, '-o', patchReport]

  // call patch command
  await callLaceworkCli(...args)
  let patch = readFileSync(patchReport, 'utf-8')

  // parse the modified files from the patch summary
  let files: string[] = []
  let text: string = patch.split('## Files that have been modified:')[1]
  let lines: string[] = text.split('-')
  for (let line of lines) {
    // delete whitespaces
    line = line.trimStart().trimEnd()
    // delete *
    line = line.substring(1, line.length - 1)
    files.push(line)
  }

  // add modified files to branch
  for (const file of files) {
    await git.add(file)
    info(file)
  }

  // commit and push changes
  // await git
  //   .commit('Fix Suggestion ' + fixId + '.')
  //   .push('origin', newBranch)

  // title is the first line of the patch summary
  let title = patch.split('\n')[0] + 2
  info(title)

  // open PR:
  // await getPrApi().create({
  //   owner: repoOwner,
  //   repo: repoName,
  //   head: newBranch,
  //   base: currBranch,
  //   title: 'SCA - Suggested fix for fixId: ' + fixId,
  //   body: patch,
  // })

  // go back to currBranch
  await git.checkout(originBranch)
}

export async function createPRs(jsonFile: string) {
  const results: LWJSON = JSON.parse(readFileSync(jsonFile, 'utf-8'))
  // get owner and name of current repository
  const [repoOwner, repoName] = splitStringAtFirstSlash(getRequiredEnvVariable('GITHUB_REPOSITORY'))

  // get the origin branch stored
  const git = simpleGit(options)
  await git.init()
  let list = (await git.branch()).all
  let originBranch = list.at(list.length - 1)
  if (originBranch == undefined) {
    return
  }

  if (results.FixSuggestions == undefined) {
    return
  }

  for (const fix of results.FixSuggestions) {
    let fixId: string = fix.FixId
    let version: string = ''
    if (fix.Info.fixVersion?.Version !== undefined) {
      version = fix.Info.fixVersion?.Version
    }
    await prForFixSuggestion(jsonFile, fixId, repoOwner, repoName, originBranch, 'test', version)
  }
}

export async function compareResults(
  tool: string,
  oldReport: string,
  newReport: string
): Promise<string> {
  startGroup(`Comparing ${tool} results`)
  const args = [
    tool,
    'compare',
    '--old',
    oldReport,
    '--new',
    newReport,
    '--markdown',
    `${tool}.md`,
    '--link',
    `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/blob/${context.sha}/$FILENAME#L$LINENUMBER`,
    '--markdown-variant',
    'GitHub',
    '--deployment',
    'ci',
  ]
  if (debug()) args.push('--debug')
  await callLaceworkCli(...args)
  endGroup()
  return existsSync(`${tool}.md`) ? readFileSync(`${tool}.md`, 'utf8') : ''
}

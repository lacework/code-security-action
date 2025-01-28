import { endGroup, info, startGroup } from '@actions/core'
import { context } from '@actions/github'
import { existsSync, readFileSync } from 'fs'
import { Log } from 'sarif'
import { simpleGit, SimpleGitOptions } from 'simple-git'
import { getPrApi } from './actions'
import { LWJSON } from './lw-json'
import { callLaceworkCli, debug, getOptionalEnvVariable, getRequiredEnvVariable } from './util'

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
  telem: {
    prsCounter: number
    prsUpdated: number
    errors: any[]
    totalAPITime: number
  }
) {
  let newBranch: string = 'codesec/sca/'

  // git configuration
  const git = simpleGit(options)
  await git.addConfig('user.name', 'Lacework Code Security', false, 'global')
  await git.addConfig('user.email', 'support@lacework.net', false, 'global')

  // get current branch
  // trigger: on pr
  let currBranch = getOptionalEnvVariable('GITHUB_HEAD_REF', '')
  if (currBranch == '') {
    // trigger: on push
    currBranch = getRequiredEnvVariable('GITHUB_REF_NAME')
  }

  newBranch += currBranch + '/'

  var patchReport = 'patchSummary.md'

  // create command to run on branch
  var args = ['sca', 'patch', '.', '--sbom', jsonFile, '--fix-id', fixId, '-o', patchReport]

  // call patch command
  await callLaceworkCli(...args)

  let patch = readFileSync(patchReport, 'utf-8')
  // title is the first line of the patch summary
  let titlePR = patch.split('\n')[0].substring(2)
  newBranch += titlePR.split('bump ')[1].split(' to')[0].replaceAll(' ', '_').replaceAll(':', '-')
  if (newBranch[newBranch.length - 1] == '.') {
    newBranch = newBranch.substring(0, newBranch.length - 1)
  }

  // create local branch
  await git.checkoutLocalBranch(newBranch)

  // parse the modified files from the patch summary
  const startKeyword = '## Files that have been modified:'
  const endKeyword = '## Explanation: why is this SmartFix recommended?'

  const startIndex = patch.indexOf(startKeyword)
  const endIndex = patch.indexOf(endKeyword, startIndex)
  const files: string[] = []
  if (startIndex !== -1 && endIndex !== -1) {
    const modifiedFilesText = patch.substring(startIndex + startKeyword.length, endIndex)

    const lines = modifiedFilesText.split('\n')
    for (const line of lines) {
      const cleanedLine = line.trim().substring(3, line.length - 1)
      if (cleanedLine) {
        files.push(cleanedLine)
      }
    }
  }
  // add modified files to branch
  for (const file of files) {
    if (file != '') {
      await git.add(file)
    }
  }

  // commit and push changes --force to overwrite remote branch
  await git.commit('Fix for: ' + newBranch + '.').push('origin', newBranch, ['--force'])

  // open PR
  let prFound = false
  // retrieve list of PRs
  const prList = await getPrApi().list({
    owner: repoOwner,
    repo: repoName,
    state: 'open',
  })
  // look for PR corresponding to this branch
  let filtered = prList.data.filter((pr) => pr.head.ref == newBranch)
  for (const pr of filtered) {
    prFound = true
    let pullNr = pr.number
    // update with right title and body.
    try {
      const before = Date.now()
      await getPrApi().update({
        owner: repoOwner,
        repo: repoName,
        pull_number: pullNr,
        title: titlePR,
        body: patch,
      })
      const after = Date.now()
      telem.totalAPITime += after - before
      telem.prsUpdated++
      telem.prsCounter++
    } catch (e) {
      telem.errors.push(e)
    }
  }
  // create PR if not found
  if (!prFound) {
    try {
      await getPrApi().create({
        owner: repoOwner,
        repo: repoName,
        head: newBranch,
        base: currBranch,
        title: titlePR,
        body: patch,
      })
      telem.prsCounter++
    } catch (e) {
      telem.errors.push(e)
    }
  }

  // go back to currBranch
  await git.checkout(currBranch)
}

export async function createPRs(jsonFile: string) {
  const before: number = Date.now()
  const results: LWJSON = JSON.parse(readFileSync(jsonFile, 'utf-8'))

  // get owner and name of current repository
  const [repoOwner, repoName] = splitStringAtFirstSlash(getRequiredEnvVariable('GITHUB_REPOSITORY'))

  if (results.FixSuggestions == undefined) {
    return
  }

  const telem = {
    prsCounter: 0,
    prsUpdated: 0,
    errors: Array(),
    totalAPITime: 0,
  }
  for (const fix of results.FixSuggestions) {
    let fixId: string = fix.Id
    await prForFixSuggestion(jsonFile, fixId, repoOwner, repoName, telem)
  }
  const after = Date.now()
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

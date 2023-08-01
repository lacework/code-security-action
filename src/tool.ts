import { info, startGroup, endGroup } from '@actions/core'
import { context } from '@actions/github'
import { existsSync, readFileSync } from 'fs'
import { callLaceworkCli, debug } from './util'
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

const options: Partial<SimpleGitOptions> = {
  baseDir: process.cwd(),
  binary: 'git',
  maxConcurrentProcesses: 6,
  trimmed: false,
};

export async function createPR(jsonFile: string) {
  const results: LWJSON = JSON.parse(readFileSync(jsonFile, 'utf-8'))
  results.FixSuggestions?.forEach(async fix => {
    let fixId: string = fix.fixId
    let newBranch: string = 'Fix for ' + fixId
    const git = simpleGit(options)
    await git.init()
    // get current branch
    let currBranch = await git.revparse(['--abbrevref', 'HEAD'])
    // create a new branch for the specified fix from currBranch
    await git.checkoutBranch(newBranch, currBranch)

    var patchReport = 'patchSummary.md'
    // create command to run on branch
    var args = [
      'sca',
      'patch',
      '.',
      '-o',
      patchReport,
      '--sbom', 
      jsonFile, 
      '--fix-suggestion', 
      fixId, 
      '-o',
      patchReport,
    ]
    // call patch command
    await callLaceworkCli(...args)
    
    // commit and push changes 
    await git
      .add("./*")
      .commit('Fix Suggestion ' + fixId + '.')
      .addRemote(newBranch, currBranch)
      .push(currBranch, newBranch)

  });
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

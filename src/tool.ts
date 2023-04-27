import { info, startGroup, endGroup } from '@actions/core'
import { context } from '@actions/github'
import { existsSync, readFileSync } from 'fs'
import { callLaceworkCli, debug } from './util'
import { Log } from 'sarif'

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
  info(await callLaceworkCli(...args))
  endGroup()
  return existsSync(`${tool}.md`) ? readFileSync(`${tool}.md`, 'utf8') : ''
}

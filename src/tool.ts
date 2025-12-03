import { endGroup, startGroup } from '@actions/core'
import { existsSync, readFileSync } from 'fs'
import { callLaceworkCli, debug, generateUILink } from './util'

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
    '--markdown-variant',
    'GitHub',
    '--deployment',
    'ci',
  ]

  const uiLink = generateUILink()
  if (uiLink) args.push(...['--ui-link', uiLink])

  if (debug()) args.push('--debug')
  await callLaceworkCli(...args)
  endGroup()
  return existsSync(`${tool}.md`) ? readFileSync(`${tool}.md`, 'utf8') : ''
}

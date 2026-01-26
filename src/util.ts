import { error, getInput, info, isDebug } from '@actions/core'
import { context } from '@actions/github'
import { spawn } from 'child_process'
import { TelemetryCollector } from './telemetry'
import { readFileSync, readFile } from 'fs'

export const telemetryCollector = new TelemetryCollector()

export function getMsSinceStart(): string {
  const now = Date.now()
  const start = Date.parse(getRequiredEnvVariable('LACEWORK_START_TIME'))
  return (now - start).toString()
}

function getBooleanInput(name: string) {
  return getInput(name).toLowerCase() === 'true'
}

export function debug() {
  return getBooleanInput('debug') || isDebug()
}

export function getActionRef(): string {
  return getOptionalEnvVariable('LACEWORK_ACTION_REF', 'unknown')
}

export function getRunUrl(): string {
  let result = getRequiredEnvVariable('GITHUB_SERVER_URL')
  result += '/'
  result += getRequiredEnvVariable('GITHUB_REPOSITORY')
  result += '/actions/runs/'
  result += getRequiredEnvVariable('GITHUB_RUN_ID')
  return result
}

export async function callCommand(command: string, ...args: string[]) {
  info('Invoking ' + command + ' ' + args.join(' '))
  const child = spawn(command, args, { stdio: 'inherit' })
  const exitCode = await new Promise((resolve, _) => {
    child.on('close', resolve)
  })
  if (exitCode !== 0) {
    error(`Command failed with status ${exitCode}`)
    throw new Error(`Command failed with status ${exitCode}`)
  }
}

export function getRequiredEnvVariable(name: string) {
  const value = process.env[name]
  if (!value) {
    error(`Missing required environment variable ${name}`)
    throw new Error(`Missing required environment variable ${name}`)
  }
  return value
}

export function getOptionalEnvVariable(name: string, defaultValue: string) {
  const value = process.env[name]
  if (!value) {
    return defaultValue
  }
  return value
}

export async function callLaceworkCli(...args: string[]) {
  const accountName = getRequiredEnvVariable('LW_ACCOUNT_NAME')
  const apiKey = getRequiredEnvVariable('LW_API_KEY')
  const apiSecret = getRequiredEnvVariable('LW_API_SECRET')
  const expandedArgs = [
    '--noninteractive',
    '--account',
    accountName,
    '--api_key',
    apiKey,
    '--api_secret',
    apiSecret,
    ...args,
  ]
  info('Calling lacework ' + expandedArgs.join(' '))
  await callCommand('lacework', ...expandedArgs)
}

export function getOrDefault(name: string, defaultValue: string) {
  const setTo = getInput(name)
  if (setTo !== undefined && setTo.length > 0) return setTo
  return defaultValue
}

export function generateUILink() {
  const eventPath = process.env.GITHUB_EVENT_PATH!
  const eventData = JSON.parse(readFileSync(eventPath, 'utf8'))
  const defaultBranch = eventData.repository?.default_branch

  const targetBranch = getRequiredEnvVariable('GITHUB_BASE_REF')

  if (targetBranch !== defaultBranch) return ''

  let lwAccountName = process.env.LW_ACCOUNT_NAME
  lwAccountName = lwAccountName?.replace(/\.lacework\.net$/, '')

  let url =
    `https://${lwAccountName}.lacework.net` +
    `/ui/investigation/codesec/applications/repositories/` +
    `github.com%2F${context.repo.owner}%2F${context.repo.repo}` +
    `/${defaultBranch}`

  if (process.env.LW_SUBACCOUNT_NAME) {
    url += '?accountName=' + process.env.LW_SUBACCOUNT_NAME
  }

  return url
}

// codesecTool: this method is to be used in 3 ways depending on action and scanTarget
// 1. action: scan, scanTarget: new/old -> will produce an analysis report that will be used in generating the PR comment
// 2. action: scan, scanTarget: scan -> will scan the repo and send the results back to lacework (use in scheduled events)
// 3. action: compare -> will use the previously generated new/old targets to compare them and generate the diffed markdown that will be displayed in the PR comment
export async function codesecRun(action: string, runIac: boolean = true, runSca: boolean = true, scanTarget?: string): Promise<void> {
  const dockerArgs = [
    'run',
    '--rm',
    '-v',
    '/var/run/docker.sock:/var/run/docker.sock',
    '-v',
    `${process.cwd()}:/workspace`,
    '-e',
    `HOST_REPO_PATH=${process.cwd()}`,
    '-e',
    `ACCOUNT=${getRequiredEnvVariable('LW_ACCOUNT_NAME')}`,
    '-e',
    `API_KEY=${getRequiredEnvVariable('LW_API_KEY')}`,
    '-e',
    `SECRET=${getRequiredEnvVariable('LW_API_SECRET')}`,
    '-e',
    `RUN_IAC=${runIac}`,
    '-e',
    `RUN_SCA=${runSca}`,
    '-e', 
    `SCAN_TARGET=${scanTarget}`,
    'codesec-integrations:test', 
    `${action}`
  ]

  info('Running codesec-integrations')
  await callCommand('docker', ...dockerArgs)
}

export async function readMarkdownFile(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return content;
  } catch (error) {
    throw new Error(`Failed to read scanner output file: ${error}`);
  }
}

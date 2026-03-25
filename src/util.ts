import { error, getInput, info, isDebug } from '@actions/core'
import { context } from '@actions/github'
import { spawn } from 'child_process'
import { readFileSync } from 'fs'

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
  await callCommand('lacework', '--noninteractive', 'sca', ...args)
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

  let lwAccountName = process.env.LW_ACCOUNT
  lwAccountName = lwAccountName?.replace(/\.lacework\.net$/, '')

  let url =
    `https://${lwAccountName}.lacework.net` +
    `/ui/investigation/codesec/applications/repositories/` +
    `github.com%2F${context.repo.owner}%2F${context.repo.repo}` +
    `/${defaultBranch}`

  if (process.env.LW_SUBACCOUNT) {
    url += '?accountName=' + process.env.LW_SUBACCOUNT
  }

  return url
}

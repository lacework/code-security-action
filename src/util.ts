import { getInput, isDebug } from '@actions/core'
import { error, info } from '@actions/core'
import { spawnSync } from 'child_process'

export function getBooleanInput(name: string) {
  info(name + ': ' + getInput(name).toLowerCase())
  return getInput(name).toLowerCase() == 'true'
}

export function debug() {
  return getBooleanInput('debug') || isDebug()
}

export async function callCommand(command: string, ...args: string[]) {
  const child = spawnSync(command, args)
  if (debug() && child.stderr.toString() !== '') {
    info(`stderr from command:\n${child.stderr.toString()}`)
  }
  if (child.status) {
    error(`Failed with status ${child.status}`)
    process.exit(0) // TODO: Exit with 1 once we want failures to be fatal
  }
  return child.stdout.toString().trim()
}

export function getRequiredEnvVariable(name: string) {
  const value = process.env[name]
  if (!value) {
    error(`Missing required environment variable ${name}`)
    process.exit(0) // TODO: Exit with 1 once we want failures to be fatal
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
  return await callCommand('lacework', ...expandedArgs)
}

import { error, getInput, info, isDebug } from '@actions/core'
import { context } from '@actions/github'
import { spawn } from 'child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { simpleGit } from 'simple-git'

// Gather GITHUB_* and CI env vars for the lacework iac binary to read directly
function gatherGitHubEnvVars(): string[] {
  const prefixes = ['GITHUB_', 'CI']
  const envVars: string[] = []

  for (const [key, value] of Object.entries(process.env)) {
    if (prefixes.some((p) => key.startsWith(p))) {
      envVars.push(`${key}=${value}`)
    }
  }
  envVars.push('CI_PLATFORM=github')
  envVars.push(`LW_CODESEC_GIT_BRANCH=${process.env['LW_CODESEC_GIT_BRANCH'] || ''}`)
  return envVars
}

// Create a temp env file with GitHub CI vars for --env-file
function createEnvFile(): string {
  const envFile = path.join(os.tmpdir(), `codesec-env-${Date.now()}.list`)
  const envVars = gatherGitHubEnvVars()
  writeFileSync(envFile, envVars.join('\n'))
  return envFile
}

export function getMsSinceStart(): string {
  const now = Date.now()
  const start = Date.parse(getRequiredEnvVariable('LACEWORK_START_TIME'))
  return (now - start).toString()
}

function getBooleanInput(name: string) {
  return getInput(name).toLowerCase() === 'true'
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

export async function tryCallCommand(command: string, ...args: string[]): Promise<boolean> {
  const child = spawn(command, args, { stdio: 'ignore' })
  const exitCode = await new Promise((resolve, _) => {
    child.on('close', resolve)
  })
  return exitCode === 0
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

export async function getModifiedFiles(): Promise<string | undefined> {
  try {
    const diff = await simpleGit().diff(['--name-only', 'HEAD^1...HEAD'])
    const files = diff.trim().split('\n').filter(Boolean).join(',')
    return files || undefined
  } catch (e) {
    info(`Failed to get modified files: ${e}`)
    return undefined
  }
}

// gitWorkspaceDockerArgs - mount the checkout and expose GitHub credentials to
// git inside the container.
//
// The scanner runs `git remote show origin` to determine the repository's
// default branch, which needs working GitHub credentials. actions/checkout wires
// these by writing an `http.<host>.extraheader` AUTHORIZATION entry into a config
// file under RUNNER_TEMP and referencing it from the repo's .git/config with an
// `includeIf.gitdir:<host checkout path>/.git` entry. To make that resolve inside
// the container we:
//   - mount the checkout at its original host path so the gitdir condition matches
//   - mount RUNNER_TEMP so the referenced credentials file is reachable
//   - point WORKSPACE at the host path and mark it a safe directory (the image's
//     built-in `/app/${WORKSPACE}` safe.directory no longer applies)
function gitWorkspaceDockerArgs(): string[] {
  const workspace = process.cwd()
  const args = ['-v', `${workspace}:${workspace}`]

  const runnerTemp = process.env.RUNNER_TEMP
  if (runnerTemp && existsSync(runnerTemp)) {
    args.push('-v', `${runnerTemp}:${runnerTemp}`)
  } else {
    info('RUNNER_TEMP not set — git credentials may be unavailable inside the container')
  }

  args.push(
    '-e',
    `WORKSPACE=${workspace}`,
    '-e',
    'GIT_CONFIG_COUNT=1',
    '-e',
    'GIT_CONFIG_KEY_0=safe.directory',
    '-e',
    `GIT_CONFIG_VALUE_0=${workspace}`
  )

  return args
}

// runCodesecScan - Docker-based scanner using codesec:latest image
//
// Parameters:
// - reportsDir: directory to write scan results to
// - scanTarget: 'new', 'old', or 'scan' depending on mode
// - computeCacheKey: if true, runs GENERATE_CACHE_KEY mode instead of scanning
export async function runCodesecScan(
  reportsDir: string,
  scanTarget?: string,
  modifiedFiles?: string,
  computeCacheKey: boolean = false
): Promise<boolean> {
  const lwAccount = getRequiredEnvVariable('LW_ACCOUNT')
  const lwApiKey = getRequiredEnvVariable('LW_API_KEY')
  const lwApiSecret = getRequiredEnvVariable('LW_API_SECRET')

  const containerName = computeCacheKey
    ? `codesec-cache-key-${Date.now()}`
    : `codesec-scan-${scanTarget || 'default'}`

  info(
    computeCacheKey
      ? 'Running codesec cache key generation'
      : `Running codesec scan (target: ${scanTarget || 'scan'})`
  )

  const envFile = createEnvFile()

  const dockerArgs = [
    'run',
    '--name',
    containerName,
    ...gitWorkspaceDockerArgs(),
    '--env-file',
    envFile,
    '-e',
    `LW_ACCOUNT=${lwAccount}`,
    '-e',
    `LW_API_KEY=${lwApiKey}`,
    '-e',
    `LW_API_SECRET=${lwApiSecret}`,
    '-e',
    `RUN_SCA=true`,
    '-e',
    `RUN_IAC=true`,
    '-e',
    `SCAN_TARGET=${scanTarget || 'scan'}`,
    ...(modifiedFiles ? ['-e', `MODIFIED_FILES=${modifiedFiles}`] : []),
    ...(computeCacheKey ? ['-e', 'GENERATE_CACHE_KEY=true'] : []),
    'lacework/codesec:latest',
    'scan',
  ]

  await callCommand('docker', ...dockerArgs)

  if (computeCacheKey) {
    const outputFile = path.join(reportsDir, 'cache-key.txt')
    mkdirSync(reportsDir, { recursive: true })
    await callCommand(
      'docker',
      'container',
      'cp',
      `${containerName}:/tmp/scan-results/sca/cache-key.txt`,
      outputFile
    )
    try {
      await callCommand('docker', 'rm', containerName)
    } catch {
      // Best-effort cleanup — CI runner will discard everything on exit
    }
    return true
  }

  // Copy results out of container to temp dir
  const scaDir = path.join(reportsDir, 'sca')
  mkdirSync(scaDir, { recursive: true })
  await callCommand(
    'docker',
    'container',
    'cp',
    `${containerName}:/tmp/scan-results/sca/sca-${scanTarget || 'scan'}.sarif`,
    path.join(scaDir, `sca-${scanTarget || 'scan'}.sarif`)
  )

  const iacDir = path.join(reportsDir, 'iac')
  mkdirSync(iacDir, { recursive: true })
  const copied = await tryCallCommand(
    'docker',
    'container',
    'cp',
    `${containerName}:/tmp/scan-results/iac/iac-${scanTarget || 'scan'}.json`,
    path.join(iacDir, `iac-${scanTarget || 'scan'}.json`)
  )
  if (!copied) {
    info('IaC results not produced — scanner likely skipped IaC')
  }

  // Cleanup container
  await callCommand('docker', 'rm', containerName)
  return true
}

export async function runCodesecCompare(): Promise<string | null> {
  const lwAccount = getRequiredEnvVariable('LW_ACCOUNT')
  const lwApiKey = getRequiredEnvVariable('LW_API_KEY')
  const lwApiSecret = getRequiredEnvVariable('LW_API_SECRET')

  const containerName = 'codesec-compare'

  info('Running codesec compare')

  const envFile = createEnvFile()

  const uiLink = generateUILink()
  writeFileSync(envFile, `\nLW_UI_LINK=${uiLink}`, { flag: 'a' })

  const dockerArgs = [
    'run',
    '--name',
    containerName,
    ...gitWorkspaceDockerArgs(),
    '-v',
    `${path.join(process.cwd(), 'scan-results')}:/app/scan-results`,
    '--env-file',
    envFile,
    '-e',
    `LW_ACCOUNT=${lwAccount}`,
    '-e',
    `LW_API_KEY=${lwApiKey}`,
    '-e',
    `LW_API_SECRET=${lwApiSecret}`,
    '-e',
    `RUN_SCA=true`,
    '-e',
    `RUN_IAC=true`,
    'lacework/codesec:latest',
    'compare',
  ]

  await callCommand('docker', ...dockerArgs)

  const compareDir = path.join(os.tmpdir(), `codesec-compare-${Date.now()}`)
  mkdirSync(compareDir, { recursive: true })

  await callCommand(
    'docker',
    'container',
    'cp',
    `${containerName}:/tmp/scan-results/compare/.`,
    compareDir
  )

  await callCommand('docker', 'rm', containerName)

  const outputs = ['merged-compare.md', 'sca-compare.md', 'iac-compare.md']

  let message: string | null = null
  for (const output of outputs) {
    const outputPath = path.join(compareDir, output)
    if (existsSync(outputPath)) {
      info(`Using comparison output: ${output}`)
      message = readFileSync(outputPath, 'utf-8')
      if (message.trim().length > 0) {
        return message
      }
    }
  }

  return message
}

export async function generateCacheKey(
  scanTarget?: string,
  modifiedFiles?: string
): Promise<string | undefined> {
  const reportsDir = path.join(os.tmpdir(), `codesec-cache-${Date.now()}`)

  try {
    await runCodesecScan(reportsDir, scanTarget, modifiedFiles, true)
  } catch (e) {
    info(`Cache key generation failed: ${(e as Error).message}`)
    return undefined
  }

  const outputFile = path.join(reportsDir, 'cache-key.txt')
  if (!existsSync(outputFile)) {
    info('Cache key file not found after generation')
    return undefined
  }

  const cacheKey = readFileSync(outputFile, 'utf-8').trim()
  unlinkSync(outputFile)

  if (!/^[a-f0-9]{64}$/.test(cacheKey)) {
    info(`Cache key format invalid: ${cacheKey}`)
    return undefined
  }

  info(`Generated cache key: ${cacheKey}`)
  return `codesec-${cacheKey}`
}

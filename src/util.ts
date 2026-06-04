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

export function shouldRunIaCScanner(modifiedFiles: string): boolean {
  const iacFileExtensions = ['.tf', '.hcl', '.yaml', '.yml', '.json']
  const nonIaCFilenames = [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.build.json',
    'tslint.json',
    'jest.config.json',
    '.eslintrc.json',
    '.prettierrc.json',
    '.prettierrc.yaml',
    '.prettierrc.yml',
    'renovate.json',
    'lerna.json',
    'bower.json',
    'composer.json',
    'composer.lock',
    'Pipfile.lock',
    'cargo.lock',
  ]
  return modifiedFiles.split(',').some((file) => {
    const filename = file.split('/').pop() || ''
    if (nonIaCFilenames.includes(filename.toLowerCase())) {
      return false
    }
    return iacFileExtensions.some((ext) => file.endsWith(ext))
  })
}

// runCodesec - Docker-based scanner using codesec:latest image
//
// Modes:
// 1. action='scan', scanTarget='new'/'old' -> produces analysis for PR comment
// 2. action='scan', scanTarget='scan' -> full scan for scheduled events (uploads to Lacework)
// 3. action='compare' -> compares new/old results, generates diff markdown for PR comment
//
// Parameters:
// - runIac/runSca: which scanners to enable (default false - enable when ready to test)
// - scanTarget: 'new', 'old', or 'scan' depending on mode
// - computeCacheKey: if true, runs GENERATE_CACHE_KEY mode instead of scanning
export async function runCodesec(
  action: string,
  runIac: boolean = false,
  runSca: boolean = false,
  reportsDir: string,
  scanTarget?: string,
  modifiedFiles?: string,
  computeCacheKey: boolean = false
): Promise<boolean> {
  const lwAccount = getRequiredEnvVariable('LW_ACCOUNT')
  const lwApiKey = getRequiredEnvVariable('LW_API_KEY')
  const lwApiSecret = getRequiredEnvVariable('LW_API_SECRET')

  if (action === 'scan') {
    const containerName = computeCacheKey
      ? `codesec-cache-key-${Date.now()}`
      : `codesec-scan-${scanTarget || 'default'}`

    info(
      computeCacheKey
        ? 'Running codesec cache key generation'
        : `Running codesec scan (target: ${scanTarget || 'scan'})`
    )

    // Create env file with GitHub CI vars for the lacework iac binary
    const envFile = createEnvFile()

    // Run the scanner
    const dockerArgs = [
      'run',
      '--name',
      containerName,
      '-v',
      `${process.cwd()}:/app/src`,
      '--env-file',
      envFile,
      '-e',
      `WORKSPACE=src`,
      '-e',
      `LW_ACCOUNT=${lwAccount}`,
      '-e',
      `LW_API_KEY=${lwApiKey}`,
      '-e',
      `LW_API_SECRET=${lwApiSecret}`,
      '-e',
      `RUN_SCA=${runSca}`,
      '-e',
      `RUN_IAC=${runIac}`,
      '-e',
      `SCAN_TARGET=${scanTarget || 'scan'}`,
      ...(modifiedFiles ? ['-e', `MODIFIED_FILES=${modifiedFiles}`] : []),
      ...(computeCacheKey ? ['-e', 'GENERATE_CACHE_KEY=true'] : []),
      'lacework/codesec:latest',
      'scan',
    ]

    await callCommand('docker', ...dockerArgs)

    if (computeCacheKey) {
      // Copy cache key out and cleanup
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
    if (runSca) {
      const scaDir = path.join(reportsDir, 'sca')
      mkdirSync(scaDir, { recursive: true })
      await callCommand(
        'docker',
        'container',
        'cp',
        `${containerName}:/tmp/scan-results/sca/sca-${scanTarget || 'scan'}.sarif`,
        path.join(scaDir, `sca-${scanTarget || 'scan'}.sarif`)
      )
    }

    if (runIac) {
      const iacDir = path.join(reportsDir, 'iac')
      mkdirSync(iacDir, { recursive: true })
      await callCommand(
        'docker',
        'container',
        'cp',
        `${containerName}:/tmp/scan-results/iac/iac-${scanTarget || 'scan'}.json`,
        path.join(iacDir, `iac-${scanTarget || 'scan'}.json`)
      )
    }

    // Cleanup container
    await callCommand('docker', 'rm', containerName)
  } else if (action === 'compare') {
    const containerName = 'codesec-compare'

    info('Running codesec compare')

    // Create env file with GitHub CI vars for the lacework iac binary
    const envFile = createEnvFile()

    // Append LW_UI_LINK so the image can pass it to `lacework sca compare --ui-link`
    const uiLink = generateUILink()
    writeFileSync(envFile, `\nLW_UI_LINK=${uiLink}`, { flag: 'a' })

    // Mounts both the repo and the scan-results directory separately
    const dockerArgs = [
      'run',
      '--name',
      containerName,
      '-v',
      `${process.cwd()}:/app/src`,
      '-v',
      `${path.join(process.cwd(), 'scan-results')}:/app/scan-results`,
      '--env-file',
      envFile,
      '-e',
      `WORKSPACE=src`,
      '-e',
      `LW_ACCOUNT=${lwAccount}`,
      '-e',
      `LW_API_KEY=${lwApiKey}`,
      '-e',
      `LW_API_SECRET=${lwApiSecret}`,
      '-e',
      `RUN_SCA=${runSca}`,
      '-e',
      `RUN_IAC=${runIac}`,
      'lacework/codesec:latest',
      'compare',
    ]

    await callCommand('docker', ...dockerArgs)

    // Copy comparison results out
    const compareDir = path.join(reportsDir, 'compare')
    mkdirSync(compareDir, { recursive: true })

    // Copy the entire compare directory out
    await callCommand(
      'docker',
      'container',
      'cp',
      `${containerName}:/tmp/scan-results/compare/.`,
      compareDir
    )

    // Verify at least one output was produced
    const compareFiles = ['merged-compare.md', 'sca-compare.md', 'iac-compare.md']
    const copied = compareFiles.filter((f) => existsSync(path.join(compareDir, f)))

    if (copied.length === 0) {
      throw new Error('No comparison outputs found in container')
    }

    // Cleanup container
    await callCommand('docker', 'rm', containerName)
  }
  return true
}

export function readMarkdownFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8')
  } catch (error) {
    throw new Error(`Failed to read scanner output file: ${error}`)
  }
}

export async function generateCacheKey(
  runIac: boolean,
  runSca: boolean,
  scanTarget?: string,
  modifiedFiles?: string
): Promise<string | undefined> {
  const reportsDir = path.join(os.tmpdir(), `codesec-cache-${Date.now()}`)

  try {
    await runCodesec('scan', runIac, runSca, reportsDir, scanTarget, modifiedFiles, true)
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

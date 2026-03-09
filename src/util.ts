import { error, getInput, info, isDebug } from '@actions/core'
import { context } from '@actions/github'
import { spawn } from 'child_process'
import { TelemetryCollector } from './telemetry'
import { readFileSync } from 'fs'
import * as path from 'path'
import { mkdirSync, existsSync } from 'fs'

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

// codesecRun - Docker-based scanner using codesec:latest image
// Follows the pattern from test-unified-scanner.sh for CI runner compatibility
//
// Modes:
// 1. action='scan', scanTarget='new'/'old' -> produces analysis for PR comment
// 2. action='scan', scanTarget='scan' -> full scan for scheduled events (uploads to Lacework)
// 3. action='compare' -> compares new/old results, generates diff markdown for PR comment
//
// Parameters:
// - runIac/runSca: which scanners to enable (default false - enable when ready to test)
// - scanTarget: 'new', 'old', or 'scan' depending on mode
export async function codesecRun(
  action: string,
  runIac: boolean = false,
  runSca: boolean = false,
  scanTarget?: string
): Promise<string> {
  const lwAccount = getRequiredEnvVariable('LW_ACCOUNT_NAME')
  const lwApiKey = getRequiredEnvVariable('LW_API_KEY')
  const lwApiSecret = getRequiredEnvVariable('LW_API_SECRET')

  // Create scan-results directory in workspace (required for artifact upload)
  const reportsDir = path.join(process.cwd(), 'scan-results')

  if (action === 'scan') {
    // Scan mode: mount repo as /app/src, results go to /tmp/scan-results/ in container
    const containerName = `codesec-scan-${scanTarget || 'default'}`

    info(`Running codesec scan (target: ${scanTarget || 'scan'})`)

    // Run the scanner
    const dockerArgs = [
      'run',
      '--name',
      containerName,
      '-v',
      `${process.cwd()}:/app/src`,
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
      'lacework/codesec:latest',
      'scan',
    ]

    await callCommand('docker', ...dockerArgs)

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
    // Compare mode: copy scan results into place first, then run compare
    const srcDir = path.join(reportsDir, 'sca')
    const scaOld = path.join(srcDir, 'sca-old.sarif')
    const scaNew = path.join(srcDir, 'sca-new.sarif')

    // Verify required files exist before running compare
    if (!existsSync(scaOld) || !existsSync(scaNew)) {
      throw new Error(
        `Compare requires sca-old.sarif and sca-new.sarif. Found: old=${existsSync(
          scaOld
        )}, new=${existsSync(scaNew)}`
      )
    }

    const containerName = 'codesec-compare'

    info('Running codesec compare')

    // Note: mounts both the repo and the scan-results directory separately
    const dockerArgs = [
      'run',
      '--name',
      containerName,
      '-v',
      `${process.cwd()}:/app/src`,
      '-v',
      `${path.join(process.cwd(), 'scan-results')}:/app/scan-results`,
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

    // Copy all available comparison outputs
    // merged-compare.md exists when both SCA and IAC comparisons succeed
    // sca-compare.md / iac-compare.md exist for individual comparisons
    let copiedAny = false

    try {
      await callCommand(
        'docker',
        'container',
        'cp',
        `${containerName}:/tmp/scan-results/compare/merged-compare.md`,
        path.join(compareDir, 'merged-compare.md')
      )
      copiedAny = true
    } catch {
      info('Merged compare output not found (partial compare mode)')
    }

    try {
      await callCommand(
        'docker',
        'container',
        'cp',
        `${containerName}:/tmp/scan-results/compare/sca-compare.md`,
        path.join(compareDir, 'sca-compare.md')
      )
      copiedAny = true
    } catch {
      info('SCA compare output not found (may have been skipped)')
    }

    try {
      await callCommand(
        'docker',
        'container',
        'cp',
        `${containerName}:/tmp/scan-results/compare/iac-compare.md`,
        path.join(compareDir, 'iac-compare.md')
      )
      copiedAny = true
    } catch {
      info('IAC compare output not found (may have been skipped)')
    }

    if (!copiedAny) {
      throw new Error('No comparison outputs found in container')
    }

    // Cleanup container
    await callCommand('docker', 'rm', containerName)
  }
  return reportsDir
}

export function readMarkdownFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8')
  } catch (error) {
    throw new Error(`Failed to read scanner output file: ${error}`)
  }
}

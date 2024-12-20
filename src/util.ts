import { getInput, isDebug } from '@actions/core'
import { error, info } from '@actions/core'
import { spawn } from 'child_process'
import { TelemetryCollector } from './telemetry'

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

export function autofix() {
  // autofix does fix all vulnerabilities, regardless of whether they are newly introduced or no
  // for this reason, we skip if we are scanning the old branch
  return getBooleanInput('autofix') && getInput('target') != 'old'
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

// This interface will be used to store the vulnerabilities found in the comparison report.
export interface VulnerabilityEntry {
  name: string // Title of the vulnerability (e.g., CVE-2021-1234, cookie-without-domain-js) - SCA/SAST tool specific.
  type: 'CVE' | 'CWE' // Type of the vulnerability.
  url: string // Where to find the vulnerability inside the codebase.
  line: number // Line number where the vulnerability was - extracted from the URL.
  details: string // Description of the vulnerability.
  filePath?: string // Path to the file where the vulnerability was found.
  SmartFix?: string // Specific to SCA - will be used to suggest the right version to upgrade to and contains supporting text.
  SmartFixVersion?: string // Specific to SCA - will be used to suggest the right version to upgrade to.
  moreDetails?: string // Additional details about the vulnerability to be printed in the PR.
}

// This function is used to break the vulnerabilities clumped together into individual vulnerabilities. We aim to store information such as SmartFix version, line number, etc.
export function parseVulnerabilities(message: string) {
  const entries: VulnerabilityEntry[] = []
  const lines = message.split('\n')

  let currentEntry: Partial<VulnerabilityEntry> | null = null

  for (const line of lines) {
    const trimmedLine = line.trim()

    // Start of a new vulnerability entry
    const match = /^\*\s*([^\s]+)\s+(.*)$/.exec(trimmedLine)
    if (match) {
      // Push the previous entry to the list, if any
      if (currentEntry && currentEntry.name && currentEntry.details) {
        entries.push(currentEntry as VulnerabilityEntry)
      }

      // Create a new entry
      currentEntry = {
        name: match[1], // Vulnerability name (e.g., CVE-2021-1234)
        details: match[2], // Details after name
      }

      // Determine the type of vulnerability based on naming.
      if (currentEntry.name) {
        if (currentEntry.name.startsWith('CVE')) {
          currentEntry.type = 'CVE'
        } else {
          currentEntry.type = 'CWE'
        }
      }

      if (currentEntry.details) {
        const url = extractUrl(currentEntry.details)
        if (url) {
          currentEntry.url = url
          // Extract the line number from the URL.
          const lineNumber = extractLineNumber(url)
          if (lineNumber) {
            currentEntry.line = lineNumber
          }
        }

        const filePath = extractFilePath(currentEntry.details)
        if (filePath) {
          currentEntry.filePath = filePath
        }

        const moreDetails = extractMoreDetails(currentEntry.details)
        if (moreDetails) {
          currentEntry.moreDetails = moreDetails
        } else {
          currentEntry.moreDetails = 'No more details provided.'
        }
      }
    }

    // Parse SmartFix field
    if (currentEntry) {
      const smartFixMatch = /^SmartFix:\s*(\d+\.\d+\.\d+)(.*)$/.exec(trimmedLine)
      if (smartFixMatch) {
        currentEntry.SmartFix = smartFixMatch[0].trim() // Full SmartFix text
        currentEntry.SmartFixVersion = smartFixMatch[1] // Extracted version
      }
    }

    // Skip unsupported lines
    const isSupportedLine = /^\*|SmartFix:/.test(trimmedLine)
    if (!isSupportedLine) {
      continue
    }
  }

  // Push the last entry, if any
  if (currentEntry && currentEntry.name && currentEntry.details) {
    entries.push(currentEntry as VulnerabilityEntry)
  }

  return entries
}

// This function identifies the URL from the details of the vulnerability. CVEs and CWEs have the URLs in the second block of paranthesis. For reference, here are examples:
// CVE-XX-YY ([pom.xml: com.artifact:artifact@1.4.6](https://github.com/lacework-dev/WebGoat/blob/faf0ff128a287a3a341c90e61720313b98d43ea3/pom.xml#L308))
// no-csrf-protection-in-express-js ([vuln.js: https://github.com/lacework-dev/WebGoat](https://github.com/lacework-dev/WebGoat/blob/faf0ff128a287a3a341c90e61720313b98d43ea3/vuln.js#L2))
function extractUrl(details: string): string | undefined {
  // Match the URL inside parentheses at the end of the details string
  const match = /\((https?:\/\/[^\s)]+)\)/.exec(details)
  if (match) {
    return match[1] // Extracted URL
  }
  return undefined // Fallback if no URL is found
}

// This function will take in the URL as input and extract the line number from it. The format is https://.....#L<number>
function extractLineNumber(url: string): number | undefined {
  const match = /#L(\d+)$/.exec(url) // Match #L<number> at the end of the URL
  return match ? parseInt(match[1], 10) : undefined
}

// This function will extract the file path from the details string. The file path is the text before the ':' in square brackets.
function extractFilePath(details: string): string | undefined {
  const match = /\[([^\s:]+):/.exec(details) // Match the text before ':' in square brackets
  return match ? match[1] : undefined
}

// This function will extract the entire <details> block from the details string. This will be used to provide more context in the PR review comment.
function extractMoreDetails(details: string): string | undefined {
  const parts = details.split('<details><summary>More details</summary>')

  if (parts.length > 1) {
    // If the <details> block is present, append </details> to the second part
    const moreDetailsContent = parts[1].trim()
    if (!moreDetailsContent.endsWith('</details>')) {
      return `<details><summary>More details</summary>${moreDetailsContent}</details>`
    }
    return `<details><summary>More details</summary>${moreDetailsContent}`
  }

  return undefined // No <details> block found
}

// This function will calculate the "position" parameter based on the diff hunk and the target line number.
export function calculatePosition(patch: string, targetLine: number): number | undefined {
  const patchLines = patch.split('\n')
  let position = 0 // Position in the diff
  let currentLine = 0 // Tracks the file's line number

  for (const line of patchLines) {
    position++

    if (line.startsWith('@@')) {
      // Extract the starting line number from the diff hunk header
      const match = /@@ -\d+,\d+ \+(\d+),(\d+) @@/.exec(line)
      if (match) {
        currentLine = parseInt(match[1], 10) - 1 // Start line in the new file
      }
    } else if (!line.startsWith('-')) {
      // Skip lines removed from the old file
      currentLine++
    }

    // Check if we've reached the target line
    if (currentLine === targetLine) {
      return position // Return the position in the diff
    }
  }

  return undefined // Line not found in the patch
}

// This function will group the vulnerabilities by file path and line number information, as well as type (CVE or CWE).
export function groupVulnerabilitiesByLineAndType(vulnerabilities: VulnerabilityEntry[]) {
  // The key will be a combination of the file path and line number. This will be used later in identifying PR review comments.
  const groupedVulnerabilities: Record<
    string,
    { CVE: VulnerabilityEntry[]; CWE: VulnerabilityEntry[] }
  > = {}

  for (const entry of vulnerabilities) {
    const key = `${entry.filePath}:${entry.line}`
    if (!groupedVulnerabilities[key]) {
      groupedVulnerabilities[key] = { CVE: [], CWE: [] }
    }
    groupedVulnerabilities[key][entry.type].push(entry)
  }

  return groupedVulnerabilities
}

// This function will generate a body message reflecting all the vulnerabilities found for a particular line inside a specific file.
export function generateCombinedReviewBody(
  groupedVulnerabilities: { CVE: VulnerabilityEntry[]; CWE: VulnerabilityEntry[] },
  filePath: string,
  line: number,
  stepHash: string
): string {
  let body = `${stepHash}\n\n`

  if (groupedVulnerabilities.CVE.length > 0) {
    body += `\n#### CVEs:\n`
    groupedVulnerabilities.CVE.forEach((entry) => {
      body += `- **${entry.name}**: ${entry.moreDetails || 'No more details provided.'}\n`
    })
  }

  if (groupedVulnerabilities.CWE.length > 0) {
    body += `\n#### CWEs:\n`
    groupedVulnerabilities.CWE.forEach((entry) => {
      body += `- **${entry.name}**: ${entry.moreDetails || 'No more details provided.'}\n`
    })
  }

  return body
}

export function printEntries(entries: VulnerabilityEntry[]) {
  for (const entry of entries) {
    info('Here is an entry: ')
    info('Name: ' + entry.name)
    info('Type: ' + entry.type)
    info('Details: ' + entry.details)
    info('SmartFix: ' + (entry.SmartFix ?? 'No SmartFix'))
    info('SmartFixVersion: ' + (entry.SmartFixVersion ?? 'No SmartFixVersion'))
    info('URL: ' + entry.url)
    info('Line: ' + entry.line)
    info('FilePath: ' + (entry.filePath ?? 'No FilePath'))
    info('More Details: ' + (entry.moreDetails ?? 'No More Details'))
  }
}

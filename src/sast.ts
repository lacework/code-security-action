import { error, info, startGroup, endGroup } from '@actions/core'
import { context } from '@actions/github'
import { readFileSync } from 'fs'
import { callLaceworkCli } from './util'
import { Location, Log } from 'sarif'
import { Issue } from './types'

export async function printSastResults(sarifFile: string) {
  startGroup('Results for SAST')
  let foundSomething = false
  const results: Log = JSON.parse(readFileSync(sarifFile, 'utf8'))
  for (const run of results.runs) {
    if (Array.isArray(run.results) && run.results.length > 0) {
      foundSomething = true
      info('Found ' + run.results?.length + ' results using ' + run.tool.driver.name)
      for (const vuln of run.results) {
        info(JSON.stringify(vuln, null, 2))
      }
    }
  }
  if (!foundSomething) {
    info('No SAST issues were found')
  }
  endGroup()
}

export async function compareSastResults(oldReport: string, newReport: string): Promise<Issue[]> {
  startGroup('Comparing SAST results')
  info(
    await callLaceworkCli(
      'sast',
      'compare',
      '--old',
      oldReport,
      '--new',
      newReport,
      '-o',
      'sast-compare.sarif'
    )
  )
  const results: Log = JSON.parse(readFileSync('sast-compare.sarif', 'utf8'))
  let sawChange = false
  const alertsAdded: Issue[] = []
  for (const run of results.runs) {
    if (Array.isArray(run.results) && run.results.length > 0) {
      info('There was changes in ' + run.results.length + ' results from ' + run.tool.driver.name)
      for (const vuln of run.results) {
        info(JSON.stringify(vuln, null, 2))
        if (vuln.properties?.['status'] === 'added') {
          const message =
            vuln.message.markdown || vuln.message.text || 'No information available on alert'
          let details = undefined
          if (
            vuln.codeFlows !== undefined &&
            vuln.codeFlows.length > 0 &&
            vuln.codeFlows[0].threadFlows.length > 0
          ) {
            const chosenFlow = vuln.codeFlows[0].threadFlows[0]
            details = 'Example problematic flow of data:\n\n'
            for (const flowLoc of chosenFlow.locations) {
              const location = flowLoc.location
              details += `  * ${prettyPrintSarifLocation(location)}`
              if (location?.message?.text !== undefined) {
                details += `: ${location.message.text}`
              }
              details += '\n'
            }
          }
          alertsAdded.push({
            summary: `${prettyPrintSarifLocation(vuln.locations?.[0])}: ${message}`,
            details,
          })
        }
      }
      if (alertsAdded.length > 0) {
        // TODO: Use setFailed once we want new alerts to cause a failure
        error(
          `${alertsAdded.length} new SAST issues were introduced, see above in the logs for details`
        )
      }
    }
  }
  if (!sawChange) {
    info('No changes in SAST issues')
  }
  endGroup()
  return alertsAdded
}

function prettyPrintSarifLocation(sarifLocation: Location | undefined) {
  const uri = sarifLocation?.physicalLocation?.artifactLocation?.uri
  const line = sarifLocation?.physicalLocation?.region?.startLine
  if (uri !== undefined && line !== undefined) {
    const file = uri.replace(/^file:\/*/, '')
    const text = `${file.split('/').pop()}:${line}`
    const url = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/blob/${context.sha}/${file}#L${line}`
    return `[${text}](${url})`
  }
  return 'Unknown location'
}

import { error, info, startGroup, endGroup } from '@actions/core'
import { context } from '@actions/github'
import { readFileSync } from 'fs'
import { callLaceworkCli } from './util'
import { Log } from 'sarif'

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

export async function compareSastResults(oldReport: string, newReport: string) {
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
  const alertsAdded: string[] = []
  for (const run of results.runs) {
    if (Array.isArray(run.results) && run.results.length > 0) {
      info('There was changes in ' + run.results.length + ' results from ' + run.tool.driver.name)
      for (const vuln of run.results) {
        info(JSON.stringify(vuln, null, 2))
        if (vuln.properties?.['status'] === 'added') {
          let location = 'Unknown location'
          const uri = vuln.locations?.[0].physicalLocation?.artifactLocation?.uri
          const line = vuln.locations?.[0].physicalLocation?.region?.startLine
          if (uri !== undefined && line !== undefined) {
            const file = uri.replace(/^file:\/*/, '')
            const text = `${file.split('/').pop()}:${line}`
            const url = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/blob/${context.sha}/${file}#L${line}`
            location = `[${text}](${url})`
          }
          const message =
            vuln.message.markdown || vuln.message.text || 'No information available on alert'
          alertsAdded.push(`${location}: ${message}`)
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

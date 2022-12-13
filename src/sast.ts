import { error, info, startGroup, endGroup } from '@actions/core'
import { context } from '@actions/github'
import { readFileSync } from 'fs'
import { callLaceworkCli } from './util'

export async function printSastResults(jsonFile: string) {
  startGroup('Results for SAST')
  const results = JSON.parse(readFileSync(jsonFile, 'utf8'))
  if (results.length > 0) {
    info('The following SAST issues were found:')
    for (const vuln of results) {
      info(JSON.stringify(vuln, null, 2))
    }
  } else {
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
      'sast-compare.json'
    )
  )
  const results = JSON.parse(readFileSync('sast-compare.json', 'utf8'))
  const alertsAdded: string[] = []
  if (Array.isArray(results) && results.length > 0) {
    info('There was changes in the following SAST issues:')
    for (const vuln of results) {
      info(JSON.stringify(vuln, null, 2))
      if (vuln.status === 'added') {
        const fileName = `${vuln.file.split('/').pop()}:${vuln.line}`
        const fileUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/blob/${context.sha}/${vuln.file}#L${vuln.line}`
        alertsAdded.push(`[${fileName}](${fileUrl}): ${vuln.qualifier}`)
      }
    }
    if (alertsAdded.length > 0) {
      // TODO: Use setFailed once we want new alerts to cause a failure
      error(
        `${alertsAdded.length} new SAST issues were introduced, see above in the logs for details`
      )
    }
  } else {
    info('No changes in SAST issues')
  }
  endGroup()
  return alertsAdded
}

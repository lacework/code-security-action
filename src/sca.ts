import { error, info, startGroup, endGroup } from '@actions/core'
import { readFileSync } from 'fs'
import { Issue } from './types'
import { callLaceworkCli } from './util'

export async function printScaResults(jsonFile: string) {
  startGroup('Results for SCA')
  const results = JSON.parse(readFileSync(jsonFile, 'utf8'))
  if (Array.isArray(results.Vulnerabilities)) {
    info('The following SCA issues were found:')
    for (const vuln of results.Vulnerabilities) {
      info(JSON.stringify(vuln, null, 2))
    }
  } else {
    info('No SCA issues were found')
  }
  endGroup()
}

export async function compareScaResults(oldReport: string, newReport: string): Promise<Issue[]> {
  startGroup('Comparing SCA results')
  info(
    await callLaceworkCli(
      'sca',
      'compare',
      '--old',
      oldReport,
      '--new',
      newReport,
      '-o',
      'sca-compare.json'
    )
  )
  const results = JSON.parse(readFileSync('sca-compare.json', 'utf8'))
  const alertsAdded: Issue[] = []
  if (Array.isArray(results.Vulnerabilities) && results.Vulnerabilities.length > 0) {
    info('There was changes in the following SCA issues:')
    for (const vuln of results.Vulnerabilities) {
      info(JSON.stringify(vuln, null, 2))
      if (vuln.Compare?.Status === 'added') {
        alertsAdded.push({
          summary: `[${vuln.Info.ExternalId}](${vuln.Info.Link}): ${vuln.Info.Description}`,
        })
      }
    }
    if (alertsAdded.length > 0) {
      // TODO: Use setFailed once we want new alerts to cause a failure
      error(
        `${alertsAdded.length} new SCA issues were introduced, see above in the logs for details`
      )
    }
  } else {
    info('No changes in SCA issues')
  }
  endGroup()
  return alertsAdded
}

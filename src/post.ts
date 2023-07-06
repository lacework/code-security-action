import { info, warning } from '@actions/core'
import {
  getActionRef,
  getMsSinceStart,
  getOptionalEnvVariable,
  getRequiredEnvVariable,
  getRunUrl,
  telemetryCollector,
} from './util'

if (getOptionalEnvVariable('LACEWORK_WROTE_TELEMETRY', 'false') !== 'true') {
  info("Telemetry wasn't previous reported, reporting unknown failure now")
  telemetryCollector.addField('version', getActionRef())
  telemetryCollector.addField('url', getRunUrl())
  telemetryCollector.addField('repository', getRequiredEnvVariable('GITHUB_REPOSITORY'))
  telemetryCollector.addField('duration.total', getMsSinceStart())
  telemetryCollector.addField('error', 'Unknown catastrophic error')
  telemetryCollector.report().catch((err) => {
    warning('Failed to report telemetry: ' + err.message)
  })
} else {
  info('Telemetry has been reported')
}

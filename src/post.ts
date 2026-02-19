import { info, warning } from '@actions/core'
import { context } from '@actions/github'
import { getActionsApi } from './actions'
import { getOptionalEnvVariable, getRequiredEnvVariable } from './util'

async function main() {
  if (getOptionalEnvVariable('LACEWORK_WROTE_TELEMETRY', 'false') !== 'true') {
    info("Telemetry wasn't previous reported")

    const run = await getActionsApi().getWorkflowRunAttempt({
      ...context.repo,
      run_id: parseInt(getRequiredEnvVariable('GITHUB_RUN_ID')),
      attempt_number: parseInt(getRequiredEnvVariable('GITHUB_RUN_NUMBER')),
    })

    info(`Run status: ${run.data.status}`)
    if (run.data.status === 'cancelled') {
      info('Run does was cancelled, not reporting telemetry')
      return
    }

    info('Reporting unknown failure')
  } else {
    info('Telemetry has been reported previously')
  }
}

main().catch((e) => {
  warning(`Failed to report telemetry: ${e.message}`)
})

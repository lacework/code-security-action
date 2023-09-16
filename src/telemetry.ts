import { callLaceworkCli } from './util'
import { writeFileSync } from 'fs'
import { fileSync } from 'tmp'

export class TelemetryCollector {
  data: Record<string, string> = {}

  addField(name: string, value: string) {
    this.data[name] = value
  }

  addError(name: string, e: any) {
    if (typeof e === 'string') {
      this.addField('error', e)
    } else if (e instanceof Error) {
      this.addField('error', e.message)
    } else {
      this.addField('error', 'Unknown error')
    }
  }

  async report() {
    let file = fileSync().name
    writeFileSync(file, JSON.stringify(this.data))
    await callLaceworkCli('telemetry', 'upload', '--name', 'code-security-action', '--data', file)
  }
}

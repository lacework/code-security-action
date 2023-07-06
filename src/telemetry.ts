import { callLaceworkCli } from './util'
import { writeFileSync } from 'fs'
import { fileSync } from 'tmp'

export class TelemetryCollector {
  data: Record<string, string> = {}

  addField(name: string, value: string) {
    this.data[name] = value
  }

  async report() {
    let file = fileSync().name
    writeFileSync(file, JSON.stringify(this.data))
    await callLaceworkCli('telemetry', 'upload', '--name', 'code-security-action', '--data', file)
  }
}

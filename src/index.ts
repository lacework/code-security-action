import { error, info, startGroup, endGroup, getInput, setOutput, isDebug } from '@actions/core';
import { create } from '@actions/artifact';
import { context, getOctokit } from '@actions/github';
import { spawnSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';

function getBooleanInput(name: string) {
  return getInput(name).toLowerCase() === "true"
}

function debug() {
  return getBooleanInput("debug") || isDebug()
}

async function callCommand(command: string, ...args: string[]) {
  const child = spawnSync(command, args)
  if (debug() && child.stderr.toString() !== "") {
    info(`stderr from command:\n${child.stderr.toString()}`)
  }
  if (child.status) {
    error(`Failed with status ${child.status}`)
    process.exit(0) // TODO: Exit with 1 once we want failures to be fatal
  }
  return child.stdout.toString().trim()
}

function getRequiredEnvVariable(name: string) {
  const value = process.env[name]
  if (!value) {
    error(`Missing required environment variable ${name}`)
    process.exit(0) // TODO: Exit with 1 once we want failures to be fatal
  }
  return value
}

async function callLaceworkCli(...args: string[]) {
  const accountName = getRequiredEnvVariable("LW_ACCOUNT_NAME");
  const apiKey = getRequiredEnvVariable("LW_API_KEY");
  const apiSecret = getRequiredEnvVariable("LW_API_SECRET");
  const expandedArgs = ["--noninteractive", "--account", accountName, "--api_key", apiKey, "--api_secret", apiSecret, ...args]
  info("Calling lacework " + expandedArgs.join(" "))
  return await callCommand("lacework", ...expandedArgs);
}

async function uploadArtifact(artifactName: string, ...files: string[]) {
  startGroup("Uploading artifact " + artifactName)
  await create().uploadArtifact(artifactName, files, ".")
  endGroup()
}

async function downloadArtifact(artifactName: string) {
  startGroup("Downloading artifact " + artifactName)
  await create().downloadArtifact(artifactName, ".", { createArtifactFolder: true })
  endGroup()
}

async function printScaResults(jsonFile: string) {
  startGroup("Results for SCA")
  const results = JSON.parse(readFileSync(jsonFile, "utf8"))
  if (Array.isArray(results.Vulnerabilities)) {
    info("The following SCA issues were found:")
    for (const vuln of results.Vulnerabilities) {
      info(JSON.stringify(vuln, null, 2))
    }
  } else {
    info("No SCA issues were found")
  }
  endGroup()
}

async function printSastResults(jsonFile: string) {
  startGroup("Results for SAST")
  const results = JSON.parse(readFileSync(jsonFile, "utf8"))
  if (results.length > 0) {
    info("The following SAST issues were found:")
    for (const vuln of results) {
      info(JSON.stringify(vuln, null, 2))
    }
  } else {
    info("No SAST issues were found")
  }
  endGroup()
}

async function compareSastResults(oldReport: string, newReport: string) {
  startGroup("Comparing SAST results")
  info(await callLaceworkCli("sast", "compare", "--old", oldReport, "--new", newReport, "-o", "sast-compare.json"))
  const results = JSON.parse(readFileSync("sast-compare.json", "utf8"))
  const alertsAdded: string[] = []
  if (Array.isArray(results) && results.length > 0) {
    info("There was changes in the following SAST issues:")
    for (const vuln of results) {
      info(JSON.stringify(vuln, null, 2))
      if (vuln.status === "added") {
        const fileName = `${vuln.file.split("/").pop()}:${vuln.line}`
        const fileUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/blob/${context.sha}/${vuln.file}#L${vuln.line}`
        alertsAdded.push(`[${fileName}](${fileUrl}): ${vuln.qualifier}`)
      }
    }
    if (alertsAdded.length > 0) {
      // TODO: Use setFailed once we want new alerts to cause a failure
      error(`${alertsAdded.length} new SAST issues were introduced, see above in the logs for details`)
    }
  } else {
    info("No changes in SAST issues")
  }
  endGroup()
  return alertsAdded
}

async function compareScaResults(oldReport: string, newReport: string) {
  startGroup("Comparing SCA results")
  info(await callLaceworkCli("sca", "compare", "--old", oldReport, "--new", newReport, "-o", "sca-compare.json"))
  const results = JSON.parse(readFileSync("sca-compare.json", "utf8"))
  const alertsAdded: string[] = []
  if (Array.isArray(results.Vulnerabilities) && results.Vulnerabilities.length > 0) {
    info("There was changes in the following SCA issues:")
    for (const vuln of results.Vulnerabilities) {
      info(JSON.stringify(vuln, null, 2))
      if (vuln.Compare?.Status === "added") {
        alertsAdded.push(`[${vuln.Info.ExternalId}](${vuln.Info.Link}): ${vuln.Info.Description}`)
      }
    }
    if (alertsAdded.length > 0) {
      // TODO: Use setFailed once we want new alerts to cause a failure
      error(`${alertsAdded.length} new SCA issues were introduced, see above in the logs for details`)
    }
  } else {
    info("No changes in SCA issues")
  }
  endGroup()
  return alertsAdded
}

async function main() {
  const target = getInput('target')
  const scaReport = "sca.json"
  const sastReport = "sast.json"
  if (target !== "") {
    info("Analyzing " + target)
    const tools = (getInput('tools') || "sca").toLowerCase().split(",")
    const toUpload: string[] = []
    if (tools.includes("sca")) {
      info(await callLaceworkCli("sca", "dir", ".", "-o", scaReport))
      await printScaResults(scaReport)
      toUpload.push(scaReport)
    }
    if (tools.includes("sast")) {
      info(await callLaceworkCli("sast", "scan", "--verbose", "--classes", getInput('jar'), "-o", sastReport))
      await printSastResults(sastReport)
      toUpload.push(sastReport)
    }
    await uploadArtifact("results-" + target, ...toUpload)
    setOutput(`${target}-completed`, true)
  } else {
    info("Displaying results")
    await downloadArtifact("results-old")
    await downloadArtifact("results-new")
    const issuesByTool: { [tool: string]: string[] } = {}
    if (existsSync(`results-old/${scaReport}`) && existsSync(`results-new/${scaReport}`)) {
      issuesByTool["sca"] = await compareScaResults(`results-old/${scaReport}`, `results-new/${scaReport}`)
    }
    if (existsSync(`results-old/${sastReport}`) && existsSync(`results-new/${sastReport}`)) {
      issuesByTool["sast"] = await compareSastResults(`results-old/${sastReport}`, `results-new/${sastReport}`)
    }
    if (Object.values(issuesByTool).some(x => x.length > 0) && getInput('token').length > 0) {
      info("Posting comment to GitHub PR as there were new issues introduced:")
      let message = `Lacework Code Analysis found potential new issues in this PR.`;
      for (const [tool, issues] of Object.entries(issuesByTool)) {
        if (issues.length > 0) {
          message += `\n\n<details><summary>${tool} found ${issues.length} potential new issues</summary>\n\n`
          for (const issue in issues) {
            message += `* ${issues[issue]}\n`
          }
          message += "\n</details>"
        }
      }
      info(message)
      if (context.payload.pull_request) {
        await getOctokit(getInput('token')).rest.issues.createComment({
            ...context.repo,
            issue_number: context.payload.pull_request.number,
            body: message
          });
      }
    }
    setOutput(`display-completed`, true)
  }
}

main().catch(
  err => error(err.message) // TODO: Use setFailed once we want failures to be fatal
);

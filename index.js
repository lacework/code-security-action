import { error, info, startGroup, endGroup, getInput, setOutput, isDebug } from '@actions/core';
import { create } from '@actions/artifact';
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';

function getBooleanInput(name) {
  return getInput(name).toLowerCase() === "true"
}

function debug() {
  return getBooleanInput("debug") || isDebug()
}

async function callCommand(command, ...args) {
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

async function callLaceworkCli(...args) {
  const accountName = process.env.LW_ACCOUNT_NAME;
  const apiKey = process.env.LW_API_KEY;
  const apiSecret = process.env.LW_API_SECRET;
  const expandedArgs = ["--noninteractive", "--account", accountName, "--api_key", apiKey, "--api_secret", apiSecret, ...args]
  info("Calling lacework " + expandedArgs.join(" "))
  return await callCommand("lacework", ...expandedArgs);
}

async function uploadArtifact(artifactName, ...files) {
  startGroup("Uploading artifact " + artifactName)
  await create().uploadArtifact(artifactName, files, ".")
  endGroup()
}

async function downloadArtifact(artifactName) {
  startGroup("Downloading artifact " + artifactName)
  await create().downloadArtifact(artifactName, ".", { createArtifactFolder: true })
  endGroup()
}

async function printFile(name, file) {
  startGroup(name)
  info(await callCommand("cat", file))
  endGroup()
}

async function printScaResults(jsonFile) {
  startGroup("Results for SCA")
  const results = JSON.parse(readFileSync(jsonFile, "utf8"))
  if (Array.isArray(results.Vulnerabilities)) {
    info("The following SCA issues were found:")
    info(JSON.stringify(results.Vulnerabilities, null, 2))
  } else {
    info("No SCA issues were found")
  }
  endGroup()
}

async function compareSastResults(oldReport, newReport) {
  startGroup("Comparing SAST results")
  const output = await callLaceworkCli("sast", "compare", "--old", oldReport, "--new", newReport)
  info(output)
  const issuesIntroduced = output.match(/Introduced (\d+) issues/g)[0]
  if (issuesIntroduced > 0) {
    // TODO: Use setFailed once we want new alerts to cause a failure
    error(`${issuesIntroduced} new SAST issues were introduced, see above in the logs for details`)
  }
  endGroup()
}

async function compareScaResults(oldReport, newReport) {
  startGroup("Comparing SCA results")
  info(await callLaceworkCli("sca", "compare", "--old", oldReport, "--new", newReport, "-o", "sca-compare.json"))
  const results = JSON.parse(readFileSync("sca-compare.json", "utf8"))
  if (Array.isArray(results.Vulnerabilities)) {
    info("There was changes in the following SCA issues:")
    info(JSON.stringify(results.Vulnerabilities, null, 2))
    let alertsAdded = 0
    for (const vuln of results.Vulnerabilities) {
      if (vuln.Status === "added") {
        alertsAdded++
      }
    }
    if (alertsAdded > 0) {
      // TODO: Use setFailed once we want new alerts to cause a failure
      error(`${alertsAdded} new SCA issues were introduced, see above in the logs for details`)
    }
  }
  endGroup()
}

async function main() {
  const target = getInput('target')
  if (target !== "") {
    info("Analyzing " + target)
    info(await callLaceworkCli("sca", "dir", ".", "-o", "sca.json"))
    await printScaResults("sca.json")
    info(await callLaceworkCli("sast", "scan", "--verbose", "--classes", getInput('jar'), "-o", "sast.json"))
    await printFile("Results for SAST", "sast.json")
    await uploadArtifact("results-" + target, "sca.json", "sast.json")
    setOutput(`${target}-completed`, true)
  } else {
    info("Displaying results")
    await downloadArtifact("results-parent")
    await downloadArtifact("results-merge")
    await compareScaResults("results-parent/sca.json", "results-merge/sca.json")
    await compareSastResults("results-parent/sast.json", "results-merge/sast.json")
    setOutput(`display-completed`, true)
  }
}

main().catch(
  err => error(err.message) // TODO: Use setFailed once we want failures to be fatal
);

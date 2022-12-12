import { error, info, startGroup, endGroup, getInput, setOutput, isDebug } from '@actions/core';
import { create } from '@actions/artifact';
import { context, getOctokit } from '@actions/github';
import { spawnSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';

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

async function printScaResults(jsonFile) {
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

async function printSastResults(jsonFile) {
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
  return issuesIntroduced
}

async function compareScaResults(oldReport, newReport) {
  startGroup("Comparing SCA results")
  info(await callLaceworkCli("sca", "compare", "--old", oldReport, "--new", newReport, "-o", "sca-compare.json"))
  const results = JSON.parse(readFileSync("sca-compare.json", "utf8"))
  let alertsAdded = 0
  if (Array.isArray(results.Vulnerabilities)) {
    info("There was changes in the following SCA issues:")
    for (const vuln of results.Vulnerabilities) {
      info(vuln)
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
  return alertsAdded
}

async function main() {
  const target = getInput('target')
  if (target !== "") {
    info("Analyzing " + target)
    const tools = (getInput('tools') || "sca").toLowerCase().split(",")
    let toUpload = []
    if (tools.includes("sca")) {
      info(await callLaceworkCli("sca", "dir", ".", "-o", "sca.json"))
      await printScaResults("sca.json")
      toUpload.push("sca.json")
    }
    if (tools.includes("sast")) {
      info(await callLaceworkCli("sast", "scan", "--verbose", "--classes", getInput('jar'), "-o", "sast.json"))
      await printSastResults("sast.json")
      toUpload.push("sast.json")
    }
    await uploadArtifact("results-" + target, ...toUpload)
    setOutput(`${target}-completed`, true)
  } else {
    info("Displaying results")
    await downloadArtifact("results-parent")
    await downloadArtifact("results-merge")
    let issuesIntroduced = 0
    if (existsSync("results-parent/sca.json") && existsSync("results-merge/sca.json")) {
      issuesIntroduced += await compareScaResults("results-parent/sca.json", "results-merge/sca.json")
    }
    if (existsSync("results-parent/sast.json") && existsSync("results-merge/sast.json")) {
      issuesIntroduced += await compareSastResults("results-parent/sast.json", "results-merge/sast.json")
    }
    if (issuesIntroduced > 0 && getInput('token').length > 0) {
      info("Posting comment to GitHub PR as there were new issues introduced")
      const message = `Lacework Code Analysis found ${issuesIntroduced} potential new issues in this PR which can be reviewed in the GitHub Actions run log.`;
      if (context.payload.pull_request !== null) {
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

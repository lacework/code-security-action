import { create } from '@actions/artifact'
import { startGroup, endGroup, getInput, info } from '@actions/core'
import { context, getOctokit } from '@actions/github'

export async function uploadArtifact(artifactName: string, ...files: string[]) {
  startGroup('Uploading artifact ' + artifactName)
  await create().uploadArtifact(artifactName, files, '.')
  endGroup()
}

export async function downloadArtifact(artifactName: string) {
  startGroup('Downloading artifact ' + artifactName)
  await create().downloadArtifact(artifactName, '.', {
    createArtifactFolder: true,
  })
  endGroup()
}

export async function postCommentIfInPr(message: string): Promise<string | undefined> {
  if (context.payload.pull_request) {
    // Hashes followed by numbers are treated as references to a PR in GitHub, which
    // changes how they are formatted. We do not want this.
    // The regex below captures something like #12345 with whitespace either side
    // (which is what GitHub would consider a PR), and adds &#8203; between the hash
    // and the number. This is a zero-width space, which won't change what the message
    // looks like but will ensure GitHub doesn't treat this as a PR.
    const escapedMessage = message.replaceAll(/(\s)#([0-9]+\s)/g, '$1#&#8203;$2')
    const commentUrl = (
      await getOctokit(getInput('token')).rest.issues.createComment({
        ...context.repo,
        issue_number: context.payload.pull_request.number,
        body: escapedMessage,
      })
    ).data.html_url
    return commentUrl
  }
  return undefined
}

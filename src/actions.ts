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
    const commentUrl = (
      await getOctokit(getInput('token')).rest.issues.createComment({
        ...context.repo,
        issue_number: context.payload.pull_request.number,
        body: message,
      })
    ).data.html_url
    return commentUrl
  }
  return undefined
}

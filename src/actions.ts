import { create } from '@actions/artifact'
import { startGroup, endGroup, getInput } from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { Md5 } from 'ts-md5'

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
    const stepHash = getStepHash()
    const foundComment = await findExistingComment(stepHash)
    const escapedMessage = message.replaceAll(/(\s)#([0-9]+\s)/g, '$1#&#8203;$2')
    if (foundComment === undefined) {
      return (
        await getOctokit(getInput('token')).rest.issues.createComment({
          ...context.repo,
          issue_number: context.payload.pull_request.number,
          body: appendHash(escapedMessage, stepHash),
        })
      ).data.html_url
    } else {
      await getOctokit(getInput('token')).rest.issues.updateComment({
        ...context.repo,
        comment_id: foundComment,
        body: appendHash(escapedMessage, stepHash),
      })
    }
  }
  return undefined
}

export async function resolveExistingCommentIfFound() {
  const stepHash = getStepHash()
  const foundComment = await findExistingComment(stepHash)
  if (foundComment !== undefined) {
    const body = 'All issues previously detected by Lacework Code Analysis have been resolved!'
    await getOctokit(getInput('token')).rest.issues.updateComment({
      ...context.repo,
      comment_id: foundComment,
      body: appendHash(body, stepHash),
    })
  }
}

/**
 * This function is used to uniquely identify our comment and distinguish it from
 * any other comments. We do this by computing an MD5 hash of:
 * - A constant of lacework-code-analysis to distinguish ourselves on the off-chance
 *   another Action has implemented this exact logic.
 * - The name of the workflow, so if there are two workflows running this step then
 *   we will distinguish them.
 * - The name of our step, which GitHub will append an _2 to if it appears multiple
 *   times in the same workflow, so we distinguish multiple instances in the same
 *   workflow.
 */
function getStepHash(): string {
  const md5 = new Md5()
  md5.appendStr('lacework-code-analysis')
  md5.appendStr(context.workflow)
  md5.appendStr(context.action)
  const result = md5.end()
  if (result === undefined) {
    throw new Error('Failed to produce a hash for our workflow step!')
  }
  return result.toString()
}

async function findExistingComment(stepHash: string): Promise<number | undefined> {
  if (context.payload.pull_request?.number) {
    let page = 1
    // Limit ourselves to 5 pages of comments to avoid hitting API rate limits.
    // Our comment should be near the top anyways.
    while (page <= 5) {
      const comments = (
        await getOctokit(getInput('token')).rest.issues.listComments({
          ...context.repo,
          issue_number: context.payload.pull_request?.number,
          per_page: 100,
          page,
        })
      ).data
      for (const comment of comments) {
        if (comment.body?.indexOf(stepHash) !== -1) {
          return comment.id
        }
      }
      if (comments.length !== 100) {
        return undefined
      }
      page += 1
    }
  }
  return undefined
}

function appendHash(comment: string, hash: string): string {
  return `${comment}\n\n<!--- lacework-code-analysis: ${hash} --->\n`
}

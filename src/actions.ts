import { create } from '@actions/artifact'
import { startGroup, endGroup, getInput, info } from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { retry } from '@octokit/plugin-retry'
import { Md5 } from 'ts-md5'
import { VulnerabilityEntry, calculatePosition, generateCombinedReviewBody } from './util'

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
    const messageWithHash = appendHash(escapedMessage, stepHash)

    if (foundComment === undefined) {
      return (
        await getIssuesApi().createComment({
          ...context.repo,
          issue_number: context.payload.pull_request.number,
          body: messageWithHash,
        })
      ).data.html_url
    } else {
      await getIssuesApi().updateComment({
        ...context.repo,
        comment_id: foundComment,
        body: messageWithHash,
      })
    }
  }
  return undefined
}

export async function resolveExistingCommentIfFound() {
  const stepHash = getStepHash()
  const foundComment = await findExistingComment(stepHash)
  if (foundComment !== undefined) {
    const body = 'All issues previously detected by Lacework Code Security have been resolved!'
    await getIssuesApi().updateComment({
      ...context.repo,
      comment_id: foundComment,
      body: appendHash(body, stepHash),
    })
  }
}

/**
 * This function is used to uniquely identify our comment and distinguish it from
 * any other comments. We do this by computing an MD5 hash of:
 * - A constant of lacework-code-security to distinguish ourselves on the off-chance
 *   another Action has implemented this exact logic.
 * - The name of the workflow, so if there are two workflows running this step then
 *   we will distinguish them.
 * - The name of our step, which GitHub will append an _2 to if it appears multiple
 *   times in the same workflow, so we distinguish multiple instances in the same
 *   workflow.
 */
function getStepHash(): string {
  const md5 = new Md5()
  md5.appendStr('lacework-code-security')
  md5.appendStr(context.workflow)
  md5.appendStr(context.action)
  const result = md5.end()
  if (result === undefined) {
    // Shouldn't actually happen, but check is needed to satisfy the compiler.
    throw new Error('Failed to produce a hash for our workflow step!')
  }
  return result.toString()
}

async function findExistingComment(stepHash: string): Promise<number | undefined> {
  if (context.payload.pull_request?.number) {
    // Limit ourselves to 5 pages of comments to avoid hitting API rate limits.
    // Our comment should be near the top anyways.
    for (let page = 1; page <= 5; page++) {
      const pageSize = 100
      const comments = (
        await getIssuesApi().listComments({
          ...context.repo,
          issue_number: context.payload.pull_request?.number,
          per_page: pageSize,
          page,
        })
      ).data
      for (const comment of comments) {
        if (comment.body?.indexOf(stepHash) !== -1) {
          return comment.id
        }
      }
      if (comments.length !== pageSize) {
        // We saw a partially empty page, so we know there are no more comments
        return undefined
      }
    }
  }
  return undefined
}

// Function that looks if a review comment exists already.
async function findExistingReviewComment(stepHash: string): Promise<any | undefined> {
  const { owner, repo } = context.repo
  const pullNumber = context.payload.pull_request?.number

  if (!pullNumber) return undefined

  // List comments on the pull request
  const { data: comments } = await getPrApi().listReviewComments({
    owner,
    repo,
    pull_number: pullNumber,
  })

  // Find the comment matching the unique stepHash in the body.
  return comments.find((comment) => comment.body?.includes(stepHash))
}

// This function will take in a VulnerabilityEntry and create or update a review comment on the PR.
export async function postReviewComment(
  groupedVulnerabilities: { CVE: VulnerabilityEntry[]; CWE: VulnerabilityEntry[] },
  filePath: string,
  line: number
) {
  if (context.payload.pull_request) {
    // Post a review comment to the PR.
    try {
      // Extract necessary data from context
      const { owner, repo } = context.repo
      const pullNumber = context.payload.pull_request.number
      const commitId = context.payload.pull_request.head.sha

      if (!pullNumber || !commitId) {
        throw new Error('Pull request number or commit SHA is missing from the context.')
      }

      const stepHash = `<!-- Vulnerabilities: ${filePath}-${line} -->` // Unique comment identifier

      // Fetch the PR and look for for the diff incorporating the current entry's file.
      const files = await getPrApi().listFiles({
        ...context.repo,
        pull_number: context.payload.pull_request.number,
      })

      const file = files.data.find((f) => f.filename === filePath)

      if (!file || !file.patch) {
        throw new Error(`Patch not found for file: ${filePath}`)
      }

      // Calculate position in the diff
      const position = calculatePosition(file.patch, line)
      if (!position) {
        info('Could not find an appropriate position in the diff. Skipping review comment.')
        return
      }

      // Check for an existing comment
      const foundComment = await findExistingReviewComment(stepHash)

      // Comment body
      const commentBody = generateCombinedReviewBody(
        groupedVulnerabilities,
        filePath,
        line,
        stepHash
      )

      if (foundComment) {
        info('Found existing review comment.')
        // Update the existing comment
        await getPrApi().updateReviewComment({
          owner,
          repo,
          comment_id: foundComment.id,
          body: commentBody,
        })
        info(`Updated comment for ${filePath}:${line}`)
      } else {
        info('Trying to create new review comment.')
        // Create a new review comment
        await getPrApi().createReviewComment({
          owner,
          repo,
          pull_number: pullNumber,
          commit_id: commitId,
          path: filePath,
          position: position, // Will need position mapping later
          body: commentBody,
        })
        info(`Created comment for ${filePath}:${line}`)
      }
    } catch (error) {
      info(`Failed to post or update comment for ${filePath}:${line}:` + error)
    }
  }
}

function makeOctokit() {
  return getOctokit(
    getInput('token'),
    {
      request: {
        timeout: 30_000,
      },
    },
    retry
  )
}

export function getIssuesApi() {
  return makeOctokit().rest.issues
}

export function getActionsApi() {
  return makeOctokit().rest.actions
}

export function getOrgsApi() {
  return makeOctokit().rest.orgs
}

export function getUsersApi() {
  return makeOctokit().rest.users
}

export function getPrApi() {
  return makeOctokit().rest.pulls
}

function appendHash(comment: string, hash: string): string {
  return `${comment}\n\n<!--- lacework-code-analysis: ${hash} --->\n`
}

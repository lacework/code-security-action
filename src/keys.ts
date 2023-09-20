import { Md5 } from 'ts-md5'
import { restoreCache, saveCache } from '@actions/cache'
import { getRequiredEnvVariable, telemetryCollector } from './util'
import { getOrgsApi, getUsersApi } from './actions'
import { mkdirSync, writeFileSync, readdirSync } from 'fs'
import { info, warning } from '@actions/core'

export const trustedKeys = 'laceworkTrustedKeys'

export async function downloadKeys(): Promise<void> {
  const keyDownloadStart = Date.now()
  try {
    mkdirSync(trustedKeys)
    const cacheKey = getCacheKey()
    const cacheResult = await restoreCache([trustedKeys], cacheKey)
    if (cacheResult !== undefined) {
      return
    }
    const users = await getOrgMembers()
    info(`Downloading trusted keys for ${users.length} users: ${users.join(', ')}`)
    await Promise.all(users.map(downloadKeysForUser))
    await saveCache([trustedKeys], cacheKey)
    const downloaded = readdirSync(trustedKeys)
    info(`Successfully downloaded ${downloaded.length} trusted keys: ${downloaded.join(', ')}`)
  } catch (e) {
    telemetryCollector.addError('key-download-error', e)
    info(`Failed to download trusted keys: ${e}`)
  } finally {
    telemetryCollector.addField('duration.key-download', (Date.now() - keyDownloadStart).toString())
  }
}

function getCacheKey(): string {
  const md5 = new Md5()
  md5.appendStr('lacework-code-security-keys')
  md5.appendStr(new Date().toISOString().slice(0, 10))
  const result = md5.end()
  if (result === undefined) {
    // Shouldn't actually happen, but check is needed to satisfy the compiler.
    throw new Error('Failed to produce a hash for keys!')
  }
  return 'lacework-' + result.toString().substring(0, 8)
}

async function downloadKeysForUser(user: string) {
  let page = 1
  while (true) {
    const result = await getUsersApi().listGpgKeysForUser({
      username: user,
      per_page: 100,
      page,
    })
    for (const key of result.data) {
      if (key.raw_key !== null && key.can_sign && !key.revoked && !isExpired(key.expires_at)) {
        writeFileSync(`${trustedKeys}/${key.key_id}.pub`, key.raw_key)
      }
    }
    if (result.data.length < 100) {
      break
    }
    page += 1
  }
}

async function getOrgMembers() {
  let page = 1
  let members: string[] = []
  while (true) {
    const result = await getOrgsApi().listMembers({
      org: getRequiredEnvVariable('GITHUB_REPOSITORY_OWNER'),
      per_page: 100,
      page,
    })
    members = members.concat(result.data.map((x) => x.login))
    if (result.data.length < 100) {
      break
    }
    page += 1
  }
  return members
}

function isExpired(expiry: string | null) {
  if (expiry === null) {
    return false
  }
  return Date.parse(expiry) < Date.now()
}

import * as cache from '@actions/cache'
import { info, warning } from '@actions/core'
import { existsSync } from 'fs'

const CACHE_KEY = `lacework-scan-${process.env.GITHUB_BASE_REF || 'main'}`

export async function restoreCachedScan(): Promise<boolean> {
  if (process.env.LACEWORK_DISABLE_CACHE === 'true') return false

  try {
    const restoredKey = await cache.restoreCache(['scan-results'], CACHE_KEY)

    if (restoredKey) {
      // Verify we have the expected files
      const hasScaSarif = existsSync('scan-results/sca/sca.sarif')
      const hasScaJson = existsSync('scan-results/sca/sca.json')

      if (hasScaSarif && hasScaJson) {
        info('Successfully restored cached scan results')
        return true
      }
    }
  } catch (e) {
    warning(`Cache restore failed: ${e}`)
  }
  return false
}

export async function saveCachedScan(): Promise<void> {
  if (process.env.LACEWORK_DISABLE_CACHE === 'true') return

  try {
    // Verify we have results to save
    if (existsSync('scan-results/sca/sca.sarif') && existsSync('scan-results/sca/sca.json')) {
      await cache.saveCache(['scan-results'], CACHE_KEY)
      info('Successfully saved scan results to cache')
    } else {
      warning('No scan results found to cache')
    }
  } catch (e) {
    warning(`Cache save failed: ${e}`)
  }
}

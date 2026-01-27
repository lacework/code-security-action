import * as cache from '@actions/cache'
import { info, warning } from '@actions/core'
import { existsSync } from 'fs'

const CACHE_KEY = `lacework-scan-${process.env.GITHUB_BASE_REF || 'main'}`

export async function restoreCachedScan(): Promise<boolean> {
  if (process.env.LACEWORK_DISABLE_CACHE === 'true') {
    info('Cache disabled via LACEWORK_DISABLE_CACHE')
    return false
  }

  info(`Attempting cache restore with key: ${CACHE_KEY}`)
  info(`Base ref: ${process.env.GITHUB_BASE_REF || 'not set'}`)
  info(`Current ref: ${process.env.GITHUB_REF || 'not set'}`)

  try {
    const restoredKey = await cache.restoreCache(['scan-results'], CACHE_KEY)
    info(`Cache restore response: ${restoredKey || 'null'}`)

    if (restoredKey) {
      // Verify we have the expected files
      const hasScaSarif = existsSync('scan-results/sca/sca.sarif')
      const hasScaJson = existsSync('scan-results/sca/sca.json')

      info(`Files after restore - SARIF: ${hasScaSarif}, JSON: ${hasScaJson}`)

      if (hasScaSarif && hasScaJson) {
        info('Successfully restored cached scan results')
        return true
      } else {
        warning('Cache restored but files missing')
      }
    } else {
      info('No cache found for key: ' + CACHE_KEY)
    }
  } catch (e) {
    warning(`Cache restore failed: ${e}`)
    if (e instanceof Error) {
      info(`Error details: ${e.message}`)
      info(`Error stack: ${e.stack}`)
    }
  }
  return false
}

export async function saveCachedScan(): Promise<void> {
  if (process.env.LACEWORK_DISABLE_CACHE === 'true') {
    info('Cache save skipped - disabled via LACEWORK_DISABLE_CACHE')
    return
  }

  info(`Attempting cache save with key: ${CACHE_KEY}`)

  try {
    // Verify we have results to save
    const hasScaSarif = existsSync('scan-results/sca/sca.sarif')
    const hasScaJson = existsSync('scan-results/sca/sca.json')

    info(`Files before save - SARIF: ${hasScaSarif}, JSON: ${hasScaJson}`)

    if (hasScaSarif && hasScaJson) {
      info(`Saving cache with key: ${CACHE_KEY}`)
      await cache.saveCache(['scan-results'], CACHE_KEY)
      info('Successfully saved scan results to cache')
    } else {
      warning('No scan results found to cache')
    }
  } catch (e) {
    warning(`Cache save failed: ${e}`)
    if (e instanceof Error) {
      info(`Error details: ${e.message}`)
    }
  }
}

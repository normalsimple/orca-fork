import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const netFetch = vi.hoisted(() => vi.fn())
const netRequest = vi.hoisted(() => vi.fn())
const resolveReleaseApiToken = vi.hoisted(() => vi.fn(() => Promise.resolve(null)))

vi.mock('electron', () => ({
  net: { fetch: netFetch, request: netRequest }
}))

vi.mock('../main/updater/releases/updater-release-api-token', () => ({
  resolveReleaseApiToken,
  rejectReleaseApiToken: () => undefined
}))

vi.mock('../main/git/gh-rate-limit-breaker', () => ({
  getGhRateLimitBlockedUntilMs: () => null,
  recordGhPrimaryRateLimit: () => undefined
}))

import { AgentStateRulesLiveUpdater } from '../main/runtime/agent-state-rules/agent-state-rules-live-update'
import { fetchChangelog } from '../main/updater/releases/updater-changelog'
import { fetchNudge } from '../main/updater/nudges/nudge-campaign'
import { fetchNewerReleaseTagsWithReadiness } from '../main/updater/releases/updater-prerelease-feed'
import { listReleaseBuilds, resolveTargetBuild } from '../main/updater/releases/updater-release-builds'
import { FORK_UPSTREAM_RELEASE_BLOCKED, registerForkBuild } from '../shared/fork-hooks/update-feed'
import { getReleaseNotesUrlForVersion } from '../shared/release-channel'

async function agentRulesFetches(): Promise<ReturnType<typeof vi.fn>> {
  const userDataPath = mkdtempSync(join(tmpdir(), 'fork-agent-rules-'))
  const fetch = vi.fn()
  const updater = new AgentStateRulesLiveUpdater({
    userDataPath,
    appVersion: '1.4.228',
    isPackaged: true,
    fetch,
    readSettings: () => ({ agentStateRulesLiveUpdates: true }) as never,
    onActivated: () => undefined
  })
  try {
    await updater.start()
    await updater.refresh()
  } finally {
    updater.stop()
    rmSync(userDataPath, { recursive: true, force: true })
  }
  return fetch
}

describe('fork builds never read upstream releases or onorca.dev', () => {
  afterEach(() => {
    registerForkBuild(false)
    netFetch.mockReset()
    netRequest.mockReset()
    resolveReleaseApiToken.mockClear()
  })

  it('keeps the upstream behaviour until a fork build registers', async () => {
    expect(getReleaseNotesUrlForVersion('1.4.228')).toContain('github.com/stablyai/orca')
    netFetch.mockResolvedValue(new Response('[]', { status: 200 }))
    await fetchChangelog('1.4.229', '1.4.228')
    expect(String(netFetch.mock.calls[0]?.[0])).toContain('onorca.dev')
    const upstreamRules = await agentRulesFetches()
    expect(String(upstreamRules.mock.calls[0]?.[0])).toMatch(
      /^https:\/\/github\.com\/stablyai\/orca\/releases\/download\/agent-state-rules-engine-/
    )
  })

  {
    it('blocks every upstream read once a fork build registers', async () => {
      registerForkBuild()
      const feed = await fetchNewerReleaseTagsWithReadiness('1.4.228-local.1.aaa', 2)
      await expect(listReleaseBuilds('stable')).resolves.toEqual([])
      await expect(listReleaseBuilds('hourly')).resolves.toEqual([])
      await expect(listReleaseBuilds('daily')).resolves.toEqual([])
      await expect(listReleaseBuilds('adhoc')).resolves.toEqual([])
      expect(() => resolveTargetBuild('rc', 'v1.4.228')).toThrow(FORK_UPSTREAM_RELEASE_BLOCKED)
      const notes = [
        getReleaseNotesUrlForVersion('1.4.228'),
        getReleaseNotesUrlForVersion('1.4.160-hourly.202607281400'),
        getReleaseNotesUrlForVersion('1.4.160-daily.202607281300'),
        getReleaseNotesUrlForVersion(null)
      ]
      for (const url of notes) {
        expect(url).not.toContain('stablyai')
        expect(url).toContain('github.com/quzard/orca-fork')
      }
      expect(feed).toEqual({ tags: [], state: 'no-newer' })
      await expect(fetchChangelog('1.4.229', '1.4.228')).resolves.toBeNull()
      await expect(fetchNudge()).resolves.toBeNull()
      expect(await agentRulesFetches()).not.toHaveBeenCalled()
      expect(netFetch).not.toHaveBeenCalled()
      expect(netRequest).not.toHaveBeenCalled()
      expect(resolveReleaseApiToken).not.toHaveBeenCalled()
    })
  }
})

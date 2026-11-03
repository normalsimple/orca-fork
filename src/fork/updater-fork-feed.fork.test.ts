import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUpdaterModule, warmUpdaterModule } from '../main/updater/testing/updater-test-module-loader'

const {
  appMock,
  autoUpdaterMock,
  fetchChangelogMock,
  fetchNewerReleaseTagsMock,
  moduleFactories,
  resetUpdaterMocks
} = await vi.hoisted(async () =>
  (await import('../main/updater/testing/updater-test-harness')).createUpdaterMocks()
)

vi.mock('electron', () => moduleFactories.electron())
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('../main/updater/electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('../main/ipc/pty/kill-all', () => moduleFactories.ptyKillAll())
vi.mock('../main/updater/linux-package/linux-update-package-type', () => moduleFactories.linuxUpdatePackageType())
vi.mock('../main/updater/updater-lifecycle-diagnostics', () =>
  moduleFactories.updaterLifecycleDiagnostics()
)
vi.mock('../main/updater/releases/updater-changelog', () => moduleFactories.updaterChangelog())
vi.mock('../main/updater/nudges/nudge-campaign', () => moduleFactories.updaterNudge())
vi.mock('../main/updater/update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('../main/updater/releases/updater-prerelease-feed', () => moduleFactories.updaterPrereleaseFeed())
vi.mock('../main/local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('../main/local-builds/local-build-feed-server', () =>
  moduleFactories.localBuildFeedServer()
)

warmUpdaterModule()

const UPSTREAM_RELEASE_URL = /stablyai|onorca/i

function feedUrls(): string[] {
  return autoUpdaterMock.setFeedURL.mock.calls.map((call: unknown[]) => JSON.stringify(call[0]))
}

async function loadForkUpdater() {
  const updater = await loadUpdaterModule()
  // resetUpdaterMocks 会 resetModules，钩子要从同一份模块图里登记。
  const hook = await import('../shared/fork-hooks/update-feed')
  hook.registerForkBuild()
  return updater
}

describe('fork desktop updater never pins a stablyai release feed', () => {
  beforeEach(() => {
    resetUpdaterMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('setup and a menu check pin only the anonymous quzard/orca-fork feed', async () => {
    appMock.getVersion.mockReturnValue('1.4.228-local.1792251680994.aaaaaaaaaaaa')
    autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await loadForkUpdater()
    // A check that just ran keeps setup from starting a background check, so only the menu checks.
    const lastCheckAt = Date.UTC(2026, 10, 1)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(lastCheckAt)

    setupAutoUpdater(
      {
        isDestroyed: () => false,
        webContents: { send: vi.fn(), isDestroyed: () => false }
      } as never,
      {
        getLastUpdateCheckAt: () => lastCheckAt
      }
    )
    expect(feedUrls().some((url) => UPSTREAM_RELEASE_URL.test(url))).toBe(false)

    checkForUpdatesFromMenu()
    await vi.waitFor(() => {
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    })
    expect(autoUpdaterMock.setFeedURL).toHaveBeenLastCalledWith({
      provider: 'github',
      owner: 'quzard',
      repo: 'orca-fork',
      private: false
    })
    expect(feedUrls().some((url) => UPSTREAM_RELEASE_URL.test(url))).toBe(false)
    expect(feedUrls().join('\n')).not.toMatch(/token/i)
    expect(fetchNewerReleaseTagsMock).not.toHaveBeenCalled()
    expect(fetchChangelogMock.mock.calls.length).toBeLessThanOrEqual(1)
  })
})

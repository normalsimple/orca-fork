import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../../shared/update-status-types'
import type { registerAutoUpdaterHandlers } from '../../main/updater/updater-events'
import { beginMacUpdateDownload } from '../../main/updater/mac-install/updater-mac-install'

const nativeAutoUpdater = vi.hoisted(() => {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
  return {
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
      return this
    },
    emit(event: string, ...args: unknown[]) {
      const list = handlers.get(event) ?? []
      for (const handler of list) {
        handler(...args)
      }
    },
    removeAllListeners(): void {
      handlers.clear()
    }
  }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '1.0.0',
    on: vi.fn(),
    prependListener: vi.fn(),
    quit: vi.fn()
  },
  autoUpdater: nativeAutoUpdater
}))

vi.mock('../../main/updater/linux-package/linux-update-package-type', () => ({
  getLinuxPackageType: () => 'non-root',
  getLinuxRootPackageType: () => null,
  isExternallyManagedLinuxInstall: () => false
}))

vi.mock('../../main/cli/appimage-copy-pre-extraction', () => ({
  preExtractDownloadedAppImageUpdate: vi.fn(async () => false)
}))

vi.mock('../../main/updater/releases/updater-changelog', () => ({
  fetchChangelog: vi.fn(async () => null)
}))

vi.mock('../../main/updater/updater-lifecycle-diagnostics', () => ({
  recordUpdaterLifecycle: vi.fn()
}))
import { registerForkBuild } from '../../shared/fork-hooks/update-feed'
import {
  FORK_BACKGROUND_CHECK_FAILURE_LOG,
  FORK_BACKGROUND_DOWNLOAD_FAILURE_LOG,
  FORK_STAGING_FAILURE_LOG,
  armForkBackgroundDownload,
  consumeForkBackgroundDownloadFailure,
  forkInstallsOnQuit,
  forkStagedUpdateVersion,
  forkStagingUpdateVersion,
  failForkStaging,
  noteForkUpdateDownloaded,
  planForkCheckFailure,
  planForkFoundUpdate,
  planForkMissingUpdate,
  registerForkInstallerReadyProbe,
  resetForkBackgroundDownloadState,
  shouldHoldForkUpdateCheck,
  shouldPreserveForkDownloadedContext
} from './fork-background-download'

const hostPlatform = process.platform

function usePlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

function useReadyFeed(): void {
  registerForkBuild()
}

afterEach(() => {
  registerForkBuild(false)
  resetForkBackgroundDownloadState()
  usePlatform(hostPlatform)
  nativeAutoUpdater.removeAllListeners()
  beginMacUpdateDownload()
})

describe('fork background download decisions', () => {
  // updater-setup ORs this onto upstream's interactive-Linux-non-root rule.
  it('adds install-on-quit only for an interactive fork session off Linux', () => {
    expect(forkInstallsOnQuit('interactive', 'darwin')).toBe(false)
    useReadyFeed()
    expect(forkInstallsOnQuit('interactive', 'darwin')).toBe(true)
    expect(forkInstallsOnQuit('interactive', 'win32')).toBe(true)
    expect(forkInstallsOnQuit('interactive', 'linux')).toBe(false)
    expect(forkInstallsOnQuit('supervised-headless-serve', 'darwin')).toBe(false)
  })

  it('downloads a new version once, then does not prompt again for that same version', () => {
    useReadyFeed()
    expect(
      planForkFoundUpdate({
        localOrPinned: false,
        version: '2.0.0',
        userInitiated: false,
        downloadingVersion: null
      })
    ).toBe('download')
    expect(
      planForkFoundUpdate({
        localOrPinned: false,
        version: '2.0.0',
        userInitiated: false,
        downloadingVersion: '2.0.0'
      })
    ).toBe('keep')
    expect(
      planForkFoundUpdate({
        localOrPinned: false,
        version: '3.0.0',
        userInitiated: false,
        downloadingVersion: '2.0.0'
      })
    ).toBe('keep')

    armForkBackgroundDownload('2.0.0')
    expect(
      planForkFoundUpdate({
        localOrPinned: false,
        version: '3.0.0',
        userInitiated: true,
        downloadingVersion: null
      })
    ).toBe('keep')
    expect(shouldPreserveForkDownloadedContext(false)).toBe(true)
    resetForkBackgroundDownloadState()
    useReadyFeed()

    noteForkUpdateDownloaded('2.0.0', false)
    expect(forkStagedUpdateVersion()).toBe('2.0.0')
    expect(
      shouldHoldForkUpdateCheck({
        userInitiated: false,
        status: 'downloaded',
        localOrPinned: false
      })
    ).toBe(true)
    expect(
      planForkFoundUpdate({
        localOrPinned: false,
        version: '2.0.0',
        userInitiated: false,
        downloadingVersion: null
      })
    ).toBe('keep')
    expect(planForkMissingUpdate(false)).toBe('keep')
    expect(planForkCheckFailure('downloaded', false)).toEqual({ kind: 'keep', version: '2.0.0' })

    expect(
      shouldHoldForkUpdateCheck({
        userInitiated: true,
        status: 'downloaded',
        localOrPinned: false
      })
    ).toBe(false)
    expect(shouldPreserveForkDownloadedContext(false)).toBe(true)
    expect(
      planForkFoundUpdate({
        localOrPinned: false,
        version: '2.0.0',
        userInitiated: true,
        downloadingVersion: null
      })
    ).toBe('restart')
    expect(planForkMissingUpdate(true)).toBe('restart')
    expect(planForkCheckFailure('checking', true)).toEqual({ kind: 'restart', version: '2.0.0' })

    expect(
      planForkFoundUpdate({
        localOrPinned: false,
        version: '3.0.0',
        userInitiated: false,
        downloadingVersion: null
      })
    ).toBe('download')
  })

  it('does not change update offers when the build is not a fork build', () => {
    expect(
      planForkFoundUpdate({
        localOrPinned: false,
        version: '2.0.0',
        userInitiated: false,
        downloadingVersion: null
      })
    ).toBe('passthrough')
    expect(planForkMissingUpdate(false)).toBe('passthrough')
    expect(
      shouldHoldForkUpdateCheck({
        userInitiated: false,
        status: 'downloaded',
        localOrPinned: false
      })
    ).toBe(false)
    expect(shouldPreserveForkDownloadedContext(false)).toBe(false)
    expect(planForkCheckFailure('downloaded', false)).toEqual({ kind: 'none' })

    useReadyFeed()
    expect(
      planForkFoundUpdate({
        localOrPinned: true,
        version: '2.0.0',
        userInitiated: false,
        downloadingVersion: null
      })
    ).toBe('passthrough')
  })

  it('does not swallow local-build or pinned-version check errors', () => {
    useReadyFeed()
    noteForkUpdateDownloaded('2.0.0', false)
    expect(planForkCheckFailure('checking', true, { localBuild: true })).toEqual({ kind: 'none' })
    expect(planForkCheckFailure('downloaded', false, { pinned: true })).toEqual({ kind: 'none' })
    expect(planForkCheckFailure('error', true, { localBuild: true, pinned: true })).toEqual({
      kind: 'none'
    })
    expect(planForkCheckFailure('checking', true)).toEqual({ kind: 'restart', version: '2.0.0' })
  })

  it('logs a fixed download-failure line and falls back to the manual offer', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    armForkBackgroundDownload('2.0.0')
    expect(consumeForkBackgroundDownloadFailure('2.0.0')).toEqual({
      state: 'available',
      version: '2.0.0',
      changelog: null
    })
    expect(consumeForkBackgroundDownloadFailure('2.0.0')).toBeNull()
    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(FORK_BACKGROUND_DOWNLOAD_FAILURE_LOG)
    expect(FORK_BACKGROUND_DOWNLOAD_FAILURE_LOG).not.toMatch(/authorization|token/i)
    expect(FORK_BACKGROUND_CHECK_FAILURE_LOG).not.toMatch(/authorization|token/i)
    info.mockRestore()
  })

  it('does not offer a restart while the installer is still staging', () => {
    useReadyFeed()
    let ready = false
    registerForkInstallerReadyProbe(() => ready)
    noteForkUpdateDownloaded('2.0.0', false)
    expect(forkStagedUpdateVersion()).toBeNull()
    expect(forkStagingUpdateVersion()).toBe('2.0.0')
    const found = (userInitiated: boolean, version = '2.0.0') =>
      planForkFoundUpdate({
        localOrPinned: false,
        version,
        userInitiated,
        downloadingVersion: null
      })
    expect(found(false)).toBe('keep')
    expect(found(true)).toBe('staging')
    expect(found(true, '3.0.0')).toBe('staging')
    expect(planForkMissingUpdate(false)).toBe('keep')
    expect(planForkMissingUpdate(true)).toBe('staging')
    expect(planForkCheckFailure('downloading', false)).toEqual({ kind: 'keep', version: '2.0.0' })
    expect(planForkCheckFailure('checking', true)).toEqual({ kind: 'staging', version: '2.0.0' })
    expect(
      shouldHoldForkUpdateCheck({ userInitiated: false, status: 'idle', localOrPinned: false })
    ).toBe(true)

    ready = true
    expect(forkStagedUpdateVersion()).toBe('2.0.0')
    expect(forkStagingUpdateVersion()).toBeNull()
    expect(found(true)).toBe('restart')
    expect(planForkMissingUpdate(true)).toBe('restart')
    expect(planForkCheckFailure('checking', true)).toEqual({ kind: 'restart', version: '2.0.0' })
  })

  it('drops the staging version when staging fails, so the next check downloads again', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    useReadyFeed()
    registerForkInstallerReadyProbe(() => false)
    noteForkUpdateDownloaded('2.0.0', false)
    expect(failForkStaging()).toBe(true)
    expect(failForkStaging()).toBe(false)
    expect(warn).toHaveBeenCalledExactlyOnceWith(FORK_STAGING_FAILURE_LOG)
    expect(forkStagingUpdateVersion()).toBeNull()
    expect(forkStagedUpdateVersion()).toBeNull()
    expect(
      shouldHoldForkUpdateCheck({ userInitiated: false, status: 'error', localOrPinned: false })
    ).toBe(false)
    expect(
      planForkFoundUpdate({
        localOrPinned: false,
        version: '2.0.0',
        userInitiated: false,
        downloadingVersion: null
      })
    ).toBe('download')
    warn.mockRestore()
  })

  it('does not treat a failure as staging once the installer is ready', () => {
    useReadyFeed()
    noteForkUpdateDownloaded('2.0.0', false)
    expect(failForkStaging()).toBe(false)
    expect(forkStagedUpdateVersion()).toBe('2.0.0')
  })
})

type HandlerContext = Parameters<typeof registerAutoUpdaterHandlers>[0]

function testAutoUpdater(): {
  autoUpdater: HandlerContext['autoUpdater']
  emit: (event: string, ...args: unknown[]) => void
} {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
  const autoUpdater = {
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
      return autoUpdater
    }
  }
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: tests only emit the updater events registered below; other ElectronAutoUpdater methods are unused.
    autoUpdater: autoUpdater as HandlerContext['autoUpdater'],
    emit(event, ...args) {
      for (const handler of handlers.get(event) ?? []) {
        handler(...args)
      }
    }
  }
}

describe('fork updater handler wiring', () => {
  async function wireHandlers(options: { deferredStaging?: boolean } = {}): Promise<{
    emit: (event: string, ...args: unknown[]) => void
    sent: UpdateStatus[]
    sendStatus: ReturnType<typeof vi.fn>
    beginForkBackgroundDownload: ReturnType<typeof vi.fn>
    finishActiveUpdateCheckAttempt: ReturnType<typeof vi.fn>
    sendErrorStatus: ReturnType<typeof vi.fn>
    setStatus: (next: UpdateStatus) => void
    setUserInitiated: (value: boolean) => void
  }> {
    let status: UpdateStatus = { state: 'idle' }
    let userInitiated = false
    const sent: UpdateStatus[] = []
    const sendStatus = vi.fn((next: UpdateStatus) => {
      status = next
      sent.push(next)
    })
    const beginForkBackgroundDownload = vi.fn()
    const finishActiveUpdateCheckAttempt = vi.fn()
    const sendErrorStatus = vi.fn()
    const { autoUpdater, emit } = testAutoUpdater()
    const context: HandlerContext = {
      autoUpdater,
      clearBackgroundCheckLaunchPending: vi.fn(),
      clearAvailableUpdateContext: vi.fn(),
      consumeMissingManifestPrereleaseFallbackResult: vi.fn(() => null),
      getPublishingWindowLastGoodCheck: vi.fn(() => null),
      getMissingManifestPrereleaseFallbackUserInitiated: vi.fn(() => null),
      getCurrentStatus: () => status,
      getActiveUpdateCheckEventAttemptId: vi.fn(() => 1),
      getKnownReleaseUrl: vi.fn(() => undefined),
      getPendingInstallVersion: () => (status.state === 'downloading' ? status.version : '2.0.0'),
      getUserInitiatedCheck: () => userInitiated,
      handleQuitAndInstallFailure: vi.fn(() => false),
      isQuitAndInstallHandoffActive: vi.fn(() => false),
      hasInstallableDownloadedVersion: vi.fn(() => true),
      isLocalBuildCheck: vi.fn(() => false),
      isPinnedBuildCheck: vi.fn(() => false),
      shouldHandleUpdaterErrorEvent: vi.fn(() => true),
      clearUpdateAvailableEventPending: vi.fn(),
      isActiveUpdateCheckAttempt: vi.fn(() => true),
      markUpdateCheckEventAttempt: vi.fn(() => true),
      markUpdateAvailableEventPending: vi.fn(),
      markMissingManifestPrereleaseFallbackChecking: vi.fn(),
      performQuitAndInstall: vi.fn(),
      commitStagedMacInstall: vi.fn(),
      failMacStaging: vi.fn(),
      isAwaitingMacStaging: vi.fn(() => false),
      isMacStagingDeferredToInstall: vi.fn(() => options.deferredStaging ?? false),
      shouldDeferMacQuitForInstall: vi.fn(() => true),
      recordCompletedUpdateCheck: vi.fn(),
      restoreReleaseUpdateSource: vi.fn(),
      sendCheckFailureStatus: vi.fn(),
      sendErrorStatus,
      sendStatus,
      scheduleAutomaticUpdateCheck: vi.fn(),
      shouldSuppressMissingManifestPrereleaseFallbackEvent: vi.fn(() => false),
      suppressMissingManifestPrereleaseFallbackPromiseFailure: vi.fn(),
      setAvailableReleaseUrl: vi.fn(),
      setAvailableVersion: vi.fn(),
      setUserInitiatedCheck: vi.fn(),
      beginForkBackgroundDownload,
      finishActiveUpdateCheckAttempt
    }
    const { registerAutoUpdaterHandlers } = await import('../../main/updater/updater-events')
    registerAutoUpdaterHandlers(context)
    return {
      emit,
      sent,
      sendStatus,
      beginForkBackgroundDownload,
      finishActiveUpdateCheckAttempt,
      sendErrorStatus,
      setStatus: (next) => {
        status = next
      },
      setUserInitiated: (value) => {
        userInitiated = value
      }
    }
  }

  it('on linux, shows the restart card once when the download finishes', async () => {
    usePlatform('linux')
    useReadyFeed()
    const {
      emit,
      sent,
      sendStatus,
      beginForkBackgroundDownload,
      finishActiveUpdateCheckAttempt,
      setStatus,
      setUserInitiated
    } = await wireHandlers()

    emit('checking-for-update')
    emit('update-available', { version: '2.0.0' })
    expect(beginForkBackgroundDownload).toHaveBeenCalledExactlyOnceWith('2.0.0')
    expect(sent.some((item) => item.state === 'available')).toBe(false)
    expect(sent.some((item) => item.state === 'checking')).toBe(true)

    setStatus({ state: 'downloading', percent: 40, version: '2.0.0' })
    emit('update-downloaded', { version: '2.0.0', downloadedFile: '/tmp/Orca.zip' })
    expect(sent.at(-1)).toMatchObject({ state: 'downloaded', version: '2.0.0' })
    expect(forkStagedUpdateVersion()).toBe('2.0.0')

    sendStatus.mockClear()
    beginForkBackgroundDownload.mockClear()
    setStatus({ state: 'downloaded', version: '2.0.0' })
    emit('checking-for-update')
    emit('update-available', { version: '2.0.0' })
    expect(sendStatus).not.toHaveBeenCalled()
    expect(beginForkBackgroundDownload).not.toHaveBeenCalled()
    expect(finishActiveUpdateCheckAttempt).toHaveBeenCalled()

    setUserInitiated(true)
    sendStatus.mockClear()
    emit('checking-for-update')
    emit('update-available', { version: '2.0.0' })
    expect(sent.map((item) => item.state)).toEqual([
      'checking',
      'downloaded',
      'checking',
      'downloaded'
    ])
    expect(beginForkBackgroundDownload).not.toHaveBeenCalled()

    setUserInitiated(false)
    setStatus({ state: 'downloaded', version: '2.0.0' })
    beginForkBackgroundDownload.mockClear()
    emit('checking-for-update')
    emit('update-available', { version: '3.0.0' })
    expect(beginForkBackgroundDownload).toHaveBeenCalledExactlyOnceWith('3.0.0')
  })

  it('on darwin, shows the restart card once after Squirrel stages', async () => {
    usePlatform('darwin')
    useReadyFeed()
    beginMacUpdateDownload()
    const { emit, sent, sendStatus, beginForkBackgroundDownload, setStatus, setUserInitiated } =
      await wireHandlers()

    emit('checking-for-update')
    emit('update-available', { version: '2.0.0' })
    expect(beginForkBackgroundDownload).toHaveBeenCalledExactlyOnceWith('2.0.0')
    expect(sent.some((item) => item.state === 'available')).toBe(false)

    setStatus({ state: 'downloading', percent: 40, version: '2.0.0' })
    emit('update-downloaded', { version: '2.0.0', downloadedFile: '/tmp/Orca.zip' })
    expect(sent.at(-1)).toMatchObject({ state: 'downloading', percent: 100, version: '2.0.0' })
    expect(sent.some((item) => item.state === 'downloaded')).toBe(false)
    expect(forkStagedUpdateVersion()).toBeNull()
    expect(forkStagingUpdateVersion()).toBe('2.0.0')

    sendStatus.mockClear()
    beginForkBackgroundDownload.mockClear()
    emit('checking-for-update')
    emit('update-available', { version: '2.0.0' })
    expect(sendStatus).not.toHaveBeenCalled()
    expect(beginForkBackgroundDownload).not.toHaveBeenCalled()

    nativeAutoUpdater.emit('update-downloaded')
    expect(sent.filter((item) => item.state === 'downloaded')).toEqual([
      expect.objectContaining({ state: 'downloaded', version: '2.0.0' })
    ])

    sendStatus.mockClear()
    emit('checking-for-update')
    emit('update-available', { version: '2.0.0' })
    expect(sendStatus).not.toHaveBeenCalled()

    setUserInitiated(true)
    sendStatus.mockClear()
    emit('checking-for-update')
    emit('update-available', { version: '2.0.0' })
    expect(sent.slice(-2).map((item) => item.state)).toEqual(['checking', 'downloaded'])
    expect(sent.filter((item) => item.state === 'downloaded')).toHaveLength(2)
  })

  it('on darwin, a manual check while Squirrel stages shows 100% downloaded, not the restart card', async () => {
    usePlatform('darwin')
    useReadyFeed()
    beginMacUpdateDownload()
    const { emit, sent, setStatus, setUserInitiated } = await wireHandlers()

    emit('checking-for-update')
    emit('update-available', { version: '2.0.0' })
    setStatus({ state: 'downloading', percent: 40, version: '2.0.0' })
    emit('update-downloaded', { version: '2.0.0', downloadedFile: '/tmp/Orca.zip' })

    setUserInitiated(true)
    emit('checking-for-update')
    emit('update-available', { version: '2.0.0' })
    expect(sent.at(-1)).toEqual({ state: 'downloading', percent: 100, version: '2.0.0' })
    emit('checking-for-update')
    emit('update-not-available', { version: '1.0.0' })
    expect(sent.at(-1)).toEqual({ state: 'downloading', percent: 100, version: '2.0.0' })
    expect(sent.some((item) => item.state === 'downloaded')).toBe(false)

    nativeAutoUpdater.emit('update-downloaded')
    expect(sent.at(-1)).toMatchObject({ state: 'downloaded', version: '2.0.0' })
  })

  it('on darwin headless serve, staging deferred to install still offers the restart', async () => {
    usePlatform('darwin')
    useReadyFeed()
    beginMacUpdateDownload()
    const { emit, sent, setStatus, setUserInitiated } = await wireHandlers({
      deferredStaging: true
    })

    emit('checking-for-update')
    emit('update-available', { version: '2.0.0' })
    setStatus({ state: 'downloading', percent: 40, version: '2.0.0' })
    emit('update-downloaded', { version: '2.0.0', downloadedFile: '/tmp/Orca.zip' })
    expect(sent.at(-1)).toMatchObject({ state: 'downloaded', version: '2.0.0' })
    expect(forkStagingUpdateVersion()).toBeNull()
    expect(forkStagedUpdateVersion()).toBe('2.0.0')

    setUserInitiated(true)
    emit('checking-for-update')
    emit('update-available', { version: '2.0.0' })
    expect(sent.at(-1)).toMatchObject({ state: 'downloaded', version: '2.0.0' })
    expect(sent.some((item) => item.state === 'downloading' && item.percent === 100)).toBe(false)
  })

  it('on darwin, a staging error forwarded by MacUpdater becomes an error state, then retries', async () => {
    usePlatform('darwin')
    useReadyFeed()
    beginMacUpdateDownload()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { emit, sent, sendErrorStatus, beginForkBackgroundDownload, setStatus } =
      await wireHandlers()

    emit('checking-for-update')
    emit('update-available', { version: '2.0.0' })
    setStatus({ state: 'downloading', percent: 40, version: '2.0.0' })
    emit('update-downloaded', { version: '2.0.0', downloadedFile: '/tmp/Orca.zip' })
    expect(sent.at(-1)).toEqual({ state: 'downloading', percent: 100, version: '2.0.0' })

    emit('error', new Error('Could not locate update bundle'))
    expect(sendErrorStatus).toHaveBeenCalledExactlyOnceWith(
      'Could not locate update bundle',
      undefined
    )
    expect(forkStagingUpdateVersion()).toBeNull()
    nativeAutoUpdater.emit('error', new Error('Could not locate update bundle'))
    expect(sendErrorStatus).toHaveBeenCalledTimes(1)

    setStatus({ state: 'error', message: 'Could not locate update bundle' })
    beginForkBackgroundDownload.mockClear()
    emit('checking-for-update')
    emit('update-available', { version: '2.0.0' })
    expect(beginForkBackgroundDownload).toHaveBeenCalledExactlyOnceWith('2.0.0')
    warn.mockRestore()
  })

  it('on darwin, a native staging error during a manual check is not swallowed', async () => {
    usePlatform('darwin')
    useReadyFeed()
    beginMacUpdateDownload()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { emit, sent, sendErrorStatus, setStatus } = await wireHandlers()

    emit('checking-for-update')
    emit('update-available', { version: '2.0.0' })
    setStatus({ state: 'downloading', percent: 40, version: '2.0.0' })
    emit('update-downloaded', { version: '2.0.0', downloadedFile: '/tmp/Orca.zip' })
    setStatus({ state: 'checking', userInitiated: true })

    nativeAutoUpdater.emit('error', new Error('code signature mismatch'))
    expect(sendErrorStatus).toHaveBeenCalledExactlyOnceWith(
      'macOS could not stage the downloaded update: code signature mismatch'
    )
    expect(forkStagingUpdateVersion()).toBeNull()
    expect(sent.some((item) => item.state === 'downloaded')).toBe(false)
    warn.mockRestore()
  })

  it('keeps the manual offer when the build is not a fork build', async () => {
    registerForkBuild(false)
    resetForkBackgroundDownloadState()
    let status: UpdateStatus = { state: 'checking' }
    const sendStatus = vi.fn()
    const beginForkBackgroundDownload = vi.fn()
    const { autoUpdater, emit } = testAutoUpdater()
    const { registerAutoUpdaterHandlers } = await import('../../main/updater/updater-events')
    registerAutoUpdaterHandlers({
      autoUpdater,
      clearBackgroundCheckLaunchPending: vi.fn(),
      clearAvailableUpdateContext: vi.fn(),
      consumeMissingManifestPrereleaseFallbackResult: vi.fn(() => null),
      getPublishingWindowLastGoodCheck: vi.fn(() => null),
      getMissingManifestPrereleaseFallbackUserInitiated: vi.fn(() => null),
      getCurrentStatus: () => status,
      getActiveUpdateCheckEventAttemptId: vi.fn(() => 1),
      getKnownReleaseUrl: vi.fn(() => undefined),
      getPendingInstallVersion: () => '',
      getUserInitiatedCheck: () => false,
      handleQuitAndInstallFailure: vi.fn(() => false),
      isQuitAndInstallHandoffActive: vi.fn(() => false),
      hasInstallableDownloadedVersion: vi.fn(() => false),
      isLocalBuildCheck: vi.fn(() => false),
      isPinnedBuildCheck: vi.fn(() => false),
      shouldHandleUpdaterErrorEvent: vi.fn(() => true),
      clearUpdateAvailableEventPending: vi.fn(),
      isActiveUpdateCheckAttempt: vi.fn(() => true),
      markUpdateCheckEventAttempt: vi.fn(() => true),
      markUpdateAvailableEventPending: vi.fn(),
      markMissingManifestPrereleaseFallbackChecking: vi.fn(),
      performQuitAndInstall: vi.fn(),
      commitStagedMacInstall: vi.fn(),
      failMacStaging: vi.fn(),
      isAwaitingMacStaging: vi.fn(() => false),
      isMacStagingDeferredToInstall: vi.fn(() => false),
      shouldDeferMacQuitForInstall: vi.fn(() => true),
      recordCompletedUpdateCheck: vi.fn(),
      restoreReleaseUpdateSource: vi.fn(),
      sendCheckFailureStatus: vi.fn(),
      sendErrorStatus: vi.fn(),
      sendStatus,
      scheduleAutomaticUpdateCheck: vi.fn(),
      shouldSuppressMissingManifestPrereleaseFallbackEvent: vi.fn(() => false),
      suppressMissingManifestPrereleaseFallbackPromiseFailure: vi.fn(),
      setAvailableReleaseUrl: vi.fn(),
      setAvailableVersion: vi.fn(),
      setUserInitiatedCheck: vi.fn()
    })
    emit('update-available', { version: '2.0.0' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(beginForkBackgroundDownload).not.toHaveBeenCalled()
    expect(sendStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'available', version: '2.0.0', changelog: null })
    )
  })
})

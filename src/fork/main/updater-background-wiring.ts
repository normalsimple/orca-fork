// fork: wires the background-download decisions into upstream's updater events and release pin.
import { autoUpdater as nativeUpdater } from 'electron'
import { forkUpdateFeed, type ForkGithubUpdateFeed } from '../../shared/fork-hooks/update-feed'
import type { UpdaterHandlerContext } from '../../main/updater/updater-handler-context'
import { isMacInstallerReady, resetMacInstallState } from '../../main/updater/mac-install/updater-mac-install'
import { registerForkInstallerReadyProbe } from './fork-background-download'
import { createForkUpdateAdapter } from './fork-update-adapter'
import type { ForkUpdateAdapter } from './fork-update-adapter'

const STAGING_FAILED = 'macOS could not stage the downloaded update'

export type { ForkUpdateAdapter }

// fork: 重启卡片要等安装器就绪；macOS 上就是 Squirrel 暂存完成。
// 受监管的无界面 serve 把暂存推迟到 quitAndInstall，下载完就算就绪，和上游 update-downloaded 的判断一致。
export function bindForkBackgroundUpdates(ctx: UpdaterHandlerContext): ForkUpdateAdapter {
  if (process.platform === 'darwin') {
    registerForkInstallerReadyProbe(
      () => isMacInstallerReady() || ctx.isMacStagingDeferredToInstall()
    )
  }
  const adapter = createForkUpdateAdapter({
    localOrPinned: () => ctx.isLocalBuildCheck() || ctx.isPinnedBuildCheck(),
    status: ctx.getCurrentStatus,
    schedule: ctx.scheduleAutomaticUpdateCheck,
    record: ctx.recordCompletedUpdateCheck,
    finish: () => ctx.finishActiveUpdateCheckAttempt?.(),
    setVersion: ctx.setAvailableVersion,
    sendStatus: ctx.sendStatus,
    sendDownloaded: (version) => {
      ctx.sendStatus({ state: 'downloaded', version, releaseUrl: ctx.getKnownReleaseUrl() })
    },
    sendError: (message) => {
      resetMacInstallState()
      ctx.sendErrorStatus(message)
    },
    awaitingInstall: ctx.isAwaitingMacStaging,
    download: (version) => ctx.beginForkBackgroundDownload?.(version),
    clearStaleDownload: () => {
      resetMacInstallState()
      ctx.clearAvailableUpdateContext()
    },
    setUserInitiated: ctx.setUserInitiatedCheck,
    restore: ctx.restoreReleaseUpdateSource,
    recover: (userInitiated) => ctx.recoverForkStagedCheckFailure?.(userInitiated) ?? false
  })
  if (process.platform === 'darwin') {
    // 暂存失败时 MacUpdater 不一定把错误转发到还在处理的检查上；这里直接听 Squirrel。
    nativeUpdater.on('error', (error: unknown) => {
      const cause = error instanceof Error && error.message ? `: ${error.message}` : '.'
      adapter.onStagingError(`${STAGING_FAILED}${cause}`)
    })
  }
  return adapter
}

/** Release checks in a fork build pin only the anonymous quzard/orca-fork feed, never upstream's. */
export function pinForkUpdateFeed(updater: {
  allowPrerelease: boolean
  setFeedURL(options: ForkGithubUpdateFeed): void
}): boolean {
  const feed = forkUpdateFeed()
  if (!feed) {
    return false
  }
  // Fork releases are GitHub prereleases; electron-updater's own differential download applies.
  updater.allowPrerelease = true
  updater.setFeedURL(feed)
  return true
}

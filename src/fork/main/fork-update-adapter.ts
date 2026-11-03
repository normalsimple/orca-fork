// fork: 把 fork-background-download 的判断接到更新器事件上。只由 updater-background-wiring.ts 使用。

import type { UpdateStatus } from '../../shared/update-status-types'
import {
  AUTO_UPDATE_CHECK_INTERVAL_MS,
  AUTO_UPDATE_RETRY_INTERVAL_MS
} from '../../main/updater/lifecycle/updater-state'
import {
  consumeForkBackgroundDownloadFailure,
  failForkStaging,
  forkStagedUpdateVersion,
  forkStagingUpdateVersion,
  noteForkUpdateDownloaded,
  planForkFoundUpdate,
  planForkMissingUpdate,
  shouldHoldForkUpdateCheck,
  shouldPreserveForkDownloadedContext,
  type ForkFoundUpdateInput
} from './fork-background-download'

export type ForkUpdateEffects = {
  schedule: () => void
  finish: () => void
  download: (version: string) => void
  restart: (version: string) => void
  staging: (version: string) => void
}

function takeForkFoundUpdate(input: ForkFoundUpdateInput, effects: ForkUpdateEffects): boolean {
  const effect = planForkFoundUpdate(input)
  if (effect === 'passthrough') {
    return false
  }
  effects.schedule()
  if (effect === 'keep') {
    effects.finish()
    return true
  }
  if (effect === 'download') {
    effects.download(input.version)
    return true
  }
  if (effect === 'staging') {
    effects.staging(forkStagingUpdateVersion() ?? input.version)
    return true
  }
  effects.restart(forkStagedUpdateVersion() ?? input.version)
  return true
}

function takeForkMissingUpdate(
  userInitiated: boolean,
  effects: Pick<ForkUpdateEffects, 'schedule' | 'finish' | 'restart' | 'staging'>
): boolean {
  const effect = planForkMissingUpdate(userInitiated)
  if (effect === 'passthrough') {
    return false
  }
  effects.schedule()
  if (effect === 'keep') {
    effects.finish()
    return true
  }
  if (effect === 'staging') {
    const pending = forkStagingUpdateVersion()
    if (pending) {
      effects.staging(pending)
    } else {
      effects.finish()
    }
    return true
  }
  const version = forkStagedUpdateVersion()
  if (!version) {
    effects.finish()
    return true
  }
  effects.restart(version)
  return true
}

export type ForkUpdateAdapter = {
  onChecking: (userInitiated: boolean) => boolean
  takeFound: (version: string, userInitiated: boolean, retrySoon: boolean) => boolean
  takeMissing: (userInitiated: boolean, retrySoon: boolean) => boolean
  noteDownloaded: (version: string) => void
  onUpdaterError: (pendingVersion: string, userInitiated?: boolean) => boolean
  /** Squirrel 原生 error。暂存中失败时清掉暂存并显示错误，返回是否处理了。 */
  onStagingError: (message: string) => boolean
}

export function createForkUpdateAdapter(deps: {
  localOrPinned: () => boolean
  status: () => UpdateStatus
  schedule: (delayMs: number) => void
  record: () => void
  finish: () => void
  setVersion: (version: string) => void
  sendStatus: (status: UpdateStatus) => void
  sendDownloaded: (version: string) => void
  sendError: (message: string) => void
  awaitingInstall: () => boolean
  download: (version: string) => void
  clearStaleDownload: () => void
  setUserInitiated: (value: boolean) => void
  restore: () => void
  recover: (userInitiated?: boolean) => boolean
}): ForkUpdateAdapter {
  const scheduleCheck = (userInitiated: boolean, retrySoon: boolean): void => {
    if (deps.localOrPinned()) {
      return
    }
    if (retrySoon) {
      deps.schedule(AUTO_UPDATE_RETRY_INTERVAL_MS)
      return
    }
    deps.record()
    if (!userInitiated) {
      deps.schedule(AUTO_UPDATE_CHECK_INTERVAL_MS)
    }
  }
  const effectsFor = (userInitiated: boolean, retrySoon: boolean): ForkUpdateEffects => ({
    schedule: () => scheduleCheck(userInitiated, retrySoon),
    finish: deps.finish,
    download: (version) => {
      deps.setVersion(version)
      deps.download(version)
    },
    restart: (version) => {
      deps.setVersion(version)
      deps.sendDownloaded(version)
    },
    staging: (version) => {
      deps.setVersion(version)
      deps.sendStatus({ state: 'downloading', percent: 100, version })
    }
  })
  return {
    onChecking: (userInitiated) => {
      const localOrPinned = deps.localOrPinned()
      if (
        shouldHoldForkUpdateCheck({ userInitiated, status: deps.status().state, localOrPinned })
      ) {
        return true
      }
      if (!shouldPreserveForkDownloadedContext(localOrPinned)) {
        deps.clearStaleDownload()
      }
      return false
    },
    takeFound: (version, userInitiated, retrySoon) => {
      const status = deps.status()
      return takeForkFoundUpdate(
        {
          localOrPinned: deps.localOrPinned(),
          version,
          userInitiated,
          downloadingVersion: status.state === 'downloading' ? status.version : null
        },
        effectsFor(userInitiated, retrySoon)
      )
    },
    takeMissing: (userInitiated, retrySoon) => {
      if (!takeForkMissingUpdate(userInitiated, effectsFor(userInitiated, retrySoon))) {
        return false
      }
      deps.setUserInitiated(false)
      if (deps.localOrPinned()) {
        deps.restore()
      }
      return true
    },
    noteDownloaded: (version) => noteForkUpdateDownloaded(version, deps.localOrPinned()),
    onUpdaterError: (pendingVersion, userInitiated) => {
      const manual = consumeForkBackgroundDownloadFailure(pendingVersion)
      if (manual) {
        deps.setVersion(manual.version)
        deps.sendStatus(manual)
        return true
      }
      // 暂存中、界面停在「已下载 100%」时来的错误就是暂存失败（MacUpdater 会把 Squirrel 的错误转发过来）。
      // 清掉暂存，返回 false 让上游显示错误状态，用户可以重新检查。
      if (deps.status().state === 'downloading' && failForkStaging()) {
        return false
      }
      return deps.recover(userInitiated)
    },
    onStagingError: (message) => {
      // 用户已经点了重启：上游 failMacStaging 负责恢复和提示。
      if (deps.awaitingInstall() || !failForkStaging()) {
        return false
      }
      deps.sendError(message)
      return true
    }
  }
}

// fork: 本地目录已不存在的仓库或工作区，在权威扫描确认路径缺失（ENOENT/ENOTDIR）后自动清理残留会话与元数据。
import { stat } from 'node:fs/promises'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import { registerMissingWorktreeMetadataCleanup } from '../../shared/fork-hooks/missing-worktree-metadata'
import type { PersistedMobileClientTabSelections } from '../../shared/persisted-state-types'
import {
  hostWorktreeTarget,
  type HostWorktreeTarget
} from '../../shared/worktree/host-qualified-identity'
import type { GitWorktreeInfo } from '../../shared/worktree/types'
import {
  getErrorCode,
  isNotGitRepositoryError
} from '../../main/git/worktrees/worktree-operation-options'
import {
  failedWorktreeRemovals,
  pendingWorktreeRemovals
} from '../../main/workspaces/removal/worktree-removal-table'

type PruneSessionStore = {
  removeWorkspaceSessionStateForWorktree?: (target: HostWorktreeTarget) => void
  getUI?: () => { lastActiveWorktreeId?: string | null }
  updateUI?: (updates: { lastActiveWorktreeId: null }) => void
  getMobileClientTabSelections?: () => PersistedMobileClientTabSelections
  setMobileClientTabSelections?: (next: PersistedMobileClientTabSelections) => void
}

export async function resolveMissingRepoWorktreeScan(
  repoPath: string,
  error: unknown
): Promise<{ ok: boolean; worktrees: GitWorktreeInfo[] } | null> {
  if (getErrorCode(error) === 'ENOENT') {
    try {
      const info = await stat(repoPath)
      if (!info.isDirectory()) {
        return { ok: true, worktrees: [] }
      }
    } catch (statErr) {
      const code = getErrorCode(statErr)
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return { ok: true, worktrees: [] }
      }
    }
  }
  if (isNotGitRepositoryError(error)) {
    return { ok: true, worktrees: [] }
  }
  return null
}

export function filterLiveGitWorktrees(
  gitWorktrees: readonly GitWorktreeInfo[]
): GitWorktreeInfo[] {
  return gitWorktrees.filter((worktree) => !worktree.prunable || Boolean(worktree.removalError))
}

export function prepareMissingLocalWorktreeMetadataPrune(
  rawStore: unknown,
  missingMetadata: readonly { worktreeId: string }[]
): void {
  if (!rawStore || typeof rawStore !== 'object' || missingMetadata.length === 0) {
    return
  }
  const store = rawStore as PruneSessionStore
  const removableIds = missingMetadata
    .map(({ worktreeId }) => worktreeId)
    .filter(
      (worktreeId) =>
        !pendingWorktreeRemovals.has(worktreeId) && !failedWorktreeRemovals.has(worktreeId)
    )
  if (removableIds.length === 0) {
    return
  }
  const removableSet = new Set(removableIds)
  if (typeof store.removeWorkspaceSessionStateForWorktree === 'function') {
    for (const worktreeId of removableIds) {
      store.removeWorkspaceSessionStateForWorktree(
        hostWorktreeTarget({ id: worktreeId, hostId: LOCAL_EXECUTION_HOST_ID })
      )
    }
  }
  if (typeof store.getUI === 'function' && typeof store.updateUI === 'function') {
    const lastActive = store.getUI().lastActiveWorktreeId
    if (lastActive && removableSet.has(lastActive)) {
      store.updateUI({ lastActiveWorktreeId: null })
    }
  }
  if (
    typeof store.getMobileClientTabSelections === 'function' &&
    typeof store.setMobileClientTabSelections === 'function'
  ) {
    const current = store.getMobileClientTabSelections()
    let mutated = false
    const next: PersistedMobileClientTabSelections = {}
    for (const [deviceId, selections] of Object.entries(current)) {
      const filteredEntries = Object.entries(selections).filter(
        ([worktreeId]) => !removableSet.has(worktreeId)
      )
      if (filteredEntries.length !== Object.keys(selections).length) {
        mutated = true
      }
      if (filteredEntries.length > 0) {
        next[deviceId] = Object.fromEntries(filteredEntries)
      }
    }
    if (mutated) {
      store.setMobileClientTabSelections(next)
    }
  }
}

export function registerMissingWorktreeMetadataCleanupInMain(): void {
  registerMissingWorktreeMetadataCleanup({
    resolveMissingRepoScan: resolveMissingRepoWorktreeScan,
    filterLiveGitWorktrees,
    prepareMissingMetadataPrune: prepareMissingLocalWorktreeMetadataPrune
  })
}

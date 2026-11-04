// Archive one workspace in Orca. The directory and git branch stay on the host.
import { toast } from 'sonner'
import { forkTranslate } from '../i18n/fork-translate'
import { getWorktreeExecutionHostId } from '../../shared/execution-host'
import { getWorktreeOperationOwnerHostIds } from '../../renderer/src/lib/worktree-operation-route'
import { findRepoForHost } from '../../renderer/src/store/slices/repo-host-identity'
import {
  clearWorktreeSleepIntent,
  markWorktreeSleepIntent
} from '../../renderer/src/lib/worktree-sleep-intent'
import { showWorkspaceListChangedToast } from '../../renderer/src/components/sidebar/worktree-list/listing/stale-workspace-list-toast'
import type { WorktreeDeleteIdentity } from '../../renderer/src/components/sidebar/workspace-actions/deletion/worktree-delete-request'
import { useAppStore } from '../../renderer/src/store'
import type { Worktree } from '../../shared/worktree/types'
import type { ExecutionHostId } from '../../shared/execution-host'
import { forgetWorkspaceArchive, rememberWorkspaceArchive } from './durable-workspace-archive'

export const workspaceRemovalLabels = {
  get failed() {
    return forkTranslate(
      'fork.workspaceRemoval.failed',
      'Could not remove this workspace from Orca'
    )
  },
  get ambiguous() {
    return forkTranslate(
      'fork.workspaceRemoval.ambiguous',
      'This workspace has multiple execution hosts. Its terminal ownership must be resolved before removal.'
    )
  },
  get removed() {
    return forkTranslate('fork.workspaceRemoval.removed', 'Workspace removed from Orca')
  },
  get undo() {
    return forkTranslate('fork.workspaceRemoval.undo', 'Undo')
  },
  get menu() {
    return forkTranslate('fork.workspaceRemoval.menu', 'Remove from Orca')
  }
}

function identityMatches(
  worktree: { instanceId?: string } | undefined,
  instanceId: string | undefined
): boolean {
  return Boolean(worktree) && (instanceId === undefined || worktree?.instanceId === instanceId)
}

// 孤立行不在元数据里，先标成归档，活动侧栏立刻消失；扫描再回来时由隐藏记录接住。
function archiveOrphanWorktree(worktree: Worktree, hostId: ExecutionHostId): void {
  useAppStore.setState((state) => {
    const list = state.worktreesByRepo[worktree.repoId] ?? []
    let changed = false
    const next = list.map((entry) => {
      if (entry.id !== worktree.id || entry.isArchived) {
        return entry
      }
      if (hostId && entry.hostId && entry.hostId !== hostId) {
        return entry
      }
      changed = true
      return { ...entry, isArchived: true }
    })
    if (!changed) {
      return state
    }
    return {
      worktreesByRepo: {
        ...state.worktreesByRepo,
        [worktree.repoId]: next
      }
    }
  })
}

export async function removeWorkspaceFromOrca(
  target: WorktreeDeleteIdentity,
  options?: { quiet?: boolean }
): Promise<boolean> {
  const state = useAppStore.getState()
  const worktree = state.getKnownWorktreeById(target.id, target.hostId)
  if (!worktree || !identityMatches(worktree, target.instanceId)) {
    showWorkspaceListChangedToast()
    return false
  }
  const hostId = target.hostId ?? getWorktreeExecutionHostId(worktree, undefined)
  if (getWorktreeOperationOwnerHostIds(state, worktree.id).length > 1) {
    toast.error(workspaceRemovalLabels.ambiguous)
    return false
  }
  const ownerRepo = findRepoForHost(state.repos, worktree.repoId, { hostId })
  // 写在 await 之前：进行中的扫描合并会读到这条记录，不会把行又标成未归档。
  // 元数据写失败就删掉，避免侧栏已经报错、刷新后却消失。
  rememberWorkspaceArchive({
    id: worktree.id,
    path: worktree.path ?? '',
    repoId: worktree.repoId,
    hostId,
    ...(worktree.identity?.key ? { identityKey: worktree.identity.key } : {}),
    pathOnly: !ownerRepo
  })
  // Why archive first: like upstream's removal, the renderer tears down only after the host
  // accepted the change, so a failed archive leaves the workspace's terminals running.
  if (ownerRepo) {
    try {
      const result = await state.updateWorktreeMeta(
        worktree.id,
        { isArchived: true },
        { executionHostId: hostId }
      )
      if (!result.ok) {
        throw new Error(result.error ?? workspaceRemovalLabels.failed)
      }
    } catch (error) {
      forgetWorkspaceArchive(worktree)
      toast.error(workspaceRemovalLabels.failed, {
        description: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }
  const currentState = useAppStore.getState()
  const wasActive =
    currentState.activeWorktreeId === worktree.id &&
    (currentState.activeWorkspaceExecutionHostId ?? hostId) === hostId
  if (wasActive) {
    markWorktreeSleepIntent(worktree.id)
    currentState.setActiveWorktree(null)
  }
  try {
    currentState.shutdownWorktreeBrowsers(worktree.id)
    await currentState.shutdownWorktreeTerminals(worktree.id, { keepIdentifiers: true })
  } catch (error) {
    // The archive already landed; the workspace is gone from the list either way.
    console.error('Failed to stop a removed workspace:', error)
  } finally {
    if (wasActive) {
      clearWorktreeSleepIntent(worktree.id)
    }
  }
  if (!ownerRepo) {
    archiveOrphanWorktree(worktree, hostId)
    if (!options?.quiet) {
      toast.success(workspaceRemovalLabels.removed)
    }
    return true
  }
  if (options?.quiet) {
    return true
  }
  toast.success(workspaceRemovalLabels.removed, {
    action: {
      label: workspaceRemovalLabels.undo,
      onClick: () => {
        forgetWorkspaceArchive(worktree)
        void useAppStore
          .getState()
          .updateWorktreeMeta(worktree.id, { isArchived: false }, { executionHostId: hostId })
          .then((restored) => {
            if (!restored.ok) {
              toast.error(restored.error ?? workspaceRemovalLabels.failed)
            }
          })
      }
    }
  })
  return true
}

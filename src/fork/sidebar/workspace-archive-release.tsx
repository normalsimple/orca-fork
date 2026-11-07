// 软删除留下两样东西：元数据里的 isArchived 和本机隐藏记录（durable-workspace-archive）。
// 同一路径再导入、或者工作区被真正删掉时，在这里把它们清掉。
import { useAppStore } from '../../renderer/src/store'
import { getWorktreeOnHostFromState } from '../../renderer/src/store/workspaces/selection/worktree-on-host-selector'
import { findRepoForHost } from '../../renderer/src/store/repos/repo-host-identity'
import { getRepoExecutionHostId, type ExecutionHostId } from '../../shared/execution-host'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import {
  forgetWorkspaceArchive,
  releaseDurableArchiveAtPath,
  releaseDurableArchiveForWorkspace
} from './durable-workspace-archive'

/**
 * Import keeps the path's instanceId, so the old isArchived would put the imported row under
 * "Removed from Orca". Goes through the store so a runtime host's own metadata is written.
 */
async function reactivateArchivedWorktreeMeta(
  worktreeId: string,
  executionHostId: ExecutionHostId | undefined
): Promise<void> {
  const result = await useAppStore
    .getState()
    .updateWorktreeMeta(
      worktreeId,
      { isArchived: false },
      executionHostId ? { executionHostId } : undefined
    )
  if (!result.ok) {
    throw new Error(result.error)
  }
}

/** Clears the archive, then the hide. A failed write keeps the hide, so the row stays hidden. */
export async function releaseImportedWorktree(args: {
  id: string
  path: string
  repoId: string
  hostId?: ExecutionHostId
}): Promise<boolean> {
  try {
    await reactivateArchivedWorktreeMeta(args.id, args.hostId)
  } catch (error) {
    console.error('Failed to clear archived workspace metadata:', error)
    return false
  }
  releaseDurableArchiveAtPath(args)
  return true
}

/** The external-worktree inbox import, before it rescans the project. */
export async function reactivateImportedWorktrees(
  projectId: string,
  worktreePaths: readonly string[]
): Promise<boolean> {
  const state = useAppStore.getState()
  const repo = findRepoForHost(state.repos, projectId, { settings: state.settings })
  const hostId = repo ? getRepoExecutionHostId(repo) : undefined
  let released = true
  for (const path of worktreePaths) {
    const id = `${projectId}::${path}`
    released = (await releaseImportedWorktree({ id, path, repoId: projectId, hostId })) && released
  }
  return released
}

/** A confirmed removal: the hide record matches the removed row by identity, id or path. */
export function releaseRemovedWorkspaceArchive(
  worktreeId: string,
  hostId: ExecutionHostId | undefined
): void {
  const row = getWorktreeOnHostFromState(useAppStore.getState(), worktreeId, hostId)
  if (row) {
    releaseDurableArchiveForWorkspace({ worktree: row })
    return
  }
  forgetWorkspaceArchive({
    id: worktreeId,
    path: '',
    repoId: getRepoIdFromWorktreeId(worktreeId),
    isArchived: true,
    ...(hostId ? { hostId } : {})
  })
}

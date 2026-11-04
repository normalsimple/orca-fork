// fork: deleting a project group keeps its folder workspaces and only ungroups them, as the
// renderer cascade already does (projectGroupDeleteKeepsFolderWorkspaces). Upstream deletes them
// with the group, so the next folder list made them vanish (their folders stay on disk).
import { parseExecutionHostId } from '../../shared/execution-host'
import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import type { PersistedState } from '../../shared/persisted-state-types'

/**
 * Runs before the groups leave `state`; the returned step runs after. A kept workspace that the
 * deleted groups owned copies the owner's host fields it lacks, so it stays on the same host
 * once no group says so. Every kept workspace whose owner or sidebar group was deleted is
 * explicitly ungrouped (`sidebarGroupId: null`).
 */
export function keepFolderWorkspacesOnGroupDelete(
  state: PersistedState,
  deletedGroupIds: ReadonlySet<string>
): () => void {
  const owners = new Map(
    (state.projectGroups ?? [])
      .filter((group) => deletedGroupIds.has(group.id))
      .map((group) => [group.id, group])
  )
  return () => {
    state.folderWorkspaces = (state.folderWorkspaces ?? []).map((workspace) => {
      const owner = owners.get(workspace.projectGroupId)
      const sidebarGroupDeleted =
        typeof workspace.sidebarGroupId === 'string' &&
        deletedGroupIds.has(workspace.sidebarGroupId)
      if (!owner && !sidebarGroupDeleted) {
        return workspace
      }
      const next: FolderWorkspace = { ...workspace, sidebarGroupId: null, updatedAt: Date.now() }
      if (owner) {
        if (!next.folderPath && owner.parentPath) {
          next.folderPath = owner.parentPath
        }
        if (!next.connectionId && owner.connectionId) {
          next.connectionId = owner.connectionId
        }
        const ownerHostId = parseExecutionHostId(owner.executionHostId)?.id
        if (!next.executionHostId && ownerHostId) {
          next.executionHostId = ownerHostId
        }
      }
      return next
    })
  }
}

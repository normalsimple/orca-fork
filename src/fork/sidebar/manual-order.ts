// The one manual-sort order of the host-directory sidebar: the sidebar draws it and a group drop
// computes its writes from it, so a drop lands where its insertion line showed. A row without a
// manual order sorts by sortOrder (its creation time or the last Smart snapshot), as upstream's
// manual sort does everywhere (smart-sort.ts, worktree-manual-order-catalog.ts); ties go to the
// sort label, then the host-qualified identity.
import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import { folderWorkspaceToWorktree } from '../../shared/folder-workspaces/folder-workspace-worktree'
import { compareWorktreeSortLabel } from '../../shared/sidebar-list/smart-sort'
import { getWorktreeHostIdentity } from '../../shared/worktree/host-qualified-identity'
import type { Worktree } from '../../shared/worktree/types'

/** The key manual sort orders by, higher first. */
export function manualOrderKey(row: Pick<Worktree, 'manualOrder' | 'sortOrder'>): number {
  return row.manualOrder ?? row.sortOrder
}

export function compareManualRows(a: Worktree, b: Worktree): number {
  return manualOrderKey(b) - manualOrderKey(a) || compareWorktreeSortLabel(a, b)
}

/**
 * Every unarchived row (folders as their worktree form) in manual order, each host identity once:
 * a same-id workspace on another host is its own row.
 */
export function manualOrderedRows(
  worktrees: readonly Worktree[],
  folderWorkspaces: readonly FolderWorkspace[]
): Worktree[] {
  const rows = [
    ...worktrees,
    ...folderWorkspaces.map((workspace) => folderWorkspaceToWorktree(workspace))
  ].filter((row) => !row.isArchived)
  rows.sort(compareManualRows)
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = getWorktreeHostIdentity(row)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

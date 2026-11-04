// Sort workspaces inside one host section. Smart keeps the incoming order; manual uses the shared
// manual order (manual-order.ts), the same one a group drop writes against.
import {
  folderWorkspaceToWorktree,
  getFolderWorkspaceHostIdentity
} from '../../shared/folder-workspaces/folder-workspace-worktree'
import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import type { Repo } from '../../shared/repo-types'
import { getWorktreeHostIdentity } from '../../shared/worktree/host-qualified-identity'
import type { Worktree } from '../../shared/worktree/types'
import {
  buildWorkspaceRowComparator,
  recentActivityWithCreateGrace,
  type WorkspaceSortBy
} from '../../shared/workspace-view/workspace-row-sort'
import { compareManualRows } from './manual-order'

export type OrderedWorkspace =
  | { kind: 'worktree'; worktree: Worktree; repo: Repo | undefined }
  | { kind: 'folder'; folder: FolderWorkspace }

export function orderWorkspaces(
  members: readonly OrderedWorkspace[],
  sortBy: WorkspaceSortBy | undefined,
  now: number
): OrderedWorkspace[] {
  if (!sortBy || sortBy === 'smart') {
    return [...members]
  }
  if (sortBy === 'manual') {
    return members
      .map((member) => ({
        member,
        row: member.kind === 'worktree' ? member.worktree : folderWorkspaceToWorktree(member.folder)
      }))
      .sort((a, b) => compareManualRows(a.row, b.row))
      .map((entry) => entry.member)
  }
  const compare = buildWorkspaceRowComparator<OrderedWorkspace>(sortBy, {
    label: (member) =>
      member.kind === 'worktree' ? member.worktree.displayName : member.folder.name,
    // fork: 上游用主机限定 id 打破同名平局。文件夹和 git 工作区各自走已有的身份函数。
    identity: (member) =>
      member.kind === 'worktree'
        ? getWorktreeHostIdentity(member.worktree)
        : getFolderWorkspaceHostIdentity(member.folder),
    repoLabel: (member) =>
      member.kind === 'worktree' ? (member.repo?.displayName ?? '') : member.folder.name,
    recentActivity: (member) =>
      member.kind === 'worktree'
        ? recentActivityWithCreateGrace(
            member.worktree.lastActivityAt,
            member.worktree.createdAt,
            now
          )
        : member.folder.lastActivityAt,
    // Manual returns above; the reader still needs a rank.
    manualRank: () => null,
    compareSmart: () => 0
  })
  return [...members].sort(compare)
}

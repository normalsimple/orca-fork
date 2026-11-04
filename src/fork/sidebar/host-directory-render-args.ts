import type { ExecutionHostId } from '../../shared/execution-host'
import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { Repo } from '../../shared/repo-types'
import type { Worktree } from '../../shared/worktree/types'
import type { WorktreeOccurrencePlan } from '../../shared/worktree-occurrence-plan'
import type { WorkspaceSortBy } from '../../shared/workspace-view/workspace-row-sort'
import type { OrderedWorkspace } from './workspace-order'

export type HostDirectoryRenderArgs = {
  collapsedGroups: Set<string>
  occurrencePlan: WorktreeOccurrencePlan<Worktree> & {
    sections: readonly {
      key: string
      items: readonly Worktree[]
      placement?: 'pinned' | 'natural'
    }[]
  }
  repoMap: Map<string, Repo>
  /** The row's own registration: same-id projects can be registered on two hosts. */
  repoOf: (worktree: Worktree) => Repo | undefined
  projectGroups: readonly ProjectGroup[]
  defaultHostId: ExecutionHostId
  sortBy: WorkspaceSortBy | undefined
  placeholderRepoIds: ReadonlySet<string>
  pendingCreations: readonly { creationId: string; repoId: string }[]
  folderWorkspaces: readonly FolderWorkspace[]
  orderMembers: (members: readonly OrderedWorkspace[]) => OrderedWorkspace[]
}

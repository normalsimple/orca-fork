// Host buckets, loose workspaces, and empty-project headers for host-directory rows.
import type { ExecutionHostId } from '../../shared/execution-host'
import { getWorktreeExecutionHostId } from '../../shared/execution-host'
import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { Repo } from '../../shared/repo-types'
import type { Worktree } from '../../shared/worktree/types'
import type { Row } from '../../shared/sidebar-list/row-types'
import { folderWorkspaceHostId, projectGroupHostId, resolveSidebarGroupId } from './membership'
import { emptyProjectSectionKey, hostDirectorySectionKey } from './section-keys'
import type { HostDirectoryRenderArgs } from './host-directory-render-args'
import type { OrderedWorkspace } from './workspace-order'

export function workspaceHost(worktree: Worktree, args: HostDirectoryRenderArgs): ExecutionHostId {
  return getWorktreeExecutionHostId(worktree, args.repoOf(worktree), args.defaultHostId)
}

export function collectHostIds(args: HostDirectoryRenderArgs): ExecutionHostId[] {
  const ids = new Set<ExecutionHostId>()
  const groupsById = groupsByIdOf(args)
  for (const section of args.occurrencePlan.sections) {
    for (const worktree of section.items) {
      ids.add(workspaceHost(worktree, args))
    }
  }
  for (const group of args.projectGroups) {
    ids.add(projectGroupHostId(group, args.defaultHostId))
  }
  for (const repoId of args.placeholderRepoIds) {
    const repo = args.repoMap.get(repoId)
    if (repo) {
      ids.add(getWorktreeExecutionHostId({ hostId: undefined }, repo, args.defaultHostId))
    }
  }
  for (const folder of args.folderWorkspaces) {
    if (!folder.isArchived) {
      ids.add(
        folderWorkspaceHostId(folder, groupsById.get(folder.projectGroupId), args.defaultHostId)
      )
    }
  }
  return [...ids].sort(
    (left, right) => hostRank(left) - hostRank(right) || left.localeCompare(right)
  )
}

function hostRank(hostId: ExecutionHostId): number {
  return hostId === 'local' ? 0 : 1
}

export function groupsByIdOf(args: HostDirectoryRenderArgs): Map<string, ProjectGroup> {
  return new Map(args.projectGroups.map((group) => [group.id, group]))
}

export function reposOnHost(args: HostDirectoryRenderArgs, hostId: ExecutionHostId): Repo[] {
  const repos: Repo[] = []
  const seen = new Set<string>()
  for (const section of args.occurrencePlan.sections) {
    for (const worktree of section.items) {
      if (seen.has(worktree.repoId) || workspaceHost(worktree, args) !== hostId) {
        continue
      }
      const repo = args.repoOf(worktree)
      if (!repo) {
        continue
      }
      seen.add(repo.id)
      repos.push(repo)
    }
  }
  return repos
}

export function worktreeMembers(args: HostDirectoryRenderArgs, key: string): OrderedWorkspace[] {
  const section = args.occurrencePlan.sections.find((entry) => entry.key === key)
  if (!section) {
    return []
  }
  return section.items.map((worktree) => ({
    kind: 'worktree' as const,
    worktree,
    repo: args.repoOf(worktree)
  }))
}

export function folderMembers(
  args: HostDirectoryRenderArgs,
  hostId: ExecutionHostId,
  groupId: string | null
): OrderedWorkspace[] {
  const groupsById = groupsByIdOf(args)
  return args.folderWorkspaces.flatMap((folder) => {
    if (folder.isArchived) {
      return []
    }
    const owner = groupsById.get(folder.projectGroupId)
    if (folderWorkspaceHostId(folder, owner, args.defaultHostId) !== hostId) {
      return []
    }
    if (effectiveFolderGroupId(folder, args, groupsById) !== groupId) {
      return []
    }
    return [{ kind: 'folder' as const, folder }]
  })
}

function effectiveFolderGroupId(
  folder: FolderWorkspace,
  args: HostDirectoryRenderArgs,
  groupsById: ReadonlyMap<string, ProjectGroup>
): string | null {
  const owner = groupsById.get(folder.projectGroupId)
  return resolveSidebarGroupId({
    sidebarGroupId: folder.sidebarGroupId,
    inheritedGroupId: owner ? folder.projectGroupId : null,
    groupsById,
    hostId: folderWorkspaceHostId(folder, owner, args.defaultHostId),
    defaultHostId: args.defaultHostId
  })
}

export function appendLooseAndPlaceholders(
  rows: Row[],
  args: HostDirectoryRenderArgs,
  hostId: ExecutionHostId,
  labels: Map<string, string>,
  appendMemberRows: HostDirectoryRenderArgs extends never
    ? never
    : (
        rows: Row[],
        members: readonly OrderedWorkspace[],
        sectionKey: string,
        labels: Map<string, string>,
        hostId: ExecutionHostId,
        depth: number
      ) => void
): void {
  const key = hostDirectorySectionKey(hostId, null)
  appendMemberRows(
    rows,
    args.orderMembers([...worktreeMembers(args, key), ...folderMembers(args, hostId, null)]),
    key,
    labels,
    hostId,
    0
  )
  for (const creation of args.pendingCreations) {
    const repo = args.repoMap.get(creation.repoId)
    if (!repo) {
      continue
    }
    if (getWorktreeExecutionHostId({ hostId: undefined }, repo, args.defaultHostId) !== hostId) {
      continue
    }
    rows.push({
      type: 'pending-creation',
      key: `pending:${creation.creationId}`,
      creationId: creation.creationId,
      repo
    })
  }
  for (const repoId of args.placeholderRepoIds) {
    const repo = args.repoMap.get(repoId)
    if (!repo) {
      continue
    }
    if (getWorktreeExecutionHostId({ hostId: undefined }, repo, args.defaultHostId) !== hostId) {
      continue
    }
    const occupied = args.occurrencePlan.sections.some((section) =>
      section.items.some((worktree) => worktree.repoId === repoId)
    )
    if (occupied) {
      continue
    }
    rows.push({
      type: 'header',
      key: emptyProjectSectionKey(hostId, repoId),
      label: repo.displayName,
      count: 0,
      icon: { kind: 'project' },
      repo,
      hostId
    })
  }
}

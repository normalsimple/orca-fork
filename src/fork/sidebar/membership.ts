// Which project group a workspace belongs to under one execution host.
import {
  getWorktreeExecutionHostId,
  normalizeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { Repo } from '../../shared/repo-types'
import type { Worktree } from '../../shared/worktree/types'
import { hostDirectorySectionKey } from './section-keys'

export function projectGroupHostId(
  group: Pick<ProjectGroup, 'connectionId' | 'executionHostId'>,
  defaultHostId: ExecutionHostId
): ExecutionHostId {
  const explicit = normalizeExecutionHostId(group.executionHostId)
  if (explicit) {
    return explicit
  }
  return group.connectionId ? toSshExecutionHostId(group.connectionId) : defaultHostId
}

export function folderWorkspaceHostId(
  folder: Pick<FolderWorkspace, 'connectionId' | 'executionHostId'>,
  group: Pick<ProjectGroup, 'connectionId' | 'executionHostId'> | undefined,
  defaultHostId: ExecutionHostId
): ExecutionHostId {
  const explicit = normalizeExecutionHostId(folder.executionHostId)
  if (explicit) {
    return explicit
  }
  if (folder.connectionId) {
    return toSshExecutionHostId(folder.connectionId)
  }
  return group ? projectGroupHostId(group, defaultHostId) : defaultHostId
}

export function resolveSidebarGroupId(args: {
  sidebarGroupId: string | null | undefined
  inheritedGroupId: string | null | undefined
  groupsById: ReadonlyMap<string, ProjectGroup>
  hostId: ExecutionHostId
  defaultHostId: ExecutionHostId
}): string | null {
  // null is an explicit ungroup. undefined inherits the repo's group.
  if (args.sidebarGroupId === null) {
    return null
  }
  const candidate = args.sidebarGroupId ?? args.inheritedGroupId ?? null
  if (!candidate) {
    return null
  }
  const group = args.groupsById.get(candidate)
  if (!group || projectGroupHostId(group, args.defaultHostId) !== args.hostId) {
    return null
  }
  return candidate
}

export function sectionKeyForWorkspace(args: {
  worktree: Pick<Worktree, 'hostId' | 'sidebarGroupId'>
  repo: Repo | undefined
  projectGroups: readonly ProjectGroup[]
  defaultHostId: ExecutionHostId
}): string {
  const hostId = getWorktreeExecutionHostId(args.worktree, args.repo, args.defaultHostId)
  const groupsById = new Map(args.projectGroups.map((group) => [group.id, group]))
  const groupId = resolveSidebarGroupId({
    sidebarGroupId: args.worktree.sidebarGroupId,
    inheritedGroupId: args.repo?.projectGroupId,
    groupsById,
    hostId,
    defaultHostId: args.defaultHostId
  })
  return hostDirectorySectionKey(hostId, groupId)
}

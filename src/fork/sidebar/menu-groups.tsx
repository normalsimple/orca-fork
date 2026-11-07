// The workspace menu's group entries. In host-directory mode a workspace's group is its own
// effective group (explicit, inherited from the project, or none), so the menu reads and writes that
// instead of the project's group. In every mode the submenu lists only groups the target can join.
import { toast } from 'sonner'
import {
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { Repo } from '../../shared/repo-types'
import type { Worktree } from '../../shared/worktree/types'
import {
  registerWorktreeMenuGroups,
  type WorktreeMenuGroups,
  type WorktreeMenuGroupsArgs
} from '../../shared/fork-hooks/worktree-menu-groups'
import { useAppStore } from '../../renderer/src/store'
import { isProjectGroupJoinableFromCatalog } from '../../renderer/src/store/project-groups/project-group-owner-routing'
import { ipcOrRuntimeTargetForHostId } from '../../renderer/src/runtime/rpc/targets/runtime-client-target'
import { projectGroupHostId, resolveSidebarGroupId } from './membership'
import {
  HOST_DIRECTORY_GROUP_BY,
  hostDirectoryDefaultHostId,
  hostDirectorySectionKey
} from './section-keys'
import {
  commitGroupDrop,
  enqueueGroupDrop,
  planGroupDropItems,
  resolveGroupDropTarget
} from './workspace-group-drop-plan'

/** Groups saved on the workspace's host, and the workspace's effective group there. */
export function workspaceMenuGroupState(args: {
  worktree: Pick<Worktree, 'hostId' | 'sidebarGroupId' | 'repoId'>
  repo: Repo | null | undefined
  projectGroups: readonly ProjectGroup[]
  defaultHostId: ExecutionHostId
}): { hostId: ExecutionHostId; groups: ProjectGroup[]; currentGroupId: string | null } {
  const hostId = getWorktreeExecutionHostId(
    args.worktree,
    args.repo ?? undefined,
    args.defaultHostId
  )
  const seen = new Set<string>()
  const groups = args.projectGroups.filter((group) => {
    if (seen.has(group.id) || projectGroupHostId(group, args.defaultHostId) !== hostId) {
      return false
    }
    seen.add(group.id)
    return true
  })
  const currentGroupId = resolveSidebarGroupId({
    sidebarGroupId: args.worktree.sidebarGroupId,
    inheritedGroupId: args.repo?.projectGroupId,
    groupsById: new Map(groups.map((group) => [group.id, group])),
    hostId,
    defaultHostId: args.defaultHostId
  })
  return { hostId, groups, currentGroupId }
}

/** Moves one workspace into a group (or out, with null) through the cross-group drop's writes. */
export function moveWorkspaceToGroup(
  worktreeId: string,
  hostId: ExecutionHostId,
  groupId: string | null
): Promise<void> {
  return enqueueGroupDrop(async () => {
    const state = useAppStore.getState()
    const target = resolveGroupDropTarget(
      state,
      hostId,
      groupId,
      hostDirectorySectionKey(hostId, groupId)
    )
    if ('error' in target) {
      toast.error(target.error)
      return
    }
    // No order: the workspace keeps its rank and the target section sorts it as usual.
    const items = planGroupDropItems(state, hostId, target, [worktreeId], new Map())
    if ('error' in items) {
      toast.error(items.error)
      return
    }
    const error = await commitGroupDrop(state, hostId, items)
    if (error) {
      toast.error(error)
    }
  })
}

function projectMenuGroups(args: WorktreeMenuGroupsArgs): WorktreeMenuGroups {
  const upstream = {
    groups: args.projectGroups,
    currentGroupId: args.repo?.projectGroupId ?? null,
    onMove: args.handleMoveProjectToGroup,
    onRemove: args.handleRemoveProjectFromGroup
  }
  const target = args.repo ? ipcOrRuntimeTargetForHostId(getRepoExecutionHostId(args.repo)) : null
  if (!target) {
    return upstream
  }
  // The same test moveProjectToGroup applies after the pick, so a listed group never fails it.
  const groups = args.projectGroups.filter((group) =>
    isProjectGroupJoinableFromCatalog(args.projectGroups, group.id, target)
  )
  return { ...upstream, groups }
}

export function hostDirectoryMenuGroups(
  args: WorktreeMenuGroupsArgs,
  move: (worktreeId: string, hostId: ExecutionHostId, groupId: string | null) => void
): WorktreeMenuGroups {
  const { hostId, groups, currentGroupId } = workspaceMenuGroupState({
    worktree: args.worktree,
    repo: args.repo,
    projectGroups: args.projectGroups,
    defaultHostId: hostDirectoryDefaultHostId()
  })
  return {
    groups,
    currentGroupId,
    onMove: (groupId) => {
      if (groupId !== currentGroupId) {
        move(args.worktree.id, hostId, groupId)
      }
    },
    onRemove: () => move(args.worktree.id, hostId, null)
  }
}

export function registerWorkspaceMenuGroups(): void {
  registerWorktreeMenuGroups((args) => {
    // A registered mode id is outside upstream's groupBy union.
    const groupBy: string = useAppStore.getState().groupBy
    return groupBy === HOST_DIRECTORY_GROUP_BY
      ? hostDirectoryMenuGroups(args, (worktreeId, hostId, groupId) => {
          void moveWorkspaceToGroup(worktreeId, hostId, groupId).catch((error: unknown) =>
            console.error('Workspace group move failed', error)
          )
        })
      : projectMenuGroups(args)
  })
}

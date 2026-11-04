// Cross-group sidebar drop. Same host only; other drops fall through to upstream reorder.
import { toast } from 'sonner'
import { getWorktreeExecutionHostId, normalizeExecutionHostId } from '../../shared/execution-host'
import type { ExecutionHostId } from '../../shared/execution-host'
import { folderWorkspaceToWorktree } from '../../shared/folder-workspaces/folder-workspace-worktree'
import { getWorktreeHostIdentity } from '../../shared/worktree/host-qualified-identity'
import { findRepoForHost } from '../../renderer/src/store/slices/repo-host-identity'
import {
  registerWorkspaceGroupDrop,
  type WorkspaceGroupDropArgs
} from '../../shared/fork-hooks/sidebar-chrome'
import { useAppStore } from '../../renderer/src/store'
import type { WorktreeDragGroup } from '../../renderer/src/components/sidebar/worktree-list/drag/worktree-manual-order'
import { getWorktreeSidebarDragRectsForGroup } from '../../renderer/src/components/sidebar/worktree-list/drag/worktree-sidebar-drag-autoscroll'
import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { Repo } from '../../shared/repo-types'
import type { Worktree } from '../../shared/worktree/types'
import { resolveSidebarGroupId, folderWorkspaceHostId } from './membership'
import {
  EMPTY_PROJECT_GROUP_PREFIX,
  WORKSPACE_SIDEBAR_GROUP_ATTRIBUTE,
  hostDirectoryDefaultHostId,
  looseHostSectionKey,
  parseHostDirectorySectionKey
} from './section-keys'
import { buildGroupDropOrder } from './group-drop-order'
import {
  commitGroupDrop,
  enqueueGroupDrop,
  planGroupDropItems,
  resolveGroupDropTarget
} from './workspace-group-drop-plan'
import { workspaceGroupLabels } from './workspace-group-labels'
import { isBetweenRowsHit, nearestGroupSectionKey } from './nearest-section'

type DropArgs = {
  x: number
  y: number
  sourceGroupKey: string
  draggedIds: readonly string[]
  groups: readonly WorktreeDragGroup[]
  container: HTMLElement | null
}

export function workspaceGroupDropBlocked(sourceHostId: string, targetHostId: string): boolean {
  return sourceHostId !== targetHostId
}

export function workspaceGroupInsertionIndex(
  rects: readonly { top: number; bottom: number; groupIndex: number }[],
  pointerY: number,
  fallback: number
): number {
  const before = rects.find((rect) => pointerY < (rect.top + rect.bottom) / 2)
  return before?.groupIndex ?? fallback
}

/** The group key under a release point; exported for tests. */
export function elementGroupKey(container: HTMLElement, x: number, y: number): string | null {
  const hits = document.elementsFromPoint(x, y).filter((entry) => container.contains(entry))
  const element = hits
    .map((entry) => entry.closest<HTMLElement>(`[${WORKSPACE_SIDEBAR_GROUP_ATTRIBUTE}]`))
    .find((entry) => entry && container.contains(entry))
  const direct = element?.getAttribute(WORKSPACE_SIDEBAR_GROUP_ATTRIBUTE)
  if (direct) {
    return direct
  }
  // Released between two rows: use the closest row, so the gap is not a dead zone. Only real gaps
  // in the group and ungrouped lists count (see nearestGroupSectionKey and isBetweenRowsHit).
  const box = container.getBoundingClientRect()
  if (x < box.left || x > box.right || y < box.top || y > box.bottom) {
    return null
  }
  const rowElements = Array.from(
    container.querySelectorAll<HTMLElement>(`[${WORKSPACE_SIDEBAR_GROUP_ATTRIBUTE}]`)
  )
  const rowParents = new Set(rowElements.map((entry) => entry.parentElement))
  if (!isBetweenRowsHit(hits[0], container, rowParents)) {
    return null
  }
  const rects = rowElements.flatMap((entry) => {
    const key = entry.getAttribute(WORKSPACE_SIDEBAR_GROUP_ATTRIBUTE)
    const rect = entry.getBoundingClientRect()
    return key ? [{ top: rect.top, bottom: rect.bottom, key }] : []
  })
  return nearestGroupSectionKey(rects, y, (key) => parseHostDirectorySectionKey(key) !== null)
}

function tryCommitWorkspaceGroupDrop(args: DropArgs): boolean {
  const source = parseHostDirectorySectionKey(args.sourceGroupKey)
  if (!source || !args.container) {
    return false
  }
  const key = elementGroupKey(args.container, args.x, args.y)
  const target = key ? parseHostDirectorySectionKey(key) : null
  if (!key || !target || key === args.sourceGroupKey) {
    return false
  }
  const sourceHostId = normalizeExecutionHostId(source.hostId)
  const targetHostId = normalizeExecutionHostId(target.hostId)
  if (!sourceHostId || !targetHostId) {
    return false
  }
  if (workspaceGroupDropBlocked(sourceHostId, targetHostId)) {
    toast.error(workspaceGroupLabels.hostMismatch)
    return true
  }
  if (looseTargetOfSource(target.groupId, targetHostId, args.sourceGroupKey)) {
    return false
  }
  const pointerY = args.y - args.container.getBoundingClientRect().top + args.container.scrollTop
  void writeGroupDrop(
    targetHostId,
    target.groupId,
    args.draggedIds,
    args.groups,
    key,
    pointerY,
    args.container
  ).catch((error: unknown) => console.error('Workspace group drop failed', error))
  return true
}

// An empty project header belongs to the loose list; from that list it is a plain reorder.
function looseTargetOfSource(
  groupId: string | null,
  hostId: ExecutionHostId,
  sourceGroupKey: string
): boolean {
  return (
    groupId !== null &&
    groupId.startsWith(EMPTY_PROJECT_GROUP_PREFIX) &&
    looseHostSectionKey(hostId) === sourceGroupKey
  )
}

/** `key` is a host identity, so a same-id workspace on another host never answers for this one. */
function workspaceBelongsToGroup(
  state: {
    worktreesByRepo: Record<string, Worktree[]>
    repos: readonly Repo[]
    folderWorkspaces: readonly FolderWorkspace[]
    projectGroups: readonly ProjectGroup[]
  },
  key: string,
  hostId: ExecutionHostId,
  groupId: string | null
): boolean {
  // Rows, projects and groups without a host belong to the sidebar's default host, as drawn.
  const defaultHostId = hostDirectoryDefaultHostId()
  const groupsById = new Map(state.projectGroups.map((group) => [group.id, group]))
  const worktree = Object.values(state.worktreesByRepo)
    .flat()
    .find((entry) => getWorktreeHostIdentity(entry) === key)
  if (worktree && !worktree.isArchived) {
    const repo = findRepoForHost(state.repos, worktree.repoId, { hostId: worktree.hostId })
    if (getWorktreeExecutionHostId(worktree, repo ?? undefined, defaultHostId) !== hostId) {
      return false
    }
    return (
      resolveSidebarGroupId({
        sidebarGroupId: worktree.sidebarGroupId,
        inheritedGroupId: repo?.projectGroupId,
        groupsById,
        hostId,
        defaultHostId
      }) === groupId
    )
  }
  const folder = state.folderWorkspaces.find(
    (entry) => getWorktreeHostIdentity(folderWorkspaceToWorktree(entry)) === key
  )
  if (!folder || folder.isArchived) {
    return false
  }
  const group = groupsById.get(folder.projectGroupId)
  if (folderWorkspaceHostId(folder, group, defaultHostId) !== hostId) {
    return false
  }
  return (
    resolveSidebarGroupId({
      sidebarGroupId: folder.sidebarGroupId,
      inheritedGroupId: folder.projectGroupId,
      groupsById,
      hostId,
      defaultHostId
    }) === groupId
  )
}

function writeGroupDrop(
  hostId: ExecutionHostId,
  groupId: string | null,
  draggedIds: readonly string[],
  groups: readonly WorktreeDragGroup[],
  targetKey: string,
  pointerY: number,
  container: HTMLElement
): Promise<void> {
  // The insertion point is read now, from the rows the user dropped on; the rest waits its turn.
  const early = resolveGroupDropTarget(useAppStore.getState(), hostId, groupId, targetKey)
  const rects = 'error' in early ? [] : getWorktreeSidebarDragRectsForGroup(container, early.key)
  return enqueueGroupDrop(async () => {
    // Planned from the state after any earlier drop, so two drops never rank from one snapshot.
    const state = useAppStore.getState()
    const target = resolveGroupDropTarget(state, hostId, groupId, targetKey)
    if ('error' in target) {
      toast.error(target.error)
      return
    }
    const visible = groups.find((group) => group.key === target.key)?.worktreeIds ?? []
    const dropIndex = workspaceGroupInsertionIndex(rects, pointerY, visible.length)
    // A drop keeps the user's sort: only manual sort has a position to keep, and then the moved
    // rows get a new rank (the target section is renumbered only when there is no room between
    // the neighbours). Any other sort orders the moved rows itself.
    const order =
      state.sortBy === 'manual'
        ? buildGroupDropOrder(state, groups, target, draggedIds, dropIndex, (key) =>
            workspaceBelongsToGroup(state, key, hostId, target.groupId)
          )
        : new Map<string, { manualOrder: number }>()
    const items = planGroupDropItems(state, hostId, target, draggedIds, order)
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

export function registerWorkspaceGroupDropHandler(): void {
  registerWorkspaceGroupDrop((args) => {
    if (!isDropArgs(args)) {
      return false
    }
    return tryCommitWorkspaceGroupDrop(args)
  }, looseHostSectionKey)
}

function isDropArgs(args: WorkspaceGroupDropArgs): args is DropArgs {
  return 'sourceGroupKey' in args && 'draggedIds' in args && 'x' in args && 'y' in args
}

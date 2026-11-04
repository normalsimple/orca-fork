// Plans and commits a cross-group sidebar drop. Kept free of DOM and toast so it can be tested.
import { getWorktreeExecutionHostId, type ExecutionHostId } from '../../shared/execution-host'
import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { Repo } from '../../shared/repo-types'
import type { Worktree } from '../../shared/worktree/types'
import { folderWorkspaceKey } from '../../shared/workspace-scope'
import { findRepoForHost } from '../../renderer/src/store/slices/repo-host-identity'
import { folderWorkspaceHostId, projectGroupHostId } from './membership'
import {
  EMPTY_PROJECT_GROUP_PREFIX,
  hostDirectoryDefaultHostId,
  looseHostSectionKey
} from './section-keys'
import { isSidebarFieldsNotAppliedError, sidebarFieldsErrorCode } from './sidebar-fields-applied'
import { workspaceGroupLabels } from './workspace-group-labels'

export type GroupDropState = {
  worktreesByRepo: Record<string, Worktree[]>
  repos: readonly Repo[]
  folderWorkspaces: readonly FolderWorkspace[]
  projectGroups: readonly ProjectGroup[]
  getKnownWorktreeById: (id: string, hostId?: ExecutionHostId) => Worktree | undefined
}

export type GroupDropWriter = {
  updateWorktreeMeta: (
    id: string,
    updates: Fields,
    options: { executionHostId: ExecutionHostId }
  ) => Promise<{ ok: true } | { ok: false; error: string; code?: string }>
  updateFolderWorkspace: (
    id: string,
    updates: Fields,
    options: { executionHostId: ExecutionHostId }
  ) => Promise<boolean>
}

/**
 * Fields a drop writes. An own `undefined` value clears the field (see sidebar-field-clear): an
 * unset group follows the project's group, and an unset manual order falls back to sortOrder.
 */
export type Fields = { sidebarGroupId?: string | null; manualOrder?: number }
/** `name` is the workspace's display name, for messages; `storeId` is what the write addresses. */
type Item = {
  kind: 'worktree' | 'folder'
  storeId: string
  name: string
  next: Fields
  previous: Fields
}

export type GroupDropTarget = { groupId: string | null; key: string }

/**
 * Maps a target section to the group a drop really writes. An empty project header sits in the
 * host's loose list, so a drop there is a drop into that list. A group id must be a group saved on
 * the target host: anything else would be stored but render as loose (and hosts clear ids they do
 * not hold), so it is refused instead of half-applied.
 */
export function resolveGroupDropTarget(
  state: Pick<GroupDropState, 'projectGroups'>,
  hostId: ExecutionHostId,
  groupId: string | null,
  key: string
): GroupDropTarget | { error: string } {
  if (groupId === null) {
    return { groupId: null, key }
  }
  if (groupId.startsWith(EMPTY_PROJECT_GROUP_PREFIX)) {
    return { groupId: null, key: looseHostSectionKey(hostId) }
  }
  const onHost = state.projectGroups.some(
    (group) =>
      group.id === groupId && projectGroupHostId(group, hostDirectoryDefaultHostId()) === hostId
  )
  return onHost ? { groupId, key } : { error: workspaceGroupLabels.notOnHost }
}

function findFolder(state: GroupDropState, id: string): FolderWorkspace | undefined {
  return state.folderWorkspaces.find(
    (entry) => entry.id === id || folderWorkspaceKey(entry.id) === id
  )
}

/**
 * Every dragged row must resolve on `hostId`; one that does not cancels the whole drop. An order
 * update for a row that is not dragged (a renumbered section) writes only its manual order.
 */
export function planGroupDropItems(
  state: GroupDropState,
  hostId: ExecutionHostId,
  target: GroupDropTarget,
  draggedIds: readonly string[],
  orderUpdates: ReadonlyMap<string, { manualOrder: number }>
): Item[] | { error: string } {
  const groupsById = new Map(state.projectGroups.map((group) => [group.id, group]))
  // Rows and groups without a host belong to the sidebar's default host, as drawn.
  const defaultHostId = hostDirectoryDefaultHostId()
  const items: Item[] = []
  const dragged = new Set(draggedIds)
  const reordered = [...orderUpdates.keys()].filter((id) => !dragged.has(id))
  for (const id of [...draggedIds, ...reordered]) {
    const order = orderUpdates.get(id)
    const next: Fields = dragged.has(id)
      ? { sidebarGroupId: target.groupId, ...order }
      : { ...order }
    const folder = findFolder(state, id)
    if (folder) {
      const owner = groupsById.get(folder.projectGroupId)
      if (folder.isArchived || folderWorkspaceHostId(folder, owner, defaultHostId) !== hostId) {
        return { error: workspaceGroupLabels.hostMismatch }
      }
      items.push({
        kind: 'folder',
        storeId: folder.id,
        name: folder.name,
        next,
        previous: previousFields(folder, order, dragged.has(id))
      })
      continue
    }
    const worktree = state.getKnownWorktreeById(id, hostId)
    const repo = worktree
      ? findRepoForHost(state.repos, worktree.repoId, { hostId: worktree.hostId })
      : null
    if (
      !worktree ||
      getWorktreeExecutionHostId(worktree, repo ?? undefined, defaultHostId) !== hostId
    ) {
      return { error: workspaceGroupLabels.hostMismatch }
    }
    items.push({
      kind: 'worktree',
      storeId: id,
      name: worktree.displayName,
      next,
      previous: previousFields(worktree, order, dragged.has(id))
    })
  }
  return items
}

// The exact stored values, including absent ones, so a rollback restores the row as it was.
function previousFields(
  row: { sidebarGroupId?: string | null; manualOrder?: number },
  order: { manualOrder: number } | undefined,
  regrouped: boolean
): Fields {
  const previous: Fields = regrouped ? { sidebarGroupId: row.sidebarGroupId } : {}
  if (order) {
    previous.manualOrder = row.manualOrder
  }
  return previous
}

/** `partial`: the host applied the row's other fields but not its group or clear. */
type WriteFailure = { error: string; partial: boolean }

async function writeItem(
  writer: GroupDropWriter,
  hostId: ExecutionHostId,
  item: Item,
  fields: Fields
): Promise<WriteFailure | null> {
  const options = { executionHostId: hostId }
  if (item.kind === 'folder') {
    const ok = await writer.updateFolderWorkspace(item.storeId, fields, options).catch(() => false)
    return ok ? null : { error: workspaceGroupLabels.moveFailed, partial: false }
  }
  const result = await writer
    .updateWorktreeMeta(item.storeId, fields, options)
    .catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
      ...sidebarFieldsErrorCode(error)
    }))
  if (result.ok) {
    return null
  }
  return { error: result.error, partial: isSidebarFieldsNotAppliedError(result) }
}

/**
 * Writes every row, or none: when a write fails, the rows that already landed are put back, and
 * so is the failed row when an older host applied it only in part.
 * Writes run one after another so no two writes for this drop are ever in flight together.
 * Returns the error to show, or null when the whole drop applied.
 */
export async function commitGroupDrop(
  writer: GroupDropWriter,
  hostId: ExecutionHostId,
  items: readonly Item[]
): Promise<string | null> {
  const landed: Item[] = []
  for (const item of items) {
    const failure = await writeItem(writer, hostId, item, item.next)
    if (failure === null) {
      landed.push(item)
      continue
    }
    const { error, partial } = failure
    // An older host applied this row's order but not its group: put that row back too.
    const stuck: Item[] = []
    for (const done of partial ? [item, ...landed.toReversed()] : landed.toReversed()) {
      if ((await writeItem(writer, hostId, done, done.previous)) !== null) {
        stuck.push(done)
      }
    }
    if (stuck.length === 0) {
      return error
    }
    console.error(
      'Workspace group drop rollback failed for',
      stuck.map((entry) => entry.storeId)
    )
    return workspaceGroupLabels.rollbackFailed(
      error,
      stuck.map((entry) => entry.name)
    )
  }
  return null
}

let dropQueue: Promise<void> = Promise.resolve()

/**
 * Runs drops one after another, across separate drag operations: a second drop starts only after
 * the first one's writes and any rollback finished. A failed drop does not stop the next one.
 */
export function enqueueGroupDrop(task: () => Promise<void>): Promise<void> {
  const run = dropQueue.then(task)
  dropQueue = run.catch(() => undefined)
  return run
}

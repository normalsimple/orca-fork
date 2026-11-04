// Test fixture: draws the real host-directory rows under manual sort, drops through the real drag
// groups and buildGroupDropOrder, applies the writes, and draws again.
import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { Repo } from '../../shared/repo-types'
import type { WorktreeLineage } from '../../shared/worktree/lineage-types'
import type { Worktree } from '../../shared/worktree/types'
import type { Row } from '../../shared/sidebar-list/row-types'
import { getWorktreeHostIdentity } from '../../shared/worktree/host-qualified-identity'
import { getWorktreeDragGroups } from '../../renderer/src/components/sidebar/worktree-list/drag/groups'
import { buildHostDirectoryRowPlan } from './host-directory-rows'
import { buildGroupDropOrder } from './group-drop-order'
import { hostDirectorySectionKey } from './section-keys'
import type { GroupDropState } from './workspace-group-drop-plan'

const REPO: Repo = {
  id: 'r1',
  path: '/w/r1',
  displayName: 'alpha',
  badgeColor: '#737373',
  addedAt: 0
}

function group(id: string, tabOrder: number): ProjectGroup {
  return {
    id,
    name: id.toUpperCase(),
    parentPath: '/w',
    executionHostId: 'local',
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

const GROUPS = [group('g1', 0), group('g2', 1)]

export function wt(id: string, extra: Partial<Worktree> = {}): Worktree {
  return {
    id,
    repoId: REPO.id,
    path: `/w/r1/${id}`,
    branch: `refs/heads/${id}`,
    head: 'abc',
    isBare: false,
    isMainWorktree: false,
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    comment: '',
    isUnread: false,
    isPinned: false,
    displayName: id,
    sortOrder: 0,
    lastActivityAt: 0,
    ...extra
  }
}

export type DrawInput = {
  rows: Worktree[]
  /** Rows the sidebar does not show (hide default branch); the drop still sees them. */
  hiddenIds?: ReadonlySet<string>
  lineageById?: Record<string, WorktreeLineage>
}

export function draw(input: DrawInput): Row[] {
  const shown = input.rows.filter((row) => !input.hiddenIds?.has(row.id))
  const plan = buildHostDirectoryRowPlan({
    worktrees: shown,
    repoMap: new Map([[REPO.id, REPO]]),
    projectGroups: GROUPS,
    folderWorkspaces: [] as FolderWorkspace[],
    defaultHostId: 'local',
    workspaceSortBy: 'manual',
    lineageById: input.lineageById ?? {},
    worktreeMap: new Map(shown.map((row) => [row.id, row])),
    nestLineage: input.lineageById !== undefined
  })
  return plan.render(new Set()) as Row[]
}

export function shownIn(rows: readonly Row[], key: string): string[] {
  return rows.flatMap((row) =>
    row.type === 'item' && row.sectionKey === key ? [row.worktree.id] : []
  )
}

export const keyOf = (groupId: string | null): string => hostDirectorySectionKey('local', groupId)

/** Drops `id` into `groupId` at `dropIndex` (counted in the rows shown there), then redraws. */
export function dropAndRedraw(
  input: DrawInput,
  id: string,
  groupId: string | null,
  dropIndex: number
): { shown: string[]; written: string[] } {
  const rows = draw(input)
  const state: GroupDropState = {
    worktreesByRepo: { [REPO.id]: input.rows },
    repos: [REPO],
    folderWorkspaces: [],
    projectGroups: GROUPS,
    getKnownWorktreeById: (known) => input.rows.find((row) => row.id === known)
  }
  const target = { groupId, key: keyOf(groupId) }
  const updates = buildGroupDropOrder(
    state,
    getWorktreeDragGroups(rows),
    target,
    [id],
    dropIndex,
    (candidate) => {
      const row = input.rows.find((entry) => getWorktreeHostIdentity(entry) === candidate)
      return row !== undefined && row.id !== id && (row.sidebarGroupId ?? null) === groupId
    }
  )
  const next = input.rows.map((row) => {
    const update = updates.get(row.id)
    return {
      ...row,
      ...update,
      ...(row.id === id ? { sidebarGroupId: groupId } : {})
    }
  })
  return {
    shown: shownIn(draw({ ...input, rows: next }), target.key),
    written: [...updates.keys()]
  }
}

export function insert(list: readonly string[], index: number, id: string): string[] {
  const rest = list.filter((entry) => entry !== id)
  return [...rest.slice(0, index), id, ...rest.slice(index)]
}

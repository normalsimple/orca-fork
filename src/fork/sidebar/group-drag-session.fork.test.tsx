import { describe, expect, it } from 'vitest'
import type { HostSectionRow } from '../../shared/sidebar-list/host-section-rows'
import {
  getWorktreeDragGroups,
  getWorktreeDragIndexes
} from '../../renderer/src/components/sidebar/worktree-list/drag/groups'
import { getWorktreeDragUnitGroups } from '../../renderer/src/components/sidebar/worktree-list/drag/worktree-drag-units'
import {
  refreshWorktreeSidebarDragSession,
  type WorktreeSidebarDragSession
} from '../../renderer/src/components/sidebar/worktree-list/drag/worktree-sidebar-drag-autoscroll'
import {
  getWorktreeHostIdentity,
  getWorktreeIdFromHostIdentity
} from '../../shared/worktree/host-qualified-identity'
import { hostDirectorySectionKey, looseHostSectionKey } from './section-keys'

function cardKey(id: string): string {
  return getWorktreeHostIdentity({ id })
}

function workspaceIds(ids: readonly string[] | undefined): string[] {
  return (ids ?? []).map(getWorktreeIdFromHostIdentity)
}

const HOST = 'local'
const GROUP = hostDirectorySectionKey(HOST, 'g1')
const LOOSE = looseHostSectionKey(HOST)

function item(id: string, sectionKey: string, depth = 0) {
  return { type: 'item', rowKey: `${sectionKey}:${id}`, sectionKey, depth, worktree: { id } }
}

// The fork's host-directory layout: grouped sections have a header row, the ungrouped list has none.
function rows(looseFirst: boolean): HostSectionRow[] {
  const grouped = [{ type: 'header', key: GROUP }, item('a', GROUP)]
  const loose = [item('b', LOOSE), item('c', LOOSE), item('c-child', LOOSE, 1)]
  return [
    { type: 'host-header', hostId: HOST },
    ...(looseFirst ? [...loose, ...grouped] : [...grouped, ...loose])
  ] as unknown as HostSectionRow[]
}

function startDrag(list: HostSectionRow[], id: string): WorktreeSidebarDragSession | null {
  const sourceGroupKey = getWorktreeDragIndexes(list).groupKeyByRowKey.get(`${LOOSE}:${id}`)!
  const key = cardKey(id)
  const session: WorktreeSidebarDragSession = {
    draggingWorktreeId: key,
    sourceGroupKey,
    draggedIds: [id],
    draggedCopies: [],
    reorderDraggedIds: [id],
    reorderDraggedKeys: [key],
    reorderUnitDraggedKeys: [key],
    rects: [],
    grab: null,
    anchor: null
  }
  // The pointer drag refreshes the session on the next frame; a null result cancels the drag.
  return refreshWorktreeSidebarDragSession({
    session,
    groups: getWorktreeDragGroups(list),
    unitGroups: getWorktreeDragUnitGroups(list),
    rects: []
  })
}

describe('dragging an ungrouped workspace (section without a header row)', () => {
  for (const looseFirst of [false, true]) {
    const where = looseFirst ? 'before' : 'after'
    it(`keeps the drag session when the ungrouped list sits ${where} a group`, () => {
      const list = rows(looseFirst)
      expect(startDrag(list, 'b')).not.toBeNull()
      expect(startDrag(list, 'c')).not.toBeNull()
    })

    it(`keys the drag groups by section, ungrouped list ${where} a group`, () => {
      const list = rows(looseFirst)
      const groups = getWorktreeDragGroups(list)
      expect(workspaceIds(groups.find((group) => group.key === GROUP)?.worktreeIds)).toEqual(['a'])
      expect(workspaceIds(groups.find((group) => group.key === LOOSE)?.worktreeIds)).toEqual([
        'b',
        'c',
        'c-child'
      ])
      const units = getWorktreeDragUnitGroups(list)
      expect(workspaceIds(units.find((group) => group.key === LOOSE)?.worktreeIds)).toEqual([
        'b',
        'c'
      ])
      expect(workspaceIds(units.find((group) => group.key === GROUP)?.worktreeIds)).toEqual(['a'])
    })
  }

  it('leaves upstream headerless rows in the ALL group', () => {
    const list = [item('x', 'all'), item('y', 'all')] as unknown as HostSectionRow[]
    expect(
      getWorktreeDragGroups(list).map((group) => ({
        key: group.key,
        worktreeIds: workspaceIds(group.worktreeIds)
      }))
    ).toEqual([{ key: 'all', worktreeIds: ['x', 'y'] }])
  })
})

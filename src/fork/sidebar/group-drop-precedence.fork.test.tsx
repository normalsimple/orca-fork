import { afterEach, describe, expect, it, vi } from 'vitest'

// The board and status hit tests read the DOM; a sidebar card drop never touches the board.
vi.mock('../../renderer/src/components/sidebar/workspace-board/drag/workspace-kanban-sidebar-drop', () => ({
  getWorkspaceKanbanSidebarDropGroups: () => [],
  getWorkspaceKanbanSidebarDropTarget: () => null,
  isWorkspaceKanbanSidebarDropPointInBoard: () => false,
  resolveWorkspaceKanbanSidebarFullLaneDropIndex: () => 0
}))
vi.mock('../../renderer/src/components/sidebar/workspace-board/drag/workspace-kanban-card-pointer-drag-dom', () => ({
  resolveWorkspaceKanbanCardDropCommitTarget: () => ({ status: null, isPinDrop: false })
}))
vi.mock('../../renderer/src/components/sidebar/worktree-list/drag/status-target', () => ({
  getPointerDropStatusTarget: () => ({ status: null, isPinDrop: false, lineageParentId: 'card' }),
  shouldPreferSidebarStatusDropTarget: () => false
}))

import { registerWorkspaceGroupDrop } from '../../shared/fork-hooks/sidebar-chrome'
import { commitWorktreePointerDrop } from '../../renderer/src/components/sidebar/worktree-list/drag/pointer-commit'
import type { WorktreeDropCommitContext } from '../../renderer/src/components/sidebar/worktree-list/drag/drop-commit-context'
import type { WorktreePointerDrag } from '../../renderer/src/components/sidebar/worktree-list/drag/row-state'
import { looseHostSectionKey } from './section-keys'

function context(): WorktreeDropCommitContext {
  return {
    scrollRef: { current: {} as HTMLDivElement },
    workspaceStatuses: [],
    worktreeDragGroups: [],
    worktreeDragUnitGroups: [],
    computeWorktreeDrop: vi.fn(() => null),
    computeWorktreeStatusDrop: vi.fn(() => null),
    refreshWorktreeDragSession: () => true,
    // The pointer is over the middle of another card: upstream would make it the parent.
    getEligibleLineageDropTarget: (target) => target,
    commitWorktreeLineageParentDrop: vi.fn(() => true),
    clearReorderedWorktreeParents: vi.fn(),
    clearWorktreeDrag: vi.fn(),
    onMoveWorktreesToStatus: vi.fn(),
    onMoveWorktreesToStatusAtIndex: vi.fn(),
    onReorderWorktrees: vi.fn(),
    onPinWorktrees: vi.fn()
  }
}

const drag = {
  sourceGroupKey: 'hd:["local","g1"]',
  draggedIds: ['moved'],
  reorderDraggedIds: ['moved'],
  latestBoardDropTarget: null,
  latestStatusDropTarget: null
} as unknown as WorktreePointerDrag

function drop(ctx: WorktreeDropCommitContext): void {
  commitWorktreePointerDrop({
    event: { clientX: 10, clientY: 20 } as PointerEvent,
    drag,
    ctx,
    onWorkspaceBoardDragPreviewCommit: vi.fn(),
    onDropWorktreesOnWorkspaceBoard: vi.fn()
  })
}

describe('cross-group drop onto the middle of a card', () => {
  afterEach(() => registerWorkspaceGroupDrop(() => false, looseHostSectionKey))

  it('moves the workspace to the group and never sets a parent', () => {
    const groupDrop = vi.fn(() => true)
    registerWorkspaceGroupDrop(groupDrop, looseHostSectionKey)
    const ctx = context()
    drop(ctx)
    expect(groupDrop).toHaveBeenCalledWith(
      expect.objectContaining({ sourceGroupKey: drag.sourceGroupKey, draggedIds: ['moved'] })
    )
    expect(ctx.commitWorktreeLineageParentDrop).not.toHaveBeenCalled()
    expect(ctx.clearWorktreeDrag).toHaveBeenCalled()
  })

  it('keeps upstream lineage parenting when the fork does not take the drop', () => {
    registerWorkspaceGroupDrop(() => false, looseHostSectionKey)
    const ctx = context()
    drop(ctx)
    expect(ctx.commitWorktreeLineageParentDrop).toHaveBeenCalledWith(['moved'], 'card')
  })
})

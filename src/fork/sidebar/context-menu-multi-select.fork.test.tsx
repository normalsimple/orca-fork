/**
 * @vitest-environment happy-dom
 */
// With several workspaces selected, right-clicking one of them opens the bulk menu. The group
// entries (upstream hides them there) and the fork's single-row entries must not show in it, or
// they would act on the clicked row only. Outside the selection the menu is for that row alone.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Worktree } from '../../shared/worktree/types'
import { TooltipProvider } from '../../renderer/src/components/ui/tooltip'
import WorktreeContextMenu from '../../renderer/src/components/sidebar/workspace-actions/context-menu/WorktreeContextMenu'
import { registerSidebarContextMenu } from '../../shared/fork-hooks/sidebar-chrome'
import { registerWorktreeMenuGroups } from '../../shared/fork-hooks/worktree-menu-groups'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const state = {
  updateWorktreeMeta: vi.fn(),
  setWorktreesPinnedAndReveal: vi.fn(),
  workspaceStatuses: [],
  openModal: vi.fn(),
  projectGroups: [],
  // 上游 WSL 启动项按 repos / folderWorkspaces 找主机；测试里没有仓库。
  repos: [],
  folderWorkspaces: [],
  createProjectGroup: vi.fn(),
  moveProjectToGroup: vi.fn(),
  deleteStateByWorktreeId: {},
  worktreeLineageById: {},
  workspaceLineageByChildKey: {},
  updateWorktreeLineage: vi.fn(),
  tabsByWorktree: {},
  ptyIdsByTabId: {},
  browserTabsByWorktree: {},
  // 菜单打开时直接读这两张表。缺了会在判断能否休眠时抛错。
  unifiedTabsByWorktree: {},
  agentStatusByPaneKey: {},
  keybindings: {},
  settings: { activeRuntimeEnvironmentId: null, openInApplications: [] },
  openSettingsPage: vi.fn(),
  openSettingsTarget: vi.fn()
}

vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
    getState: () => state
  })
}))

vi.mock('@/store/selectors', () => ({
  useAllWorktrees: () => [],
  useRepoById: (repoId?: string) =>
    repoId ? { id: repoId, name: repoId, displayName: repoId, projectGroupId: null } : undefined,
  useRepoMap: () => new Map(),
  useWorktreeMap: () => new Map(),
  getRepoMapFromState: () => new Map(),
  getWorktreeMapFromState: () => new Map(),
  getAllWorktreesFromState: () => []
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback,
  i18n: { language: 'en', on: () => {}, off: () => {} }
}))

vi.mock('@/components/sidebar/worktree-list/rows/ProjectGroupNameDialog', () => ({
  ProjectGroupNameDialog: () => null
}))
vi.mock('@/components/sidebar/workspace-actions/parenting/WorktreeParentPickerPopover', () => ({
  WorktreeParentPickerPopover: () => null
}))
vi.mock('@/components/sidebar/workspace-actions/open/WorktreeOpenInMenu', () => ({ WorktreeOpenInSubMenu: () => null }))

const onMove = vi.fn()
const onRemove = vi.fn()
const forkRowAction = vi.fn()
const mounted: { container: HTMLDivElement; root: Root }[] = []

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { ui: { writeClipboardText: vi.fn() } }
  })
  registerWorktreeMenuGroups(() => ({
    groups: [{ id: 'g1', name: 'Group one' } as never, { id: 'g2', name: 'Group two' } as never],
    currentGroupId: 'g1',
    onMove,
    onRemove
  }))
  registerSidebarContextMenu((worktree) => (
    <div role="menuitem" onClick={() => forkRowAction(worktree.id)}>
      Fork row action
    </div>
  ))
})

afterEach(() => {
  for (const { root, container } of mounted) {
    act(() => root.unmount())
    container.remove()
  }
  mounted.length = 0
  registerWorktreeMenuGroups(undefined)
  registerSidebarContextMenu(() => null)
  vi.clearAllMocks()
})

function worktree(id: string): Worktree {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the menu reads only these fields.
  return {
    id: `repo::${id}`,
    repoId: 'repo',
    displayName: id,
    branch: `refs/heads/${id}`,
    path: `/path/${id}`,
    isMainWorktree: false
  } as Worktree
}

function openMenu(target: Worktree, selection: readonly Worktree[]): void {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ container, root })
  // Upstream's selectForContextMenu: the selection when the row is in it, else the row alone.
  const select = (): readonly Worktree[] =>
    selection.length > 1 && selection.some((entry) => entry.id === target.id) ? selection : [target]
  act(() => {
    root.render(
      <TooltipProvider>
        <WorktreeContextMenu
          worktree={target}
          selectedWorktrees={selection}
          onContextMenuSelect={select}
        >
          <div>Card</div>
        </WorktreeContextMenu>
      </TooltipProvider>
    )
  })
  act(() => {
    container
      .querySelector('[data-worktree-context-menu-scope]')
      ?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
      )
  })
}

function menuLabels(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
    (element) => element.textContent ?? ''
  )
}

describe('workspace context menu with several workspaces selected', () => {
  const a = worktree('a')
  const b = worktree('b')
  const c = worktree('c')

  it('shows no group or fork single-row entries when the clicked row is in the selection', () => {
    openMenu(a, [a, b])
    const labels = menuLabels()
    expect(labels.some((label) => label.includes('Remove from group'))).toBe(false)
    expect(labels.some((label) => label.includes('Move to group'))).toBe(false)
    expect(labels).not.toContain('Fork row action')
  })

  it('offers them for the clicked row alone when it is outside the selection', () => {
    openMenu(c, [a, b])
    const labels = menuLabels()
    expect(labels.some((label) => label.includes('Remove from group'))).toBe(true)
    expect(labels).toContain('Fork row action')
  })

  it('offers them for a single selected row', () => {
    openMenu(a, [a])
    expect(menuLabels().some((label) => label.includes('Remove from group'))).toBe(true)
    expect(menuLabels()).toContain('Fork row action')
  })
})

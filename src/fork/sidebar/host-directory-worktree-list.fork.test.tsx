// 登记 host-directory 后渲染整份 WorktreeList。上游对每个分区读 group.repoIds；
// 分区没有 group 时，这里抛 TypeError: Cannot read properties of undefined (reading 'repoIds')。
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { Repo } from '../../shared/repo-types'
import type { Worktree } from '../../shared/worktree/types'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import {
  createAppStoreModuleMock,
  createDropdownMenuModuleMock,
  createProjectHeaderDragModuleMock,
  createReactVirtualModuleMock,
  createTooltipModuleMock,
  createVirtualizedScrollAnchorModuleMock,
  createWorktreeCardAgentsModuleMock,
  createWorktreeCardModuleMock,
  createWorktreeContextMenuModuleMock,
  createWorktreeTitleInlineRenameModuleMock,
  loadWorktreeList,
  mockStore,
  renderWorktreeListMarkup
} from '../../renderer/src/components/sidebar/worktree-list/listing/worktree-list-lineage-card-test-harness'
import { setLineageFixtureState } from './lineage-fixture-state'
import { buildHostDirectoryRowPlan } from './host-directory-rows'
import { installHostDirectoryRowPlan } from './install-row-plan'
import { registerHostDirectoryMode } from './register-mode'
import {
  HOST_DIRECTORY_GROUP_BY,
  PINNED_SECTION_KEY,
  hostDirectorySectionKey
} from './section-keys'

vi.mock('@/store', () => createAppStoreModuleMock())
vi.mock('@tanstack/react-virtual', () => createReactVirtualModuleMock())
vi.mock('@/hooks/useVirtualizedScrollAnchor', () => createVirtualizedScrollAnchorModuleMock())
vi.mock('../../renderer/src/components/sidebar/worktree-list/drag/project-header-drag', () =>
  createProjectHeaderDragModuleMock()
)
vi.mock('../../renderer/src/components/sidebar/workspace-card/surface/WorktreeCard', () => createWorktreeCardModuleMock())
vi.mock('../../renderer/src/components/sidebar/workspace-card/activity/WorktreeCardAgents', () =>
  createWorktreeCardAgentsModuleMock()
)
vi.mock('../../renderer/src/components/sidebar/workspace-card/identity/WorktreeTitleInlineRename', () =>
  createWorktreeTitleInlineRenameModuleMock()
)
vi.mock('../../renderer/src/components/sidebar/workspace-actions/context-menu/WorktreeContextMenu', () =>
  createWorktreeContextMenuModuleMock()
)
vi.mock('@/components/ui/tooltip', () => createTooltipModuleMock())
vi.mock('@/components/ui/dropdown-menu', () => createDropdownMenuModuleMock())

registerHostDirectoryMode()
installHostDirectoryRowPlan()

function repo(id: string, name: string, groupId: string | null): Repo {
  return {
    id,
    path: `/srv/wt/${id}`,
    displayName: name,
    badgeColor: '#737373',
    addedAt: 0,
    projectGroupId: groupId
  }
}

function workspace(id: string, repoId: string, name: string, pinned = false): Worktree {
  return {
    id,
    repoId,
    path: `/srv/wt/${repoId}/${id}`,
    branch: 'refs/heads/main',
    head: 'abc',
    isBare: false,
    isMainWorktree: false,
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    comment: '',
    isUnread: false,
    isPinned: pinned,
    displayName: name,
    sortOrder: 0,
    lastActivityAt: 0
  }
}

function group(id: string, name: string): ProjectGroup {
  return {
    id,
    name,
    parentPath: '/srv/wt',
    executionHostId: LOCAL_EXECUTION_HOST_ID,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

describe('WorktreeList host-directory sections', () => {
  beforeAll(async () => {
    await loadWorktreeList()
  }, 60_000)

  it('renders pinned and directory rows after startup in host-directory mode', async () => {
    setLineageFixtureState('repo', { projectGrouped: true })
    mockStore.state.groupBy = HOST_DIRECTORY_GROUP_BY
    // host-directory 会留下主机标题，菜单渲染时要读这份列表。
    mockStore.state.runtimeEnvironments = []
    const byRepo = mockStore.state.worktreesByRepo as Record<string, Worktree[]>
    const pinned = byRepo['repo-1'][0]
    pinned.isPinned = true
    pinned.displayName = 'pinned workspace'

    const markup = await renderWorktreeListMarkup()

    expect(markup).toContain('pinned workspace')
    expect(markup).toContain('lineage child with agent')
    expect(markup).toContain('Personal')
  })

  it('fills repoIds from the repos present in each directory, including pinned', () => {
    const services = group('grp-services', 'Services')
    const api = repo('api', 'api', services.id)
    const web = repo('web', 'web', services.id)
    const notes = repo('notes', 'notes', null)
    const pinnedApi = workspace('wt-pinned', api.id, 'pinned api', true)
    const apiMain = workspace('wt-api', api.id, 'api main')
    const webMain = workspace('wt-web', web.id, 'web main')
    const loose = workspace('wt-notes', notes.id, 'loose notes')
    const plan = buildHostDirectoryRowPlan({
      worktrees: [pinnedApi, apiMain, webMain, loose],
      repoMap: new Map([api, web, notes].map((entry) => [entry.id, entry])),
      projectGroups: [services],
      defaultHostId: LOCAL_EXECUTION_HOST_ID,
      pinnedDisplayPolicy: 'single-location'
    })
    const repoIds = new Map(
      plan.occurrencePlan.sections.map(({ key, group: sectionGroup }) => [
        key,
        sectionGroup.repoIds
      ])
    )

    expect(repoIds.get(PINNED_SECTION_KEY)).toEqual(new Set([api.id]))
    expect(repoIds.get(hostDirectorySectionKey(LOCAL_EXECUTION_HOST_ID, services.id))).toEqual(
      new Set([api.id, web.id])
    )
    expect(repoIds.get(hostDirectorySectionKey(LOCAL_EXECUTION_HOST_ID, null))).toEqual(
      new Set([notes.id])
    )
    expect([...repoIds.values()].every((ids) => ids instanceof Set && ids.size > 0)).toBe(true)
  })
})

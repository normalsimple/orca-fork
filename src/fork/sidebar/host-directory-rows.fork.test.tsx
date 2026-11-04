import { describe, expect, it } from 'vitest'
import { normalizeExecutionHostId, type ExecutionHostId } from '../../shared/execution-host'
import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { Repo } from '../../shared/repo-types'
import type { Worktree } from '../../shared/worktree/types'
import { getDefaultUIState } from '../../shared/constants'
import { hydrateSidebarGroupBy } from '../../shared/fork-hooks/sidebar-group-mode'
import {
  projectGroupDeleteKeepsFolderWorkspaces,
  resolveDeleteProjectGroupRemoveContainedProjects
} from '../../shared/fork-hooks/project-group-delete'
import { applyProjectGroupDeleteCascade } from '../../renderer/src/store/project-groups/project-group-removal-state'
import { buildRows } from '../../renderer/src/components/sidebar/worktree-list/grouping/build-rows.test-fixture'
import { addHostSectionRows } from '../../shared/sidebar-list/host-section-rows'
import type { WorktreeGroupBy } from '../../shared/sidebar-list/row-types'
import { registerForkModules } from '../register'
import { installHostDirectoryRowPlan } from './install-row-plan'
import { workspaceGroupDropBlocked, workspaceGroupInsertionIndex } from './workspace-group-drop'
import {
  confirmSettingsProjectRemoval,
  settingsBulkSnapshot,
  toggleAllSettingsProjects,
  toggleSettingsProject
} from './settings-project-bulk'
import {
  HOST_DIRECTORY_GROUP_BY,
  hostDirectorySectionKey,
  registerHostDirectorySortReader
} from './section-keys'
import { planSidebarRows } from '../../shared/sidebar-list/sidebar-row-plan'
import { createSidebarPRGroupReader } from '../../renderer/src/components/sidebar/worktree-list/grouping/pr-group-key'
import { cloneDefaultWorkspaceStatuses } from '../../shared/workspace-statuses'
import { registerForkRendererModules } from '../register-renderer'
import { getWorktreeDragGroups } from '../../renderer/src/components/sidebar/worktree-list/drag/groups'
import { getWorktreeIdFromHostIdentity } from '../../shared/worktree/host-qualified-identity'
import {
  hiddenWorktreeMatchesExtra,
  hiddenWorktreeSearchMinimum
} from '../../shared/fork-hooks/sidebar-chrome'

registerForkModules()
registerForkRendererModules()
installHostDirectoryRowPlan()

function hostId(value: string): ExecutionHostId {
  const id = normalizeExecutionHostId(value)
  if (!id) {
    throw new Error(`Unusable host id: ${value}`)
  }
  return id
}

const DEVBOX = hostId('ssh:devbox')
const MINI = hostId('ssh:mini')

function repo(id: string, path: string, name: string, hostId?: ExecutionHostId): Repo {
  return {
    id,
    path,
    displayName: name,
    badgeColor: '#737373',
    addedAt: 0,
    ...(hostId ? { executionHostId: hostId } : {})
  }
}

function workspace(
  id: string,
  repoId: string,
  path: string,
  name: string,
  hostId?: ExecutionHostId,
  extra: Partial<Worktree> = {}
): Worktree {
  return {
    id,
    repoId,
    path,
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
    isPinned: false,
    displayName: name,
    sortOrder: 0,
    lastActivityAt: 0,
    ...(hostId ? { hostId } : {}),
    ...extra
  }
}

function projectGroup(
  id: string,
  name: string,
  hostId: ExecutionHostId,
  tabOrder = 0
): ProjectGroup {
  return {
    id,
    name,
    parentPath: '/srv/wt',
    executionHostId: hostId,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function hostDirectoryRows(args: {
  worktrees: Worktree[]
  repos: Repo[]
  groups?: ProjectGroup[]
  folders?: FolderWorkspace[]
  placeholders?: string[]
  pending?: { creationId: string; repoId: string }[]
  sortBy?: 'name' | 'smart' | 'recent' | 'manual' | 'repo'
  repoOfWorktree?: (worktree: Worktree) => Repo | undefined
}) {
  const repoMap = new Map(args.repos.map((entry) => [entry.id, entry]))
  // The registered plan reads the sidebar sort from the store; tests pin it ('recent' is its default).
  registerHostDirectorySortReader(() => args.sortBy ?? 'recent')
  return planSidebarRows({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: host-directory is a registered mode id, not one of the built-in literals.
    groupBy: HOST_DIRECTORY_GROUP_BY as WorktreeGroupBy,
    sortBy: args.sortBy ?? 'recent',
    worktrees: args.worktrees,
    repoMap,
    ...(args.repoOfWorktree ? { repoOfWorktree: args.repoOfWorktree } : {}),
    prGroupOf: createSidebarPRGroupReader(repoMap, null),
    workspaceStatuses: cloneDefaultWorkspaceStatuses(),
    projectOrderBy: 'manual',
    lineageById: {},
    worktreeMap: new Map(args.worktrees.map((entry) => [entry.id, entry])),
    nestLineage: false,
    projectGroups: args.groups ?? [],
    placeholderRepoIds: new Set(args.placeholders ?? []),
    importedWorktreesByRepo: new Map(),
    newExternalWorktreesInboxByRepo: new Map(),
    pendingCreations: args.pending ?? [],
    folderWorkspaces: args.folders ?? [],
    defaultHostId: 'local',
    pinnedDisplayPolicy: 'single-location',
    filterRepoIds: []
  }).render(new Set())
}

describe('host-directory sidebar rows', () => {
  it('uses host-directory as the default group mode', () => {
    expect(getDefaultUIState().groupBy).toBe(HOST_DIRECTORY_GROUP_BY)
  })

  it('reads a saved project grouping as host-directory', () => {
    // The main-process normalizer is checked in default-group-by.fork.test.ts.
    expect(hydrateSidebarGroupBy('repo')).toBe(HOST_DIRECTORY_GROUP_BY)
    expect(hydrateSidebarGroupBy('parent')).toBe(HOST_DIRECTORY_GROUP_BY)
  })

  it('keeps the same directory on two hosts in separate sections', () => {
    const repos = [
      repo('api-devbox', '/srv/wt/project', 'project', DEVBOX),
      repo('api-mini', '/srv/wt/project', 'project', MINI)
    ]
    const rows = hostDirectoryRows({
      repos,
      worktrees: [
        workspace('wt-devbox', 'api-devbox', '/srv/wt/project', 'main', DEVBOX),
        workspace('wt-mini', 'api-mini', '/srv/wt/project', 'main', MINI)
      ]
    })
    const items = rows.filter((row) => row.type === 'item')
    expect(items.map((row) => (row.type === 'item' ? row.sectionKey : ''))).toEqual([
      hostDirectorySectionKey(DEVBOX, null),
      hostDirectorySectionKey(MINI, null)
    ])
    expect(items.map((row) => (row.type === 'item' ? row.directoryLabel : ''))).toEqual([
      'project',
      'project'
    ])
    expect(rows.some((row) => row.type === 'header' && row.repo)).toBe(false)
  })

  it('disambiguates two directories with the same name on one host', () => {
    const repos = [
      repo('work', '/srv/wt/work/api', 'api', DEVBOX),
      repo('oss', '/srv/wt/oss/api', 'api', DEVBOX)
    ]
    const rows = hostDirectoryRows({
      repos,
      worktrees: [
        workspace('wt-work', 'work', '/srv/wt/work/api', 'main', DEVBOX),
        workspace('wt-oss', 'oss', '/srv/wt/oss/api', 'main', DEVBOX)
      ]
    })
    // 两个工作区显示名都是 api。上游用主机限定 id 打破平局，wt-oss 排在 wt-work 前面。
    expect(rows.filter((row) => row.type === 'item').map((row) => row.directoryLabel)).toEqual([
      'oss/api',
      'work/api'
    ])
  })

  it('strips a group parent directory from a checkout that lives outside the repo path', () => {
    const rows = hostDirectoryRows({
      repos: [repo('api', '/elsewhere/api', 'api', DEVBOX)],
      groups: [{ ...projectGroup('grp-api', 'Services', DEVBOX), parentPath: '/srv/wt/group' }],
      worktrees: [
        workspace('wt-api', 'api', '/srv/wt/group/checkout', 'main', DEVBOX, {
          sidebarGroupId: 'grp-api'
        })
      ]
    })
    expect(rows.find((row) => row.type === 'item')?.directoryLabel).toBe('checkout')
  })

  it('keeps a disambiguated name when the repo is inside the group parent', () => {
    const rows = hostDirectoryRows({
      repos: [
        repo('work', '/srv/wt/group/work/api', 'api', DEVBOX),
        repo('oss', '/srv/wt/group/oss/api', 'api', DEVBOX)
      ],
      groups: [{ ...projectGroup('grp-api', 'Services', DEVBOX), parentPath: '/srv/wt/group' }],
      worktrees: [
        workspace('wt-work', 'work', '/srv/wt/group/work/api', 'main', DEVBOX, {
          sidebarGroupId: 'grp-api'
        }),
        workspace('wt-oss', 'oss', '/srv/wt/group/oss/api', 'main', DEVBOX, {
          sidebarGroupId: 'grp-api'
        })
      ]
    })
    // 同名时按主机限定 id 排序，目录标签本身仍是消歧后的 work/api 与 oss/api。
    expect(rows.filter((row) => row.type === 'item').map((row) => row.directoryLabel)).toEqual([
      'oss/api',
      'work/api'
    ])
  })

  it('does not strip the parent when the group holds two checkouts or a pending create', () => {
    const repos = [repo('api', '/elsewhere/api', 'api', DEVBOX)]
    const groups = [{ ...projectGroup('grp-api', 'Services', DEVBOX), parentPath: '/srv/wt/group' }]
    const paired = hostDirectoryRows({
      repos,
      groups,
      worktrees: [
        workspace('wt-one', 'api', '/srv/wt/group/one', 'one', DEVBOX, {
          sidebarGroupId: 'grp-api'
        }),
        workspace('wt-two', 'api', '/srv/wt/group/two', 'two', DEVBOX, {
          sidebarGroupId: 'grp-api'
        })
      ]
    })
    expect(paired.filter((row) => row.type === 'item').map((row) => row.directoryLabel)).toEqual([
      'api',
      'api'
    ])
    const pending = hostDirectoryRows({
      repos,
      groups,
      pending: [{ creationId: 'create-1', repoId: 'api' }],
      worktrees: [
        workspace('wt-api', 'api', '/srv/wt/group/checkout', 'main', DEVBOX, {
          sidebarGroupId: 'grp-api'
        })
      ]
    })
    expect(pending.find((row) => row.type === 'item')?.directoryLabel).toBe('api')
  })

  it('nests a group under its host and keeps an empty group', () => {
    const rows = hostDirectoryRows({
      repos: [repo('web', '/srv/wt/web', 'web', DEVBOX)],
      groups: [
        projectGroup('grp-web', 'Services', DEVBOX),
        projectGroup('grp-empty', 'Empty', DEVBOX, 1)
      ],
      worktrees: [
        workspace('wt-web', 'web', '/srv/wt/web', 'main', DEVBOX, { sidebarGroupId: 'grp-web' })
      ]
    })
    const headers = rows.filter((row) => row.type === 'header')
    expect(headers.map((row) => (row.type === 'header' ? row.label : ''))).toEqual([
      'Services',
      'Empty'
    ])
    expect(headers.every((row) => row.type === 'header' && row.hostId === DEVBOX)).toBe(true)
    const item = rows.find((row) => row.type === 'item')
    expect(item && item.type === 'item' ? item.sectionKey : '').toBe(
      hostDirectorySectionKey(DEVBOX, 'grp-web')
    )
  })

  it('shows leftover group ids as ungrouped, and those rows can still be dragged', () => {
    const rows = hostDirectoryRows({
      // The project itself is in the group, so a workspace without its own id inherits it.
      repos: [{ ...repo('web', '/srv/wt/web', 'web', DEVBOX), projectGroupId: 'grp-web' }],
      groups: [projectGroup('grp-web', 'Services', DEVBOX)],
      worktrees: [
        // Points at a group that was deleted: ungrouped, not the project's group.
        workspace('wt-gone', 'web', '/srv/wt/gone', 'gone', DEVBOX, { sidebarGroupId: 'deleted' }),
        // Explicitly ungrouped while the project still points at a group.
        workspace('wt-null', 'web', '/srv/wt/null', 'null', DEVBOX, { sidebarGroupId: null }),
        workspace('wt-in', 'web', '/srv/wt/in', 'in', DEVBOX)
      ]
    })
    const keyOf = (id: string) => {
      const row = rows.find((entry) => entry.type === 'item' && entry.worktree.id === id)
      return row && row.type === 'item' ? row.sectionKey : ''
    }
    expect(keyOf('wt-gone')).toBe(hostDirectorySectionKey(DEVBOX, null))
    expect(keyOf('wt-null')).toBe(hostDirectorySectionKey(DEVBOX, null))
    expect(keyOf('wt-in')).toBe(hostDirectorySectionKey(DEVBOX, 'grp-web'))
    // The drag groups have one for the ungrouped list, holding both leftover rows.
    const loose = getWorktreeDragGroups(rows).find(
      (entry) => entry.key === hostDirectorySectionKey(DEVBOX, null)
    )
    expect(loose?.worktreeIds.map(getWorktreeIdFromHostIdentity)).toEqual(
      expect.arrayContaining(['wt-gone', 'wt-null'])
    )
  })

  it('ignores a project group that lives on another host', () => {
    const rows = hostDirectoryRows({
      repos: [repo('web', '/srv/wt/web', 'web', DEVBOX)],
      groups: [projectGroup('grp-mini', 'Remote', MINI)],
      worktrees: [workspace('wt-web', 'web', '/srv/wt/web', 'main', DEVBOX)]
    })
    const item = rows.find((row) => row.type === 'item')
    expect(item && item.type === 'item' ? item.sectionKey : '').toBe(
      hostDirectorySectionKey(DEVBOX, null)
    )
  })

  it('sorts by name inside a section and leaves smart order alone', () => {
    const repos = [repo('web', '/srv/wt/web', 'web', DEVBOX)]
    const worktrees = [
      workspace('b', 'web', '/srv/wt/web-b', 'zeta', DEVBOX, { lastActivityAt: 1 }),
      workspace('a', 'web', '/srv/wt/web-a', 'alpha', DEVBOX, { lastActivityAt: 9 })
    ]
    expect(
      hostDirectoryRows({ repos, worktrees, sortBy: 'name' })
        .filter((row) => row.type === 'item')
        .map((row) => (row.type === 'item' ? row.worktree.displayName : ''))
    ).toEqual(['alpha', 'zeta'])
    expect(
      hostDirectoryRows({ repos, worktrees, sortBy: 'smart' })
        .filter((row) => row.type === 'item')
        .map((row) => (row.type === 'item' ? row.worktree.id : ''))
    ).toEqual(['b', 'a'])
  })

  it('emits a pinned section and a create header for an empty project', () => {
    const repos = [
      repo('web', '/srv/wt/web', 'web', DEVBOX),
      repo('empty', '/srv/wt/empty', 'empty', DEVBOX)
    ]
    const rows = hostDirectoryRows({
      repos,
      placeholders: ['empty'],
      worktrees: [workspace('wt-web', 'web', '/srv/wt/web', 'main', DEVBOX, { isPinned: true })]
    })
    expect(rows.some((row) => row.type === 'header' && row.key === 'pinned')).toBe(true)
    expect(rows.some((row) => row.type === 'header' && row.repo?.id === 'empty')).toBe(true)
  })

  it('inherits each host copy of a same-id project from its own registration', () => {
    const onDevbox = { ...repo('web', '/srv/wt/web', 'web', DEVBOX), projectGroupId: 'g-dev' }
    const onMini = { ...repo('web', '/srv/wt/web', 'web', MINI), projectGroupId: 'g-mini' }
    const rows = hostDirectoryRows({
      // The bare-id map can hold only one of the two registrations.
      repos: [onMini],
      repoOfWorktree: (worktree) => (worktree.hostId === DEVBOX ? onDevbox : onMini),
      groups: [projectGroup('g-dev', 'Dev', DEVBOX), projectGroup('g-mini', 'Mini', MINI)],
      worktrees: [
        workspace('wt-dev', 'web', '/srv/wt/web/dev', 'dev', DEVBOX),
        workspace('wt-mini', 'web', '/srv/wt/web/mini', 'mini', MINI)
      ]
    })
    const sectionOf = (id: string) =>
      rows.flatMap((row) =>
        row.type === 'item' && row.worktree.id === id ? [row.sectionKey] : []
      )[0]
    expect(sectionOf('wt-dev')).toBe(hostDirectorySectionKey(DEVBOX, 'g-dev'))
    expect(sectionOf('wt-mini')).toBe(hostDirectorySectionKey(MINI, 'g-mini'))
  })

  it('lists both pinned copies of a same-id workspace on two hosts, once each', () => {
    const rows = hostDirectoryRows({
      repos: [repo('web', '/srv/wt/web', 'web', DEVBOX)],
      worktrees: [
        workspace('wt-web', 'web', '/srv/wt/web', 'main', DEVBOX, { isPinned: true }),
        workspace('wt-web', 'web', '/srv/wt/web', 'main', MINI, { isPinned: true })
      ]
    })
    const pinned = rows.flatMap((row) =>
      row.type === 'item' && row.sectionKey === 'pinned' ? [row] : []
    )
    expect(pinned.map((row) => row.worktree.hostId).sort()).toEqual([DEVBOX, MINI].sort())
    expect(new Set(pinned.map((row) => row.rowKey)).size).toBe(2)
  })

  it('still emits repo headers for the built-in project mode', () => {
    const entry = repo('web', '/srv/wt/web', 'web')
    const rows = buildRows(
      'repo',
      [workspace('wt-web', 'web', '/srv/wt/web', 'main')],
      new Map([[entry.id, entry]]),
      null,
      new Set()
    )
    expect(rows.some((row) => row.type === 'header' && row.repo?.id === 'web')).toBe(true)
  })

  it('keeps a host header when only one host is visible', () => {
    const entry = repo('web', '/srv/wt/web', 'web', DEVBOX)
    const rows = hostDirectoryRows({
      repos: [entry],
      worktrees: [workspace('wt-web', 'web', '/srv/wt/web', 'main', DEVBOX)]
    }).map((row) => (row.type === 'item' ? { ...row, hostContextLabel: 'devbox' } : row))
    const sectioned = addHostSectionRows({
      rows,
      hostOptions: [
        { id: DEVBOX, kind: 'ssh', label: 'devbox', detail: 'devbox', health: 'available' }
      ],
      workspaceHostScope: 'all',
      defaultHostId: 'local',
      // 上游现在要求调用方传入本机标题；这两处主机都在 hostOptions 里，标题不会被用到。
      localHostLabel: 'Local',
      preferProjectGrouping: true,
      retainSingleHostHeader: true
    })
    expect(sectioned.some((row) => row.type === 'host-header' && row.hostId === DEVBOX)).toBe(true)
    const kept = sectioned.find((row) => row.type === 'item')
    expect(kept?.type === 'item' ? kept.hostContextLabel : 'missing').toBeUndefined()
    const plain = addHostSectionRows({
      rows,
      hostOptions: [
        { id: DEVBOX, kind: 'ssh', label: 'devbox', detail: 'devbox', health: 'available' }
      ],
      workspaceHostScope: 'all',
      defaultHostId: 'local',
      localHostLabel: 'Local',
      preferProjectGrouping: true
    })
    expect(plain.some((row) => row.type === 'host-header')).toBe(false)
    const labeled = plain.find((row) => row.type === 'item')
    expect(labeled?.type === 'item' ? labeled.hostContextLabel : undefined).toBe('devbox')
  })

  it('groups a directory header by its own hostId and keeps that single host title', () => {
    // 标题上的仓库在本机，hostId 在另一台机器。上游只认仓库，会把这行留在本机或提前返回。
    const header = {
      type: 'header' as const,
      key: 'services',
      label: 'Services',
      count: 0,
      icon: { kind: 'project' as const },
      hostId: DEVBOX,
      repo: repo('web', '/srv/wt/web', 'web')
    }
    const args = {
      rows: [header],
      hostOptions: [
        {
          id: DEVBOX,
          kind: 'ssh' as const,
          label: 'devbox',
          detail: 'devbox',
          health: 'available' as const
        }
      ],
      workspaceHostScope: 'all' as const,
      defaultHostId: 'local' as const,
      localHostLabel: 'Local',
      preferProjectGrouping: true
    }
    const sectioned = addHostSectionRows({ ...args, retainSingleHostHeader: true })
    expect(
      sectioned.map((row) =>
        row.type === 'host-header' ? row.hostId : row.type === 'header' ? row.key : row.type
      )
    ).toEqual([DEVBOX, 'services'])
    expect(sectioned.find((row) => row.type === 'header')).toBe(header)
    const plain = addHostSectionRows(args)
    expect(plain.some((row) => row.type === 'host-header')).toBe(false)
    expect(plain.find((row) => row.type === 'header')).toBe(header)
  })

  it('keeps one host title per host when project grouping would skip them', () => {
    const rows = hostDirectoryRows({
      repos: [repo('web', '/srv/wt/web', 'web', DEVBOX), repo('api', '/srv/wt/api', 'api', MINI)],
      worktrees: [
        workspace('wt-dev', 'web', '/srv/wt/web', 'dev', DEVBOX),
        workspace('wt-mini', 'api', '/srv/wt/api', 'mini', MINI)
      ]
    })
    const hostOptions = [
      {
        id: DEVBOX,
        kind: 'ssh' as const,
        label: 'devbox',
        detail: 'devbox',
        health: 'available' as const
      },
      {
        id: MINI,
        kind: 'ssh' as const,
        label: 'mini',
        detail: 'mini',
        health: 'available' as const
      }
    ]
    const sectioned = addHostSectionRows({
      rows,
      hostOptions,
      workspaceHostScope: 'all',
      defaultHostId: 'local',
      localHostLabel: 'Local',
      preferProjectGrouping: true,
      retainSingleHostHeader: true
    })
    expect(sectioned.flatMap((row) => (row.type === 'host-header' ? [row.hostId] : []))).toEqual([
      DEVBOX,
      MINI
    ])
    const plain = addHostSectionRows({
      rows,
      hostOptions,
      workspaceHostScope: 'all',
      defaultHostId: 'local',
      localHostLabel: 'Local',
      preferProjectGrouping: true
    })
    expect(plain.some((row) => row.type === 'host-header')).toBe(false)
  })
})

describe('project group delete ungroups', () => {
  it('forces ungroup while the option is checked and keeps folder workspaces', () => {
    expect(resolveDeleteProjectGroupRemoveContainedProjects(true)).toBe(false)
    expect(projectGroupDeleteKeepsFolderWorkspaces()).toBe(true)
    const folder: FolderWorkspace = {
      id: 'folder-1',
      projectGroupId: 'grp-web',
      name: 'notes',
      folderPath: '/srv/wt/notes',
      executionHostId: DEVBOX,
      linkedTask: null,
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 0,
      createdAt: 0,
      updatedAt: 0
    }
    const next = applyProjectGroupDeleteCascade(
      {
        projectGroups: [projectGroup('grp-web', 'Services', DEVBOX)],
        folderWorkspaces: [folder],
        repos: [{ ...repo('web', '/srv/wt/web', 'web', DEVBOX), projectGroupId: 'grp-web' }]
      },
      'grp-web',
      DEVBOX
    )
    expect(next.folderWorkspaces.map((entry) => entry.id)).toEqual(['folder-1'])
    expect(next.repos[0]?.projectGroupId).toBeNull()
    expect(next.projectGroups).toEqual([])
  })
})

describe('settings bulk selection', () => {
  it('arms removal on the first click and clears the selection when toggling', () => {
    toggleSettingsProject('repo-web')
    expect(settingsBulkSnapshot().selected.has('repo-web')).toBe(true)
    void confirmSettingsProjectRemoval(['repo-web'])
    expect(settingsBulkSnapshot().armed).toBe(true)
    toggleAllSettingsProjects(['repo-web'])
    expect(settingsBulkSnapshot().armed).toBe(false)
    expect(settingsBulkSnapshot().selected.size).toBe(0)
  })
})

describe('hidden workspace search', () => {
  it('shows the search from the first archived workspace and matches the branch', () => {
    expect(hiddenWorktreeSearchMinimum()).toBe(1)
    expect(
      hiddenWorktreeMatchesExtra(
        { displayName: 'main', path: '/srv/wt/project', branch: 'topic' },
        'topic'
      )
    ).toBe(true)
    expect(
      hiddenWorktreeMatchesExtra(
        { displayName: 'other', path: '/srv/wt/other', branch: 'main' },
        'topic'
      )
    ).toBe(false)
  })
})

describe('workspace group drop', () => {
  it('blocks a drop onto another host', () => {
    expect(workspaceGroupDropBlocked(DEVBOX, MINI)).toBe(true)
    expect(workspaceGroupDropBlocked(DEVBOX, DEVBOX)).toBe(false)
  })

  it('inserts before the card whose midpoint is below the pointer', () => {
    const rects = [
      { top: 0, bottom: 20, groupIndex: 0 },
      { top: 20, bottom: 40, groupIndex: 1 }
    ]
    expect(workspaceGroupInsertionIndex(rects, 9, 2)).toBe(0)
    expect(workspaceGroupInsertionIndex(rects, 25, 2)).toBe(1)
    expect(workspaceGroupInsertionIndex(rects, 48, 2)).toBe(2)
  })
})

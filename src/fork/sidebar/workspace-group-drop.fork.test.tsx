import { describe, expect, it, vi } from 'vitest'
import { normalizeExecutionHostId, type ExecutionHostId } from '../../shared/execution-host'
import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { Repo } from '../../shared/repo-types'
import type { Worktree } from '../../shared/worktree/types'
import { folderWorkspaceKey } from '../../shared/workspace-scope'
import {
  emptyProjectSectionKey,
  hostDirectorySectionKey,
  looseHostSectionKey
} from './section-keys'
import {
  commitGroupDrop,
  enqueueGroupDrop,
  planGroupDropItems,
  resolveGroupDropTarget,
  type Fields,
  type GroupDropState,
  type GroupDropWriter
} from './workspace-group-drop-plan'
import {
  SIDEBAR_FIELDS_NOT_APPLIED_CODE,
  SidebarFieldsNotAppliedError,
  sidebarFieldsNotAppliedMessage
} from './sidebar-fields-applied'

function hostId(value: string): ExecutionHostId {
  const id = normalizeExecutionHostId(value)
  if (!id) {
    throw new Error(`Unusable host id: ${value}`)
  }
  return id
}

const DEVBOX = hostId('ssh:devbox')
const MINI = hostId('ssh:mini')

const repos: Repo[] = [
  {
    id: 'r1',
    path: '/srv/r1',
    displayName: 'r1',
    badgeColor: '#737373',
    addedAt: 0,
    executionHostId: DEVBOX,
    projectGroupId: 'g-dev'
  },
  {
    id: 'r2',
    path: '/srv/r2',
    displayName: 'r2',
    badgeColor: '#737373',
    addedAt: 0,
    executionHostId: MINI
  }
]

function worktree(
  id: string,
  repoId: string,
  host: ExecutionHostId,
  extra: Partial<Worktree> = {}
): Worktree {
  return {
    id,
    repoId,
    path: `/srv/${id}`,
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
    displayName: id,
    sortOrder: 0,
    lastActivityAt: 0,
    hostId: host,
    ...extra
  }
}

function group(id: string, host: ExecutionHostId): ProjectGroup {
  return {
    id,
    name: id,
    parentPath: '/srv',
    executionHostId: host,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

const folder: FolderWorkspace = {
  id: 'f1',
  projectGroupId: 'g-dev',
  name: 'notes',
  folderPath: '/srv/notes',
  executionHostId: DEVBOX,
  linkedTask: null,
  comment: '',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  sidebarGroupId: 'g-dev',
  manualOrder: 5,
  lastActivityAt: 0,
  createdAt: 0,
  updatedAt: 0
}

function state(): GroupDropState {
  const worktrees = [
    worktree('w-inherit', 'r1', DEVBOX),
    worktree('w-explicit', 'r1', DEVBOX, { sidebarGroupId: null, manualOrder: 9 }),
    worktree('w-mini', 'r2', MINI)
  ]
  return {
    worktreesByRepo: { r1: worktrees.slice(0, 2), r2: worktrees.slice(2) },
    repos,
    folderWorkspaces: [folder],
    projectGroups: [group('g-dev', DEVBOX), group('g-other', DEVBOX), group('g-mini', MINI)],
    getKnownWorktreeById: (id, host) =>
      worktrees.find((entry) => entry.id === id && (!host || entry.hostId === host))
  }
}

function writer(failIds: readonly string[] = []) {
  const calls: { kind: string; id: string; fields: unknown }[] = []
  const api: GroupDropWriter = {
    updateWorktreeMeta: vi.fn(async (id, fields) => {
      calls.push({ kind: 'worktree', id, fields })
      return failIds.includes(id) && calls.filter((c) => c.id === id).length === 1
        ? { ok: false as const, error: `no ${id}` }
        : { ok: true as const }
    }),
    updateFolderWorkspace: vi.fn(async (id, fields) => {
      calls.push({ kind: 'folder', id, fields })
      return !(failIds.includes(id) && calls.filter((c) => c.id === id).length === 1)
    })
  }
  return { api, calls }
}

describe('empty project header drop target', () => {
  it('never writes the header slot as a group id: it is the host loose list', () => {
    const key = emptyProjectSectionKey(DEVBOX, 'r9')
    expect(resolveGroupDropTarget(state(), DEVBOX, 'empty:r9', key)).toEqual({
      groupId: null,
      key: looseHostSectionKey(DEVBOX)
    })
  })

  it('keeps a real group on the same host and refuses one saved on another host', () => {
    const key = hostDirectorySectionKey(DEVBOX, 'g-other')
    expect(resolveGroupDropTarget(state(), DEVBOX, 'g-other', key)).toEqual({
      groupId: 'g-other',
      key
    })
    expect(resolveGroupDropTarget(state(), DEVBOX, 'g-mini', key)).toHaveProperty('error')
    expect(resolveGroupDropTarget(state(), DEVBOX, 'missing', key)).toHaveProperty('error')
  })
})

describe('multi-row group drop', () => {
  const target = { groupId: 'g-other', key: hostDirectorySectionKey(DEVBOX, 'g-other') }
  const order = new Map([
    ['w-inherit', { manualOrder: 100 }],
    ['w-explicit', { manualOrder: 99 }],
    [folderWorkspaceKey('f1'), { manualOrder: 98 }]
  ])

  it('plans nothing when any dragged row is on another host', () => {
    const items = planGroupDropItems(state(), DEVBOX, target, ['w-inherit', 'w-mini'], order)
    expect(items).toHaveProperty('error')
  })

  it('plans nothing when a dragged row is unknown', () => {
    expect(
      planGroupDropItems(state(), DEVBOX, target, ['w-inherit', 'gone'], order)
    ).toHaveProperty('error')
  })

  it('writes every row with the real group', async () => {
    const items = planGroupDropItems(
      state(),
      DEVBOX,
      target,
      ['w-inherit', 'w-explicit', folderWorkspaceKey('f1')],
      order
    )
    if ('error' in items) {
      throw new Error(items.error)
    }
    const { api, calls } = writer()
    await expect(commitGroupDrop(api, DEVBOX, items)).resolves.toBeNull()
    expect(calls).toEqual([
      {
        kind: 'worktree',
        id: 'w-inherit',
        fields: { sidebarGroupId: 'g-other', manualOrder: 100 }
      },
      {
        kind: 'worktree',
        id: 'w-explicit',
        fields: { sidebarGroupId: 'g-other', manualOrder: 99 }
      },
      { kind: 'folder', id: 'f1', fields: { sidebarGroupId: 'g-other', manualOrder: 98 } }
    ])
  })

  function plan(ids: readonly string[]) {
    const items = planGroupDropItems(state(), DEVBOX, target, ids, order)
    if ('error' in items) {
      throw new Error(items.error)
    }
    return items
  }

  it('puts back the rows that landed, exactly, when a later write fails', async () => {
    const { api, calls } = writer(['w-explicit'])
    const error = await commitGroupDrop(api, DEVBOX, plan(['w-inherit', 'w-explicit', 'folder:f1']))
    expect(error).toBe('no w-explicit')
    // w-inherit had no group of its own and no manual order: both go back to unset, as own
    // undefined keys (the clear signal), not to the project's group or the new rank.
    expect(calls).toStrictEqual([
      {
        kind: 'worktree',
        id: 'w-inherit',
        fields: { sidebarGroupId: 'g-other', manualOrder: 100 }
      },
      {
        kind: 'worktree',
        id: 'w-explicit',
        fields: { sidebarGroupId: 'g-other', manualOrder: 99 }
      },
      {
        kind: 'worktree',
        id: 'w-inherit',
        fields: { sidebarGroupId: undefined, manualOrder: undefined }
      }
    ])
  })

  it('restores explicit values as they were', async () => {
    const { api, calls } = writer(['w-inherit'])
    await commitGroupDrop(api, DEVBOX, plan(['folder:f1', 'w-explicit', 'w-inherit']))
    expect(calls.slice(3)).toStrictEqual([
      { kind: 'worktree', id: 'w-explicit', fields: { sidebarGroupId: null, manualOrder: 9 } },
      { kind: 'folder', id: 'f1', fields: { sidebarGroupId: 'g-dev', manualOrder: 5 } }
    ])
  })

  it('reports rows a failed rollback could not put back', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const api: GroupDropWriter = {
      updateWorktreeMeta: vi.fn(async (id: string) =>
        id === 'w-explicit' ? { ok: false as const, error: 'offline' } : { ok: true as const }
      ),
      updateFolderWorkspace: vi.fn(
        async (_id: string, fields: { sidebarGroupId?: string | null }) =>
          // the first write lands, the rollback write fails
          fields.sidebarGroupId === 'g-other'
      )
    }
    const error = await commitGroupDrop(api, DEVBOX, plan(['folder:f1', 'w-explicit']))
    expect(error).toBe('offline Could not put back: notes.')
    expect(errors).toHaveBeenCalledWith('Workspace group drop rollback failed for', ['f1'])
    errors.mockRestore()
  })

  it('fails the drop and puts the row back when an older host drops the group', async () => {
    // The older host applies manualOrder but strips sidebarGroupId and clearFields.
    const message = sidebarFieldsNotAppliedMessage()
    const calls: { id: string; fields: Fields }[] = []
    const api: GroupDropWriter = {
      updateWorktreeMeta: vi.fn(async (id: string, fields: Fields) => {
        calls.push({ id, fields })
        return { ok: false as const, error: message, code: SIDEBAR_FIELDS_NOT_APPLIED_CODE }
      }),
      updateFolderWorkspace: vi.fn(async () => true)
    }
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = await commitGroupDrop(api, DEVBOX, plan(['w-explicit', 'w-inherit']))
    // The row's own order is written back; the second row is never touched.
    expect(calls).toStrictEqual([
      { id: 'w-explicit', fields: { sidebarGroupId: 'g-other', manualOrder: 99 } },
      { id: 'w-explicit', fields: { sidebarGroupId: null, manualOrder: 9 } }
    ])
    expect(error?.startsWith(message)).toBe(true)
    errors.mockRestore()
  })

  it('puts the row back when the typed error is thrown instead of returned', async () => {
    const calls: { id: string; fields: Fields }[] = []
    let first = true
    const api: GroupDropWriter = {
      updateWorktreeMeta: vi.fn(async (id: string, fields: Fields) => {
        calls.push({ id, fields })
        if (first) {
          first = false
          throw new SidebarFieldsNotAppliedError()
        }
        return { ok: true as const }
      }),
      updateFolderWorkspace: vi.fn(async () => true)
    }
    await commitGroupDrop(api, DEVBOX, plan(['w-explicit']))
    expect(calls.map((call) => call.fields)).toStrictEqual([
      { sidebarGroupId: 'g-other', manualOrder: 99 },
      { sidebarGroupId: null, manualOrder: 9 }
    ])
  })

  it('does not treat the same text without the code as a half-applied write', async () => {
    const calls: string[] = []
    const api: GroupDropWriter = {
      updateWorktreeMeta: vi.fn(async (id: string) => {
        calls.push(id)
        return { ok: false as const, error: sidebarFieldsNotAppliedMessage() }
      }),
      updateFolderWorkspace: vi.fn(async () => true)
    }
    await commitGroupDrop(api, DEVBOX, plan(['w-explicit']))
    // A plain failure wrote nothing, so there is nothing of this row to put back.
    expect(calls).toStrictEqual(['w-explicit'])
  })

  it('never has two writes in flight, so read-modify-write stores keep every row', async () => {
    // A store that persists one shared blob with a read, a pause, and a write.
    const blob: Record<string, unknown> = {}
    let inFlight = 0
    let maxInFlight = 0
    const write = async (id: string, fields: Fields): Promise<void> => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      const snapshot = { ...blob }
      await new Promise((resolve) => setTimeout(resolve, 0))
      Object.keys(blob).forEach((key) => delete blob[key])
      Object.assign(blob, snapshot, { [id]: fields })
      inFlight--
    }
    const api: GroupDropWriter = {
      updateWorktreeMeta: vi.fn(async (id, fields) => {
        await write(id, fields)
        return { ok: true as const }
      }),
      updateFolderWorkspace: vi.fn(async (id, fields) => {
        await write(id, fields)
        return true
      })
    }
    await expect(
      commitGroupDrop(api, DEVBOX, plan(['w-inherit', 'w-explicit', 'folder:f1']))
    ).resolves.toBeNull()
    expect(maxInFlight).toBe(1)
    expect(Object.keys(blob).sort()).toEqual(['f1', 'w-explicit', 'w-inherit'])
  })
})

describe('separate drops', () => {
  it('run one after another, and a failed drop does not block the next', async () => {
    const events: string[] = []
    let releaseFirst: () => void = () => {}
    const first = enqueueGroupDrop(async () => {
      events.push('first:start')
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      events.push('first:end')
      throw new Error('first failed')
    })
    const second = enqueueGroupDrop(async () => {
      events.push('second:start')
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    releaseFirst()
    await expect(first).rejects.toThrow('first failed')
    await second
    expect(events).toEqual(['first:start', 'first:end', 'second:start'])
  })
})

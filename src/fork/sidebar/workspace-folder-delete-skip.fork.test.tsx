import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionHostId } from '../../shared/execution-host'
import { registerWorkspaceFolderDelete } from '../../shared/fork-hooks/workspace-folder-delete'
import { registerForkWorkspaceFolderDelete } from './workspace-folder-delete'

type Row = {
  id: string
  instanceId: string
  repoId: string
  path: string
  displayName: string
  isMainWorktree: boolean
  hostId?: ExecutionHostId
}

const mocks = vi.hoisted(() => {
  const worktreeMap = new Map<string, Row>()
  const missedIds = new Set<string>()
  const state = {
    settings: { skipDeleteWorktreeConfirm: true },
    worktreeMap,
    repos: [] as { id: string; displayName: string; kind?: 'folder' }[],
    worktreeLineageById: {},
    allWorktrees: () => Array.from(worktreeMap.values()),
    clearWorktreeDeleteState: vi.fn(),
    markWorktreesDeleting: vi.fn(),
    openModal: vi.fn(),
    removeWorktree: vi.fn().mockResolvedValue({ ok: true }),
    updateWorktreeMeta: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({
      ok: true
    })),
    shutdownWorktreeBrowsers: vi.fn(async () => undefined),
    shutdownWorktreeTerminals: vi.fn(async () => undefined),
    setActiveWorktree: vi.fn(),
    activeWorktreeId: null as string | null,
    worktreesByRepo: {} as Record<string, Row[]>,
    gitStatusByWorktree: {} as Record<string, unknown[]>,
    deleteStateByWorktreeId: {} as Record<string, { isDeleting: boolean }>,
    openFiles: [] as [],
    editorDrafts: {},
    editorBufferIdOf: {},
    editorBufferViews: {},
    sshConnectionStates: new Map(),
    sshTargetLabels: new Map(),
    getKnownWorktreeById: (id: string, hostId?: string): Row | undefined => {
      if (missedIds.has(id)) {
        return undefined
      }
      const row = worktreeMap.get(id)
      return row && (!hostId || row.hostId === hostId) ? row : undefined
    }
  }
  const setState = vi.fn()
  return { state, setState, missedIds }
})

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    {
      getState: () => mocks.state,
      setState: mocks.setState
    }
  )
}))

vi.mock('@/store/selectors', () => ({
  getAllWorktreesFromState: () => Array.from(mocks.state.worktreeMap.values()),
  getWorktreeMapFromState: () => mocks.state.worktreeMap,
  getWorktreeOnHostFromState: (_state: unknown, worktreeId: string, hostId?: string) => {
    const row = mocks.state.worktreeMap.get(worktreeId)
    return row && (!hostId || row.hostId === hostId) ? row : undefined
  }
}))

vi.mock('@/components/editor/model-lifetime/identity/editor-model-owner', () => ({
  resolveEditorModelOwner: () => ({ environmentId: null, hostId: 'local' }),
  getEditorModelOwnerKey: () => ''
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

import { toast } from 'sonner'
import {
  runWorktreeBatchDelete,
  runWorktreeDelete
} from '@/components/sidebar/workspace-actions/deletion/delete-worktree-flow'
import { DURABLE_WORKSPACE_ARCHIVE_STORAGE_KEY } from './durable-workspace-archive'

const storage = new Map<string, string>()

function setWorktrees(
  worktrees: { id: string; repoId?: string; path?: string; hostId?: ExecutionHostId }[]
): void {
  mocks.state.worktreeMap.clear()
  for (const worktree of worktrees) {
    mocks.state.worktreeMap.set(worktree.id, {
      id: worktree.id,
      instanceId: `${worktree.id}-instance`,
      repoId: worktree.repoId ?? 'repo-1',
      path: worktree.path ?? `/srv/wt/project/${worktree.id}`,
      displayName: worktree.id,
      isMainWorktree: false,
      ...(worktree.hostId ? { hostId: worktree.hostId } : {})
    })
  }
}

describe('skip-confirm workspace removal', () => {
  beforeEach(() => {
    storage.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value)
        }
      }
    })
    mocks.state.settings = { skipDeleteWorktreeConfirm: true }
    mocks.state.repos = [{ id: 'repo-1', displayName: 'project' }]
    mocks.state.worktreeLineageById = {}
    mocks.state.openFiles = []
    mocks.state.removeWorktree.mockClear().mockResolvedValue({ ok: true })
    mocks.state.updateWorktreeMeta.mockClear().mockResolvedValue({ ok: true })
    mocks.state.openModal.mockClear()
    mocks.setState.mockClear()
    mocks.missedIds.clear()
    vi.mocked(toast.error).mockClear()
    setWorktrees([])
    registerWorkspaceFolderDelete(undefined)
  })

  afterEach(() => {
    registerWorkspaceFolderDelete(undefined)
  })

  it('still hard-deletes when the hook is not registered', () => {
    setWorktrees([{ id: 'wt-1' }])

    runWorktreeDelete('wt-1')

    expect(mocks.state.removeWorktree).toHaveBeenCalledWith(
      { id: 'wt-1', executionHostId: null },
      false
    )
    expect(mocks.state.updateWorktreeMeta).not.toHaveBeenCalled()
    expect(storage.has(DURABLE_WORKSPACE_ARCHIVE_STORAGE_KEY)).toBe(false)
    expect(mocks.state.openModal).not.toHaveBeenCalled()
  })

  it('archives a git workspace instead of deleting it when confirmation is skipped', async () => {
    registerForkWorkspaceFolderDelete()
    setWorktrees([{ id: 'wt-1' }])

    runWorktreeDelete('wt-1')

    await vi.waitFor(() => {
      expect(mocks.state.updateWorktreeMeta).toHaveBeenCalledWith(
        'wt-1',
        { isArchived: true },
        { executionHostId: 'local' }
      )
    })
    expect(mocks.state.removeWorktree).not.toHaveBeenCalled()
    expect(mocks.state.openModal).not.toHaveBeenCalled()
  })

  it('still removes a folder workspace through the existing record path', async () => {
    registerForkWorkspaceFolderDelete()
    mocks.state.repos = [{ id: 'folder-repo', displayName: 'folder', kind: 'folder' }]
    setWorktrees([{ id: 'wt-1', repoId: 'folder-repo', path: '/srv/wt/folder' }])

    expect(runWorktreeBatchDelete(['wt-1'])).toBe(true)

    await vi.waitFor(() => {
      expect(mocks.state.removeWorktree).toHaveBeenCalledWith(
        { id: 'wt-1', executionHostId: null },
        false
      )
    })
    expect(mocks.state.updateWorktreeMeta).not.toHaveBeenCalled()
  })

  it('archives an orphan row and remembers it without deleting the directory', async () => {
    registerForkWorkspaceFolderDelete()
    mocks.state.repos = []
    setWorktrees([{ id: 'orphan', path: '/srv/wt/project/checkout' }])
    const row = mocks.state.worktreeMap.get('orphan')
    mocks.state.worktreesByRepo = row ? { 'repo-1': [row] } : {}

    runWorktreeDelete('orphan')

    await vi.waitFor(() => {
      expect(mocks.setState).toHaveBeenCalled()
    })
    expect(mocks.state.updateWorktreeMeta).not.toHaveBeenCalled()
    expect(mocks.state.removeWorktree).not.toHaveBeenCalled()
    const saved = storage.get(DURABLE_WORKSPACE_ARCHIVE_STORAGE_KEY) ?? ''
    expect(saved).toContain('"/srv/wt/project/checkout"')
    expect(saved).toContain('"pathOnly":true')
  })

  it('archives one git workspace when batch delete skips confirmation', async () => {
    registerForkWorkspaceFolderDelete()
    setWorktrees([{ id: 'wt-1' }])

    expect(runWorktreeBatchDelete(['wt-1'])).toBe(true)

    await vi.waitFor(() => {
      expect(mocks.state.updateWorktreeMeta).toHaveBeenCalledWith(
        'wt-1',
        { isArchived: true },
        { executionHostId: 'local' }
      )
    })
    expect(mocks.state.removeWorktree).not.toHaveBeenCalled()
    expect(mocks.state.openModal).not.toHaveBeenCalled()
  })

  it('does not hard-delete when archive fails', async () => {
    registerForkWorkspaceFolderDelete()
    setWorktrees([{ id: 'wt-1' }])
    mocks.state.updateWorktreeMeta.mockResolvedValue({ ok: false, error: 'no' })

    runWorktreeDelete('wt-1')

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })
    expect(mocks.state.removeWorktree).not.toHaveBeenCalled()
    expect(mocks.state.openModal).not.toHaveBeenCalled()
  })

  it('does not hard-delete a git row the archive cannot resolve on its host', async () => {
    registerForkWorkspaceFolderDelete()
    setWorktrees([{ id: 'git-row' }])
    mocks.missedIds.add('git-row')

    runWorktreeDelete('git-row')

    await Promise.resolve()
    expect(mocks.state.openModal).not.toHaveBeenCalled()
    expect(mocks.state.removeWorktree).not.toHaveBeenCalled()
    expect(mocks.state.updateWorktreeMeta).not.toHaveBeenCalled()
    expect(storage.has(DURABLE_WORKSPACE_ARCHIVE_STORAGE_KEY)).toBe(false)
  })
})

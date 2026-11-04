import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionHostId } from '../../shared/execution-host'
import { normalizeExecutionHostId } from '../../shared/execution-host'

const harness = vi.hoisted(() => {
  const order: string[] = []
  const state: {
    ownerHostIds: ExecutionHostId[]
    shutdownWorktreeBrowsers: ReturnType<typeof vi.fn>
    shutdownWorktreeTerminals: ReturnType<typeof vi.fn>
    updateWorktreeMeta: ReturnType<typeof vi.fn>
    worktree: {
      id: string
      instanceId?: string
      repoId: string
      hostId?: ExecutionHostId
      path?: string
    }
    repos: { id: string; executionHostId?: ExecutionHostId }[]
    activeWorktreeId: string | null
    activeWorkspaceExecutionHostId: ExecutionHostId | null
    setActiveWorktree: ReturnType<typeof vi.fn>
    getKnownWorktreeById: ReturnType<typeof vi.fn>
    setState: ReturnType<typeof vi.fn>
  } = {
    ownerHostIds: [],
    shutdownWorktreeBrowsers: vi.fn(async () => {
      order.push('browsers')
    }),
    shutdownWorktreeTerminals: vi.fn(async () => {
      order.push('terminals')
    }),
    updateWorktreeMeta: vi.fn(async () => {
      order.push('archive')
      return { ok: true }
    }),
    worktree: { id: 'wt-1', repoId: 'web', hostId: undefined },
    repos: [],
    activeWorktreeId: null,
    activeWorkspaceExecutionHostId: null,
    setActiveWorktree: vi.fn(),
    getKnownWorktreeById: vi.fn(),
    setState: vi.fn()
  }
  return { order, state }
})

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() }
}))

vi.mock('../../renderer/src/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('../../renderer/src/components/sidebar/worktree-list/listing/stale-workspace-list-toast', () => ({
  showWorkspaceListChangedToast: vi.fn()
}))

vi.mock('../../renderer/src/lib/worktree-sleep-intent', () => ({
  markWorktreeSleepIntent: vi.fn(),
  clearWorktreeSleepIntent: vi.fn()
}))

vi.mock('../../renderer/src/lib/worktree-operation-route', () => ({
  getWorktreeOperationOwnerHostIds: () => harness.state.ownerHostIds
}))

vi.mock('../../renderer/src/store', () => ({
  useAppStore: {
    getState: () => harness.state,
    setState: harness.state.setState
  }
}))

import { DURABLE_WORKSPACE_ARCHIVE_STORAGE_KEY } from './durable-workspace-archive'
import { removeWorkspaceFromOrca } from './remove-workspace'

const storage = new Map<string, string>()

function hostId(value: string): ExecutionHostId {
  const id = normalizeExecutionHostId(value)
  if (!id) {
    throw new Error(`Unusable host id: ${value}`)
  }
  return id
}

const DEVBOX = hostId('ssh:devbox')
const MINI = hostId('ssh:mini')

describe('remove one workspace from Orca', () => {
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
    harness.order.length = 0
    harness.state.shutdownWorktreeBrowsers.mockClear()
    harness.state.shutdownWorktreeTerminals.mockClear()
    harness.state.updateWorktreeMeta.mockClear()
    harness.state.setState.mockClear()
    harness.state.worktree = { id: 'wt-1', repoId: 'web', hostId: DEVBOX }
    harness.state.repos = [{ id: 'web', executionHostId: DEVBOX }]
    harness.state.ownerHostIds = [DEVBOX]
    harness.state.getKnownWorktreeById.mockImplementation(() => harness.state.worktree)
  })

  it('archives, then stops browsers and terminals, and does not delete the directory', async () => {
    const removed = await removeWorkspaceFromOrca({ id: 'wt-1', hostId: DEVBOX })
    expect(removed).toBe(true)
    expect(harness.order).toEqual(['archive', 'browsers', 'terminals'])
    expect(harness.state.shutdownWorktreeBrowsers).toHaveBeenCalledWith('wt-1')
    expect(harness.state.shutdownWorktreeTerminals).toHaveBeenCalledWith('wt-1', {
      keepIdentifiers: true
    })
    expect(harness.state.updateWorktreeMeta).toHaveBeenCalledWith(
      'wt-1',
      { isArchived: true },
      { executionHostId: DEVBOX }
    )
    const saved = storage.get(DURABLE_WORKSPACE_ARCHIVE_STORAGE_KEY) ?? ''
    expect(saved).toContain('"id":"wt-1"')
    expect(saved).toContain('"pathOnly":false')
  })

  it('keeps terminals running when the archive fails', async () => {
    harness.state.updateWorktreeMeta.mockImplementationOnce(async () => {
      harness.order.push('archive')
      return { ok: false, error: 'host offline' }
    })
    const removed = await removeWorkspaceFromOrca({ id: 'wt-1', hostId: DEVBOX })
    expect(removed).toBe(false)
    expect(harness.order).toEqual(['archive'])
    expect(harness.state.shutdownWorktreeTerminals).not.toHaveBeenCalled()
    expect(storage.get(DURABLE_WORKSPACE_ARCHIVE_STORAGE_KEY) ?? '[]').toBe('[]')
  })

  it('a workspace whose project is gone is archived locally and remembered without a meta write', async () => {
    harness.state.repos = []
    harness.state.worktree = {
      id: 'wt-1',
      repoId: 'web',
      hostId: DEVBOX,
      path: '/srv/wt/project/checkout'
    }
    const removed = await removeWorkspaceFromOrca({ id: 'wt-1', hostId: DEVBOX })
    expect(removed).toBe(true)
    expect(harness.order).toEqual(['browsers', 'terminals'])
    expect(harness.state.updateWorktreeMeta).not.toHaveBeenCalled()
    expect(harness.state.setState).toHaveBeenCalled()
    const saved = storage.get(DURABLE_WORKSPACE_ARCHIVE_STORAGE_KEY) ?? ''
    expect(saved).toContain('"/srv/wt/project/checkout"')
    expect(saved).toContain('"pathOnly":true')
  })

  it('aborts before shutdown when the workspace has more than one owner host', async () => {
    harness.state.ownerHostIds = [DEVBOX, MINI]
    const removed = await removeWorkspaceFromOrca({ id: 'wt-1', hostId: DEVBOX })
    expect(removed).toBe(false)
    expect(harness.order).toEqual([])
    expect(harness.state.updateWorktreeMeta).not.toHaveBeenCalled()
    expect(storage.has(DURABLE_WORKSPACE_ARCHIVE_STORAGE_KEY)).toBe(false)
  })
})

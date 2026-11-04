// 导入和外部收件箱走渲染进程。node 工程只收 src/fork/**/*.ts，
// 这个测试改成 tsx，由 web 工程类型检查；同路径扫描仍留在 .fork.test.ts。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'

const mocks = vi.hoisted(() => ({
  state: {
    repos: [] as Repo[],
    settings: null,
    worktreesByRepo: {},
    updateWorktreeMeta: vi.fn()
  }
}))

vi.mock('@/store', () => ({
  useAppStore: Object.assign(() => undefined, { getState: () => mocks.state })
}))
vi.mock('../../renderer/src/store', () => ({
  useAppStore: Object.assign(() => undefined, { getState: () => mocks.state })
}))

import { importNewExternalWorktreeInboxPaths } from '../../renderer/src/components/sidebar/worktree-list/listing/new-external-worktrees-inbox-actions'
import {
  registerImportedWorktreeReactivate,
  registerRemovedWorkspaceArchiveRelease,
  type DurableArchiveRow
} from '../../shared/fork-hooks/workspace-durable-archive'
import { dispatchWorktreeRemoval } from '../../renderer/src/store/slices/worktrees/teardown/dispatch-worktree-removal'
import { applyForkPostImport } from '../import/apply-post-import'
import {
  forgetWorkspaceArchive,
  rememberWorkspaceArchive,
  stampWorkspaceArchive
} from './durable-workspace-archive'
import {
  reactivateImportedWorktrees,
  releaseRemovedWorkspaceArchive
} from './workspace-archive-release'

const PATH = '/srv/wt/project/checkout'
const ID = `repo-1::${PATH}`

const storage = new Map<string, string>()

function archivedMeta(instanceId = 'stale-instance'): WorktreeMeta {
  return {
    displayName: 'recreate-g',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: true,
    isUnread: false,
    isPinned: false,
    sortOrder: 1,
    lastActivityAt: 1,
    instanceId
  }
}

// 盖住隐藏记录用的行。渲染进程测试不能调用 main 的 mergeWorktree。
function archiveRow(meta: WorktreeMeta): DurableArchiveRow {
  return {
    id: ID,
    path: PATH,
    repoId: 'repo-1',
    hostId: 'local',
    isArchived: meta.isArchived
  }
}

describe('same-path import after soft-delete', () => {
  let meta: WorktreeMeta

  beforeEach(() => {
    meta = archivedMeta()
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
    // 测试替身只套用 updates。真正的合并在宿主上，不进这个工程。
    mocks.state.repos = [
      {
        id: 'repo-1',
        path: '/srv/wt/project',
        displayName: 'project',
        badgeColor: '#000',
        addedAt: 0
      }
    ]
    mocks.state.updateWorktreeMeta
      .mockReset()
      .mockImplementation(async (_id: string, updates: Partial<WorktreeMeta>) => {
        meta = { ...meta, ...updates }
        return { ok: true }
      })
    registerImportedWorktreeReactivate(reactivateImportedWorktrees)
    rememberWorkspaceArchive({
      id: ID,
      path: PATH,
      repoId: 'repo-1',
      hostId: 'local',
      pathOnly: false
    })
  })

  afterEach(() => {
    registerImportedWorktreeReactivate(undefined)
  })

  it('imports the same path into the active sidebar after the hide list is cleared', async () => {
    forgetWorkspaceArchive({
      id: ID,
      path: PATH,
      repoId: 'repo-1',
      hostId: 'local',
      isArchived: true
    })

    await applyForkPostImport({
      phase: 'registered',
      repoId: 'repo-1',
      path: PATH,
      executionHostId: 'local'
    })

    const imported = archiveRow(meta)
    expect(mocks.state.updateWorktreeMeta).toHaveBeenCalledWith(
      ID,
      { isArchived: false },
      { executionHostId: 'local' }
    )
    expect(imported.isArchived).toBe(false)
    expect(stampWorkspaceArchive([imported])[0]?.isArchived).toBe(false)
  })

  it('clears archived meta before the external inbox rescans', async () => {
    forgetWorkspaceArchive({
      id: ID,
      path: PATH,
      repoId: 'repo-1',
      hostId: 'local',
      isArchived: true
    })
    const fetchWorktrees = vi.fn(async () => {
      expect(meta.isArchived).toBe(false)
      return true
    })

    await importNewExternalWorktreeInboxPaths({
      projectId: 'repo-1',
      repo: { importedExternalWorktreePaths: [], externalWorktreeInboxBaselinePaths: [] },
      worktreePaths: [PATH],
      setInboxState: vi.fn(),
      updateRepo: vi.fn().mockResolvedValue(true),
      fetchWorktrees
    })

    expect(fetchWorktrees).toHaveBeenCalledOnce()
    expect(stampWorkspaceArchive([archiveRow(meta)])[0]?.isArchived).toBe(false)
  })

  it('keeps the hide when clearing archived meta fails', async () => {
    mocks.state.updateWorktreeMeta.mockResolvedValueOnce({ ok: false, error: 'disk' })
    const fetchWorktrees = vi.fn().mockResolvedValue(true)
    const updateRepo = vi.fn().mockResolvedValue(true)

    await importNewExternalWorktreeInboxPaths({
      projectId: 'repo-1',
      repo: { importedExternalWorktreePaths: [], externalWorktreeInboxBaselinePaths: [] },
      worktreePaths: [PATH],
      setInboxState: vi.fn(),
      updateRepo,
      fetchWorktrees
    })

    expect(fetchWorktrees).not.toHaveBeenCalled()
    expect(updateRepo).toHaveBeenCalledTimes(2)
    expect(meta.isArchived).toBe(true)
    const unarchivedScan = archiveRow({ ...archivedMeta(), isArchived: false })
    expect(stampWorkspaceArchive([unarchivedScan])[0]?.isArchived).toBe(true)
  })
})

describe('hide record after a confirmed removal', () => {
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
  })

  afterEach(() => {
    registerRemovedWorkspaceArchiveRelease(undefined)
    vi.unstubAllGlobals()
  })

  it('drops the record once the host confirmed the removal, not when it failed', async () => {
    rememberWorkspaceArchive({
      id: ID,
      path: PATH,
      repoId: 'repo-1',
      hostId: 'local',
      pathOnly: false
    })
    registerRemovedWorkspaceArchiveRelease(releaseRemovedWorkspaceArchive)
    const remove = vi.fn().mockRejectedValueOnce(new Error('dirty')).mockResolvedValueOnce({})
    vi.stubGlobal('window', { api: { worktrees: { remove } } })
    const removal = {
      worktreeId: ID,
      hostId: 'local' as const,
      force: false,
      skipArchive: false,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a local removal never reads the store.
      get: (() => mocks.state) as never,
      target: { kind: 'local' as const },
      options: undefined,
      assertCurrent: () => undefined
    }

    await expect(dispatchWorktreeRemoval(removal)).rejects.toThrow('dirty')
    expect(stampWorkspaceArchive([archiveRow(archivedMeta())])[0]?.isArchived).toBe(true)

    await dispatchWorktreeRemoval(removal)
    const scanned = archiveRow({ ...archivedMeta(), isArchived: false })
    expect(stampWorkspaceArchive([scanned])[0]?.isArchived).toBe(false)
  })
})

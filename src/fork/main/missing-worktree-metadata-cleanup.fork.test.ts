import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMissingWorktreeMetadataCleanup } from '../../shared/fork-hooks/missing-worktree-metadata'
import { hostWorktreeTarget } from '../../shared/worktree/host-qualified-identity'
import type { Repo } from '../../shared/repo-types'
import type { GitWorktreeInfo } from '../../shared/worktree/types'
import type { Store } from '../../main/persistence/loading-store/store'
import { createStore, makeRepo, testState } from '../../main/persistence/persistence-test-harness'
import type { RuntimeStore } from '../../main/runtime/construction/runtime-store-contract'
import { scanLocalRepoWorktreesForResolution } from '../../main/runtime/workspaces/catalog/repo-worktree-resolution-scan'
import { RuntimeManagedWorktreeQueries } from '../../main/runtime/workspaces/catalog/runtime-managed-worktree-queries'
import { registerMissingWorktreeMetadataCleanupInMain } from './missing-worktree-metadata-cleanup'

vi.mock('../../main/ssh/config/ssh-config-parser', () => ({
  loadUserSshConfig: vi.fn(),
  sshConfigHostsToTargets: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))

vi.mock('../../main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../main/telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn().mockReturnValue({})
}))

const gitWorktree = (path: string, extra: Partial<GitWorktreeInfo> = {}): GitWorktreeInfo => ({
  path,
  branch: 'refs/heads/main',
  head: 'abc1234',
  isBare: false,
  isMainWorktree: true,
  ...extra
})

function createQueries(
  store: Store,
  repo: Repo,
  scanRepo: (target: Repo) => Promise<{ ok: boolean; worktrees: GitWorktreeInfo[] }>
): RuntimeManagedWorktreeQueries {
  return new RuntimeManagedWorktreeQueries({
    getStore: () => store as unknown as RuntimeStore,
    listResolved: async () => [],
    resolveRepo: async () => repo,
    selectRepos: () => [repo],
    scanRepo,
    listKnownHostIds: () => []
  })
}

describe('missing worktree directory metadata cleanup', () => {
  let repoPath = ''

  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-missing-wt-cleanup-'))
    repoPath = join(testState.dir, 'repo')
    mkdirSync(repoPath, { recursive: true })
  })

  afterEach(() => {
    registerMissingWorktreeMetadataCleanup(undefined)
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('keeps upstream behavior when unregistered', async () => {
    const goneRepoPath = join(testState.dir, 'gone-repo')
    const scan = await scanLocalRepoWorktreesForResolution(goneRepoPath, {})
    expect(scan).toEqual({ ok: false, worktrees: [] })

    const store = createStore()
    const repo = makeRepo({ id: 'repo-1', path: repoPath })
    store.addRepo(repo)
    const missingId = `${repo.id}::${join(testState.dir, 'deleted-with-session')}`
    store.setWorktreeMeta(hostWorktreeTarget({ id: missingId, hostId: 'local' }), {
      displayName: 'Deleted'
    })
    store.patchWorkspaceSession({
      activeFileIdByWorktree: { [missingId]: null }
    })

    await createQueries(store, repo, async () => ({
      ok: true,
      worktrees: [gitWorktree(repoPath)]
    })).listDetected(repo)

    expect(store.getWorktreeMeta(missingId)).toBeDefined()
  })

  it('prunes missing worktree metadata even when stale session entries or prunable git rows exist', async () => {
    registerMissingWorktreeMetadataCleanupInMain()
    const store = createStore()
    const repo = makeRepo({ id: 'repo-1', path: repoPath })
    store.addRepo(repo)

    const sessionOwnedMissingPath = join(testState.dir, 'deleted-session-wt')
    const sessionOwnedMissingId = `${repo.id}::${sessionOwnedMissingPath}`
    const prunableMissingPath = join(testState.dir, 'deleted-prunable-wt')
    const prunableMissingId = `${repo.id}::${prunableMissingPath}`

    store.setWorktreeMeta(hostWorktreeTarget({ id: sessionOwnedMissingId, hostId: 'local' }), {
      displayName: 'SessionGone'
    })
    store.setWorktreeMeta(hostWorktreeTarget({ id: prunableMissingId, hostId: 'local' }), {
      displayName: 'PrunableGone'
    })
    store.patchWorkspaceSession({
      activeFileIdByWorktree: { [sessionOwnedMissingId]: null },
      activeBrowserTabIdByWorktree: { [sessionOwnedMissingId]: null },
      defaultTerminalTabsAppliedByWorktreeId: { [sessionOwnedMissingId]: true }
    })
    store.updateUI({ lastActiveWorktreeId: sessionOwnedMissingId })
    store.setMobileClientTabSelections({
      'device-1': {
        [sessionOwnedMissingId]: {
          activeTabId: 'tab-1',
          activeGroupId: null,
          activeTabIdByGroupId: {},
          recentTabIds: []
        }
      }
    })

    const result = await createQueries(store, repo, async () => ({
      ok: true,
      worktrees: [
        gitWorktree(repoPath),
        gitWorktree(prunableMissingPath, { isMainWorktree: false, prunable: true })
      ]
    })).listDetected(repo)

    expect(result.authoritative).toBe(true)
    expect(result.worktrees.map((w) => w.path)).toEqual([repoPath])
    expect(store.getWorktreeMeta(sessionOwnedMissingId)).toBeUndefined()
    expect(store.getWorktreeMeta(prunableMissingId)).toBeUndefined()
    expect(
      store.getWorkspaceSession().activeFileIdByWorktree?.[sessionOwnedMissingId]
    ).toBeUndefined()
    expect(store.getUI().lastActiveWorktreeId).toBeNull()
    expect(store.getMobileClientTabSelections()['device-1']).toBeUndefined()
  })

  it('returns an authoritative empty listing and prunes metadata when the repo root directory itself is gone', async () => {
    registerMissingWorktreeMetadataCleanupInMain()
    const goneRepoPath = join(testState.dir, 'gone-repo')
    const store = createStore()
    const repo = makeRepo({ id: 'repo-gone', path: goneRepoPath })
    store.addRepo(repo)
    const mainWorktreeId = `${repo.id}::${goneRepoPath}`
    store.setWorktreeMeta(hostWorktreeTarget({ id: mainWorktreeId, hostId: 'local' }), {
      displayName: 'agy-merge-gate'
    })
    store.patchWorkspaceSession({
      activeFileIdByWorktree: { [mainWorktreeId]: null }
    })

    const result = await createQueries(store, repo, (target) =>
      scanLocalRepoWorktreesForResolution(target.path, {})
    ).listDetected(repo)

    expect(result.authoritative).toBe(true)
    expect(result.worktrees).toEqual([])
    expect(store.getWorktreeMeta(mainWorktreeId)).toBeUndefined()
    expect(store.getWorkspaceSession().activeFileIdByWorktree?.[mainWorktreeId]).toBeUndefined()
  })
})

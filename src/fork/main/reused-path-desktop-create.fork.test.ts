import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listWorktreesMock } from '../../main/ipc/worktrees-test-module-mocks'
import { handlers, setupWorktreeHandlers, store } from '../../main/ipc/worktrees-test-harness'
import { mergeWorktreeMetaForWrite } from '../../main/persistence/loading-store/worktree-meta-write-normalization'
import { registerReusedPathUnarchive } from '../../shared/fork-hooks/reused-path-unarchive'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import {
  hostWorktreeTarget,
  type HostWorktreeTarget
} from '../../shared/worktree/host-qualified-identity'

vi.mock('../../main/text-generation/commit-message-text-generation', () => ({
  resolveTextGenerationParams: () => ({
    ok: true,
    params: { agentId: 'claude', model: 'fixture' }
  }),
  generateBranchNameFromContext: async () => ({ success: true, slug: 'fix-auth' })
}))
vi.mock('../../main/text-generation/commit-message-agent-environment', () => ({
  prepareLocalCommitMessageAgentEnv: async () => ({ ok: true })
}))

vi.mock('electron', async () =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).electronModuleMock()
)
vi.mock('../../main/git/worktree', async () =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).gitWorktreeModuleMock()
)
vi.mock('../../main/git/worktrees/catalog/worktree-scan-cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listWorktrees: (await import('../../main/ipc/worktrees-test-module-mocks')).listWorktreesMock,
  listWorktreesSharedStrictAllowingTrueEmpty: (
    await import('../../main/ipc/worktrees-test-module-mocks')
  ).listWorktreesMock,
  listWorktreesSharedStrict: (await import('../../main/ipc/worktrees-test-module-mocks'))
    .listWorktreesMock
}))
vi.mock('../../main/git/worktrees/catalog/worktree-listing', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listWorktreesStrict: (await import('../../main/ipc/worktrees-test-module-mocks')).listWorktreesMock,
  describeCreatedWorktree: (await import('../../main/ipc/worktrees-test-module-mocks'))
    .describeCreatedWorktreeMock
}))
vi.mock('../../main/git/worktrees/creation/worktree-add', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  addWorktree: (await import('../../main/ipc/worktrees-test-module-mocks')).addWorktreeMock
}))
vi.mock('../../main/git/worktrees/creation/worktree-sparse-add', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  addSparseWorktree: (await import('../../main/ipc/worktrees-test-module-mocks')).addSparseWorktreeMock
}))
vi.mock('../../main/git/command-runner/git-exec-file', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  gitExecFileAsync: (await import('../../main/ipc/worktrees-test-module-mocks')).gitExecFileAsyncMock
}))
vi.mock('../../main/git/runner', async () =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).gitRunnerModuleMock()
)
vi.mock('../../main/git/repo', async () =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).gitRepoModuleMock()
)
vi.mock('../../main/git/git-username', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveLocalGitUsername: (await import('../../main/ipc/worktrees-test-module-mocks'))
    .resolveLocalGitUsernameMock
}))
vi.mock('../../main/github/client', async () =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).githubClientModuleMock()
)
vi.mock('../../main/source-control/hosted-review', async () =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).hostedReviewModuleMock()
)
vi.mock('../../main/ipc/worktree-symlinks', async () =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).worktreeSymlinksModuleMock()
)
vi.mock('../../main/workspace-hooks/hooks', async () =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).hooksModuleMock()
)
vi.mock('../../main/workspace-hooks/setup-runner-script-text', async (importOriginal) =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).setupRunnerScriptTextModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('../../main/workspace-hooks/worktree-runner-script', async (importOriginal) =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).worktreeRunnerScriptModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('../../main/workspace-hooks/effective-hook-config', async (importOriginal) =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).effectiveHookConfigModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('../../main/workspace-hooks/setup-hook-env-vars', async (importOriginal) =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).setupHookEnvVarsModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('../../main/ipc/worktree-logic', async (importOriginal) =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).worktreeLogicModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('../../main/pty/history/terminal-history-deletion', async () =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).terminalHistoryDeletionModuleMock()
)
vi.mock('../../main/ports/advertised-url-watcher', async () =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).advertisedUrlWatcherModuleMock()
)
vi.mock('../../main/workspaces/cleanup/workspace-cleanup-scan-snapshot', async () =>
  (
    await import('../../main/ipc/worktrees-test-module-mocks')
  ).workspaceCleanupScanSnapshotModuleMock()
)
vi.mock('../../main/workspaces/space-analysis/workspace-space-analysis-snapshot', async () =>
  (
    await import('../../main/ipc/worktrees-test-module-mocks')
  ).workspaceSpaceAnalysisSnapshotModuleMock()
)
vi.mock('../../main/workspaces/cleanup/workspace-cleanup-removal-snapshot-prune', async () =>
  (
    await import('../../main/ipc/worktrees-test-module-mocks')
  ).workspaceCleanupRemovalSnapshotPruneModuleMock()
)
vi.mock('../../main/runtime/worktree-teardown', async () =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).worktreeTeardownModuleMock()
)
vi.mock('../../main/ipc/pty/provider/registry', async () =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).ptyRegistryModuleMock()
)
vi.mock('../../main/ipc/pty/provider/state-cleanup', async () =>
  (await import('../../main/ipc/worktrees-test-module-mocks')).ptyStateCleanupModuleMock()
)

// Desktop create (worktrees:create): the same assertion the fork kept in upstream's create test.
describe('desktop create on a soft-deleted path', () => {
  beforeEach(() => {
    setupWorktreeHandlers()
    registerReusedPathUnarchive()
  })

  it('clears the archive and keeps the other metadata', async () => {
    const worktreeId = 'repo-1::/workspace/improve-dashboard'
    const archived: WorktreeMeta = {
      displayName: 'recreate-g',
      comment: 'keep',
      linkedIssue: null,
      linkedPR: null,
      linkedLinearIssue: null,
      isArchived: true,
      isUnread: true,
      isPinned: false,
      sortOrder: 4,
      lastActivityAt: 8,
      instanceId: 'stale-instance'
    }
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/improve-dashboard',
        head: 'abc123',
        branch: 'improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])
    store.setWorktreeMeta.mockImplementation((_target: HostWorktreeTarget, updates) =>
      mergeWorktreeMetaForWrite(archived, updates)
    )

    const result = await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard'
    })

    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      hostWorktreeTarget({ id: worktreeId, hostId: 'local' }),
      expect.objectContaining({ isArchived: false })
    )
    const written = store.setWorktreeMeta.mock.calls.find((call) => call[0].id === worktreeId)?.[1]
    const merged = mergeWorktreeMetaForWrite(archived, written ?? {})
    expect(merged.isArchived).toBe(false)
    expect(merged.instanceId).not.toBe('stale-instance')
    expect(merged.comment).toBe('keep')
    expect(result).toMatchObject({
      worktree: { id: worktreeId, isArchived: false, instanceId: merged.instanceId }
    })
  })
})

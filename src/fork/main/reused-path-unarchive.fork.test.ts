import { describe, expect, it, vi } from 'vitest'
import type { HostWorktreeTarget } from '../../shared/worktree/host-qualified-identity'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import type { Repo } from '../../shared/repo-types'

vi.mock('../../main/ipc/worktree-symlinks', () => ({
  createWorktreeCopiedPaths: vi.fn(),
  createWorktreeLinkedPaths: vi.fn(),
  createWorktreeSharedPaths: vi.fn()
}))
vi.mock('../../main/git/worktrees/content-paths/worktree-include-file', () => ({
  resolveWorktreeIncludePaths: vi.fn(async () => [])
}))
vi.mock('../../main/git/worktrees/content-paths/worktree-shared-directories', () => ({
  resolveWorktreeSharedDirectories: vi.fn(async () => [])
}))

import { materializeRuntimeLocalWorktree } from '../../main/runtime/runtime-local-worktree-materialization'
import { buildProvisionedRootMeta } from '../../main/workspaces/catalog/provisioned-root-checkout'
import { createWorktreeCreateTimingRecorder } from '../../main/workspaces/creation/worktree-create-timing'
import { registerReusedPathUnarchive } from '../../shared/fork-hooks/reused-path-unarchive'

const repo: Repo = {
  id: 'repo-1',
  path: '/srv/wt/project',
  displayName: 'Project',
  badgeColor: '#000000',
  addedAt: 1
}

// The runtime create a remote orcad runs: metadata is written together with a fresh instanceId.
async function runtimeCreateWrites(): Promise<Partial<WorktreeMeta>> {
  const setWorktreeMeta = vi.fn((_target: HostWorktreeTarget, updates: Partial<WorktreeMeta>) => ({
    ...updates,
    hostId: 'local'
  }))
  const store = { getProjectHostSetups: () => [], setWorktreeMeta }
  await materializeRuntimeLocalWorktree({
    request: { repoSelector: 'id:repo-1', name: 'checkout' },
    repo,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: create reads only getProjectHostSetups and setWorktreeMeta from the store.
    store: store as never,
    settings: { workspaceDir: '/srv/wt', nestWorkspaces: true },
    created: {
      path: '/srv/wt/project/checkout',
      head: 'abc123',
      branch: 'checkout',
      isBare: false,
      isMainWorktree: false
    },
    remoteTrackingBase: null,
    sparseDirectories: [],
    checkoutExistingBranch: false,
    baseBranch: 'main',
    branchName: 'checkout',
    effectiveRequestedName: 'checkout',
    effectiveSanitizedName: 'checkout',
    displayNameKind: undefined,
    localWorktreeGitOptions: {},
    onMetadataPersisted: () => null,
    timing: createWorktreeCreateTimingRecorder()
  })
  const written = setWorktreeMeta.mock.calls[0]?.[1]
  expect(written?.instanceId).toEqual(expect.any(String))
  return written ?? {}
}

function provisionedRootMeta(): Partial<WorktreeMeta> {
  return buildProvisionedRootMeta(
    { getSettings: () => ({ workspaceDir: '/srv/wt', nestWorkspaces: false }) },
    repo,
    { name: 'checkout' },
    { branchName: 'checkout', now: 1, source: 'desktop' }
  )
}

// Same repo+path metadata merges; a create on a soft-deleted path must not inherit isArchived.
describe('creating on a reused path', () => {
  it('keeps upstream metadata while the fork is unregistered', async () => {
    expect('isArchived' in (await runtimeCreateWrites())).toBe(false)
    expect('isArchived' in provisionedRootMeta()).toBe(false)
  })

  it('writes isArchived false with the new instanceId once registered', async () => {
    registerReusedPathUnarchive()
    expect((await runtimeCreateWrites()).isArchived).toBe(false)
    const provisioned = provisionedRootMeta()
    expect(provisioned.isArchived).toBe(false)
    expect(provisioned.instanceId).toEqual(expect.any(String))
  })
})

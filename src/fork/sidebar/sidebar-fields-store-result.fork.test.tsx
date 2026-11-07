import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../../renderer/src/store/types'
import { makeWorktree } from '../../renderer/src/store/slices/worktrees/worktree.test-fixture'
import {
  createTestStore,
  resetRemoteRuntimeMocks,
  resetWorktreeSliceModuleMemory,
  runtimeEnvironmentCall
} from '../../renderer/src/store/slices/worktrees/worktrees-slice-test-harness'
import { SIDEBAR_FIELDS_NOT_APPLIED_CODE } from './sidebar-fields-applied'

vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }
}))

beforeEach(() => {
  resetWorktreeSliceModuleMemory()
  vi.clearAllMocks()
  resetRemoteRuntimeMocks()
})

function remoteStore() {
  const store = createTestStore()
  const wt = makeWorktree({
    id: 'repo1::/path/wt1',
    repoId: 'repo1',
    path: '/path/wt1',
    hostId: 'runtime:env-1'
  })
  store.setState({
    settings: { activeRuntimeEnvironmentId: 'env-1' } as never,
    worktreesByRepo: { repo1: [wt] }
  } as Partial<AppState>)
  return { store, wt }
}

describe('updateWorktreeMeta result on a host that strips the group', () => {
  it('keeps the machine code next to the translated message', async () => {
    const { store, wt } = remoteStore()
    // An older host: manualOrder applies, sidebarGroupId is stripped from the reply.
    runtimeEnvironmentCall.mockResolvedValue({
      id: 'rpc-set',
      ok: true,
      result: { worktree: { ...wt, manualOrder: 7 } },
      _meta: { runtimeId: 'runtime-remote' }
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await store
      .getState()
      .updateWorktreeMeta(wt.id, { sidebarGroupId: 'g1', manualOrder: 7 })
    expect(result).toMatchObject({ ok: false, code: SIDEBAR_FIELDS_NOT_APPLIED_CODE })
  })

  it('adds no code to any other failure', async () => {
    const { store, wt } = remoteStore()
    runtimeEnvironmentCall.mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await store.getState().updateWorktreeMeta(wt.id, { comment: 'note' })
    expect(result).toStrictEqual({ ok: false, error: 'offline' })
  })
})

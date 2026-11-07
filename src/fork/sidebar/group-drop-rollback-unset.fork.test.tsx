// A failed group drop puts back a row that had no manual order as "unset", on the local IPC path
// and on the remote runtime path, through the real renderer store and a JSON wire. The host side of
// both paths runs for real in group-drop-rollback-host.fork.test.ts, on the payloads asserted here.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../../renderer/src/store/types'
import type { Worktree } from '../../shared/worktree/types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import type { ExecutionHostId } from '../../shared/execution-host'
import { makeWorktree } from '../../renderer/src/store/slices/worktrees/worktree.test-fixture'
import {
  createTestStore,
  mockApi,
  resetRemoteRuntimeMocks,
  resetWorktreeSliceModuleMemory,
  runtimeEnvironmentCall,
  worktreeListMock
} from '../../renderer/src/store/slices/worktrees/worktrees-slice-test-harness'
import {
  decodeSidebarFieldClears,
  parseClearableSidebarFields
} from '../../shared/fork-hooks/sidebar-field-clear'
import { WorktreeSet } from '../../shared/rpc-contract/worktree-params'
import { commitGroupDrop, planGroupDropItems } from './workspace-group-drop-plan'

vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }
}))

beforeEach(() => {
  resetWorktreeSliceModuleMemory()
  vi.clearAllMocks()
  resetRemoteRuntimeMocks()
})

type HostRecord = Record<string, Partial<WorktreeMeta>>

/** What a host keeps after a write: a spread merge, then JSON persistence (undefined is dropped). */
function persist(host: HostRecord, id: string, updates: Partial<WorktreeMeta>): void {
  host[id] = JSON.parse(JSON.stringify({ ...host[id], ...updates })) as Partial<WorktreeMeta>
}

function rows(hostId: string): Worktree[] {
  const base = { repoId: 'repo1', hostId: hostId as ExecutionHostId }
  return [
    // The dragged row: no own group (it follows its project's) and a manual order of 40.
    makeWorktree({ ...base, id: 'repo1::/w/moved', path: '/w/moved', manualOrder: 40 }),
    // Renumbered neighbours that never had a manual order (they sort by sortOrder).
    makeWorktree({ ...base, id: 'repo1::/w/n1', path: '/w/n1', sortOrder: 50 }),
    makeWorktree({ ...base, id: 'repo1::/w/n2', path: '/w/n2', sortOrder: 50 })
  ]
}

/** The host's rows as a refresh returns them: the stored fields only. */
function hostRows(list: readonly Worktree[], host: HostRecord): Worktree[] {
  return list.map((row) => {
    const { manualOrder: _order, sidebarGroupId: _group, ...rest } = row
    return { ...rest, ...host[row.id] } as Worktree
  })
}

function hostSeed(list: readonly Worktree[]): HostRecord {
  const host: HostRecord = {}
  for (const row of list) {
    persist(host, row.id, {
      sortOrder: row.sortOrder,
      ...(row.sidebarGroupId !== undefined ? { sidebarGroupId: row.sidebarGroupId } : {}),
      ...(row.manualOrder !== undefined ? { manualOrder: row.manualOrder } : {})
    })
  }
  return host
}

async function dropThatFailsOnLastRow(store: ReturnType<typeof createTestStore>, hostId: string) {
  const state = store.getState()
  const items = planGroupDropItems(
    { ...state, repos: [], folderWorkspaces: [], projectGroups: [] },
    hostId as ExecutionHostId,
    { groupId: null, key: 'loose' },
    ['repo1::/w/moved'],
    new Map([
      ['repo1::/w/moved', { manualOrder: 2000 }],
      ['repo1::/w/n1', { manualOrder: 3000 }],
      ['repo1::/w/n2', { manualOrder: 1000 }]
    ])
  )
  if ('error' in items) {
    throw new Error(items.error)
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  return commitGroupDrop(state, hostId as ExecutionHostId, items)
}

describe('group drop rollback restores unset fields', () => {
  it('locally: the clear crosses IPC as clearFields and the host removes the field', async () => {
    const store = createTestStore()
    const list = rows('local')
    store.setState({ worktreesByRepo: { repo1: list } } as Partial<AppState>)
    const host = hostSeed(list)
    // A failed write refetches the repo; it sees what the host stored.
    worktreeListMock.mockImplementation(async () => hostRows(list, host))
    mockApi.worktrees.updateMeta.mockImplementation(async (raw: unknown) => {
      // The IPC payload, as it would arrive in main after serialization.
      const args = JSON.parse(JSON.stringify(raw)) as {
        worktreeId: string
        updates: Partial<WorktreeMeta>
        clearFields?: unknown
      }
      if (args.worktreeId === 'repo1::/w/n2' && args.updates.manualOrder === 1000) {
        throw new Error('disk full')
      }
      persist(
        host,
        args.worktreeId,
        decodeSidebarFieldClears(args.updates, parseClearableSidebarFields(args.clearFields))
      )
      return undefined
    })

    await expect(dropThatFailsOnLastRow(store, 'local')).resolves.toBe('disk full')

    expect(host['repo1::/w/n1']).toStrictEqual({ sortOrder: 50 })
    expect(Object.hasOwn(host['repo1::/w/n1']!, 'manualOrder')).toBe(false)
    // The drop wrote an explicit null group; the rollback removes it again and restores 40.
    expect(host['repo1::/w/moved']).toStrictEqual({ sortOrder: 0, manualOrder: 40 })
    const rollback = mockApi.worktrees.updateMeta.mock.calls
      .map(([call]) => call as { worktreeId: string; clearFields?: string[] })
      .findLast((call) => call.worktreeId === 'repo1::/w/n1')
    expect(rollback).toStrictEqual({
      worktreeId: 'repo1::/w/n1',
      executionHostId: 'local',
      updates: {},
      clearFields: ['manualOrder']
    })
    // The renderer row sorts by sortOrder again.
    const n1 = store.getState().worktreesByRepo.repo1!.find((row) => row.id === 'repo1::/w/n1')
    expect(n1?.manualOrder ?? n1?.sortOrder).toBe(50)
  })

  it('remotely: worktree.set carries clearFields through JSON and the host removes the field', async () => {
    const store = createTestStore()
    const list = rows('runtime:env-1')
    store.setState({
      settings: { activeRuntimeEnvironmentId: 'env-1' } as never,
      worktreesByRepo: { repo1: list }
    } as Partial<AppState>)
    const host = hostSeed(list)
    runtimeEnvironmentCall.mockImplementation(async (request) => {
      // The JSON wire, then the host's own strip-mode schema, then its write path.
      const wire = JSON.parse(JSON.stringify(request)) as { method: string; params: unknown }
      if (wire.method !== 'worktree.set') {
        return { id: 'rpc', ok: true, result: {}, _meta: { runtimeId: 'remote' } }
      }
      const params = WorktreeSet.parse(wire.params)
      const id = params.worktree.replace(/^id:/, '')
      if (id === 'repo1::/w/n2' && params.manualOrder === 1000) {
        return {
          id: 'rpc',
          ok: false,
          error: { code: 'internal', message: 'disk full' },
          _meta: { runtimeId: 'remote' }
        }
      }
      const row = list.find((entry) => entry.id === id)!
      // The host write itself is covered with the real handlers in group-drop-rollback-host.fork.test.ts.
      const { worktree: _selector, clearFields, ...updates } = params
      persist(host, id, decodeSidebarFieldClears(updates as Partial<WorktreeMeta>, clearFields))
      const reply = { ...row, ...host[id] }
      if (!Object.hasOwn(host[id]!, 'manualOrder')) {
        delete (reply as Partial<Worktree>).manualOrder
      }
      if (!Object.hasOwn(host[id]!, 'sidebarGroupId')) {
        delete (reply as Partial<Worktree>).sidebarGroupId
      }
      return {
        id: 'rpc',
        ok: true,
        result: JSON.parse(JSON.stringify({ worktree: reply })),
        _meta: { runtimeId: 'remote' }
      }
    })

    const error = await dropThatFailsOnLastRow(store, 'runtime:env-1')

    expect(error).toContain('disk full')
    expect(host['repo1::/w/n1']).toStrictEqual({ sortOrder: 50 })
    expect(host['repo1::/w/moved']).toStrictEqual({ sortOrder: 0, manualOrder: 40 })
    const sent = runtimeEnvironmentCall.mock.calls
      .map(([request]) => request as { method: string; params: Record<string, unknown> })
      .findLast(
        (request) =>
          request.method === 'worktree.set' && request.params.worktree === 'id:repo1::/w/n1'
      )
    expect(sent?.params).toStrictEqual({
      worktree: 'id:repo1::/w/n1',
      clearFields: ['manualOrder']
    })
  })
})

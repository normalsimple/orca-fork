// Host side of a group drop rollback, with the real write paths: the payloads the renderer sends
// (asserted in group-drop-rollback-unset.fork.test.tsx) remove a manual order and an own group
// that the drop had set. Local: the worktrees:updateMeta IPC handler. Remote: worktree.set parsed
// by its schema after a JSON wire, then the runtime metadata update. No SQLite: the store merges
// with the real mergeWorktreeMetaForWrite and persists through JSON.
import { describe, expect, it, vi } from 'vitest'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import type { Worktree } from '../../shared/worktree/types'
import { WorktreeSet } from '../../shared/rpc-contract/worktree-params'
import { mergeWorktreeMetaForWrite } from '../../main/persistence/loading-store/worktree-meta-write-normalization'
import { updateRuntimeManagedWorktreeMetadata } from '../../main/runtime/workspaces/metadata/runtime-managed-worktree-metadata'
import type { RuntimeStore } from '../../main/runtime/runtime-store-contract'
import type { ResolvedWorktree } from '../../main/runtime/workspaces/catalog/runtime-worktree-path-identity'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler)
  }
}))

const ID = 'repo1::/w/n1'

/** A store that merges like the real one and keeps only what JSON persistence keeps. */
function memoryStore(initial: Partial<WorktreeMeta>) {
  const rows = new Map<string, WorktreeMeta>([
    [ID, JSON.parse(JSON.stringify(mergeWorktreeMetaForWrite(undefined, initial))) as WorktreeMeta]
  ])
  const write = (id: string, updates: Partial<WorktreeMeta>): WorktreeMeta => {
    const merged = mergeWorktreeMetaForWrite(rows.get(id), updates)
    rows.set(id, JSON.parse(JSON.stringify(merged)) as WorktreeMeta)
    return rows.get(id)!
  }
  return {
    rows,
    getRepos: () => [],
    // 上游现在传入 { id, hostId }。后两个用例仍直接传字符串，所以两种都认。
    setWorktreeMeta: (target: { id: string } | string, updates: Partial<WorktreeMeta>) =>
      write(typeof target === 'string' ? target : target.id, updates),
    setWorktreeMetaForHost: (id: string, _host: string, updates: Partial<WorktreeMeta>) =>
      write(id, updates)
  }
}

describe('group drop rollback on the host', () => {
  it('local IPC: clearFields removes the manual order and the own group', async () => {
    const { registerWorktreeMetadataHandlers } =
      await import('../../main/ipc/worktrees/metadata/register-worktree-metadata-handlers')
    // The drop wrote these; the rollback must take them away again.
    const store = memoryStore({ sortOrder: 50, manualOrder: 3000, sidebarGroupId: null })
    registerWorktreeMetadataHandlers({
      mainWindow: {},
      store,
      runtime: { notifyWorktreesChangedForRemoteClients: vi.fn() }
    } as never)
    const payload = JSON.parse(
      JSON.stringify({
        worktreeId: ID,
        executionHostId: 'local',
        updates: {},
        clearFields: ['manualOrder', 'sidebarGroupId']
      })
    )
    await handlers.get('worktrees:updateMeta')!({}, payload)
    const row = store.rows.get(ID)!
    expect(Object.hasOwn(row, 'manualOrder')).toBe(false)
    expect(Object.hasOwn(row, 'sidebarGroupId')).toBe(false)
    expect(row.sortOrder).toBe(50)
  })

  it('remote worktree.set: clearFields survives JSON and the schema, then removes the fields', async () => {
    const store = memoryStore({ sortOrder: 50, manualOrder: 3000, sidebarGroupId: null })
    const params = WorktreeSet.parse(
      JSON.parse(
        JSON.stringify({ worktree: `id:${ID}`, clearFields: ['manualOrder', 'sidebarGroupId'] })
      )
    )
    expect(params.clearFields).toEqual(['manualOrder', 'sidebarGroupId'])
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the update reads only id, repoId, hostId and instanceId.
    const resolved = {
      id: ID,
      repoId: 'repo1',
      hostId: 'local',
      path: '/w/n1',
      instanceId: 'i-1'
    } as unknown as ResolvedWorktree
    await updateRuntimeManagedWorktreeMetadata({
      selector: params.worktree,
      updates: { manualOrder: params.manualOrder, clearFields: params.clearFields },
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the update only reads these store members.
      store: store as unknown as RuntimeStore,
      ports: {
        resolveWorktree: vi.fn(async () => resolved),
        validateParent: vi.fn(),
        invalidateResolved: vi.fn(),
        invalidateScan: vi.fn(),
        notifyChanged: vi.fn(),
        showWorktree: vi.fn(async () => resolved as unknown as Worktree)
      }
    })
    const row = store.rows.get(ID)!
    expect(Object.hasOwn(row, 'manualOrder')).toBe(false)
    expect(Object.hasOwn(row, 'sidebarGroupId')).toBe(false)
    expect(row.sortOrder).toBe(50)
  })

  it('why clearFields: an own undefined alone would not survive the wire', () => {
    const store = memoryStore({ sortOrder: 50, manualOrder: 3000 })
    const wire = JSON.parse(JSON.stringify({ manualOrder: undefined })) as Partial<WorktreeMeta>
    store.setWorktreeMeta(ID, wire)
    expect(store.rows.get(ID)?.manualOrder).toBe(3000)
  })

  it('a value without a clear is kept: a rollback to a real order writes that order', () => {
    const store = memoryStore({ sortOrder: 50, manualOrder: 3000 })
    store.setWorktreeMeta(ID, { manualOrder: 40 })
    expect(store.rows.get(ID)?.manualOrder).toBe(40)
  })
})

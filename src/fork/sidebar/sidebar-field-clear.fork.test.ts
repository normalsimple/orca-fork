// The clear signal for a workspace's own group and manual order, end to end on the host side.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  decodeSidebarFieldClears,
  encodeSidebarFieldClears,
  folderSidebarFieldsNotApplied,
  parseClearableSidebarFields
} from '../../shared/fork-hooks/sidebar-field-clear'
import { FolderWorkspaceUpdate } from '../../shared/rpc-contract/folder-workspace-params'
import { WorktreeSet } from '../../shared/rpc-contract/worktree-params'
import { FolderWorkspaceUpdateArgs } from '../../main/ipc/repos/repo-ipc-arg-schemas'
import { updateRuntimeManagedWorktreeMetadata } from '../../main/runtime/workspaces/metadata/runtime-managed-worktree-metadata'
import { mergeRuntimeFolderWorkspace } from '../../main/runtime/workspaces/catalog/runtime-folder-workspace'
import { folderWorkspaceToWorktree } from '../../shared/folder-workspaces/folder-workspace-worktree'
import type { Repo } from '../../shared/repo-types'
import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import type { RuntimeStore } from '../../main/runtime/runtime-store-contract'
import type { ResolvedWorktree } from '../../main/runtime/workspaces/catalog/runtime-worktree-path-identity'
import type { Worktree } from '../../shared/worktree/types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
// 上游把测试夹具挪到 persistence/persistence-test-harness。
import {
  closeTestStores,
  createStore,
  testState
} from '../../main/persistence/persistence-test-harness'
import { hostWorktreeTarget } from '../../shared/worktree/host-qualified-identity'

vi.mock('../../main/ssh/ssh-config-parser', () => ({
  loadUserSshConfig: vi.fn(),
  sshConfigHostsToTargets: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))
vi.mock('../../main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../main/telemetry/cohort-classifier', () => ({
  getCohortAtEmit: () => ({ nth_repo_added: 1 })
}))

describe('sidebar field clear wire form', () => {
  it('splits own-undefined fields into clearFields and back', () => {
    const encoded = encodeSidebarFieldClears({
      sidebarGroupId: undefined,
      manualOrder: undefined,
      comment: 'x'
    })
    expect(encoded).toStrictEqual({
      updates: { comment: 'x' },
      clearFields: ['sidebarGroupId', 'manualOrder']
    })
    // survives JSON, which is what the remote wire does
    const wire = JSON.parse(JSON.stringify(encoded)) as typeof encoded
    expect(decodeSidebarFieldClears(wire.updates, wire.clearFields)).toStrictEqual({
      comment: 'x',
      sidebarGroupId: undefined,
      manualOrder: undefined
    })
  })

  it('leaves null (ungroup) and values alone', () => {
    expect(encodeSidebarFieldClears({ sidebarGroupId: null, manualOrder: 3 })).toStrictEqual({
      updates: { sidebarGroupId: null, manualOrder: 3 }
    })
  })

  it('keeps only known names from untyped input', () => {
    expect(parseClearableSidebarFields(['manualOrder', 'comment', 7])).toEqual(['manualOrder'])
    expect(parseClearableSidebarFields('manualOrder')).toBeUndefined()
  })

  it('every schema on the path carries the group and the clear list', () => {
    const folder = {
      folderWorkspaceId: 'f1',
      updates: { sidebarGroupId: 'g1' },
      clearFields: ['manualOrder']
    }
    expect(FolderWorkspaceUpdate.parse(folder)).toEqual(folder)
    expect(FolderWorkspaceUpdateArgs.parse(folder)).toEqual(folder)
    expect(
      WorktreeSet.parse({ worktree: 'id:w1', clearFields: ['sidebarGroupId'] }).clearFields
    ).toEqual(['sidebarGroupId'])
  })

  it('flags a host answer that dropped the group or the clear', () => {
    expect(folderSidebarFieldsNotApplied({ sidebarGroupId: 'g1' }, {})).toBe(true)
    expect(folderSidebarFieldsNotApplied({ sidebarGroupId: 'g1' }, { sidebarGroupId: 'g1' })).toBe(
      false
    )
    expect(folderSidebarFieldsNotApplied({ manualOrder: undefined }, { manualOrder: 4 })).toBe(true)
    expect(folderSidebarFieldsNotApplied({ manualOrder: undefined }, {})).toBe(false)
  })
})

describe('show echoes the stored group', () => {
  it('folder-repo merge keeps a group, including an explicit null', () => {
    const repo = { id: 'repo-1', path: '/srv/app', displayName: 'app' } as Repo
    const grouped = mergeRuntimeFolderWorkspace(repo, 'repo-1::/srv/app', {
      sidebarGroupId: 'g1',
      manualOrder: 4,
      displayName: 'app',
      comment: ''
    })
    const ungrouped = mergeRuntimeFolderWorkspace(repo, 'repo-1::/srv/app', {
      sidebarGroupId: null,
      displayName: 'app',
      comment: ''
    })
    expect(grouped.sidebarGroupId).toBe('g1')
    expect(ungrouped.sidebarGroupId).toBeNull()
    expect('sidebarGroupId' in mergeRuntimeFolderWorkspace(repo, 'repo-1::/srv/app', {})).toBe(
      false
    )
  })

  it('a folder workspace converted to a worktree keeps its own group', () => {
    const folder = {
      id: 'f1',
      projectGroupId: 'g-owner',
      name: 'notes',
      folderPath: '/srv/notes',
      linkedTask: null,
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 1,
      sidebarGroupId: null,
      lastActivityAt: 0,
      createdAt: 0,
      updatedAt: 0
    } as FolderWorkspace
    expect(folderWorkspaceToWorktree(folder).sidebarGroupId).toBeNull()
    const { sidebarGroupId: _group, ...without } = folder
    expect('sidebarGroupId' in folderWorkspaceToWorktree(without)).toBe(false)
  })
})

type Fields = { sidebarGroupId?: string | null; manualOrder?: number }

// worktree.set on a current host: `stored` is the meta the store holds after the write, `shown` the
// row show resolves afterwards (it may lack the field, e.g. a folder repo projection).
async function runtimeSet(
  updates: Fields & { comment?: string; clearFields?: ('sidebarGroupId' | 'manualOrder')[] },
  stored: Fields,
  shown: Fields
) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the update only reads id, repoId, hostId and instanceId.
  const worktree = {
    id: 'repo-1::/srv/app',
    repoId: 'repo-1',
    hostId: 'ssh:box',
    path: '/srv/app',
    instanceId: 'i-1'
  } as unknown as ResolvedWorktree
  const setWorktreeMeta = vi.fn((_target: unknown, _updates: Partial<WorktreeMeta>) => stored)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the update only reads these store members.
  const store = { getRepos: () => [], setWorktreeMeta } as unknown as RuntimeStore
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the echo reads only the sidebar fields of the shown row.
  const shownRow = { id: worktree.id, ...shown } as unknown as Worktree
  const result = await updateRuntimeManagedWorktreeMetadata({
    selector: `id:${worktree.id}`,
    updates,
    store,
    ports: {
      resolveWorktree: vi.fn(async () => worktree),
      validateParent: vi.fn(),
      invalidateResolved: vi.fn(),
      invalidateScan: vi.fn(),
      notifyChanged: vi.fn(),
      showWorktree: vi.fn(async () => shownRow)
    }
  })
  return { result, written: setWorktreeMeta.mock.calls[0] }
}

describe('runtime worktree.set clear and echo', () => {
  it('passes cleared fields to the store as own undefined keys', async () => {
    const { written } = await runtimeSet(
      { comment: 'c', clearFields: ['sidebarGroupId', 'manualOrder'] },
      {},
      {}
    )
    expect(written?.[1]).toStrictEqual({
      comment: 'c',
      sidebarGroupId: undefined,
      manualOrder: undefined
    })
  })

  it('echoes the stored group when show left it off, so a current host is not taken as old', async () => {
    const { result } = await runtimeSet(
      { sidebarGroupId: 'g1', manualOrder: 7 },
      { sidebarGroupId: 'g1', manualOrder: 7 },
      { manualOrder: 7 }
    )
    expect(result.sidebarGroupId).toBe('g1')
    expect(result.manualOrder).toBe(7)
    expect(folderSidebarFieldsNotApplied({ sidebarGroupId: 'g1', manualOrder: 7 }, result)).toBe(
      false
    )
  })

  it('echoes an explicit null (ungroup)', async () => {
    const { result } = await runtimeSet({ sidebarGroupId: null }, { sidebarGroupId: null }, {})
    expect(result.sidebarGroupId).toBeNull()
  })

  it('echoes a clear by removing the field show still has', async () => {
    const { result } = await runtimeSet(
      { clearFields: ['sidebarGroupId', 'manualOrder'] },
      {},
      { sidebarGroupId: 'g1', manualOrder: 3 }
    )
    expect(Object.hasOwn(result, 'sidebarGroupId')).toBe(false)
    expect(Object.hasOwn(result, 'manualOrder')).toBe(false)
  })

  it('echoes what the store holds, so a group the store did not keep still fails the write', async () => {
    const { result } = await runtimeSet(
      { sidebarGroupId: 'g1', manualOrder: 7 },
      { manualOrder: 7 },
      { sidebarGroupId: 'g1', manualOrder: 7 }
    )
    expect(Object.hasOwn(result, 'sidebarGroupId')).toBe(false)
    expect(folderSidebarFieldsNotApplied({ sidebarGroupId: 'g1', manualOrder: 7 }, result)).toBe(
      true
    )
  })

  it('leaves a group this write did not touch on the shown row', async () => {
    const { result } = await runtimeSet({ comment: 'c' }, {}, { sidebarGroupId: 'kept' })
    expect(result.sidebarGroupId).toBe('kept')
  })
})

describe('store: own group and manual order', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-fork-clear-'))
  })
  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('a worktree meta write clears both fields', async () => {
    const store = await createStore()
    const target = hostWorktreeTarget({ id: 'r1::/srv/wt', hostId: 'local' })
    const written = store.setWorktreeMeta(target, { sidebarGroupId: 'g1', manualOrder: 5 })
    expect(written.sidebarGroupId).toBe('g1')
    expect(written.manualOrder).toBe(5)
    const meta = store.setWorktreeMeta(
      target,
      decodeSidebarFieldClears({}, ['sidebarGroupId', 'manualOrder'])
    )
    expect(meta.sidebarGroupId).toBeUndefined()
    expect(meta.manualOrder).toBeUndefined()
  })

  it('a folder workspace keeps its group across a reload and can clear it', async () => {
    const store = await createStore()
    const group = store.createProjectGroup({
      name: 'P',
      parentPath: '/srv/p',
      createdFrom: 'folder-scan'
    })
    const workspace = store.createFolderWorkspace({ projectGroupId: group.id, name: 'notes' })
    store.updateFolderWorkspace(workspace.id, { sidebarGroupId: null, manualOrder: 7 })
    store.flush()
    const restored = await createStore()
    expect(restored.getFolderWorkspace(workspace.id)).toMatchObject({
      sidebarGroupId: null,
      manualOrder: 7
    })

    const cleared = restored.updateFolderWorkspace(
      workspace.id,
      decodeSidebarFieldClears({}, ['sidebarGroupId', 'manualOrder'])
    )
    expect(cleared && Object.hasOwn(cleared, 'sidebarGroupId')).toBe(false)
    expect(cleared && Object.hasOwn(cleared, 'manualOrder')).toBe(false)
  })
})

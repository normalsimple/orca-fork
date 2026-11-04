import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
// 上游把夹具拆进 persistence/。harness 不再导出 makeTerminalTab。
import {
  closeTestStores,
  testState,
  createStore,
  makeRepo,
  writeDataFile
} from '../../main/persistence/persistence-test-harness'
import { makeTerminalTab } from '../../main/persistence/persistence-session-fixtures'
import { manifest } from '../../main/persistence/migrating-orcad-catalog/persistence-orcad-migration-catalog-fixture'
import { collectOrcadMigrationSourceCatalog } from '../../main/persistence/migrating-orcad-catalog/orcad-source-catalog'
import { resolveAgentWorkspaceExecutionHostId } from '../../main/agent-hooks/restored-status-dead-terminal-sweep'
import { getDefaultPersistedState, getDefaultWorkspaceSession } from '../../shared/constants'
import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import type { PersistedState } from '../../shared/persisted-state-types'
import type { ProjectGroup } from '../../shared/project-group-types'
import { getRenderableFolderWorkspaces } from '../../shared/sidebar-list/folder-workspace-lanes'
import { folderWorkspaceKey } from '../../shared/workspace-scope'
import { registerKeepFolderWorkspacesOnGroupDeleteInMain } from '../../shared/fork-hooks/project-group-delete'
import { keepFolderWorkspacesOnGroupDelete } from './project-group-delete'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))
vi.mock('../../main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../main/telemetry/cohort-classifier', () => ({
  getCohortAtEmit: () => ({ nth_repo_added: 2 })
}))

// The main-process half of "Ungroup only": the renderer keeps the folder workspaces in its cascade,
// but the folder list fetched right after the delete comes from this store.
describe('deleting a project group in main', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-fork-group-delete-'))
    registerKeepFolderWorkspacesOnGroupDeleteInMain(keepFolderWorkspacesOnGroupDelete)
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('is registered for the desktop and orcad', () => {
    const register = readFileSync('src/fork/main/register-main.ts', 'utf8')
    expect(register).toMatch(
      /function registerForkMainModules[^}]*registerKeepFolderWorkspacesOnGroupDeleteInMain\(keepFolderWorkspacesOnGroupDelete\)/
    )
  })

  it('ungroups its folder workspaces instead of deleting them, across a restart', async () => {
    const store = await createStore()
    const throwaway = store.createProjectGroup({
      name: 'throwaway',
      parentPath: '/remote/throwaway',
      createdFrom: 'folder-scan',
      connectionId: 'target-1'
    })
    const child = store.createProjectGroup({
      name: 'nested',
      parentPath: '/remote/throwaway/nested',
      createdFrom: 'folder-scan',
      parentGroupId: throwaway.id
    })
    const other = store.createProjectGroup({
      name: 'dirC',
      parentPath: '/home/dirC',
      createdFrom: 'folder-scan'
    })
    const owned = store.createFolderWorkspace({ projectGroupId: throwaway.id, name: 'tfolder' })
    const nested = store.createFolderWorkspace({ projectGroupId: child.id, name: 'nested' })
    // Owned by a group that stays, shown in the deleted one.
    const shown = store.createFolderWorkspace({ projectGroupId: other.id, name: 'shown' })
    store.updateFolderWorkspace(shown.id, { sidebarGroupId: throwaway.id })
    const untouched = store.createFolderWorkspace({ projectGroupId: other.id, name: 'plainfolder' })
    store.addRepo(makeRepo({ id: 'r1', projectGroupId: throwaway.id }))
    const key = folderWorkspaceKey(owned.id)
    store.setWorkspaceSession(
      {
        ...getDefaultWorkspaceSession(),
        tabsByWorktree: { [key]: [makeTerminalTab({ id: 'tfolder-tab', worktreeId: key })] }
      },
      'ssh:target-1'
    )

    expect(store.deleteProjectGroup(throwaway.id)).toBe(true)

    expect(store.getProjectGroups().map((group) => group.id)).toEqual([other.id])
    expect(store.getRepo('r1')?.projectGroupId).toBeNull()
    const byId = new Map(store.getFolderWorkspaces().map((workspace) => [workspace.id, workspace]))
    expect([...byId.keys()].sort()).toEqual([owned.id, nested.id, shown.id, untouched.id].sort())
    expect(byId.get(owned.id)).toMatchObject({
      folderPath: '/remote/throwaway',
      connectionId: 'target-1',
      sidebarGroupId: null
    })
    expect(byId.get(nested.id)?.sidebarGroupId).toBeNull()
    expect(byId.get(shown.id)).toMatchObject({ projectGroupId: other.id, sidebarGroupId: null })
    expect(byId.get(untouched.id)?.sidebarGroupId).toBeUndefined()
    expect(store.getWorkspaceSession('ssh:target-1').tabsByWorktree[key]).toHaveLength(1)

    store.flush()
    const restored = await createStore()
    expect(restored.getFolderWorkspace(owned.id)).toMatchObject({
      name: 'tfolder',
      folderPath: '/remote/throwaway',
      connectionId: 'target-1',
      sidebarGroupId: null
    })
    expect(restored.getFolderWorkspace(nested.id)?.folderPath).toBe('/remote/throwaway/nested')
    expect(restored.getFolderWorkspace(shown.id)?.sidebarGroupId).toBeNull()
  })

  it('still reports a missing group as not deleted and changes nothing', async () => {
    const store = await createStore()
    const group = store.createProjectGroup({
      name: 'dirC',
      parentPath: '/home/dirC',
      createdFrom: 'folder-scan'
    })
    const workspace = store.createFolderWorkspace({ projectGroupId: group.id })
    expect(store.deleteProjectGroup('missing')).toBe(false)
    expect(store.getFolderWorkspace(workspace.id)?.sidebarGroupId).toBeUndefined()
  })
  it('fills the host stamp from the deleted owner when the workspace has none', () => {
    const owner: ProjectGroup = {
      id: 'grp-remote',
      name: 'remote',
      parentPath: '/srv/remote',
      connectionId: null,
      executionHostId: 'runtime:env-1',
      parentGroupId: null,
      createdFrom: 'folder-scan',
      tabOrder: 0,
      isCollapsed: false,
      color: null,
      createdAt: 0,
      updatedAt: 0
    }
    const bare = folderWorkspace({ id: 'bare', projectGroupId: owner.id })
    const pinned = folderWorkspace({
      id: 'pinned',
      projectGroupId: owner.id,
      executionHostId: 'ssh:other'
    })
    const state = { projectGroups: [owner], folderWorkspaces: [bare, pinned] } as PersistedState
    const keep = keepFolderWorkspacesOnGroupDelete(state, new Set([owner.id]))
    state.projectGroups = []
    keep()
    const byId = new Map(state.folderWorkspaces.map((workspace) => [workspace.id, workspace]))
    expect(byId.get('bare')).toMatchObject({
      executionHostId: 'runtime:env-1',
      sidebarGroupId: null
    })
    // A workspace's own stamp wins over the owner's.
    expect(byId.get('pinned')).toMatchObject({ executionHostId: 'ssh:other', sidebarGroupId: null })
  })

  it('migrates a group-less SSH folder workspace to orcad', async () => {
    const source = await createStore()
    const group = source.createProjectGroup({
      name: 'remote group',
      parentPath: '/srv/remote',
      createdFrom: 'folder-scan',
      connectionId: 'ssh-prod'
    })
    const workspace = source.createFolderWorkspace({ projectGroupId: group.id, name: 'kept' })
    expect(source.deleteProjectGroup(group.id)).toBe(true)
    const payload = collectOrcadMigrationSourceCatalog(source, { id: 'ssh-prod' })
    expect(payload.folderWorkspaces.map((entry) => entry.id)).toEqual([workspace.id])
    expect(payload.projectGroups).toEqual([])
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })

    testState.dir = mkdtempSync(join(tmpdir(), 'orca-fork-group-delete-target-'))
    const target = await createStore()
    const input = manifest({ payload })
    target.stageOrcadMigrationCatalog(input)
    expect(target.commitStagedOrcadMigrationCatalog(input)).toMatchObject({
      state: 'committed',
      receipt: { folderWorkspaceIds: [workspace.id], projectGroupIds: [] }
    })
    target.flush()
    const restored = await createStore()
    expect(restored.getFolderWorkspace(workspace.id)).toMatchObject({
      name: 'kept',
      folderPath: '/srv/remote',
      connectionId: null,
      sidebarGroupId: null
    })
    expect(restored.getProjectGroups()).toEqual([])
  })

  it('loads a profile that already holds group-less folder workspaces, ungrouped', async () => {
    writeDataFile({
      ...getDefaultPersistedState(testState.dir),
      projectGroups: [],
      folderWorkspaces: [
        folderWorkspace({ id: 'stale-sidebar', projectGroupId: 'gone', sidebarGroupId: 'gone' }),
        folderWorkspace({ id: 'inherited', projectGroupId: 'gone' })
      ]
    })
    const store = await createStore()
    expect(store.getFolderWorkspaces().map((entry) => [entry.id, entry.sidebarGroupId])).toEqual(
      expect.arrayContaining([
        ['stale-sidebar', null],
        ['inherited', null]
      ])
    )
  })

  it('lists group-less folder workspaces in modes that pair each with its group', () => {
    const kept = folderWorkspace({
      id: 'kept',
      projectGroupId: 'gone',
      sidebarGroupId: null,
      connectionId: 'ssh-prod'
    })
    // Still grouped: its group is only hidden (for host visibility), so it stays hidden.
    const hidden = folderWorkspace({ id: 'hidden', projectGroupId: 'filtered' })
    const rows = getRenderableFolderWorkspaces([kept, hidden], [])
    expect(rows.map((row) => row.folderWorkspace.id)).toEqual(['kept'])
    expect(rows[0]?.projectGroup).toMatchObject({
      id: 'gone',
      parentPath: '/srv/folder',
      connectionId: 'ssh-prod'
    })
  })

  // Loading and the group delete both leave a group-less folder workspace ungrouped (null).
  it('resolves an agent host from a group-less folder workspace itself', () => {
    const deps = (workspace: FolderWorkspace) => ({
      getRepo: () => undefined,
      getWorktreeMeta: () => undefined,
      getFolderWorkspace: () => workspace,
      getProjectGroups: () => []
    })
    const key = folderWorkspaceKey('kept')
    expect(
      resolveAgentWorkspaceExecutionHostId(
        key,
        deps(
          folderWorkspace({
            id: 'kept',
            projectGroupId: 'gone',
            connectionId: 'ssh-prod',
            sidebarGroupId: null
          })
        )
      )
    ).toBe('ssh:ssh-prod')
    expect(
      resolveAgentWorkspaceExecutionHostId(
        key,
        deps(
          folderWorkspace({
            id: 'kept',
            projectGroupId: 'gone',
            executionHostId: 'runtime:env-1',
            sidebarGroupId: null
          })
        )
      )
    ).toBe('runtime:env-1')
  })
})

function folderWorkspace(
  overrides: Partial<FolderWorkspace> & Pick<FolderWorkspace, 'id'>
): FolderWorkspace {
  return {
    projectGroupId: 'group',
    name: overrides.id,
    folderPath: '/srv/folder',
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

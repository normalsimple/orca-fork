// 文件夹项目（kind: folder）的分组写在 worktree meta 里。重启后的侧栏走文件夹列表合并，
// 以前只带回 manualOrder，已保存的 sidebarGroupId 读不回来，行就掉回未分组。git 走 mergeWorktree，本来就带回。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listFolderWorkspaces } from '../../main/ipc/worktrees/listing/folder-workspace-catalog'
import { getFolderWorkspaceRootId } from '../../main/ipc/worktrees/folder-workspace-model'
import { hostWorktreeTargetForRepo } from '../../main/persistence/host-qualified-worktree-meta'
import {
  closeTestStores,
  createStore,
  makeRepo,
  readPersistedState,
  testState
} from '../../main/persistence/persistence-test-harness'
import { listRuntimeFolderWorkspaces } from '../../main/runtime/workspaces/catalog/runtime-worktree-filesystem'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))

describe('folder repo sidebar group survives save and the list the sidebar reloads', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'folder-group-load-'))
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('keeps a saved group, and an explicit ungroup, on both folder list projections', async () => {
    const folder = makeRepo({
      id: 'folder-y',
      path: '/tmp/folder-y',
      displayName: 'folderY',
      kind: 'folder'
    })
    const id = getFolderWorkspaceRootId(folder)
    const store = createStore()
    store.addRepo(folder)
    store.setWorktreeMeta(hostWorktreeTargetForRepo(id, folder), {
      displayName: 'folderY',
      sidebarGroupId: 'grp-kept'
    })
    store.flush()

    // 库里还在。丢的是读出来拼侧栏行的那一步。
    expect(readPersistedState().worktreeMeta[id]?.sidebarGroupId).toBe('grp-kept')

    const restored = createStore()
    const repo = restored.getRepo(folder.id)
    expect(repo?.kind).toBe('folder')
    expect(restored.getWorktreeMeta(id)?.sidebarGroupId).toBe('grp-kept')
    expect(listFolderWorkspaces(restored, repo!).find((row) => row.id === id)?.sidebarGroupId).toBe(
      'grp-kept'
    )
    expect(
      listRuntimeFolderWorkspaces(restored, repo!).find((row) => row.id === id)?.sidebarGroupId
    ).toBe('grp-kept')

    restored.setWorktreeMeta(hostWorktreeTargetForRepo(id, repo!), { sidebarGroupId: null })
    expect(listFolderWorkspaces(restored, repo!).find((row) => row.id === id)?.sidebarGroupId).toBe(
      null
    )
    expect(
      listRuntimeFolderWorkspaces(restored, repo!).find((row) => row.id === id)?.sidebarGroupId
    ).toBe(null)
  })

  it('still reloads a project-group folder workspace group from its own row', () => {
    const store = createStore()
    const group = store.createProjectGroup({ name: 'Kept', createdFrom: 'manual' })
    const other = store.createProjectGroup({ name: 'Other', createdFrom: 'manual' })
    const workspace = store.createFolderWorkspace({
      projectGroupId: group.id,
      name: 'folderX',
      folderPath: '/tmp/folder-x'
    })
    expect(
      store.updateFolderWorkspace(workspace.id, { sidebarGroupId: other.id })?.sidebarGroupId
    ).toBe(other.id)
    store.flush()

    const restored = createStore()
    expect(restored.getFolderWorkspace(workspace.id)?.sidebarGroupId).toBe(other.id)
  })
})

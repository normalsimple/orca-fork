// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type { WorktreeLineage } from '../../shared/worktree/lineage-types'
import type { Worktree } from '../../shared/worktree/types'
import { registerWorkspaceFolderDelete } from '../../shared/fork-hooks/workspace-folder-delete'
import { i18n } from '@/i18n/i18n'
import { installForkLocaleOverlays } from '../i18n/locale-overlay'
import { registerForkWorkspaceFolderDelete } from './workspace-folder-delete'

const HARD_ONE = 'from git and delete its workspace folder.'
const HARD_MANY = 'from git and delete their workspace folders.'
const SOFT_ONE = 'The workspace folder on disk will not be deleted.'
const SOFT_MANY = 'Workspace folders on disk will not be deleted.'
const PERMANENT_LOSS =
  'Any uncommitted or untracked changes in Git workspaces will be permanently deleted.'
const FOLDER_COPY = 'from Orca. The project folder on disk will not be deleted.'

const mocks = vi.hoisted(() => {
  const state = {
    activeModal: 'delete-worktree',
    modalData: {} as Record<string, unknown>,
    closeModal: vi.fn(),
    removeWorktree: vi.fn(),
    clearWorktreeDeleteState: vi.fn(),
    allWorktrees: vi.fn<() => Worktree[]>(() => []),
    repos: [] as Repo[],
    worktreeLineageById: {} as Record<string, WorktreeLineage>,
    updateSettings: vi.fn(),
    openSettingsTarget: vi.fn(),
    openSettingsPage: vi.fn(),
    settings: null,
    sshTargetLabels: new Map<string, string>(),
    sshConnectionStates: new Map(),
    runtimeEnvironments: [] as { id: string; name: string }[],
    runtimeStatusByEnvironmentId: new Map(),
    gitStatusByWorktree: {} as Record<string, { path: string; status: 'modified' }[]>,
    setGitStatus: vi.fn(),
    deleteStateByWorktreeId: {} as Record<
      string,
      { isDeleting: boolean; error: string | null; canForceDelete?: boolean }
    >,
    projects: [] as [],
    projectHostSetups: [] as [],
    endpointProjects: [] as [],
    endpointProjectHostSetups: [] as [],
    openFiles: [] as {
      id: string
      filePath: string
      relativePath: string
      worktreeId: string
      language: string
      isDirty: boolean
      mode: 'edit'
    }[],
    editorDrafts: {} as Record<string, string>,
    editorBufferIdOf: {} as Record<string, string>,
    editorBufferViews: {} as Record<string, string[]>,
    activeWorktreeId: null as string | null,
    worktreesByRepo: {} as Record<string, Worktree[]>,
    updateWorktreeMeta: vi.fn(async () => ({ ok: true })),
    shutdownWorktreeBrowsers: vi.fn(async () => undefined),
    shutdownWorktreeTerminals: vi.fn(async () => undefined),
    setActiveWorktree: vi.fn(),
    getKnownWorktreeById: (id: string, hostId?: string): Worktree | undefined => {
      const rows = state.allWorktrees().filter((worktree) => worktree.id === id)
      return hostId ? rows.find((worktree) => worktree.hostId === hostId) : rows[0]
    }
  }
  return { state }
})

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state, setState: vi.fn() }
  )
}))

vi.mock('@/store/selectors', () => ({
  useAllWorktrees: () => mocks.state.allWorktrees(),
  getWorktreeMapFromState: () =>
    new Map(mocks.state.allWorktrees().map((worktree) => [worktree.id, worktree])),
  getWorktreeOnHostFromState: (_state: unknown, worktreeId: string, hostId?: string) => {
    const rows = mocks.state.allWorktrees().filter((worktree) => worktree.id === worktreeId)
    return hostId ? rows.find((worktree) => worktree.hostId === hostId) : rows[0]
  }
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button {...props}>{children}</button>
  )
}))

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

vi.mock('../../renderer/src/components/sidebar/workspace-actions/deletion/worktree-delete-execution', () => ({
  runWorktreeDeletesInParallel: vi.fn(async () => [])
}))

vi.mock('../../renderer/src/components/sidebar/worktree-list/listing/stale-workspace-list-toast', () => ({
  showWorkspaceListChangedToast: vi.fn()
}))

import { toast } from 'sonner'
import { runWorktreeDeletesInParallel } from '../../renderer/src/components/sidebar/workspace-actions/deletion/worktree-delete-execution'
import DeleteWorktreeDialog from '../../renderer/src/components/sidebar/workspace-actions/deletion/DeleteWorktreeDialog'

function gitRepo(id = 'repo-1'): Repo {
  return {
    id,
    path: '/srv/wt/project',
    displayName: 'project',
    badgeColor: 'gray',
    addedAt: 1
  }
}

function folderRepo(): Repo {
  return {
    id: 'folder-repo',
    path: '/srv/wt/folder',
    displayName: 'folder',
    badgeColor: 'blue',
    addedAt: 1,
    kind: 'folder'
  }
}

function makeWorktree(id: string, path: string, repoId = 'repo-1'): Worktree {
  return {
    id,
    instanceId: `${id}-instance`,
    repoId,
    path,
    head: 'abc123',
    branch: id,
    isBare: false,
    isMainWorktree: false,
    displayName: id,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1
  }
}

function identityOf(worktree: Worktree): { id: string; instanceId: string } {
  return { id: worktree.id, instanceId: worktree.instanceId ?? '' }
}

function resetState(): void {
  mocks.state.activeModal = 'delete-worktree'
  mocks.state.modalData = {}
  mocks.state.allWorktrees.mockReturnValue([])
  mocks.state.repos = [gitRepo()]
  mocks.state.worktreeLineageById = {}
  mocks.state.gitStatusByWorktree = {}
  mocks.state.deleteStateByWorktreeId = {}
  mocks.state.openFiles = []
  mocks.state.updateWorktreeMeta.mockClear().mockResolvedValue({ ok: true })
  mocks.state.shutdownWorktreeBrowsers.mockClear()
  mocks.state.shutdownWorktreeTerminals.mockClear()
  mocks.state.closeModal.mockClear()
  mocks.state.removeWorktree.mockClear()
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.mocked(runWorktreeDeletesInParallel).mockClear().mockResolvedValue([])
}

function showWorktrees(worktrees: Worktree[], modalData: Record<string, unknown> = {}): void {
  mocks.state.allWorktrees.mockReturnValue(worktrees)
  mocks.state.gitStatusByWorktree = Object.fromEntries(
    worktrees.map((worktree) => [worktree.id, []])
  )
  const identities = worktrees.map(identityOf)
  mocks.state.modalData = {
    worktreeId: worktrees[0]?.id,
    worktreeDeleteIdentities: identities,
    ...modalData
  }
}

function text(): string {
  return document.body.textContent ?? ''
}

function clickDelete(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }))
}

describe('workspace folder delete before registration', () => {
  beforeEach(() => {
    resetState()
    registerWorkspaceFolderDelete(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps the upstream dialog: no checkbox, hard-delete copy, hard delete on confirm', () => {
    const workspace = makeWorktree('admin', '/srv/wt/project/admin')
    showWorktrees([workspace])
    render(<DeleteWorktreeDialog />)

    expect(screen.queryByRole('checkbox', { name: 'Also delete folder' })).toBeNull()
    expect(text()).toContain(HARD_ONE)

    clickDelete('Delete Workspace')

    expect(runWorktreeDeletesInParallel).toHaveBeenCalledWith([workspace], {
      force: true,
      onForceDeleted: expect.any(Function),
      confirmedDiscards: expect.any(Map)
    })
    expect(mocks.state.updateWorktreeMeta).not.toHaveBeenCalled()
  })
})

describe('workspace folder delete dialog', () => {
  beforeEach(() => {
    resetState()
    registerForkWorkspaceFolderDelete()
  })

  afterEach(() => {
    cleanup()
    registerWorkspaceFolderDelete(undefined)
  })

  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('defaults to keeping the folder, including when the workspace is dirty', () => {
    const workspace = makeWorktree('admin', '/srv/wt/project/admin')
    showWorktrees([workspace])
    mocks.state.gitStatusByWorktree = {
      [workspace.id]: [{ path: 'notes.md', status: 'modified' }]
    }

    render(<DeleteWorktreeDialog />)

    const checkbox = screen.getByRole('checkbox', { name: 'Also delete folder' })
    expect(checkbox).not.toBeChecked()
    expect(text()).toContain(SOFT_ONE)
    expect(text()).not.toContain(HARD_ONE)
    expect(text()).not.toContain(PERMANENT_LOSS)
    expect(text()).toContain('Leave this off to keep the folder on disk.')
  })

  it('switches the warning back to the hard-delete copy when the folder checkbox is checked', () => {
    const workspace = makeWorktree('admin', '/srv/wt/project/admin')
    showWorktrees([workspace])
    mocks.state.gitStatusByWorktree = {
      [workspace.id]: [{ path: 'notes.md', status: 'modified' }]
    }
    render(<DeleteWorktreeDialog />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Also delete folder' }))

    expect(screen.getByRole('checkbox', { name: 'Also delete folder' })).toBeChecked()
    expect(text()).toContain(HARD_ONE)
    expect(text()).toContain(PERMANENT_LOSS)
    expect(text()).not.toContain(SOFT_ONE)
  })

  it('archives a git workspace and does not hard-delete when the checkbox stays off', async () => {
    const workspace = makeWorktree('admin', '/srv/wt/project/admin')
    showWorktrees([workspace])
    render(<DeleteWorktreeDialog />)

    clickDelete('Delete Workspace')

    await vi.waitFor(() => {
      expect(mocks.state.updateWorktreeMeta).toHaveBeenCalledWith(
        workspace.id,
        { isArchived: true },
        { executionHostId: 'local' }
      )
    })
    expect(runWorktreeDeletesInParallel).not.toHaveBeenCalled()
    expect(mocks.state.removeWorktree).not.toHaveBeenCalled()
    expect(mocks.state.closeModal).toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'Workspace removed from Orca',
        expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) })
      )
    })
  })

  it('hard-deletes only after the folder checkbox is checked', async () => {
    const workspace = makeWorktree('admin', '/srv/wt/project/admin')
    showWorktrees([workspace])
    render(<DeleteWorktreeDialog />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Also delete folder' }))

    clickDelete('Delete Workspace')

    expect(runWorktreeDeletesInParallel).toHaveBeenCalledWith([workspace], {
      force: true,
      onForceDeleted: expect.any(Function),
      confirmedDiscards: expect.any(Map)
    })
    await Promise.resolve()
    expect(mocks.state.updateWorktreeMeta).not.toHaveBeenCalled()
  })

  it('leaves a folder workspace on the upstream path, with no folder checkbox', async () => {
    const workspace = makeWorktree('notes', '/srv/wt/folder', 'folder-repo')
    mocks.state.repos = [folderRepo()]
    showWorktrees([workspace])
    render(<DeleteWorktreeDialog />)

    expect(screen.queryByRole('checkbox', { name: 'Also delete folder' })).toBeNull()
    expect(text()).toContain(FOLDER_COPY)
    expect(text()).not.toContain(HARD_ONE)

    clickDelete('Delete Workspace')

    expect(runWorktreeDeletesInParallel).toHaveBeenCalledWith([workspace], {
      force: true,
      onForceDeleted: expect.any(Function),
      confirmedDiscards: expect.any(Map)
    })
    expect(mocks.state.updateWorktreeMeta).not.toHaveBeenCalled()
  })

  it('archives every git workspace in a batch and does not hard-delete', async () => {
    const first = makeWorktree('one', '/srv/wt/project/one')
    const second = makeWorktree('two', '/srv/wt/project/two')
    showWorktrees([first, second], { worktreeIds: [first.id, second.id] })
    render(<DeleteWorktreeDialog />)

    expect(text()).toContain(SOFT_MANY)
    expect(text()).not.toContain(HARD_MANY)

    clickDelete('Delete 2 Workspaces')

    await vi.waitFor(() => {
      expect(mocks.state.updateWorktreeMeta).toHaveBeenCalledTimes(2)
    })
    expect(runWorktreeDeletesInParallel).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledTimes(1)
    })
    expect(toast.success).toHaveBeenCalledWith('Removed 2 workspaces from Orca')
  })

  it('archives the git row and removes only the folder record in a mixed batch', async () => {
    const git = makeWorktree('git-row', '/srv/wt/project/git-row')
    const folder = makeWorktree('folder-row', '/srv/wt/folder', 'folder-repo')
    mocks.state.repos = [gitRepo(), folderRepo()]
    showWorktrees([git, folder], { worktreeIds: [git.id, folder.id] })
    render(<DeleteWorktreeDialog />)

    clickDelete('Delete 2 Workspaces')

    await vi.waitFor(() => {
      expect(mocks.state.updateWorktreeMeta).toHaveBeenCalledWith(
        git.id,
        { isArchived: true },
        { executionHostId: 'local' }
      )
    })
    expect(mocks.state.updateWorktreeMeta).not.toHaveBeenCalledWith(
      folder.id,
      expect.anything(),
      expect.anything()
    )
    await vi.waitFor(() => {
      expect(runWorktreeDeletesInParallel).toHaveBeenCalledWith([folder])
    })
  })

  it('keeps child workspaces on disk until the folder checkbox is checked', async () => {
    const parent = makeWorktree('parent', '/srv/wt/project/parent')
    const child = makeWorktree('child', '/srv/wt/project/child')
    mocks.state.worktreeLineageById = {
      [child.id]: {
        worktreeId: child.id,
        worktreeInstanceId: child.instanceId ?? '',
        parentWorktreeId: parent.id,
        parentWorktreeInstanceId: parent.instanceId ?? '',
        origin: 'manual',
        capture: { source: 'manual-action', confidence: 'explicit' },
        createdAt: 1
      }
    }
    showWorktrees([parent, child], {
      worktreeId: parent.id,
      worktreeDeleteIdentities: [identityOf(parent)],
      lineageDeleteIdentities: [identityOf(child), identityOf(parent)]
    })
    render(<DeleteWorktreeDialog />)

    expect(text()).toContain('Child workspaces stay on disk')
    expect(text()).toContain(SOFT_MANY)
    expect(text()).not.toContain('Child workspaces will be deleted')
    expect(text()).not.toContain(HARD_MANY)

    clickDelete('Delete 2 Workspaces')

    await vi.waitFor(() => {
      expect(mocks.state.updateWorktreeMeta).toHaveBeenCalledTimes(2)
    })
    expect(runWorktreeDeletesInParallel).not.toHaveBeenCalled()
  })

  it('hides the folder option and uses the hard-delete sentence during force-delete recovery', () => {
    const workspace = makeWorktree('admin', '/srv/wt/project/admin')
    showWorktrees([workspace])
    mocks.state.deleteStateByWorktreeId = {
      [workspace.id]: { isDeleting: false, error: 'failed', canForceDelete: true }
    }
    render(<DeleteWorktreeDialog />)

    expect(screen.queryByRole('checkbox', { name: 'Also delete folder' })).toBeNull()
    expect(text()).toContain(HARD_ONE)
    expect(text()).not.toContain(SOFT_ONE)
    expect(screen.getByRole('button', { name: 'Force Delete' })).toBeTruthy()
  })

  it('does not warn that unsaved edits will be discarded until the folder checkbox is checked', () => {
    const workspace = makeWorktree('admin', '/srv/wt/project/admin')
    showWorktrees([workspace])
    mocks.state.openFiles = [
      {
        id: 'file-1',
        filePath: '/srv/wt/project/admin/notes.md',
        relativePath: 'notes.md',
        worktreeId: workspace.id,
        language: 'markdown',
        isDirty: true,
        mode: 'edit'
      }
    ]
    render(<DeleteWorktreeDialog />)

    expect(text()).not.toContain('will be discarded')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Also delete folder' }))

    expect(text()).toContain('will be discarded')
  })

  it("hard-deletes this confirmation when the folder checkbox and don't ask again are both on", () => {
    const workspace = makeWorktree('admin', '/srv/wt/project/admin')
    showWorktrees([workspace])
    render(<DeleteWorktreeDialog />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Also delete folder' }))
    fireEvent.click(screen.getByRole('checkbox', { name: "Don't ask again" }))

    clickDelete('Delete Workspace')

    expect(runWorktreeDeletesInParallel).toHaveBeenCalledWith([workspace], {
      force: true,
      onForceDeleted: expect.any(Function),
      confirmedDiscards: expect.any(Map)
    })
    expect(mocks.state.updateSettings).toHaveBeenCalledWith({ skipDeleteWorktreeConfirm: true })
    expect(mocks.state.updateWorktreeMeta).not.toHaveBeenCalled()
  })

  it('uses the Chinese keep-folder copy', async () => {
    installForkLocaleOverlays(i18n)
    await i18n.changeLanguage('zh')
    const workspace = makeWorktree('admin', '/srv/wt/project/admin')
    showWorktrees([workspace])
    render(<DeleteWorktreeDialog />)

    expect(text()).toContain('同时删除文件夹')
    expect(text()).toContain('不会删除磁盘上的工作区文件夹')
    expect(text()).not.toContain(HARD_ONE)
  })
})

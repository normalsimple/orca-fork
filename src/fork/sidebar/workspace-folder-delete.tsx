// 删除工作区默认只从 Orca 移除（F048）。勾选「同时删除文件夹」才走上游的 git worktree remove。
// 软删除写成归档（isArchived），并在本机记下隐藏记录（durable-workspace-archive）：下次 git 扫描
// 合并时侧栏不会把同一行加回活动列表。不取消 git worktree 登记，也不删目录。
// 文件夹工作区的删除本来就只删 Orca 里的记录，仍交给上游的删除。
import { useCallback, useId, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useAppStore } from '../../renderer/src/store'
import { findRepoForHost } from '../../renderer/src/store/slices/repo-host-identity'
import { isFolderRepo } from '../../shared/repo-kind'
import type { Worktree } from '../../shared/worktree/types'
import { toWorktreeRemovalTarget, type WorktreeRemovalTarget } from '../../shared/worktree/removal'
import {
  registerWorkspaceFolderDelete,
  workspaceFolderDeleteRegistered
} from '../../shared/fork-hooks/workspace-folder-delete'
import type { WorktreeDeleteIdentity } from '../../renderer/src/components/sidebar/workspace-actions/deletion/worktree-delete-request'
import { runWorktreeDeletesInParallel } from '../../renderer/src/components/sidebar/workspace-actions/deletion/worktree-delete-execution'
import { forkTranslate } from '../i18n/fork-translate'
import { removeWorkspaceFromOrca } from './remove-workspace'

/** Same owner lookup upstream's delete uses: by host, and never a guess between same-id repos. */
function isFolderWorkspace(worktree: Worktree): boolean {
  const state = useAppStore.getState()
  const repo = findRepoForHost(state.repos, worktree.repoId, {
    hostId: worktree.hostId,
    settings: state.settings
  })
  return Boolean(repo && isFolderRepo(repo))
}

// Archives git workspaces one by one; several at once share one summary toast.
async function archiveFromOrca<T extends Worktree>(targets: readonly T[]): Promise<T[]> {
  const quiet = targets.length > 1
  const removed: T[] = []
  for (const target of targets) {
    if (await removeWorkspaceFromOrca(target, quiet ? { quiet: true } : undefined)) {
      removed.push(target)
    }
  }
  if (quiet && removed.length > 0) {
    toast.success(
      forkTranslate('fork.workspaceDelete.removedMany', 'Removed {{count}} workspaces from Orca', {
        count: removed.length
      })
    )
  }
  return removed
}

/** Archives the git targets and removes the folder-workspace records; reports what left Orca. */
async function removeKeepingFolders(
  targets: readonly Worktree[],
  onDeleted: ((deleted: WorktreeRemovalTarget[]) => void) | null
): Promise<void> {
  const folders = targets.filter(isFolderWorkspace)
  const archived = await archiveFromOrca(targets.filter((target) => !folders.includes(target)))
  const deleted = folders.length > 0 ? await runWorktreeDeletesInParallel(folders) : []
  const removed = [...archived.map((target) => toWorktreeRemovalTarget(target)), ...deleted]
  if (removed.length > 0) {
    onDeleted?.(removed)
  }
}

// Skipped confirmation (“don't ask again”): only skips the dialog, so git workspaces are still only
// archived. Folder workspaces go back to upstream's delete, which already keeps their folders.
function skipConfirmKeepingFolders<T extends Worktree>(
  targets: readonly T[],
  onDeleted?: (deleted: WorktreeRemovalTarget[]) => void
): readonly T[] {
  const git = targets.filter((target) => !isFolderWorkspace(target))
  if (git.length > 0) {
    void archiveFromOrca(git)
      .then((archived) => {
        if (archived.length > 0) {
          onDeleted?.(archived.map((target) => toWorktreeRemovalTarget(target)))
        }
      })
      .catch((error: unknown) => console.error('Failed to remove workspace from Orca:', error))
  }
  return targets.filter((target) => !git.includes(target))
}

export function registerForkWorkspaceFolderDelete(): void {
  registerWorkspaceFolderDelete(skipConfirmKeepingFolders)
}

function WorkspaceFolderDeleteOption({
  checked,
  disabled,
  onCheckedChange
}: {
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}): ReactNode {
  const optionId = useId()
  const label = forkTranslate('fork.workspaceDelete.alsoDeleteFolder', 'Also delete folder')
  const hint = forkTranslate(
    'fork.workspaceDelete.keepFolderHint',
    'Leave this off to keep the folder on disk.'
  )
  return (
    <div className="flex w-full items-start gap-2 rounded-sm px-1 py-1 text-foreground/85">
      <Checkbox
        id={optionId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="mt-0.5"
      />
      <span className="min-w-0 flex-1">
        <Label htmlFor={optionId} className="block cursor-pointer text-xs leading-4 font-medium">
          {label}
        </Label>
        <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
      </span>
    </div>
  )
}

// 不勾选「同时删除文件夹」时，整句改成只从 Orca 移除。勾选或未登记时用上游原文。
function keptFolderDescription(childCount: number, batch: boolean, targetCount: number): string {
  if (childCount === 1) {
    return forkTranslate(
      'fork.workspaceDelete.keepFolderWithChild',
      'Remove <target/> and <descendants>1 child workspace</descendants> from Orca. Workspace folders on disk will not be deleted.'
    )
  }
  if (childCount > 1) {
    return forkTranslate(
      'fork.workspaceDelete.keepFolderWithChildren',
      'Remove <target/> and <descendants>{{count}} child workspaces</descendants> from Orca. Workspace folders on disk will not be deleted.',
      { count: childCount }
    )
  }
  if (batch) {
    return forkTranslate(
      'fork.workspaceDelete.keepFolderBatch',
      'Remove <target>{{count}} workspaces</target> from Orca. Workspace folders on disk will not be deleted.',
      { count: targetCount }
    )
  }
  return forkTranslate(
    'fork.workspaceDelete.keepFolderSingle',
    'Remove <target/> from Orca. The workspace folder on disk will not be deleted.'
  )
}

function lineageKeptNotice(childCount: number): { title: string; body: string } {
  return {
    title: forkTranslate('fork.workspaceDelete.lineageKeptTitle', 'Child workspaces stay on disk'),
    body:
      childCount === 1
        ? forkTranslate(
            'fork.workspaceDelete.lineageKeptOne',
            'Removing this workspace also removes 1 child workspace from Orca. Folders on disk will not be deleted.'
          )
        : forkTranslate(
            'fork.workspaceDelete.lineageKeptMany',
            'Removing this workspace also removes {{count}} child workspaces from Orca. Folders on disk will not be deleted.',
            { count: childCount }
          )
  }
}

type FolderDeleteDialogInput = {
  deleteTargets: readonly Worktree[]
  isMainWorktree: boolean
  canForceDelete: boolean
  isBatchDelete: boolean
  childWorkspaceCount: number
  disabled: boolean
  // 上游的整句（带 <target>）。勾选「同时删除文件夹」或没有提供勾选时原样使用。
  upstreamDescription: string
  lineageDeleteIdentities: readonly WorktreeDeleteIdentity[]
  resolveConfirmedTargets: (
    identities: readonly WorktreeDeleteIdentity[],
    expectedCount: number
  ) => Worktree[] | null
  closeModal: () => void
  onDeleted: ((targets: WorktreeRemovalTarget[]) => void) | null
}

/**
 * The delete dialog's "Also delete folder" choice. Offered for git workspaces only, never during a
 * force-delete retry or for the main worktree. Unregistered, it is never offered and every value
 * is upstream's.
 */
export function useWorkspaceFolderDeleteDialog(input: FolderDeleteDialogInput): {
  description: string
  keepsFolder: boolean
  folderOption: ReactNode
  lineageKeptNotice: { title: string; body: string } | null
  /** Confirm while keeping folders: removes the targets from Orca; false when not keeping. */
  keepFolders: (targets: readonly Worktree[]) => boolean
  /** Same for "delete with children": children are only archived too, never deleted first. */
  keepLineageFolders: () => boolean
} {
  const isOpen = useAppStore((state) => state.activeModal === 'delete-worktree')
  const [deleteFolder, setDeleteFolder] = useState(false)
  if (!isOpen && deleteFolder) {
    setDeleteFolder(false)
  }
  const offered =
    workspaceFolderDeleteRegistered() &&
    !input.isMainWorktree &&
    !input.canForceDelete &&
    input.deleteTargets.some((target) => !isFolderWorkspace(target))
  const keepsFolder = offered && !deleteFolder
  const { closeModal, onDeleted, lineageDeleteIdentities, resolveConfirmedTargets } = input
  const lineageCount = input.deleteTargets.length
  const keepFolders = useCallback(
    (targets: readonly Worktree[]): boolean => {
      if (!keepsFolder) {
        return false
      }
      closeModal()
      void removeKeepingFolders(targets, onDeleted).catch((error: unknown) =>
        console.error('Failed to remove workspace from Orca:', error)
      )
      return true
    },
    [closeModal, keepsFolder, onDeleted]
  )
  const keepLineageFolders = useCallback((): boolean => {
    if (!keepsFolder) {
      return false
    }
    // A null result already told the user the list changed and closed the dialog.
    const targets = resolveConfirmedTargets(lineageDeleteIdentities, lineageCount)
    return targets === null || keepFolders(targets)
  }, [keepFolders, keepsFolder, lineageCount, lineageDeleteIdentities, resolveConfirmedTargets])
  return {
    description: keepsFolder
      ? keptFolderDescription(
          input.childWorkspaceCount,
          input.isBatchDelete,
          input.deleteTargets.length
        )
      : input.upstreamDescription,
    keepsFolder,
    folderOption: offered ? (
      <WorkspaceFolderDeleteOption
        checked={deleteFolder}
        disabled={input.disabled}
        onCheckedChange={setDeleteFolder}
      />
    ) : null,
    lineageKeptNotice:
      keepsFolder && input.childWorkspaceCount > 0
        ? lineageKeptNotice(input.childWorkspaceCount)
        : null,
    keepFolders,
    keepLineageFolders
  }
}

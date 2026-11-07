// Archived Orca workspaces inside the visibility dialog. Restore clears isArchived.
import React, { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { forkTranslate } from '../i18n/fork-translate'
import { Button } from '../../renderer/src/components/ui/button'
import { Input } from '../../renderer/src/components/ui/input'
import { getWorktreeExecutionHostId, normalizeExecutionHostId } from '../../shared/execution-host'
import type { Repo } from '../../shared/repo-types'
import { useAppStore } from '../../renderer/src/store'
import { findRepoForHost } from '../../renderer/src/store/repos/repo-host-identity'
import { registerVisibilityArchivedSlot } from '../../shared/fork-hooks/sidebar-chrome'
import { forgetWorkspaceArchive } from './durable-workspace-archive'
import { hostDirectoryDefaultHostId } from './section-keys'

function ArchivedWorkspaceList({
  repo,
  hostId
}: {
  repo: Repo
  hostId?: string
}): React.JSX.Element | null {
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  const repos = useAppStore((state) => state.repos)
  const updateWorktreeMeta = useAppStore((state) => state.updateWorktreeMeta)
  const [query, setQuery] = useState('')
  // Rows and projects without a host belong to the sidebar's default host, as the list draws them.
  const defaultHostId = hostDirectoryDefaultHostId()
  const owner =
    normalizeExecutionHostId(hostId) ??
    getWorktreeExecutionHostId({ hostId: undefined }, repo, defaultHostId)
  const archived = useMemo(
    () =>
      Object.values(worktreesByRepo)
        .flat()
        .filter((worktree) => {
          if (!worktree.isArchived) {
            return false
          }
          const own = findRepoForHost(repos, worktree.repoId, { hostId: worktree.hostId })
          return getWorktreeExecutionHostId(worktree, own ?? undefined, defaultHostId) === owner
        }),
    [defaultHostId, owner, repos, worktreesByRepo]
  )
  const needle = query.trim().toLocaleLowerCase()
  const visible = needle
    ? archived.filter((worktree) =>
        [worktree.displayName, worktree.path, worktree.branch, worktree.repoId]
          .join('\n')
          .toLocaleLowerCase()
          .includes(needle)
      )
    : archived
  if (archived.length === 0) {
    return null
  }
  return (
    <section className="grid min-w-0 gap-2">
      <h3 className="text-sm font-medium">
        {forkTranslate('fork.sidebar.archivedWorkspaces', 'Removed from Orca ({{value0}})', {
          value0: archived.length
        })}
      </h3>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={forkTranslate('fork.sidebar.searchWorkspaces', 'Search workspaces')}
        aria-label={forkTranslate('fork.sidebar.searchWorkspaces', 'Search workspaces')}
      />
      <ul className="grid gap-1">
        {visible.map((worktree) => (
          <li key={worktree.id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{worktree.displayName}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                // 先丢掉本机隐藏，再清 isArchived。顺序反了的话，失败后的重新扫描会把它又藏起来。
                forgetWorkspaceArchive(worktree)
                void updateWorktreeMeta(
                  worktree.id,
                  { isArchived: false },
                  { executionHostId: owner }
                ).then((result) => {
                  if (!result.ok) {
                    toast.error(result.error)
                  }
                })
              }}
            >
              {forkTranslate('fork.sidebar.restoreWorkspace', 'Restore')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function registerArchivedWorkspaceSlot(): void {
  registerVisibilityArchivedSlot((args) => (
    <ArchivedWorkspaceList repo={args.repo} hostId={args.hostId} />
  ))
}

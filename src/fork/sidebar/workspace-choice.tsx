// Search text for workspace pickers: directory, branch, group, and path.
import type { Worktree } from '../../shared/worktree/types'
import { registerWorkspaceChoiceFormatter } from '../../shared/fork-hooks/sidebar-chrome'
import { useAppStore } from '../../renderer/src/store'
import { findRepoForHost } from '../../renderer/src/store/repos/repo-host-identity'
import { branchName } from '../../renderer/src/lib/source-control/branches/branch-name'
import { getWorktreeExecutionHostId } from '../../shared/execution-host'
import { directoryLabelForRepo, directoryLabelsForHost } from './directory-label'
import { resolveSidebarGroupId } from './membership'
import { hostDirectoryDefaultHostId } from './section-keys'

function workspaceChoiceText(worktree: Worktree): { label: string; value: string } {
  const state = useAppStore.getState()
  const repo =
    findRepoForHost(state.repos, worktree.repoId, { hostId: worktree.hostId }) ?? undefined
  const defaultHostId = hostDirectoryDefaultHostId()
  const hostId = getWorktreeExecutionHostId(worktree, repo, defaultHostId)
  const directory =
    directoryLabelForRepo(repo, directoryLabelsForHost(repo ? [repo] : [], hostId), hostId) ?? ''
  const groupsById = new Map(state.projectGroups.map((group) => [group.id, group]))
  const groupId = resolveSidebarGroupId({
    sidebarGroupId: worktree.sidebarGroupId,
    inheritedGroupId: repo?.projectGroupId,
    groupsById,
    hostId,
    defaultHostId
  })
  const groupName = groupId ? groupsById.get(groupId)?.name : undefined
  const parts = [
    directory || worktree.displayName,
    branchName(worktree.branch),
    groupName,
    worktree.path
  ].filter((part): part is string => Boolean(part && part.length > 0))
  return {
    label: parts.join(' · '),
    value: [worktree.displayName, ...parts].join(' ')
  }
}

export function registerWorkspaceChoice(): void {
  registerWorkspaceChoiceFormatter(workspaceChoiceText)
}

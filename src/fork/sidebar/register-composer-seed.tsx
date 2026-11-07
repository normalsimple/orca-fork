// Reads the open composer and remembers the host and sidebar group for the create.
import { useAppStore } from '@/store'
import { getWorktreeOnHostFromState } from '@/store/workspaces/selection/worktree-on-host-selector'
import { findRepoForHost } from '@/store/repos/repo-host-identity'
import { getWorktreeExecutionHostId, type ExecutionHostId } from '../../shared/execution-host'
import {
  composerSeedForOpen,
  registerComposerSeedReader,
  registerCreatedSidebarGroupAssigner
} from '../../shared/fork-hooks/workspace-composer-seed'
import { projectGroupHostId, resolveSidebarGroupId } from './membership'
import { hostDirectoryDefaultHostId } from './section-keys'

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** True when the group lives on another host than the created workspace: the write would not show. */
function createdOnOtherHost(
  state: ReturnType<typeof useAppStore.getState>,
  worktreeId: string,
  sidebarGroupId: string,
  hostId: ExecutionHostId | undefined
): boolean {
  const defaultHostId = hostDirectoryDefaultHostId()
  const group = state.projectGroups.find((entry) => entry.id === sidebarGroupId)
  const created = getWorktreeOnHostFromState(state, worktreeId, hostId)
  if (!group || !created) {
    return false
  }
  const repo = findRepoForHost(state.repos, created.repoId, { hostId: created.hostId })
  const createdHostId = getWorktreeExecutionHostId(created, repo ?? undefined, defaultHostId)
  return projectGroupHostId(group, defaultHostId) !== createdHostId
}

export function registerComposerSeed(): void {
  registerComposerSeedReader(() => {
    const state = useAppStore.getState()
    if (state.activeModal !== 'new-workspace-composer') {
      return null
    }
    const data = state.modalData
    // The sidebar's default host, as the host-directory rows place rows and groups without one.
    const defaultHostId = hostDirectoryDefaultHostId()
    const groupId = stringField(data, 'initialProjectGroupId')
    const group = groupId ? state.projectGroups.find((entry) => entry.id === groupId) : undefined
    // Same-id workspaces can live on two hosts: the active one is the active host's copy.
    const active = state.activeWorktreeId
      ? getWorktreeOnHostFromState(
          state,
          state.activeWorktreeId,
          state.activeWorkspaceExecutionHostId ?? undefined
        )
      : undefined
    const activeRepo = active
      ? (findRepoForHost(state.repos, active.repoId, { hostId: active.hostId }) ?? undefined)
      : undefined
    const activeHostId = active
      ? getWorktreeExecutionHostId(active, activeRepo, defaultHostId)
      : (state.activeWorkspaceExecutionHostId ?? defaultHostId)
    const groupsById = new Map(state.projectGroups.map((entry) => [entry.id, entry]))
    const activeGroupId = active
      ? resolveSidebarGroupId({
          sidebarGroupId: active.sidebarGroupId,
          inheritedGroupId: activeRepo?.projectGroupId,
          groupsById,
          hostId: activeHostId,
          defaultHostId
        })
      : null
    return composerSeedForOpen({
      telemetrySource: stringField(data, 'telemetrySource'),
      initialRepoId: stringField(data, 'initialRepoId'),
      initialProjectGroupId: groupId,
      hasWorkspaceTarget: data.initialWorkspaceTarget != null,
      hasWorkspaceStatus: data.initialWorkspaceStatus != null,
      groupHostId: group ? projectGroupHostId(group, defaultHostId) : null,
      activeHostId,
      activeGroupId
    })
  })
  registerCreatedSidebarGroupAssigner(async (worktreeId, sidebarGroupId, hostId) => {
    const state = useAppStore.getState()
    // The composer may have switched to a project on another host after it opened from the group.
    if (createdOnOtherHost(state, worktreeId, sidebarGroupId, hostId)) {
      return
    }
    await state.updateWorktreeMeta(
      worktreeId,
      { sidebarGroupId },
      hostId ? { executionHostId: hostId } : undefined
    )
  })
}

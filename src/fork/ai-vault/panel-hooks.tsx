import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import { useAppStore } from '@/store'
import { runtimeHostConnectionStateForEntry } from '@/runtime/runtime-host-connection-state'
import { isConnectedRuntimeHostState } from '../../shared/remote-runtime/host-status/runtime-host-connection-state'
import type { RuntimeEnvironmentStatus } from '../../shared/remote-runtime/host-status/runtime-host-status'
import {
  getExecutionHostLabel,
  getWorktreeExecutionHostId,
  toRuntimeExecutionHostId,
  type ExecutionHostId,
  type ExecutionHostScope
} from '../../shared/execution-host'
import type { AiVaultHostScopeOption } from '../../renderer/src/components/right-sidebar/ai-vault/scope/ai-vault-host-scope'
import type { AiVaultPanelWorkspace } from '../../renderer/src/components/right-sidebar/ai-vault/scope/ai-vault-panel-workspace'
import type { AiVaultSessionListGroup } from '../../renderer/src/components/right-sidebar/ai-vault/session-list/ai-vault-session-filters'
import { useAiVaultPanelWorkspace } from '../../renderer/src/components/right-sidebar/ai-vault/scope/use-ai-vault-panel-workspace'
import { splitVaultHostMenu } from './host-menu'
import {
  aiVaultHostRowsRegistered,
  collapseAllAiVaultGroups,
  partitionAiVaultGroupsByHost,
  presentAiVaultCollapsedGroups,
  rememberAiVaultGroups,
  visibleAiVaultGroups,
  type AiVaultGroupInversions
} from './list-presentation'
import { AiVaultCollapseAllButton } from './panel-controls'

function createSnapshotStore<T>(initial: T) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (next: T) => {
      if (next === snapshot) {
        return
      }
      snapshot = next
      for (const listener of listeners) {
        listener()
      }
    }
  }
}

function createInversionStore() {
  return createSnapshotStore<AiVaultGroupInversions>(new Map())
}

// Like upstream's collapsed set: the sidebar panel's survives remounts, each dialog panel has its own.
const sidebarInversions = createInversionStore()
// Hosts that listed sessions in any panel of this renderer, so picking one host keeps the others in
// the main menu.
const hostsWithHistory = createSnapshotStore<ReadonlySet<string>>(new Set())

function rememberHostsWithHistory(sessions: readonly { executionHostId: string }[]): void {
  const known = hostsWithHistory.getSnapshot()
  const added = sessions.map((session) => session.executionHostId).filter((id) => !known.has(id))
  if (added.length > 0) {
    hostsWithHistory.set(new Set([...known, ...added]))
  }
}

/**
 * Host rows, collapse-new and collapse-all over upstream's list groups. Upstream's collapsed set and
 * toggle stay as they are; this keeps its own per-group inversion of that set, never writing to it.
 * New groups start collapsed in the sidebar only: `/resume` (a dialog panel, which gets a workspace)
 * opens fresh each time and its keyboard picks among visible session rows.
 */
export function useForkAiVaultGroups(
  groups: readonly AiVaultSessionListGroup[],
  collapsedGroups: ReadonlySet<string>,
  hostOptions: readonly AiVaultHostScopeOption[],
  headerAction: ReactNode,
  workspace: unknown
): {
  groups: readonly AiVaultSessionListGroup[]
  collapsedGroups: ReadonlySet<string>
  headerAction: ReactNode
} {
  const enabled = aiVaultHostRowsRegistered()
  const sidebar = workspace === undefined
  const [store] = useState(() => (sidebar ? sidebarInversions : createInversionStore()))
  const inversions = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const partitioned = useMemo(() => {
    if (!enabled) {
      return groups
    }
    const labels = new Map<string, string>(hostOptions.map((option) => [option.id, option.label]))
    return partitionAiVaultGroupsByHost(
      groups,
      (hostId: ExecutionHostId) => labels.get(hostId) ?? getExecutionHostLabel(hostId)
    )
  }, [enabled, groups, hostOptions])
  const presentedCollapsed = useMemo(
    () =>
      enabled
        ? presentAiVaultCollapsedGroups(partitioned, collapsedGroups, inversions, sidebar)
        : collapsedGroups,
    [collapsedGroups, enabled, inversions, partitioned, sidebar]
  )
  const visible = useMemo(
    () => (enabled ? visibleAiVaultGroups(partitioned, presentedCollapsed) : groups),
    [enabled, groups, partitioned, presentedCollapsed]
  )
  // Unseen groups already render collapsed; recording them makes the next toggle expand them.
  useLayoutEffect(() => {
    if (enabled && sidebar) {
      store.set(rememberAiVaultGroups(store.getSnapshot(), partitioned, collapsedGroups))
    }
  }, [collapsedGroups, enabled, partitioned, sidebar, store])
  if (!enabled) {
    return { groups, collapsedGroups, headerAction }
  }
  const collapseAll = (): void =>
    store.set(collapseAllAiVaultGroups(store.getSnapshot(), partitioned, collapsedGroups))
  return {
    groups: visible,
    collapsedGroups: presentedCollapsed,
    headerAction: (
      <>
        <AiVaultCollapseAllButton onClick={collapseAll} />
        {headerAction}
      </>
    )
  }
}

// A string, so the selector result stays equal while the connected set is unchanged.
function connectedRuntimeHostKey(
  statuses: ReadonlyMap<string, RuntimeEnvironmentStatus> | undefined
): string {
  const connected: string[] = []
  for (const [environmentId, status] of statuses ?? []) {
    if (isConnectedRuntimeHostState(runtimeHostConnectionStateForEntry(status))) {
      connected.push(toRuntimeExecutionHostId(environmentId))
    }
  }
  return connected.sort().join('\n')
}

/**
 * The history host menu's main list; the hosts it leaves out go to "Other configured hosts" through
 * `otherVaultHosts`. The selected host always stays in the main list. Unregistered, unchanged.
 */
export function useForkVaultHostMenu<T extends AiVaultHostScopeOption>(
  options: readonly T[],
  history: readonly { executionHostId: string }[],
  selected: ExecutionHostScope,
  workspace: AiVaultPanelWorkspace | undefined
): readonly T[] {
  const enabled = aiVaultHostRowsRegistered()
  const { worktree, repo } = useAiVaultPanelWorkspace(workspace)
  // Partial stores in upstream panel tests omit the map; that reads as no connected host.
  const connectedKey = useAppStore((s) =>
    enabled ? connectedRuntimeHostKey(s.runtimeStatusByEnvironmentId) : ''
  )
  const knownHosts = useSyncExternalStore(
    hostsWithHistory.subscribe,
    hostsWithHistory.getSnapshot,
    hostsWithHistory.getSnapshot
  )
  useEffect(() => {
    if (enabled) {
      rememberHostsWithHistory(history)
    }
  }, [enabled, history])
  const activeHostId = worktree ? getWorktreeExecutionHostId(worktree, repo ?? undefined) : null
  return useMemo(() => {
    if (!enabled) {
      return options
    }
    const historyHostIds = new Set(knownHosts)
    for (const session of history) {
      historyHostIds.add(session.executionHostId)
    }
    return splitVaultHostMenu(options, {
      historyHostIds,
      activeHostId,
      connectedHostIds: new Set(connectedKey ? connectedKey.split('\n') : []),
      selected
    })
  }, [activeHostId, connectedKey, enabled, history, knownHosts, options, selected])
}

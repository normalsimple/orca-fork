// 主机行和各台机器上的工作区。配对机器只出现在 runtime: 那一行下面。
import {
  getLocalExecutionHostLabel,
  isOwnedSshTargetId,
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId,
  toSshExecutionHostId
} from '../../shared/execution-host'

export type ForkHostState = 'connected' | 'connecting' | 'disconnected' | 'unknown'

export type ForkRuntimeSource = {
  id: string
  name: string
  sshTargetId: string | null
  state: ForkHostState
  platform: string | null
}

export type ForkSshSource = {
  id: string
  label: string
  configHost?: string
  state: ForkHostState
  platform: string | null
}

export type ForkHostSources = {
  localPlatform: string
  runtimes: readonly ForkRuntimeSource[]
  sshTargets: readonly ForkSshSource[]
}

export type ForkHostRow = {
  hostId: string
  kind: 'local' | 'ssh' | 'runtime'
  label: string
  envId?: string
  configHost?: string
  aliasHostIds: string[]
  state: ForkHostState
  platform: string | null
  exec: boolean
}

export type ForkWorkspaceRow = {
  hostId: string
  envId?: string
  id: string
  kind: 'worktree' | 'folder'
  name: string
  path: string
  branch: string | null
}

function hostRow(row: ForkHostRow, configHost: string | undefined): ForkHostRow {
  return configHost ? { ...row, configHost } : row
}

function localLabel(platform: string): string {
  if (platform === 'darwin' || platform === 'linux' || platform === 'win32') {
    return getLocalExecutionHostLabel(platform)
  }
  return getLocalExecutionHostLabel(null)
}

/** 托管服务器上只有 runtime 行 exec 为真；ssh 别名永远是假。 */
export function listForkHosts(
  sources: ForkHostSources,
  execUnavailableEnvIds: ReadonlySet<string>
): ForkHostRow[] {
  const sshById = new Map(sources.sshTargets.map((target) => [target.id, target]))
  const paired = new Set<string>()
  const hosts: ForkHostRow[] = [
    {
      hostId: LOCAL_EXECUTION_HOST_ID,
      kind: 'local',
      label: localLabel(sources.localPlatform),
      aliasHostIds: [],
      state: 'connected',
      platform: sources.localPlatform,
      exec: true
    }
  ]
  for (const runtime of sources.runtimes) {
    const runtimeHostId = toRuntimeExecutionHostId(runtime.id)
    const ssh = runtime.sshTargetId ? sshById.get(runtime.sshTargetId) : undefined
    const sshHostId = runtime.sshTargetId ? toSshExecutionHostId(runtime.sshTargetId) : null
    if (runtime.sshTargetId) {
      paired.add(runtime.sshTargetId)
    }
    const label = ssh?.label || runtime.name
    const configHost = ssh?.configHost
    hosts.push(
      hostRow(
        {
          hostId: runtimeHostId,
          kind: 'runtime',
          label,
          envId: runtime.id,
          aliasHostIds: sshHostId ? [sshHostId] : [],
          state: runtime.state,
          platform: runtime.platform,
          exec: runtime.state === 'connected' && !execUnavailableEnvIds.has(runtime.id)
        },
        configHost
      )
    )
    if (sshHostId) {
      hosts.push(
        hostRow(
          {
            hostId: sshHostId,
            kind: 'ssh',
            label,
            aliasHostIds: [runtimeHostId],
            state: ssh?.state ?? 'unknown',
            platform: ssh?.platform ?? runtime.platform,
            exec: false
          },
          configHost
        )
      )
    }
  }
  for (const target of sources.sshTargets) {
    if (paired.has(target.id) || isOwnedSshTargetId(target.id)) {
      continue
    }
    hosts.push(
      hostRow(
        {
          hostId: toSshExecutionHostId(target.id),
          kind: 'ssh',
          label: target.label,
          aliasHostIds: [],
          state: target.state,
          platform: target.platform,
          exec: false
        },
        target.configHost
      )
    )
  }
  return hosts
}

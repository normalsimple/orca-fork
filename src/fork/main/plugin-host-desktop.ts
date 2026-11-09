// 桌面进程才有的配对服务器目录。orcad 不加载这个文件。
import { app } from 'electron'
import { callRuntimeEnvironment } from '../../main/ipc/runtime-environments/runtime-environment-transport-routing'
import { getRuntimeEnvironmentStatusSnapshot } from '../../main/ipc/runtime-environments/runtime-environment-request-connections'
import { mainProcessState } from '../../main/startup/main-process-state'
import { getSshConnectionManager } from '../../main/ssh/targets/ssh-target-registry'
import { isOwnedSshTargetId } from '../../shared/execution-host'
import { getManagedOrcadSshTargetId } from '../../shared/execution-host/managed-orcad-execution-host'
import type { RuntimeHostStatusSnapshot } from '../../shared/remote-runtime/host-status/runtime-host-status'
import { listEnvironments } from '../../shared/remote-runtime/host-store/runtime-environment-store'
import type { SshConnectionStatus } from '../../shared/ssh-types'
import type { ForkHostSources, ForkHostState } from './plugin-host-catalog'
import { ForkRuntimeCallError, type ForkPluginHostBridge } from './plugin-host-methods'

export function desktopForkPluginHostBridge(): ForkPluginHostBridge {
  return {
    loadSources,
    async callRuntime(envId, method, params, timeoutMs, signal) {
      try {
        const response = await callRuntimeEnvironment(
          app.getPath('userData'),
          envId,
          method,
          params,
          timeoutMs,
          undefined,
          undefined,
          signal ? { signal } : undefined
        )
        if (!response.ok) {
          throw new ForkRuntimeCallError(response.error.code, response.error.message)
        }
        return response.result
      } catch (error) {
        if (error instanceof ForkRuntimeCallError) {
          throw error
        }
        throw new ForkRuntimeCallError(
          'host_unreachable',
          error instanceof Error ? error.message : String(error)
        )
      }
    }
  }
}

function loadSources(): ForkHostSources {
  const localPlatform = process.platform
  try {
    const userDataPath = app.getPath('userData')
    const sshStates = getSshConnectionManager()?.getAllStates()
    const sshTargets = (mainProcessState.store?.getSshTargets() ?? [])
      .filter((target) => !isOwnedSshTargetId(target.id))
      .map((target) => {
        const state = sshStates?.get(target.id)
        return {
          id: target.id,
          label: target.label,
          ...(target.configHost ? { configHost: target.configHost } : {}),
          state: sshState(state?.status),
          platform: state?.remotePlatform ?? null
        }
      })
    const runtimes = listEnvironments(userDataPath).map((environment) => {
      const snapshot = getRuntimeEnvironmentStatusSnapshot(environment.id)
      return {
        id: environment.id,
        name: environment.name,
        sshTargetId: getManagedOrcadSshTargetId(environment),
        state: runtimeState(snapshot),
        platform: snapshot?.status?.hostPlatform ?? null
      }
    })
    return { localPlatform, runtimes, sshTargets }
  } catch {
    return { localPlatform, runtimes: [], sshTargets: [] }
  }
}

function runtimeState(snapshot: RuntimeHostStatusSnapshot | null): ForkHostState {
  if (!snapshot) {
    return 'unknown'
  }
  if (snapshot.retired || snapshot.verification === 'blocked') {
    return 'disconnected'
  }
  if (snapshot.transport === 'ready' && snapshot.verification === 'verified') {
    return 'connected'
  }
  if (
    snapshot.verification === 'checking' ||
    snapshot.transport === 'connecting' ||
    snapshot.transport === 'unknown'
  ) {
    return 'connecting'
  }
  if (snapshot.transport === 'disconnected' || snapshot.verification === 'unavailable') {
    return 'disconnected'
  }
  return 'unknown'
}

function sshState(status: SshConnectionStatus | undefined): ForkHostState {
  if (status === 'connected') {
    return 'connected'
  }
  if (status === 'connecting' || status === 'deploying-relay' || status === 'reconnecting') {
    return 'connecting'
  }
  if (status === undefined) {
    return 'unknown'
  }
  return 'disconnected'
}

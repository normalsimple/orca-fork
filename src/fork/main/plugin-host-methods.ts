// 插件 fork.hosts.list / fork.workspaces.list / fork.host.exec。桌面在启动时登记 bridge。
import {
  bind,
  type BoundPluginHostMethod
} from '../../main/plugins/workers/plugin-host-method-bind'
import { PluginHostCallError } from '../../main/plugins/workers/plugin-host-call-scope'
import type { PluginHostMethodContext } from '../../main/plugins/workers/plugin-host-method-bind'
import { PluginRuntimeRpcError } from '../../main/plugins/plugin-runtime-rpc'
import { parseExecutionHostId } from '../../shared/execution-host'
import {
  FORK_EXEC_OUTPUT_DEFAULT_BYTES,
  FORK_EXEC_TIMEOUT_DEFAULT_MS,
  FORK_EXEC_TRANSPORT_MARGIN_MS,
  FORK_HOST_ERROR_HOST_UNREACHABLE,
  FORK_HOST_ERROR_SERVER_METHOD_MISSING,
  FORK_HOST_ERROR_SSH_NOT_SERVED,
  FORK_PLUGIN_HOST_API,
  FORK_WORKSPACE_LIST_LIMIT
} from '../plugins/host-api-spec'
import {
  collectForkWorkspaces,
  forkWorkspaceSelector,
  projectForkWorkspaces
} from './plugin-host-workspaces'
import {
  listForkHosts,
  type ForkHostRow,
  type ForkHostSources,
  type ForkWorkspaceRow
} from './plugin-host-catalog'
import { FORK_WORKSPACE_EXEC_METHOD } from './workspace-exec-method'
import { PLUGIN_HOST_API } from '../../shared/plugins/workers/plugin-host-api'
import { registerPluginHostApiMethods } from '../../shared/plugins/workers/plugin-host-api-registry'

// 主进程的 capability gate 和 dispatch 读登记表。worker 进程各自再登记一次。
registerPluginHostApiMethods(FORK_PLUGIN_HOST_API, Object.keys(PLUGIN_HOST_API))

const api = FORK_PLUGIN_HOST_API
const LIST_TIMEOUT_MS = 15_000

export class ForkRuntimeCallError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ForkRuntimeCallError'
  }
}

export type ForkPluginHostBridge = {
  loadSources(): ForkHostSources
  /** 对一台已保存的 Orca 服务器发运行时 RPC。超时是整次调用的预算。 */
  callRuntime(
    envId: string,
    method: string,
    params: unknown,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<unknown>
}

let bridge: ForkPluginHostBridge | null = null
const execUnavailableEnvIds = new Set<string>()

export function registerForkPluginHostBridge(next: ForkPluginHostBridge): void {
  bridge = next
}

export function resetForkPluginHostForTests(): void {
  bridge = null
  execUnavailableEnvIds.clear()
}

function sources(): ForkHostSources {
  return bridge?.loadSources() ?? { localPlatform: process.platform, runtimes: [], sshTargets: [] }
}

function hosts(): ForkHostRow[] {
  return listForkHosts(sources(), execUnavailableEnvIds)
}

function refuseRpc(error: unknown, envId?: string): never {
  const coded =
    error instanceof PluginRuntimeRpcError || error instanceof ForkRuntimeCallError ? error : null
  if (error instanceof Error && (error.name === 'AbortError' || error.message === 'aborted')) {
    throw new PluginHostCallError('cancelled', 'cancelled')
  }
  if (!coded) {
    throw error instanceof Error ? error : new Error(String(error))
  }
  if (coded.code === 'method_not_found') {
    if (envId) {
      execUnavailableEnvIds.add(envId)
    }
    throw new PluginHostCallError(
      'unavailable',
      'This Orca server does not implement fork.workspace.exec. Update the Orca server on this host.',
      undefined,
      FORK_HOST_ERROR_SERVER_METHOD_MISSING
    )
  }
  if (coded.code === 'invalid_argument') {
    const marker = 'not_permitted:'
    if (coded.message.startsWith(marker)) {
      throw new PluginHostCallError(
        'not_permitted',
        'This host cannot run fork.host.exec.',
        undefined,
        coded.message.slice(marker.length)
      )
    }
    throw new PluginHostCallError('invalid_params', coded.message)
  }
  if (coded.code === 'selector_not_found') {
    throw new PluginHostCallError('invalid_params', coded.message)
  }
  throw new PluginHostCallError(
    'unavailable',
    coded.message,
    undefined,
    FORK_HOST_ERROR_HOST_UNREACHABLE
  )
}

async function callLocal(
  ctx: PluginHostMethodContext,
  method: string,
  params: unknown
): Promise<unknown> {
  const call = ctx.services.runtimeRpc
  if (!call) {
    throw new PluginHostCallError(
      'unavailable',
      'this Orca host cannot run workspace actions',
      undefined,
      FORK_HOST_ERROR_HOST_UNREACHABLE
    )
  }
  ctx.scope.assertActive()
  return call(method, params, {
    ...(ctx.scope.signal ? { signal: ctx.scope.signal } : {}),
    beforeEffect: () => ctx.scope.assertActive()
  })
}

async function listOnHost(
  host: ForkHostRow,
  ctx: PluginHostMethodContext
): Promise<{ rows: ForkWorkspaceRow[]; truncated: boolean }> {
  if (host.kind === 'runtime') {
    if (!host.envId || !bridge) {
      throw new ForkRuntimeCallError('host_unreachable', 'runtime bridge is not registered')
    }
    const call = (method: string, params: unknown) =>
      bridge!.callRuntime(host.envId!, method, params, LIST_TIMEOUT_MS, ctx.scope.signal)
    const [listed, repos, folders] = await Promise.all([
      call('worktree.list', { limit: FORK_WORKSPACE_LIST_LIMIT }),
      call('repo.list', {}),
      call('folderWorkspace.list', undefined)
    ])
    return projectForkWorkspaces(listed, repos, folders, { hostId: host.hostId, envId: host.envId })
  }
  const [listed, repos, folders] = await Promise.all([
    callLocal(ctx, 'worktree.list', { limit: FORK_WORKSPACE_LIST_LIMIT }),
    callLocal(ctx, 'repo.list', {}),
    callLocal(ctx, 'folderWorkspace.list', undefined)
  ])
  return projectForkWorkspaces(listed, repos, folders)
}

const handlers = {
  'fork.hosts.list': bind(api['fork.hosts.list'], async () => ({ hosts: hosts() })),
  'fork.workspaces.list': bind(api['fork.workspaces.list'], async (params, ctx) => {
    const known = hosts()
    return collectForkWorkspaces({
      hostId: params?.hostId,
      hosts: known,
      listOnHost: (host) => listOnHost(host, ctx)
    })
  }),
  'fork.host.exec': bind(api['fork.host.exec'], async (params, ctx) => {
    ctx.scope.assertActive()
    const parsed = parseExecutionHostId(params.hostId)
    if (!parsed) {
      throw new PluginHostCallError('invalid_params', 'unknown hostId')
    }
    if (parsed.kind === 'ssh') {
      throw new PluginHostCallError(
        'not_permitted',
        'SSH hosts are not served here. Call fork.host.exec with the runtime host.',
        undefined,
        FORK_HOST_ERROR_SSH_NOT_SERVED
      )
    }
    const timeoutMs = params.timeoutMs ?? FORK_EXEC_TIMEOUT_DEFAULT_MS
    const rpcParams = {
      worktree: forkWorkspaceSelector(params.workspaceId),
      argv: params.argv,
      ...(params.cwd !== undefined ? { cwd: params.cwd } : {}),
      ...(params.env ? { env: params.env } : {}),
      ...(params.stdin !== undefined ? { stdin: params.stdin } : {}),
      timeoutMs,
      maxOutputBytes: params.maxOutputBytes ?? FORK_EXEC_OUTPUT_DEFAULT_BYTES
    }
    try {
      if (parsed.kind === 'local') {
        return api['fork.host.exec'].result.parse(
          await callLocal(ctx, FORK_WORKSPACE_EXEC_METHOD, rpcParams)
        )
      }
      if (!bridge) {
        throw new ForkRuntimeCallError('host_unreachable', 'runtime bridge is not registered')
      }
      ctx.scope.assertActive()
      return api['fork.host.exec'].result.parse(
        await bridge.callRuntime(
          parsed.environmentId,
          FORK_WORKSPACE_EXEC_METHOD,
          rpcParams,
          timeoutMs + FORK_EXEC_TRANSPORT_MARGIN_MS,
          ctx.scope.signal
        )
      )
    } catch (error) {
      if (ctx.scope.signal?.aborted) {
        throw new PluginHostCallError('cancelled', 'cancelled')
      }
      return refuseRpc(error, parsed.kind === 'runtime' ? parsed.environmentId : undefined)
    }
  })
} satisfies Record<keyof typeof FORK_PLUGIN_HOST_API, BoundPluginHostMethod>

export const FORK_PLUGIN_HOST_HANDLERS = handlers

/** 审计日志只记目标，不记 stdin 和环境。 */
export function summarizeForkPluginHostCall(
  method: string,
  record: Record<string, unknown>
): string {
  if (method !== 'fork.host.exec') {
    return ''
  }
  const argv = Array.isArray(record.argv) ? record.argv : []
  const argv0 = typeof argv[0] === 'string' ? argv[0] : ''
  return `host=${String(record.hostId)} workspace=${String(record.workspaceId)} argv0=${argv0}`
}

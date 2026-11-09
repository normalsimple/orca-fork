import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId,
  toSshExecutionHostId
} from '../../shared/execution-host'
import { executePluginHostCall } from '../../main/plugins/workers/plugin-host-methods'
import type { PluginHostServices } from '../../main/plugins/workers/plugin-host-method-bindings'
import {
  PLUGIN_HOST_API_MINOR,
  pluginHostMethodsFor
} from '../../shared/plugins/workers/plugin-host-api'
import {
  FORK_EXEC_TRANSPORT_MARGIN_MS,
  FORK_HOST_ERROR_SERVER_METHOD_MISSING,
  FORK_HOST_ERROR_SSH_NOT_SERVED
} from '../plugins/host-api-spec'
import type { ForkHostSources } from './plugin-host-catalog'
import {
  ForkRuntimeCallError,
  FORK_PLUGIN_HOST_HANDLERS,
  registerForkPluginHostBridge,
  resetForkPluginHostForTests
} from './plugin-host-methods'

const scope = { assertActive(): void {} }
const runtimeHost = toRuntimeExecutionHostId('env-a')
const runtimeHostB = toRuntimeExecutionHostId('env-b')
const sshHost = toSshExecutionHostId('alias')
const bareSsh = toSshExecutionHostId('bare')

const sources: ForkHostSources = {
  localPlatform: 'linux',
  runtimes: [
    { id: 'env-a', name: 'paired', sshTargetId: 'alias', state: 'connected', platform: 'linux' },
    { id: 'env-b', name: 'down', sshTargetId: null, state: 'disconnected', platform: 'linux' }
  ],
  sshTargets: [
    {
      id: 'alias',
      label: 'paired',
      configHost: 'paired-host',
      state: 'connected',
      platform: 'linux'
    },
    { id: 'bare', label: 'bare', configHost: 'bare-host', state: 'disconnected', platform: null }
  ]
}

function worktrees(rows: { id: string; name: string; path: string; hostId?: string }[]) {
  return {
    worktrees: rows.map((row) => ({
      id: row.id,
      repoId: 'repo',
      displayName: row.name,
      path: row.path,
      branch: 'refs/heads/main',
      ...(row.hostId ? { hostId: row.hostId } : {})
    })),
    totalCount: rows.length,
    truncated: false
  }
}

const emptyRepos = { repos: [] }
const emptyFolders = { folderWorkspaces: [] }

beforeEach(() => {
  resetForkPluginHostForTests()
})

async function execHandler(
  method: string,
  params: unknown,
  services: PluginHostServices
): Promise<unknown> {
  const prepared = FORK_PLUGIN_HOST_HANDLERS[method]?.prepare(params)
  if (!prepared?.ok) {
    throw new Error(prepared && !prepared.ok ? prepared.issue : 'missing handler')
  }
  const executed = await prepared.execute({ pluginId: 'pub.plug', services, scope })
  return executed?.value
}

describe('fork host API', () => {
  it('is visible to worker host.has and does not raise the host API minor', () => {
    expect(pluginHostMethodsFor('worker')).toEqual(
      expect.arrayContaining(['fork.hosts.list', 'fork.workspaces.list', 'fork.host.exec'])
    )
    expect(pluginHostMethodsFor('panel')).not.toContain('fork.host.exec')
    expect(PLUGIN_HOST_API_MINOR).toBe(4)
  })

  it('lists both alias rows and keeps exec on the runtime row only', async () => {
    registerForkPluginHostBridge({
      loadSources: () => sources,
      callRuntime: vi.fn()
    })
    const listed = (await execHandler(
      'fork.hosts.list',
      undefined,
      {} as unknown as PluginHostServices
    )) as {
      hosts: {
        hostId: string
        kind: string
        exec: boolean
        envId?: string
        configHost?: string
        aliasHostIds: string[]
      }[]
    }
    const runtime = listed.hosts.find((host) => host.hostId === runtimeHost)
    const ssh = listed.hosts.find((host) => host.hostId === sshHost)
    const down = listed.hosts.find((host) => host.hostId === runtimeHostB)
    expect(runtime).toMatchObject({
      kind: 'runtime',
      exec: true,
      envId: 'env-a',
      configHost: 'paired-host',
      aliasHostIds: [sshHost]
    })
    expect(ssh).toMatchObject({ kind: 'ssh', exec: false, aliasHostIds: [runtimeHost] })
    expect(down).toMatchObject({ exec: false, state: 'disconnected' })
    expect(listed.hosts.find((host) => host.hostId === bareSsh)?.exec).toBe(false)
    expect(listed.hosts.find((host) => host.hostId === LOCAL_EXECUTION_HOST_ID)?.exec).toBe(true)
  })

  it('lists workspaces per serving host and records unreachable hosts', async () => {
    const calls: string[] = []
    registerForkPluginHostBridge({
      loadSources: () => sources,
      callRuntime: async (envId, method) => {
        calls.push(`${envId}:${method}`)
        if (envId === 'env-b') {
          throw new ForkRuntimeCallError('host_unreachable', 'down')
        }
        if (method === 'worktree.list') {
          return worktrees([{ id: 'remote-wt', name: 'remote', path: '/srv/app' }])
        }
        return method === 'repo.list' ? emptyRepos : emptyFolders
      }
    })
    const services = {
      runtimeRpc: async (method: string) => {
        if (method === 'worktree.list') {
          return worktrees([
            { id: 'local-wt', name: 'local', path: '/home/local' },
            { id: 'stale', name: 'stale', path: '/srv/app', hostId: sshHost }
          ])
        }
        return method === 'repo.list' ? emptyRepos : emptyFolders
      }
    } as unknown as PluginHostServices
    const listed = (await execHandler('fork.workspaces.list', undefined, services)) as {
      workspaces: { hostId: string; id: string; envId?: string }[]
      unreachable: string[]
    }
    expect(listed.workspaces.map((row) => `${row.hostId}:${row.id}`)).toEqual([
      `${LOCAL_EXECUTION_HOST_ID}:local-wt`,
      `${runtimeHost}:remote-wt`
    ])
    expect(listed.workspaces.find((row) => row.id === 'remote-wt')?.envId).toBe('env-a')
    expect(listed.unreachable).toEqual([runtimeHostB])
    expect(calls.some((call) => call.startsWith('env-a:'))).toBe(true)
  })

  it('refuses a bare ssh host', async () => {
    const outcome = await executePluginHostCall({
      pluginId: 'pub.plug',
      method: 'fork.host.exec',
      params: { hostId: bareSsh, workspaceId: 'w', argv: ['true'] },
      surface: 'worker',
      grantedCapabilities: ['terminal:send'],
      services: {} as unknown as PluginHostServices,
      audit: { record: vi.fn().mockResolvedValue(undefined) },
      scope
    })
    expect(outcome).toMatchObject({
      ok: false,
      code: 'not_permitted',
      reason: FORK_HOST_ERROR_SSH_NOT_SERVED
    })
  })

  it('routes runtime exec through the transport and remembers method_not_found', async () => {
    const seen: { timeoutMs?: number; env?: unknown; method?: string } = {}
    registerForkPluginHostBridge({
      loadSources: () => sources,
      callRuntime: async (_envId, method, params, timeoutMs) => {
        seen.method = method
        seen.timeoutMs = timeoutMs
        seen.env = (params as { env?: unknown }).env
        throw new ForkRuntimeCallError('method_not_found', 'Unknown method: fork.workspace.exec')
      }
    })
    const outcome = await executePluginHostCall({
      pluginId: 'pub.plug',
      method: 'fork.host.exec',
      params: {
        hostId: runtimeHost,
        workspaceId: 'remote-wt',
        argv: ['true'],
        env: { PATH: '/custom' },
        timeoutMs: 5_000
      },
      surface: 'worker',
      grantedCapabilities: ['terminal:send'],
      services: {} as unknown as PluginHostServices,
      audit: { record: vi.fn().mockResolvedValue(undefined) },
      scope
    })
    expect(seen).toMatchObject({
      method: 'fork.workspace.exec',
      timeoutMs: 5_000 + FORK_EXEC_TRANSPORT_MARGIN_MS,
      env: { PATH: '/custom' }
    })
    expect(outcome).toMatchObject({
      ok: false,
      code: 'unavailable',
      reason: FORK_HOST_ERROR_SERVER_METHOD_MISSING
    })
    const listed = (await execHandler(
      'fork.hosts.list',
      undefined,
      {} as unknown as PluginHostServices
    )) as {
      hosts: { hostId: string; exec: boolean }[]
    }
    expect(listed.hosts.find((host) => host.hostId === runtimeHost)?.exec).toBe(false)
  })

  it('audits fork.host.exec', async () => {
    const record = vi.fn().mockResolvedValue(undefined)
    const outcome = await executePluginHostCall({
      pluginId: 'pub.plug',
      method: 'fork.host.exec',
      params: { hostId: 'local', workspaceId: 'local-wt', argv: ['true'] },
      surface: 'worker',
      grantedCapabilities: ['terminal:send'],
      services: {
        runtimeRpc: async () => ({
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          truncated: false,
          timedOut: false
        })
      } as unknown as PluginHostServices,
      audit: { record },
      scope
    })
    expect(outcome).toMatchObject({ ok: true, value: { exitCode: 0 } })
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'plugin:pub.plug',
        method: 'fork.host.exec',
        outcome: 'attempt',
        summary: 'host=local workspace=local-wt argv0=true'
      })
    )
  })
})

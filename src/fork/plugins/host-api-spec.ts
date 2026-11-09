// fork: 插件主机 API（fork.*）。桌面主进程和插件 worker 启动时登记，host.has 才认得到。
// 不能写进 shared 的 PLUGIN_HOST_API：CLI 顺着 agent-hooks 会编到这里，打包却只有 out/cli 和 out/shared。
// 生成的插件文档和类型表会滤掉 fork. 前缀，避免和上游生成物冲突。
import { z } from 'zod'
import { spec, WORKER_ONLY } from '../../shared/plugins/workers/plugin-host-method-spec'

export const FORK_EXEC_STDIN_MAX_BYTES = 8 * 1024 * 1024
export const FORK_EXEC_OUTPUT_MAX_BYTES = 16 * 1024 * 1024
export const FORK_EXEC_OUTPUT_DEFAULT_BYTES = 1024 * 1024
export const FORK_EXEC_TIMEOUT_DEFAULT_MS = 30_000
export const FORK_EXEC_TIMEOUT_MIN_MS = 1_000
export const FORK_EXEC_TIMEOUT_MAX_MS = 110_000
/** 传输超时比子进程多这一段，好让 SIGKILL 的结果赶在客户端放弃之前回来。 */
export const FORK_EXEC_TRANSPORT_MARGIN_MS = 1_500
export const FORK_EXEC_MINIMAL_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
export const FORK_WORKSPACE_LIST_LIMIT = 2000
export const FORK_HOST_ID_MAX = 1024

export const FORK_HOST_ERROR_SERVER_METHOD_MISSING = 'server-method-missing'
export const FORK_HOST_ERROR_HOST_UNREACHABLE = 'host-unreachable'
export const FORK_HOST_ERROR_SSH_NOT_SERVED = 'ssh-not-served'

const hostId = z.string().min(1).max(FORK_HOST_ID_MAX)
const workspaceId = z.string().min(1).max(FORK_HOST_ID_MAX)

export const forkExecArgvSchema = z.array(z.string().min(1).max(4096)).min(1).max(64)
export const forkExecEnvSchema = z.record(
  z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
  z.string().max(4096)
)

const hostRow = z.object({
  hostId,
  kind: z.enum(['local', 'ssh', 'runtime']),
  label: z.string(),
  /** runtime 主机才有：`orca agent launch --environment` 要的环境 id。 */
  envId: z.string().optional(),
  /** OpenSSH 的 Host 别名（configHost），Orca 知道时才有。 */
  configHost: z.string().optional(),
  aliasHostIds: z.array(z.string()),
  state: z.enum(['connected', 'connecting', 'disconnected', 'unknown']),
  platform: z.string().nullable(),
  exec: z.boolean()
})

const workspaceRow = z.object({
  hostId,
  envId: z.string().optional(),
  id: workspaceId,
  kind: z.enum(['worktree', 'folder']),
  name: z.string(),
  path: z.string(),
  branch: z.string().nullable()
})

const execResult = z.object({
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  stdout: z.string().max(FORK_EXEC_OUTPUT_MAX_BYTES),
  stderr: z.string().max(FORK_EXEC_OUTPUT_MAX_BYTES),
  truncated: z.boolean(),
  timedOut: z.boolean()
})

export const FORK_PLUGIN_HOST_API = {
  'fork.hosts.list': spec({
    summary:
      'Execution hosts this Orca knows: this machine, SSH targets and saved Orca servers, including ssh/runtime aliases.',
    since: 4,
    scope: 'desktop',
    capability: 'workspace:read',
    mutation: false,
    surfaces: WORKER_ONLY,
    params: z.strictObject({}).optional(),
    result: z.object({ hosts: z.array(hostRow) })
  }),
  'fork.workspaces.list': spec({
    summary:
      'Workspaces on this machine and on connected paired Orca servers. A machine is listed only under its serving runtime host.',
    since: 4,
    scope: 'any-workspace',
    capability: 'workspace:read',
    mutation: false,
    surfaces: WORKER_ONLY,
    params: z.strictObject({ hostId: hostId.optional() }).optional(),
    result: z.object({
      workspaces: z.array(workspaceRow).max(FORK_WORKSPACE_LIST_LIMIT),
      truncated: z.boolean(),
      unreachable: z.array(hostId)
    })
  }),
  'fork.host.exec': spec({
    summary:
      'Runs a program in a workspace on the host that owns it and returns its output. No shell and no PTY. argv only.',
    since: 4,
    scope: 'any-workspace',
    capability: 'terminal:send',
    mutation: true,
    surfaces: WORKER_ONLY,
    params: z.strictObject({
      hostId,
      workspaceId,
      argv: forkExecArgvSchema,
      cwd: z.string().max(1024).optional(),
      env: forkExecEnvSchema.optional(),
      stdin: z.string().max(FORK_EXEC_STDIN_MAX_BYTES).optional(),
      timeoutMs: z
        .number()
        .int()
        .min(FORK_EXEC_TIMEOUT_MIN_MS)
        .max(FORK_EXEC_TIMEOUT_MAX_MS)
        .optional(),
      maxOutputBytes: z.number().int().min(1024).max(FORK_EXEC_OUTPUT_MAX_BYTES).optional()
    }),
    result: execResult
  })
}

// 配对服务器和本机运行时共用的 fork.workspace.exec。工作区必须是这台机器自己能读的。
import { z } from 'zod'
import { defineMethod, InvalidArgumentError } from '../../main/runtime/rpc/core'
import { requireLocalRuntimeFileRoute } from '../../main/runtime/files/file-target'
import { ExecutionHostNotDispatchableError } from '../../main/providers/execution-host-provider-dispatch'
import { SshHostNotServedError } from '../../main/providers/ssh-host-not-served-error'
import {
  FORK_EXEC_OUTPUT_MAX_BYTES,
  FORK_EXEC_STDIN_MAX_BYTES,
  FORK_EXEC_TIMEOUT_MAX_MS,
  FORK_EXEC_TIMEOUT_MIN_MS,
  FORK_HOST_ERROR_SSH_NOT_SERVED,
  forkExecArgvSchema,
  forkExecEnvSchema
} from '../plugins/host-api-spec'
import { runWorkspaceExec } from './workspace-exec'

const ForkWorkspaceExecParams = z.object({
  worktree: z.string().min(1).max(1024),
  argv: forkExecArgvSchema,
  cwd: z.string().max(1024).optional(),
  env: forkExecEnvSchema.optional(),
  stdin: z.string().max(FORK_EXEC_STDIN_MAX_BYTES).optional(),
  timeoutMs: z.number().int().min(FORK_EXEC_TIMEOUT_MIN_MS).max(FORK_EXEC_TIMEOUT_MAX_MS),
  maxOutputBytes: z.number().int().min(1024).max(FORK_EXEC_OUTPUT_MAX_BYTES)
})

export const FORK_WORKSPACE_EXEC_METHOD = 'fork.workspace.exec'

export const FORK_WORKSPACE_EXEC_METHODS = [
  defineMethod({
    name: FORK_WORKSPACE_EXEC_METHOD,
    permission: 'workspace',
    params: ForkWorkspaceExecParams,
    handler: async (params, { runtime, signal }) => {
      const target = await runtime.resolveRuntimeFileTarget(params.worktree)
      try {
        requireLocalRuntimeFileRoute(target)
      } catch (error) {
        if (
          error instanceof SshHostNotServedError ||
          error instanceof ExecutionHostNotDispatchableError
        ) {
          throw new InvalidArgumentError(`not_permitted:${FORK_HOST_ERROR_SSH_NOT_SERVED}`)
        }
        throw error
      }
      return runWorkspaceExec({
        root: target.worktree.path,
        cwd: params.cwd,
        argv: params.argv,
        env: params.env,
        stdin: params.stdin,
        timeoutMs: params.timeoutMs,
        maxOutputBytes: params.maxOutputBytes,
        signal
      })
    }
  })
]

export type ForkWorkspaceExecMethodName = (typeof FORK_WORKSPACE_EXEC_METHODS)[number]['name']

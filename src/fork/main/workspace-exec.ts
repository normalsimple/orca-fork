// 在工作区里 argv 执行（shell: false）。环境是最小集合，不继承 Orca 进程的环境。
import { spawn } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { InvalidArgumentError } from '../../main/runtime/rpc/core'
import { isPathInsideOrEqual } from '../../shared/cross-platform-path'
import {
  FORK_EXEC_MINIMAL_PATH,
  FORK_EXEC_STDIN_MAX_BYTES,
  type forkExecEnvSchema
} from '../plugins/host-api-spec'
import type { z } from 'zod'

export type WorkspaceExecResult = {
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  truncated: boolean
  timedOut: boolean
}

export type HostAccount = { home: string; user: string; lang: string }

type EnvOverrides = z.infer<typeof forkExecEnvSchema>

/** 本机登录用户。HOME 空则用 `/`，避免子进程拿到空 HOME。 */
export function forkHostAccount(): HostAccount {
  let home = ''
  let user = ''
  try {
    const info = userInfo()
    home = info.homedir
    user = info.username
  } catch {
    home = ''
    user = ''
  }
  if (!home) {
    try {
      home = homedir()
    } catch {
      home = ''
    }
  }
  const lang = process.env.LANG
  return {
    home: home || '/',
    user: user || 'user',
    lang: lang && lang.length > 0 ? lang : 'C.UTF-8'
  }
}

/**
 * 只放 HOME、USER、LANG 和固定 PATH。调用方同名键覆盖；空的 HOME 覆盖被丢掉。
 * 不复制进程环境里的其它变量。
 */
export function forkMinimalExecEnv(
  account: HostAccount,
  overrides?: EnvOverrides
): Record<string, string> {
  const env: Record<string, string> = {
    HOME: account.home || '/',
    USER: account.user,
    LANG: account.lang,
    PATH: FORK_EXEC_MINIMAL_PATH
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (key === 'HOME' && value.length === 0) {
        continue
      }
      env[key] = value
    }
  }
  if (!env.HOME) {
    env.HOME = account.home || '/'
  }
  return env
}

/** `.`、空和省略都是工作区根。绝对路径和 `..` 拒绝。软链解析后仍必须留在根里。 */
export async function resolveWorkspaceCwd(root: string, cwd: string | undefined): Promise<string> {
  const rootReal = await realpath(root)
  if (cwd === undefined || cwd === '' || cwd === '.') {
    return rootReal
  }
  if (!isLexicalWorkspaceCwd(cwd)) {
    throw new InvalidArgumentError('cwd must be relative and stay inside the workspace')
  }
  const lexical = resolve(rootReal, cwd)
  if (!isPathInsideOrEqual(rootReal, lexical)) {
    throw new InvalidArgumentError('cwd must be relative and stay inside the workspace')
  }
  try {
    const targetReal = await realpath(lexical)
    if (!isPathInsideOrEqual(rootReal, targetReal)) {
      throw new InvalidArgumentError('cwd must be relative and stay inside the workspace')
    }
    return targetReal
  } catch (error) {
    if (error instanceof InvalidArgumentError) {
      throw error
    }
    if (isEnoent(error)) {
      return lexical
    }
    throw error
  }
}

function isLexicalWorkspaceCwd(cwd: string): boolean {
  if (isAbsolute(cwd) || /^[a-zA-Z]:[\\/]/.test(cwd) || cwd.startsWith('\\\\')) {
    return false
  }
  const parts = cwd.split(/[\\/]/)
  return parts.every((part) => part !== '..') && parts.some((part) => part !== '' && part !== '.')
}

function abortedError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error('aborted')
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

export async function runWorkspaceExec(input: {
  root: string
  cwd?: string
  argv: readonly string[]
  env?: EnvOverrides
  stdin?: string
  timeoutMs: number
  maxOutputBytes: number
  hostAccount?: HostAccount
  signal?: AbortSignal
}): Promise<WorkspaceExecResult> {
  if (input.signal?.aborted) {
    throw abortedError(input.signal.reason)
  }
  const stdinBytes = input.stdin === undefined ? 0 : Buffer.byteLength(input.stdin, 'utf8')
  if (stdinBytes > FORK_EXEC_STDIN_MAX_BYTES) {
    throw new InvalidArgumentError('stdin exceeds 8 MiB')
  }
  const cwd = await resolveWorkspaceCwd(input.root, input.cwd)
  const env = forkMinimalExecEnv(input.hostAccount ?? forkHostAccount(), input.env)
  return spawnCaptured({
    argv: input.argv,
    cwd,
    env,
    stdin: input.stdin,
    timeoutMs: input.timeoutMs,
    maxOutputBytes: input.maxOutputBytes,
    signal: input.signal
  })
}

type Finish =
  | { kind: 'spawn'; error: NodeJS.ErrnoException }
  | { kind: 'timeout' }
  | { kind: 'truncated' }
  | { kind: 'close'; code: number | null; signal: NodeJS.Signals | null }
  | { kind: 'aborted' }

function spawnCaptured(input: {
  argv: readonly string[]
  cwd: string
  env: Record<string, string>
  stdin?: string
  timeoutMs: number
  maxOutputBytes: number
  signal?: AbortSignal
}): Promise<WorkspaceExecResult> {
  const child = spawn(input.argv[0], input.argv.slice(1), {
    cwd: input.cwd,
    env: input.env,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    // Unix 上单独成组，超时才能把子进程一起杀掉。
    detached: process.platform !== 'win32'
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let budget = input.maxOutputBytes
  let settled = false

  const killGroup = (): void => {
    const pid = child.pid
    if (pid === undefined) {
      return
    }
    if (process.platform !== 'win32') {
      try {
        process.kill(-pid, 'SIGKILL')
        return
      } catch {
        // 进程组已经没了就退回杀这一个。
      }
    }
    child.kill('SIGKILL')
  }

  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => finish({ kind: 'timeout' }), input.timeoutMs)
    const onAbort = (): void => finish({ kind: 'aborted' })
    input.signal?.addEventListener('abort', onAbort, { once: true })

    const take = (target: Buffer[], chunk: Buffer): void => {
      if (settled) {
        return
      }
      if (budget <= 0) {
        finish({ kind: 'truncated' })
        return
      }
      if (chunk.length <= budget) {
        target.push(chunk)
        budget -= chunk.length
        return
      }
      target.push(chunk.subarray(0, budget))
      budget = 0
      finish({ kind: 'truncated' })
    }

    const finish = (reason: Finish): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', onAbort)
      if (reason.kind !== 'close' && reason.kind !== 'spawn') {
        killGroup()
      }
      if (reason.kind === 'aborted') {
        reject(abortedError(input.signal?.reason))
        return
      }
      if (reason.kind === 'spawn') {
        const code = reason.error.code
        const message = reason.error.message
        resolvePromise({
          exitCode: 127,
          signal: null,
          stdout: '',
          stderr: code && !message.includes(code) ? `${message} ${code}` : message,
          truncated: false,
          timedOut: false
        })
        return
      }
      if (reason.kind === 'timeout' || reason.kind === 'truncated') {
        resolvePromise({
          exitCode: null,
          signal: 'SIGKILL',
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          truncated: reason.kind === 'truncated',
          timedOut: reason.kind === 'timeout'
        })
        return
      }
      resolvePromise({
        exitCode: reason.code,
        signal: reason.signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        truncated: false,
        timedOut: false
      })
    }

    child.stdout?.on('data', (chunk: Buffer) => take(stdout, chunk))
    child.stderr?.on('data', (chunk: Buffer) => take(stderr, chunk))
    child.on('error', (error: NodeJS.ErrnoException) => finish({ kind: 'spawn', error }))
    child.on('close', (code, closeSignal) => finish({ kind: 'close', code, signal: closeSignal }))
    child.stdin?.on('error', () => undefined)
    if (input.stdin !== undefined && input.stdin.length > 0) {
      child.stdin?.end(Buffer.from(input.stdin, 'utf8'))
    } else {
      child.stdin?.end()
    }
  })
}

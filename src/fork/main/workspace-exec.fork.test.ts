import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InvalidArgumentError } from '../../main/runtime/rpc/core'
import { FORK_EXEC_MINIMAL_PATH } from '../plugins/host-api-spec'
import { forkMinimalExecEnv, runWorkspaceExec } from './workspace-exec'

const node = process.execPath
const roots: string[] = []

async function makeRoot(): Promise<string> {
  // Darwin 上 /tmp、/var/folders 会指到 /private/...，子进程的 cwd 是 realpath。
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fork-exec-')))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('runWorkspaceExec', () => {
  it('runs argv with no shell', async () => {
    const result = await runWorkspaceExec({
      root: await makeRoot(),
      argv: [node, '-e', 'process.stdout.write(process.argv[1])', 'a && echo b'],
      timeoutMs: 5_000,
      maxOutputBytes: 1024
    })
    expect(result).toMatchObject({
      exitCode: 0,
      signal: null,
      stdout: 'a && echo b',
      timedOut: false,
      truncated: false
    })
  })

  it('gives the child a minimal env and keeps HOME', async () => {
    const sentinel = 'FORK_EXEC_SENTINEL_TEST'
    const previousPath = process.env.PATH
    process.env[sentinel] = 'nope'
    process.env.PATH = '/not-the-child-path'
    try {
      const result = await runWorkspaceExec({
        root: await makeRoot(),
        argv: [
          node,
          '-e',
          `process.stdout.write(JSON.stringify({path:process.env.PATH,sentinel:process.env.${sentinel}??null,home:process.env.HOME}))`
        ],
        env: { PATH: '/custom', HOME: '' },
        timeoutMs: 5_000,
        maxOutputBytes: 4096,
        hostAccount: { home: '/host-home', user: 'ada', lang: 'C.UTF-8' }
      })
      expect(JSON.parse(result.stdout)).toEqual({
        path: '/custom',
        sentinel: null,
        home: '/host-home'
      })
    } finally {
      delete process.env[sentinel]
      process.env.PATH = previousPath
    }
  })

  it('writes stdin bytes without a NUL frame', async () => {
    const result = await runWorkspaceExec({
      root: await makeRoot(),
      argv: [
        node,
        '-e',
        'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(s))'
      ],
      stdin: 'a\0b',
      timeoutMs: 5_000,
      maxOutputBytes: 1024
    })
    expect(result.stdout).toBe('a\0b')
    expect(result.exitCode).toBe(0)
  })

  it('confines cwd to the workspace and accepts .', async () => {
    const dir = await makeRoot()
    const sub = join(dir, 'sub')
    await mkdir(sub)
    const inside = await runWorkspaceExec({
      root: dir,
      cwd: 'sub',
      argv: [node, '-e', 'process.stdout.write(process.cwd())'],
      timeoutMs: 5_000,
      maxOutputBytes: 4096
    })
    expect(inside.stdout).toBe(await realpath(sub))
    const dot = await runWorkspaceExec({
      root: dir,
      cwd: '.',
      argv: [node, '-e', 'process.stdout.write(process.cwd())'],
      timeoutMs: 5_000,
      maxOutputBytes: 4096
    })
    expect(dot.stdout).toBe(await realpath(dir))
    await expect(
      runWorkspaceExec({
        root: dir,
        cwd: '..',
        argv: [node, '-e', 'process.exit(0)'],
        timeoutMs: 5_000,
        maxOutputBytes: 1024
      })
    ).rejects.toBeInstanceOf(InvalidArgumentError)
    const outside = await makeRoot()
    await symlink(outside, join(dir, 'link'))
    await expect(
      runWorkspaceExec({
        root: dir,
        cwd: 'link',
        argv: [node, '-e', 'process.exit(0)'],
        timeoutMs: 5_000,
        maxOutputBytes: 1024
      })
    ).rejects.toBeInstanceOf(InvalidArgumentError)
  })

  it('kills on timeout', async () => {
    const result = await runWorkspaceExec({
      root: await makeRoot(),
      argv: [node, '-e', 'setInterval(()=>{},1000)'],
      timeoutMs: 200,
      maxOutputBytes: 1024
    })
    expect(result).toMatchObject({ exitCode: null, signal: 'SIGKILL', timedOut: true })
  })

  it('returns the prefix and a null exit code when output is truncated', async () => {
    const result = await runWorkspaceExec({
      root: await makeRoot(),
      argv: [node, '-e', 'process.stdout.write("x".repeat(5000))'],
      timeoutMs: 5_000,
      maxOutputBytes: 100
    })
    expect(result.stdout).toBe('x'.repeat(100))
    expect(result).toMatchObject({
      truncated: true,
      exitCode: null,
      signal: 'SIGKILL',
      timedOut: false
    })
  })

  it('maps a missing binary to exit 127 without throwing', async () => {
    const dir = await makeRoot()
    const result = await runWorkspaceExec({
      root: dir,
      argv: [join(dir, 'missing-bin')],
      timeoutMs: 5_000,
      maxOutputBytes: 1024
    })
    expect(result.exitCode).toBe(127)
    expect(result.timedOut).toBe(false)
    expect(result.stderr).toContain('ENOENT')
  })
})

describe('forkMinimalExecEnv', () => {
  it('never leaves HOME empty', () => {
    expect(forkMinimalExecEnv({ home: '', user: 'u', lang: 'C' }).HOME).toBe('/')
    expect(forkMinimalExecEnv({ home: '/h', user: 'u', lang: 'C' }, { HOME: '' }).HOME).toBe('/h')
    expect(forkMinimalExecEnv({ home: '/h', user: 'u', lang: 'C' }).PATH).toBe(
      FORK_EXEC_MINIMAL_PATH
    )
  })
})

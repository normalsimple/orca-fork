// F007 was removed because upstream covers it. This pins upstream's two POSIX browse paths
// (SSH listing command and managed-server readdir) on the cases the fork tail got wrong.
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { chmod, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RuntimeServerEnvironmentCommands } from '../main/runtime/files/server-browse/runtime-server-environment-commands'
import { browseSshDirectory } from '../main/ssh/ssh-remote-directory-browse'

// Runs the generated remote command in a local `sh`, standing in for the SSH exec channel.
function shellBackedManager(): Parameters<typeof browseSshDirectory>[0] {
  const exec = async (command: string): Promise<EventEmitter & { stderr: EventEmitter }> => {
    const child = spawn('/bin/sh', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'] })
    const channel = Object.assign(new EventEmitter(), { stderr: new EventEmitter() })
    child.stdout.on('data', (data: Buffer) => channel.emit('data', data))
    child.stderr.on('data', (data: Buffer) => channel.stderr.emit('data', data))
    child.on('close', (code) => {
      channel.emit('exit', code)
      channel.emit('close', code)
    })
    return channel
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: browseSshDirectory only calls getConnection(id).exec(command).
  return { getConnection: () => ({ exec }) } as never
}

const ssh = (path: string) => browseSshDirectory(shellBackedManager(), 'ssh-1', path)
const server = (path: string) => new RuntimeServerEnvironmentCommands().browseDirectory(path)
const isRoot = process.getuid?.() === 0

describe.skipIf(process.platform === 'win32')('upstream directory browse (F007 removed)', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-fork-browse-'))
    await mkdir(join(root, 'real-dir', 'child'), { recursive: true })
    await mkdir(join(root, 'empty'))
    await symlink(join(root, 'real-dir'), join(root, 'link-dir'))
    await symlink(join(root, 'missing'), join(root, 'dangling'))
    // Execute-only: `cd` and `pwd` succeed, reading the entries fails.
    await mkdir(join(root, 'unreadable'), { mode: 0o100 })
  })

  afterEach(async () => {
    await chmod(join(root, 'unreadable'), 0o700)
    await rm(root, { recursive: true, force: true })
  })

  it('SSH: a directory symlink is a directory, expands, and a dangling link is a file', async () => {
    const top = await ssh(root)
    expect(top.entries).toEqual([
      { name: 'empty', isDirectory: true },
      { name: 'link-dir', isDirectory: true },
      { name: 'real-dir', isDirectory: true },
      { name: 'unreadable', isDirectory: true },
      { name: 'dangling', isDirectory: false }
    ])
    expect((await ssh(join(root, 'link-dir'))).entries).toEqual([
      { name: 'child', isDirectory: true }
    ])
  })

  it('SSH: an empty directory has no entries (no empty-name entry)', async () => {
    expect((await ssh(join(root, 'empty'))).entries).toEqual([])
  })

  it.skipIf(isRoot)('SSH: an unreadable directory fails instead of looking empty', async () => {
    await expect(ssh(join(root, 'unreadable'))).rejects.toThrow()
  })

  it('server: a directory symlink is a directory, expands, and a dangling link is a file', async () => {
    const top = await server(root)
    expect(top.entries).toEqual([
      { name: 'empty', isDirectory: true, isSymlink: false },
      { name: 'link-dir', isDirectory: true, isSymlink: true },
      { name: 'real-dir', isDirectory: true, isSymlink: false },
      { name: 'unreadable', isDirectory: true, isSymlink: false },
      { name: 'dangling', isDirectory: false, isSymlink: true }
    ])
    expect((await server(join(root, 'link-dir'))).entries).toEqual([
      { name: 'child', isDirectory: true, isSymlink: false }
    ])
  })

  it('server: an empty directory has no entries', async () => {
    expect((await server(join(root, 'empty'))).entries).toEqual([])
  })

  it.skipIf(isRoot)('server: an unreadable directory fails instead of looking empty', async () => {
    await expect(server(join(root, 'unreadable'))).rejects.toThrow()
  })
})

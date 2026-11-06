// F046 host side: files outside every workspace, read by absolute path. Doc previews keep upstream's
// doc-preview checks for whatever authority the client sends; the editor stats and pages any file.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => tmpdir()), isPackaged: false }
}))

import { RpcDispatcher } from '../../main/runtime/rpc/dispatcher'
import type { RpcResponse } from '../../main/runtime/rpc/core'
import { ALL_RPC_METHODS } from '../../main/runtime/rpc/methods/rpc-method-registry'
import type { OrcaRuntimeService } from '../../main/runtime/orca-runtime'
import { HOST_FILE_METHODS } from './host-file-methods'

// Past the 512 KiB a single reply carries.
const BUNDLE = `window.big = '${'x'.repeat(600 * 1024)}'`

let root = ''
let pages = ''

function call(
  method: string,
  params: Record<string, unknown>,
  executionHostId = 'local'
): Promise<RpcResponse> {
  const runtime: Pick<OrcaRuntimeService, 'getRuntimeId' | 'resolveRuntimeFileTarget'> = {
    getRuntimeId: () => 'runtime-1',
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these methods read only the worktree id and path and the execution host.
    resolveRuntimeFileTarget: vi.fn(async () => ({
      worktree: { id: 'wt-1', path: join(root, 'app'), repoId: 'repo-1' },
      executionHostId
    })) as never
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the dispatcher reads getRuntimeId; these methods only resolveRuntimeFileTarget.
  const dispatcher = new RpcDispatcher({
    runtime: runtime as OrcaRuntimeService,
    methods: HOST_FILE_METHODS
  })
  return dispatcher.dispatch({
    id: 'req-1',
    authToken: 'tok',
    method,
    params: { worktree: 'id:wt-1', ...params }
  })
}

/** A doc-preview read as the desktop sends it for a page outside every workspace (F051 open). */
function readPreview(name: string, overrides: Record<string, unknown> = {}): Promise<RpcResponse> {
  return call('files.hostDocPreview.read', {
    boundaryPath: '/',
    entryPath: join(pages, 'report.html'),
    implicitRootPath: pages,
    authorizedRootPaths: ['/'],
    targetPath: join(pages, name),
    ...overrides
  })
}

function result(response: RpcResponse): Record<string, unknown> {
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: expectations below read only these fields.
  return response.result as Record<string, unknown>
}

function errorMessage(response: RpcResponse): string | null {
  return response.ok ? null : response.error.message
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-host-files-'))
  pages = join(root, 'pages')
  mkdirSync(join(pages, 'fonts'), { recursive: true })
  writeFileSync(join(pages, 'report.html'), '<link rel="stylesheet" href="style.css">')
  writeFileSync(join(pages, 'style.css'), 'h1 { color: red }')
  writeFileSync(join(pages, 'fonts', 'icons.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1]))
  writeFileSync(join(pages, 'bundle.js'), BUNDLE)
  writeFileSync(join(pages, '.env'), 'TOKEN=dev')
  writeFileSync(join(root, 'shared.css'), 'p { margin: 0 }')
  symlinkSync(join(root, 'shared.css'), join(pages, 'linked.css'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('host file methods', () => {
  it('are served by every host', () => {
    expect(ALL_RPC_METHODS.map((method) => method.name)).toEqual(
      expect.arrayContaining(HOST_FILE_METHODS.map((method) => method.name))
    )
  })

  it('read any file a preview with the whole filesystem allowed names', async () => {
    expect(result(await readPreview('report.html')).content).toBe(
      '<link rel="stylesheet" href="style.css">'
    )
    expect(result(await readPreview('style.css')).content).toBe('h1 { color: red }')
    expect(result(await readPreview('.env')).content).toBe('TOKEN=dev')
    expect(result(await readPreview('linked.css')).content).toBe('p { margin: 0 }')
    expect(result(await readPreview('../shared.css')).content).toBe('p { margin: 0 }')
  })

  it('send fonts as typed binary, which terminal grants refuse', async () => {
    expect(result(await readPreview('fonts/icons.woff2'))).toEqual({
      content: Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1]).toString('base64'),
      isBinary: true,
      mimeType: 'font/woff2'
    })
  })

  it('keep upstream authority for the roots the client sends', async () => {
    const entryOnly = { boundaryPath: pages, implicitRootPath: null, authorizedRootPaths: [] }
    expect(errorMessage(await readPreview('style.css', entryOnly))).toBe(
      'doc_preview_path_unauthorized'
    )
    expect(result(await readPreview('report.html', entryOnly)).isBinary).toBe(false)
  })

  it('page a preview file larger than one reply', async () => {
    expect(errorMessage(await readPreview('bundle.js'))).toBe('file_too_large')
    const chunk = result(
      await call('files.hostDocPreview.readChunk', {
        boundaryPath: '/',
        entryPath: join(pages, 'report.html'),
        implicitRootPath: pages,
        authorizedRootPaths: ['/'],
        targetPath: join(pages, 'bundle.js'),
        offset: 0,
        length: 384 * 1024
      })
    )
    expect(chunk).toMatchObject({
      bytesRead: 384 * 1024,
      eof: false,
      size: Buffer.byteLength(BUNDLE)
    })
  })

  it('stat and page any file for the editor', async () => {
    const file = join(pages, 'bundle.js')
    const stat = result(await call('files.hostFile.stat', { path: file }))
    expect(stat).toMatchObject({ size: Buffer.byteLength(BUNDLE), isDirectory: false })
    // The identity that tells a log that grew from a file replaced under the same path.
    expect(stat.fileId).toMatch(/^\d+:\d+$/)
    expect(result(await call('files.hostFile.stat', { path: file })).fileId).toBe(stat.fileId)
    expect(result(await call('files.hostFile.stat', { path: pages })).isDirectory).toBe(true)
    const tail = result(
      await call('files.hostFile.readChunk', { path: file, offset: 600 * 1024, length: 1024 })
    )
    expect(tail).toEqual({
      contentBase64: Buffer.from(BUNDLE.slice(600 * 1024)).toString('base64'),
      bytesRead: Buffer.byteLength(BUNDLE) - 600 * 1024,
      eof: true
    })
    expect(
      (await call('files.hostFile.readChunk', { path: file, offset: 0, length: 600 * 1024 })).ok
    ).toBe(false)
  })

  it('reject relative paths and workspaces this host reaches over SSH', async () => {
    const relative = { code: 'invalid_argument', message: 'Expected an absolute path' }
    expect(await call('files.hostFile.stat', { path: 'pages/bundle.js' })).toMatchObject({
      ok: false,
      error: relative
    })
    expect(await readPreview('style.css', { targetPath: 'pages/style.css' })).toMatchObject({
      ok: false,
      error: relative
    })
    expect(
      (await call('files.hostFile.stat', { path: join(pages, 'style.css') }, 'ssh:target-1')).ok
    ).toBe(false)
  })
})

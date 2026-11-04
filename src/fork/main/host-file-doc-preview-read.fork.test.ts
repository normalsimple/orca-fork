// F046 and F051 in the main process: a server document outside the clicked workspace is read by
// upstream's preview reader once the fork registers, its grant hanging from the host's filesystem
// root; every grant reads its whole request base without a prompt.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ callRuntimeEnvironment: vi.fn() }))

vi.mock('../../main/ipc/runtime-environments/runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment: mocks.callRuntimeEnvironment
}))
vi.mock('../../main/ipc/runtime-environments/runtime-environment-registry-root', () => ({
  getRuntimeEnvironmentRegistryRoot: () => '/user-data'
}))

import { readDocPreviewFile } from '../../main/browser/document-preview/doc-preview-file-reader'
import {
  mintDocPreviewGrant,
  revokeAllDocPreviewGrants
} from '../../main/browser/document-preview/doc-preview-grant-registry'
import { DOC_PREVIEW_FILE_CHANGED_MESSAGE } from '../../shared/doc-preview-file-access'
import {
  openDocPreviewAccess,
  registerDocPreviewOpenAccess
} from '../../shared/fork-hooks/doc-preview-access'
import { registerHostFileDocPreviewRead } from '../../shared/fork-hooks/host-file-doc-preview'
import { openWholeRequestBase } from './doc-preview-open-access'
import { readGrantedHostDocPreview } from './host-file-doc-preview-read'

const PAGES = '/home/me/pages'
const OWNER = {
  kind: 'runtime' as const,
  environmentId: 'env-1',
  worktreeSelector: 'id:wt-1',
  worktreeRoot: '/srv/app'
}

type HostFile = { content: string; isBinary?: boolean; mimeType?: string; tooLarge?: boolean }

const files: Record<string, HostFile> = {
  [`${PAGES}/report.html`]: { content: '<link rel="stylesheet" href="style.css">' },
  [`${PAGES}/sub/index.html`]: { content: '<link rel="stylesheet" href="../style.css">' },
  [`${PAGES}/style.css`]: { content: 'body { color: red }' },
  [`${PAGES}/chart.png`]: {
    content: Buffer.from([0x89, 0x50]).toString('base64'),
    isBinary: true,
    mimeType: 'image/png'
  },
  [`${PAGES}/huge.html`]: { content: '', tooLarge: true },
  [`${PAGES}/.env`]: { content: 'TOKEN=dev' },
  '/home/me/report.html': { content: '<link rel="stylesheet" href="style.css">' },
  '/home/me/style.css': { content: 'body { color: blue }' },
  '/home/me/app/dist/index.html': { content: '<script src="/assets/app.js"></script>' },
  '/home/me/app/dist/assets/app.js': { content: 'window.app = 1' },
  // The same root-absolute path on the host root and under the site: the site's own wins.
  '/data/metrics.json': { content: '{"host":true}' },
  '/home/me/app/dist/data/metrics.json': { content: '{"site":true}' },
  '/home/me/.ssh/config': { content: 'Host dev' }
}
// A link beside the document into the user's SSH folder: nothing is off limits now.
const symlinks: Record<string, string> = { [`${PAGES}/ssh-config`]: '/home/me/.ssh/config' }

function failure(message: string, code = 'runtime_error'): unknown {
  return { ok: false, error: { code, message } }
}

function served(file: HostFile): unknown {
  const { content, isBinary = false, mimeType } = file
  return { ok: true, result: { content, isBinary, ...(mimeType ? { mimeType } : {}) } }
}

function isHostDirectory(path: string): boolean {
  const prefix = path.endsWith('/') ? path : `${path}/`
  return Object.keys(files).some((file) => file.startsWith(prefix))
}

function hostResolve(pathText: string): unknown {
  const absolutePath = symlinks[pathText] ?? pathText
  const isDirectory = isHostDirectory(absolutePath)
  if (!isDirectory && !files[absolutePath]) {
    return { worktree: 'wt-1', relativePath: null, absolutePath, exists: false, isDirectory: false }
  }
  const grant = { kind: 'absolute-file', absolutePath, grantId: `grant:${absolutePath}` }
  return {
    worktree: 'wt-1',
    relativePath: null,
    absolutePath,
    exists: true,
    isDirectory,
    ...(isDirectory ? {} : { openTarget: grant })
  }
}

function serveHost(hostPathMethods: boolean): void {
  mocks.callRuntimeEnvironment.mockImplementation(
    async (_root: string, _env: string, method: string, params: Record<string, string>) => {
      if (method === 'files.resolveTerminalPath') {
        return { ok: true, result: hostResolve(params.pathText) }
      }
      const path =
        method === 'files.readTerminalArtifactPreview' ? params.absolutePath : params.targetPath
      if (
        method === 'files.readTerminalArtifactPreview' ||
        (hostPathMethods && method === 'files.hostDocPreview.read')
      ) {
        if (path.endsWith('/locked.css')) {
          return failure(`EACCES: permission denied, open '${path}'`)
        }
        const file = files[symlinks[path] ?? path]
        if (!file) {
          return failure(`ENOENT: no such file or directory, realpath '${path}'`)
        }
        return file.tooLarge ? failure('file_too_large') : served(file)
      }
      if (method === 'files.readDocPreview') {
        return { ok: true, result: { content: `inside:${params.relativePath}`, isBinary: false } }
      }
      return failure(method, 'method_not_found')
    }
  )
}

/** As the renderer builds it for a document outside every workspace, then minted. */
function outsideGrant(filePath: string) {
  const grant = mintDocPreviewGrant({
    owner: OWNER,
    requestBase: '/',
    root: filePath.slice(0, filePath.lastIndexOf('/')),
    entryRelativePath: filePath.slice(1),
    browserPageId: 'page-1'
  })
  // What the mint IPC does right after minting.
  openDocPreviewAccess(grant.id)
  return grant
}

function hostCalls(method: string): Record<string, unknown>[] {
  return mocks.callRuntimeEnvironment.mock.calls
    .filter((call) => call[2] === method)
    .map((call) => call[3])
}

function text(content: string, contentType = 'text/css; charset=utf-8'): unknown {
  return { ok: true, bytes: Buffer.from(content, 'utf8'), contentType }
}

beforeEach(() => {
  revokeAllDocPreviewGrants()
  mocks.callRuntimeEnvironment.mockReset()
  serveHost(true)
})

describe('upstream without the fork', () => {
  it('keeps the outside-worktree 404, the entry-only grant, and asks the host nothing', async () => {
    const grant = outsideGrant(`${PAGES}/report.html`)

    expect(await readDocPreviewFile(grant, 'home/me/pages/report.html')).toMatchObject({
      status: 404
    })
    // Upstream already reaches the document's folder below the base; above it, it asks.
    expect(await readDocPreviewFile(grant, 'home/me/style.css')).toMatchObject({
      status: 403,
      reason: 'authorization-required'
    })
    expect(mocks.callRuntimeEnvironment).not.toHaveBeenCalled()
  })
})

describe('with the fork registered', () => {
  beforeEach(() => {
    registerHostFileDocPreviewRead(readGrantedHostDocPreview)
    registerDocPreviewOpenAccess(openWholeRequestBase)
  })

  it('reads the page and any file it names, above its folder too, without asking', async () => {
    const grant = outsideGrant(`${PAGES}/sub/index.html`)

    expect(await readDocPreviewFile(grant, 'home/me/pages/sub/index.html')).toEqual(
      text(files[`${PAGES}/sub/index.html`].content, 'text/html; charset=utf-8')
    )
    // `../style.css` from sub/, as the browser resolves it.
    expect(await readDocPreviewFile(grant, 'home/me/pages/style.css')).toEqual(
      text('body { color: red }')
    )
    expect(await readDocPreviewFile(grant, 'home/me/pages/chart.png')).toEqual({
      ok: true,
      bytes: Buffer.from([0x89, 0x50]),
      contentType: 'image/png'
    })
    for (const path of ['home/me/pages/.env', 'home/me/pages/ssh-config']) {
      expect(await readDocPreviewFile(grant, path), path).toMatchObject({ ok: true })
    }
    expect(hostCalls('files.hostDocPreview.read')).toContainEqual({
      worktree: 'id:wt-1',
      boundaryPath: '/',
      entryPath: `${PAGES}/sub/index.html`,
      implicitRootPath: `${PAGES}/sub`,
      authorizedRootPaths: ['/'],
      targetPath: `${PAGES}/style.css`
    })
    expect(hostCalls('files.resolveTerminalPath')).toEqual([])
  })

  it('reads beside a page directly in the home folder without asking', async () => {
    const grant = outsideGrant('/home/me/report.html')

    expect(await readDocPreviewFile(grant, 'home/me/style.css')).toEqual(
      text('body { color: blue }')
    )
  })

  it('reads a root-absolute path from the page folder first, as its site serves it', async () => {
    const grant = outsideGrant('/home/me/app/dist/index.html')

    expect(await readDocPreviewFile(grant, 'assets/app.js')).toEqual(
      text('window.app = 1', 'text/javascript; charset=utf-8')
    )
    expect(await readDocPreviewFile(grant, 'data/metrics.json')).toEqual(
      text('{"site":true}', 'application/json; charset=utf-8')
    )
    expect(hostCalls('files.hostDocPreview.read').map((params) => params.targetPath)).toEqual([
      '/home/me/app/dist/assets/app.js',
      '/home/me/app/dist/data/metrics.json'
    ])
    expect(await readDocPreviewFile(grant, 'home/me/app/missing.css')).toMatchObject({
      status: 404,
      reason: 'unreadable'
    })
  })

  it('falls to the host path only when the site has no such file', async () => {
    const grant = outsideGrant(`${PAGES}/sub/index.html`)

    expect(await readDocPreviewFile(grant, 'home/me/pages/style.css')).toEqual(
      text('body { color: red }')
    )
    expect(await readDocPreviewFile(grant, 'home/me/pages/locked.css')).toMatchObject({
      status: 404,
      message: expect.stringContaining('EACCES')
    })
    expect(hostCalls('files.hostDocPreview.read').map((params) => params.targetPath)).toEqual([
      `${PAGES}/sub/home/me/pages/style.css`,
      `${PAGES}/style.css`,
      `${PAGES}/sub/home/me/pages/locked.css`
    ])
  })

  it('pages a file larger than one reply, and refuses one rewritten mid-read', async () => {
    const body = Buffer.alloc(900 * 1024, 0x61)
    const serveChunks = (mtimeMs: () => number): void => {
      mocks.callRuntimeEnvironment.mockImplementation(
        async (_root: string, _env: string, method: string, params: Record<string, number>) => {
          if (method === 'files.hostDocPreview.read') {
            return failure('file_too_large')
          }
          const bytes = body.subarray(params.offset, params.offset + params.length)
          const chunk = { contentBase64: bytes.toString('base64'), size: body.length, ctimeMs: 1 }
          return { ok: true, result: { ...chunk, bytesRead: bytes.length, mtimeMs: mtimeMs() } }
        }
      )
    }
    const grant = outsideGrant(`${PAGES}/huge.html`)

    serveChunks(() => 1)
    expect(await readDocPreviewFile(grant, 'home/me/pages/huge.html')).toEqual({
      ok: true,
      bytes: body,
      contentType: 'text/html; charset=utf-8'
    })
    expect(hostCalls('files.hostDocPreview.readChunk')).toHaveLength(3)

    let mtimeMs = 1
    serveChunks(() => mtimeMs++)
    expect(await readDocPreviewFile(grant, 'home/me/pages/huge.html')).toMatchObject({
      status: 404,
      message: DOC_PREVIEW_FILE_CHANGED_MESSAGE
    })
  })

  describe('on a host without files.hostDocPreview.*', () => {
    beforeEach(() => {
      serveHost(false)
    })

    it('reads each file through the grant the host mints for it', async () => {
      const grant = outsideGrant(`${PAGES}/report.html`)

      expect(await readDocPreviewFile(grant, 'home/me/pages/style.css')).toEqual(
        text('body { color: red }')
      )
      expect(hostCalls('files.readTerminalArtifactPreview')).toEqual([
        {
          worktree: 'id:wt-1',
          absolutePath: `${PAGES}/style.css`,
          grantId: `grant:${PAGES}/style.css`
        }
      ])
    })

    it('reports a file past one reply as too large, and a missing one as missing', async () => {
      expect(
        await readDocPreviewFile(outsideGrant(`${PAGES}/huge.html`), 'home/me/pages/huge.html')
      ).toMatchObject({ status: 413, reason: 'too-large' })
      expect(
        await readDocPreviewFile(outsideGrant(`${PAGES}/gone.html`), 'home/me/pages/gone.html')
      ).toMatchObject({ status: 404, reason: 'unreadable' })
    })
  })

  it('opens a workspace preview to its whole workspace (F051)', async () => {
    const atRoot = mintDocPreviewGrant({
      owner: OWNER,
      requestBase: '/srv/app',
      root: '/srv/app',
      entryRelativePath: 'index.html',
      browserPageId: 'page-2'
    })
    openDocPreviewAccess(atRoot.id)
    const nested = mintDocPreviewGrant({
      owner: OWNER,
      requestBase: '/srv/app',
      root: '/srv/app/docs',
      entryRelativePath: 'docs/guide.html',
      browserPageId: 'page-3'
    })
    openDocPreviewAccess(nested.id)

    expect(await readDocPreviewFile(atRoot, 'style.css')).toEqual(text('inside:style.css'))
    expect(await readDocPreviewFile(nested, 'assets/site.css')).toEqual(
      text('inside:assets/site.css')
    )
    expect(
      hostCalls('files.readDocPreview').map((params) => params.authorizedRootRelativePaths)
    ).toEqual([[''], ['']])
  })
})
